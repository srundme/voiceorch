import type { Chapter } from "../types";

export const outboundCalls: Chapter = {
  slug: "outbound-calls",
  moduleId: "m6",
  number: "7.5",
  title: "Outbound Call Initiation",
  summary:
    "From `POST /calls` to a ringing phone — the full lifecycle of an agent-initiated outbound call.",
  estMinutes: 18,
  fileRef: "artifacts/api-server/src/routes/calls.ts",
  prerequisites: ["telephony-overview", "session-and-pipeline"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Most voice AI demos show an agent *answering* calls. The harder, more commercially valuable problem is an agent *making* calls — ringing a customer's phone, handling it if they pick up, and retrying intelligently if they don't. SnapServe handles both directions from the same pipeline, but the outbound initiation path has several moving parts worth understanding in detail.",
        "The journey starts with a single HTTP POST to `/api/calls`. By the time that request returns, a real phone is ringing, a DB record exists, and the pipeline is on standby to handle the conversation the moment the callee picks up.",
      ],
    },
    {
      kind: "concept",
      title: "Telephony dial APIs: async by nature",
      body: [
        "Phone calls are fundamentally asynchronous. When you tell Twilio to call `+919876543210`, Twilio accepts your request and returns immediately — but the phone hasn't rung yet. Twilio rings the phone, waits for an answer (up to 30 seconds), and then fires an `answered` webhook to your server when the callee picks up.",
        "This means `POST /calls` cannot wait for the call to be answered. It dials and returns. The conversation starts later, on a completely different HTTP request (the answer webhook). The call record in the DB is the thread connecting both sides of this async handoff.",
        "The key fields: `externalCallId` (Twilio/Plivo's call SID, used to correlate subsequent webhooks), `status` (starts as `pending`, transitions to `in_progress` when answered), and `executionId` (a SnapServe UUID that seeds the session, so the webhook handler knows which pipeline to boot).",
      ],
    },
    {
      kind: "code",
      filename: "routes/calls.ts",
      language: "typescript",
      intro:
        "The core of `POST /calls`: validate, look up the agent, resolve the outbound number, create the DB record, then dial.",
      code: `router.post("/calls", requireAuth, async (req, res) => {
  const parsed = CreateCallSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed" });
  }

  const { agentId, toNumber, callbackUrl } = parsed.data;
  const { userId } = getAuth(req);

  // 1. Load the agent and verify ownership
  const [agent] = await db.select()
    .from(agentsTable)
    .where(and(
      eq(agentsTable.id, agentId),
      eq(agentsTable.userId, userId)
    ));
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  // 2. Resolve the outbound caller ID
  const fromNumber = await resolveOutboundNumber(agent, userId);
  if (!fromNumber) {
    return res.status(422).json({
      error: "No outbound number configured for this agent"
    });
  }

  // 3. Pre-flight: wallet balance check
  const [user] = await db.select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, userId));
  if ((user?.walletBalanceCents ?? 0) <= 0) {
    return res.status(402).json({ error: "Insufficient balance" });
  }

  // 4. Create the call record (pending)
  const executionId = randomUUID();
  const [call] = await db.insert(callsTable).values({
    agentId, userId,
    fromNumber, toNumber,
    status: "pending",
    executionId,
  }).returning();

  // 5. Dial via the agent's telephony provider
  const statusCallbackUrl = buildStatusCallbackUrl(call.id, executionId);
  await dialProvider(agent, { to: toNumber, from: fromNumber, statusCallbackUrl });

  res.json({ callId: call.id, status: "pending" });
});`,
      lines: [
        {
          lines: "10-16",
          label: "ownership check",
          explanation:
            "The `AND userId = ?` clause in the agent lookup is critical for tenant isolation. Without it, any authenticated user could initiate calls billed to another user's agent.",
        },
        {
          lines: "18-23",
          label: "resolveOutboundNumber",
          explanation:
            "An agent can have a preferred number (`agentConfig.preferredManagedNumber`), a linked outbound phone number (`outboundPhoneNumberId`), or can fall back to any number on the account. `resolveOutboundNumber` checks in that priority order. If nothing is found, the call is rejected with 422.",
        },
        {
          lines: "25-30",
          label: "wallet pre-flight",
          explanation:
            "A zero-balance check before dialling prevents orphaned calls where the phone rings but billing would fail at call-end. It's a soft check (not advisory-locked), so a race condition is theoretically possible, but the hard debit at call-end reconciles any overspend.",
        },
        {
          lines: "32-39",
          label: "executionId + DB record",
          explanation:
            "`executionId` is a UUID generated here and embedded in the status callback URL. When Twilio fires the answer webhook, the handler extracts this UUID from the URL path to find the right call record and start the session. It's the async correlation token.",
        },
        {
          lines: "41-43",
          label: "dialProvider + return",
          explanation:
            "`dialProvider` picks the right dial function (Twilio, Plivo, VoBiz) based on `agent.telephonyProvider`. The function returns as soon as the provider accepts the dial request — not when the phone rings. The response to the client (`pending`) reflects this.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "The answer webhook: starting the session",
      paragraphs: [
        "When the callee picks up, the telephony provider sends an `answered` status callback to SnapServe's webhook handler. The URL contains the `executionId` baked in during dial time. The handler uses it to look up the call record, then boots a full `createSession` for this call.",
        "This is the same `createSession` function that inbound calls use. From the pipeline's perspective, an answered outbound call and an answered inbound call are identical — both have a `toNumber`, a `fromNumber`, a call record, and a WebSocket stream of audio frames. The direction is just metadata.",
        "If the call goes to voicemail instead, the AMD webhook fires (if configured) and the handler follows the `voicemailAction` logic from the AMD chapter.",
      ],
    },
    {
      kind: "concept",
      title: "Resolving the outbound caller ID",
      body: [
        "The `fromNumber` the agent uses to call out matters for caller ID display, geographic routing, and regulatory compliance. SnapServe resolves it in priority order: agent's `preferredManagedNumber`, linked `outboundPhoneNumberId`, any active number on the account matching the provider.",
        "For managed-plan users, SnapServe supplies the numbers. For BYOP users, the number comes from their own Twilio/Plivo subaccount. The `resolveOutboundNumber` function handles both cases, querying the `phone_numbers` table for managed numbers and the provider's API (via the agent's credentials) for BYOP numbers.",
      ],
    },
    {
      kind: "connections",
      title: "Outbound call lifecycle",
      nodes: [
        { id: "client",  label: "Dashboard / API client",  sublabel: "POST /api/calls" },
        { id: "route",   label: "POST /calls route",       sublabel: "calls.ts",        current: true },
        { id: "db",      label: "calls table",             sublabel: "status: pending" },
        { id: "twilio",  label: "Twilio / Plivo / VoBiz",  sublabel: "dial API" },
        { id: "phone",   label: "Callee's phone",          sublabel: "ringing" },
        { id: "webhook", label: "Answer webhook",          sublabel: "webhooks.ts",      chapterSlug: "vobiz-and-plivo" },
        { id: "session", label: "createSession()",         sublabel: "session.ts",       chapterSlug: "session-and-pipeline" },
      ],
      edges: [
        { from: "client",  to: "route",   label: "POST /calls" },
        { from: "route",   to: "db",      label: "INSERT pending" },
        { from: "route",   to: "twilio",  label: "dial API call" },
        { from: "twilio",  to: "phone",   label: "PSTN ring" },
        { from: "twilio",  to: "webhook", label: "answered callback" },
        { from: "webhook", to: "db",      label: "UPDATE in_progress" },
        { from: "webhook", to: "session", label: "createSession" },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "The call record exists before the call answers",
      body: [
        "The DB insert happens immediately after the dial API call returns — before the phone rings. This means a call can be in `status: 'pending'` for 30+ seconds while Twilio tries to reach the callee. If the callee doesn't answer, a `no-answer` status callback fires and the handler updates the record to `status: 'no_answer'`. The `pending → no_answer` path is entirely driven by webhooks; the original POST /calls request already returned long ago.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What is the purpose of the `executionId` field on the call record?",
          choices: [
            "It's the Twilio call SID used to cancel the call",
            "A UUID baked into the status callback URL so the webhook handler can find the right call record",
            "The ID of the background job that manages the dial attempt",
            "A sequential counter for ordering calls by creation time",
          ],
          correctIndex: 1,
          explanation:
            "`executionId` is a UUID generated at dial time and embedded in the status callback URL. When Twilio fires the answer webhook, the handler extracts this UUID from the URL to find the matching call record and boot the session. It's the async correlation token.",
        },
        {
          prompt: "Why does `POST /calls` return `status: 'pending'` instead of waiting for the call to be answered?",
          choices: [
            "Because the API has a 5-second timeout",
            "Because telephony dial APIs are asynchronous — the phone hasn't rung yet when the dial request returns",
            "To allow the client to cancel the call before it connects",
            "Because the WebSocket for audio isn't open yet",
          ],
          correctIndex: 1,
          explanation:
            "Telephony providers accept the dial request immediately and ring the phone asynchronously. The `POST /calls` response arrives before the phone rings. The answer notification comes later via a separate webhook.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "`POST /calls` validates, checks balance, inserts a `pending` call record, then dials — it returns before the phone rings",
        "`executionId` is the async correlation token: baked into the callback URL so the answer webhook can find the right session to boot",
        "Answer webhook → `createSession` → same pipeline as inbound; direction is just metadata",
        "Outbound number resolution: `preferredManagedNumber` → `outboundPhoneNumberId` → any account number",
        "No-answer / voicemail paths are driven entirely by status webhooks after `POST /calls` has already returned",
      ],
    },
  ],
};
