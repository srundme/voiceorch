/**
 * Admin V2 Phase 6 — Operations: platform health grid, alert rules, email & audit summaries.
 */
import { Router } from "express";
import {
  db,
  platformSettingsTable,
  usageEventsTable,
  platformEmailsTable,
  adminAuditLogsTable,
  adminAlertsTable,
  phoneNumbersTable,
  whatsappConnectionsTable,
} from "@workspace/db";
import { and, desc, eq, gte, isNull, sql, count, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { getRedis } from "../lib/redis.js";
import { pool } from "@workspace/db";
import { getAllSessions } from "../orchestration/session.js";

const router = Router();
router.use("/admin/operations", requireAdmin);

const ALERT_RULES_KEY = "admin_v2_alert_rules";
const ALERT_CHANNELS_KEY = "admin_v2_alert_channels";

type AlertRuleDef = {
  id: string;
  metric: string;
  condition: string;
  defaultThreshold: number;
  unit: string;
  defaultSeverity: "info" | "warning" | "critical";
  description: string;
  monitor: "active" | "planned";
};

const DEFAULT_RULES: AlertRuleDef[] = [
  {
    id: "call_failure_rate",
    metric: "Call failure rate",
    condition: ">",
    defaultThreshold: 5,
    unit: "%",
    defaultSeverity: "critical",
    description: "Share of calls with error_message in the last hour",
    monitor: "active",
  },
  {
    id: "vobiz_balance",
    metric: "VoBiz balance",
    condition: "<",
    defaultThreshold: 10000,
    unit: "₹",
    defaultSeverity: "critical",
    description: "Master telephony wallet available balance",
    monitor: "active",
  },
  {
    id: "daily_revenue_drop",
    metric: "Daily revenue drop",
    condition: ">",
    defaultThreshold: 30,
    unit: "%",
    defaultSeverity: "warning",
    description: "Day-over-day recognized revenue decline",
    monitor: "active",
  },
  {
    id: "cost_per_min_increase",
    metric: "Cost/min increase",
    condition: ">",
    defaultThreshold: 20,
    unit: "%",
    defaultSeverity: "warning",
    description: "Day-over-day variable cost per minute increase",
    monitor: "active",
  },
  {
    id: "provider_latency",
    metric: "Provider latency",
    condition: ">",
    defaultThreshold: 2000,
    unit: "ms",
    defaultSeverity: "warning",
    description: "Average STT/LLM/TTS latency over the last hour",
    monitor: "active",
  },
  {
    id: "managed_key_health",
    metric: "Managed key health",
    condition: "=",
    defaultThreshold: 1,
    unit: "fail",
    defaultSeverity: "critical",
    description: "Any managed key health check fails",
    monitor: "active",
  },
  {
    id: "usage_spike",
    metric: "Usage spike",
    condition: ">",
    defaultThreshold: 3,
    unit: "σ",
    defaultSeverity: "warning",
    description: "Usage events spike vs rolling baseline",
    monitor: "active",
  },
  {
    id: "provider_down",
    metric: "Provider down",
    condition: "=",
    defaultThreshold: 1,
    unit: "event",
    defaultSeverity: "critical",
    description: "Provider error rate crosses hard threshold",
    monitor: "active",
  },
];

type ComponentStatus = "ok" | "warn" | "error" | "unknown";

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - t0 };
}

async function serviceWindowStats(service: string, since: Date) {
  const [row] = await db
    .select({
      events: count(),
      failures: sql<number>`count(*) filter (where ${usageEventsTable.success} = false)`,
      avgLatency: sql<number>`avg(${usageEventsTable.latencyMs})`,
      lastError: sql<string>`max(case when ${usageEventsTable.success} = false then ${usageEventsTable.errorMessage} end)`,
    })
    .from(usageEventsTable)
    .where(and(eq(usageEventsTable.service, service), gte(usageEventsTable.createdAt, since)));
  return {
    events: Number(row?.events ?? 0),
    failures: Number(row?.failures ?? 0),
    avgLatencyMs: row?.avgLatency != null ? Math.round(Number(row.avgLatency)) : null,
    lastError: row?.lastError ? String(row.lastError).slice(0, 200) : null,
  };
}

function statusFromFailRate(events: number, failures: number): ComponentStatus {
  if (events === 0) return "unknown";
  const rate = failures / events;
  if (rate >= 0.2) return "error";
  if (rate >= 0.05) return "warn";
  return "ok";
}

