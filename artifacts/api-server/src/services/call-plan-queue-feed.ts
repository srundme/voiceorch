/**
 * Call-plan auto-feed — keep a small pipeline of workflow runs ahead of the
 * account dial queue so large lists drain without manual Continue.
 */

import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  journeysTable,
  workflowsTable,
  workflowRunsTable,
  campaignsTable,
  campaignLeadsTable,
  ACTIVE_RUN_STATUSES,
  type Journey,
  type JourneySettings,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { normalizePhone } from "../lib/phone-normalize.js";
import { startWorkflowRun } from "./workflow-engine.js";
import {
  callPlanFeedBufferSize,
  getUserConcurrentLimit,
  refillWorkflowDialSlots,
} from "./workflow-dial-queue.js";
import {
  loadOwnedSheetPipeline,
  listSheetPipelinePeople,
  type SheetPerson,
} from "./call-plan-sheet-live.js";

export type FeedPerson = {
  phone: string;
  name?: string;
  email?: string;
  leadId?: number;
  meetingUrl?: string;
  sheetRowIndex?: number;
};

async function countPipelineRuns(workflowId: number, userId: string): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(workflowRunsTable)
    .where(and(
      eq(workflowRunsTable.workflowId, workflowId),
      eq(workflowRunsTable.userId, userId),
      inArray(workflowRunsTable.status, [...ACTIVE_RUN_STATUSES]),
    ));
  return Number(row?.c ?? 0);
}

/** Phones that already have a run (or, with `activeOnly`, a run still in progress). */
async function loadBusyPhones(workflowId: number, userId: string, activeOnly = false): Promise<Set<string>> {
  const prior = await db.select({
    context: workflowRunsTable.context,
    status: workflowRunsTable.status,
  }).from(workflowRunsTable)
    .where(and(
      eq(workflowRunsTable.workflowId, workflowId),
      eq(workflowRunsTable.userId, userId),
      ...(activeOnly ? [inArray(workflowRunsTable.status, [...ACTIVE_RUN_STATUSES])] : []),
    ))
    .limit(5000);

  const busy = new Set<string>();
  for (const r of prior) {
    if (r.status === "failed" || r.status === "stopped") continue;
    const phone = typeof r.context?.["phone"] === "string" ? r.context["phone"] : "";
    const norm = normalizePhone(phone);
    if (norm) busy.add(norm);
    else if (phone.trim()) busy.add(phone.trim());
  }
  return busy;
}

/** Load a slice of people from the plan's bound source. */
export async function loadCallPlanPeopleSlice(opts: {
  userId: string;
  settings: JourneySettings;
  offset: number;
  limit: number;
  phonesOverride?: string[];
}): Promise<{ people: FeedPerson[]; sourceTotal: number; sheetCursorRow: number; scanned: number }> {
  const { userId, settings, offset, limit } = opts;
  const campaignIdRaw = settings.campaignId ?? null;
  const campaignId = campaignIdRaw != null ? Number(campaignIdRaw) : NaN;
  const sheetPipelineId = (settings.sheetPipelineId ?? "").trim() || null;
  const manualPhones = opts.phonesOverride
    ?? (Array.isArray(settings.manualPhones) ? settings.manualPhones : []);
  let sheetCursorRow = typeof settings.sheetCursorRow === "number" ? settings.sheetCursorRow : 1;

  const people: FeedPerson[] = [];
  let sourceTotal = 0;
  let scanned = 0;

  if (manualPhones.length > 0 && settings.peopleSource === "manual") {
    const allPhones = manualPhones.map((raw: string) => String(raw ?? "").trim()).filter(Boolean);
    sourceTotal = allPhones.length;
    const slice = allPhones.slice(offset, offset + limit);
    scanned = slice.length;
    for (const phone of slice) people.push({ phone });
  } else if (sheetPipelineId) {
    const pipeline = await loadOwnedSheetPipeline(userId, sheetPipelineId);
    if (!pipeline) return { people: [], sourceTotal: 0, sheetCursorRow, scanned: 0 };
    const listed = await listSheetPipelinePeople(pipeline, {
      fromRowExclusive: 1,
      limit: offset + limit,
    });
    sourceTotal = Math.max(0, listed.lastRow - 1);
    const sheetSlice = listed.people.slice(offset, offset + limit);
    scanned = sheetSlice.length;
    for (const p of sheetSlice) {
      people.push({
        phone: p.phone,
        name: p.name,
        email: p.email,
        meetingUrl: p.meetingUrl,
        sheetRowIndex: p.sheetRowIndex,
      });
    }
    if (people.length > 0) {
      sheetCursorRow = Math.max(...people.map((p) => p.sheetRowIndex ?? 1), sheetCursorRow);
    }
  } else if (Number.isFinite(campaignId) && campaignId > 0) {
    const [campaign] = await db.select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)))
      .limit(1);
    if (!campaign) return { people: [], sourceTotal: 0, sheetCursorRow, scanned: 0 };

    const allLeads = await db.select({
      id: campaignLeadsTable.id,
      phone: campaignLeadsTable.phone,
      name: campaignLeadsTable.name,
      email: campaignLeadsTable.email,
    }).from(campaignLeadsTable)
      .where(eq(campaignLeadsTable.campaignId, campaignId))
      .orderBy(desc(campaignLeadsTable.createdAt));

    const withPhone = allLeads.filter((l) => (l.phone ?? "").trim());
    sourceTotal = withPhone.length;
    const slice = withPhone.slice(offset, offset + limit);
    scanned = slice.length;
    for (const lead of slice) {
      people.push({
        phone: (lead.phone ?? "").trim(),
        name: lead.name ?? undefined,
        email: lead.email ?? undefined,
        leadId: lead.id,
      });
    }
  }

  return { people, sourceTotal, sheetCursorRow, scanned };
}

