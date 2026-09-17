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
  campaignsTable,
} from "@workspace/db";
import { and, eq, isNotNull, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { getDispositionLLMChain, isRetryableProviderError } from "./disposition-llm.js";
import {
  normalizeIntelligence,
  SENTIMENTS,
  INTENTS,
  URGENCIES,
  EMOTIONS,
  type CallIntelligence,
  type Sentiment,
  type DetectedIntent,
} from "./call-intelligence-normalize.js";
import {
  buildAnswersSchema,
  normalizeAnalyticsAnswers,
  type CampaignAnalyticsQuestion,
} from "./call-intelligence-answers.js";

export {
  normalizeIntelligence,
  SENTIMENTS,
  INTENTS,
  URGENCIES,
  EMOTIONS,
  type CallIntelligence,
  type Sentiment,
  type DetectedIntent,
} from "./call-intelligence-normalize.js";

/** Thrown when the analysis model is missing or errors — lets callers surface why. */
export class CallIntelligenceLlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallIntelligenceLlmError";
  }
}

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

const AGENT_PERFORMANCE_KEYS = [
  "talkListenBalance",
  "empathy",
  "objectionHandling",
  "scriptAdherence",
  "clarity",
  "notes",
] as const;

const INTELLIGENCE_PROPERTIES: Record<string, unknown> = {
  sentiment: { type: "string", enum: [...SENTIMENTS] },
  detectedIntent: { type: "string", enum: [...INTENTS] },
  keyTopics: { type: "array", items: { type: "string" } },
  summary: { type: ["string", "null"] },
  purchaseIntentScore: { type: "integer" },
  urgency: { type: "string", enum: [...URGENCIES] },
  objections: { type: "array", items: { type: "string" } },
  buyingSignals: { type: "array", items: { type: "string" } },
  nextBestAction: { type: ["string", "null"] },
  emotion: { anyOf: [{ type: "string", enum: [...EMOTIONS] }, { type: "null" }] },
  agentPerformance: {
    type: ["object", "null"],
    additionalProperties: false,
    properties: {
      talkListenBalance: { type: ["integer", "null"] },
      empathy: { type: ["integer", "null"] },
      objectionHandling: { type: ["integer", "null"] },
      scriptAdherence: { type: ["integer", "null"] },
      clarity: { type: ["integer", "null"] },
      notes: { type: ["string", "null"] },
    },
    required: [...AGENT_PERFORMANCE_KEYS],
  },
};

const INTELLIGENCE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: INTELLIGENCE_PROPERTIES,
  required: Object.keys(INTELLIGENCE_PROPERTIES),
};

