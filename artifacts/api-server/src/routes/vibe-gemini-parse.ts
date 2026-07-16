export interface GeminiVibeResponse {
  reply:  string;
  phase:  string;
  ready:  boolean;
  config: Record<string, unknown> | null;
}

function stripCodeFences(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  }
  return t;
}

function extractJsonObjectText(raw: string): string {
  const t = stripCodeFences(raw);
  if (t.startsWith("{")) return t;
  const match = t.match(/\{[\s\S]*\}/);
  return match?.[0] ?? t;
}

/** Best-effort parse for Gemini JSON output — tolerates fences and leading/trailing prose. */
export function parseVibeGeminiJson(raw: string): GeminiVibeResponse | null {
  const candidates = [stripCodeFences(raw), extractJsonObjectText(raw)];
  for (const text of [...new Set(candidates)]) {
    if (!text.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(text) as Partial<GeminiVibeResponse>;
      if (typeof parsed.reply !== "string" || !parsed.reply.trim()) continue;
      return {
        reply:  parsed.reply.trim(),
        phase:  typeof parsed.phase === "string" ? parsed.phase : "core",
        ready:  !!parsed.ready,
        config: parsed.config && typeof parsed.config === "object"
          ? parsed.config as Record<string, unknown>
          : null,
      };
    } catch { /* try next candidate */ }
  }
  return null;
}

export function extractGeminiResponseText(parts: Array<{ text?: string; thought?: boolean }>): string {
  const withText = parts.filter(p => typeof p.text === "string" && p.text!.length > 0);
  const visible  = withText.filter(p => !p.thought).map(p => p.text!).join("");
  if (visible.trim()) return visible;
  return withText.map(p => p.text!).join("");
}

/** Detect in-chat voice card picks from the dashboard Select message. */
export function parseVoicePick(text: string): { voiceId?: string; voiceName?: string } | null {
  const withId = text.match(/i'?ll go with\s+(.+?)\s*\(\s*voiceId\s*:\s*([^)]+?)\s*\)/i);
  if (withId) {
    return { voiceName: withId[1]!.trim(), voiceId: withId[2]!.trim() };
  }
  if (/i'?ll go with\s+/i.test(text)) {
    const m = text.match(/i'?ll go with\s+([^(.\n]+)/i);
    return m?.[1] ? { voiceName: m[1].trim() } : { voiceName: undefined };
  }
  return null;
}

export function looksLikePhoneAssign(text: string): boolean {
  return /^\s*assign\s+/i.test(text) || /\(\s*number id\s+\d+\s*\)/i.test(text);
}

export function looksLikePhoneSkip(text: string): boolean {
  return /skip the phone number/i.test(text);
}

export function replyAsksCallFlow(reply: string): boolean {
  return /walk me through|how should .+ handle|call (flow|script)|opening|main pitch/i.test(reply);
}
