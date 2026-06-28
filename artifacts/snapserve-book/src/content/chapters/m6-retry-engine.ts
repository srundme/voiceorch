import type { Chapter } from "../types";

export const retryEngine: Chapter = {
  slug: "retry-engine",
  moduleId: "m6",
  number: "7.7",
  title: "The Retry Engine",
  summary:
    "How SnapServe schedules and re-fires failed outbound calls — the `retryEngine.ts` job queue, backoff logic, max-attempt caps, and the webhook-to-retry feedback loop.",
  estMinutes: 14,
  fileRef: "artifacts/api-server/src/services/retryEngine.ts",
  prerequisites: ["outbound-calls", "auto-redial"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Why a separate retry engine?",
      paragraphs: [
        "Campaign calls and scheduled callbacks share a common failure mode: the outbound dial attempt goes through but the called number is busy, unavailable, or rejects the call. When that happens, the telephony provider fires a status webhook (POST to `/api/webhooks/vobiz/status` or `/api/webhooks/twilio/status`) with a terminal status like `busy`, `no-answer`, or `failed`.",
        "Rather than retrying immediately in the webhook handler (which would block the HTTP response and could stack-overflow on repeated failures), SnapServe hands the retry off to a persistent job queue in Postgres. The **retry engine** is a small scheduler that sits between the status webhook and the next outbound dial attempt.",
        "The retry engine lives in `services/retryEngine.ts`. Its two exported functions are `scheduleRetry` (called from webhook handlers when a terminal non-answer status arrives) and `processRetries` (called every 60 seconds by `batchScheduler.ts` to fire due retries).",
      ],
    },
    {
      kind: "concept",
      title: "The retry job record",
      body: [
        "Each retry is a row in a lightweight Postgres table. The key columns: `agentId`, `toNumber`, `runAt` (when to next dial), `attemptCount` (how many times tried so far), `maxAttempts`, `intervalMs` (delay between retries), `reason` (why the last attempt failed), `campaignLeadId` (null for non-campaign retries), and `status` (`pending → done | exhausted`).",
        "By storing retries in Postgres instead of an in-memory queue, the engine survives server restarts and Railway redeploys. On startup, any `pending` retries that were due while the server was down are picked up by the first `processRetries` poll.",
        "The engine is deliberately dumb: it does not understand campaigns, callbacks, or agent configuration. It just stores `(agentId, toNumber, runAt)` and fires a dial when the time comes. Campaign-specific logic (like updating lead status) is handled by the webhook handler BEFORE handing off to `scheduleRetry`.",
      ],
    },
    {
      kind: "code",
      filename: "services/retryEngine.ts",
      language: "typescript",
      intro: "`scheduleRetry` is called from webhook handlers whenever a non-answer terminal status arrives. It enforces the attempt cap before inserting.",
      code: `export async function scheduleRetry(opts: {
  agentId:        number;
  toNumber:       string;
  campaignLeadId?: number | null;
  attemptCount:   number;        // how many times tried so far
  maxAttempts:    number;
  intervalMs:     number;        // delay before next attempt
  reason:         string;        // "busy" | "no-answer" | "failed"
  userId?:        string | null;
}): Promise<boolean> {
  if (opts.attemptCount >= opts.maxAttempts) {
    logger.info(opts, "RetryEngine: max attempts reached — no retry");
    return false;
  }

  const runAt = new Date(Date.now() + opts.intervalMs);

  await db.insert(retryJobsTable).values({
    agentId:        opts.agentId,
    toNumber:       opts.toNumber,
    campaignLeadId: opts.campaignLeadId ?? null,
    runAt,
    attemptCount:   opts.attemptCount,
    maxAttempts:    opts.maxAttempts,
    intervalMs:     opts.intervalMs,
    reason:         opts.reason,
    userId:         opts.userId ?? null,
    status:         "pending",
  });

  logger.info({ ...opts, runAt }, "RetryEngine: retry scheduled");
  return true;
}`,
      lines: [
        {
          lines: "10-13",
          label: "cap check before insert",
          explanation:
            "The cap check happens BEFORE inserting. `attemptCount` is the number of completed attempts, not the sequence number, so the check is `>= maxAttempts` (not `>`). If you've already tried 5 times and `maxAttempts = 5`, the 6th attempt is never scheduled.",
        },
        {
          lines: "15",
          label: "runAt = now + intervalMs",
          explanation:
            "`intervalMs` is set by the caller (campaign config, agent config, or a default). For campaign calls it's typically 5 minutes (300,000 ms). Adding it to `Date.now()` gives the absolute time for the next attempt.",
        },
        {
          lines: "17-28",
          label: "insert the job",
          explanation:
            "`attemptCount` stored is the number of PAST attempts. When `processRetries` fires the next dial, it passes `attemptCount + 1` to the next `scheduleRetry` call (if needed), so the count advances correctly through the chain.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Processing due retries",
      paragraphs: [
        "`processRetries` runs every 60 seconds inside the batch scheduler interval. It selects rows where `status = 'pending' AND runAt <= now()`, then fires an outbound dial for each one. Like the callback scheduler, it uses `pg_try_advisory_xact_lock` to prevent two server instances from firing the same retry simultaneously.",
        "When the dial succeeds (the telephony API accepts the call), the job's status is updated to `done`. If the dial itself throws (network error calling the provider API), the status stays `pending` so the next poll can retry. This is different from a telephony no-answer — a dial failure is a server-side error, not a callee-side rejection.",
      ],
    },
    {
      kind: "code",
      filename: "services/retryEngine.ts",
      language: "typescript",
      intro: "`processRetries` — the poll loop. Fires due retries and advances the attempt chain.",
      code: `export async function processRetries(): Promise<void> {
  const due = await db
    .select()
    .from(retryJobsTable)
    .where(and(
      eq(retryJobsTable.status, "pending"),
      lte(retryJobsTable.runAt, new Date()),
    ))
    .limit(20);

  for (const job of due) {
    try {
      await db.transaction(async (tx) => {
        const [lock] = await tx.execute(
          sql\`SELECT pg_try_advisory_xact_lock(\${job.id})\`
        );
        if (!lock?.pg_try_advisory_xact_lock) return;

        await tx.update(retryJobsTable)
          .set({ status: "done" })
          .where(eq(retryJobsTable.id, job.id));
      });

      await fireRetryDial(job);

    } catch (err) {
      logger.error({ err, jobId: job.id }, "RetryEngine: dial failed");
    }
  }
}`,
      lines: [
        {
          lines: "9",
          label: "LIMIT 20",
          explanation:
            "Backpressure cap. If 200 retries are due at once (after a server restart), the engine processes 20 per minute rather than flooding the telephony provider with simultaneous dials. Set via env `RETRY_ENGINE_BATCH_SIZE`.",
        },
        {
          lines: "12-20",
          label: "advisory lock + status update inside one transaction",
          explanation:
            "The lock and status update are inside the same transaction. If two server instances race, only one gets the lock — the other sees `false` and exits without the update. The transaction also means: if `status = 'done'` is written but the server crashes before `fireRetryDial`, the job won't be retried (status is already `done`). This is an intentional trade-off: ghost dials (firing the same retry twice) are worse than a missed dial.",
        },
        {
          lines: "22",
          label: "fireRetryDial outside the transaction",
          explanation:
            "`fireRetryDial` is outside the transaction because HTTP calls must not run inside a DB transaction (they hold a connection open for the entire network round-trip, exhausting the pool). The status is committed to `done` before the dial fires.",
        },
      ],
    },
    {
      kind: "connections",
      title: "Retry engine data flow",
      nodes: [
        { id: "webhook", label: "Status Webhook", sublabel: "routes/webhooks.ts", chapterSlug: "webhooks-deep-dive" },
        { id: "schedule", label: "scheduleRetry()", sublabel: "retryEngine.ts", current: true },
        { id: "db", label: "retry_jobs table", sublabel: "Postgres" },
        { id: "poll", label: "processRetries()", sublabel: "every 60 s", current: true },
        { id: "dial", label: "fireRetryDial()", sublabel: "outbound dial" },
        { id: "provider", label: "Telephony Provider", sublabel: "VoBiz / Twilio" },
      ],
      edges: [
        { from: "webhook", to: "schedule", label: "busy / no-answer" },
        { from: "schedule", to: "db", label: "INSERT row" },
        { from: "db", to: "poll", label: "SELECT due rows" },
        { from: "poll", to: "dial", label: "fire" },
        { from: "dial", to: "provider", label: "POST /dial" },
        { from: "provider", to: "webhook", label: "status callback" },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "The status stays 'done' even if the dial throws",
      body: [
        "The status update to `done` happens BEFORE `fireRetryDial`. If the dial throws (provider API is down), the job is marked done and won't be retried automatically. This is a deliberate choice to prevent a broken provider from causing an infinite retry storm. Campaign leads that fail this way will be picked up by the campaign's own retry policy on the next batch poll.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What does `processRetries` do when two server instances pick up the same retry job simultaneously?",
          choices: [
            "Both fire the dial — the provider deduplicates",
            "One gets the pg_try_advisory_xact_lock and proceeds; the other skips",
            "The second one waits for the first to finish, then also fires",
            "A unique constraint on toNumber prevents the second insert",
          ],
          correctIndex: 1,
          explanation:
            "`pg_try_advisory_xact_lock` returns `false` immediately if the lock is held. The second instance's transaction exits without the status update or the dial. No duplicate dials.",
        },
        {
          prompt: "If the server crashes after marking a retry job `done` but before `fireRetryDial` executes, what happens?",
          choices: [
            "The job stays `pending` and is retried on the next poll",
            "The job is marked `done` — the dial is never fired and no automatic recovery occurs",
            "A background cleanup job resets it to `pending` after 5 minutes",
            "The campaign's batch scheduler picks it up as a new lead",
          ],
          correctIndex: 1,
          explanation:
            "The `done` status is committed before `fireRetryDial` runs. A crash after that leaves the job `done` with no automatic recovery. This is intentional — it prevents ghost dials (double-firing the same retry), which are worse than a single missed call.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "`scheduleRetry` inserts a Postgres row; `processRetries` fires due rows every 60 s",
        "Attempt cap checked BEFORE inserting — `attemptCount >= maxAttempts` = no retry",
        "`pg_try_advisory_xact_lock` prevents duplicate dials in multi-instance deployments",
        "Status is set to `done` BEFORE the dial fires — ghost dials are worse than missed ones",
        "The engine is domain-agnostic: it dials `(agentId, toNumber)` and leaves campaign/callback logic to callers",
      ],
    },
  ],
};
