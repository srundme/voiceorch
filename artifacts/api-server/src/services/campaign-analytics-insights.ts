/**
 * Campaign / batch deep analytics aggregations for the report renderer and UI.
 */
import {
  db,
  callExecutionsTable,
  campaignLeadsTable,
  campaignsTable,
} from "@workspace/db";
import { and, desc, eq, gte, isNotNull, sql, type SQL } from "drizzle-orm";
import type { CampaignAnalyticsQuestion } from "./call-intelligence-answers.js";

export interface DeepAnalyticsSnapshot {
  days: number;
  batchId: number | null;
  analysed: number;
  connected: number;
  purchaseIntent: {
    avg: number | null;
    high: number; // score >= 70
    medium: number; // 40–69
    low: number; // 1–39
    none: number; // 0 or null among analysed
  };
  urgency: Array<{ label: string; count: number }>;
  emotion: Array<{ label: string; count: number }>;
  sentiment: Array<{ label: string; count: number }>;
  sentimentTrend: Array<{ date: string; positive: number; neutral: number; negative: number; total: number }>;
  intentTrend: Array<{ date: string; intent: string; count: number }>;
  topObjections: Array<{ label: string; count: number }>;
  topBuyingSignals: Array<{ label: string; count: number }>;
  agentPerformance: {
    talkListenBalance: number | null;
    empathy: number | null;
    objectionHandling: number | null;
    scriptAdherence: number | null;
    clarity: number | null;
    sampleSize: number;
  };
  questionScorecard: Array<{
    id: string;
    label: string;
    type: string;
    answered: number;
    breakdown: Array<{ value: string; count: number }>;
  }>;
  hotLeads: Array<{
    leadId: number;
    campaignId: number;
    callId: number | null;
    name: string | null;
    phone: string;
    sentiment: string | null;
    intent: string | null;
    summary: string | null;
    topics: string[];
    purchaseIntentScore: number | null;
    urgency: string | null;
    emotion: string | null;
    nextBestAction: string | null;
    answers: Record<string, string | boolean | null>;
    at: string;
  }>;
  sampleSummaries: string[];
  questions: CampaignAnalyticsQuestion[];
}

function scopeWhere(campaignId: number, batchId: number | null | undefined, since: Date): SQL {
  if (batchId != null) {
    return and(
      eq(callExecutionsTable.campaignId, campaignId),
      eq(callExecutionsTable.batchId, batchId),
    )!;
  }
  return and(
    eq(callExecutionsTable.campaignId, campaignId),
    gte(callExecutionsTable.createdAt, since),
  )!;
}

async function countJsonArrayItems(
  campaignId: number,
  batchId: number | null | undefined,
  since: Date,
  column: "objections" | "buying_signals",
): Promise<Array<{ label: string; count: number }>> {
  const batchClause = batchId != null ? sql`and batch_id = ${batchId}` : sql`and created_at >= ${since}`;
  const raw = await db.execute(sql`
    select trim(elem) as label, count(*)::int as cnt
    from call_executions,
      lateral jsonb_array_elements_text(coalesce(${sql.raw(column)}, '[]'::jsonb)) as elem
    where campaign_id = ${campaignId}
      ${batchClause}
      and trim(elem) <> ''
    group by 1
    order by 2 desc
    limit 20
  `);
  return ((raw as unknown as { rows?: Array<{ label: string; cnt: number }> }).rows ?? [])
    .map((r) => ({ label: r.label, count: Number(r.cnt) }));
}

