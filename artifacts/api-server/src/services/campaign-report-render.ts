/**
 * Shared campaign report renderer — powers dashboard Results + Brevo HTML emails.
 */
import type {
  CampaignReportDefinition,
  ReportBlock,
} from "@workspace/db";
import { db, campaignsTable, campaignBatchesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getCampaignAnalyticsInsights, type DeepAnalyticsSnapshot } from "./campaign-analytics-insights.js";
import { platformChatText } from "./platform-chat-llm.js";
import { logger } from "../lib/logger.js";

export type RenderedReportBlock =
  | { type: "kpis"; title: string; items: Array<{ label: string; value: string | number }> }
  | { type: "dispositions"; title: string; note: string }
  | { type: "deep_sentiment"; title: string; sentiment: Array<{ label: string; count: number }>; emotion: Array<{ label: string; count: number }>; urgency: Array<{ label: string; count: number }> }
  | { type: "purchase_funnel"; title: string; buckets: Array<{ label: string; count: number }> }
  | { type: "objections"; title: string; items: Array<{ label: string; count: number }>; buyingSignals: Array<{ label: string; count: number }> }
  | { type: "agent_performance"; title: string; scores: Record<string, number | null>; sampleSize: number }
  | { type: "custom_questions"; title: string; questions: DeepAnalyticsSnapshot["questionScorecard"] }
  | { type: "hot_leads"; title: string; leads: DeepAnalyticsSnapshot["hotLeads"] }
  | { type: "nl_insight"; title: string; prompt: string; answer: string }
  | { type: "narrative"; title: string; text: string };

export interface RenderedReport {
  reportId: number;
  campaignId: number;
  campaignName: string;
  batchId: number | null;
  batchName: string | null;
  name: string;
  generatedAt: string;
  snapshot: DeepAnalyticsSnapshot;
  blocks: RenderedReportBlock[];
  html: string;
}

function kpiItems(snap: DeepAnalyticsSnapshot, metrics?: string[]) {
  const wanted = metrics?.length
    ? metrics
    : ["connected", "analysed", "purchase_intent_high", "purchase_intent_avg"];
  const map: Record<string, { label: string; value: string | number }> = {
    connected: { label: "Connected calls", value: snap.connected },
    analysed: { label: "Analysed", value: snap.analysed },
    purchase_intent_high: { label: "High purchase intent (≥70)", value: snap.purchaseIntent.high },
    purchase_intent_avg: {
      label: "Avg purchase intent",
      value: snap.purchaseIntent.avg ?? "—",
    },
    urgency_high: {
      label: "High urgency",
      value: snap.urgency.filter((u) => u.label === "high").reduce((s, u) => s + u.count, 0),
    },
    hot: { label: "Hot leads", value: snap.hotLeads.length },
  };
  return wanted.map((m) => map[m] ?? { label: m, value: "—" });
}

