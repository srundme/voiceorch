import { db } from "@workspace/db";
import { platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

// ── Zelto call upload endpoint ────────────────────────────────────────────────
// Docs: https://docs.zelto.ai/docs/integrations/api-call-upload
const ZELTO_ENDPOINT = "https://api.zelto.ai/webhooks/calls";

// ── Key resolution ─────────────────────────────────────────────────────────────

async function getZeltoApiKey(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "zelto_api_key"));
    const dbKey = row?.value?.trim();
    if (dbKey) return dbKey;
  } catch { /* ignore — fall through to env */ }
  return (process.env["ZELTO_API_KEY"] ?? "").trim() || null;
}

// ── Transcript parser ─────────────────────────────────────────────────────────
// Converts a plain "Agent: ...\nUser: ..." transcript string into Zelto turns.

type ZeltoRole = "user" | "assistant" | "system" | "tool";

interface ZeltoTurn {
  role: ZeltoRole;
  content: string;
}

function parseTranscriptToTurns(transcript: string): ZeltoTurn[] {
  const turns: ZeltoTurn[] = [];
  let currentRole: ZeltoRole | null = null;
  let currentLines: string[] = [];

  function flush() {
    if (currentRole && currentLines.length > 0) {
      const content = currentLines.join(" ").trim();
      if (content) turns.push({ role: currentRole, content });
    }
    currentLines = [];
  }

  for (const rawLine of transcript.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const agentMatch = /^(?:Agent|Assistant|Bot):\s*(.*)$/i.exec(line);
    const userMatch  = /^(?:User|Customer|Caller|Human):\s*(.*)$/i.exec(line);
    const sysMatch   = /^System:\s*(.*)$/i.exec(line);

    if (agentMatch) {
      flush();
      currentRole  = "assistant";
      currentLines = [agentMatch[1]];
    } else if (userMatch) {
      flush();
      currentRole  = "user";
      currentLines = [userMatch[1]];
    } else if (sysMatch) {
      flush();
      currentRole  = "system";
      currentLines = [sysMatch[1]];
    } else if (currentRole) {
      currentLines.push(line);
    }
  }
  flush();
  return turns;
}

// ── Internal payload type (caller-facing) ─────────────────────────────────────

export interface ZeltoCallPayload {
  callId:             number | string;
  agentId?:           number | string;
  agentName?:         string;
  status?:            string;
  direction?:         string;
  fromNumber?:        string | null;
  toNumber?:          string | null;
  durationSeconds?:   number;
  startedAt?:         string;
  endedAt?:           string;
  transcript?:        string | null;
  callSummary?:       string | null;
  dispositionResult?: Record<string, unknown> | null;
  costCents?:         number | null;
  avgSttLatencyMs?:   number | null;
  avgLlmLatencyMs?:   number | null;
  avgTtsLatencyMs?:   number | null;
}

// ── Push ───────────────────────────────────────────────────────────────────────
// Fire-and-forget safe: callers should .catch(() => {}) this.
// No-ops silently when no Zelto key is configured.

export async function pushCallToZelto(payload: ZeltoCallPayload): Promise<void> {
  const apiKey = await getZeltoApiKey();
  if (!apiKey) return;

  // Parse transcript string → turns array
  const turns: ZeltoTurn[] = payload.transcript
    ? parseTranscriptToTurns(payload.transcript)
    : [];

  // Build Zelto-spec body
  // agent.externalId is the stable per-agent identifier (not per-call)
  const body: Record<string, unknown> = {
    agent: {
      externalId: String(payload.agentId ?? payload.callId),
      name:       payload.agentName ?? "SnapServe Agent",
    },
    call: {
      externalId:      String(payload.callId),
      ...(payload.startedAt       && { startedAt:       payload.startedAt }),
      ...(payload.endedAt         && { endedAt:         payload.endedAt }),
      ...(payload.durationSeconds != null && { durationSeconds: payload.durationSeconds }),
      ...(payload.status          && { endedReason:     payload.status }),
      ...(payload.costCents != null && { cost: payload.costCents / 100 }),
      customer: {
        ...(payload.direction === "outbound"
          ? { number: payload.toNumber   ?? undefined }
          : { number: payload.fromNumber ?? undefined }),
      },
    },
    ...(turns.length > 0 && { transcript: { turns } }),
    metadata: {
      direction:         payload.direction,
      avgSttLatencyMs:   payload.avgSttLatencyMs,
      avgLlmLatencyMs:   payload.avgLlmLatencyMs,
      avgTtsLatencyMs:   payload.avgTtsLatencyMs,
      callSummary:       payload.callSummary,
      dispositionResult: payload.dispositionResult,
      platform:          "snapserve",
    },
  };

  let res: Response;
  try {
    res = await fetch(ZELTO_ENDPOINT, {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "Authorization":     `Bearer ${apiKey}`,
        "X-Zelto-Provider":  "zelto",
      },
      body:   JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (fetchErr) {
    logger.warn({ callId: payload.callId, fetchErr }, "Zelto push — network error");
    return;
  }

  if (!res.ok) {
    const responseBody = await res.text().catch(() => "");
    logger.warn(
      { callId: payload.callId, status: res.status, body: responseBody.slice(0, 400) },
      "Zelto push — non-2xx response",
    );
    return;
  }

  logger.info({ callId: payload.callId, status: res.status }, "Zelto — call uploaded successfully");
}