// ─── Platform health grid ────────────────────────────────────────────────────

router.get("/admin/operations/health", async (_req, res): Promise<void> => {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const components: Array<{
      id: string;
      label: string;
      status: ComponentStatus;
      lastCheck: string;
      latencyMs: number | null;
      errorCount: number;
      lastError: string | null;
      detail?: string;
    }> = [];

    const nowIso = new Date().toISOString();

    // API
    components.push({
      id: "api",
      label: "API",
      status: "ok",
      lastCheck: nowIso,
      latencyMs: 0,
      errorCount: 0,
      lastError: null,
      detail: "Admin operations endpoint responding",
    });

    // Database
    {
      const { result, latencyMs } = await timed(async () => {
        const client = await pool.connect();
        try {
          await client.query("SELECT 1");
          return { ok: true as const, detail: `pool ${pool.totalCount}/${pool.options.max}` };
        } catch (err) {
          return { ok: false as const, detail: err instanceof Error ? err.message : String(err) };
        } finally {
          client.release();
        }
      });
      components.push({
        id: "database",
        label: "Database",
        status: result.ok ? "ok" : "error",
        lastCheck: nowIso,
        latencyMs,
        errorCount: result.ok ? 0 : 1,
        lastError: result.ok ? null : result.detail,
        detail: result.detail,
      });
    }

    // Redis
    {
      const { result, latencyMs } = await timed(async () => {
        try {
          const redis = getRedis();
          if (!redis) return { status: "warn" as const, detail: "Redis not configured" };
          await redis.ping();
          return { status: "ok" as const, detail: "PONG" };
        } catch (err) {
          return { status: "error" as const, detail: err instanceof Error ? err.message : String(err) };
        }
      });
      components.push({
        id: "redis",
        label: "Redis",
        status: result.status,
        lastCheck: nowIso,
        latencyMs,
        errorCount: result.status === "error" ? 1 : 0,
        lastError: result.status === "error" ? result.detail : null,
        detail: result.detail,
      });
    }

    // STT / TTS / LLM from usage events
    for (const [id, label, service] of [
      ["stt", "STT", "stt"],
      ["tts", "TTS", "tts"],
      ["llm", "LLM", "llm"],
    ] as const) {
      const stats = await serviceWindowStats(service, since);
      components.push({
        id,
        label,
        status: statusFromFailRate(stats.events, stats.failures),
        lastCheck: nowIso,
        latencyMs: stats.avgLatencyMs,
        errorCount: stats.failures,
        lastError: stats.lastError,
        detail: `${stats.events} events · ${stats.failures} failures (1h)`,
      });
    }

    // Telephony — env presence + call errors last hour
    {
      const hasVobiz = !!(process.env["VOBIZ_AUTH_ID"] && process.env["VOBIZ_AUTH_TOKEN"]);
      const callStats = await db.execute(sql`
        select
          count(*)::int as calls,
          count(*) filter (where coalesce(error_message,'') <> '')::int as failed
        from calls
        where created_at >= ${since}
      `);
      const r = (callStats.rows[0] ?? {}) as Record<string, unknown>;
      const calls = Number(r.calls ?? 0);
      const failed = Number(r.failed ?? 0);
      let status: ComponentStatus = hasVobiz ? "ok" : "warn";
      if (calls > 0 && failed / calls >= 0.2) status = "error";
      else if (calls > 0 && failed / calls >= 0.05) status = "warn";
      components.push({
        id: "telephony",
        label: "Telephony",
        status,
        lastCheck: nowIso,
        latencyMs: null,
        errorCount: failed,
        lastError: null,
        detail: hasVobiz
          ? `${calls} calls · ${failed} failed (1h)`
          : "VOBIZ credentials not configured",
      });
    }

    // Managed keys
    try {
      const latest = await db.execute(sql`
        select distinct on (credential_key)
          credential_key, status, latency_ms, error_message_safe, checked_at
        from managed_key_health_checks
        order by credential_key, checked_at desc
      `);
      const rows = latest.rows as Array<Record<string, unknown>>;
      const failed = rows.filter((x) => String(x.status) === "failed").length;
      const warning = rows.filter((x) => String(x.status) === "warning").length;
      const last = rows[0];
      components.push({
        id: "managed_keys",
        label: "Managed keys",
        status: failed > 0 ? "error" : warning > 0 ? "warn" : rows.length ? "ok" : "unknown",
        lastCheck: last?.checked_at ? String(last.checked_at) : nowIso,
        latencyMs: last?.latency_ms != null ? Number(last.latency_ms) : null,
        errorCount: failed,
        lastError: last?.error_message_safe ? String(last.error_message_safe) : null,
        detail: `${rows.length} checked · ${failed} failed`,
      });
    } catch {
      components.push({
        id: "managed_keys",
        label: "Managed keys",
        status: "unknown",
        lastCheck: nowIso,
        latencyMs: null,
        errorCount: 0,
        lastError: null,
        detail: "Health history unavailable (run migration 0117)",
      });
    }

    // Managed numbers
    {
      const [row] = await db.select({ c: count() }).from(phoneNumbersTable);
      const n = Number(row?.c ?? 0);
      components.push({
        id: "managed_numbers",
        label: "Managed numbers",
        status: n > 0 ? "ok" : "warn",
        lastCheck: nowIso,
        latencyMs: null,
        errorCount: 0,
        lastError: null,
        detail: `${n} numbers in inventory`,
      });
    }

    // Email
    {
      const [row] = await db
        .select({
          sent: sql<number>`count(*) filter (where ${platformEmailsTable.status} = 'sent')`,
          failed: sql<number>`count(*) filter (where ${platformEmailsTable.status} <> 'sent')`,
        })
        .from(platformEmailsTable)
        .where(gte(platformEmailsTable.sentAt, since));
      const sent = Number(row?.sent ?? 0);
      const failed = Number(row?.failed ?? 0);
      components.push({
        id: "email",
        label: "Email",
        status: failed > 0 && sent === 0 ? "error" : failed > 0 ? "warn" : sent > 0 ? "ok" : "unknown",
        lastCheck: nowIso,
        latencyMs: null,
        errorCount: failed,
        lastError: null,
        detail: `${sent} sent · ${failed} failed (1h)`,
      });
    }

    // Calendar — presence of scheduling env / recall
    {
      const hasGcal = !!(process.env["GOOGLE_CLIENT_ID"] || process.env["GCAL_CLIENT_ID"]);
      components.push({
        id: "calendar",
        label: "Calendar",
        status: hasGcal ? "ok" : "warn",
        lastCheck: nowIso,
        latencyMs: null,
        errorCount: 0,
        lastError: null,
        detail: hasGcal ? "Google Calendar OAuth configured" : "Google Calendar credentials not set",
      });
    }

    // WhatsApp
    {
      try {
        const [row] = await db.select({ c: count() }).from(whatsappConnectionsTable);
        const n = Number(row?.c ?? 0);
        components.push({
          id: "whatsapp",
          label: "WhatsApp",
          status: n > 0 ? "ok" : "unknown",
          lastCheck: nowIso,
          latencyMs: null,
          errorCount: 0,
          lastError: null,
          detail: `${n} connections`,
        });
      } catch {
        components.push({
          id: "whatsapp",
          label: "WhatsApp",
          status: "unknown",
          lastCheck: nowIso,
          latencyMs: null,
          errorCount: 0,
          lastError: null,
          detail: "Unable to query WhatsApp connections",
        });
      }
    }

    // Live load note
    const activeCalls = getAllSessions().length;

    const errors = components.filter((c) => c.status === "error").length;
    const warns = components.filter((c) => c.status === "warn").length;
    const overall: ComponentStatus = errors > 0 ? "error" : warns > 0 ? "warn" : "ok";

    res.json({
      status: overall,
      generatedAt: nowIso,
      activeCalls,
      components,
    });
  } catch (err) {
    logger.error({ err }, "operations/health failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Alert rules ─────────────────────────────────────────────────────────────

async function loadRuleOverrides(): Promise<Record<string, { enabled?: boolean; threshold?: number; severity?: string; channels?: string[] }>> {
  try {
    const [row] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, ALERT_RULES_KEY))
      .limit(1);
    if (!row?.value) return {};
    return JSON.parse(row.value) as Record<string, { enabled?: boolean; threshold?: number; severity?: string; channels?: string[] }>;
  } catch {
    return {};
  }
}

async function loadChannels(): Promise<{ adminUi: boolean; email: boolean; slack: boolean; emailAddress: string | null; slackConfigured: boolean }> {
  const keys = ["alert_notification_email", "alert_slack_webhook_url"];
  const rows = await db
    .select()
    .from(platformSettingsTable)
    .where(sql`${platformSettingsTable.key} in ('alert_notification_email', 'alert_slack_webhook_url')`);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  let channelOverride: { adminUi?: boolean; email?: boolean; slack?: boolean } = {};
  try {
    const [row] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, ALERT_CHANNELS_KEY))
      .limit(1);
    if (row?.value) channelOverride = JSON.parse(row.value);
  } catch { /* ignore */ }
  void keys;
  return {
    adminUi: channelOverride.adminUi !== false,
    email: channelOverride.email !== false && !!map["alert_notification_email"],
    slack: channelOverride.slack !== false && !!map["alert_slack_webhook_url"],
    emailAddress: map["alert_notification_email"] ?? null,
    slackConfigured: !!map["alert_slack_webhook_url"],
  };
}

