/**
 * Campaign analytics insights: trends, hot leads, custom-question scorecard.
 */
import {
  db,
  callExecutionsTable,
  campaignLeadsTable,
  campaignsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { CampaignAnalyticsQuestion } from "./call-intelligence-answers.js";

export async function getCampaignAnalyticsInsights(
  campaignId: number,
  opts: { days?: number } = {},
): Promise<{
  days: number;
  sentimentTrend: Array<{ date: string; positive: number; neutral: number; negative: number; total: number }>;
  intentTrend: Array<{ date: string; intent: string; count: number }>;
  questionScorecard: Array<{
    id: string;
    label: string;
    type: string;
    answered: number;
    breakdown: Array<{ value: string; count: number }>;
  }>;
  hotLeads: Array<{
    leadId: number;
    /** The lead's own campaign — the lead profile route validates against this. */
    campaignId: number;
    callId: number | null;
    name: string | null;
    phone: string;
    sentiment: string | null;
    intent: string | null;
    summary: string | null;
    topics: string[];
    answers: Record<string, string | boolean | null>;
    at: string;
  }>;
  questions: CampaignAnalyticsQuestion[];
}> {
  const days = Math.min(Math.max(opts.days ?? 14, 1), 90);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const [campaign] = await db
    .select({
      analyticsQuestions: campaignsTable.analyticsQuestions,
    })
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId))
    .limit(1);
  const questions = (campaign?.analyticsQuestions ?? []) as CampaignAnalyticsQuestion[];

  // Sentiment by day
  const sentimentRaw = await db.execute(sql`
    select
      to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
      sentiment,
      count(*)::int as cnt
    from call_executions
    where campaign_id = ${campaignId}
      and sentiment is not null
      and created_at >= ${since}
    group by 1, 2
    order by 1
  `);
  const sentimentRows = ((sentimentRaw as unknown as { rows?: Array<{ day: string; sentiment: string; cnt: number }> }).rows ?? []);

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
  // Fill missing days in range for a continuous chart
  const sentimentTrend: Array<{ date: string; positive: number; neutral: number; negative: number; total: number }> = [];
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
      and detected_intent is not null
      and created_at >= ${since}
    group by 1, 2
    order by 1, 3 desc
  `);
  const intentTrend = ((intentRaw as unknown as { rows?: Array<{ day: string; intent: string; cnt: number }> }).rows ?? [])
    .map((r) => ({ date: r.day, intent: r.intent, count: Number(r.cnt) }));

  // Question scorecard — expand jsonb answers
  const questionScorecard: Array<{
    id: string;
    label: string;
    type: string;
    answered: number;
    breakdown: Array<{ value: string; count: number }>;
  }> = [];

  for (const q of questions) {
    const ansRaw = await db.execute(sql`
      select
        coalesce(analytics_answers->>${q.id}, '') as val,
        count(*)::int as cnt
      from call_executions
      where campaign_id = ${campaignId}
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

  const hotExecs = await db
    .select({
      leadId: callExecutionsTable.leadId,
      callId: callExecutionsTable.callId,
      sentiment: callExecutionsTable.sentiment,
      intent: callExecutionsTable.detectedIntent,
      summary: callExecutionsTable.callSummary,
      topics: callExecutionsTable.keyTopics,
      answers: callExecutionsTable.analyticsAnswers,
      at: callExecutionsTable.createdAt,
      name: campaignLeadsTable.name,
      phone: campaignLeadsTable.phone,
      leadCampaignId: campaignLeadsTable.campaignId,
    })
    .from(callExecutionsTable)
    .innerJoin(campaignLeadsTable, eq(callExecutionsTable.leadId, campaignLeadsTable.id))
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
        isNotNull(callExecutionsTable.callId),
      ),
    )
    .orderBy(desc(callExecutionsTable.createdAt))
    .limit(40);

  return {
    days,
    sentimentTrend,
    intentTrend,
    questionScorecard,
    hotLeads: hotExecs.map((h) => ({
      leadId: h.leadId,
      // Link against the lead's own campaign; the execution row's campaign_id
      // can differ (re-campaigned leads / backfills), which 404s the profile.
      campaignId: h.leadCampaignId ?? campaignId,
      callId: h.callId,
      name: h.name,
      phone: h.phone,
      sentiment: h.sentiment,
      intent: h.intent,
      summary: h.summary,
      topics: Array.isArray(h.topics) ? h.topics : [],
      answers: (h.answers ?? {}) as Record<string, string | boolean | null>,
      at: h.at.toISOString(),
    })),
    questions,
  };
}
