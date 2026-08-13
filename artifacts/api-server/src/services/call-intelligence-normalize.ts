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

export interface CallIntelligence {
  sentiment: Sentiment;
  detectedIntent: DetectedIntent;
  keyTopics: string[];
  summary: string | null;
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
  const keyTopics = Array.isArray(topicsRaw)
    ? topicsRaw
        .map((t) => String(t ?? "").trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];

  const summaryRaw = raw["summary"];
  const summary =
    typeof summaryRaw === "string" && summaryRaw.trim()
      ? summaryRaw.trim().slice(0, 2000)
      : fallbackSummary?.trim() || null;

  return { sentiment, detectedIntent, keyTopics, summary };
}