export async function startRunsForPeople(opts: {
  journey: Journey;
  workflowId: number;
  people: FeedPerson[];
  triggeredBy: string;
  force?: boolean;
  /** With force: still skip people who are mid-flow right now. */
  skipActive?: boolean;
}): Promise<{ runIds: number[]; skippedDup: number }> {
  const { journey, workflowId, people, triggeredBy, force, skipActive } = opts;
  const settings = (journey.settings ?? {}) as JourneySettings;
  const sheetPipelineId = (settings.sheetPipelineId ?? "").trim() || null;

  const [workflow] = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.userId, journey.userId)))
    .limit(1);
  if (!workflow) throw new Error("Backing workflow missing");

  let skippedDup = 0;
  let toStart = people;
  if ((!force || skipActive) && people.length > 0) {
    const busy = await loadBusyPhones(workflowId, journey.userId, force === true);
    toStart = [];
    for (const p of people) {
      const norm = normalizePhone(p.phone) || p.phone.trim();
      if (busy.has(norm)) {
        skippedDup++;
        continue;
      }
      toStart.push(p);
      busy.add(norm);
    }
  }

  const runIds: number[] = [];
  for (const person of toStart) {
    const runId = await startWorkflowRun({
      workflow,
      context: {
        phone: person.phone,
        ...(person.name ? { name: person.name } : {}),
        ...(person.email ? { email: person.email } : {}),
        ...(person.meetingUrl
          ? { meetingUrl: person.meetingUrl, meetLink: person.meetingUrl }
          : {}),
        ...(person.leadId != null ? { leadId: person.leadId } : {}),
        ...(sheetPipelineId && person.sheetRowIndex != null
          ? {
              __sheet_pipeline_id: sheetPipelineId,
              sheetPipelineId,
              __sheet_row_index: person.sheetRowIndex,
              sheetRowIndex: person.sheetRowIndex,
            }
          : {}),
        callPlanId: journey.id,
        agentId: journey.agentId,
      },
      triggeredBy,
    });
    runIds.push(runId);
  }
  return { runIds, skippedDup };
}

/**
 * Top up an active call plan's in-flight runs from its people source.
 * Returns how many runs were started.
 */
