/**
 * Admin V2 — Voice Operations: live calls, Call 360, failure center, call quality.
 */
import { Router } from "express";
import {
  db,
  callsTable,
  agentsTable,
  usersTable,
  walletTransactionsTable,
  usageEventsTable,
  platformSettingsTable,
  callRecordingsTable,
} from "@workspace/db";
import { and, or, desc, eq, gte, ilike, sql, count, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { getAllSessions } from "../orchestration/session.js";
import { executionIdSearchPattern, parseCallLookup } from "../services/admin-call-lookup.js";
import { shareableRecordingUrl, issueRecordingShareToken } from "../services/recording-share.js";

const router = Router();
router.use("/admin/voice", requireAdmin);

async function usdToInrRate(): Promise<number> {
  try {
    const [row] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "vobiz_usd_to_inr_rate"))
      .limit(1);
    const n = Number(row?.value ?? 96);
    return Number.isFinite(n) && n > 0 ? n : 96;
  } catch {
    return 96;
  }
}

function microsToPaise(micros: number, rate: number) {
  return Math.round((micros / 1_000_000) * rate * 100);
}

function categorizeFailure(reason: string | null): string {
  if (!reason) return "Unknown";
  const r = reason.toLowerCase();
  if (r.startsWith("stt error") || r.includes("stt")) return "STT";
  if (r.startsWith("llm error") || r.includes("llm")) return "LLM";
  if (r.startsWith("tts error") || r.includes("tts")) return "TTS";
  if (r.startsWith("telephony error") || r.includes("telephony") || r.includes("vobiz")) return "Telephony";
  if (r === "call timeout" || r.startsWith("timeout")) return "Timeout";
  if (r.includes("managed key") || r.includes("api key") || r.includes("unauthorized")) return "Managed key";
  if (r.includes("number") || r.includes("did")) return "Number";
  if (r.includes("agent") || r.includes("prompt") || r.includes("config")) return "Agent configuration";
  if (r.includes("user") || r.includes("wallet") || r.includes("balance")) return "User configuration";
  if (r.includes("provider")) return "Provider";
  return "Other";
}

function recommendAction(category: string): string {
  switch (category) {
    case "STT":
      return "Check STT provider health and managed key; review recent model changes.";
    case "LLM":
      return "Check LLM provider latency/errors and managed key; verify model availability.";
    case "TTS":
      return "Check TTS provider and voice listing; retry with fallback voice.";
    case "Telephony":
      return "Check VoBiz balance and trunk status; verify from/to numbers.";
    case "Timeout":
      return "Review silence timeouts and network; check agent max duration.";
    case "Managed key":
      return "Open Managed Keys → test/rotate the failing credential.";
    case "Number":
      return "Verify DID assignment and provider number status.";
    case "Agent configuration":
      return "Open Agent 360 → validate prompt, providers, and tools.";
    case "User configuration":
      return "Check user wallet balance and account status.";
    case "Provider":
      return "Open Provider analytics and Managed Keys health.";
    default:
      return "Inspect Call 360 error message and recent deploys.";
  }
}

// ─── Live calls ──────────────────────────────────────────────────────────────

