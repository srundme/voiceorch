/**
 * Admin V2 Phase 4 — Managed Keys health/rotate + Providers control surface.
 * Secrets are never returned after save; only masked identifiers + health status.
 */
import { Router } from "express";
import {
  db,
  platformSettingsTable,
  managedKeyHealthChecksTable,
  managedKeyAuditTable,
  usageEventsTable,
} from "@workspace/db";
import { desc, eq, gte, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";

const router = Router();
router.use("/admin/managed-keys", requireAdmin);
router.use("/admin/product", requireAdmin);

export const MANAGED_KEY_CATALOG: Array<{
  key: string;
  label: string;
  service: "llm" | "stt" | "tts" | "telephony" | "integrations";
  provider: string;
  affects: string[];
  testable: boolean;
}> = [
  { key: "managed_qwen_key", label: "Qwen / Groq", service: "llm", provider: "groq", affects: ["LLM", "Prompt gen", "Managed fallback"], testable: true },
  { key: "managed_groq_key", label: "Groq", service: "llm", provider: "groq", affects: ["LLM", "Summaries", "Managed fallback"], testable: true },
  { key: "managed_jina_key", label: "Jina", service: "llm", provider: "jina", affects: ["KB embeddings"], testable: true },
  { key: "managed_gemini_key", label: "Gemini", service: "llm", provider: "gemini", affects: ["Gemini Live", "Key pool rotation"], testable: false },
  { key: "managed_openai_key", label: "OpenAI", service: "llm", provider: "openai", affects: ["LLM", "OpenAI TTS"], testable: true },
  { key: "managed_anthropic_key", label: "Anthropic", service: "llm", provider: "anthropic", affects: ["LLM"], testable: false },
  { key: "managed_mistral_key", label: "Mistral", service: "llm", provider: "mistral", affects: ["LLM"], testable: false },
  { key: "managed_cohere_key", label: "Cohere", service: "llm", provider: "cohere", affects: ["LLM"], testable: false },
  { key: "managed_deepseek_key", label: "DeepSeek", service: "llm", provider: "deepseek", affects: ["LLM"], testable: false },
  { key: "managed_together_key", label: "Together", service: "llm", provider: "together", affects: ["LLM"], testable: false },
  { key: "managed_openrouter_key", label: "OpenRouter", service: "llm", provider: "openrouter", affects: ["LLM"], testable: false },
  { key: "managed_krutrim_key", label: "Krutrim", service: "llm", provider: "krutrim", affects: ["LLM"], testable: false },
  { key: "managed_deepgram_key", label: "Deepgram", service: "stt", provider: "deepgram", affects: ["STT", "User calls"], testable: true },
  { key: "managed_sarvam_key", label: "Sarvam", service: "stt", provider: "sarvam", affects: ["STT", "LLM fallback", "User calls"], testable: true },
  { key: "managed_assemblyai_key", label: "AssemblyAI", service: "stt", provider: "assemblyai", affects: ["STT"], testable: false },
  { key: "managed_azure_speech_key", label: "Azure Speech", service: "stt", provider: "azure", affects: ["STT", "Speaker"], testable: false },
  { key: "managed_azure_speech_region", label: "Azure Speech Region", service: "stt", provider: "azure", affects: ["STT"], testable: false },
  { key: "managed_azure_speaker_region", label: "Azure Speaker Region", service: "stt", provider: "azure", affects: ["Speaker"], testable: false },
  { key: "managed_cartesia_key", label: "Cartesia", service: "tts", provider: "cartesia", affects: ["TTS", "User calls"], testable: true },
  { key: "managed_elevenlabs_key", label: "ElevenLabs", service: "tts", provider: "elevenlabs", affects: ["TTS"], testable: false },
  { key: "managed_vobiz_auth_id", label: "VoBiz Auth ID", service: "telephony", provider: "vobiz", affects: ["Telephony", "Managed numbers"], testable: false },
  { key: "managed_vobiz_auth_token", label: "VoBiz Auth Token", service: "telephony", provider: "vobiz", affects: ["Telephony", "Managed numbers"], testable: true },
  { key: "zelto_api_key", label: "Zelto", service: "integrations", provider: "zelto", affects: ["Integrations"], testable: false },
  { key: "recall_api_key", label: "Recall (meeting bots)", service: "integrations", provider: "recall", affects: ["Meeting bots"], testable: true },
  { key: "recall_api_key_fallback", label: "Recall fallback", service: "integrations", provider: "recall", affects: ["Meeting bots"], testable: true },
];

function maskSecret(v: string): string {
  if (!v) return "";
  return v.length > 8 ? `${v.slice(0, 4)}${"•".repeat(Math.min(v.length - 8, 20))}${v.slice(-4)}` : "••••••••";
}

async function getSecret(key: string): Promise<string | null> {
  const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, key)).limit(1);
  const v = row?.value?.trim();
  return v || null;
}

