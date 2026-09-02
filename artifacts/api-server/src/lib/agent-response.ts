/**
 * Dashboard agent list/get responses are Zod-strict. One bad stored field
 * used to 500 GET /agents and blank the Agents page for the whole workspace.
 */

export const ASR_SMART_ENDPOINTING_VALUES = ["off", "vapi", "livekit"] as const;
export type AsrSmartEndpointing = (typeof ASR_SMART_ENDPOINTING_VALUES)[number];

const ENABLED_ALIASES = new Set(["on", "true", "1", "enabled", "yes"]);
const DISABLED_ALIASES = new Set(["off", "false", "0", "disabled", "no", ""]);

export function normalizeAsrSmartEndpointing(value: unknown): AsrSmartEndpointing {
  if (value == null) return "off";
  const raw = String(value).trim().toLowerCase();
  if (raw === "vapi" || raw === "livekit" || raw === "off") return raw;
  if (ENABLED_ALIASES.has(raw)) return "vapi";
  if (DISABLED_ALIASES.has(raw)) return "off";
  return "off";
}

export function applyAsrSmartEndpointing(data: Record<string, unknown>): void {
  if (!("asrSmartEndpointing" in data)) return;
  data["asrSmartEndpointing"] = normalizeAsrSmartEndpointing(data["asrSmartEndpointing"]);
}