function buildIntelligencePrompt(opts: {
  callSummary?: string | null;
  dispositionResult?: Record<string, unknown> | null;
  questions?: CampaignAnalyticsQuestion[];
}): string {
  const disp = opts.dispositionResult;
  const dispHint =
    disp && typeof disp === "object"
      ? `\nKnown disposition from this call (may be incomplete — still classify):\n${JSON.stringify(disp)}\n`
      : "";
  const summaryHint = opts.callSummary?.trim()
    ? `\nExisting call summary (reuse or refine, do not invent facts):\n${opts.callSummary.trim().slice(0, 1200)}\n`
    : "";

  const questions = opts.questions ?? [];
  let answersHint = "";
  if (questions.length > 0) {
    const lines = questions.map((q) => {
      const optsHint =
        q.type === "enum" && q.options?.length
          ? ` (one of: ${q.options.join(" | ")})`
          : q.type === "boolean"
            ? " (true/false/null)"
            : " (short text or null)";
      const desc = q.description ? ` — ${q.description}` : "";
      return `- answers.${q.id}: ${q.label}${optsHint}${desc}`;
    });
    answersHint = `\nAlso fill "answers" for these campaign research questions (null if unknown / not discussed):\n${lines.join("\n")}\n`;
  }

  return `You analyse completed voice-agent call transcripts for deep campaign analytics.

Return JSON only with:
- sentiment: overall customer tone — positive | neutral | negative
- detectedIntent: the customer's primary intent, one of:
  interested, not_interested, callback_requested, booked, transferred,
  needs_info, complaint, dnc, wrong_person, no_decision, voicemail_or_no_talk
- keyTopics: 0–6 short noun phrases (pricing, demo, competitor, payment, etc.)
- summary: optional 1–2 sentence factual summary if none was provided
- purchaseIntentScore: 0–100 how ready/willing the customer seems to pay or buy (0=clear no, 50=curious, 80+=ready to pay soon)
- urgency: none | low | medium | high — how soon they want to act
- objections: 0–5 short objection phrases (price, timing, trust, competitor, etc.)
- buyingSignals: 0–5 short positive buying cues (asked about pricing, requested demo, etc.)
- nextBestAction: one short recommended follow-up for the sales team
- emotion: customer emotion — frustrated | curious | enthusiastic | skeptical | confused | calm | anxious | annoyed | friendly | indifferent
- agentPerformance: scores 1–5 for talkListenBalance, empathy, objectionHandling, scriptAdherence, clarity, plus short notes on AI agent quality
${questions.length ? '- answers: object keyed by question id\n' : ""}
Rules:
- Judge from the CUSTOMER's words and behaviour, not the agent's script.
- If the call never connected meaningfully / voicemail / hangup with no talk → sentiment=neutral, intent=voicemail_or_no_talk, topics=[], purchaseIntentScore=0, urgency=none, objections=[], buyingSignals=[], emotion=indifferent.
- Do not invent topics, objections, or buying signals that were not discussed.
- Prefer specific intents (booked, callback_requested) over vague ones when clear.
- For research questions: answer only from evidence in the transcript; use null when unclear.
- Agent performance rates the AI agent's behaviour on the call (not the customer).
${summaryHint}${dispHint}${answersHint}`;
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
    .leftJoin(callExecutionsTable, eq(callExecutionsTable.leadId, campaignLeadsTable.id))
    .where(sql`${campaignLeadsTable.callId} = ${callId} or ${callExecutionsTable.callId} = ${callId}`)
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
  return db.transaction(async (tx) => {
    // Serialise the select/insert pair even before the schema has a unique
    // call_id constraint. This prevents the dial-start and recovery worker from
    // creating duplicate execution rows for the same call.
    await tx.execute(sql`select pg_advisory_xact_lock(${opts.callId})`);
    const [existing] = await tx
      .select({ id: callExecutionsTable.id })
      .from(callExecutionsTable)
      .where(eq(callExecutionsTable.callId, opts.callId))
      .limit(1);
    if (existing) return existing.id;

    const [lead] = await tx
      .select({ attempts: campaignLeadsTable.callAttempts })
      .from(campaignLeadsTable)
      .where(eq(campaignLeadsTable.id, opts.leadId))
      .limit(1);
    const [inserted] = await tx
      .insert(callExecutionsTable)
      .values({
        leadId: opts.leadId,
        campaignId: opts.campaignId,
        batchId: opts.batchId,
        callId: opts.callId,
        attemptNumber: Math.max(1, lead?.attempts ?? 1),
      })
      .returning({ id: callExecutionsTable.id });
    return inserted!.id;
  });
}

/**
 * Analyse one call and persist intelligence. Returns null when skipped
 * (no transcript / not a campaign call / already analysed without force).
 */
const intelligenceInFlight = new Set<number>();

