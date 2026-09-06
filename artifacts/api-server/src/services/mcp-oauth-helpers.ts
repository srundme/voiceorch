/** Pure helpers for the MCP OAuth authorize page. No DB imports — unit testable. */

/** `sk_live_` + 64 hex. */
const API_KEY_LENGTH = 72;
const MASK_CHARS = /[•·*×…]/;

/**
 * Explain why a pasted value cannot be a SnapServe API key, or null when the
 * shape is valid. Hash lookup still decides whether the key actually exists.
 */
export function describeApiKeyShapeError(raw: string): string | null {
  const key = raw.trim();
  if (!key) return "Paste an API key to continue.";

  if (MASK_CHARS.test(key)) {
    return "That is the masked preview from the API Keys list, not a key. "
      + "The full key is shown only once, right after you create it — use New Key and copy it from the reveal box.";
  }

  if (!key.startsWith("sk_live_")) {
    return "SnapServe keys start with sk_live_. Copy the key from Dashboard → API Keys.";
  }

  const secret = key.slice("sk_live_".length);
  if (!/^[0-9a-f]+$/.test(secret)) {
    return "This key contains characters we never generate. Copy it again from the reveal box shown when the key was created.";
  }
  if (key.length !== API_KEY_LENGTH) {
    return `This key is ${key.length} characters; a SnapServe key is ${API_KEY_LENGTH}. It looks truncated — copy the whole key.`;
  }

  return null;
}
