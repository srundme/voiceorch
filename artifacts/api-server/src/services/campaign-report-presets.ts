/**
 * Preset report templates for the campaign analytics report builder.
 */
import type { ReportBlock } from "@workspace/db";

export type ReportPreset = {
  id: string;
  name: string;
  description: string;
  scope: "campaign" | "batch";
  blocks: ReportBlock[];
};

export const REPORT_PRESETS: ReportPreset[] = [
  {
    id: "sales_conversion",
    name: "Sales conversion",
    description: "Disposition funnel, purchase intent, hot leads, and a narrative summary.",
    scope: "batch",
    blocks: [
      { type: "kpis", metrics: ["connected", "purchase_intent_high", "analysed", "hot"] },
      { type: "dispositions" },
      { type: "purchase_funnel" },
      { type: "hot_leads", filter: { minPurchaseScore: 70 } },
      { type: "narrative" },
    ],
  },
  {
    id: "willingness_to_pay",
    name: "Willingness to pay",
    description: "How many leads seem ready to buy, urgency, and buying signals.",
    scope: "batch",
    blocks: [
      { type: "kpis", metrics: ["purchase_intent_high", "purchase_intent_avg", "urgency_high"] },
      { type: "purchase_funnel" },
      { type: "hot_leads", filter: { minPurchaseScore: 60 } },
      {
        type: "nl_insight",
        prompt: "How many leads in this batch seem really interested to pay for the service, and why?",
      },
      { type: "narrative" },
    ],
  },
  {
    id: "ai_call_quality",
    name: "AI call quality / coaching",
    description: "How the AI agent performed: empathy, clarity, objection handling.",
    scope: "batch",
    blocks: [
      { type: "agent_performance" },
      { type: "deep_sentiment" },
      { type: "objections" },
      {
        type: "nl_insight",
        prompt: "Where did the AI agent struggle on these calls, and what should we improve in the script?",
      },
      { type: "narrative" },
    ],
  },
  {
    id: "objection_map",
    name: "Objection map",
    description: "Top objections, sentiment, and recommended next actions.",
    scope: "batch",
    blocks: [
      { type: "objections" },
      { type: "deep_sentiment" },
      { type: "dispositions" },
      {
        type: "nl_insight",
        prompt: "What are the top objections and how should the sales team respond?",
      },
    ],
  },
  {
    id: "blank",
    name: "Custom blank",
    description: "Start empty and add the blocks you need.",
    scope: "campaign",
    blocks: [{ type: "kpis", metrics: ["connected", "analysed"] }],
  },
];