export async function getCampaignAnalyticsInsights(
  campaignId: number,
  opts: { days?: number; batchId?: number | null; minPurchaseScore?: number } = {},
): Promise<DeepAnalyticsSnapshot> {
  const days = Math.min(Math.max(opts.days ?? 14, 1), 90);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const batchId = opts.batchId ?? null;
  const minPurchase = opts.minPurchaseScore ?? 70;

  const [campaign] = await db
    .select({ analyticsQuestions: campaignsTable.analyticsQuestions })
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId))
    .limit(1);
  const questions = (campaign?.analyticsQuestions ?? []) as CampaignAnalyticsQuestion[];

  const where = scopeWhere(campaignId, batchId, since);

  const [totals] = await db
    .select({
      analysed: sql<number>`count(*) filter (where ${callExecutionsTable.sentiment} is not null)::int`,
      connected: sql<number>`count(*) filter (where ${callExecutionsTable.callId} is not null)::int`,
      avgPurchase: sql<number | null>`avg(${callExecutionsTable.purchaseIntentScore}) filter (where ${callExecutionsTable.purchaseIntentScore} is not null)`,
      high: sql<number>`count(*) filter (where ${callExecutionsTable.purchaseIntentScore} >= 70)::int`,
      medium: sql<number>`count(*) filter (where ${callExecutionsTable.purchaseIntentScore} >= 40 and ${callExecutionsTable.purchaseIntentScore} < 70)::int`,
      low: sql<number>`count(*) filter (where ${callExecutionsTable.purchaseIntentScore} >= 1 and ${callExecutionsTable.purchaseIntentScore} < 40)::int`,
      none: sql<number>`count(*) filter (where ${callExecutionsTable.sentiment} is not null and (${callExecutionsTable.purchaseIntentScore} is null or ${callExecutionsTable.purchaseIntentScore} = 0))::int`,
    })
    .from(callExecutionsTable)
    .where(where);

  const urgencyRaw = await db
    .select({
      label: callExecutionsTable.urgency,
      count: sql<number>`count(*)::int`,
    })
    .from(callExecutionsTable)
    .where(and(where, isNotNull(callExecutionsTable.urgency)))
    .groupBy(callExecutionsTable.urgency);

  const emotionRaw = await db
    .select({
      label: callExecutionsTable.emotion,
      count: sql<number>`count(*)::int`,
    })
    .from(callExecutionsTable)
    .where(and(where, isNotNull(callExecutionsTable.emotion)))
    .groupBy(callExecutionsTable.emotion);

  const sentimentRawCounts = await db
    .select({
      label: callExecutionsTable.sentiment,
      count: sql<number>`count(*)::int`,
    })
    .from(callExecutionsTable)
    .where(and(where, isNotNull(callExecutionsTable.sentiment)))
    .groupBy(callExecutionsTable.sentiment);

  // Sentiment by day (campaign date range; for batch use all batch rows)
  const sentimentDayRaw = await db.execute(sql`
    select
      to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
      sentiment,
      count(*)::int as cnt
    from call_executions
    where campaign_id = ${campaignId}
      ${batchId != null ? sql`and batch_id = ${batchId}` : sql`and created_at >= ${since}`}
      and sentiment is not null
    group by 1, 2
    order by 1
  `);
  const sentimentRows = ((sentimentDayRaw as unknown as { rows?: Array<{ day: string; sentiment: string; cnt: number }> }).rows ?? []);
  const byDay = new Map<string, { positive: number; neutral: number; negative: number; total: number }>();
  for (const r of sentimentRows) {
    const cur = byDay.get(r.day) ?? { positive: 0, neutral: 0, negative: 0, total: 0 };
    const n = Number(r.cnt);
    if (r.sentiment === "positive") cur.positive += n;
    else if (r.sentiment === "negative") cur.negative += n;
    else cur.neutral += n;
    cur.total += n;
    byDay.set(r.day, cur);
  }
  const sentimentTrend: DeepAnalyticsSnapshot["sentimentTrend"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const cur = byDay.get(key) ?? { positive: 0, neutral: 0, negative: 0, total: 0 };
    sentimentTrend.push({ date: key, ...cur });
  }

  const intentRaw = await db.execute(sql`
    select
      to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
      detected_intent as intent,
      count(*)::int as cnt
    from call_executions
    where campaign_id = ${campaignId}
      ${batchId != null ? sql`and batch_id = ${batchId}` : sql`and created_at >= ${since}`}
      and detected_intent is not null
    group by 1, 2
    order by 1, 3 desc
  `);
  const intentTrend = ((intentRaw as unknown as { rows?: Array<{ day: string; intent: string; cnt: number }> }).rows ?? [])
    .map((r) => ({ date: r.day, intent: r.intent, count: Number(r.cnt) }));

  const topObjections = await countJsonArrayItems(campaignId, batchId, since, "objections");
  const topBuyingSignals = await countJsonArrayItems(campaignId, batchId, since, "buying_signals");

  const [agentAvg] = await db
    .select({
      talkListenBalance: sql<number | null>`avg((agent_performance->>'talkListenBalance')::numeric)`,
      empathy: sql<number | null>`avg((agent_performance->>'empathy')::numeric)`,
      objectionHandling: sql<number | null>`avg((agent_performance->>'objectionHandling')::numeric)`,
      scriptAdherence: sql<number | null>`avg((agent_performance->>'scriptAdherence')::numeric)`,
      clarity: sql<number | null>`avg((agent_performance->>'clarity')::numeric)`,
      sampleSize: sql<number>`count(*) filter (where agent_performance is not null)::int`,
    })
    .from(callExecutionsTable)
    .where(where);

  const questionScorecard: DeepAnalyticsSnapshot["questionScorecard"] = [];
  for (const q of questions) {
    const ansRaw = await db.execute(sql`
      select
        coalesce(analytics_answers->>${q.id}, '') as val,
        count(*)::int as cnt
      from call_executions
      where campaign_id = ${campaignId}
        ${batchId != null ? sql`and batch_id = ${batchId}` : sql`and created_at >= ${since}`}
        and analytics_answers ? ${q.id}
        and analytics_answers->>${q.id} is not null
        and analytics_answers->>${q.id} <> ''
        and analytics_answers->>${q.id} <> 'null'
      group by 1
      order by 2 desc
      limit 20
    `);
    const rows = ((ansRaw as unknown as { rows?: Array<{ val: string; cnt: number }> }).rows ?? []);
    const breakdown = rows.map((r) => ({ value: r.val, count: Number(r.cnt) }));
    questionScorecard.push({
      id: q.id,
      label: q.label,
      type: q.type,
      answered: breakdown.reduce((s, b) => s + b.count, 0),
      breakdown,
    });
  }

  const hotWhere = and(
    where,
    isNotNull(callExecutionsTable.callId),
    sql`(${callExecutionsTable.purchaseIntentScore} >= ${minPurchase}
      or (${callExecutionsTable.sentiment} = 'positive'
        and ${callExecutionsTable.detectedIntent} in ('interested','callback_requested','booked','needs_info')))`,
  );

  const hotExecs = await db
    .select({
      leadId: callExecutionsTable.leadId,
      callId: callExecutionsTable.callId,
      sentiment: callExecutionsTable.sentiment,
      intent: callExecutionsTable.detectedIntent,
      summary: callExecutionsTable.callSummary,
      topics: callExecutionsTable.keyTopics,
      answers: callExecutionsTable.analyticsAnswers,
      purchaseIntentScore: callExecutionsTable.purchaseIntentScore,
      urgency: callExecutionsTable.urgency,
      emotion: callExecutionsTable.emotion,
      nextBestAction: callExecutionsTable.nextBestAction,
      at: callExecutionsTable.createdAt,
      name: campaignLeadsTable.name,
      phone: campaignLeadsTable.phone,
      leadCampaignId: campaignLeadsTable.campaignId,
    })
    .from(callExecutionsTable)
    .innerJoin(campaignLeadsTable, eq(callExecutionsTable.leadId, campaignLeadsTable.id))
    .where(hotWhere)
    .orderBy(desc(callExecutionsTable.purchaseIntentScore), desc(callExecutionsTable.createdAt))
    .limit(40);

  const sampleRows = await db
    .select({ summary: callExecutionsTable.callSummary })
    .from(callExecutionsTable)
    .where(and(where, isNotNull(callExecutionsTable.callSummary)))
    .orderBy(desc(callExecutionsTable.purchaseIntentScore), desc(callExecutionsTable.createdAt))
    .limit(12);

  const roundAvg = (v: number | null | undefined) =>
    v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10;

  return {
    days,
    batchId,
    analysed: Number(totals?.analysed ?? 0),
    connected: Number(totals?.connected ?? 0),
    purchaseIntent: {
      avg: roundAvg(totals?.avgPurchase as number | null),
      high: Number(totals?.high ?? 0),
      medium: Number(totals?.medium ?? 0),
      low: Number(totals?.low ?? 0),
      none: Number(totals?.none ?? 0),
    },
    urgency: urgencyRaw
      .filter((r) => r.label)
      .map((r) => ({ label: r.label!, count: Number(r.count) })),
    emotion: emotionRaw
      .filter((r) => r.label)
      .map((r) => ({ label: r.label!, count: Number(r.count) })),
    sentiment: sentimentRawCounts
      .filter((r) => r.label)
      .map((r) => ({ label: r.label!, count: Number(r.count) })),
    sentimentTrend,
    intentTrend,
    topObjections,
    topBuyingSignals,
    agentPerformance: {
      talkListenBalance: roundAvg(agentAvg?.talkListenBalance as number | null),
      empathy: roundAvg(agentAvg?.empathy as number | null),
      objectionHandling: roundAvg(agentAvg?.objectionHandling as number | null),
      scriptAdherence: roundAvg(agentAvg?.scriptAdherence as number | null),
      clarity: roundAvg(agentAvg?.clarity as number | null),
      sampleSize: Number(agentAvg?.sampleSize ?? 0),
    },
    questionScorecard,
    hotLeads: hotExecs.map((h) => ({
      leadId: h.leadId,
      campaignId: h.leadCampaignId ?? campaignId,
      callId: h.callId,
      name: h.name,
      phone: h.phone,
      sentiment: h.sentiment,
      intent: h.intent,
      summary: h.summary,
      topics: Array.isArray(h.topics) ? h.topics : [],
      purchaseIntentScore: h.purchaseIntentScore,
      urgency: h.urgency,
      emotion: h.emotion,
      nextBestAction: h.nextBestAction,
      answers: (h.answers ?? {}) as Record<string, string | boolean | null>,
      at: h.at.toISOString(),
    })),
    sampleSummaries: sampleRows
      .map((r) => (r.summary ?? "").trim())
      .filter(Boolean)
      .slice(0, 10),
    questions,
  };
}
