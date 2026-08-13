/**
 * Post-call conversation intelligence.
 *
 * After a campaign call ends (transcript + optional summary already saved),
 * extract universal signals that every client needs on the campaign board:
 *   - sentiment  (positive | neutral | negative)
 *   - intent     (controlled vocabulary)
 *   - keyTopics  (short noun phrases)
 *
 * Writes:
 *   - call_executions.{callSummary,sentiment,detectedIntent,keyTopics}
 *   - lead_interaction_summaries (upsert latest cache)
 *   - lead_timeline analysis_completed (+ sentiment_set)
 *
 * Disposition (use-case outcomes) stays in disposeCall — this layer is
 * universal and runs alongside it, not instead of it.
 */
import {
  db,
  callExecutionsTable,
  leadInteractionSummaryTable,
  leadTimelineTable,
  campaignLeadsTable,
  callsTable,
} from "@workspace/db";
import { and, eq, isNotNull, isNull, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { getDispositionLLM } from "./disposition-llm.js";
import {
  normalizeIntelligence,
  SENTIMENTS,
  INTENTS,
  type CallIntelligence,
  type Sentiment,
  type DetectedIntent,
} from "./call-intelligence-normalize.js";

export {
  normalizeIntelligence,
  SENTIMENTS,
  INTENTS,
  type CallIntelligence,
  type Sentiment,
  type DetectedIntent,
} from "./call-intelligence-normalize.js";

export interface AnalyzeCallIntelligenceInput {
  callId: number;
  leadId?: number | null;
  campaignId?: number | null;
  transcript: string;
  callSummary?: string | null;
  dispositionResult?: Record<string, unknown> | null;
  /** When true, re-run even if sentiment is already set. */
  force?: boolean;
}

const INTELLIGENCE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    sentiment: { type: "string", enum: [...SENTIMENTS] },
    detectedIntent: { type: "string", enum: [...INTENTS] },
    keyTopics: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    summary: { type: "string" },
  },
  required: ["sentiment", "detectedIntent", "keyTopics"],
};

function buildIntelligencePrompt(opts: {
  callSummary?: string | null;
  dispositionResult?: Record<string, unknown> | null;
}): string {
  const disp = opts.dispositionResult;
  const dispHint =
    disp && typeof disp === "object"
      ? `\nKnown disposition from this call (may be incomplete — still classify):\n${JSON.stringify(disp)}\n`
      : "";
  const summaryHint = opts.callSummary?.trim()
    ? `\nExisting call summary (reuse or refine, do not invent facts):\n${opts.callSummary.trim().slice(0, 1200)}\n`
    : "";

  return `You analyse completed voice-agent call transcripts for campaign analytics.

Return JSON only with:
- sentiment: overall customer tone — positive | neutral | negative
- detectedIntent: the customer's primary intent, one of:
  interested, not_interested, callback_requested, booked, transferred,
  needs_info, complaint, dnc, wrong_person, no_decision, voicemail_or_no_talk
- keyTopics: 0–6 short noun phrases (pricing, demo, competitor, payment, etc.)
- summary: optional 1–2 sentence factual summary if none was provided

Rules:
- Judge from the CUSTOMER's words and behaviour, not the agent's script.
- If the call never connected meaningfully / voicemail / hangup with no talk → sentiment=neutral, intent=voicemail_or_no_talk, topics=[].
- Do not invent topics that were not discussed.
- Prefer specific intents (booked, callback_requested) over vague ones when clear.
${summaryHint}${dispHint}`;
}

