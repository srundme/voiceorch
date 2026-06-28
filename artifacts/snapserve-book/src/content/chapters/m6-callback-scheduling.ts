import type { Chapter } from "../types";

export const callbackScheduling: Chapter = {
  slug: "callback-scheduling",
  moduleId: "m6",
  number: "7.8",
  title: "Callback Scheduling: From LLM Tool to Outbound Call",
  summary:
    "How the `schedule_callback` LLM tool creates a scheduled outbound call — the full journey from tool call in the conversation to dial fired minutes later.",
  estMinutes: 13,
  fileRef: "artifacts/api-server/src/orchestration/callbackScheduler.ts",
  prerequisites: ["tool-execution", "outbound-calls", "auto-redial"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The caller asks to be called back",
      paragraphs: [
        "Consider a caller who says: *\"I'm driving right now, can you call me back in 10 minutes?\"* The LLM recognises the intent, decides to invoke the `schedule_callback` tool, and emits a tool call in its response. At this point, the agent speaks its reply (\"Of course, I'll ring you back in 10 minutes!\") and the tool executor fires the actual scheduling logic in the background.",
        "The `schedule_callback` tool is defined in the agent's tool registry and dispatched by `toolExecutor.ts`. Its handler writes a row to `scheduled_callbacks`, sets `reason = 'callback_requested'`, and returns a confirmation to the LLM. The caller hangs up — and 10 minutes later, the phone rings.",
        "This is distinct from auto-redial (which fires when a call drops unexpectedly). Callback scheduling is **intentional** — the caller explicitly requested it and the LLM confirmed it.",
      ],
    },
    {
      kind: "concept",
      title: "The `scheduled_callbacks` table as a job queue",
      body: [
        "Both auto-redial and callback scheduling write to the same `scheduled_callbacks` table, distinguished by the `reason` column: `no_answer` vs `callback_requested`. The poller in `callbackScheduler.ts` processes both the same way — it fires an outbound dial when `scheduledAt <= now()` and `status = 'pending'`.",
        "The callback row carries: `agentId`, `toNumber`, `scheduledAt`, `reason`, `attemptCount`, `maxAttempts`, `redialIntervalMinutes`, `callbackSecret`, and `userId` (the platform user who owns the agent — needed to look up provider keys for the outbound dial).",
        "`userId` is critical: when the poller fires a callback, it needs to dial using the correct telephony provider and credentials. Without `userId`, it would have to guess which user owns the agent, and managed-plan callbacks would fail to resolve the right VoBiz credentials.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/tools/scheduleCallbackTool.ts",
      language: "typescript",
      intro: "The tool handler — called by the tool executor when the LLM emits a `schedule_callback` tool call.",
      code: `export async function handleScheduleCallback(params: {
  delay_minutes: number;
  message?:      string;
}, context: ToolContext): Promise<string> {
  const { agentId, callId, toNumber, userId } = context;

  const delayMs    = Math.max(1, params.delay_minutes) * 60_000;
  const scheduledAt = new Date(Date.now() + delayMs);

  const [row] = await db.insert(scheduledCallbacksTable).values({
    agentId,
    toNumber,
    userId,
    scheduledAt,
    reason:           "callback_requested",
    attemptCount:     0,
    maxAttempts:      3,
    redialIntervalMinutes: 5,
    callbackSecret:   randomBytes(24).toString("hex"),
  }).returning({ id: scheduledCallbacksTable.id });

  logger.info({ agentId, toNumber, scheduledAt, callbackId: row!.id },
    "schedule_callback: row inserted");

  return \`Callback scheduled for \${scheduledAt.toISOString()}. I'll call you back at \${params.delay_minutes} minutes.\`;
}`,
      lines: [
        {
          lines: "6-7",
          label: "minimum 1 minute",
          explanation:
            "`Math.max(1, params.delay_minutes)` prevents the LLM from scheduling a callback 0 or negative minutes away. A 0-minute callback would fire immediately on the next poll tick, potentially while the current call is still ending.",
        },
        {
          lines: "9-18",
          label: "the insert",
          explanation:
            "`userId` is passed from the `ToolContext` — it was set when the call session was created and scoped to the agent's owner. Without it, `callbackScheduler.ts` cannot resolve provider credentials (especially the managed VoBiz auth keys stored in `platform_settings`).",
        },
        {
          lines: "20-21",
          label: "return value feeds the LLM",
          explanation:
            "The return value is injected into the conversation as a tool result. The LLM sees this string and uses it to compose its spoken reply. The timestamp in ISO format lets a smart LLM say \"I'll call you back at 3:45 PM\" if it knows the caller's timezone.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "The poller: firing the callback",
      paragraphs: [
        "`callbackScheduler.ts` runs a `pollAndFire` loop every 30 seconds (separate from the 60-second batch scheduler). It queries `scheduled_callbacks` for due pending rows, acquires a per-row advisory lock to prevent double-firing across Railway instances, and calls `dialForCallback(cb)` to make the outbound call.",
        "`dialForCallback` resolves the telephony provider for the agent's user. It first checks the `providers` table for a user-supplied telephony key. If none is found, it falls back to the managed platform credentials: `managed_vobiz_auth_id` and `managed_vobiz_auth_token` stored in `platform_settings`, with an env-var fallback (`VOBIZ_AUTH_ID` / `VOBIZ_AUTH_TOKEN`).",
        "After the dial API accepts the call, the row's status transitions `pending → triggering → triggered`. The `callbackSecret` embedded in the hangup URL lets the webhook handler verify the callback's identity when the call ends.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/callbackScheduler.ts",
      language: "typescript",
      intro: "Provider resolution inside `dialForCallback` — the managed-plan fallback chain.",
      code: `async function resolveCallbackProvider(agentId: number, userId: string | null) {
  // 1. Try user-supplied telephony key
  if (userId) {
    const [row] = await db.select()
      .from(providersTable)
      .where(and(
        eq(providersTable.userId, userId),
        eq(providersTable.type, "telephony"),
      ))
      .limit(1);
    if (row) return { authId: decryptKey(row.apiKey), type: row.provider };
  }

  // 2. Managed plan: read from platform_settings
  const [authIdRow] = await db.select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_vobiz_auth_id"))
    .limit(1);
  const [authTokenRow] = await db.select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_vobiz_auth_token"))
    .limit(1);

  // 3. Env-var fallback
  const authId    = authIdRow?.value ?? process.env["VOBIZ_AUTH_ID"] ?? null;
  const authToken = authTokenRow?.value ?? process.env["VOBIZ_AUTH_TOKEN"] ?? null;

  if (!authId || !authToken) throw new Error("No telephony credentials for callback");
  return { authId, authToken, type: "vobiz" as const };
}`,
      lines: [
        {
          lines: "3-11",
          label: "BYOP path",
          explanation:
            "If the user added their own telephony key in the Providers page, that key is used. `decryptKey` handles both AES-256-GCM encrypted keys (new) and plaintext legacy keys transparently.",
        },
        {
          lines: "13-22",
          label: "managed plan path",
          explanation:
            "`platform_settings` rows `managed_vobiz_auth_id` and `managed_vobiz_auth_token` are set via the Admin panel's Managed Keys page. This is how SnapServe's own VoBiz account is used for calls on the managed plan.",
        },
        {
          lines: "24-27",
          label: "env-var fallback",
          explanation:
            "If `platform_settings` rows are absent (e.g. fresh deployment before the admin has set managed keys), the env vars `VOBIZ_AUTH_ID` and `VOBIZ_AUTH_TOKEN` are used as a last resort. This means a newly deployed server can still make managed-plan callbacks without a DB config step.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Cancelling a callback when the caller rings in first",
      body: [
        "If the callee calls the agent BEFORE the scheduled callback fires, `cancelPendingRedials(agentId, toNumber)` is called at the start of the inbound session. This sets `status = 'cancelled'` on all pending `scheduled_callbacks` rows for that `(agentId, toNumber)` pair. The poller skips cancelled rows, so no double-ring happens.",
      ],
    },
    {
      kind: "connections",
      title: "Callback scheduling end-to-end",
      nodes: [
        { id: "llm", label: "LLM", sublabel: "emits tool call" },
        { id: "executor", label: "Tool Executor", sublabel: "toolExecutor.ts", chapterSlug: "tool-execution" },
        { id: "handler", label: "handleScheduleCallback", sublabel: "scheduleCallbackTool.ts", current: true },
        { id: "db", label: "scheduled_callbacks", sublabel: "Postgres row" },
        { id: "poller", label: "pollAndFire()", sublabel: "every 30 s", current: true },
        { id: "dial", label: "dialForCallback()", sublabel: "resolves provider" },
        { id: "vobiz", label: "VoBiz API", sublabel: "outbound dial" },
        { id: "ws", label: "WebSocket Session", sublabel: "live call boots" },
      ],
      edges: [
        { from: "llm", to: "executor", label: "tool call" },
        { from: "executor", to: "handler", label: "dispatch" },
        { from: "handler", to: "db", label: "INSERT" },
        { from: "db", to: "poller", label: "SELECT due" },
        { from: "poller", to: "dial", label: "fire" },
        { from: "dial", to: "vobiz", label: "POST /call" },
        { from: "vobiz", to: "ws", label: "answer webhook → XML → WS" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why is `userId` stored on the `scheduled_callbacks` row?",
          choices: [
            "For billing — the wallet debit is charged to the user at callback time",
            "So the poller can resolve telephony provider credentials (BYOP key or managed VoBiz fallback)",
            "To enforce the per-user daily call cap at dial time",
            "It's not needed — the agent's config already contains all credentials",
          ],
          correctIndex: 1,
          explanation:
            "Provider credentials are scoped per user in the `providers` table. Without `userId`, the poller cannot look up whether the user has a BYOP telephony key and must fall back to managed credentials. The managed fallback chain itself is provider-agnostic but requires knowing which user to check first.",
        },
        {
          prompt: "The poller runs every 30 seconds. A callback is scheduled for 11:00:00. The poller last ran at 10:59:45. When will the callback actually fire?",
          choices: [
            "Exactly at 11:00:00",
            "At 11:00:15 (the next poll tick after 11:00:00)",
            "At 11:00:45 (next tick after the 30-second interval)",
            "It depends on server load — could be up to 60 seconds late",
          ],
          correctIndex: 1,
          explanation:
            "The poller runs every 30 seconds. If the last tick was at 10:59:45, the next tick is at 11:00:15. The query selects rows where `scheduledAt <= now()`, so the 11:00:00 callback is included at 11:00:15. Maximum latency is ~30 seconds, not the full interval.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "`schedule_callback` tool → inserts a `scheduled_callbacks` row with `reason = 'callback_requested'`",
        "`userId` on the row enables provider-credential resolution at dial time",
        "Provider resolution: BYOP key → `platform_settings` managed keys → env-var fallback",
        "The same poller handles both auto-redial and callback-requested rows — `reason` distinguishes them",
        "`cancelPendingRedials` prevents a double-ring when the callee calls in first",
      ],
    },
  ],
};
