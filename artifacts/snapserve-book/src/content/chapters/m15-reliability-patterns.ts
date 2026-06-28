import type { Chapter } from "../types";

export const reliabilityPatterns: Chapter = {
  slug: "reliability-patterns",
  moduleId: "m15",
  number: "16.2",
  title: "Production Reliability Patterns",
  summary:
    "The safety nets that keep SnapServe running when things go wrong — stuck-call sweeps, recording finalize timeouts, DB retry wrappers, and the turn safety net.",
  estMinutes: 14,
  fileRef: "artifacts/api-server/src/services/batchScheduler.ts",
  prerequisites: ["session-and-pipeline", "reading-call-logs", "retry-engine"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Why reliability patterns matter in voice",
      paragraphs: [
        "A voice call is a real-time system with no 'undo'. If the LLM hangs mid-turn, the caller hears silence. If `endSession()` hangs, the call row stays `in_progress` forever. If two server instances race to process the same retry, the caller gets two calls back-to-back.",
        "SnapServe has accumulated a set of reliability patterns — defensive code that handles the inevitable: network timeouts, DB pool exhaustion, concurrent processing, and telephony provider inconsistencies. Understanding these patterns helps you debug production issues and write robust new features.",
        "This chapter catalogues the patterns, where they live, and why each exists. Think of it as a guided tour of the defensive layer.",
      ],
    },
    {
      kind: "concept",
      title: "Pattern 1: Recording finalize timeout",
      body: [
        "**Problem**: `endSession()` awaits `recording.finalize()`, which does a `db.insert(WAV blob)`. When multiple calls end simultaneously, the DB pool can be exhausted — the insert waits indefinitely for a connection, blocking the `db.update(status:'completed')` that follows. The call stays `in_progress` forever.",
        "**Fix**: `Promise.race([finalizeProm, timeoutProm])` with a 60-second timeout. If the WAV insert takes longer than 60 seconds, the race resolves with `{ url: null, error: 'Recording finalize timed out' }` and `endSession()` proceeds to mark the call completed. A failed recording is survivable; a permanently stuck call status is not.",
        "**Location**: `orchestration/session.ts`, `endSession()` function, around line 1190.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/session.ts",
      language: "typescript",
      intro: "The recording finalize timeout — `Promise.race` ensures `endSession` can never hang indefinitely.",
      code: `const finalizeProm = session.pipeline.getRecording().finalize(session.callId);
const timeoutProm  = new Promise<{ url: null; error: string }>((resolve) =>
  setTimeout(
    () => resolve({ url: null, error: "Recording finalize timed out after 60 s" }),
    60_000,
  ),
);
const result = await Promise.race([finalizeProm, timeoutProm])
  .catch((err) => ({
    url: null as null,
    error: err instanceof Error ? err.message : String(err),
  }));`,
      lines: [
        {
          lines: "1",
          label: "start finalize immediately",
          explanation:
            "`finalizeProm` starts the WAV insert right away. `Promise.race` doesn't delay the start — both promises run concurrently. If the insert completes in 2 seconds, the race resolves with the real result, not the timeout.",
        },
        {
          lines: "2-7",
          label: "60-second timeout promise",
          explanation:
            "The timeout promise never rejects — it resolves to a valid `RecordingResult` shape with `url: null` and `error: 'timed out'`. This means the `.catch` below is only for `finalizeProm` errors (a Postgres error would reject `finalizeProm`), not timeout cases.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Pattern 2: Stuck-call sweeps",
      body: [
        "**Problem**: Even with the recording finalize timeout, a call could become stuck `in_progress` due to a process crash mid-`endSession`, a DB error on the status update itself, or a bug introduced in a future change.",
        "**Fix**: `sweepStuckInProgressCalls()` runs every 60 seconds in `batchScheduler.ts`. It finds calls that have been `in_progress` for more than 30 minutes (tunable via `STUCK_CALL_TIMEOUT_MS`) and force-closes them with `status = 'completed'`.",
        "**Companion pattern**: `sweepStuckCallingLeads()` does the same for campaign leads stuck in `calling` status. Both sweeps use the same pattern: SELECT stuck rows with a cutoff timestamp, UPDATE each with a double-check WHERE clause (`status = 'in_progress'` in the update predicate) to handle the race where the call ends naturally between the SELECT and the UPDATE.",
      ],
    },
    {
      kind: "concept",
      title: "Pattern 3: pg_try_advisory_xact_lock",
      body: [
        "**Problem**: SnapServe runs as multiple Railway instances. Any background task that processes DB rows (callback poller, retry engine, batch scheduler) can race across instances, causing the same job to be processed twice.",
        "**Fix**: `pg_try_advisory_xact_lock(integer)` — a PostgreSQL-native distributed lock. Acquire it inside a transaction; it's released automatically when the transaction commits or rolls back. `pg_try_advisory_xact_lock` returns `false` immediately if another session holds the lock (non-blocking, unlike `pg_advisory_xact_lock` which waits).",
        "The lock key is typically the row's integer ID (for retry jobs, callback rows) or a deterministic hash (for slot-booking, where the slot's Unix ms timestamp is used). The key must be a PostgreSQL `bigint` — if your ID is a UUID, hash it to an integer with `hashtext(uuid)::bigint`.",
      ],
    },
    {
      kind: "code",
      filename: "services/batchScheduler.ts",
      language: "typescript",
      intro: "The stuck-call sweep — finds calls > 30 min in_progress and force-closes them.",
      code: `async function sweepStuckInProgressCalls(): Promise<void> {
  const STUCK_MS = parseInt(process.env["STUCK_CALL_TIMEOUT_MS"] ?? "0") || 30 * 60 * 1000;
  const cutoff   = new Date(Date.now() - STUCK_MS);

  const stuck = await db
    .select({ id: callsTable.id, createdAt: callsTable.createdAt })
    .from(callsTable)
    .where(and(
      eq(callsTable.status, "in_progress"),
      lt(callsTable.createdAt, cutoff),
    ))
    .limit(50);

  for (const call of stuck) {
    const durationSeconds = Math.floor((Date.now() - call.createdAt.getTime()) / 1000);
    await db.update(callsTable)
      .set({ status: "completed", endedAt: new Date(), durationSeconds })
      .where(and(
        eq(callsTable.id, call.id),
        eq(callsTable.status, "in_progress"), // double-check: skip if already ended
      ));
    logger.warn({ callId: call.id }, "Stuck call auto-closed by sweep");
  }
}`,
      lines: [
        {
          lines: "2-3",
          label: "tunable timeout",
          explanation:
            "`STUCK_CALL_TIMEOUT_MS` env var overrides the 30-minute default. Set it lower in staging (e.g. 5 minutes) for faster testing. The `|| 30 * 60 * 1000` fallback handles an empty string env var.",
        },
        {
          lines: "17-18",
          label: "double-check WHERE clause",
          explanation:
            "The UPDATE includes `status = 'in_progress'` in its WHERE clause. If the call ended naturally between the SELECT and the UPDATE (a race condition), the UPDATE matches 0 rows and does nothing. Without this, the sweep could overwrite a legitimately `completed` call with stale data.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Pattern 4: withDbRetry",
      body: [
        "**Problem**: Transient Postgres connection errors (network blips, pool churn at startup) can fail DB reads during call setup — before the call is even connected. If the greeting LLM call or agent config load fails, the call should be aborted cleanly rather than crashing silently.",
        "**Fix**: `withDbRetry(fn, retries, delayMs)` — a small wrapper that catches connection errors and retries with exponential backoff. Used for the initial DB reads in `session.ts` (agent config, provider keys, caller memory) where a transient error shouldn't abort a call that the telephony provider has already connected.",
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "The turn safety-net invariant",
      body: [
        "The turn safety net (`FORCE_FINALIZE_MS`, `STALL_BACKSTOP_MS`, `STALL_MAX_REPROMPTS`) is a reliability pattern for the conversation loop. It guards against the 'Listening...' hang: STT provides partial transcripts but never a final, or no transcript arrives at all.",
        "**Invariant**: The safety net only fires in `Listening` state. `FORCE_FINALIZE_MS` fires if a partial arrives but no final after 1800ms. `STALL_BACKSTOP_MS` fires if no partial arrives at all after 15s. Re-prompts are capped at `STALL_MAX_REPROMPTS` (default 2) to avoid infinite recovery loops.",
        "These are tunable env vars. Lowering `FORCE_FINALIZE_MS` makes the agent more responsive to slow STT but increases the risk of cutting off a sentence mid-word. Raising it handles slow STT providers at the cost of more noticeable pauses.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "The stuck-call sweep's UPDATE uses `WHERE id = call.id AND status = 'in_progress'`. Why not just `WHERE id = call.id`?",
          choices: [
            "Postgres requires all WHERE clauses on UPDATE to match indexed columns",
            "To handle the race where the call ended naturally between the SELECT and the UPDATE — the double-check makes the sweep idempotent",
            "To satisfy a CHECK constraint on the calls table",
            "For performance — the status column has an index",
          ],
          correctIndex: 1,
          explanation:
            "Between the SELECT and the UPDATE, `endSession()` could have completed and set `status = 'completed'`. If the UPDATE used only `WHERE id = call.id`, it would overwrite the real completion data with the sweep's synthetic values. The `AND status = 'in_progress'` predicate makes the UPDATE a no-op if the status has already changed.",
        },
        {
          prompt: "Why use `pg_try_advisory_xact_lock` instead of `SELECT FOR UPDATE SKIP LOCKED` for the callback poller?",
          choices: [
            "`SKIP LOCKED` is not supported in Postgres transactions",
            "Advisory locks can be keyed on arbitrary integers (row IDs) rather than requiring a lock on the row itself; they also span across tables",
            "`SELECT FOR UPDATE` would deadlock when two pollers process the same batch",
            "Advisory locks are faster because they don't acquire a row-level lock",
          ],
          correctIndex: 1,
          explanation:
            "Both patterns work, but advisory locks have one key advantage here: the lock key (the row ID) can be used even before reading the row's full data, and advisory locks released at transaction end guarantee atomicity with the status update. `SKIP LOCKED` is also valid; the codebase chose advisory locks for consistency across the callback poller, retry engine, and slot booking.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Recording finalize timeout: `Promise.race([finalizeProm, 60s timeout])` — prevents `endSession()` hanging forever",
        "Stuck-call sweep: runs every 60s, force-closes calls stuck `in_progress` > 30 min",
        "Double-check WHERE clause on UPDATE: prevents overwriting a legitimately ended call",
        "`pg_try_advisory_xact_lock`: Postgres-native distributed lock for multi-instance job processing",
        "Turn safety net: `FORCE_FINALIZE_MS` + `STALL_BACKSTOP_MS` + `STALL_MAX_REPROMPTS` guard the 'Listening' hang",
      ],
    },
  ],
};