async function resolveLeadContext(
  callId: number,
  leadId?: number | null,
  campaignId?: number | null,
): Promise<{ leadId: number; campaignId: number; batchId: number | null } | null> {
  if (leadId != null) {
    const [lead] = await db
      .select({
        id: campaignLeadsTable.id,
        campaignId: campaignLeadsTable.campaignId,
        batchId: campaignLeadsTable.batchId,
      })
      .from(campaignLeadsTable)
      .where(eq(campaignLeadsTable.id, leadId))
      .limit(1);
    if (lead) {
      return {
        leadId: lead.id,
        campaignId: campaignId ?? lead.campaignId,
        batchId: lead.batchId ?? null,
      };
    }
  }

  const [byCall] = await db
    .select({
      id: campaignLeadsTable.id,
      campaignId: campaignLeadsTable.campaignId,
      batchId: campaignLeadsTable.batchId,
    })
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.callId, callId))
    .limit(1);
  if (!byCall) return null;
  return {
    leadId: byCall.id,
    campaignId: campaignId ?? byCall.campaignId,
    batchId: byCall.batchId ?? null,
  };
}

async function ensureExecutionRow(opts: {
  callId: number;
  leadId: number;
  campaignId: number;
  batchId: number | null;
}): Promise<number> {
  const [existing] = await db
    .select({ id: callExecutionsTable.id, sentiment: callExecutionsTable.sentiment })
    .from(callExecutionsTable)
    .where(eq(callExecutionsTable.callId, opts.callId))
    .limit(1);
  if (existing) return existing.id;

  const [inserted] = await db
    .insert(callExecutionsTable)
    .values({
      leadId: opts.leadId,
      campaignId: opts.campaignId,
      batchId: opts.batchId,
      callId: opts.callId,
      attemptNumber: 1,
    })
    .returning({ id: callExecutionsTable.id });
  return inserted!.id;
}

/**
 * Analyse one call and persist intelligence. Returns null when skipped
 * (no transcript / not a campaign call / already analysed without force).
 */
export async function analyzeCallIntelligence(
  input: AnalyzeCallIntelligenceInput,
): Promise<CallIntelligence | null> {
  const transcript = input.transcript?.trim() ?? "";
  if (transcript.length < 20) {
    logger.debug({ callId: input.callId }, "call-intelligence: transcript too short, skip");
    return null;
  }

  const leadCtx = await resolveLeadContext(input.callId, input.leadId, input.campaignId);
  if (!leadCtx) {
    // Non-campaign call — nothing to write into campaign intelligence tables.
    logger.debug({ callId: input.callId }, "call-intelligence: no campaign lead, skip");
    return null;
  }

  const executionId = await ensureExecutionRow({
    callId: input.callId,
    leadId: leadCtx.leadId,
    campaignId: leadCtx.campaignId,
    batchId: leadCtx.batchId,
  });

  if (!input.force) {
    const [row] = await db
      .select({ sentiment: callExecutionsTable.sentiment })
      .from(callExecutionsTable)
      .where(eq(callExecutionsTable.id, executionId))
      .limit(1);
    if (row?.sentiment) {
      return null;
    }
  }

  const llm = await getDispositionLLM();
  if (!llm) {
    logger.warn({ callId: input.callId }, "call-intelligence: no LLM available");
    return null;
  }

  const systemPrompt = buildIntelligencePrompt({
    callSummary: input.callSummary,
    dispositionResult: input.dispositionResult,
  });

  let raw: Record<string, unknown>;
  try {
    raw = await llm.extract(systemPrompt, INTELLIGENCE_SCHEMA, transcript.slice(0, 12_000));
  } catch (err) {
    logger.warn({ callId: input.callId, err }, "call-intelligence: LLM extract failed");
    return null;
  }

  const intel = normalizeIntelligence(raw, input.callSummary);

  await db
    .update(callExecutionsTable)
    .set({
      callSummary: intel.summary,
      sentiment: intel.sentiment,
      detectedIntent: intel.detectedIntent,
      keyTopics: intel.keyTopics,
    })
    .where(eq(callExecutionsTable.id, executionId));

  // Upsert lead interaction summary cache
  const [existingSummary] = await db
    .select({
      id: leadInteractionSummaryTable.id,
      interactionCount: leadInteractionSummaryTable.interactionCount,
    })
    .from(leadInteractionSummaryTable)
    .where(eq(leadInteractionSummaryTable.leadId, leadCtx.leadId))
    .limit(1);

  if (existingSummary) {
    await db
      .update(leadInteractionSummaryTable)
      .set({
        latestSummary: intel.summary,
        latestSentiment: intel.sentiment,
        latestIntent: intel.detectedIntent,
        latestTopics: intel.keyTopics,
        interactionCount: (existingSummary.interactionCount ?? 0) + 1,
        lastContactAt: new Date(),
        lastCallId: input.callId,
      })
      .where(eq(leadInteractionSummaryTable.id, existingSummary.id));
  } else {
    await db.insert(leadInteractionSummaryTable).values({
      leadId: leadCtx.leadId,
      latestSummary: intel.summary,
      latestSentiment: intel.sentiment,
      latestIntent: intel.detectedIntent,
      latestTopics: intel.keyTopics,
      interactionCount: 1,
      lastContactAt: new Date(),
      lastCallId: input.callId,
    });
  }

  await db.insert(leadTimelineTable).values({
    leadId: leadCtx.leadId,
    campaignId: leadCtx.campaignId,
    eventType: "analysis_completed",
    data: {
      callId: input.callId,
      sentiment: intel.sentiment,
      intent: intel.detectedIntent,
      topics: intel.keyTopics,
    },
  });
  await db.insert(leadTimelineTable).values({
    leadId: leadCtx.leadId,
    campaignId: leadCtx.campaignId,
    eventType: "sentiment_set",
    data: { callId: input.callId, sentiment: intel.sentiment },
  });

  logger.info(
    {
      callId: input.callId,
      leadId: leadCtx.leadId,
      sentiment: intel.sentiment,
      intent: intel.detectedIntent,
    },
    "call-intelligence: saved",
  );

  return intel;
}

