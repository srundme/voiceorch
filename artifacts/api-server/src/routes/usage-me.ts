import { Router } from "express";
import { db, usageEventsTable, providerAllocationsTable } from "@workspace/db";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

router.get("/usage/me", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).clerkUserId as string;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const userFilter = eq(usageEventsTable.userId, userId);
    const monthFilter = gte(usageEventsTable.createdAt, monthStart);
    const monthWhere = and(userFilter, monthFilter);

    // Step 1: run all three queries in parallel.
    // workspaceRows fetches distinct workspaceIds across ALL the user's events
    // (not just this month) so we can resolve workspace-specific allocations.
    const [perServiceRows, recentEvents, workspaceRows] = await Promise.all([
      db
        .select({
          service: usageEventsTable.service,
          usedMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
          eventCount: sql<string>`count(*)`,
        })
        .from(usageEventsTable)
        .where(monthWhere)
        .groupBy(usageEventsTable.service),

      db
        .select({
          id: usageEventsTable.id,
          createdAt: usageEventsTable.createdAt,
          service: usageEventsTable.service,
          provider: usageEventsTable.provider,
          model: usageEventsTable.model,
          callId: usageEventsTable.callId,
          inputTokens: usageEventsTable.inputTokens,
          outputTokens: usageEventsTable.outputTokens,
          audioSeconds: usageEventsTable.audioSeconds,
          characters: usageEventsTable.characters,
          estimatedCostMicros: usageEventsTable.estimatedCostMicros,
          success: usageEventsTable.success,
        })
        .from(usageEventsTable)
        .where(userFilter)
        .orderBy(desc(usageEventsTable.createdAt))
        .limit(25),

      // Distinct workspaceIds the user has ever operated under
      db
        .selectDistinct({ workspaceId: usageEventsTable.workspaceId })
        .from(usageEventsTable)
        .where(userFilter),
    ]);

    // Step 2: Resolve allocations — global + any workspace-specific ones.
    // Workspace allocation takes precedence over global for the same service.
    const userWorkspaceIds = workspaceRows
      .map((r) => r.workspaceId)
      .filter((id): id is string => id !== null && id !== undefined);

    const allocCondition =
      userWorkspaceIds.length > 0
        ? or(isNull(providerAllocationsTable.workspaceId), inArray(providerAllocationsTable.workspaceId, userWorkspaceIds))
        : isNull(providerAllocationsTable.workspaceId);

    const allocations = await db
      .select()
      .from(providerAllocationsTable)
      .where(allocCondition);

    // Aggregate allocations per service.
    // Workspace-specific allocations take precedence over global ones for the
    // same service.  We keep a set of services that have workspace allocations
    // so we can skip the global allocation for those services.
    const wsAllocServices = new Set<string>();
    const allocByService: Record<string, number> = {};

    // First pass: workspace-specific
    for (const alloc of allocations) {
      if (alloc.workspaceId !== null) {
        wsAllocServices.add(alloc.service);
        allocByService[alloc.service] = (allocByService[alloc.service] ?? 0) + Number(alloc.allocatedCostMicros);
      }
    }
    // Second pass: global (only for services without a workspace allocation)
    for (const alloc of allocations) {
      if (alloc.workspaceId === null && !wsAllocServices.has(alloc.service)) {
        allocByService[alloc.service] = (allocByService[alloc.service] ?? 0) + Number(alloc.allocatedCostMicros);
      }
    }

    // Step 3: Build perService from the union of usage rows and allocation services
    // so budget appears even when this-month usage is zero.
    const usageByService: Record<string, { usedMicros: number; eventCount: number }> = {};
    for (const r of perServiceRows) {
      usageByService[r.service] = { usedMicros: Number(r.usedMicros), eventCount: Number(r.eventCount) };
    }

    const allServices = new Set([...Object.keys(usageByService), ...Object.keys(allocByService)]);

    const perService = Array.from(allServices).map((service) => {
      const used = usageByService[service]?.usedMicros ?? 0;
      const eventCount = usageByService[service]?.eventCount ?? 0;
      const allocated = allocByService[service] ?? 0;
      return {
        service,
        usedMicros: used,
        eventCount,
        allocatedMicros: allocated,
        remainingMicros: allocated > 0 ? Math.max(0, allocated - used) : 0,
      };
    });

    // Step 4: Compute totals from resolved allocations, not from usage rows.
    const totalUsedMicros = perService.reduce((s, r) => s + r.usedMicros, 0);
    const totalAllocatedMicros = Object.values(allocByService).reduce((s, v) => s + v, 0);

    res.json({
      totalUsedMicros,
      totalAllocatedMicros,
      totalRemainingMicros: totalAllocatedMicros > 0 ? Math.max(0, totalAllocatedMicros - totalUsedMicros) : 0,
      perService,
      recentEvents: recentEvents.map((e) => ({
        ...e,
        estimatedCostMicros: Number(e.estimatedCostMicros),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "usage/me failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