export async function feedCallPlanQueue(journey: Journey, opts?: {
  force?: boolean;
  skipActive?: boolean;
  /** Override feed size (Start click uses buffer; tick uses deficit). */
  limit?: number;
}): Promise<{
  started: number;
  skipped: number;
  nextOffset: number;
  hasMore: boolean;
  sourceTotal: number;
  concurrentLimit: number;
  bufferTarget: number;
}> {
  const settings = { ...(journey.settings ?? {}) } as JourneySettings;
  const concurrentLimit = await getUserConcurrentLimit(journey.userId);
  const bufferTarget = callPlanFeedBufferSize(concurrentLimit);

  if (!journey.workflowId) {
    return {
      started: 0, skipped: 0, nextOffset: 0, hasMore: false,
      sourceTotal: 0, concurrentLimit, bufferTarget,
    };
  }

  const inFlight = await countPipelineRuns(journey.workflowId, journey.userId);
  const want = opts?.limit ?? Math.max(0, bufferTarget - inFlight);
  if (want <= 0) {
    const offset = typeof settings.startOffset === "number" ? settings.startOffset : 0;
    const sourceTotal = typeof settings.startSourceTotal === "number" ? settings.startSourceTotal : 0;
    return {
      started: 0,
      skipped: 0,
      nextOffset: offset,
      hasMore: offset < sourceTotal || settings.autoFeed === true,
      sourceTotal,
      concurrentLimit,
      bufferTarget,
    };
  }

  const offset = typeof settings.startOffset === "number" ? settings.startOffset : 0;
  const { people, sourceTotal, sheetCursorRow, scanned } = await loadCallPlanPeopleSlice({
    userId: journey.userId,
    settings,
    offset,
    limit: want,
  });

  if (people.length === 0) {
    const nextSettings: JourneySettings = {
      ...settings,
      startOffset: offset,
      startSourceTotal: sourceTotal,
      autoFeed: false,
      ...(settings.peopleSource === "sheet" ? { sheetCursorRow } : {}),
    };
    await db.update(journeysTable).set({
      settings: nextSettings,
      updatedAt: new Date(),
    }).where(eq(journeysTable.id, journey.id));
    return {
      started: 0, skipped: 0, nextOffset: offset, hasMore: false,
      sourceTotal, concurrentLimit, bufferTarget,
    };
  }

  const { runIds, skippedDup } = await startRunsForPeople({
    journey,
    workflowId: journey.workflowId,
    people,
    triggeredBy: "call_plan_queue",
    force: opts?.force === true,
    skipActive: opts?.skipActive === true,
  });

  const nextOffset = offset + scanned;
  const hasMore = nextOffset < sourceTotal;
  const nextSettings: JourneySettings = {
    ...settings,
    startOffset: hasMore ? nextOffset : 0,
    startSourceTotal: sourceTotal,
    autoFeed: hasMore,
    ...(settings.peopleSource === "sheet" ? { sheetCursorRow } : {}),
  };

  await db.update(journeysTable).set({
    settings: nextSettings,
    status: "active",
    lastRunAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(journeysTable.id, journey.id));

  // Kick the dial queue in case make_call parking raced refill.
  void refillWorkflowDialSlots(journey.userId);

  return {
    started: runIds.length,
    skipped: skippedDup,
    nextOffset: hasMore ? nextOffset : 0,
    hasMore,
    sourceTotal,
    concurrentLimit,
    bufferTarget,
  };
}

/** Worker: feed every active once-mode plan with autoFeed, then refill dial slots. */
export async function tickCallPlanAutoFeed(): Promise<void> {
  const rows = await db.select().from(journeysTable)
    .where(eq(journeysTable.status, "active"));

  const usersToRefill = new Set<string>();

  for (const journey of rows) {
    const settings = (journey.settings ?? {}) as JourneySettings;
    if (settings.runMode === "live") continue; // Keep live has its own tick
    if (settings.autoFeed !== true) continue;
    if (!journey.workflowId) continue;

    try {
      const result = await feedCallPlanQueue(journey, { force: settings.feedForce === true, skipActive: true });
      usersToRefill.add(journey.userId);
      if (result.started > 0) {
        logger.info(
          { journeyId: journey.id, started: result.started, nextOffset: result.nextOffset, hasMore: result.hasMore },
          "call-plan auto-feed: topped up pipeline",
        );
      }
    } catch (err) {
      logger.warn({ err, journeyId: journey.id }, "call-plan auto-feed failed");
    }
  }

  // Also refill dial slots for any user with active call plans (covers paused feed + pending dials).
  const activeUsers = await db.execute<{ user_id: string }>(sql`
    SELECT DISTINCT c.user_id
    FROM campaign_leads cl
    JOIN campaigns c ON c.id = cl.campaign_id
    JOIN workflow_runs wr ON wr.lead_id = cl.id AND wr.status = 'waiting_call'
    WHERE c.lead_source = 'workflow'
      AND cl.call_status = 'pending'
    LIMIT 50
  `);
  for (const row of activeUsers.rows ?? []) {
    usersToRefill.add(String(row.user_id));
  }
  for (const userId of usersToRefill) {
    try {
      await refillWorkflowDialSlots(userId);
    } catch (err) {
      logger.warn({ err, userId }, "call-plan dial refill backstop failed");
    }
  }
}

// Re-export type for sheet helper consumers
export type { SheetPerson };
