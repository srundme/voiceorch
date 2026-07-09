import { Router } from "express";
import { db, usageEventsTable, providerAllocationsTable, callsTable } from "@workspace/db";
import { usersTable, walletTransactionsTable } from "@workspace/db/schema";
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

    // Resolve the DB user once so we can query wallet transactions (which use integer userId).
    const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, userId));

    // Step 1: run all queries in parallel.
    // workspaceRows fetches distinct workspaceIds across ALL the user's events
    // (not just this month) so we can resolve workspace-specific allocations.
    const [perServiceRows, recentEvents, workspaceRows, callChargeAgg, recentCallCharges, callsThisMonthAgg] = await Promise.all([
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

      // Call charges this month: sum of abs(amountCents) for call_debit transactions
      dbUser
        ? db
            .select({
              totalCents: sql<string>`coalesce(sum(abs(${walletTransactionsTable.amountCents})), 0)`,
              callCount:  sql<string>`count(*)`,
            })
            .from(walletTransactionsTable)
            .where(
              and(
                eq(walletTransactionsTable.userId, dbUser.id),
                eq(walletTransactionsTable.type, "call_debit"),
                gte(walletTransactionsTable.createdAt, monthStart),
              ),
            )
        : Promise.resolve([{ totalCents: "0", callCount: "0" }]),

      // Recent call charge rows (last 20)
      dbUser
        ? db
            .select({
              id:          walletTransactionsTable.id,
              createdAt:   walletTransactionsTable.createdAt,
              callId:      walletTransactionsTable.callId,
              amountCents: walletTransactionsTable.amountCents,
              description: walletTransactionsTable.description,
            })
            .from(walletTransactionsTable)
            .where(
              and(
                eq(walletTransactionsTable.userId, dbUser.id),
                eq(walletTransactionsTable.type, "call_debit"),
              ),
            )
            .orderBy(desc(walletTransactionsTable.createdAt))
            .limit(20)
        : Promise.resolve([]),

      // Calls placed by this user this month (for Total Calls / Total Minutes)
      db
        .select({
          callCount: sql<string>`count(*)`,
          totalDurationSeconds: sql<string>`coalesce(sum(${callsTable.durationSeconds}), 0)`,
        })
        .from(callsTable)
        .where(and(eq(callsTable.userId, userId), gte(callsTable.createdAt, monthStart))),
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

    const chargeAgg = callChargeAgg[0] ?? { totalCents: "0", callCount: "0" };
    const callChargeTotalCents = Number(chargeAgg.totalCents);

    // Combined "Total Spend This Month": platform call fees (wallet_transactions,
    // cents) + AI service costs (usage_events, micros). These are two distinct
    // cost buckets (platform fee vs. underlying provider cost) so summing them
    // does not double-count — but we DO need to add them, which the old code
    // never did (it only surfaced totalUsedMicros on the headline card).
    const callChargeTotalMicros = callChargeTotalCents * 10_000; // 1 cent = 10,000 micros
    const totalSpendMicros = totalUsedMicros + callChargeTotalMicros;

    const callsAgg = callsThisMonthAgg[0] ?? { callCount: "0", totalDurationSeconds: "0" };
    const totalCalls = Number(callsAgg.callCount);
    const totalMinutes = Number(callsAgg.totalDurationSeconds) / 60;
    const avgCostPerCallMicros = totalCalls > 0 ? Math.round(totalSpendMicros / totalCalls) : 0;

    // Step 5: Per-call cost breakdown — join recent call-charge rows to their
    // usage_events (by callId) to expose STT/LLM/TTS cost + providers/models,
    // and to calls.durationSeconds for call duration.
    const chargeCallIds = recentCallCharges
      .map((c) => c.callId)
      .filter((id): id is number => id !== null && id !== undefined);

    const [callUsageRows, callDurationRows] = await Promise.all([
      chargeCallIds.length > 0
        ? db
            .select({
              callId: usageEventsTable.callId,
              service: usageEventsTable.service,
              provider: usageEventsTable.provider,
              model: usageEventsTable.model,
              costMicros: sql<string>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
              audioSeconds: sql<string>`coalesce(sum(${usageEventsTable.audioSeconds}), 0)`,
              inputTokens: sql<string>`coalesce(sum(${usageEventsTable.inputTokens}), 0)`,
              outputTokens: sql<string>`coalesce(sum(${usageEventsTable.outputTokens}), 0)`,
              characters: sql<string>`coalesce(sum(${usageEventsTable.characters}), 0)`,
            })
            .from(usageEventsTable)
            .where(inArray(usageEventsTable.callId, chargeCallIds))
            .groupBy(usageEventsTable.callId, usageEventsTable.service, usageEventsTable.provider, usageEventsTable.model)
        : Promise.resolve([]),
      chargeCallIds.length > 0
        ? db
            .select({ id: callsTable.id, durationSeconds: callsTable.durationSeconds })
            .from(callsTable)
            .where(inArray(callsTable.id, chargeCallIds))
        : Promise.resolve([]),
    ]);

    const durationByCallId = new Map<number, number | null>();
    for (const r of callDurationRows) durationByCallId.set(r.id, r.durationSeconds);

    type CallCostBreakdown = {
      sttCostMicros: number;
      llmCostMicros: number;
      ttsCostMicros: number;
      aiServiceCostMicros: number;
      sttAudioSeconds: number;
      llmInputTokens: number;
      llmOutputTokens: number;
      ttsCharacters: number;
      providers: { service: string; provider: string; model: string | null }[];
    };
    const breakdownByCallId = new Map<number, CallCostBreakdown>();
    for (const row of callUsageRows) {
      if (row.callId === null || row.callId === undefined) continue;
      const entry = breakdownByCallId.get(row.callId) ?? {
        sttCostMicros: 0,
        llmCostMicros: 0,
        ttsCostMicros: 0,
        aiServiceCostMicros: 0,
        sttAudioSeconds: 0,
        llmInputTokens: 0,
        llmOutputTokens: 0,
        ttsCharacters: 0,
        providers: [],
      };
      const cost = Number(row.costMicros);
      if (row.service === "stt") {
        entry.sttCostMicros += cost;
        entry.sttAudioSeconds += Number(row.audioSeconds);
      } else if (row.service === "llm") {
        entry.llmCostMicros += cost;
        entry.llmInputTokens += Number(row.inputTokens);
        entry.llmOutputTokens += Number(row.outputTokens);
      } else if (row.service === "tts") {
        entry.ttsCostMicros += cost;
        entry.ttsCharacters += Number(row.characters);
      }
      entry.aiServiceCostMicros += cost;
      entry.providers.push({ service: row.service, provider: row.provider, model: row.model ?? null });
      breakdownByCallId.set(row.callId, entry);
    }

    res.json({
      totalUsedMicros,
      totalAllocatedMicros,
      totalRemainingMicros: totalAllocatedMicros > 0 ? Math.max(0, totalAllocatedMicros - totalUsedMicros) : 0,
      totalSpendMicros,
      totalCalls,
      totalMinutes,
      avgCostPerCallMicros,
      perService,
      recentEvents: recentEvents.map((e) => ({
        ...e,
        estimatedCostMicros: Number(e.estimatedCostMicros),
      })),
      callCharges: {
        totalCents: callChargeTotalCents,
        callCount:  Number(chargeAgg.callCount),
        recentCharges: recentCallCharges.map((t) => {
          const breakdown = t.callId != null ? breakdownByCallId.get(t.callId) : undefined;
          const platformFeeCents = Math.abs(t.amountCents);
          const aiServiceCostMicros = breakdown?.aiServiceCostMicros ?? 0;
          return {
            id:          t.id,
            createdAt:   t.createdAt.toISOString(),
            callId:      t.callId ?? null,
            amountCents: t.amountCents,
            description: t.description,
            durationSeconds: t.callId != null ? (durationByCallId.get(t.callId) ?? null) : null,
            sttCostMicros: breakdown?.sttCostMicros ?? 0,
            llmCostMicros: breakdown?.llmCostMicros ?? 0,
            ttsCostMicros: breakdown?.ttsCostMicros ?? 0,
            aiServiceCostMicros,
            totalCostMicros: platformFeeCents * 10_000 + aiServiceCostMicros,
            sttAudioSeconds: breakdown?.sttAudioSeconds ?? 0,
            llmInputTokens: breakdown?.llmInputTokens ?? 0,
            llmOutputTokens: breakdown?.llmOutputTokens ?? 0,
            ttsCharacters: breakdown?.ttsCharacters ?? 0,
            providers: breakdown?.providers ?? [],
          };
        }),
      },
    });
  } catch (err) {
    req.log.error({ err }, "usage/me failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
