import type { Chapter } from "../types";

export const webhooksAndXml: Chapter = {
  slug: "webhooks-and-xml",
  moduleId: "d4",
  number: "20.3",
  title: "Webhooks, XML & Transfer",
  summary:
    "The answer/hangup webhooks, VoBiz/Plivo XML generation (Stream URL as element text, Speak vs Say), provider signature verification, and the transfer-to-human dial (callerId + the CallUUID/request_uuid mismatch).",
  estMinutes: 22,
  fileRef: "artifacts/api-server/src/routes/webhooks.ts",
  prerequisites: ["vobiz-stream-complete", "webhooks"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "A telephony provider talks to us in two ways. First, **webhooks**: ordinary HTTP POSTs the carrier sends when something happens — a call is answered, a call ends. We reply with **XML** that tells the carrier what to do next (usually: open a media-stream WebSocket). Second, the **REST API**: HTTP calls *we* make to the carrier to dial out or redirect a live call.",
        "This chapter reads the real answer-webhook handlers, the XML generators for VoBiz and Plivo, the signature-verification helpers that prove a webhook really came from the provider, and the transfer-to-human path with its two famous traps: the `callerId` requirement and the CallUUID-vs-request_uuid mismatch.",
        "Two vocabulary notes up front. Twilio's XML dialect is called **TwiML** and its 'speak this text' verb is `<Say>`. Plivo and VoBiz use a Plivo-compatible dialect where the same verb is `<Speak>`. Mixing them up produces a call that connects and then does nothing.",
      ],
    },
    {
      kind: "concept",
      title: "Why sign a webhook?",
      body: [
        "Our webhook URLs are public — anyone who guesses `/api/webhooks/vobiz/voice` could POST to it and try to make our agent dial premium-rate numbers or leak data.",
        "So providers **sign** each request: they compute a hash (HMAC) over the request URL and body using a secret only they and we know (the account auth token), and send it in a header. We recompute the same hash and compare. If it matches, the request genuinely came from the provider; if not, we reject it.",
        "The exact recipe differs per provider — Twilio uses HMAC-SHA1 over URL + sorted body params; Plivo v2 uses HMAC-SHA256 over (nonce + URL). VoBiz has no standard scheme, so we skip it. Getting the URL reconstruction byte-for-byte right is the whole game — one wrong character and every signature fails.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/webhooks.ts",
      language: "typescript",
      intro:
        "Signature checks start by reconstructing the exact public URL the provider signed. `signedRequestUrl` uses forwarded headers (we sit behind a proxy) and `originalUrl` (which keeps the `/api` mount prefix).",
      code: `function signedRequestUrl(
  req: { headers: Record<string, string | string[] | undefined>; hostname: string; originalUrl: string },
  opts: { includeQuery: boolean },
): string {
  const proto = firstForwarded(req.headers["x-forwarded-proto"], "https");
  const host  = firstForwarded(req.headers["x-forwarded-host"], req.hostname);
  const pathWithQuery = req.originalUrl || "";
  const path = opts.includeQuery ? pathWithQuery : (pathWithQuery.split("?")[0] ?? "");
  return \`\${proto}://\${host}\${path}\`;
}`,
      lines: [
        {
          lines: "5-6",
          label: "trust the forwarded headers",
          explanation:
            "Behind Railway/Replit's proxy, `req.protocol` and `req.host` reflect the internal hop, not the public URL the provider actually hit. `x-forwarded-proto` / `x-forwarded-host` carry the real values the provider signed against.",
        },
        {
          lines: "7",
          label: "originalUrl, not path",
          explanation:
            "This router is mounted under `/api`. `req.path` is route-local and would drop that prefix; `req.originalUrl` keeps the full path — which is exactly what the provider saw and signed.",
        },
        {
          lines: "8",
          label: "includeQuery — Twilio vs Plivo",
          explanation:
            "Twilio signs the full URL *including* the query string; Plivo signs the base URL with the query *stripped*. The single `includeQuery` flag lets both callers reconstruct their provider's exact signed string.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/lib/webhook-signature.ts",
      language: "typescript",
      intro:
        "The Plivo v2 verifier. Note the timing-safe comparison — a plain `===` would leak, bit by bit, how much of the signature was correct via response-time differences.",
      code: `export function validatePlivoSignature(
  authToken: string,
  nonce: string,
  baseUrl: string,
  signature: string,
): boolean {
  if (!authToken || !nonce || !signature) return false;
  const data = baseUrl + nonce;
  const expected = createHmac("sha256", authToken).update(data, "utf8").digest("base64");
  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}`,
      lines: [
        {
          lines: "7",
          label: "reject missing inputs",
          explanation:
            "No token, nonce, or signature → immediately false. Never treat a request with no proof as valid.",
        },
        {
          lines: "8-9",
          label: "the HMAC recipe",
          explanation:
            "Plivo v2 signs `baseUrl + nonce` (URL first, then the anti-replay nonce from the header) with HMAC-SHA256 keyed on the account auth token, base64-encoded. Twilio's `validateTwilioSignature` is the same idea but SHA1 over `url + sortedBodyParams`.",
        },
        {
          lines: "12-13",
          label: "timingSafeEqual",
          explanation:
            "A naive `expected === signature` returns as soon as it finds a mismatched character, so an attacker can time responses to discover the signature one character at a time. `timingSafeEqual` always compares the whole buffer in constant time, closing that side channel.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/webhooks.ts",
      language: "typescript",
      intro:
        "The Plivo answer webhook, wired together. Signature first, then AMD gating, then generate the answer XML. Notice every early-exit speaks `<Speak>` (Plivo dialect), not `<Say>`.",
      code: `router.post("/webhooks/plivo/voice", async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.query["agentId"] ?? req.body?.agentId ?? "0"), 10);
  if (!agentId) {
    res.status(400).set("Content-Type", "text/xml").send("<Response><Speak>Agent not configured.</Speak><Hangup/></Response>");
    return;
  }
  const plivoSig   = String(req.headers["x-plivo-signature-v2"] ?? "");
  const plivoNonce = String(req.headers["x-plivo-signature-v2-nonce"] ?? "");
  if (plivoSig && plivoNonce) {
    const authToken = await getAgentProviderToken(agentId, "plivo");
    // ...
    const plivoBaseUrl = signedRequestUrl(req, { includeQuery: false });
    const valid = validatePlivoSignature(authToken, plivoNonce, plivoBaseUrl, plivoSig);
    if (!valid && IS_PROD) {
      res.status(403).set("Content-Type", "text/xml").send("<Response><Speak>Forbidden.</Speak><Hangup/></Response>");
      return;
    }
  } else if (IS_PROD) {
    res.status(403).set("Content-Type", "text/xml").send("<Response><Speak>Forbidden.</Speak><Hangup/></Response>");
    return;
  }`,
      lines: [
        {
          lines: "3-6",
          label: "no agent → polite hangup",
          explanation:
            "If there's no agent id we can't route the call, so we return XML that speaks a short message and hangs up — the caller hears something instead of silence.",
        },
        {
          lines: "11-12",
          label: "base URL, query stripped",
          explanation:
            "Plivo signs the base URL, so `includeQuery: false`. This must match Plivo's computation exactly.",
        },
        {
          lines: "13-16",
          label: "reject only in prod",
          explanation:
            "A failed signature returns 403 with a `<Speak>Forbidden</Speak><Hangup/>` — but only when `IS_PROD`. In dev the check is lenient so you can `curl` the endpoint without a real Plivo signature.",
        },
        {
          lines: "17-19",
          label: "missing headers in prod = reject",
          explanation:
            "If the signature headers are absent entirely and we're in production, reject. A legitimate Plivo request always carries them.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "`<Say>` is Twilio-only; Plivo/VoBiz want `<Speak>`",
      body: [
        "The Twilio TwiML verb to speak text is `<Say>`. The Plivo/VoBiz dialect calls it `<Speak>`. Look closely at the handlers: the Twilio branch's error XML uses `<Say>`, while the Plivo and VoBiz branches use `<Speak>`. The `applyAmdGate` helper even takes a `speakTag: \"Say\" | \"Speak\"` parameter so it emits the right verb for the right provider.",
        "Send `<Say>` to Plivo and the verb is silently ignored — the call connects, then sits in dead air. This is one of those bugs that looks like a networking problem but is really a one-word XML dialect mistake.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/webhooks.ts",
      language: "typescript",
      intro:
        "The tail of the Plivo webhook: build the answer XML. From/To are POSTed on the webhook body and threaded into the WS URL, plus the CallUUID and `Date.now()` as the answer anchor.",
      code: `  const wsBaseUrl = getWsBaseUrl(req);
  const campaignLeadId = req.query["campaignLeadId"] ? parseInt(String(req.query["campaignLeadId"]), 10) : undefined;
  const callDirection = req.query["dir"] === "out" ? "outbound" : "inbound";
  const plivoAnswerCbId = req.query["cbId"] ? (parseInt(String(req.query["cbId"]), 10) || undefined) : undefined;
  const plivoFrom = String(req.body?.From ?? req.body?.from ?? "") || undefined;
  const plivoTo   = String(req.body?.To ?? req.body?.to ?? "") || undefined;
  const plivoCallUuid = String(req.body?.CallUUID ?? req.body?.call_uuid ?? "") || undefined;
  const xml = getPlivoAnswerXML(wsBaseUrl, agentId, campaignLeadId, callDirection, plivoAnswerCbId, plivoFrom, plivoTo, plivoCallUuid, Date.now());

  res.set("Content-Type", "text/xml").send(xml);
});`,
      lines: [
        {
          lines: "5-7",
          label: "From/To/CallUUID from the body",
          explanation:
            "Plivo's Stream `start` event does NOT carry the caller/callee numbers, and the CallUUID is only known here. So the webhook reads them from the POST body and threads them into the WS URL — the same smuggling trick VoBiz uses.",
        },
        {
          lines: "8",
          label: "Date.now() as the answer anchor",
          explanation:
            "The final argument is the answer instant. It becomes `?ans=` in the WS URL so the session anchors duration and recording to now — the moment the callee answered — not the later media-connect.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/plivo.ts",
      language: "typescript",
      intro:
        "getPlivoAnswerXML. The single most important detail: the WebSocket URL is the TEXT of <Stream>, not a `url=\"...\"` attribute — a mistake that cost hours of silent-then-dropped calls.",
      code: `  const wsUrl = \`\${wsBaseUrl}/api/ws/plivo/\${agentId}\${qs}\`.replace(/&/g, "&amp;");
  return \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream keepCallAlive="true" streamTimeout="86400" contentType="audio/x-mulaw;rate=8000" bidirectional="true">\${wsUrl}</Stream>
</Response>\`;`,
      lines: [
        {
          lines: "1",
          label: "XML-escape the ampersands",
          explanation:
            "Same rule as VoBiz: a bare `&` in the URL is an XML parse error. Replace with `&amp;`; Plivo decodes it back when reading the URL.",
        },
        {
          lines: "4",
          label: "URL as element text",
          explanation:
            "Per Plivo's Stream docs, the WS URL is the **text content** of `<Stream>`. The intuitive-looking `<WebSocket url=\"...\"/>` child was silently ignored → no stream ever connected → the call sat in silence and dropped. Also note `contentType=\"audio/x-mulaw;rate=8000\"` — Plivo is μ-law, unlike VoBiz's L16.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Transfer to a human",
      paragraphs: [
        "When the agent decides to hand the call to a person, it calls a REST endpoint on the carrier to **redirect** the live call to a new XML URL that returns a `<Dial>` instruction. This is the transfer path, and it has two traps unique to VoBiz.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/session.ts",
      language: "typescript",
      intro:
        "The VoBiz transfer branch. Trap one: VoBiz requires a `callerId` on the outbound `<Dial>`, and it must be OUR provisioned number — chosen by direction.",
      code: `      } else if (tprov === "vobiz") {
        const authToken = providerKeys.get("vobiz") ?? "";
        const extra = providerKeys.get("vobiz:extraConfig");
        const cfg = extra ? (JSON.parse(extra) as Record<string, string>) : {};
        const authId = cfg["authId"] ?? "";
        // VoBiz needs a callerId on the <Dial> to the human agent - it must be a
        // VoBiz-provisioned number on the account (our platform number), NOT the
        // customer. Outbound: fromNumber is the platform number; inbound:
        // toNumber is the platform number.
        const callerId = params.callDirection === "outbound" ? params.fromNumber : params.toNumber;
        const callerIdQs = callerId ? \`&callerId=\${encodeURIComponent(callerId)}\` : "";
        let xmlUrl: string;
        if (isWarm && transferId && briefingToken) {
          xmlUrl = \`\${baseUrl}/api/webhooks/vobiz/warm-transfer-xml?target=\${encodeURIComponent(to)}&transferId=\${transferId}&token=\${encodeURIComponent(briefingToken)}\${callerIdQs}\`;
        } else {
          xmlUrl = \`\${baseUrl}/api/webhooks/vobiz/transfer-xml?target=\${encodeURIComponent(to)}\${callerIdQs}\`;
        }
        await transferVobizCall({ authId, authToken, callUuid: params.externalCallId, xmlUrl, callDirection: params.callDirection });
      }`,
      lines: [
        {
          lines: "6-10",
          label: "callerId picked by direction",
          explanation:
            "The outbound bridge to the human agent must present a VoBiz-provisioned number as the callerId, or VoBiz rejects the dial and drops the caller. On an **outbound** call our platform number is `fromNumber`; on an **inbound** call it is `toNumber` (the DID the caller dialed). Pick the right side or the transfer fails.",
        },
        {
          lines: "18",
          label: "callUuid: params.externalCallId",
          explanation:
            "Trap two, right here: the transfer targets `externalCallId`, which is the live **CallUUID** from the answer webhook. The dial API's `request_uuid` would 404 on this endpoint — only the CallUUID works.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "CallUUID vs request_uuid — the id that transfers",
      body: [
        "When we dial out, VoBiz's response returns a **`request_uuid`** — an id for THAT outbound API request. It is NOT the live call. The live **`CallUUID`** arrives later, on the HTTP answer webhook, as the `CallUUID` field.",
        "Only the CallUUID is accepted by the `/Call/{uuid}/` redirect endpoint; passing the request_uuid returns 404 and the transfer silently fails, leaving the caller stuck with the AI. That is why the answer webhook threads `?callUuid=` into the WS URL, the session stores it as `externalCallId`, and transfer uses exactly that.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/transfer.ts",
      language: "typescript",
      intro:
        "The VoBiz REST transfer call and its cold-transfer XML. Note the endpoint has NO /Transfer/ suffix (that path 404s) and the XML uses <Number> inside <Dial> (bare <Dial>NUMBER</Dial> is Twilio-only).",
      code: `export async function transferVobizCall(opts: {
  authId: string; authToken: string; callUuid: string; xmlUrl: string;
  callDirection?: "inbound" | "outbound";
}): Promise<void> {
  const url = \`https://api.vobiz.ai/api/v1/Account/\${opts.authId}/Call/\${opts.callUuid}/\`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "X-Auth-ID": opts.authId, "X-Auth-Token": opts.authToken, "Content-Type": "application/json" },
    body: JSON.stringify({ legs: "aleg", aleg_url: opts.xmlUrl, aleg_method: "GET" }),
  });
  if (!resp.ok) throw new Error(\`VoBiz transfer API error \${resp.status}\`);
}

export function buildTransferXml(target: string, callerId?: string): string {
  const e = xmlEscape(normalizePhone(target));
  const c = callerId ? \` callerId="\${xmlEscape(normalizePhone(callerId))}"\` : "";
  return \`<?xml version="1.0" encoding="UTF-8"?>\\n<Response>\\n  <Dial\${c}>\\n    <Number>\${e}</Number>\\n  </Dial>\\n</Response>\`;
}`,
      lines: [
        {
          lines: "5",
          label: "no /Transfer/ suffix",
          explanation:
            "The correct VoBiz endpoint is `/Call/{uuid}/` — plain. Plivo uses `/Call/{uuid}/Transfer/`, but that suffix 404s on VoBiz. Small path difference, whole feature broken.",
        },
        {
          lines: "8",
          label: "X-Auth headers, not Basic",
          explanation:
            "VoBiz authenticates with custom `X-Auth-ID` / `X-Auth-Token` headers. Sending standard HTTP Basic auth (which Plivo and Twilio use) gets an immediate 401.",
        },
        {
          lines: "15-17",
          label: "<Number> inside <Dial>, with callerId",
          explanation:
            "VoBiz (Plivo-compatible) needs `<Number>NUMBER</Number>` wrapped in `<Dial>`. Bare `<Dial>NUMBER</Dial>` is Twilio syntax and makes VoBiz drop the call. The `callerId` attribute — our provisioned number — is required for the outbound leg to the human agent. All values are XML-escaped because they're query-derived.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Webhooks return XML that opens the stream; transfer uses the REST API with the CallUUID. Click to explore.",
      nodes: [
        { id: "sig", label: "webhook-signature.ts", sublabel: "HMAC verify", current: true },
        { id: "webhook", label: "answer webhook", sublabel: "webhooks.ts — THIS FILE", current: true },
        { id: "xml", label: "getPlivo/VobizAnswerXML", sublabel: "<Stream> text URL", chapterSlug: "vobiz-stream-complete" },
        { id: "vobizws", label: "handleVobizWebSocket", sublabel: "reads ?callUuid", chapterSlug: "vobiz-stream-complete" },
        { id: "transfer", label: "transfer.ts", sublabel: "REST redirect + <Dial>", current: true },
        { id: "session", label: "session transfer", sublabel: "picks callerId by direction", chapterSlug: "session-and-pipeline" },
      ],
      edges: [
        { from: "sig", to: "webhook", label: "validate…Signature" },
        { from: "webhook", to: "xml", label: "returns <Stream>" },
        { from: "xml", to: "vobizws", label: "?callUuid smuggled" },
        { from: "session", to: "transfer", label: "callUuid = externalCallId" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does the transfer use `params.externalCallId` (the CallUUID) rather than the id returned by the dial API?",
          choices: [
            "The dial id is too long.",
            "The dial API returns a `request_uuid` that identifies the API request, not the live call; only the `CallUUID` (from the answer webhook, stored as externalCallId) is accepted by the redirect endpoint — a request_uuid 404s.",
            "They are the same value.",
            "The CallUUID is easier to type.",
          ],
          correctIndex: 1,
          explanation:
            "request_uuid identifies the outbound dial request; the live CallUUID arrives on the answer webhook and is the only id the /Call/{uuid}/ redirect accepts. Using request_uuid returns 404 and the transfer silently fails.",
        },
        {
          prompt: "The Plivo answer XML puts the WebSocket URL where?",
          choices: [
            "In a `url=\"...\"` attribute on a `<WebSocket>` child.",
            "As the TEXT content of the `<Stream>` element — the attribute form is silently ignored, producing a silent call that drops.",
            "In an HTTP header.",
            "In the query string of the webhook.",
          ],
          correctIndex: 1,
          explanation:
            "Per Plivo's Stream docs the URL is the text content of <Stream>. The <WebSocket url=...> child was ignored, so no media stream connected and the call sat silent before dropping.",
        },
        {
          prompt: "Why does the signature comparison use `timingSafeEqual` instead of `===`?",
          choices: [
            "It is faster.",
            "`===` short-circuits at the first mismatched byte, leaking via response timing how much of the signature is correct; `timingSafeEqual` compares in constant time and closes that side channel.",
            "It handles Unicode better.",
            "It automatically decodes base64.",
          ],
          correctIndex: 1,
          explanation:
            "A naive equality check returns early on the first mismatch, letting an attacker time responses to recover the signature character by character. Constant-time comparison prevents that.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Answer webhooks are HTTP POSTs from the carrier; we reply with XML that opens a media-stream WebSocket. The REST API is us calling the carrier to dial or redirect.",
        "Verify signatures by reconstructing the EXACT signed URL (forwarded headers + originalUrl; Twilio includes the query, Plivo strips it) and comparing HMACs with `timingSafeEqual`. VoBiz has no scheme.",
        "Dialect matters: Twilio TwiML uses `<Say>`; Plivo/VoBiz use `<Speak>`. `applyAmdGate` takes a `speakTag` so each provider gets the right verb.",
        "Both VoBiz and Plivo XML put the WS URL as the TEXT of `<Stream>` and XML-escape `&` → `&amp;`. VoBiz is L16, Plivo is μ-law (`contentType`).",
        "VoBiz transfer requires a `callerId` (our provisioned number, chosen by call direction) on `<Number>` inside `<Dial>`, hits `/Call/{uuid}/` with NO `/Transfer/` suffix, and authenticates with X-Auth headers.",
        "Only the live CallUUID transfers a call; the dial API's request_uuid 404s — the reason the answer webhook threads `?callUuid=` all the way into the session's externalCallId.",
      ],
    },
  ],
};
