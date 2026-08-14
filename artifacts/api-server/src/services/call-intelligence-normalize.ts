export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const INTENTS = [
  "interested",
  "not_interested",
  "callback_requested",
  "booked",
  "transferred",
  "needs_info",
  "complaint",
  "dnc",
  "wrong_person",
  "no_decision",
  "voicemail_or_no_talk",
] as const;
export type DetectedIntent = (typeof INTENTS)[number];

export const URGENCIES = ["none", "low", "medium", "high"] as const;
export type Urgency = (typeof URGENCIES)[number];

export const EMOTIONS = [
  "frustrated",
  "curious",
  "enthusiastic",
  "skeptical",
  "confused",
  "calm",
  "anxious",
  "annoyed",
  "friendly",
  "indifferent",
] as const;
export type Emotion = (typeof EMOTIONS)[number];

export interface AgentPerformanceScores {
  talkListenBalance: number | null;
  empathy: number | null;
  objectionHandling: number | null;
  scriptAdherence: number | null;
  clarity: number | null;
  notes: string | null;
}

export interface CallIntelligence {
  sentiment: Sentiment;
  detectedIntent: DetectedIntent;
  keyTopics: string[];
  summary: string | null;
  purchaseIntentScore: number | null;
  urgency: Urgency | null;
  objections: string[];
  buyingSignals: string[];
  nextBestAction: string | null;
  emotion: Emotion | null;
  agentPerformance: AgentPerformanceScores | null;
}

function clampScore(n: unknown): number | null {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function clamp1to5(n: unknown): number | null {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(1, Math.min(5, Math.round(v)));
}

function stringList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeAgentPerformance(raw: unknown): AgentPerformanceScores | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const notes =
    typeof o["notes"] === "string" && o["notes"].trim()
      ? o["notes"].trim().slice(0, 500)
      : null;
  return {
    talkListenBalance: clamp1to5(o["talkListenBalance"]),
    empathy: clamp1to5(o["empathy"]),
    objectionHandling: clamp1to5(o["objectionHandling"]),
    scriptAdherence: clamp1to5(o["scriptAdherence"]),
    clarity: clamp1to5(o["clarity"]),
    notes,
  };
}

export function normalizeIntelligence(
  raw: Record<string, unknown>,
  fallbackSummary?: string | null,
): CallIntelligence {
  const sentimentRaw = String(raw["sentiment"] ?? "neutral").toLowerCase().trim();
  const sentiment: Sentiment = (SENTIMENTS as readonly string[]).includes(sentimentRaw)
    ? (sentimentRaw as Sentiment)
    : "neutral";

  const intentRaw = String(raw["detectedIntent"] ?? raw["intent"] ?? "no_decision")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  const detectedIntent: DetectedIntent = (INTENTS as readonly string[]).includes(intentRaw)
    ? (intentRaw as DetectedIntent)
    : "no_decision";

  const topicsRaw = raw["keyTopics"] ?? raw["topics"];
  const keyTopics = stringList(topicsRaw, 6);

  const summaryRaw = raw["summary"];
  const summary =
    typeof summaryRaw === "string" && summaryRaw.trim()
      ? summaryRaw.trim().slice(0, 2000)
      : fallbackSummary?.trim() || null;

  const urgencyRaw = String(raw["urgency"] ?? "none").toLowerCase().trim();
  const urgency: Urgency = (URGENCIES as readonly string[]).includes(urgencyRaw)
    ? (urgencyRaw as Urgency)
    : "none";

  const emotionRaw = String(raw["emotion"] ?? "").toLowerCase().trim();
  const emotion: Emotion | null = (EMOTIONS as readonly string[]).includes(emotionRaw)
    ? (emotionRaw as Emotion)
    : null;

  const nextRaw = raw["nextBestAction"] ?? raw["next_best_action"];
  const nextBestAction =
    typeof nextRaw === "string" && nextRaw.trim() ? nextRaw.trim().slice(0, 300) : null;

  return {
    sentiment,
    detectedIntent,
    keyTopics,
    summary,
    purchaseIntentScore: clampScore(raw["purchaseIntentScore"] ?? raw["purchase_intent_score"]),
    urgency,
    objections: stringList(raw["objections"], 5),
    buyingSignals: stringList(raw["buyingSignals"] ?? raw["buying_signals"], 5),
    nextBestAction,
    emotion,
    agentPerformance: normalizeAgentPerformance(raw["agentPerformance"] ?? raw["agent_performance"]),
  };
}
