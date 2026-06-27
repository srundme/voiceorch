import type { Chapter } from "../types";

export const autoRedial: Chapter = {
  slug: "auto-redial",
  moduleId: "m6",
  number: "7.6",
  title: "Auto-Redial & Scheduled Callbacks",
  summary:
    "How SnapServe detects dropped calls and rings the caller back automatically — the `scheduled_callbacks` table, the poller, and the retry chain.",
  estMinutes: 16,
  fileRef: "artifacts/api-server/src/services/autoRedial.ts",
  prerequisites: ["outbound-calls", "session-and-pipeline"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The problem: calls that end too soon",
      paragraphs: [
        "A call can end before its time for many reasons: a network blip drops the WebSocket, the caller's battery dies, a tunnel swallows the signal, or the caller accidentally presses the red button. From the platform's perspective, the call ended without a natural goodbye (`naturalEndTriggered = false`). The conversation was interrupted, not completed.",
        "Auto-redial is the agent calling back. When enabled, SnapServe schedules a callback automatically whenever a call ends unexpectedly, and the callback poller fires it after a configured delay. If the callback also goes unanswered, the chain continues — up to a daily cap.",
        "There are actually three distinct redial scenarios: **no-answer** (outbound call never picked up), **dropped mid-call** (call connected but disconnected unexpectedly), and **caller-requested callback** (the LLM offered to call back at a specific time and the caller agreed). All three are unified in the `scheduled_callbacks` table and the same poller.",
      ],
    },
    {
      kind: "concept",
      title: "The `scheduled_callbacks` table: the job queue",
      body: [
        "Every scheduled call-back is a row in `scheduled_callbacks`. The key fields: `agentId`, `toNumber`, `scheduledAt` (when to dial), `status` (`pending → triggering → triggered`), `reason` (`no_answer` | `callback_requested`), `attemptCount`, `maxAttempts`, and `redialIntervalMinutes`.",
        "`callbackSecret` is an unguessable hex string embedded in the status callback URL. When the telephony provider fires its result webhook, the handler verifies this secret before scheduling the next retry. This prevents an attacker from enumerating sequential `cbId` values to trigger arbitrary outbound calls.",
        "The `cancelledAt` + `status: 'cancelled'` fields handle the case where the callee calls IN before the scheduled callback fires. `cancelPendingRedials` sets these when an inbound call arrives from the same number.",
      ],
    },
    {
      kind: "code",
      filename: "services/autoRedial.ts",
      language: "typescript",
      intro:
        "`scheduleNoAnswerRedial` is the entry point for both no-answer and dropped-call redialling. It enforces a daily cap before inserting the row.",
      code: `export async function scheduleNoAnswerRedial(opts: {
  agentId:               number;
  toNumber:              string;
  userId?:               string | null;
  callId?:               number | null;
  maxAttempts?:          number;
  redialIntervalMinutes?: number;
}): Promise<number | null> {
  const maxAttempts    = opts.maxAttempts ?? 5;
  const intervalMins   = opts.redialIntervalMinutes ?? 30;

  // Count today's attempts for this (agent, number) pair
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const [existing] = await db
    .select({ count: sql\`count(*)::int\` })
    .from(scheduledCallbacksTable)
    .where(and(
      eq(scheduledCallbacksTable.agentId, opts.agentId),
      eq(scheduledCallbacksTable.toNumber, opts.toNumber),
      eq(scheduledCallbacksTable.reason, "no_answer"),
      gte(scheduledCallbacksTable.createdAt, todayStart),
    ));

  if ((existing?.count ?? 0) >= maxAttempts) {
    logger.info({ ...opts }, "No-answer: daily cap reached — no retry");
    return null;
  }

  const nextAt = new Date(Date.now() + intervalMins * 60_000);
  const [row] = await db.insert(scheduledCallbacksTable).values({
    agentId:               opts.agentId,
    toNumber:              opts.toNumber,
    scheduledAt:           nextAt,
    reason:                "no_answer",
    attemptCount:          (existing?.count ?? 0) + 1,
    maxAttempts,
    redialIntervalMinutes: intervalMins,
    callbackSecret:        randomBytes(24).toString("hex"),
  }).returning({ id: scheduledCallbacksTable.id });

  return row!.id;
}`,
      lines: [
        {
          lines: "11-22",
          label: "daily cap check",
          explanation:
            "The cap is per `(agentId, toNumber, reason)` triplet per day. Counting by `createdAt >= todayStart` means the window resets at midnight local time (the server's timezone). This prevents an agent from ringing the same number 50 times if the user accidentally set `maxAttempts = 50`.",
        },
        {
          lines: "28-37",
          label: "insert the callback row",
          explanation:
            "`attemptCount` is set to today's current count + 1, not to a sequential retry number. This way, if the same number is attempted from different agents, the cap is per-agent. `callbackSecret` is 48 hex characters of cryptographic randomness — unguessable.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "The callback poller: firing scheduled calls",
      paragraphs: [
        "A background interval in `callbackScheduler.ts` runs every 30 seconds. It queries `scheduled_callbacks` for rows where `status = 'pending' AND scheduledAt <= now()`, then processes each one by making an outbound dial.",
        "The poller uses a `pg_try_advisory_xact_lock` to prevent two server instances from processing the same row simultaneously. This is important in Railway's multi-instance deployments — without the lock, two pods could both pick up the same callback and dial the number twice.",
        "When a row is processed, its `status` transitions: `pending → triggering` (while the dial is in flight) → `triggered` (after the dial API returns successfully). If the dial fails, status goes to `failed` and the error is logged.",
      ],
    },
    {
      kind: "code",
      filename: "services/callbackScheduler.ts",
      language: "typescript",
      intro:
        "The poller: fetch due rows, advisory-lock each one, dial, update status.",
      code: `async function pollAndFire(): Promise<void> {
  const due = await db
    .select()
    .from(scheduledCallbacksTable)
    .where(and(
      eq(scheduledCallbacksTable.status, "pending"),
      lte(scheduledCallbacksTable.scheduledAt, new Date()),
    ))
    .limit(10);

  for (const cb of due) {
    await db.transaction(async (tx) => {
      // Advisory lock: skip if another instance has this row
      const [lock] = await tx.execute(
        sql\`SELECT pg_try_advisory_xact_lock(\${cb.id})\`
      );
      if (!lock?.pg_try_advisory_xact_lock) return;

      await tx.update(scheduledCallbacksTable)
        .set({ status: "triggering" })
        .where(eq(scheduledCallbacksTable.id, cb.id));

      await dialForCallback(cb); // fires the outbound call

      await tx.update(scheduledCallbacksTable)
        .set({ status: "triggered", triggeredAt: new Date() })
        .where(eq(scheduledCallbacksTable.id, cb.id));
    });
  }
}`,
      lines: [
        {
          lines: "2-8",
          label: "due rows query",
          explanation:
            "Selects up to 10 rows with `scheduledAt <= now()` and `status = 'pending'`. The `LIMIT 10` is a backpressure mechanism — if 500 callbacks are due simultaneously (e.g. after a server restart), the poller processes them 10 at a time, every 30 seconds, rather than flooding the telephony provider.",
        },
        {
          lines: "13-16",
          label: "pg_try_advisory_xact_lock",
          explanation:
            "A PostgreSQL advisory lock keyed on the row's integer `id`. The lock is automatically released when the transaction ends. If two server instances both pick up the same row, only one gets the lock — the other's `SELECT` returns `false` and skips. This is the standard PostgreSQL pattern for distributed job queues without a separate Redis/SQS dependency.",
        },
        {
          lines: "18-20",
          label: "triggering status",
          explanation:
            "The status update to `triggering` happens INSIDE the transaction, before the dial. If the server crashes mid-dial, the row stays in `triggering` (not `pending`), so the poller won't retry it on the next tick. A separate cleanup job resets stale `triggering` rows after a timeout.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Completing the retry chain: scheduleNextRedial",
      paragraphs: [
        "When the callback dial completes (answered or not), the telephony provider fires a status webhook. If the outcome was `no-answer` again, `scheduleNextRedial(prev)` is called with the original callback row. It reads `prev.attemptCount`, checks the daily cap again, and inserts a new row with `attemptCount + 1` and a new `scheduledAt`.",
        "This creates a chain: each link is one row in `scheduled_callbacks`, each scheduled `redialIntervalMinutes` after the last. The chain ends when `attemptCount >= maxAttempts` OR when the callee answers (a successful answer means a session boots and the call ends naturally, which does NOT trigger another retry).",
        "If the callee calls in to the agent before the scheduled callback fires, `cancelPendingRedials` cancels all pending `no_answer` rows for that `(agentId, toNumber)` pair. No one wants to be called back immediately after they called in.",
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Dropped mid-call auto-redial",
      body: [
        "The `session.ts` endSession function also triggers auto-redial when `!naturalEndTriggered && !wasTransferred` AND the agent has `agentConfig.autoRedial.enabled = true`. This fires `scheduleNoAnswerRedial` with the session's `callerPhone` and the agent's configured `delayMinutes`/`maxAttempts`. The same poller and retry chain handles it — the only difference is the trigger point.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What prevents two server instances from dialling the same scheduled callback simultaneously?",
          choices: [
            "A Redis distributed lock on the callback ID",
            "A `SELECT FOR UPDATE SKIP LOCKED` query",
            "`pg_try_advisory_xact_lock` on the row's integer ID inside a transaction",
            "The status column — only one process can set it to 'triggering' first",
          ],
          correctIndex: 2,
          explanation:
            "`pg_try_advisory_xact_lock` acquires a PostgreSQL advisory lock on the integer ID within the transaction. If a second instance tries the same lock, it returns `false` immediately and skips. No external dependency (Redis, SQS) needed.",
        },
        {
          prompt: "When does the retry chain stop?",
          choices: [
            "After a fixed 24-hour window from the first attempt",
            "When `attemptCount >= maxAttempts` or the callee successfully answers",
            "After 3 retries, regardless of configuration",
            "When the agent is toggled to inactive",
          ],
          correctIndex: 1,
          explanation:
            "The chain ends either when the daily cap is hit (`attemptCount >= maxAttempts`) or when the callee answers — a successful answer starts a live session, which ends naturally and doesn't trigger another retry.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Three redial triggers: no-answer (webhook), dropped mid-call (endSession), caller-requested (LLM tool)",
        "`scheduled_callbacks` is a persistent job queue: one row per scheduled attempt",
        "`callbackSecret` prevents enumeration attacks on sequential `cbId` values",
        "The poller runs every 30 seconds, processes 10 rows at a time, and uses `pg_try_advisory_xact_lock` for multi-instance safety",
        "`cancelPendingRedials` fires when the callee calls in so they're not bothered again",
      ],
    },
  ],
};