async function analyzeCallIntelligenceInternal(
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
      .select({
        sentiment: callExecutionsTable.sentiment,
        analyticsAnswers: callExecutionsTable.analyticsAnswers,
        purchaseIntentScore: callExecutionsTable.purchaseIntentScore,
      })
      .from(callExecutionsTable)
      .where(eq(callExecutionsTable.id, executionId))
      .limit(1);
    // Skip only when sentiment already set AND deep fields present AND
    // (no campaign questions OR answers already filled).
    if (row?.sentiment && row.purchaseIntentScore != null) {
      const [camp] = await db
        .select({ analyticsQuestions: campaignsTable.analyticsQuestions })
        .from(campaignsTable)
        .where(eq(campaignsTable.id, leadCtx.campaignId))
        .limit(1);
      const qs = (camp?.analyticsQuestions ?? []) as CampaignAnalyticsQuestion[];
      const answers = (row.analyticsAnswers ?? {}) as Record<string, unknown>;
      const answersMissing = qs.some((q) => answers[q.id] === undefined);
      if (qs.length === 0 || !answersMissing) {
        return null;
      }
    }
  }

  const [camp] = await db
    .select({ analyticsQuestions: campaignsTable.analyticsQuestions })
    .from(campaignsTable)
    .where(eq(campaignsTable.id, leadCtx.campaignId))
    .limit(1);
  const questions = (camp?.analyticsQuestions ?? []) as CampaignAnalyticsQuestion[];

  const chain = await getDispositionLLMChain();
  if (chain.length === 0) {
    logger.warn({ callId: input.callId }, "call-intelligence: no LLM available");
    throw new CallIntelligenceLlmError(
      "No analysis model configured. Add a managed Sarvam / OpenAI / Groq / Gemini key in platform settings.",
    );
  }

  const systemPrompt = buildIntelligencePrompt({
    callSummary: input.callSummary,
    dispositionResult: input.dispositionResult,
    questions,
  });

  const schema: Record<string, unknown> = {
    ...INTELLIGENCE_SCHEMA,
    properties: {
      ...(INTELLIGENCE_SCHEMA.properties as Record<string, unknown>),
    },
  };
  const answersSchema = buildAnswersSchema(questions);
  if (answersSchema) {
    (schema.properties as Record<string, unknown>)["answers"] = answersSchema;
    const required = Array.isArray(schema.required) ? [...schema.required] : [];
    if (!required.includes("answers")) required.push("answers");
    schema.required = required;
  }

  let raw: Record<string, unknown> | null = null;
  let lastErr: unknown = null;
  const clip = transcript.slice(0, 12_000);
  for (let idx = 0; idx < chain.length; idx++) {
    const { provider, client } = chain[idx]!;
    try {
      raw = await client.extract(systemPrompt, schema, clip);
      if (idx > 0) {
        logger.info({ callId: input.callId, provider }, "call-intelligence: succeeded on fallback provider");
      }
      break;
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableProviderError(err);
      logger.warn(
        { callId: input.callId, provider, retryable, err },
        "call-intelligence: LLM extract failed",
      );
      // Only fall through to the next provider on provider-level failures.
      if (!retryable) break;
    }
  }
  if (raw === null) {
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
    // Surface as an error so backfill reports it instead of silently "skipping".
    throw new CallIntelligenceLlmError(`Analysis model error: ${detail.slice(0, 200)}`);
  }

  const intel = normalizeIntelligence(raw, input.callSummary);
  const analyticsAnswers = normalizeAnalyticsAnswers(raw["answers"], questions);

  await db
    .update(callExecutionsTable)
    .set({
      callSummary: intel.summary,
      sentiment: intel.sentiment,
      detectedIntent: intel.detectedIntent,
      keyTopics: intel.keyTopics,
      analyticsAnswers,
      purchaseIntentScore: intel.purchaseIntentScore,
      urgency: intel.urgency,
      objections: intel.objections,
      buyingSignals: intel.buyingSignals,
      nextBestAction: intel.nextBestAction,
      emotion: intel.emotion,
      agentPerformance: intel.agentPerformance,
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
      purchaseIntentScore: intel.purchaseIntentScore,
      urgency: intel.urgency,
      emotion: intel.emotion,
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
      purchaseIntentScore: intel.purchaseIntentScore,
    },
    "call-intelligence: saved",
  );

  return intel;
}

export async function analyzeCallIntelligence(
  input: AnalyzeCallIntelligenceInput,
): Promise<CallIntelligence | null> {
  if (intelligenceInFlight.has(input.callId)) return null;
  intelligenceInFlight.add(input.callId);
  try {
    // Cross-process guard for horizontally scaled API replicas. The two-key
    // advisory-lock namespace is separate from the execution-row insert lock.
    return await db.transaction(async (tx) => {
      const lockResult = await tx.execute(sql`
        select pg_try_advisory_xact_lock(739201, ${input.callId}) as acquired
      `);
      const acquired = ((lockResult as unknown as { rows?: Array<{ acquired: boolean }> }).rows ?? [])[0]?.acquired;
      if (!acquired) return null;
      return analyzeCallIntelligenceInternal(input);
    });
  } finally {
    intelligenceInFlight.delete(input.callId);
  }
}

export interface BackfillCampaignIntelligenceResult {
  campaignId: number;
  scanned: number;
  analysed: number;
  skipped: number;
  failed: number;
  /** First error reason (e.g. model unavailable / billing) when failures occur. */
  error?: string;
  /** True when the analysis model itself is down (auth/quota/rate-limit) — every call fails identically. */
  modelDown?: boolean;
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

