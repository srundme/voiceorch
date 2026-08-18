/**
 * Optional JSON body template for Agent Builder → Post-call notify.
 * Workspace event subscriptions always get the default SnapServe payload.
 */

import { createHmac } from "crypto";

export const WEBHOOK_PAYLOAD_HEADER = "X-SnapServe-Payload";
export const MAX_WEBHOOK_PAYLOAD_TEMPLATE_CHARS = 32_000;

const QUOTED_TOKEN = /"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}"/g;
const ANY_TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const BLOCKED_PATH_PARTS = new Set(["__proto__", "constructor", "prototype"]);

export type WebhookBodyMode = "custom" | "default";

export type SerializedWebhookBody = {
  bodyStr: string;
  mode: WebhookBodyMode;
  error?: string;
};

function snakeToCamel(part: string): string {
  return part.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function getByPath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0 || parts.some((p) => BLOCKED_PATH_PARTS.has(p))) return undefined;
  let cur: unknown = root;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    const rec = cur as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rec, part)) {
      cur = rec[part];
      continue;
    }
    const camel = snakeToCamel(part);
    if (camel !== part && Object.prototype.hasOwnProperty.call(rec, camel)) {
      cur = rec[camel];
      continue;
    }
    return undefined;
  }
  return cur;
}

function resolveToken(payload: Record<string, unknown>, path: string): unknown {
  const value = getByPath(payload, path);
  return value === undefined ? null : value;
}

function escapeJsonStringContents(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function interpolateInsideString(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return escapeJsonStringContents(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return escapeJsonStringContents(JSON.stringify(value));
}

function isInsideJsonString(src: string, index: number): boolean {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < index; i++) {
    const c = src[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    }
  }
  return inString;
}

export function readWebhookPayloadTemplate(agentConfig: unknown): string | null {
  if (!agentConfig || typeof agentConfig !== "object") return null;
  const raw = (agentConfig as Record<string, unknown>)["webhookPayloadTemplate"];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/**
 * Render a JSON template against the default call-ended payload.
 * `"{{path}}"` as a whole JSON string becomes a typed JSON value (objects nest,
 * numbers stay numbers). `{{path}}` inside a larger string is interpolated.
 * Missing paths become `null`. Snake_case aliases map to camelCase payload keys.
 */
export function renderWebhookPayloadTemplate(
  template: string,
  payload: Record<string, unknown>,
): { body: unknown } | { error: string } {
  if (template.length > MAX_WEBHOOK_PAYLOAD_TEMPLATE_CHARS) {
    return { error: "template_too_large" };
  }

  let rendered = template.replace(QUOTED_TOKEN, (_full, path: string) =>
    JSON.stringify(resolveToken(payload, path)),
  );

  rendered = rendered.replace(ANY_TOKEN, (full, path: string, offset: number) => {
    const value = resolveToken(payload, path);
    if (isInsideJsonString(rendered, offset)) return interpolateInsideString(value);
    return JSON.stringify(value);
  });

  try {
    return { body: JSON.parse(rendered) };
  } catch {
    return { error: "invalid_json" };
  }
}

/** Body actually POSTed to the agent notify URL. HMAC must sign this string. */
export function serializeAgentWebhookBody(
  template: string | null | undefined,
  payload: Record<string, unknown>,
): SerializedWebhookBody {
  const trimmed = typeof template === "string" ? template.trim() : "";
  if (!trimmed) {
    return { bodyStr: JSON.stringify(payload), mode: "default" };
  }
  const rendered = renderWebhookPayloadTemplate(trimmed, payload);
  if ("error" in rendered) {
    return { bodyStr: JSON.stringify(payload), mode: "default", error: rendered.error };
  }
  return { bodyStr: JSON.stringify(rendered.body), mode: "custom" };
}

/** HMAC signs the body actually POSTed. */
export function buildAgentNotifyHeaders(
  bodyStr: string,
  mode: WebhookBodyMode,
  secret?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [WEBHOOK_PAYLOAD_HEADER]: mode,
  };
  const trimmed = typeof secret === "string" ? secret.trim() : "";
  if (trimmed) {
    const sig = "sha256=" + createHmac("sha256", trimmed).update(bodyStr, "utf8").digest("hex");
    headers["X-VoiceOrch-Signature"] = sig;
    headers["X-SnapServe-Signature"] = sig;
  }
  return headers;
}
