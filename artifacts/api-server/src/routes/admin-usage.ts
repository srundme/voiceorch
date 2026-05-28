import { Router } from "express";
import {
  db,
  usageEventsTable,
  providerPricingTable,
  providerAllocationsTable,
  adminAlertsTable,
  usersTable,
} from "@workspace/db";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { invalidatePricingCache } from "../services/usage/record-usage.js";
import { sweepAlerts } from "../services/usage/alert-engine.js";

const router = Router();
router.use("/admin/usage", requireAdmin);
router.use("/admin/alerts", requireAdmin);

const VALID_SERVICES = new Set(["stt", "tts", "llm"]);

function parseDays(v: unknown): number {
  const n = Number(v ?? 30);
  if (!Number.isFinite(n) || n < 0) return 30;
  return Math.min(n, 365);
}

function dateFilter(days: number) {
  return days > 0
    ? gt(usageEventsTable.createdAt, sql`now() - ${`${days} days`}::interval`)
    : undefined;
}

async function getAllocationsMap(): Promise<Map<string, number>> {
  const rows = await db
    .select()
    .from(providerAllocationsTable)
    .where(isNull(providerAllocationsTable.workspaceId));
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(`${r.service}:${r.provider}`, Number(r.allocatedCostMicros));
  }
  return map;
}