async function llmInsight(
  prompt: string,
  snap: DeepAnalyticsSnapshot,
  effort: "low" | "medium" = "medium",
): Promise<string> {
  try {
    const context = {
      analysed: snap.analysed,
      connected: snap.connected,
      purchaseIntent: snap.purchaseIntent,
      urgency: snap.urgency,
      emotion: snap.emotion,
      sentiment: snap.sentiment,
      topObjections: snap.topObjections.slice(0, 10),
      topBuyingSignals: snap.topBuyingSignals.slice(0, 10),
      agentPerformance: snap.agentPerformance,
      sampleSummaries: snap.sampleSummaries.slice(0, 8),
      hotLeadCount: snap.hotLeads.length,
    };
    return await platformChatText({
      system:
        "You are a campaign analytics analyst. Answer briefly and only from the provided stats and sample summaries. If evidence is thin, say so. Use plain language for a sales manager. No markdown headings.",
      messages: [
        {
          role: "user",
          content: `QUESTION:\n${prompt}\n\nSTATS JSON:\n${JSON.stringify(context)}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 800,
      model: "sarvam-105b",
      timeoutMs: 90_000,
    });
  } catch (err) {
    logger.warn({ err: String(err) }, "campaign-report: LLM insight failed");
    return "Insight unavailable — analysis model could not complete this section.";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function blockToHtml(b: RenderedReportBlock): string {
  switch (b.type) {
    case "kpis":
      return `<h3 style="margin:24px 0 8px;font-size:16px;">${escapeHtml(b.title)}</h3>
        <table style="width:100%;border-collapse:collapse;">${b.items
          .map(
            (i) =>
              `<tr><td style="padding:6px 0;color:#555;">${escapeHtml(i.label)}</td><td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(String(i.value))}</td></tr>`,
          )
          .join("")}</table>`;
    case "purchase_funnel":
      return `<h3 style="margin:24px 0 8px;font-size:16px;">${escapeHtml(b.title)}</h3>
        <ul style="padding-left:18px;margin:0;">${b.buckets
          .map((x) => `<li style="margin:4px 0;">${escapeHtml(x.label)}: <strong>${x.count}</strong></li>`)
          .join("")}</ul>`;
    case "deep_sentiment":
      return `<h3 style="margin:24px 0 8px;font-size:16px;">${escapeHtml(b.title)}</h3>
        <p style="margin:4px 0;"><strong>Sentiment:</strong> ${b.sentiment.map((s) => `${escapeHtml(s.label)} ${s.count}`).join(" · ") || "—"}</p>
        <p style="margin:4px 0;"><strong>Emotion:</strong> ${b.emotion.map((s) => `${escapeHtml(s.label)} ${s.count}`).join(" · ") || "—"}</p>
        <p style="margin:4px 0;"><strong>Urgency:</strong> ${b.urgency.map((s) => `${escapeHtml(s.label)} ${s.count}`).join(" · ") || "—"}</p>`;
    case "objections":
      return `<h3 style="margin:24px 0 8px;font-size:16px;">${escapeHtml(b.title)}</h3>
        <p style="margin:4px 0;"><strong>Objections:</strong> ${b.items.map((i) => `${escapeHtml(i.label)} (${i.count})`).join(", ") || "None captured"}</p>
        <p style="margin:4px 0;"><strong>Buying signals:</strong> ${b.buyingSignals.map((i) => `${escapeHtml(i.label)} (${i.count})`).join(", ") || "None captured"}</p>`;
    case "agent_performance":
      return `<h3 style="margin:24px 0 8px;font-size:16px;">${escapeHtml(b.title)}</h3>
        <p style="margin:4px 0;color:#666;">Sample size: ${b.sampleSize}</p>
        <ul style="padding-left:18px;">${Object.entries(b.scores)
          .map(([k, v]) => `<li>${escapeHtml(k)}: <strong>${v ?? "—"}</strong>/5</li>`)
          .join("")}</ul>`;
    case "custom_questions":
      return `<h3 style="margin:24px 0 8px;font-size:16px;">${escapeHtml(b.title)}</h3>
        ${b.questions
          .map(
            (q) =>
              `<p style="margin:8px 0 2px;"><strong>${escapeHtml(q.label)}</strong> (${q.answered} answered)</p>
               <p style="margin:0;color:#555;font-size:13px;">${q.breakdown
                 .slice(0, 6)
                 .map((x) => `${escapeHtml(x.value)}: ${x.count}`)
                 .join(" · ") || "No answers yet"}</p>`,
          )
          .join("")}`;
    case "hot_leads":
      return `<h3 style="margin:24px 0 8px;font-size:16px;">${escapeHtml(b.title)}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr style="text-align:left;border-bottom:1px solid #eee;"><th style="padding:6px 4px;">Name</th><th>Phone</th><th>Score</th><th>Intent</th></tr>
          ${b.leads
            .slice(0, 15)
            .map(
              (l) =>
                `<tr style="border-bottom:1px solid #f3f3f3;"><td style="padding:6px 4px;">${escapeHtml(l.name || "—")}</td><td>${escapeHtml(l.phone)}</td><td>${l.purchaseIntentScore ?? "—"}</td><td>${escapeHtml(l.intent || "—")}</td></tr>`,
            )
            .join("")}
        </table>`;
    case "nl_insight":
    case "narrative":
      return `<h3 style="margin:24px 0 8px;font-size:16px;">${escapeHtml(b.title)}</h3>
        <p style="margin:0;line-height:1.5;color:#333;">${escapeHtml(
          b.type === "nl_insight" ? b.answer : b.text,
        ).replace(/\n/g, "<br/>")}</p>`;
    case "dispositions":
      return `<h3 style="margin:24px 0 8px;font-size:16px;">${escapeHtml(b.title)}</h3>
        <p style="margin:0;color:#555;">${escapeHtml(b.note)}</p>`;
    default:
      return "";
  }
}

function wrapHtml(opts: {
  campaignName: string;
  reportName: string;
  batchName: string | null;
  generatedAt: string;
  body: string;
}): string {
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f6f7f9;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 32px;box-shadow:0 1px 3px rgba(0,0,0,.06);">
    <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#888;margin-bottom:4px;">SnapServe campaign report</div>
    <h1 style="margin:0 0 4px;font-size:22px;">${escapeHtml(opts.reportName)}</h1>
    <p style="margin:0 0 20px;color:#666;font-size:14px;">${escapeHtml(opts.campaignName)}${
      opts.batchName ? ` · ${escapeHtml(opts.batchName)}` : ""
    } · ${escapeHtml(opts.generatedAt)}</p>
    ${opts.body}
    <p style="margin:32px 0 0;font-size:12px;color:#999;">Generated by SnapServe analytics</p>
  </div></body></html>`;
}

async function renderBlock(
  block: ReportBlock,
  snap: DeepAnalyticsSnapshot,
): Promise<RenderedReportBlock> {
  switch (block.type) {
    case "kpis":
      return { type: "kpis", title: "Key metrics", items: kpiItems(snap, block.metrics) };
    case "dispositions":
      return {
        type: "dispositions",
        title: "Dispositions",
        note: "Open the batch workspace for live disposition breakdown and lead filters.",
      };
    case "deep_sentiment":
      return {
        type: "deep_sentiment",
        title: "Deep sentiment",
        sentiment: snap.sentiment,
        emotion: snap.emotion,
        urgency: snap.urgency,
      };
    case "purchase_funnel":
      return {
        type: "purchase_funnel",
        title: "Willingness to pay",
        buckets: [
          { label: "High (≥70)", count: snap.purchaseIntent.high },
          { label: "Medium (40–69)", count: snap.purchaseIntent.medium },
          { label: "Low (1–39)", count: snap.purchaseIntent.low },
          { label: "None / unknown", count: snap.purchaseIntent.none },
        ],
      };
    case "objections":
      return {
        type: "objections",
        title: "Objections & buying signals",
        items: snap.topObjections,
        buyingSignals: snap.topBuyingSignals,
      };
    case "agent_performance":
      return {
        type: "agent_performance",
        title: "AI agent performance",
        scores: {
          talkListenBalance: snap.agentPerformance.talkListenBalance,
          empathy: snap.agentPerformance.empathy,
          objectionHandling: snap.agentPerformance.objectionHandling,
          scriptAdherence: snap.agentPerformance.scriptAdherence,
          clarity: snap.agentPerformance.clarity,
        },
        sampleSize: snap.agentPerformance.sampleSize,
      };
    case "custom_questions": {
      const ids = block.questionIds;
      const qs = ids?.length
        ? snap.questionScorecard.filter((q) => ids.includes(q.id))
        : snap.questionScorecard;
      return { type: "custom_questions", title: "Research questions", questions: qs };
    }
    case "hot_leads": {
      const min = block.filter?.minPurchaseScore ?? 70;
      const leads = snap.hotLeads.filter(
        (l) => (l.purchaseIntentScore ?? 0) >= min || block.filter?.minPurchaseScore == null,
      );
      return { type: "hot_leads", title: "Hot leads", leads: leads.length ? leads : snap.hotLeads };
    }
    case "nl_insight": {
      const prompt = block.prompt?.trim() || "What should the team focus on from this batch?";
      const answer = await llmInsight(prompt, snap, "medium");
      return { type: "nl_insight", title: "Your question", prompt, answer };
    }
    case "narrative": {
      const text = await llmInsight(
        "Write a short executive summary (4–6 sentences) of this campaign/batch: conversion readiness, top objections, AI agent quality, and recommended next actions.",
        snap,
        "medium",
      );
      return { type: "narrative", title: "Executive summary", text };
    }
    default:
      return { type: "narrative", title: "Section", text: "Unsupported block." };
  }
}

export async function renderCampaignReport(opts: {
  definition: CampaignReportDefinition;
  batchId?: number | null;
  days?: number;
}): Promise<RenderedReport> {
  const { definition } = opts;
  const batchId = opts.batchId ?? null;

  const [campaign] = await db
    .select({ id: campaignsTable.id, name: campaignsTable.name })
    .from(campaignsTable)
    .where(eq(campaignsTable.id, definition.campaignId))
    .limit(1);

  let batchName: string | null = null;
  if (batchId != null) {
    const [batch] = await db
      .select({ name: campaignBatchesTable.name })
      .from(campaignBatchesTable)
      .where(eq(campaignBatchesTable.id, batchId))
      .limit(1);
    batchName = batch?.name ?? `Batch #${batchId}`;
  }

  const minPurchase = definition.blocks
    .map((b) => b.filter?.minPurchaseScore)
    .find((n) => typeof n === "number");

  const snapshot = await getCampaignAnalyticsInsights(definition.campaignId, {
    days: opts.days ?? 30,
    batchId,
    minPurchaseScore: minPurchase ?? 70,
  });

  const blocks: RenderedReportBlock[] = [];
  for (const b of definition.blocks) {
    blocks.push(await renderBlock(b, snapshot));
  }

  const generatedAt = new Date().toISOString();
  const html = wrapHtml({
    campaignName: campaign?.name ?? `Campaign #${definition.campaignId}`,
    reportName: definition.name,
    batchName,
    generatedAt,
    body: blocks.map(blockToHtml).join("\n"),
  });

  return {
    reportId: definition.id,
    campaignId: definition.campaignId,
    campaignName: campaign?.name ?? `Campaign #${definition.campaignId}`,
    batchId,
    batchName,
    name: definition.name,
    generatedAt,
    snapshot,
    blocks,
    html,
  };
}
