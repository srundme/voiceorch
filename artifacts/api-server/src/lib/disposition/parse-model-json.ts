/** Sarvam sometimes wraps the object in a fence or puts it after reasoning. */
export function parseDispositionModelJson(raw: string): Record<string, unknown> {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  const tryParse = (value: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  };
  const direct = tryParse(body);
  if (direct) return direct;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = tryParse(body.slice(start, end + 1));
    if (sliced) return sliced;
  }
  throw new Error("disposition json parse failed");
}