export interface BackfillCampaignIntelligenceResult {
  campaignId: number;
  scanned: number;
  analysed: number;
  skipped: number;
  failed: number;
}

/**
 * Backfill intelligence for every campaign lead that has a completed call with
 * a transcript but no sentiment on its call_execution row.
 */
export async function backfillCampaignIntelligence(
  campaignId: number,
  opts: { force?: boolean; limit?: number; concurrency?: number } = {},
): Promise<BackfillCampaignIntelligenceResult> {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);
  const concurrency = Math.min(Math.max(opts.concurrency ?? 2, 1), 4);

  // Prefer leads with a callId + transcript; join calls for transcript/summary.
  const candidates = await db
    .select({
      leadId: campaignLeadsTable.id,
      callId: campaignLeadsTable.callId,
      batchId: campaignLeadsTable.batchId,
      transcript: callsTable.transcript,
      callSummary: callsTable.callSummary,
      dispositionResult: callsTable.dispositionResult,
      existingSentiment: callExecutionsTable.sentiment,
    })
    .from(campaignLeadsTable)
    .innerJoin(callsTable, eq(campaignLeadsTable.callId, callsTable.id))
    .leftJoin(callExecutionsTable, eq(callExecutionsTable.callId, campaignLeadsTable.callId))
    .where(
      and(
        eq(campaignLeadsTable.campaignId, campaignId),
        isNotNull(campaignLeadsTable.callId),
        isNotNull(callsTable.transcript),
        sql`length(trim(${callsTable.transcript})) >= 20`,
        opts.force ? sql`true` : isNull(callExecutionsTable.sentiment),
      ),
    )
    .limit(limit);

  let analysed = 0;
  let skipped = 0;
  let failed = 0;

  // Simple concurrency pool
  let i = 0;
  async function worker() {
    while (i < candidates.length) {
      const idx = i++;
      const c = candidates[idx]!;
      if (!c.callId || !c.transcript?.trim()) {
        skipped++;
        continue;
      }
      if (!opts.force && c.existingSentiment) {
        skipped++;
        continue;
      }
      try {
        const result = await analyzeCallIntelligence({
          callId: c.callId,
          leadId: c.leadId,
          campaignId,
          transcript: c.transcript,
          callSummary: c.callSummary,
          dispositionResult: (c.dispositionResult as Record<string, unknown> | null) ?? null,
          force: opts.force,
        });
        if (result) analysed++;
        else skipped++;
      } catch (err) {
        failed++;
        logger.warn({ campaignId, callId: c.callId, err }, "call-intelligence backfill failed");
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    campaignId,
    scanned: candidates.length,
    analysed,
    skipped,
    failed,
  };
}

/** Aggregate intelligence for a campaign analytics response. */
export async function getCampaignIntelligenceStats(campaignId: number): Promise<{
  analysed: number;
  pendingAnalysis: number;
  sentiment: Array<{ label: string; count: number }>;
  intents: Array<{ label: string; count: number }>;
  topTopics: Array<{ label: string; count: number }>;
  hotLeads: number;
}> {
  const [counts] = await db
    .select({
      analysed: sql<number>`count(*) filter (where ${callExecutionsTable.sentiment} is not null)::int`,
      totalWithCall: sql<number>`count(*)::int`,
    })
    .from(callExecutionsTable)
    .where(
      and(
        eq(callExecutionsTable.campaignId, campaignId),
        isNotNull(callExecutionsTable.callId),
      ),
    );

  // Pending = campaign leads with a call + transcript but no sentiment yet
  const [pendingRow] = await db
    .select({
      pending: sql<number>`count(*)::int`,
    })
    .from(campaignLeadsTable)
    .innerJoin(callsTable, eq(campaignLeadsTable.callId, callsTable.id))
    .leftJoin(callExecutionsTable, eq(callExecutionsTable.callId, campaignLeadsTable.callId))
    .where(
      and(
        eq(campaignLeadsTable.campaignId, campaignId),
        isNotNull(campaignLeadsTable.callId),
        isNotNull(callsTable.transcript),
        sql`length(trim(${callsTable.transcript})) >= 20`,
        isNull(callExecutionsTable.sentiment),
      ),
    );

  const sentimentRows = await db
    .select({
      label: callExecutionsTable.sentiment,
      cnt: sql<number>`count(*)::int`,
    })
    .from(callExecutionsTable)
    .where(
      and(
        eq(callExecutionsTable.campaignId, campaignId),
        isNotNull(callExecutionsTable.sentiment),
      ),
    )
    .groupBy(callExecutionsTable.sentiment);

  const intentRows = await db
    .select({
      label: callExecutionsTable.detectedIntent,
      cnt: sql<number>`count(*)::int`,
    })
    .from(callExecutionsTable)
    .where(
      and(
        eq(callExecutionsTable.campaignId, campaignId),
        isNotNull(callExecutionsTable.detectedIntent),
      ),
    )
    .groupBy(callExecutionsTable.detectedIntent);

  // Topics are jsonb arrays — expand with jsonb_array_elements_text
  const topicResult = await db.execute(sql`
    select topic as label, count(*)::int as cnt
    from call_executions,
         lateral jsonb_array_elements_text(coalesce(key_topics, '[]'::jsonb)) as topic
    where campaign_id = ${campaignId}
      and key_topics is not null
      and jsonb_typeof(key_topics) = 'array'
    group by topic
    order by cnt desc
    limit 12
  `);
  const topicList = ((topicResult as unknown as { rows?: Array<{ label: string; cnt: number }> }).rows ?? []);

  const [hot] = await db
    .select({
      hotLeads: sql<number>`count(*)::int`,
    })
    .from(callExecutionsTable)
    .where(
      and(
        eq(callExecutionsTable.campaignId, campaignId),
        eq(callExecutionsTable.sentiment, "positive"),
        inArray(callExecutionsTable.detectedIntent, [
          "interested",
          "callback_requested",
          "booked",
          "needs_info",
        ]),
      ),
    );

  return {
    analysed: counts?.analysed ?? 0,
    pendingAnalysis: pendingRow?.pending ?? 0,
    sentiment: sentimentRows
      .filter((r) => r.label)
      .map((r) => ({ label: r.label!, count: Number(r.cnt) })),
    intents: intentRows
      .filter((r) => r.label)
      .map((r) => ({ label: r.label!, count: Number(r.cnt) })),
    topTopics: topicList.map((r) => ({ label: String(r.label), count: Number(r.cnt) })),
    hotLeads: hot?.hotLeads ?? 0,
  };
}