router.get("/admin/operations/alert-rules", async (_req, res): Promise<void> => {
  try {
    const overrides = await loadRuleOverrides();
    const channels = await loadChannels();

    const since = new Date(Date.now() - 7 * 86400000);
    const recent = await db
      .select({
        type: adminAlertsTable.type,
        c: count(),
      })
      .from(adminAlertsTable)
      .where(gte(adminAlertsTable.createdAt, since))
      .groupBy(adminAlertsTable.type);
    const byType = Object.fromEntries(recent.map((r) => [r.type, Number(r.c)]));

    const typeMap: Record<string, string[]> = {
      call_failure_rate: ["error_spike"],
      vobiz_balance: ["low_balance"],
      managed_key_health: ["provider_down"],
      usage_spike: ["usage_spike", "threshold_80", "threshold_90", "threshold_100"],
      provider_down: ["provider_down"],
      provider_latency: ["error_spike"],
      daily_revenue_drop: [],
      cost_per_min_increase: [],
    };

    const rules = DEFAULT_RULES.map((def) => {
      const o = overrides[def.id] ?? {};
      const related = typeMap[def.id] ?? [];
      const triggers7d = related.reduce((sum, t) => sum + (byType[t] ?? 0), 0);
      return {
        id: def.id,
        metric: def.metric,
        condition: def.condition,
        threshold: o.threshold ?? def.defaultThreshold,
        unit: def.unit,
        severity: o.severity ?? def.defaultSeverity,
        enabled: o.enabled !== false,
        description: def.description,
        monitor: def.monitor,
        channels: o.channels ?? [
          ...(channels.adminUi ? ["admin_ui"] : []),
          ...(channels.email ? ["email"] : []),
          ...(channels.slack ? ["slack"] : []),
        ],
        triggers7d,
      };
    });

    const [openCount] = await db
      .select({ c: count() })
      .from(adminAlertsTable)
      .where(isNull(adminAlertsTable.acknowledgedAt));

    res.json({
      generatedAt: new Date().toISOString(),
      channels,
      openAlerts: Number(openCount?.c ?? 0),
      rules,
    });
  } catch (err) {
    logger.error({ err }, "operations/alert-rules GET failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/operations/alert-rules/:id", async (req, res): Promise<void> => {
  try {
    const id = String(req.params.id);
    if (!DEFAULT_RULES.some((r) => r.id === id)) {
      res.status(404).json({ error: "Unknown rule id" });
      return;
    }
    const body = req.body as { enabled?: boolean; threshold?: number; severity?: string; channels?: string[] };
    const overrides = await loadRuleOverrides();
    const next = {
      ...(overrides[id] ?? {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(typeof body.threshold === "number" && Number.isFinite(body.threshold)
        ? { threshold: body.threshold }
        : {}),
      ...(body.severity && ["info", "warning", "critical"].includes(body.severity)
        ? { severity: body.severity }
        : {}),
      ...(Array.isArray(body.channels) ? { channels: body.channels } : {}),
    };
    overrides[id] = next;
    const value = JSON.stringify(overrides);
    await db
      .insert(platformSettingsTable)
      .values({ key: ALERT_RULES_KEY, value })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value, updatedAt: new Date() },
      });
    res.json({ id, ...next });
  } catch (err) {
    logger.error({ err }, "operations/alert-rules PATCH failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/operations/alert-channels", async (req, res): Promise<void> => {
  try {
    const body = req.body as { adminUi?: boolean; email?: boolean; slack?: boolean };
    const value = JSON.stringify({
      adminUi: body.adminUi !== false,
      email: body.email !== false,
      slack: body.slack !== false,
    });
    await db
      .insert(platformSettingsTable)
      .values({ key: ALERT_CHANNELS_KEY, value })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value, updatedAt: new Date() },
      });
    res.json(JSON.parse(value));
  } catch (err) {
    logger.error({ err }, "operations/alert-channels PATCH failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Email summary ───────────────────────────────────────────────────────────

router.get("/admin/operations/emails/summary", async (req, res): Promise<void> => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
    const since = new Date(Date.now() - days * 86400000);
    const [row] = await db
      .select({
        sent: sql<number>`count(*) filter (where ${platformEmailsTable.status} = 'sent')`,
        failed: sql<number>`count(*) filter (where ${platformEmailsTable.status} = 'failed')`,
        bounced: sql<number>`count(*) filter (where ${platformEmailsTable.status} = 'bounced')`,
        delivered: sql<number>`count(*) filter (where ${platformEmailsTable.status} in ('delivered','sent'))`,
        total: count(),
      })
      .from(platformEmailsTable)
      .where(gte(platformEmailsTable.sentAt, since));

    const byType = await db
      .select({
        emailType: platformEmailsTable.emailType,
        c: count(),
        failed: sql<number>`count(*) filter (where ${platformEmailsTable.status} <> 'sent')`,
      })
      .from(platformEmailsTable)
      .where(gte(platformEmailsTable.sentAt, since))
      .groupBy(platformEmailsTable.emailType)
      .orderBy(desc(count()));

    res.json({
      days,
      generatedAt: new Date().toISOString(),
      kpis: {
        total: Number(row?.total ?? 0),
        sent: Number(row?.sent ?? 0),
        delivered: Number(row?.delivered ?? 0),
        failed: Number(row?.failed ?? 0),
        bounced: Number(row?.bounced ?? 0),
      },
      byType: byType.map((r) => ({
        emailType: r.emailType,
        count: Number(r.c),
        failed: Number(r.failed),
      })),
    });
  } catch (err) {
    logger.error({ err }, "operations/emails/summary failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Audit summary ───────────────────────────────────────────────────────────

router.get("/admin/operations/audit/summary", async (req, res): Promise<void> => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
    const since = new Date(Date.now() - days * 86400000);

    const byAction = await db
      .select({
        action: adminAuditLogsTable.action,
        c: count(),
      })
      .from(adminAuditLogsTable)
      .where(gte(adminAuditLogsTable.createdAt, since))
      .groupBy(adminAuditLogsTable.action)
      .orderBy(desc(count()))
      .limit(40);

    const recent = await db
      .select({
        id: adminAuditLogsTable.id,
        adminId: adminAuditLogsTable.adminId,
        action: adminAuditLogsTable.action,
        targetUserId: adminAuditLogsTable.targetUserId,
        targetResourceType: adminAuditLogsTable.targetResourceType,
        targetResourceId: adminAuditLogsTable.targetResourceId,
        ipAddress: adminAuditLogsTable.ipAddress,
        createdAt: adminAuditLogsTable.createdAt,
      })
      .from(adminAuditLogsTable)
      .orderBy(desc(adminAuditLogsTable.createdAt))
      .limit(25);

    const sensitive = [
      "credit_wallet",
      "debit_wallet",
      "refund_wallet",
      "set_status_suspended",
      "set_status_active",
      "set_status_deleted",
      "start_impersonation",
      "edit_agent",
      "delete_agent",
    ];
    const [sensCount] = await db
      .select({ c: count() })
      .from(adminAuditLogsTable)
      .where(and(
        gte(adminAuditLogsTable.createdAt, since),
        inArray(adminAuditLogsTable.action, sensitive),
      ));

    res.json({
      days,
      generatedAt: new Date().toISOString(),
      sensitiveActions: Number(sensCount?.c ?? 0),
      byAction: byAction.map((r) => ({ action: r.action, count: Number(r.c) })),
      recent,
    });
  } catch (err) {
    logger.error({ err }, "operations/audit/summary failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
