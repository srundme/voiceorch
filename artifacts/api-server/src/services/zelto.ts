import { db } from "@workspace/db";
import { platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const ZELTO_BASE_URL = "https://api.zelto.ai/v1";

// ── Key resolution ─────────────────────────────────────────────────────────────
// Reads from platform_settings first (admin-rotatable), falls back to env var.

async function getZeltoApiKey(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "zelto_api_key"));
    const dbKey = row?.value?.trim();
    if (dbKey) return dbKey;
  } catch { /* ignore DB error — fall through to env */ }
  return (process.env["ZELTO_API_KEY"] ?? "").trim() || null;
}

// ── Payload type ───────────────────────────────────────────────────────────────

export interface ZeltoCallPayload {
  callId:             number | string;
  agentId?:           number | string;
  agentName?:         string;
  status?:            string;
  direction?:         string;
  fromNumber?:        string | null;
  toNumber?:          string | null;
  durationSeconds?:   number;
  transcript?:        string | null;
  callSummary?:       string | null;
  dispositionResult?: Record<string, unknown> | null;
  avgSttLatencyMs?:   number | null;
  avgLlmLatencyMs?:   number | null;
  avgTtsLatencyMs?:   number | null;
  endedAt?:           string;
}

// ── Push ───────────────────────────────────────────────────────────────────────
// Fire-and-forget safe: callers should .catch(() => {}) this.
// No-ops silently when no Zelto key is configured.

export async function pushCallToZelto(payload: ZeltoCallPayload): Promise<void> {
  const apiKey = await getZeltoApiKey();
  if (!apiKey) return;

  const endpoint = `${ZELTO_BASE_URL}/calls`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "X-Api-Key":     apiKey,
      },
      body:   JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (fetchErr) {
    logger.warn({ callId: payload.callId, fetchErr }, "Zelto push — network error");
    return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn(
      { callId: payload.callId, status: res.status, body: body.slice(0, 300) },
      "Zelto push — non-2xx response",
    );
    return;
  }

  logger.info({ callId: payload.callId, status: res.status }, "Zelto — call pushed successfully");
}