router.get("/admin/voice/live", async (_req, res): Promise<void> => {
  try {
    const sessions = getAllSessions();
    if (sessions.length === 0) {
      res.json({ generatedAt: new Date().toISOString(), count: 0, calls: [] });
      return;
    }

    const callIds = [...new Set(sessions.map((s) => s.callId).filter((id) => Number.isFinite(id)))];
    const rows = callIds.length
      ? await db
          .select({
            id: callsTable.id,
            userId: callsTable.userId,
            agentId: callsTable.agentId,
            status: callsTable.status,
            toNumber: callsTable.toNumber,
            fromNumber: callsTable.fromNumber,
            primaryLanguage: callsTable.primaryLanguage,
            executionId: callsTable.executionId,
            createdAt: callsTable.createdAt,
            agentName: agentsTable.name,
            asrProvider: agentsTable.asrProvider,
            llmProvider: agentsTable.llmProvider,
            ttsProvider: agentsTable.ttsProvider,
            language: agentsTable.language,
            ownerEmail: usersTable.email,
            ownerName: usersTable.name,
          })
          .from(callsTable)
          .leftJoin(agentsTable, eq(callsTable.agentId, agentsTable.id))
          .leftJoin(usersTable, eq(callsTable.userId, usersTable.clerkId))
          .where(inArray(callsTable.id, callIds))
      : [];

    const byId = new Map(rows.map((r) => [r.id, r]));
    const now = Date.now();
    const calls = sessions.map((s) => {
      const row = byId.get(s.callId);
      const started = s.startedAt ? new Date(s.startedAt).getTime() : row?.createdAt ? new Date(row.createdAt).getTime() : now;
      return {
        sessionId: s.sessionId,
        callId: s.callId,
        startedAt: s.startedAt,
        durationSeconds: Math.max(0, Math.round((now - started) / 1000)),
        status: row?.status ?? "in_progress",
        agentId: row?.agentId ?? null,
        agentName: row?.agentName ?? null,
        userId: row?.userId ?? null,
        userEmail: row?.ownerEmail ?? null,
        userName: row?.ownerName ?? null,
        language: row?.primaryLanguage ?? row?.language ?? null,
        toNumber: row?.toNumber ?? null,
        fromNumber: row?.fromNumber ?? null,
        providers: {
          asr: row?.asrProvider ?? null,
          llm: row?.llmProvider ?? null,
          tts: row?.ttsProvider ?? null,
        },
        executionId: row?.executionId ?? null,
        stage: "live",
      };
    });

    res.json({ generatedAt: new Date().toISOString(), count: calls.length, calls });
  } catch (err) {
    logger.error({ err }, "voice/live failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Call search (execution id or numeric call id) ────────────────────────────

router.get("/admin/voice/call-search", async (req, res): Promise<void> => {
  try {
    const lookup = parseCallLookup(String(req.query["q"] ?? ""));
    if (!lookup) {
      res.json({ query: String(req.query["q"] ?? ""), count: 0, calls: [] });
      return;
    }

    const rows = await db
      .select({
        id: callsTable.id,
        executionId: callsTable.executionId,
        status: callsTable.status,
        userId: callsTable.userId,
        agentId: callsTable.agentId,
        toNumber: callsTable.toNumber,
        fromNumber: callsTable.fromNumber,
        durationSeconds: callsTable.durationSeconds,
        costCents: callsTable.costCents,
        errorMessage: callsTable.errorMessage,
        callSummary: callsTable.callSummary,
        createdAt: callsTable.createdAt,
        agentName: agentsTable.name,
        userEmail: usersTable.email,
        userName: usersTable.name,
      })
      .from(callsTable)
      .leftJoin(agentsTable, eq(callsTable.agentId, agentsTable.id))
      .leftJoin(usersTable, eq(callsTable.userId, usersTable.clerkId))
      .where(
        lookup.kind === "id"
          ? eq(callsTable.id, lookup.id)
          : lookup.kind === "execution"
          ? ilike(callsTable.executionId, executionIdSearchPattern(lookup.executionId))
          : or(
              ilike(callsTable.toNumber, `%${lookup.phone}%`),
              ilike(callsTable.fromNumber, `%${lookup.phone}%`),
            ),
      )
      .orderBy(desc(callsTable.createdAt))
      .limit(50);

    res.json({ query: String(req.query["q"] ?? ""), count: rows.length, calls: rows });
  } catch (err) {
    logger.error({ err }, "voice/call-search failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Call 360 ────────────────────────────────────────────────────────────────

router.get("/admin/voice/calls/:callId", async (req, res): Promise<void> => {
  try {
    // Operators reach this page from an execution id far more often than a row id.
    const lookup = parseCallLookup(req.params.callId);
    if (!lookup) {
      res.status(400).json({ error: "Invalid call id" });
      return;
    }

    let callId: number;
    if (lookup.kind === "id") {
      callId = lookup.id;
    } else {
      // A phone number opens the latest call to or from it, matching call-search.
      const [match] = await db
        .select({ id: callsTable.id })
        .from(callsTable)
        .where(
          lookup.kind === "execution"
            ? ilike(callsTable.executionId, executionIdSearchPattern(lookup.executionId))
            : or(
                ilike(callsTable.toNumber, `%${lookup.phone}%`),
                ilike(callsTable.fromNumber, `%${lookup.phone}%`),
              ),
        )
        .orderBy(desc(callsTable.createdAt))
        .limit(1);
      if (!match) {
        res.status(404).json({ error: "Call not found" });
        return;
      }
      callId = match.id;
    }

    const [row] = await db
      .select({
        call: callsTable,
        agentName: agentsTable.name,
        asrProvider: agentsTable.asrProvider,
        llmProvider: agentsTable.llmProvider,
        ttsProvider: agentsTable.ttsProvider,
        telephonyProvider: agentsTable.telephonyProvider,
        language: agentsTable.language,
        voice: agentsTable.ttsVoiceName,
        ownerEmail: usersTable.email,
        ownerName: usersTable.name,
        ownerDbId: usersTable.id,
      })
      .from(callsTable)
      .leftJoin(agentsTable, eq(callsTable.agentId, agentsTable.id))
      .leftJoin(usersTable, eq(callsTable.userId, usersTable.clerkId))
      .where(eq(callsTable.id, callId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Call not found" });
      return;
    }

    const fx = await usdToInrRate();
    const c = row.call;

    const [[rev], [cost], usage] = await Promise.all([
      db
        .select({
          paise: sql<number>`coalesce(sum(abs(${walletTransactionsTable.amountCents})), 0)`,
        })
        .from(walletTransactionsTable)
        .where(and(eq(walletTransactionsTable.callId, callId), eq(walletTransactionsTable.type, "call_debit"))),
      db
        .select({
          micros: sql<number>`coalesce(sum(${usageEventsTable.estimatedCostMicros}), 0)`,
        })
        .from(usageEventsTable)
        .where(eq(usageEventsTable.callId, callId)),
      db
        .select({
          service: usageEventsTable.service,
          provider: usageEventsTable.provider,
          success: usageEventsTable.success,
          latencyMs: usageEventsTable.latencyMs,
          errorMessage: usageEventsTable.errorMessage,
          createdAt: usageEventsTable.createdAt,
        })
        .from(usageEventsTable)
        .where(eq(usageEventsTable.callId, callId))
        .orderBy(desc(usageEventsTable.createdAt))
        .limit(50),
    ]);

    const revenuePaise = Number(rev?.paise ?? 0) || (c.costCents ?? 0);
    const costPaise = microsToPaise(Number(cost?.micros ?? 0), fx);

    res.json({
      generatedAt: new Date().toISOString(),
      call: {
        id: c.id,
        status: c.status,
        userId: c.userId,
        userEmail: row.ownerEmail,
        userName: row.ownerName,
        agentId: c.agentId,
        agentName: row.agentName,
        toNumber: c.toNumber,
        fromNumber: c.fromNumber,
        durationSeconds: c.durationSeconds,
        startedAt: c.createdAt,
        endedAt: c.endedAt,
        outcome: c.successEvaluation ?? c.status,
        errorMessage: c.errorMessage,
        transcript: c.transcript,
        callSummary: c.callSummary,
        recordingUrl: c.recordingUrl,
        shareUrl: c.recordingUrl ? shareableRecordingUrl(c.id) : null,
        executionId: c.executionId,
        primaryLanguage: c.primaryLanguage ?? row.language,
        transferType: c.transferType,
        transferTarget: c.transferTarget,
        amdResult: c.amdResult,
        providers: {
          asr: row.asrProvider,
          llm: row.llmProvider,
          tts: row.ttsProvider,
          telephony: row.telephonyProvider,
          voice: row.voice,
        },
        latency: {
          sttMs: c.sttLatencyMs,
          llmMs: c.llmLatencyMs,
          ttsMs: c.ttsFirstChunkMs,
        },
        economics: {
          revenuePaise,
          costPaise,
          profitPaise: revenuePaise - costPaise,
        },
      },
      technicalLogs: usage.map((u) => ({
        service: u.service,
        provider: u.provider,
        success: u.success,
        latencyMs: u.latencyMs,
        error: u.errorMessage,
        at: u.createdAt,
      })),
    });
  } catch (err) {
    logger.error({ err }, "voice/calls/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Direct recording audio download ──────────────────────────────────────────

router.get("/admin/voice/calls/:callId/recording", async (req, res): Promise<void> => {
  try {
    const rawId = req.params.callId;
    const callId = Number(rawId);
    if (!Number.isFinite(callId)) {
      res.status(400).json({ error: "Invalid call id" });
      return;
    }

    const [rec] = await db
      .select({
        audio: callRecordingsTable.audio,
        contentType: callRecordingsTable.contentType,
      })
      .from(callRecordingsTable)
      .where(eq(callRecordingsTable.callId, callId))
      .orderBy(desc(callRecordingsTable.id))
      .limit(1);

    if (!rec) {
      res.status(404).json({ error: "Recording not found in database" });
      return;
    }

    const token = issueRecordingShareToken(callId);
    res.setHeader("Content-Type", rec.contentType || "audio/wav");
    res.setHeader("Content-Disposition", `attachment; filename="call-${callId}.wav"`);
    res.setHeader("X-Share-Token", token);
    res.send(rec.audio);
  } catch (err) {
    logger.error({ err }, "voice/calls/:id/recording failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Failure center ──────────────────────────────────────────────────────────

router.get("/admin/voice/failures", async (req, res): Promise<void> => {
  try {
    const days = Math.min(30, Math.max(1, Number(req.query.days ?? 7)));
    const since = new Date(Date.now() - days * 86400000);

    const [totals] = await db
      .select({
        total: count(),
        failed: sql<number>`count(*) filter (where ${callsTable.status} = 'failed' or coalesce(${callsTable.errorMessage},'') <> '')`,
      })
      .from(callsTable)
      .where(gte(callsTable.createdAt, since));

    const result = await db.execute(sql`
      select
        case
          when error_message ilike 'STT error%' or error_message ilike '%stt%' then 'STT'
          when error_message ilike 'LLM error%' or error_message ilike '%llm%' then 'LLM'
          when error_message ilike 'TTS error%' or error_message ilike '%tts%' then 'TTS'
          when error_message ilike 'Telephony error%' or error_message ilike '%telephony%' or error_message ilike '%vobiz%' then 'Telephony'
          when error_message = 'Call timeout' or error_message ilike 'timeout%' then 'Timeout'
          when error_message ilike '%managed key%' or error_message ilike '%api key%' or error_message ilike '%unauthorized%' then 'Managed key'
          when error_message ilike '%number%' or error_message ilike '%did%' then 'Number'
          when error_message ilike '%agent%' or error_message ilike '%prompt%' or error_message ilike '%config%' then 'Agent configuration'
          when error_message ilike '%wallet%' or error_message ilike '%balance%' then 'User configuration'
          when error_message ilike '%provider%' then 'Provider'
          else 'Other'
        end as category,
        count(*)::int as failure_count,
        count(distinct user_id)::int as affected_users,
        count(distinct agent_id)::int as affected_agents,
        min(created_at) as first_seen,
        max(created_at) as last_seen,
        mode() within group (order by left(coalesce(error_message,''), 120)) as sample_error
      from calls
      where created_at >= ${since}
        and (status = 'failed' or coalesce(error_message,'') <> '')
      group by 1
      order by failure_count desc
    `);

    const totalCalls = Number(totals?.total ?? 0);
    const failedCalls = Number(totals?.failed ?? 0);

    const groups = (result.rows as Array<Record<string, unknown>>).map((r) => {
      const category = String(r.category ?? "Other");
      const failureCount = Number(r.failure_count ?? 0);
      return {
        category,
        failureCount,
        failureRatePct: totalCalls > 0 ? Math.round((failureCount / totalCalls) * 1000) / 10 : 0,
        affectedUsers: Number(r.affected_users ?? 0),
        affectedAgents: Number(r.affected_agents ?? 0),
        firstSeen: r.first_seen ? String(r.first_seen) : null,
        lastSeen: r.last_seen ? String(r.last_seen) : null,
        sampleError: r.sample_error ? String(r.sample_error) : null,
        recommendedAction: recommendAction(category),
      };
    });

    // Recent failed calls for drill-down
    const recent = await db
      .select({
        id: callsTable.id,
        userId: callsTable.userId,
        agentId: callsTable.agentId,
        agentName: agentsTable.name,
        errorMessage: callsTable.errorMessage,
        status: callsTable.status,
        createdAt: callsTable.createdAt,
        ownerEmail: usersTable.email,
      })
      .from(callsTable)
      .leftJoin(agentsTable, eq(callsTable.agentId, agentsTable.id))
      .leftJoin(usersTable, eq(callsTable.userId, usersTable.clerkId))
      .where(and(
        gte(callsTable.createdAt, since),
        sql`(${callsTable.status} = 'failed' or coalesce(${callsTable.errorMessage},'') <> '')`,
      ))
      .orderBy(desc(callsTable.createdAt))
      .limit(50);

    res.json({
      days,
      generatedAt: new Date().toISOString(),
      kpis: {
        totalCalls,
        failedCalls,
        failureRatePct: totalCalls > 0 ? Math.round((failedCalls / totalCalls) * 1000) / 10 : 0,
      },
      groups,
      recent: recent.map((r) => ({
        ...r,
        category: categorizeFailure(r.errorMessage),
      })),
    });
  } catch (err) {
    logger.error({ err }, "voice/failures failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Call quality ────────────────────────────────────────────────────────────

router.get("/admin/voice/call-quality", async (req, res): Promise<void> => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days ?? 7)));
    const since = new Date(Date.now() - days * 86400000);

    const [kpis] = await db
      .select({
        calls: count(),
        completed: sql<number>`count(*) filter (where lower(coalesce(${callsTable.status},'')) in ('completed','success','ended'))`,
        failed: sql<number>`count(*) filter (where ${callsTable.status} = 'failed' or coalesce(${callsTable.errorMessage},'') <> '')`,
        transferred: sql<number>`count(*) filter (where coalesce(${callsTable.transferType},'') <> '')`,
        avgDuration: sql<number>`avg(${callsTable.durationSeconds})`,
        avgStt: sql<number>`avg(${callsTable.sttLatencyMs})`,
        avgLlm: sql<number>`avg(${callsTable.llmLatencyMs})`,
        avgTts: sql<number>`avg(${callsTable.ttsFirstChunkMs})`,
      })
      .from(callsTable)
      .where(gte(callsTable.createdAt, since));

    const calls = Number(kpis?.calls ?? 0);
    const completed = Number(kpis?.completed ?? 0);
    const failed = Number(kpis?.failed ?? 0);
    const transferred = Number(kpis?.transferred ?? 0);

    const providers = await db.execute(sql`
      select
        coalesce(a.asr_provider, 'unknown') as provider,
        'stt' as service,
        count(c.id)::int as calls,
        round(coalesce(sum(c.duration_seconds),0)/60.0, 2) as minutes,
        count(c.id) filter (where c.status = 'failed' or coalesce(c.error_message,'') <> '')::int as failed,
        avg(c.stt_latency_ms) as avg_latency
      from calls c
      join agents a on a.id = c.agent_id
      where c.created_at >= ${since}
      group by 1
      order by calls desc
      limit 20
    `);

    const providerRows = (providers.rows as Array<Record<string, unknown>>).map((r) => {
      const c = Number(r.calls ?? 0);
      const f = Number(r.failed ?? 0);
      return {
        provider: String(r.provider),
        service: String(r.service),
        calls: c,
        minutes: Number(r.minutes ?? 0),
        failureRatePct: c > 0 ? Math.round((f / c) * 1000) / 10 : 0,
        avgLatencyMs: r.avg_latency != null ? Math.round(Number(r.avg_latency)) : null,
        costPaise: 0,
      };
    });

    res.json({
      days,
      generatedAt: new Date().toISOString(),
      kpis: {
        calls,
        completionRatePct: calls > 0 ? Math.round((completed / calls) * 1000) / 10 : 0,
        errorRatePct: calls > 0 ? Math.round((failed / calls) * 1000) / 10 : 0,
        disconnectRatePct: calls > 0 ? Math.round(((calls - completed) / calls) * 1000) / 10 : 0,
        transferRatePct: calls > 0 ? Math.round((transferred / calls) * 1000) / 10 : 0,
        avgDurationSeconds: kpis?.avgDuration != null ? Math.round(Number(kpis.avgDuration)) : null,
        avgSttMs: kpis?.avgStt != null ? Math.round(Number(kpis.avgStt)) : null,
        avgLlmMs: kpis?.avgLlm != null ? Math.round(Number(kpis.avgLlm)) : null,
        avgTtsMs: kpis?.avgTts != null ? Math.round(Number(kpis.avgTts)) : null,
        avgLatencyMs:
          kpis?.avgStt != null || kpis?.avgLlm != null || kpis?.avgTts != null
            ? Math.round(
                ((Number(kpis?.avgStt ?? 0) + Number(kpis?.avgLlm ?? 0) + Number(kpis?.avgTts ?? 0)) /
                  [kpis?.avgStt, kpis?.avgLlm, kpis?.avgTts].filter((x) => x != null).length) || 1,
              )
            : null,
      },
      providers: providerRows,
    });
  } catch (err) {
    logger.error({ err }, "voice/call-quality failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
