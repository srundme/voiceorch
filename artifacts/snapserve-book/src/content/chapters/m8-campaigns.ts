import type { Chapter } from "../types";

export const campaigns: Chapter = {
  slug: "campaigns",
  moduleId: "m8",
  number: "8.3",
  title: "Outbound Campaigns",
  summary:
    "Dialing a list of leads automatically, with retries, scheduling, and answering-machine detection.",
  estMinutes: 16,
  fileRef: "artifacts/api-server/src/orchestration/campaignCaller.ts",
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Everything you've seen so far is **inbound** — a human dials in, the agent answers. Campaigns flip the direction: you upload a list of leads (a spreadsheet of phone numbers), and SnapServe **dials them for you**, one after another, running the AI agent on each connected call.",
        "That sounds simple until you hit the real world: numbers on a do-not-call list, calling-hours laws, voicemails that pick up instead of humans, busy/failed calls that need retrying, and a hard cap on how many calls can run at once. `campaignCaller.ts` is the file that fires a single campaign call and handles all of that. This chapter walks `fireCampaignCall` end to end.",
      ],
    },
    {
      kind: "concept",
      title: "The anatomy of one campaign call",
      body: [
        "A campaign has an **agent**, a list of **leads**, and dialing settings (concurrency limit, retry policy, call delay). Firing one lead is a pipeline of gates: normalize the phone → check Do-Not-Call → check TRAI compliance (calling hours) → check the concurrency limit → resolve telephony credentials → dial.",
        "**AMD — Answering Machine Detection** — is the trick that stops your agent from cheerfully pitching a voicemail greeting. The telephony provider listens to how the call is answered and tells us 'human' or 'machine', so the AI only engages real people.",
        "Because any step can fail, campaign calls are **resilient by design**: a failure schedules an automatic retry (up to `maxAttempts`), and every state change is written to a per-lead **timeline** so the dashboard can show exactly what happened.",
      ],
    },
    {
      kind: "callout",
      variant: "why",
      title: "Compliance isn't optional — it's a gate",
      body: [
        "In India (SnapServe's primary market), outbound calling is regulated. Two independent checks run **before** any dial: the **DNC** (Do Not Call) list, and **TRAI** rules (legal calling hours plus a suppression list).",
        "Both are hard gates: if either says no, the lead is marked `skipped` with a reason, a timeline event is logged, and the function returns — no dial happens. Compliance failures are a normal, expected outcome, not an error.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/campaignCaller.ts",
      language: "typescript",
      intro:
        "Before dialing, the lead's phone is normalized and run through the Do-Not-Call check.",
      code: `  // Normalize phone if not already done
  const normalized = lead.normalizedPhone ?? normalizePhone(lead.phone);
  if (!lead.normalizedPhone) {
    await db.update(campaignLeadsTable)
      .set({ normalizedPhone: normalized })
      .where(eq(campaignLeadsTable.id, lead.id));
  }

  // DNC check
  const onDnc = await isOnDnc(campaign.userId, normalized);
  if (onDnc) {
    logger.info({ leadId: lead.id, phone: normalized }, "Lead is on DNC — skipping");
    await db.update(campaignLeadsTable)
      .set({ callStatus: "skipped", notes: "Number on Do Not Call list" })
      .where(eq(campaignLeadsTable.id, lead.id));
    await addTimelineEvent(lead.id, campaign.id, "dnc_blocked", { normalizedPhone: normalized });
    return;
  }`,
      lines: [
        {
          lines: "2-7",
          label: "normalize once, cache it",
          explanation:
            "`lead.normalizedPhone ?? normalizePhone(lead.phone)` uses the cached normalized number if present, otherwise computes and stores it. Phone numbers arrive in many shapes; normalizing them is essential so DNC matching works.",
        },
        {
          lines: "10-11",
          label: "the DNC gate",
          explanation:
            "`isOnDnc(campaign.userId, normalized)` checks the user's Do-Not-Call list. If the number is on it, we must not call.",
        },
        {
          lines: "12-18",
          label: "skip + log + return",
          explanation:
            "When blocked: mark the lead `skipped` with a human-readable note, write a `dnc_blocked` timeline event, and `return` immediately. The early return is the pattern for every gate in this file.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/campaignCaller.ts",
      language: "typescript",
      intro:
        "Next, a concurrency gate stops the campaign from dialing more calls than allowed at once.",
      code: `  const isPreClaimed = lead.callStatus === "calling";

  if (!isPreClaimed) {
    // Check concurrency limit before firing
    const limit = campaign.concurrentCallLimit ?? 20;
    const currentlyActive = (await db.select({ count: sql<number>\`count(*)\` })
      .from(campaignLeadsTable)
      .where(and(
        eq(campaignLeadsTable.campaignId, campaign.id),
        eq(campaignLeadsTable.callStatus, "calling"),
      )))[0]?.count ?? 0;

    if (currentlyActive >= limit) {
      logger.warn({ leadId: lead.id, campaignId: campaign.id, limit, currentlyActive }, "Campaign concurrency limit reached — skipping call");
      await db.update(campaignLeadsTable)
        .set({ callStatus: "pending", notes: \`Queued — concurrency limit (\${limit}) reached\` })
        .where(eq(campaignLeadsTable.id, lead.id));
      return;
    }
  }`,
      lines: [
        {
          lines: "1-3",
          label: "skip the gate if pre-claimed",
          explanation:
            "Leads already marked `\"calling\"` were claimed by the batch starter, which enforced concurrency at claim time. They skip this redundant gate. This avoids double-counting.",
        },
        {
          lines: "5",
          label: "the limit (default 20)",
          explanation:
            "`campaign.concurrentCallLimit ?? 20` — each campaign can cap how many simultaneous calls it runs, defaulting to 20. This protects your telephony account and the agent's compute.",
        },
        {
          lines: "6-11",
          label: "count active calls",
          explanation:
            "A `count(*)` of leads currently in `\"calling\"` status for this campaign. `sql<number>` tells Drizzle the raw SQL expression returns a number.",
        },
        {
          lines: "13-19",
          label: "queue instead of drop",
          explanation:
            "If we're at the limit, the lead is set back to `pending` (re-queued, not failed) with an explanatory note, and we return. It'll be picked up again once a slot frees.",
        },
      ],
    },
    {
      kind: "concept",
      title: "BYOP credentials, with a managed fallback",
      body: [
        "To actually place a call, SnapServe needs the user's telephony credentials. It tries the user's **own** provider key first (BYOP), and falls back to **platform-managed** credentials stored in `platform_settings` (e.g. `managed_twilio_api_key`).",
        "This mirrors the billing model from the minute-rates chapter: bring your own keys and you pay providers directly; otherwise SnapServe's managed credentials make it work out of the box. For VoBiz specifically, environment variables (`VOBIZ_AUTH_ID` / `VOBIZ_AUTH_TOKEN`) serve as the ultimate fallback.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/campaignCaller.ts",
      language: "typescript",
      intro:
        "Once credentials and AMD config are resolved, the right provider's dial helper is called. Here's the Twilio branch.",
      code: `    const agentCfg = (agent.agentConfig ?? {}) as Record<string, unknown>;
    // AMD (synchronous voicemail detection) — normalised across both config shapes.
    const amd = resolveAmdConfig(agentCfg);

    if (provider === "twilio") {
      const accountSid = creds.accountSid;
      const fromNumber = campaign.fromNumber ?? creds.fromNumber;
      if (!accountSid || !fromNumber) throw new Error("Twilio config missing accountSid or fromNumber");
      const recordingEnabled = agentCfg["recordingEnabled"] === true;
      await dialTwilio({
        accountSid,
        authToken: creds.apiKey,
        fromNumber,
        toNumber: lead.phone,
        webhookUrl: \`\${baseUrl}/api/webhooks/twilio/voice?agentId=\${agent.id}&campaignLeadId=\${lead.id}\`,
        statusCallbackUrl: \`\${baseUrl}/api/webhooks/twilio/status\`,
        ...(amd.enabled ? { machineDetection: amd.twilioMode } : {}),
        ...(recordingEnabled ? {
          recordingEnabled: true,
          recordingStatusCallbackUrl: \`\${baseUrl}/api/webhooks/twilio/recording\`,
        } : {}),
      });
    }`,
      lines: [
        {
          lines: "1-3",
          label: "resolve AMD config",
          explanation:
            "`resolveAmdConfig(agentCfg)` normalizes the two different shapes the dashboard writes voicemail settings in, returning `{ enabled, twilioMode }`. One helper means every provider branch enables AMD consistently.",
        },
        {
          lines: "6-8",
          label: "validate before dialing",
          explanation:
            "`fromNumber` can come from the campaign or the credentials. Missing `accountSid`/`fromNumber` throws — and (you'll see next) the catch block turns that into a retry.",
        },
        {
          lines: "14-15",
          label: "the webhook carries identity",
          explanation:
            "The `webhookUrl` embeds `agentId` and `campaignLeadId` as query params. When Twilio connects the call, it hits this URL, and that's how the pipeline knows which agent to run and which lead this is.",
        },
        {
          lines: "16",
          label: "conditionally enable AMD",
          explanation:
            "`...(amd.enabled ? { machineDetection: amd.twilioMode } : {})` is the **conditional spread** trick — it adds the `machineDetection` key only when AMD is on, otherwise spreads nothing. Clean way to build optional options.",
        },
        {
          lines: "17-20",
          label: "conditional recording too",
          explanation:
            "Same spread pattern for call recording — added only when the agent has recording enabled.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/dial.ts",
      language: "typescript",
      intro:
        "AMD's normalizer lives in dial.ts. It reconciles the two config shapes the dashboard can produce into one clean answer.",
      code: `export function resolveAmdConfig(agentConfig: Record<string, unknown> | null | undefined): {
  enabled: boolean;
  twilioMode: "Enable" | "DetectMessageEnd";
} {
  const cfg = agentConfig ?? {};
  const modeRaw = String(cfg["machineDetectionMode"] ?? "").toLowerCase();
  const vmDetection = cfg["voicemailDetection"] === true;
  const enabledByMode =
    modeRaw === "enable" || modeRaw === "detect_message_end" || modeRaw === "detectmessageend";
  const enabled = vmDetection || enabledByMode;
  const twilioMode: "Enable" | "DetectMessageEnd" =
    modeRaw === "detect_message_end" || modeRaw === "detectmessageend" ? "DetectMessageEnd" : "Enable";
  return { enabled, twilioMode };
}`,
      lines: [
        {
          lines: "6-7",
          label: "read both config shapes",
          explanation:
            "Older screens write `voicemailDetection: boolean`; newer ones write `machineDetectionMode: \"enable\" | \"detect_message_end\"`. This reads both so neither path is left out.",
        },
        {
          lines: "8-10",
          label: "enabled if EITHER says so",
          explanation:
            "AMD is on if the boolean is true OR the mode string indicates detection. `vmDetection || enabledByMode` unifies the two.",
        },
        {
          lines: "11-12",
          label: "pick the Twilio mode",
          explanation:
            "Twilio supports `Enable` (just detect) and `DetectMessageEnd` (wait for the beep). The mode string maps to one; default is `Enable`. Synchronous detection means Twilio delays the voice webhook until it knows human-vs-machine and includes `AnsweredBy` in the request.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/campaignCaller.ts",
      language: "typescript",
      intro:
        "The whole dial is wrapped in try/catch. On any failure, the lead is marked failed AND an automatic retry is scheduled.",
      code: `  } catch (err) {
    logger.error({ leadId: lead.id, campaignId: campaign.id, err }, "Campaign call failed");
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.update(campaignLeadsTable)
      .set({ callStatus: "failed", notes: errMsg })
      .where(eq(campaignLeadsTable.id, lead.id));

    await addTimelineEvent(lead.id, campaign.id, "call_failed", { reason: errMsg, attempt: newAttempts });

    // Schedule auto-retry if attempts remaining
    await scheduleRetry({
      leadId:            lead.id,
      campaignId:        campaign.id,
      currentAttempts:   newAttempts,
      maxAttempts:       campaign.maxAttempts ?? 1,
      retryDelayMinutes: campaign.retryDelayMinutes ?? 60,
      reason:            "failed",
    });
  }`,
      lines: [
        {
          lines: "3",
          label: "safe error message",
          explanation:
            "`err instanceof Error ? err.message : String(err)` defensively extracts a message whether the thrown thing is an Error or something else. A common, robust TS idiom.",
        },
        {
          lines: "4-8",
          label: "mark failed + timeline",
          explanation:
            "Record the failure on the lead and as a `call_failed` timeline event with the reason and which attempt this was. The dashboard reads these events.",
        },
        {
          lines: "11-18",
          label: "schedule the retry",
          explanation:
            "`scheduleRetry` enqueues another attempt — but only `if attempts remaining`. It respects `campaign.maxAttempts` (default 1) and waits `retryDelayMinutes` (default 60). This is what makes campaigns self-healing.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/services/retryEngine.ts",
      language: "typescript",
      intro:
        "scheduleRetry doesn't dial — it inserts a row into `call_retries` for a background poller to pick up later.",
      code: `  if (currentAttempts >= maxAttempts) {
    return false;
  }

  const nextAttempt = currentAttempts + 1;
  const scheduledAt = new Date(Date.now() + retryDelayMinutes * 60 * 1000);

  await db.insert(callRetriesTable).values({
    leadId,
    campaignId,
    attemptNumber: nextAttempt,
    scheduledAt,
    status:        "pending",
    reason,
  });`,
      lines: [
        {
          lines: "1-3",
          label: "stop at the attempt cap",
          explanation:
            "If we've already hit `maxAttempts`, return `false` — no more retries. This is the guard that prevents infinite redial loops on a permanently-bad number.",
        },
        {
          lines: "5-6",
          label: "compute the due time",
          explanation:
            "`Date.now() + retryDelayMinutes * 60 * 1000` schedules the retry that many minutes into the future (milliseconds math).",
        },
        {
          lines: "8-15",
          label: "enqueue, don't dial",
          explanation:
            "A `call_retries` row with `status: \"pending\"` and a `scheduledAt`. The retry engine's `processRetries` (run every 60s by the batch scheduler) finds due rows and re-fires them via `scheduleCampaignCall`. Decoupling scheduling from dialing keeps the system durable across restarts.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Pacing: callDelaySeconds between dials",
      body: [
        "`scheduleCampaignCall` doesn't always fire instantly. It reads `campaign.callDelaySeconds` (default 5) and uses `setTimeout` to space calls out. A delay of 0 fires immediately; anything more paces the campaign so you don't dial your whole list in one burst.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "campaignCaller.ts orchestrates compliance, telephony, and retries. Click a box to jump to its chapter.",
      nodes: [
        { id: "scheduler", label: "batchScheduler", sublabel: "starts batches every 60s" },
        { id: "caller", label: "campaignCaller.ts", sublabel: "THIS FILE — fireCampaignCall", current: true },
        { id: "compliance", label: "DNC + TRAI gates", sublabel: "isOnDnc / traiPreDialCheck" },
        { id: "dial", label: "dial.ts", sublabel: "dialTwilio/Plivo/Vobiz + AMD", chapterSlug: "telephony-overview" },
        { id: "pipeline", label: "the live pipeline", sublabel: "AI runs on the answered call", chapterSlug: "session-and-pipeline" },
        { id: "retry", label: "retryEngine.ts", sublabel: "call_retries poller" },
        { id: "timeline", label: "lead timeline", sublabel: "per-lead audit events" },
      ],
      edges: [
        { from: "scheduler", to: "caller", label: "fire this lead" },
        { from: "caller", to: "compliance", label: "may I call?" },
        { from: "caller", to: "dial", label: "place the call" },
        { from: "dial", to: "pipeline", label: "webhook → agent" },
        { from: "caller", to: "retry", label: "on failure, schedule" },
        { from: "retry", to: "caller", label: "re-fire when due" },
        { from: "caller", to: "timeline", label: "log every state change" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "A lead's number is on the user's Do-Not-Call list. What does `fireCampaignCall` do?",
          choices: [
            "Dials anyway but flags it.",
            "Marks the lead `skipped` with a note, logs a `dnc_blocked` timeline event, and returns without dialing.",
            "Throws an error that triggers a retry.",
            "Pauses the whole campaign.",
          ],
          correctIndex: 1,
          explanation:
            "DNC is a hard gate. The lead is set to `skipped`, a timeline event records why, and the function returns early — no dial, no retry.",
        },
        {
          prompt: "What does the conditional spread `...(amd.enabled ? { machineDetection: amd.twilioMode } : {})` accomplish?",
          choices: [
            "Always enables AMD.",
            "Adds the `machineDetection` option only when AMD is enabled; otherwise adds nothing.",
            "Disables recording.",
            "Spreads the entire agent config.",
          ],
          correctIndex: 1,
          explanation:
            "It conditionally includes a key. When `amd.enabled` is true it spreads `{ machineDetection: ... }`; when false it spreads `{}`, leaving the option out entirely.",
        },
        {
          prompt: "When a dial fails, why does `scheduleRetry` insert a `call_retries` row instead of just calling the dial function again?",
          choices: [
            "Recursion isn't allowed in Node.",
            "Decoupling scheduling from dialing makes retries durable — a background poller fires them when due, surviving restarts and respecting delay + max attempts.",
            "It's faster to insert a row.",
            "The database dials the call.",
          ],
          correctIndex: 1,
          explanation:
            "Persisting the retry as a row lets `processRetries` pick it up later (every 60s), honoring `retryDelayMinutes` and `maxAttempts`, and surviving process restarts — far more robust than an in-memory immediate redial.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Campaigns are outbound: `fireCampaignCall` dials one lead, running the AI agent on each connected call.",
        "Every dial passes a series of gates: phone normalization → DNC → TRAI compliance → concurrency limit → credentials → dial.",
        "Compliance blocks and concurrency caps result in `skipped`/`pending` with a logged reason, not errors.",
        "AMD (answering-machine detection) is normalized by `resolveAmdConfig` and enabled via conditional spreads per provider.",
        "Credentials try BYOP first, then platform-managed `platform_settings`, mirroring the billing model.",
        "Failures schedule durable retries via `call_retries` rows (respecting `maxAttempts` + `retryDelayMinutes`), and every state change is written to the lead timeline.",
      ],
    },
  ],
};
