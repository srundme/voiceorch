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