  // Include every execution attempt plus inbound calls matched to the campaign;
  // campaign_leads.call_id alone only points at the latest outbound attempt.
  const candidateResult = await db.execute(sql`
    with linked_calls as (
      select ce.lead_id, ce.campaign_id, ce.call_id
      from call_executions ce
      where ce.campaign_id = ${campaignId} and ce.call_id is not null
      union
      select cl.id, cl.campaign_id, cl.call_id
      from campaign_leads cl
      where cl.campaign_id = ${campaignId} and cl.call_id is not null
      union
      select ic.lead_id, ic.campaign_id, ic.call_id
      from incoming_calls ic
      where ic.campaign_id = ${campaignId}
        and ic.lead_id is not null
        and ic.call_id is not null
    )
    select distinct on (c.id)
      lc.lead_id as "leadId",
      c.id as "callId",
      c.transcript,
      c.call_summary as "callSummary",
      c.disposition_result as "dispositionResult",
      (
        select ce2.sentiment from call_executions ce2
        where ce2.call_id = c.id and ce2.sentiment is not null
        order by ce2.id desc limit 1
      ) as "existingSentiment"
    from linked_calls lc
    join calls c on c.id = lc.call_id
    where c.transcript is not null
      and length(trim(c.transcript)) >= 20
      and (
        ${opts.force === true}
        or not exists (
          select 1 from call_executions ce3
          where ce3.call_id = c.id and ce3.sentiment is not null
        )
      )
    order by c.id
    limit ${limit}
  `);
  const candidates = ((candidateResult as unknown as {
    rows?: Array<{
      leadId: number;
      callId: number;
      transcript: string | null;
      callSummary: string | null;
      dispositionResult: Record<string, unknown> | null;
      existingSentiment: string | null;
    }>;
  }).rows ?? []);

  let analysed = 0;
  let skipped = 0;
  let failed = 0;
  let firstError: string | undefined;
  // When the model itself is unavailable (missing key / billing), every call
  // will fail the same way — stop early instead of retrying hundreds of times.
  let abortAll = false;

