import type { Chapter } from "../types";

export const webhooksDeepDive: Chapter = {
  slug: "webhooks-deep-dive",
  moduleId: "m6",
  number: "7.9",
  title: "Webhooks In Depth",
  summary:
    "How telephony providers (VoBiz, Twilio) notify SnapServe of call outcomes — HMAC signing, no-answer detection, the feedback loop to the retry engine, and why toNumber is never trusted from the request body.",
  estMinutes: 17,
  fileRef: "artifacts/api-server/src/routes/webhooks.ts",
  prerequisites: ["outbound-calls", "retry-engine"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The problem: learning what happened after you hung up",
      paragraphs: [
        "When SnapServe dials an outbound call, it fires a POST to the telephony provider API and immediately returns. The provider takes over: it rings the callee, waits for an answer, handles voicemail, and eventually produces a terminal outcome — answered, busy, no-answer, or failed.",
        "The provider communicates that outcome by firing an HTTP request (a *status webhook*) back to SnapServe at a URL embedded in the original dial request. This is the only way to know whether a call was answered. `routes/webhooks.ts` is the file that handles these inbound callbacks from every provider SnapServe supports.",
        "`webhooks.ts` is one of the most security-sensitive files in the codebase. It is publicly reachable from the internet and — if not carefully guarded — could let an attacker trigger arbitrary outbound calls by crafting a fake 'busy' webhook that triggers an unwanted retry.",
      ],
    },
    {
      kind: "concept",
      title: "Three categories of webhook",
      body: [
        "**Campaign-lead webhooks**: Tied to a `campaignLeadId`. The URL includes a `campaignLeadId` query param and an HMAC signature (`campaignLeadSig`). The handler verifies the signature, looks up the lead from DB (never trusts the request body for `toNumber`), and routes to `handleCampaignLeadTerminalStatus`.",
        "**Scheduled-callback webhooks**: Tied to a `cbId` (scheduled_callbacks row ID). The URL includes `cbId` and `cbSig` (HMAC of `cbid:{cbId}`). Verified before any DB read. Routes to `scheduleNextRedial` for no-answer outcomes.",
        "**Plain outbound call webhooks**: Neither campaign nor callback. The provider-supplied `CallUUID` (VoBiz) or `CallSid` (Twilio) is used to look up the call from DB. These UUIDs are validated to be at least 20 characters to prevent substring-match attacks with short tokens. Routes to `handleNoAnswerStatus` for no-answer outcomes.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "toNumber is NEVER taken from the request body",
      body: [
        "Every webhook handler derives `toNumber` from the DB record, never from the request body. Reason: the body is attacker-controlled. An attacker who discovers your webhook URL could POST a fake `busy` webhook with `toNumber = +1-555-VICTIM` and trigger a retry dial to an arbitrary number.",
        "The safe flow: extract only an identifier (cbId, campaignLeadId, or CallUUID) from the request, validate it (HMAC or length check), look up the corresponding DB record, read `toNumber` from the DB row. The body provides the identifier; the DB provides the data.",
      ],
    },
    {
      kind: "code",
      filename: "routes/webhooks.ts",
      language: "typescript",
      intro: "The VoBiz status webhook handler — showing the three-path routing and the HMAC verification.",
      code: `router.post("/webhooks/vobiz/status", async (req, res): Promise<void> => {
  res.sendStatus(204); // respond immediately; process fire-and-forget

  (async () => {
    const cbId           = parseInt(String(req.query["cbId"] ?? "0"), 10) || null;
    const cbSig          = String(req.query["cbSig"] ?? "");
    const campaignLeadId = parseInt(String(req.query["campaignLeadId"] ?? "0"), 10) || 0;
    const callStatus     = String(req.body?.HangupCause ?? req.body?.status ?? "");
    const callUuid       = String(req.body?.CallUUID ?? "");

    let agentId: number | null = null;
    let dbToNumber: string | null = null;

    if (cbId) {
      // Scheduled-callback path: verify HMAC before any DB read
      const expectedSig = createHmac("sha256", APP_SECRET)
        .update(\`cbid:\${cbId}\`).digest("hex");
      if (!timingSafeEqual(Buffer.from(cbSig), Buffer.from(expectedSig))) {
        logger.warn({ cbId }, "cbSig invalid — ignoring");
        return;
      }
      const [cb] = await db.select({ agentId: ..., toNumber: ... })
        .from(scheduledCallbacksTable)
        .where(eq(scheduledCallbacksTable.id, cbId));
      agentId = cb.agentId;
      dbToNumber = cb.toNumber;

    } else if (campaignLeadId) {
      // Campaign-lead path: verify campaignLeadSig, look up lead
      // ...same pattern, different table...

    } else {
      // Plain outbound: CallUUID must be at least 20 chars
      if (!callUuid || callUuid.length < 20) return;
      const [call] = await db.select({ agentId: ..., toNumber: ... })
        .from(callsTable)
        .where(sql\`metadata::text like \${"%" + callUuid + "%"}\`);
      agentId = call.agentId;
      dbToNumber = call.toNumber;
    }

    void handleNoAnswerStatus({ cbId, agentId, callStatus, toNumber: dbToNumber });
  })().catch(err => logger.error({ err }, "webhook error"));
});`,
      lines: [
        {
          lines: "2",
          label: "204 first, process async",
          explanation:
            "The 204 is sent immediately before any DB work. Telephony providers retry their webhooks if they don't get a 2xx response quickly (Twilio retries after 11 seconds, VoBiz after ~30). Fire-and-forget processing ensures we always respond fast regardless of DB latency.",
        },
        {
          lines: "15-20",
          label: "HMAC verification — timing-safe comparison",
          explanation:
            "`timingSafeEqual` from Node's `crypto` module prevents timing attacks. A naive `cbSig === expectedSig` comparison leaks how many characters match (it short-circuits at the first mismatch, which is measurable over thousands of requests). `timingSafeEqual` always takes the same time regardless of match position.",
        },
        {
          lines: "30-35",
          label: "CallUUID length check",
          explanation:
            "VoBiz UUIDs are 36 characters (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). Requiring `length >= 20` prevents an attacker from using a short common string that might appear in multiple call metadata blobs (`the`, `ok`, etc.) and match unintended records via the LIKE query.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "handleNoAnswerStatus: the retry feedback loop",
      paragraphs: [
        "`handleNoAnswerStatus` is called for all three paths when the outcome is a non-answer. It maps raw provider status strings (`busy`, `no-answer`, `noanswer`, `failed`, `HangupCause=NORMAL_CLEARING`) to a canonical set, then decides what to do next.",
        "If the status is in `NO_ANSWER_STATUSES` (`no-answer`, `busy`, `failed`), and the call is tied to a scheduled callback (`cbId` is set), it calls `scheduleNextRedial(prev)` to continue the chain. For plain outbound calls with no `cbId`, no automatic retry is scheduled — those are one-shot dials initiated by the dashboard or API.",
        "For campaign leads, `handleCampaignLeadTerminalStatus` is called instead. It updates the lead's `callStatus` to the terminal value and, if the status is retryable (busy, no-answer) AND the campaign's `maxRetries` haven't been reached, calls `scheduleRetry` in the retry engine.",
      ],
    },
    {
      kind: "code",
      filename: "routes/webhooks.ts",
      language: "typescript",
      intro: "The no-answer status set and the retry decision.",
      code: `const NO_ANSWER_STATUSES = new Set([
  "no-answer", "no_answer", "noanswer",
  "busy", "failed",
]);

async function handleNoAnswerStatus(opts: {
  cbId:       number | null;
  agentId:    number;
  callStatus: string;
  toNumber:   string;
  cbSecret?:  string | null;
}): Promise<void> {
  const normalized = opts.callStatus.toLowerCase().replace(/-/g, "_");

  if (!NO_ANSWER_STATUSES.has(normalized)) {
    // "completed" or "answered" — call was answered, no retry needed
    return;
  }

  if (opts.cbId) {
    // Continue the scheduled-callback chain
    const [prev] = await db.select()
      .from(scheduledCallbacksTable)
      .where(eq(scheduledCallbacksTable.id, opts.cbId));
    if (prev) await scheduleNextRedial(prev);
  }
  // else: plain outbound — no automatic retry
}`,
      lines: [
        {
          lines: "1-4",
          label: "NO_ANSWER_STATUSES",
          explanation:
            "Multiple spellings of the same status are included because providers are inconsistent. VoBiz uses `NORMAL_CLEARING` for a clean hang-up and `USER_BUSY` for busy — these are mapped to canonical strings earlier in the handler. Twilio uses `no-answer`. The set covers both.",
        },
        {
          lines: "13-16",
          label: "early return for completed",
          explanation:
            "If the call was answered (`completed`, `answered`), the function returns immediately. The call's status was already updated to `completed` by `endSession()` when the WebSocket closed — the webhook just confirms it.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Why Twilio and VoBiz webhooks are separate routes",
      body: [
        "Both Twilio and VoBiz fire status webhooks, but their request shapes are completely different. Twilio sends `CallStatus` and `CallSid` as form-encoded body fields. VoBiz sends `HangupCause` and `CallUUID` as JSON. Putting them in separate routes (`/webhooks/twilio/status` vs `/webhooks/vobiz/status`) keeps the parsing logic clean and makes it easy to add provider-specific signature validation (Twilio signs with an `X-Twilio-Signature` header; VoBiz uses the `callbackSecret` embedded in the URL).",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "An attacker POSTs to `/api/webhooks/vobiz/status?cbId=42` with a fake `cbSig`. What happens?",
          choices: [
            "The server looks up cbId=42 and fires a retry dial to that number",
            "The HMAC comparison fails → the handler returns early with no DB read or retry",
            "The server returns 400 Bad Request, leaking that cbId=42 exists",
            "Nothing — the 204 response is already sent before the check runs",
          ],
          correctIndex: 1,
          explanation:
            "The HMAC is verified before any DB read. If `cbSig` doesn't match `HMAC-SHA256(APP_SECRET, 'cbid:42')`, the handler logs a warning and returns. No DB query, no retry scheduled. The 204 was already sent (to avoid provider retries), but the async processing exits cleanly.",
        },
        {
          prompt: "Why does the plain-outbound path require CallUUID to be at least 20 characters?",
          choices: [
            "VoBiz UUIDs are always exactly 36 characters — shorter strings indicate forgeries",
            "To prevent substring-match attacks: a short common string like 'ok' could appear in multiple call metadata blobs",
            "Postgres LIKE queries are slow on short strings",
            "20 is a Twilio-specific minimum UUID length requirement",
          ],
          correctIndex: 1,
          explanation:
            "The metadata LIKE query matches any call whose JSON blob contains the UUID string. A short, common substring could match multiple unintended records. Requiring ≥20 characters makes it statistically impossible for a short crafted string to match a real CallUUID.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Three webhook paths: scheduled-callback (cbId + HMAC), campaign-lead (campaignLeadId + HMAC), plain-outbound (CallUUID, length-validated)",
        "`toNumber` is ALWAYS read from the DB record — never from the request body",
        "HMAC with `timingSafeEqual` prevents both forgery and timing attacks on the signature",
        "204 is sent immediately; processing is fire-and-forget so provider retry timers are never triggered",
        "`handleNoAnswerStatus` routes: busy/failed → retry chain; completed → no-op",
      ],
    },
  ],
};