// ── Overview ────────────────────────────────────────────────────────────────
router.get("/admin/usage/overview", async (req, res): Promise<void> => {
  try {
    const days = parseDays(req.query["days"]);
    const where = dateFilter(days);

    const [perService, dailyTrend, providerShare] = await Promise.all([
      db
        .select({
          service: usageEventsTable.service,
          usedMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
          eventCount: sql<string>`count(*)`,
          failedCount: sql<string>`count(*) filter (where ${usageEventsTable.success} = false)`,
        })
        .from(usageEventsTable)
        .where(where)
        .groupBy(usageEventsTable.service),
      db
        .select({
          bucket: sql<string>`to_char(date_trunc('day', ${usageEventsTable.createdAt}), 'YYYY-MM-DD')`,
          service: usageEventsTable.service,
          costMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
          eventCount: sql<string>`count(*)`,
        })
        .from(usageEventsTable)
        .where(where)
        .groupBy(sql`date_trunc('day', ${usageEventsTable.createdAt})`, usageEventsTable.service)
        .orderBy(asc(sql`date_trunc('day', ${usageEventsTable.createdAt})`)),
      db
        .select({
          provider: usageEventsTable.provider,
          costMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
          eventCount: sql<string>`count(*)`,
        })
        .from(usageEventsTable)
        .where(where)
        .groupBy(usageEventsTable.provider)
        .orderBy(desc(sql`sum(${usageEventsTable.estimatedCostMicros})`)),
    ]);

    const allocMap = await getAllocationsMap();
    const allocByService: Record<string, number> = { stt: 0, tts: 0, llm: 0 };
    for (const [k, v] of allocMap.entries()) {
      const svc = k.split(":")[0]!;
      allocByService[svc] = (allocByService[svc] ?? 0) + v;
    }

    const usedByService: Record<string, number> = { stt: 0, tts: 0, llm: 0 };
    const eventByService: Record<string, number> = { stt: 0, tts: 0, llm: 0 };
    const failedByService: Record<string, number> = { stt: 0, tts: 0, llm: 0 };
    for (const r of perService) {
      usedByService[r.service] = Number(r.usedMicros);
      eventByService[r.service] = Number(r.eventCount);
      failedByService[r.service] = Number(r.failedCount);
    }

    const combinedAllocated = Object.values(allocByService).reduce((a, b) => a + b, 0);
    const combinedUsed = Object.values(usedByService).reduce((a, b) => a + b, 0);
    const combinedEvents = Object.values(eventByService).reduce((a, b) => a + b, 0);
    const combinedFailed = Object.values(failedByService).reduce((a, b) => a + b, 0);

    res.json({
      combined: {
        allocatedMicros: combinedAllocated,
        usedMicros: combinedUsed,
        remainingMicros: Math.max(0, combinedAllocated - combinedUsed),
        eventCount: combinedEvents,
        failedCount: combinedFailed,
      },
      perService: (["stt", "tts", "llm"] as const).map((service) => ({
        service,
        kpis: {
          allocatedMicros: allocByService[service] ?? 0,
          usedMicros: usedByService[service] ?? 0,
          remainingMicros: Math.max(0, (allocByService[service] ?? 0) - (usedByService[service] ?? 0)),
          eventCount: eventByService[service] ?? 0,
          failedCount: failedByService[service] ?? 0,
        },
      })),
      dailyTrend: dailyTrend.map((r) => ({
        bucket: r.bucket,
        service: r.service,
        costMicros: Number(r.costMicros),
        eventCount: Number(r.eventCount),
      })),
      providerShare: providerShare.map((r) => ({
        provider: r.provider,
        costMicros: Number(r.costMicros),
        eventCount: Number(r.eventCount),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "admin/usage/overview failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Per-service ─────────────────────────────────────────────────────────────
router.get("/admin/usage/services/:service", async (req, res): Promise<void> => {
  try {
    const service = req.params["service"];
    if (!service || !VALID_SERVICES.has(service)) {
      res.status(400).json({ error: "service must be one of stt|tts|llm" });
      return;
    }
    const days = parseDays(req.query["days"]);
    const provider = (req.query["provider"] as string | undefined) || null;
    const model = (req.query["model"] as string | undefined) || null;
    const userId = (req.query["userId"] as string | undefined) || null;
    const workspaceId = (req.query["workspaceId"] as string | undefined) || null;

    const filters: any[] = [eq(usageEventsTable.service, service)];
    const dateF = dateFilter(days);
    if (dateF) filters.push(dateF);
    if (provider) filters.push(eq(usageEventsTable.provider, provider));
    if (model) filters.push(eq(usageEventsTable.model, model));
    if (userId) filters.push(eq(usageEventsTable.userId, userId));
    if (workspaceId) filters.push(eq(usageEventsTable.workspaceId, workspaceId));
    const where = and(...filters);

    const [breakdown, kpisRow, dailyTrend, weeklyTrend, monthlyTrend] = await Promise.all([
      db
        .select({
          provider: usageEventsTable.provider,
          model: usageEventsTable.model,
          costMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
          eventCount: sql<string>`count(*)`,
          failedCount: sql<string>`count(*) filter (where ${usageEventsTable.success} = false)`,
          inputTokens: sql<string>`coalesce(sum(${usageEventsTable.inputTokens}), 0)`,
          outputTokens: sql<string>`coalesce(sum(${usageEventsTable.outputTokens}), 0)`,
          audioSeconds: sql<string>`coalesce(sum(${usageEventsTable.audioSeconds}), 0)`,
          characters: sql<string>`coalesce(sum(${usageEventsTable.characters}), 0)`,
        })
        .from(usageEventsTable)
        .where(where)
        .groupBy(usageEventsTable.provider, usageEventsTable.model)
        .orderBy(desc(sql`sum(${usageEventsTable.estimatedCostMicros})`)),
      db
        .select({
          usedMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
          eventCount: sql<string>`count(*)`,
          failedCount: sql<string>`count(*) filter (where ${usageEventsTable.success} = false)`,
        })
        .from(usageEventsTable)
        .where(where),
      trendQuery(where, "day"),
      trendQuery(where, "week"),
      trendQuery(where, "month"),
    ]);

    const allocMap = await getAllocationsMap();
    const providerMap = new Map<string, {
      provider: string;
      allocatedMicros: number;
      usedMicros: number;
      eventCount: number;
      failedCount: number;
      models: Array<{
        model: string;
        costMicros: number;
        eventCount: number;
        inputTokens: number;
        outputTokens: number;
        audioSeconds: number;
        characters: number;
        allocatedMicros: number;
      }>;
    }>();

    for (const r of breakdown) {
      const key = r.provider;
      if (!providerMap.has(key)) {
        providerMap.set(key, {
          provider: r.provider,
          allocatedMicros: allocMap.get(`${service}:${r.provider}`) ?? 0,
          usedMicros: 0,
          eventCount: 0,
          failedCount: 0,
          models: [],
        });
      }
      const entry = providerMap.get(key)!;
      entry.usedMicros += Number(r.costMicros);
      entry.eventCount += Number(r.eventCount);
      entry.failedCount += Number(r.failedCount);
      entry.models.push({
        model: r.model ?? "default",
        costMicros: Number(r.costMicros),
        eventCount: Number(r.eventCount),
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        audioSeconds: Number(r.audioSeconds),
        characters: Number(r.characters),
        allocatedMicros: 0,
      });
    }

    const allocated = Array.from(allocMap.entries())
      .filter(([k]) => k.startsWith(`${service}:`))
      .reduce((s, [, v]) => s + v, 0);
    const used = Number(kpisRow[0]?.usedMicros ?? 0);

    res.json({
      service,
      kpis: {
        allocatedMicros: allocated,
        usedMicros: used,
        remainingMicros: Math.max(0, allocated - used),
        eventCount: Number(kpisRow[0]?.eventCount ?? 0),
        failedCount: Number(kpisRow[0]?.failedCount ?? 0),
      },
      providers: Array.from(providerMap.values()).map((p) => ({
        ...p,
        remainingMicros: Math.max(0, p.allocatedMicros - p.usedMicros),
      })),
      dailyTrend,
      weeklyTrend,
      monthlyTrend,
    });
  } catch (err) {
    req.log.error({ err }, "admin/usage/services failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function trendQuery(where: any, bucket: "day" | "week" | "month") {
  const fmt = bucket === "day" ? "YYYY-MM-DD" : bucket === "week" ? "IYYY-IW" : "YYYY-MM";
  const bucketLit = sql.raw(`'${bucket}'`);
  const fmtLit = sql.raw(`'${fmt}'`);
  const truncExpr = sql`date_trunc(${bucketLit}, ${usageEventsTable.createdAt})`;
  const rows = await db
    .select({
      bucket: sql<string>`to_char(${truncExpr}, ${fmtLit})`,
      costMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
      eventCount: sql<string>`count(*)`,
    })
    .from(usageEventsTable)
    .where(where)
    .groupBy(truncExpr)
    .orderBy(asc(truncExpr));
  return rows.map((r) => ({
    bucket: r.bucket,
    costMicros: Number(r.costMicros),
    eventCount: Number(r.eventCount),
  }));
}

// ── Users ───────────────────────────────────────────────────────────────────
router.get("/admin/usage/users", async (req, res): Promise<void> => {
  try {
    const days = parseDays(req.query["days"]);
    const where = dateFilter(days);

    const [rows, breakdown] = await Promise.all([
      db
        .select({
          userId: usageEventsTable.userId,
          email: usersTable.email,
          eventCount: sql<string>`count(*)`,
          costMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
          sttCostMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}) filter (where ${usageEventsTable.service} = 'stt'), 0)`,
          llmCostMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}) filter (where ${usageEventsTable.service} = 'llm'), 0)`,
          ttsCostMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}) filter (where ${usageEventsTable.service} = 'tts'), 0)`,
        })
        .from(usageEventsTable)
        .leftJoin(usersTable, eq(usageEventsTable.userId, usersTable.clerkId))
        .where(where)
        .groupBy(usageEventsTable.userId, usersTable.email)
        .orderBy(desc(sql`sum(${usageEventsTable.estimatedCostMicros})`))
        .limit(500),
      db
        .select({
          userId: usageEventsTable.userId,
          service: usageEventsTable.service,
          provider: usageEventsTable.provider,
          model: usageEventsTable.model,
          costMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
          eventCount: sql<string>`count(*)`,
        })
        .from(usageEventsTable)
        .where(where)
        .groupBy(usageEventsTable.userId, usageEventsTable.service, usageEventsTable.provider, usageEventsTable.model)
        .orderBy(desc(sql`sum(${usageEventsTable.estimatedCostMicros})`)),
    ]);

    const breakdownByUser = new Map<string | null, Array<{ service: string; provider: string; model: string | null; costMicros: number; eventCount: number }>>();
    for (const b of breakdown) {
      const list = breakdownByUser.get(b.userId) ?? [];
      list.push({
        service: b.service,
        provider: b.provider,
        model: b.model,
        costMicros: Number(b.costMicros),
        eventCount: Number(b.eventCount),
      });
      breakdownByUser.set(b.userId, list);
    }

    res.json({
      rows: rows.map((r) => ({
        userId: r.userId,
        email: r.email,
        eventCount: Number(r.eventCount),
        costMicros: Number(r.costMicros),
        sttCostMicros: Number(r.sttCostMicros),
        llmCostMicros: Number(r.llmCostMicros),
        ttsCostMicros: Number(r.ttsCostMicros),
        providers: breakdownByUser.get(r.userId) ?? [],
      })),
    });
  } catch (err) {
    req.log.error({ err }, "admin/usage/users failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Workspaces ──────────────────────────────────────────────────────────────
router.get("/admin/usage/workspaces", async (req, res): Promise<void> => {
  try {
    const days = parseDays(req.query["days"]);
    const where = dateFilter(days);

    const [rows, breakdown] = await Promise.all([
      db
        .select({
          workspaceId: usageEventsTable.workspaceId,
          eventCount: sql<string>`count(*)`,
          costMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
          sttCostMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}) filter (where ${usageEventsTable.service} = 'stt'), 0)`,
          llmCostMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}) filter (where ${usageEventsTable.service} = 'llm'), 0)`,
          ttsCostMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}) filter (where ${usageEventsTable.service} = 'tts'), 0)`,
        })
        .from(usageEventsTable)
        .where(where)
        .groupBy(usageEventsTable.workspaceId)
        .orderBy(desc(sql`sum(${usageEventsTable.estimatedCostMicros})`))
        .limit(500),
      db
        .select({
          workspaceId: usageEventsTable.workspaceId,
          service: usageEventsTable.service,
          provider: usageEventsTable.provider,
          model: usageEventsTable.model,
          costMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
          eventCount: sql<string>`count(*)`,
        })
        .from(usageEventsTable)
        .where(where)
        .groupBy(usageEventsTable.workspaceId, usageEventsTable.service, usageEventsTable.provider, usageEventsTable.model)
        .orderBy(desc(sql`sum(${usageEventsTable.estimatedCostMicros})`)),
    ]);

    const breakdownByWs = new Map<string | null, Array<{ service: string; provider: string; model: string | null; costMicros: number; eventCount: number }>>();
    for (const b of breakdown) {
      const list = breakdownByWs.get(b.workspaceId) ?? [];
      list.push({
        service: b.service,
        provider: b.provider,
        model: b.model,
        costMicros: Number(b.costMicros),
        eventCount: Number(b.eventCount),
      });
      breakdownByWs.set(b.workspaceId, list);
    }

    res.json({
      rows: rows.map((r) => ({
        workspaceId: r.workspaceId,
        eventCount: Number(r.eventCount),
        costMicros: Number(r.costMicros),
        sttCostMicros: Number(r.sttCostMicros),
        llmCostMicros: Number(r.llmCostMicros),
        ttsCostMicros: Number(r.ttsCostMicros),
        providers: breakdownByWs.get(r.workspaceId) ?? [],
      })),
    });
  } catch (err) {
    req.log.error({ err }, "admin/usage/workspaces failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── History ─────────────────────────────────────────────────────────────────
router.get("/admin/usage/history", async (req, res): Promise<void> => {
  try {
    const days = parseDays(req.query["days"]);
    const limit = Math.min(Number(req.query["limit"] ?? 50), 500);
    const offset = Math.max(0, Number(req.query["offset"] ?? 0));
    const service = (req.query["service"] as string | undefined) || null;
    const provider = (req.query["provider"] as string | undefined) || null;
    const model = (req.query["model"] as string | undefined) || null;
    const userId = (req.query["userId"] as string | undefined) || null;
    const workspaceId = (req.query["workspaceId"] as string | undefined) || null;
    const search = (req.query["search"] as string | undefined) || null;

    const filters: any[] = [];
    const dateF = dateFilter(days);
    if (dateF) filters.push(dateF);
    if (service) filters.push(eq(usageEventsTable.service, service));
    if (provider) filters.push(eq(usageEventsTable.provider, provider));
    if (model) filters.push(eq(usageEventsTable.model, model));
    if (userId) filters.push(eq(usageEventsTable.userId, userId));
    if (workspaceId) filters.push(eq(usageEventsTable.workspaceId, workspaceId));
    if (search) {
      filters.push(
        sql`(${usageEventsTable.provider} ILIKE ${"%" + search + "%"} OR ${usageEventsTable.model} ILIKE ${"%" + search + "%"} OR ${usageEventsTable.userId} ILIKE ${"%" + search + "%"})`,
      );
    }
    const where = filters.length ? and(...filters) : undefined;

    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: usageEventsTable.id,
          createdAt: usageEventsTable.createdAt,
          service: usageEventsTable.service,
          provider: usageEventsTable.provider,
          model: usageEventsTable.model,
          userId: usageEventsTable.userId,
          email: usersTable.email,
          workspaceId: usageEventsTable.workspaceId,
          callId: usageEventsTable.callId,
          inputTokens: usageEventsTable.inputTokens,
          outputTokens: usageEventsTable.outputTokens,
          audioSeconds: usageEventsTable.audioSeconds,
          characters: usageEventsTable.characters,
          latencyMs: usageEventsTable.latencyMs,
          estimatedCostMicros: usageEventsTable.estimatedCostMicros,
          success: usageEventsTable.success,
          errorMessage: usageEventsTable.errorMessage,
        })
        .from(usageEventsTable)
        .leftJoin(usersTable, eq(usageEventsTable.userId, usersTable.clerkId))
        .where(where)
        .orderBy(desc(usageEventsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: sql<string>`count(*)` }).from(usageEventsTable).where(where),
    ]);

    res.json({
      rows: rows.map((r) => ({
        ...r,
        estimatedCostMicros: Number(r.estimatedCostMicros),
      })),
      total: Number(totalRow[0]?.total ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "admin/usage/history failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Pricing CRUD ────────────────────────────────────────────────────────────
router.get("/admin/usage/pricing", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(providerPricingTable)
    .orderBy(asc(providerPricingTable.service), asc(providerPricingTable.provider), asc(providerPricingTable.model));
  res.json(rows.map(serializePricing));
});

router.put("/admin/usage/pricing", async (req, res): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const service = String(body["service"] ?? "");
    const provider = String(body["provider"] ?? "");
    const model = String(body["model"] ?? "");
    if (!VALID_SERVICES.has(service) || !provider || !model) {
      res.status(400).json({ error: "service, provider, model required" });
      return;
    }
    const values = {
      service,
      provider,
      model,
      inputTokenPricePerMillionMicros: Math.round(Number(body["inputTokenPricePerMillionMicros"] ?? 0)),
      outputTokenPricePerMillionMicros: Math.round(Number(body["outputTokenPricePerMillionMicros"] ?? 0)),
      audioSecondPriceMicros: Math.round(Number(body["audioSecondPriceMicros"] ?? 0)),
      characterPriceMicros: Math.round(Number(body["characterPriceMicros"] ?? 0)),
    };
    const [row] = await db
      .insert(providerPricingTable)
      .values(values)
      .onConflictDoUpdate({
        target: [providerPricingTable.service, providerPricingTable.provider, providerPricingTable.model],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    invalidatePricingCache();
    res.json(serializePricing(row!));
  } catch (err) {
    req.log.error({ err }, "admin/usage/pricing PUT failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/usage/pricing/:id", async (req, res): Promise<void> => {
  await db.delete(providerPricingTable).where(eq(providerPricingTable.id, Number(req.params["id"])));
  invalidatePricingCache();
  res.status(204).end();
});

function serializePricing(r: typeof providerPricingTable.$inferSelect) {
  return {
    id: r.id,
    service: r.service,
    provider: r.provider,
    model: r.model,
    inputTokenPricePerMillionMicros: Number(r.inputTokenPricePerMillionMicros),
    outputTokenPricePerMillionMicros: Number(r.outputTokenPricePerMillionMicros),
    audioSecondPriceMicros: Number(r.audioSecondPriceMicros),
    characterPriceMicros: Number(r.characterPriceMicros),
    updatedAt: r.updatedAt,
  };
}

// ── Allocations CRUD ────────────────────────────────────────────────────────
router.get("/admin/usage/allocations", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(providerAllocationsTable)
    .orderBy(asc(providerAllocationsTable.service), asc(providerAllocationsTable.provider));
  res.json(rows.map(serializeAllocation));
});

router.put("/admin/usage/allocations", async (req, res): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const service = String(body["service"] ?? "");
    const provider = String(body["provider"] ?? "");
    if (!VALID_SERVICES.has(service) || !provider) {
      res.status(400).json({ error: "service and provider required" });
      return;
    }
    const workspaceId = body["workspaceId"] != null ? String(body["workspaceId"]) : null;
    const values = {
      service,
      provider,
      workspaceId,
      allocatedCostMicros: Math.round(Number(body["allocatedCostMicros"] ?? 0)),
      lowBalanceThresholdMicros: Math.round(Number(body["lowBalanceThresholdMicros"] ?? 0)),
      notes: body["notes"] != null ? String(body["notes"]) : null,
    };

    // Manual upsert because Postgres unique indexes do not collide on NULL,
    // so onConflictDoUpdate would create duplicate "global" allocation rows
    // for the same (service, provider) pair when workspaceId IS NULL.
    const row = await db.transaction(async (tx) => {
      const wsFilter = workspaceId == null
        ? isNull(providerAllocationsTable.workspaceId)
        : eq(providerAllocationsTable.workspaceId, workspaceId);
      const existing = await tx
        .select()
        .from(providerAllocationsTable)
        .where(and(
          eq(providerAllocationsTable.service, service),
          eq(providerAllocationsTable.provider, provider),
          wsFilter,
        ))
        .limit(1);

      if (existing.length > 0) {
        const [updated] = await tx
          .update(providerAllocationsTable)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(providerAllocationsTable.id, existing[0]!.id))
          .returning();

        // Defensive: collapse any pre-existing duplicates created before this
        // upsert was made safe. Keep the row we just updated, delete the rest.
        const dupes = await tx
          .select({ id: providerAllocationsTable.id })
          .from(providerAllocationsTable)
          .where(and(
            eq(providerAllocationsTable.service, service),
            eq(providerAllocationsTable.provider, provider),
            wsFilter,
          ));
        const stale = dupes.map((d) => d.id).filter((id) => id !== updated!.id);
        if (stale.length > 0) {
          await tx.delete(providerAllocationsTable).where(inArray(providerAllocationsTable.id, stale));
        }
        return updated!;
      }
      const [inserted] = await tx.insert(providerAllocationsTable).values(values).returning();
      return inserted!;
    });

    res.json(serializeAllocation(row));
  } catch (err) {
    req.log.error({ err }, "admin/usage/allocations PUT failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/usage/allocations/:id", async (req, res): Promise<void> => {
  await db.delete(providerAllocationsTable).where(eq(providerAllocationsTable.id, Number(req.params["id"])));
  res.status(204).end();
});

function serializeAllocation(r: typeof providerAllocationsTable.$inferSelect) {
  return {
    id: r.id,
    service: r.service,
    provider: r.provider,
    workspaceId: r.workspaceId,
    allocatedCostMicros: Number(r.allocatedCostMicros),
    lowBalanceThresholdMicros: Number(r.lowBalanceThresholdMicros),
    notes: r.notes,
    updatedAt: r.updatedAt,
  };
}

// ── Alerts ──────────────────────────────────────────────────────────────────
router.get("/admin/alerts", async (req, res): Promise<void> => {
  try {
    // Trigger an opportunistic sweep so the dashboard sees fresh alerts
    void sweepAlerts();

    const limit = Math.min(Number(req.query["limit"] ?? 50), 500);
    const onlyUnack = req.query["onlyUnacknowledged"] === "true";

    const filters: any[] = [];
    if (onlyUnack) filters.push(isNull(adminAlertsTable.acknowledgedAt));
    const where = filters.length ? and(...filters) : undefined;

    const [alerts, unackRow] = await Promise.all([
      db.select().from(adminAlertsTable).where(where).orderBy(desc(adminAlertsTable.createdAt)).limit(limit),
      db.select({ c: sql<string>`count(*)` }).from(adminAlertsTable).where(isNull(adminAlertsTable.acknowledgedAt)),
    ]);

    res.json({
      alerts,
      unacknowledgedCount: Number(unackRow[0]?.c ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "admin/alerts list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/alerts/:id/acknowledge", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params["id"]);
    const adminUser = (req as any).adminUser as string | undefined;
    const [row] = await db
      .update(adminAlertsTable)
      .set({ acknowledgedAt: new Date(), acknowledgedBy: adminUser ?? "admin" })
      .where(eq(adminAlertsTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "admin/alerts ack failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Suppress unused-import warning for ilike (kept for future filter use)
void ilike;

export default router;