  // Simple concurrency pool
  let i = 0;
  async function worker() {
    while (i < candidates.length && !abortAll) {
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
        if (!firstError) firstError = err instanceof Error ? err.message : String(err);
        logger.warn({ campaignId, callId: c.callId, err }, "call-intelligence backfill failed");
        // Model-level failure (no key / billing / auth) repeats for every call.
        if (err instanceof CallIntelligenceLlmError) abortAll = true;
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
    ...(firstError ? { error: firstError } : {}),
    ...(abortAll ? { modelDown: true } : {}),
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

  const pendingResult = await db.execute(sql`
    with linked_calls as (
      select ce.call_id
      from call_executions ce
      where ce.campaign_id = ${campaignId} and ce.call_id is not null
      union
      select cl.call_id
      from campaign_leads cl
      where cl.campaign_id = ${campaignId} and cl.call_id is not null
      union
      select ic.call_id
      from incoming_calls ic
      where ic.campaign_id = ${campaignId} and ic.call_id is not null
    )
    select count(distinct c.id)::int as pending
    from linked_calls lc
    join calls c on c.id = lc.call_id
    where c.transcript is not null
      and length(trim(c.transcript)) >= 20
      and not exists (
        select 1 from call_executions ce
        where ce.call_id = c.id and ce.sentiment is not null
      )
  `);
  const pendingRow = ((pendingResult as unknown as { rows?: Array<{ pending: number }> }).rows ?? [])[0];

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

const INTELLIGENCE_SWEEP_MS = 60_000;
const INTELLIGENCE_FAILURE_BACKOFF_MS = 15 * 60_000;
// Global circuit-breaker: when the analysis model itself is down (missing key /
// billing / quota / rate-limit) EVERY campaign fails identically, and each failed
// attempt burns event-loop time + opens outbound HTTP sockets — which starves
// live-call TTS/STT on the same shared dispatcher and manifests as broken/jumpy
// audio. Once we see repeated model-down outcomes, trip the breaker so the worker
// goes quiet instead of hammering every 60s across up to 10 campaigns.
const INTELLIGENCE_GLOBAL_TRIP_THRESHOLD = Math.max(
  1,
  Number(process.env.INTELLIGENCE_GLOBAL_TRIP_THRESHOLD ?? 2),
);
const INTELLIGENCE_GLOBAL_BACKOFF_MS = Math.max(
  60_000,
  Number(process.env.INTELLIGENCE_GLOBAL_BACKOFF_MS ?? 30 * 60_000),
);
let intelligenceSweepRunning = false;
let intelligenceGlobalBackoffUntil = 0;
let intelligenceConsecutiveModelDown = 0;
const campaignBackoffUntil = new Map<number, number>();

/** Recover eligible calls missed by process restarts, inbound matching, or transient LLM failures. */
export async function runPendingCallIntelligenceSweep(): Promise<void> {
  if (intelligenceSweepRunning) return;
  // Breaker open: analysis model was repeatedly down — stay quiet to protect live calls.
  if (intelligenceGlobalBackoffUntil > Date.now()) return;
  intelligenceSweepRunning = true;
  try {
    const result = await db.execute(sql`
      with pending_campaigns as (
        select ce.campaign_id
        from call_executions ce
        join calls c on c.id = ce.call_id
        where c.transcript is not null
          and length(trim(c.transcript)) >= 20
          and not exists (
            select 1 from call_executions done
            where done.call_id = c.id and done.sentiment is not null
          )
        union
        select cl.campaign_id
        from campaign_leads cl
        join calls c on c.id = cl.call_id
        where c.transcript is not null
          and length(trim(c.transcript)) >= 20
          and not exists (
            select 1 from call_executions done
            where done.call_id = c.id and done.sentiment is not null
          )
        union
        select ic.campaign_id
        from incoming_calls ic
        join calls c on c.id = ic.call_id
        where ic.campaign_id is not null
          and c.transcript is not null
          and length(trim(c.transcript)) >= 20
          and not exists (
            select 1 from call_executions done
            where done.call_id = c.id and done.sentiment is not null
          )
      )
      select distinct campaign_id as "campaignId"
      from pending_campaigns
      where campaign_id is not null
      limit 10
    `);
    const campaigns = ((result as unknown as { rows?: Array<{ campaignId: number }> }).rows ?? []);
    for (const row of campaigns) {
      // Breaker may trip mid-sweep once we detect the model is down — stop immediately.
      if (intelligenceGlobalBackoffUntil > Date.now()) break;
      const campaignId = Number(row.campaignId);
      if ((campaignBackoffUntil.get(campaignId) ?? 0) > Date.now()) continue;
      const outcome = await backfillCampaignIntelligence(campaignId, {
        limit: 50,
        concurrency: 2,
      });
      if (outcome.error) {
        campaignBackoffUntil.set(campaignId, Date.now() + INTELLIGENCE_FAILURE_BACKOFF_MS);
      } else {
        campaignBackoffUntil.delete(campaignId);
      }
      if (outcome.modelDown) {
        // Model-level failure (auth/quota/rate-limit) — repeats identically for every
        // campaign. Count consecutive occurrences and trip the global breaker so we
        // stop generating a socket/CPU storm that starves live-call audio.
        intelligenceConsecutiveModelDown++;
        if (intelligenceConsecutiveModelDown >= INTELLIGENCE_GLOBAL_TRIP_THRESHOLD) {
          intelligenceGlobalBackoffUntil = Date.now() + INTELLIGENCE_GLOBAL_BACKOFF_MS;
          logger.warn(
            {
              consecutiveModelDown: intelligenceConsecutiveModelDown,
              backoffMs: INTELLIGENCE_GLOBAL_BACKOFF_MS,
              lastError: outcome.error,
            },
            "call-intelligence: global breaker tripped — analysis model down, pausing worker to protect live-call TTS/STT",
          );
          break;
        }
      } else if (outcome.analysed > 0) {
        // Real progress — the model is healthy again; reset the breaker counter.
        intelligenceConsecutiveModelDown = 0;
      }
    }
  } catch (err) {
    logger.warn({ err }, "call-intelligence: automatic recovery sweep failed");
  } finally {
    intelligenceSweepRunning = false;
  }
}

export function startCallIntelligenceWorker(): void {
  const timer = setInterval(() => {
    void runPendingCallIntelligenceSweep();
  }, INTELLIGENCE_SWEEP_MS);
  timer.unref();
  setTimeout(() => void runPendingCallIntelligenceSweep(), 15_000).unref();
  logger.info({ intervalMs: INTELLIGENCE_SWEEP_MS }, "call-intelligence: automatic recovery worker started");
}