type HealthResult = {
  status: "healthy" | "warning" | "failed" | "skipped";
  latencyMs: number | null;
  errorCode?: string;
  errorMessageSafe?: string;
};

async function runHealthCheck(credentialKey: string, secretOverride?: string): Promise<HealthResult> {
  const meta = MANAGED_KEY_CATALOG.find((c) => c.key === credentialKey);
  const secret = secretOverride ?? (await getSecret(credentialKey));
  if (!secret) {
    return { status: "failed", latencyMs: null, errorCode: "missing", errorMessageSafe: "Key not configured" };
  }
  if (!meta?.testable) {
    return { status: "healthy", latencyMs: 0, errorMessageSafe: "Configured (live probe not supported)" };
  }

  const started = Date.now();
  try {
    if (credentialKey === "managed_groq_key" || credentialKey === "managed_qwen_key") {
      const r = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Date.now() - started;
      if (r.ok) return { status: "healthy", latencyMs };
      return { status: "failed", latencyMs, errorCode: String(r.status), errorMessageSafe: `Groq HTTP ${r.status}` };
    }
    if (credentialKey === "managed_openai_key") {
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Date.now() - started;
      if (r.ok) return { status: "healthy", latencyMs };
      return { status: "failed", latencyMs, errorCode: String(r.status), errorMessageSafe: `OpenAI HTTP ${r.status}` };
    }
    if (credentialKey === "managed_deepgram_key") {
      const r = await fetch("https://api.deepgram.com/v1/projects", {
        headers: { Authorization: `Token ${secret}` },
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Date.now() - started;
      if (r.ok) return { status: "healthy", latencyMs };
      return { status: "failed", latencyMs, errorCode: String(r.status), errorMessageSafe: `Deepgram HTTP ${r.status}` };
    }
    if (credentialKey === "managed_sarvam_key") {
      // Probe TTS — that is what live calls use. text-lid can still 200 while Bulbul/Saaras return 402.
      const r = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: { "api-subscription-key": secret, "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: ["ok"],
          target_language_code: "en-IN",
          speaker: "shubh",
          model: "bulbul:v3",
          speech_sample_rate: 8000,
          output_audio_codec: "linear16",
        }),
        signal: AbortSignal.timeout(10000),
      });
      const latencyMs = Date.now() - started;
      if (r.ok) return { status: "healthy", latencyMs };
      let detail = `Sarvam HTTP ${r.status}`;
      try {
        const body = await r.json() as { error?: { message?: string; code?: string } };
        const msg = body?.error?.message || body?.error?.code;
        if (typeof msg === "string" && msg.length > 0 && msg.length < 180) detail = msg;
      } catch { /* ignore non-JSON */ }
      if (r.status === 402) {
        return {
          status: "failed",
          latencyMs,
          errorCode: "402",
          errorMessageSafe: `Sarvam credits exhausted (402). ${detail}`,
        };
      }
      if (r.status === 401 || r.status === 403) {
        return { status: "failed", latencyMs, errorCode: String(r.status), errorMessageSafe: `Sarvam auth failed (${r.status})` };
      }
      return { status: "failed", latencyMs, errorCode: String(r.status), errorMessageSafe: detail };
    }
    if (credentialKey === "managed_cartesia_key") {
      const r = await fetch("https://api.cartesia.ai/voices?limit=1", {
        headers: {
          "X-API-Key": secret,
          "Cartesia-Version": "2024-06-10",
        },
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Date.now() - started;
      if (r.ok) return { status: "healthy", latencyMs };
      return { status: "failed", latencyMs, errorCode: String(r.status), errorMessageSafe: `Cartesia HTTP ${r.status}` };
    }
    if (credentialKey === "managed_jina_key") {
      const r = await fetch("https://api.jina.ai/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "jina-embeddings-v3", input: ["ping"], task: "retrieval.query" }),
        signal: AbortSignal.timeout(10000),
      });
      const latencyMs = Date.now() - started;
      if (r.ok) return { status: "healthy", latencyMs };
      if (r.status === 401 || r.status === 403) {
        return { status: "failed", latencyMs, errorCode: String(r.status), errorMessageSafe: `Jina auth failed (${r.status})` };
      }
      return { status: "warning", latencyMs, errorCode: String(r.status), errorMessageSafe: `Jina HTTP ${r.status}` };
    }
    if (credentialKey === "recall_api_key" || credentialKey === "recall_api_key_fallback") {
      const region = (process.env["RECALL_REGION"] || "us-west-2").trim();
      const r = await fetch(`https://${region}.recall.ai/api/v1/bot/?limit=1`, {
        headers: { accept: "application/json", authorization: secret },
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Date.now() - started;
      if (r.ok) return { status: "healthy", latencyMs };
      return { status: "failed", latencyMs, errorCode: String(r.status), errorMessageSafe: `Recall HTTP ${r.status}` };
    }
    if (credentialKey === "managed_vobiz_auth_token") {
      const authId = await getSecret("managed_vobiz_auth_id");
      if (!authId) {
        return { status: "failed", latencyMs: null, errorCode: "missing_pair", errorMessageSafe: "VoBiz Auth ID also required" };
      }
      const basic = Buffer.from(`${authId}:${secret}`).toString("base64");
      const r = await fetch(`https://api.vobiz.ai/v1/Account/${authId}/`, {
        headers: { Authorization: `Basic ${basic}` },
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Date.now() - started;
      if (r.ok) return { status: "healthy", latencyMs };
      return { status: "failed", latencyMs, errorCode: String(r.status), errorMessageSafe: `VoBiz HTTP ${r.status}` };
    }
    return { status: "skipped", latencyMs: Date.now() - started, errorMessageSafe: "No probe defined" };
  } catch (err) {
    return {
      status: "failed",
      latencyMs: Date.now() - started,
      errorCode: "network",
      errorMessageSafe: err instanceof Error ? err.message.slice(0, 200) : "Probe failed",
    };
  }
}

async function recordHealth(credentialKey: string, result: HealthResult) {
  await db.insert(managedKeyHealthChecksTable).values({
    credentialKey,
    status: result.status,
    latencyMs: result.latencyMs,
    errorCode: result.errorCode ?? null,
    errorMessageSafe: result.errorMessageSafe ?? null,
  });
}

async function recordAudit(
  credentialKey: string,
  action: string,
  opts: { previousStatus?: string; newStatus?: string; metadata?: Record<string, unknown> } = {},
) {
  await db.insert(managedKeyAuditTable).values({
    credentialKey,
    action,
    adminId: "admin",
    previousStatus: opts.previousStatus ?? null,
    newStatus: opts.newStatus ?? null,
    metadata: opts.metadata ?? null,
  });
}

// ── GET /admin/managed-keys/status ────────────────────────────────────────────

router.get("/admin/managed-keys/status", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(platformSettingsTable);
    const byKey = new Map(rows.map((r) => [r.key, r]));

    const latestChecks = await db.execute(sql`
      select distinct on (credential_key)
        credential_key, status, latency_ms, error_message_safe, checked_at
      from managed_key_health_checks
      order by credential_key, checked_at desc
    `);
    const checkMap = new Map(
      (latestChecks.rows as Array<Record<string, unknown>>).map((r) => [String(r.credential_key), r]),
    );

    const { parseGeminiKeyList } = await import("../lib/gemini-key-pool.js");
    const credentials = MANAGED_KEY_CATALOG.map((c) => {
      const row = byKey.get(c.key);
      let configured = !!(row?.value && row.value.trim());
      let label = c.label;
      if (c.key === "managed_gemini_key") {
        const pool = parseGeminiKeyList(row?.value, byKey.get("managed_gemini_keys")?.value);
        configured = pool.length > 0;
        if (pool.length > 1) label = `Gemini (${pool.length} keys)`;
      }
      const check = checkMap.get(c.key);
      let status: string = configured ? "active" : "missing";
      if (check?.status) status = String(check.status);
      else if (!configured) status = "missing";
      return {
        key: c.key,
        label,
        service: c.service,
        provider: c.provider,
        affects: c.affects,
        testable: c.testable,
        configured,
        masked: configured && row?.value ? maskSecret(row.value) : configured ? "••••••••" : null,
        updatedAt: row?.updatedAt ?? null,
        status,
        lastCheckAt: check?.checked_at ?? null,
        lastLatencyMs: check?.latency_ms != null ? Number(check.latency_ms) : null,
        lastError: check?.error_message_safe ? String(check.error_message_safe) : null,
      };
    });

    const kpis = {
      total: credentials.length,
      configured: credentials.filter((c) => c.configured).length,
      healthy: credentials.filter((c) => c.status === "healthy" || (c.configured && c.status === "active")).length,
      warning: credentials.filter((c) => c.status === "warning").length,
      failed: credentials.filter((c) => c.status === "failed").length,
      missing: credentials.filter((c) => !c.configured).length,
    };

    res.json({ kpis, credentials, generatedAt: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "managed-keys/status failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/managed-keys/:key/test ────────────────────────────────────────

router.post("/admin/managed-keys/:key/test", async (req, res): Promise<void> => {
  try {
    const key = String(req.params.key);
    if (!MANAGED_KEY_CATALOG.some((c) => c.key === key)) {
      res.status(404).json({ error: "Unknown managed key" });
      return;
    }
    const raw = (req.body as { value?: string } | undefined)?.value;
    const override = typeof raw === "string" && raw.trim() && !raw.includes("•") ? raw.trim() : undefined;
    const result = await runHealthCheck(key, override);
    // An unsaved paste must not overwrite the stored key's health badge.
    if (!override) {
      await recordHealth(key, result);
      await recordAudit(key, "test", { newStatus: result.status, metadata: { latencyMs: result.latencyMs } });
    }
    res.json({ key, ...result, probedUnsaved: !!override });
  } catch (err) {
    logger.error({ err }, "managed-keys/test failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/managed-keys/:key/rotate ──────────────────────────────────────

router.post("/admin/managed-keys/:key/rotate", async (req, res): Promise<void> => {
  try {
    const key = String(req.params.key);
    const meta = MANAGED_KEY_CATALOG.find((c) => c.key === key);
    if (!meta) {
      res.status(404).json({ error: "Unknown managed key" });
      return;
    }
    const { value, skipValidate } = req.body as { value?: string; skipValidate?: boolean };
    const next = (value ?? "").trim();
    if (!next || next.includes("•")) {
      res.status(400).json({ error: "Provide a full new secret value (not masked)" });
      return;
    }

    const had = await getSecret(key);
    await db
      .insert(platformSettingsTable)
      .values({ key, value: next })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: next, updatedAt: new Date() },
      });

    let health: HealthResult = { status: "skipped", latencyMs: null };
    if (!skipValidate && meta.testable) {
      health = await runHealthCheck(key, next);
    }

    await recordHealth(key, health.status === "skipped" ? { status: "healthy", latencyMs: 0 } : health);
    await recordAudit(key, "rotate", {
      previousStatus: had ? "configured" : "missing",
      newStatus: health.status === "failed" ? "failed" : "active",
      metadata: { validated: !skipValidate && meta.testable, saved: true },
    });

    res.json({
      ok: true,
      key,
      masked: maskSecret(next),
      health,
      message: health.status === "failed"
        ? `Key saved (${maskSecret(next)}). Health check failed: ${health.errorMessageSafe ?? health.status}`
        : "Key rotated. Previous value replaced. Full secret is not returned.",
    });
  } catch (err) {
    logger.error({ err }, "managed-keys/rotate failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /admin/managed-keys/:key/history ──────────────────────────────────────

router.get("/admin/managed-keys/:key/history", async (req, res): Promise<void> => {
  try {
    const key = String(req.params.key);
    const [audit, health] = await Promise.all([
      db
        .select()
        .from(managedKeyAuditTable)
        .where(eq(managedKeyAuditTable.credentialKey, key))
        .orderBy(desc(managedKeyAuditTable.createdAt))
        .limit(50),
      db
        .select()
        .from(managedKeyHealthChecksTable)
        .where(eq(managedKeyHealthChecksTable.credentialKey, key))
        .orderBy(desc(managedKeyHealthChecksTable.checkedAt))
        .limit(20),
    ]);
    res.json({ audit, health });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /admin/product/providers ──────────────────────────────────────────────

router.get("/admin/product/providers", async (_req, res): Promise<void> => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const usage = await db
      .select({
        service: usageEventsTable.service,
        provider: usageEventsTable.provider,
        events: sql<number>`count(*)`,
        failures: sql<number>`count(*) filter (where ${usageEventsTable.success} = false)`,
        avgLatencyMs: sql<number>`avg(${usageEventsTable.latencyMs})`,
        costMicros: sql<number>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
      })
      .from(usageEventsTable)
      .where(gte(usageEventsTable.createdAt, since))
      .groupBy(usageEventsTable.service, usageEventsTable.provider);

    const settings = await db.select().from(platformSettingsTable);
    const setKeys = new Set(settings.filter((s) => s.value?.trim()).map((s) => s.key));

    const providers = MANAGED_KEY_CATALOG.filter(
      (c) => !c.key.endsWith("_region") && c.key !== "managed_vobiz_auth_id",
    ).map((c) => {
      const u = usage.find(
        (x) =>
          x.service === c.service ||
          (c.service === "stt" && x.service === "stt" && x.provider.toLowerCase().includes(c.provider)) ||
          x.provider.toLowerCase().includes(c.provider),
      );
      const events = Number(u?.events ?? 0);
      const failures = Number(u?.failures ?? 0);
      return {
        key: c.key,
        label: c.label,
        service: c.service,
        provider: c.provider,
        managed: true,
        configured: setKeys.has(c.key),
        affects: c.affects,
        href: "/managed-keys",
        usage7d: {
          events,
          failureRatePct: events > 0 ? Math.round((failures / events) * 1000) / 10 : 0,
          avgLatencyMs: u?.avgLatencyMs != null ? Math.round(Number(u.avgLatencyMs)) : null,
        },
      };
    });

    res.json({
      generatedAt: new Date().toISOString(),
      providers,
      note: "Managed providers use Admin managed keys. BYO providers live on each user account.",
    });
  } catch (err) {
    logger.error({ err }, "product/providers failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /admin/product/infra-health ───────────────────────────────────────────

router.get("/admin/product/infra-health", async (_req, res): Promise<void> => {
  try {
    const latest = await db.execute(sql`
      select distinct on (credential_key)
        credential_key, status, latency_ms, error_message_safe, checked_at
      from managed_key_health_checks
      order by credential_key, checked_at desc
    `);
    const checks = (latest.rows as Array<Record<string, unknown>>).map((r) => ({
      key: String(r.credential_key),
      status: String(r.status),
      latencyMs: r.latency_ms != null ? Number(r.latency_ms) : null,
      error: r.error_message_safe ? String(r.error_message_safe) : null,
      checkedAt: r.checked_at,
    }));

    const failed = checks.filter((c) => c.status === "failed").length;
    const warning = checks.filter((c) => c.status === "warning").length;
    const healthy = checks.filter((c) => c.status === "healthy").length;

    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        status: failed > 0 ? "critical" : warning > 0 ? "warning" : "healthy",
        healthy,
        warning,
        failed,
        checked: checks.length,
      },
      checks,
    });
  } catch (err) {
    // Tables may not exist until migration — degrade gracefully
    res.json({
      generatedAt: new Date().toISOString(),
      summary: { status: "unknown", healthy: 0, warning: 0, failed: 0, checked: 0 },
      checks: [],
      note: "Run migration 0117_managed_key_health if tables are missing",
    });
  }
});

export default router;
