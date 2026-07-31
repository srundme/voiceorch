import type { Chapter } from "../types";

export const telephonyTroubleshooting: Chapter = {
  slug: "telephony-troubleshooting",
  moduleId: "d4",
  number: "20.5",
  title: "Telephony Troubleshooting & Tuning",
  summary:
    "A symptom → cause → exact-fix playbook for the telephony layer: answer-URL errors, dead air at call start, mid-TTS drops (4010), one-way audio, inaudible ambient, transfer drops, and wrong call duration.",
  estMinutes: 20,
  fileRef: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
  prerequisites: [
    "vobiz-stream-complete",
    "keepalive-and-audio-continuity",
    "webhooks-and-xml",
    "numbers-and-inbound-routing",
  ],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "How to use this playbook",
      paragraphs: [
        "This is the chapter you open at 2am when a call is misbehaving. Each callout below is one **symptom**, its most likely **cause**, and the **exact file, function, or setting to change**. Work top to bottom — the symptoms are ordered roughly from 'the call never really started' to 'the call finished but the numbers are wrong'.",
        "A telephony bug almost always lives in one of five places: the answer webhook (`src/routes/webhooks.ts`), the XML generator (`getVobizAnswerXML` / `getPlivoAnswerXML`), the WebSocket handler (`vobiz.ts` / `plivo.ts`), the keepalive/continuity code (`early-ambient.ts` + the pipeline `ambientInterval`), or the transfer path (`transfer.ts` + the transfer branch in `session.ts`). Keep those five open.",
        "Before diving in, remember the golden number: **hangup 4010** = VoBiz tore the call down after ~2 s of silence. Any 'call dropped' symptom should make you ask 'did the outbound audio go quiet?' first.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Symptom: 'Error Reaching Answer URL' or the caller hears busy on inbound",
      body: [
        "**Cause A — the number isn't attached.** VoBiz only POSTs our answer webhook if the DID is attached to the VoBiz application. If the attach failed, VoBiz has nowhere to send the call.",
        "**Fix A:** Re-run the attach in `src/routes/phone-numbers.ts` (`configureVobizNumberWebhook`, the documented `POST /Account/{authId}/numbers/{+E164}/application`). There is also an idempotent repair path (search `re-pushes the inbound answer URL`) that re-attaches and verifies. Confirm the number row in the `phone_numbers` table has a non-null `agentId`.",
        "**Cause B — the answer webhook returned non-XML or a 4xx/5xx.** If `?agentId=` is absent and the dialed `To` matches no `phone_numbers` row, the handler returns `<Response><Speak>Agent not configured for this number.</Speak><Hangup/></Response>` (a hangup), which the carrier may surface as an answer-URL error.",
        "**Fix B:** Check the inbound routing in `src/routes/webhooks.ts` (`POST /webhooks/vobiz/voice`). Verify the `To` canonicalizes to a shape present in `phone_numbers.number`. The candidate-set + last-10-digit SQL fallback should catch format drift — if it doesn't, the row is genuinely missing or unassigned.",
        "**Cause C — signature rejection in prod.** In `IS_PROD`, a missing/invalid Plivo signature returns 403 `<Speak>Forbidden</Speak>`.",
        "**Fix C:** Verify the agent's provider auth token is stored (`getAgentProviderToken`) and that `WEBHOOK_BASE_URL` matches the host the provider signs against — a wrong host makes `signedRequestUrl` reconstruct the wrong URL and every signature fails.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Symptom: the call connects but the caller drops before hearing anything (invalid answer XML)",
      body: [
        "**Cause — unescaped `&` in the Stream URL.** When the WS URL has multiple query params (`?from=…&to=…&callUuid=…`), a bare `&` is an XML parse error. VoBiz rejects the whole answer XML with **HangupCauseCode 8011 'Invalid Answer XML'** and drops the call before opening the socket.",
        "**Fix:** This is handled by `wsUrl.replace(/&/g, \"&amp;\")` in `getVobizAnswerXML` (and the equivalent in `getPlivoAnswerXML`). If you add a new XML template or build a URL by hand, you MUST XML-escape it. Log the returned XML (the VoBiz webhook already logs `VoBiz outbound AMD answer XML returned`) and eyeball it for raw `&`.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: dead air / silence at the very start of the call",
      body: [
        "**Cause A — early ambient not started, or started too late.** Session setup (`createSession`) takes seconds; without a keepalive the caller hears silence and VoBiz's ~2 s idle timer risks a 4010 drop.",
        "**Fix A:** Confirm `startEarlyAmbientKeepalive` is called at the top of the `start` handler in `vobiz.ts` (or at WS-open in `plivo.ts`) with the correct `format` (`\"pcm16\"` for VoBiz, `\"mulaw\"` for Plivo). In `early-ambient.ts`, the manual `tick()` right after `setInterval` sends frame zero immediately — if you removed it, the first 20 ms is dead air.",
        "**Cause B — agent ambient disabled AND provider isn't VoBiz.** With ambient off, early-ambient sends silent keepalive frames; that keeps VoBiz alive but the caller still hears nothing until the greeting.",
        "**Fix B:** This is expected behaviour, not a bug — the greeting follows shortly. If you want audible comfort noise during setup, enable ambient on the agent (`ambientNoiseEnabled` + `ambientNoiseTrack` in `agentConfig`).",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: call drops mid-sentence during TTS (hangup 4010)",
      body: [
        "**Cause — the outbound channel went silent past ~2 s.** Between sentences the TTS pump pauses while the LLM produces the next chunk, and the drain queue can empty during a streaming stall. If both happen and no fill frame goes out for ~2 s, VoBiz drops with 4010.",
        "**Fix — the keepalive watchdog must be running.** In the pipeline's `ambientInterval` (search `KEEPALIVE_FILL_GAP_MS`), the fill fires when `!isSendingTtsAudio` OR the gap since `lastTtsFrameAt` ≥ 500 ms. Verify: (1) the interval isn't cleared early, (2) `lastTtsFrameAt` is stamped on every real frame in the drain path, and (3) `armTailEchoGrace` re-stamps `lastTtsFrameAt` on entering Listening.",
        "**Tuning:** `KEEPALIVE_FILL_GAP_MS = 500` is the sweet spot. Do NOT lower it toward 60 ms — that interleaves fill frames into bursty TTS and produces the chopped 'helicopter' artifact. Do not raise it near 2000 ms either, or you lose margin before the 4010 drop.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: chopped, stuttering, 'helicopter' audio (especially on voicemail)",
      body: [
        "**Cause A — two senders on the same 20 ms cadence.** On the AMD/voicemail path, a manual pump AND the keepalive watchdog both sending doubles the frame rate and chops the audio.",
        "**Fix A:** Ensure `amdVmManualPumpActive` is set while the AMD-confirmation / voicemail-wait loops pump their own frames; the watchdog checks it and stands down (`if (this.amdVmManualPumpActive) return;`). It must be cleared just before `playSentence` so the watchdog can still guard playback.",
        "**Cause B — a leaked early-ambient interval.** If `stop()` wasn't called (or wasn't idempotent), early-ambient keeps ticking after the pipeline starts — again two senders.",
        "**Fix B:** In `vobiz.ts`/`plivo.ts`, `stopSilence()`/`stopEarlyAmbient()` must be called on first `onAudioOut`, on session-ready (safety net), in `onCallEnd`, and on error. `early-ambient.ts`'s `stop()` is guarded by `if (stopped) return;` so repeat calls are safe.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Symptom: one-way audio (agent hears caller, or caller hears agent, but not both)",
      body: [
        "**Cause A — caller → agent broken (agent can't hear).** The inbound `media` frames aren't reaching the pipeline. Common reasons: the frame is on a non-`inbound` track and correctly skipped, but the caller's real track is mislabelled; or the base64 decode is fed to the wrong pipeline entry point.",
        "**Fix A:** In `vobiz.ts` `case \"media\"`, confirm the `track !== \"inbound\"` guard isn't dropping the caller, and that `session.pipeline.onRawPcm8kIn(pcm8k, …)` runs (Plivo uses `onAudioIn` with μ-law). Check the `mediaFormat.encoding` logged on the `start` event is `audio/x-l16`.",
        "**Cause B — agent → caller broken (caller can't hear).** Either the `contentType` is wrong (VoBiz mis-decodes our L16 as μ-law → 'tractor/glitch' or silence) or we byte-swapped.",
        "**Fix B:** In `getVobizAnswerXML` the `<Stream>` MUST carry `contentType=\"audio/x-l16;rate=8000\"`. In `sendAudioToVobiz`, send PCM **as-is** — little-endian, no byte-swap. For Plivo the `contentType` is `audio/x-mulaw;rate=8000`.",
        "**Cause C — Plivo `playAudio` event name wrong.** Plivo silently drops unknown events (`playback`, `media`); only `playAudio` plays.",
        "**Fix C:** Confirm `sendAudioToPlivo` emits `event: \"playAudio\"` with `contentType`/`sampleRate`, and only after `streamStarted` is true.",
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Symptom: ambient/background noise inaudible (line sounds dead during pauses)",
      body: [
        "**Cause A — ambient disabled on the agent.** No `ambientNoiseEnabled` / `ambientNoiseTrack` in `agentConfig` means the watchdog sends silent keepalive zeros (VoBiz) rather than comfort noise.",
        "**Fix A:** Enable ambient in the agent config: set `ambientNoiseEnabled: true`, pick an `ambientNoiseTrack` (built-in like `office-ambience`, or an uploaded track), and optionally `ambientNoiseVolume` (0–1).",
        "**Cause B — wrong encoding for the call.** Sending μ-law bytes into a raw-PCM (web) stream, or vice versa, plays as garbled static, not ambient.",
        "**Fix B:** The watchdog picks encoding via `this.config.rawPcmOutput ? nextPcmChunk() : nextMulawChunk()`. Verify `rawPcmOutput` matches the provider (true for VoBiz/web, false for μ-law telephony). Look for the one-shot log `Ambient noise: first silence chunk emitted to caller` to prove ambient actually hit the wire.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Symptom: transfer to human drops the caller instead of connecting",
      body: [
        "**Cause A — wrong call id.** Transfer targets `params.externalCallId`. If that holds the dial API's `request_uuid` instead of the live `CallUUID`, VoBiz's `/Call/{uuid}/` endpoint 404s and the caller is dropped.",
        "**Fix A:** Confirm the answer webhook threaded `?callUuid=` into the WS URL and the session stored it as `externalCallId` (see `vobiz.ts`: `resolvedCallId = urlCallUuid ?? callId`). The `request_uuid` must only ever be a correlation key, never the transfer id.",
        "**Cause B — missing or wrong `callerId`.** VoBiz rejects the outbound bridge to the human unless `<Dial>` carries a `callerId` that is a VoBiz-provisioned number on the account.",
        "**Fix B:** In `session.ts`'s VoBiz transfer branch, `callerId` = `fromNumber` on outbound, `toNumber` on inbound (both our platform number). If it's picking the customer's number, the direction logic is wrong.",
        "**Cause C — WS closed mid-transfer.** VoBiz sends `stop`/closes the media WS during the transfer; if `wasTransferred` wasn't set first, `onCallEnd` calls `ws.close()`, which VoBiz reads as a hang-up and aborts the transfer.",
        "**Fix C:** `wasTransferred = true` must be set BEFORE the provider transfer API call, and `onCallEnd` in `vobiz.ts` must skip `ws.close()` when `sess?.wasTransferred`. Also check the endpoint has NO `/Transfer/` suffix (VoBiz) and uses X-Auth headers, not Basic auth.",
        "**Cause D — operator hears no briefing on warm transfer.** The `<Number url=\"…\">` whisper attribute is Twilio-only; Plivo/VoBiz ignore it.",
        "**Fix D:** Use `confirmSound` on `<Dial>` (see `buildVobizWarmTransferXml`) — the Plivo-standard operator whisper — and omit `confirmKey` so it auto-bridges.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: wrong call duration on the timeline (too long, or billed for idle time)",
      body: [
        "**Cause A — duration anchored to media-connect, not answer.** If the `?ans=` anchor didn't arrive, the clock starts at media-stream connect — several seconds after the real answer — so the recording timeline and duration are off.",
        "**Fix A:** Confirm the answer webhook set `answeredAt: Date.now()` (VoBiz) / passed `Date.now()` (Plivo) and that `vobizAnsweredAt` in `index.ts` accepted it. That parser clamps the value to a sane window (`> now+5s` or `< now-120s` → dropped) because it's attacker-controllable — a clock skew or stale value falls back to session-creation time.",
        "**Cause B — billed for keepalive silence.** Telephony sessions can stay open long after talk ends (keepalive zeros, hangup never arriving, force-close at `maxDuration`). Wall-clock over-counts.",
        "**Fix B:** Billing uses `resolveBillableDurationSeconds` (`billable-duration.ts`): `min(wall-clock, max(lastMedia estimate, recording length) + idle grace)`. If durations look inflated, check that `lastMediaAtMs` tracks real media (not keepalive frames) and that `recordingSeconds` is being captured — keepalive silence isn't recorded, so recording length is the truer conversation signal.",
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Fast triage: read the logs in order",
      body: [
        "VoBiz calls log a breadcrumb trail. `VoBiz voice webhook received` (webhook hit) → `VoBiz outbound AMD answer XML returned` / the returned `<Stream>` XML → `Vobiz WebSocket connected` → `Vobiz start event` (with `resolvedCallId`, `streamCallId`, `corrToken`, `encoding`) → `Vobiz session started` (with `setupMs`).",
        "If the trail stops at 'webhook received', it's an XML/attach/signature problem (symptoms 1–2). Stops at 'connected' but no 'start' → the carrier didn't like the Stream element. Reaches 'start' but no 'session started' → `createSession` failed (check DB / the `Failed to create Vobiz session` error). A large `setupMs` explains start-of-call dead air. `Vobiz clearAudio sent (barge-in)` confirms barge-in fired.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Every symptom maps to one of these files. Click through to the deep-dive chapters.",
      nodes: [
        { id: "webhook", label: "webhooks.ts", sublabel: "answer URL, routing, signatures", chapterSlug: "webhooks-and-xml" },
        { id: "xml", label: "answer XML", sublabel: "Stream URL / escaping / contentType", chapterSlug: "vobiz-stream-complete" },
        { id: "ws", label: "vobiz.ts / plivo.ts", sublabel: "audio in/out, session race", chapterSlug: "vobiz-stream-complete" },
        { id: "keepalive", label: "keepalive + ambient", sublabel: "4010, dead air, helicopter", chapterSlug: "keepalive-and-audio-continuity" },
        { id: "transfer", label: "transfer.ts / session.ts", sublabel: "callerId, CallUUID, whisper", chapterSlug: "webhooks-and-xml" },
        { id: "numbers", label: "numbers + billing", sublabel: "attach, ans anchor, duration", chapterSlug: "numbers-and-inbound-routing", current: true },
      ],
      edges: [
        { from: "webhook", to: "xml", label: "returns" },
        { from: "xml", to: "ws", label: "opens WS" },
        { from: "ws", to: "keepalive", label: "continuity" },
        { from: "ws", to: "transfer", label: "redirect" },
        { from: "webhook", to: "numbers", label: "To → agent, ans" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "A VoBiz call drops mid-sentence with hangup 4010. What is the single most likely root cause?",
          choices: [
            "The caller's phone battery died.",
            "The outbound audio channel went silent for more than ~2 s (a TTS pause + drain stall), and the keepalive watchdog didn't fill the gap.",
            "The STT WebSocket closed.",
            "The signature check failed.",
          ],
          correctIndex: 1,
          explanation:
            "4010 = VoBiz tore the call down after ~2 s of no audio. The fix is the pipeline keepalive watchdog (KEEPALIVE_FILL_GAP_MS = 500) filling gaps, plus lastTtsFrameAt being stamped/re-stamped correctly.",
        },
        {
          prompt: "A warm transfer connects the operator but they hear no briefing. What's the fix?",
          choices: [
            "Add a `<Say>` verb.",
            "Use the Twilio `<Number url=\"…\">` whisper attribute.",
            "Use `confirmSound` on `<Dial>` (the Plivo/VoBiz-standard operator whisper) and omit `confirmKey`, because `<Number url=…>` is Twilio-only and silently ignored by VoBiz/Plivo.",
            "Increase the transfer timeout.",
          ],
          correctIndex: 2,
          explanation:
            "The per-<Number> url whisper is Twilio-only. VoBiz/Plivo use confirmSound on <Dial>, which plays to the operator then auto-bridges when confirmKey is omitted.",
        },
        {
          prompt: "Call durations look inflated — the timeline counts long idle stretches. Where do you look?",
          choices: [
            "The STT adapter's language code.",
            "`resolveBillableDurationSeconds` in `billable-duration.ts` and whether `lastMediaAtMs`/`recordingSeconds` track real conversation (not keepalive silence); also confirm the `?ans=` anchor set the clock to the real answer.",
            "The barge-in echo floor.",
            "The Plivo signature nonce.",
          ],
          correctIndex: 1,
          explanation:
            "Billing = min(wall-clock, max(last-media, recording) + grace). Keepalive silence isn't recorded, so recording length is the truer signal; and the ?ans= anchor must set the start to the real answer instant.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Answer-URL errors / inbound busy → number not attached (phone-numbers.ts), To doesn't resolve to an agent (webhooks.ts routing), or a prod signature rejection (check WEBHOOK_BASE_URL + provider token).",
        "Call connects then drops before audio → unescaped `&` in the Stream URL → VoBiz code 8011; fix is `replace(/&/g, \"&amp;\")` in the XML generator.",
        "Dead air at start → early-ambient not started / wrong `format` / missing immediate `tick()`. Mid-TTS 4010 drop → keepalive watchdog gap; keep KEEPALIVE_FILL_GAP_MS at 500.",
        "Helicopter/chopped audio → two senders on one cadence; ensure `amdVmManualPumpActive` gates the watchdog and early-ambient `stop()` is called (and idempotent).",
        "One-way audio → check the `inbound` track guard + `onRawPcm8kIn`, the `contentType` (`audio/x-l16` vs `audio/x-mulaw`), no byte-swap, and Plivo's `playAudio` event name after `streamStarted`.",
        "Transfer drops → use the live CallUUID (not request_uuid), set `callerId` by direction, set `wasTransferred` before the API call so `onCallEnd` skips `ws.close()`, and hit `/Call/{uuid}/` with no `/Transfer/` suffix and X-Auth headers.",
        "Wrong duration → `?ans=` answer anchor (clamped in index.ts) plus `resolveBillableDurationSeconds` using real media/recording signals, not keepalive silence.",
      ],
    },
  ],
};
