import type { Chapter } from "../types";

export const ttsTroubleshooting: Chapter = {
  slug: "tts-troubleshooting",
  moduleId: "d2",
  number: "18.5",
  title: "TTS Troubleshooting & Tuning Playbook",
  summary:
    "Symptom → cause → the exact file, setting, or dashboard field to change. Last words cut off, robotic/slow voice, wrong Tamil/brand pronunciation, mute agent with live transcript, delay before the agent speaks (TTFB), and choppy/helicopter audio.",
  estMinutes: 20,
  fileRef: "artifacts/api-server/src/orchestration/pipeline.ts",
  prerequisites: [
    "tts-pipeline-path",
    "sarvam-tts-complete",
    "cartesia-tts-complete",
    "other-tts-adapters",
  ],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "How to use this playbook",
      paragraphs: [
        "This is the last chapter of the TTS module. It's a lookup table: find your **symptom**, read the likely **cause**, then apply the exact **fix** — a real file path in `artifacts/api-server/...` or a named field in the agent editor at **Dashboard → Agents → Edit → Voice / Latency Tuning**.",
        "The golden rule of TTS debugging: **isolate the layer first.** Is the problem in the pipeline path (splitting, prefetch, drain), the adapter (protocol, format), or the dashboard config (speed, voice, language)? Each callout below tells you which layer to open.",
        "For every symptom, also check the call's **Execution Log**: the pipeline emits `TTS request` / `TTS response` rows (with `firstByteMs`, `audioBytes`) and, on failure, a `Provider Failed` row via `reportTtsFailure` plus an operator toast. That log is your first stop.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: the last word (or the goodbye) gets cut off",
      body: [
        "**Cause:** `drainSentenceJob` resolves the instant the final audio chunk is handed off, but the phone carrier's jitter buffer still holds ~100–300ms. If the tail-drain window is too short for this carrier, the last word is clipped.",
        "**Fix 1 (config):** Raise **Dashboard → Agents → Edit → Latency Tuning → Telephony Tail Drain (ms)** (`telephonyTailDrainMs`, default 400). Try 600–800ms. It only runs at the END of a turn, so it does NOT add mid-call latency.",
        "**Fix 2 (code check):** Confirm `drainPlaybackTail()` in `artifacts/api-server/src/orchestration/pipeline.ts` is actually running — it's a no-op if `this.closed` or `this.bargeInRequested` is already true. If the call is being torn down before the drain, the teardown path is firing too early.",
        "**Fix 3 (Sarvam-specific):** If ONLY Sarvam clips the sentence tail, verify the `{ type: \"flush\" }` message is still being sent after text in `synthesizeViaWs` (adapters/tts/sarvam.ts). Without the flush, audio below `min_buffer_size` never comes and the tail is silent.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Symptom: voice sounds robotic, rushed, or unnaturally slow",
      body: [
        "**Cause A (speed):** `ttsSpeed` is out of the sweet spot. **Fix:** set **Dashboard → Agents → Edit → Voice → TTS Playback Speed** (`ttsSpeed`) to 1.0–1.2. Each adapter clamps it — Cartesia to [0.6, 1.5], ElevenLabs to [0.7, 1.2], Sarvam pace to [0.5, 2] — so a value outside a provider's range is silently clamped, which can feel 'wrong' if you set 1.4 on ElevenLabs (clamped to 1.2).",
        "**Cause B (choppy prosody across sentences):** On Cartesia, each sentence sounding like a separate clip means the turn context isn't being used. **Fix:** confirm `startSentenceSynthesis` is calling `synthesizeStreamInContext` (it only does so when the adapter is a `CartesiaTTS` and a `turnContextId` exists — pipeline.ts). The shared `context_id` + `continue:true` is what makes prosody flow.",
        "**Cause C (wrong model):** A low-quality model id. **Fix:** check **TTS Model** in the editor. Cartesia defaults to `sonic-3.5`; Sarvam to `bulbul:v3`. An invalid model silently falls back to the default (see the `VALID` sets in each adapter), so a typo won't error — it just won't use the model you intended.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: mispronounced Tamil/Hindi words, brand names, or digits",
      body: [
        "**Cause A (wrong language on the synth):** If Tamil text is synthesized with an English language code it sounds garbled. **Fix:** the pipeline computes `ttsLanguage = this.currentLang || agentLanguage` and passes it into `createTTSAdapter` (pipeline.ts). Check the call's language events — call 4845's bug was `language:null` on Tamil synths because `agentLanguage` was unset. Set **Language** explicitly, or enable **Language Auto-Detect**, so `currentLang` is seeded.",
        "**Cause B (Indic number expansion):** Digits like `500` read wrong. **Fix:** toggle `sarvamIndicNumbers` (agent config, default true) — this maps to Sarvam's `enable_preprocessing`, which expands `500` → `paanch sau`. Turn it OFF if you want English digits embedded in Indic sentences; the pipeline builds this into Sarvam's `extraConfig` JSON.",
        "**Cause C (currency symbol):** `₹` is read as the stiff literary word (`ரூபாய்`/`रुपया`). **Fix:** already handled — `startSentenceSynthesis` strips `₹` before synthesis (`text = text.replace(/₹\\s*/g, \"\")`). If it still appears, the symbol is arriving via a path that bypasses `startSentenceSynthesis`.",
        "**Cause D (brand name):** A brand read phonetically wrong. **Fix:** spell it in the LLM system prompt the way it should sound, or (Cartesia) wrap it in a `<spell>` tag — `ensureTerminalPunctuation` handles trailing tags correctly.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: the agent goes silent (mute) but the live transcript keeps updating",
      body: [
        "**Cause:** STT and LLM are working (hence the transcript), but the TTS provider is rejecting each sentence. The pipeline's `playTask` catches a per-sentence synthesis error, logs it, calls `reportTtsFailure(...)`, and SKIPS the sentence so the call doesn't hang up — the result is a talking transcript with no audio.",
        "**Fix 1 (find it):** Open the Execution Log and look for `TTS` → `Provider Failed` rows and the operator toast: *\"Voice synthesis is failing (<provider>) — the call is continuing without audio.\"* The `errorMessage` names the real cause.",
        "**Fix 2 (Cartesia emotions):** If the error matches `invalid voice controls | invalid emotion | generation_config`, an `<emotion>` value is being rejected. The adapter already retries once WITHOUT controls (`isInvalidVoiceControlsError` in adapters/tts/cartesia.ts) — if it STILL mutes, the WS is marked `wsFailedPermanently` and even REST failed. Check the API key/quota.",
        "**Fix 3 (Sarvam auth/quota):** A `SarvamWsFatalError` (WS close code 4xxx) is auth/quota — it is NOT retried by design. Fix the `sarvam` API key/quota; a bad key produces exactly this 'mute agent, live transcript' pattern.",
        "**Fix 4 (wrong voice id):** A Cartesia UUID pasted into a Sarvam agent's **Voice** field is rejected by `resolveSpeaker` (falls back to default), but a truly invalid id on the real provider throws per sentence. Verify **Voice / Voice ID** matches the selected **TTS Provider**.",
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Symptom: a long, noticeable delay before the agent starts speaking (high TTFB)",
      body: [
        "**Cause A (cold connection):** The first synthesis pays the TCP+TLS+WS handshake. **Fix:** ensure `warmup()` is being called — the pipeline calls `this.tts.warmup?.()` right after `createTTSAdapter` (pipeline.ts). Cartesia and Sarvam pre-open their sockets there. If TTFB is high only on the FIRST sentence of the call, warmup isn't firing.",
        "**Cause B (waiting for a full sentence):** The agent waits too long before the first speakable clause. **Fix:** LOWER **Dashboard → Agents → Edit → Latency Tuning → TTS Early Dispatch Threshold (chars)** (`ttsMinSentenceChars`, default 18). Lower = the first comma-clause is spoken sooner (via `tryEarlyPhraseDispatch`), at the cost of choppier phrasing.",
        "**Cause C (measure it):** Read `firstByteMs` in the `TTS response` Execution Log row — that's the provider's real time-to-first-byte, recorded in `startSentenceSynthesis`. If `firstByteMs` itself is high, it's the provider/network, not our pipeline. Try a different `sonic-turbo` model or the nearer `CARTESIA_BASE_URL` region.",
        "**Cause D (Sarvam WS contention):** A ~1s first-byte spike on the SECOND sentence of a turn means N+1 prefetch is fighting over the warm WS. This is already handled — `wsInUse` routes the parallel sentence to the HTTP stream (sarvam.ts). If you see the spike, confirm that guard is intact.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Symptom: choppy, glitchy, or 'helicopter' (stuttering) audio",
      body: [
        "**Cause A (pacing broken):** 'Helicopter' stutter usually means audio isn't being delivered at real-time rate — the carrier's playout buffer underruns. **Fix:** verify the drift-compensated pacing loop in `drainSentenceJob` (pipeline.ts) is intact: `nextTick += 20` and `delay = Math.max(0, nextTick - Date.now())`. If someone replaced it with a flat `sleep(20)`, jitter accumulates and audio drifts below real-time → gaps.",
        "**Cause B (WAV header click):** A sharp click/crackle at the START of every sentence (not continuous) is a un-stripped WAV/RIFF header. **Fix:** confirm `stripRiffHeader` / `pcmFromSarvamAudio` runs on EVERY Sarvam path — REST, HTTP stream, and WebSocket. On the HTTP-stream path the header can span reads, so bytes must be buffered to ≥64 before stripping (`httpStreamOne`).",
        "**Cause C (byte misalignment):** Continuous crackle mid-sentence can be 16-bit PCM cut on an odd byte boundary. **Fix:** the streaming `flush()` in `startSentenceSynthesis` aligns to a 4-byte boundary and carries the remainder across chunks (`flushRemainder`). If a custom adapter emits odd-length chunks without alignment, `downsample16to8` drops trailing samples and clicks appear.",
        "**Cause D (wrong sample rate / MP3-as-PCM):** Fast, high-pitched, buzzy garbage means non-16kHz or compressed audio is being played as raw PCM. **Fix:** OpenAI must `downsample24to16`; ElevenLabs must use `output_format=pcm_16000` as a query param with NO `Accept: audio/mpeg`. See the other-adapters chapter.",
      ],
    },
    {
      kind: "concept",
      title: "The layer-isolation checklist",
      body: [
        "**Is it every provider or just one?** Every provider → the problem is in the pipeline path (`pipeline.ts`: split/prefetch/drain). One provider → the problem is in that adapter file or its dashboard config.",
        "**Is it every sentence or just the first / just the second?** First sentence only → warmup / cold connection. Second sentence of a turn → prefetch WS contention. Every sentence → protocol/format bug.",
        "**Is it a click (start of sentence), continuous crackle (mid-sentence), or a gap (between sentences)?** Click → WAV header. Continuous → byte alignment or wrong sample rate. Gap → pacing or prefetch not overlapping.",
        "**Is the transcript still updating while audio is dead?** Yes → TTS provider rejecting sentences; read `Provider Failed` in the Execution Log.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Every fix points back to a specific chapter and file. Click to jump to the deep dive.",
      nodes: [
        { id: "troub", label: "This playbook", sublabel: "symptom → fix", current: true },
        { id: "pipeline", label: "TTS pipeline path", sublabel: "split / prefetch / drain", chapterSlug: "tts-pipeline-path" },
        { id: "sarvam", label: "Sarvam adapter", sublabel: "flush, RIFF, WS", chapterSlug: "sarvam-tts-complete" },
        { id: "cartesia", label: "Cartesia adapter", sublabel: "emotion, context, retry", chapterSlug: "cartesia-tts-complete" },
        { id: "others", label: "Other adapters", sublabel: "format traps", chapterSlug: "other-tts-adapters" },
        { id: "dash", label: "Agent editor", sublabel: "Voice / Latency Tuning" },
      ],
      edges: [
        { from: "troub", to: "pipeline", label: "clipping, pacing, TTFB" },
        { from: "troub", to: "sarvam", label: "flush, RIFF, 4xxx" },
        { from: "troub", to: "cartesia", label: "mute agent, emotion" },
        { from: "troub", to: "others", label: "sample rate, output_format" },
        { from: "troub", to: "dash", label: "ttsSpeed, tail drain, language" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "The agent's live transcript keeps scrolling but the caller hears nothing. What is the single best first step?",
          choices: [
            "Raise Telephony Tail Drain.",
            "Open the Execution Log and look for TTS 'Provider Failed' rows (from reportTtsFailure) and the 'voice synthesis is failing' toast, which name the real cause.",
            "Lower ttsSpeed.",
            "Restart the call.",
          ],
          correctIndex: 1,
          explanation:
            "A talking transcript means STT/LLM work but TTS is rejecting sentences. playTask catches and skips them, logging Provider Failed. The Execution Log's errorMessage tells you if it's a Cartesia emotion 400, a Sarvam 4xxx auth/quota close, or a bad voice id.",
        },
        {
          prompt: "Which exact setting do you raise when the goodbye's final word is clipped, and why is it safe?",
          choices: [
            "TTS Early Dispatch Threshold — it speaks sooner.",
            "Telephony Tail Drain (ms) / telephonyTailDrainMs — it sends more silence frames to flush the carrier's jitter buffer, and it only runs at the END of a turn so it adds no mid-call latency.",
            "TTS Playback Speed — it slows the voice.",
            "STT Endpointing Silence.",
          ],
          correctIndex: 1,
          explanation:
            "drainPlaybackTail sends silence frames for telephonyTailDrainMs (default 400) to keep the carrier's playout buffer ticking. It runs only after the last sentence, so raising it to 600-800ms fixes clipping without affecting turn latency.",
        },
        {
          prompt: "A sharp click at the START of every Sarvam sentence (but audio is otherwise fine) points to what?",
          choices: [
            "Broken real-time pacing.",
            "An un-stripped WAV/RIFF header being played as PCM — confirm stripRiffHeader/pcmFromSarvamAudio runs on all three Sarvam paths (REST, HTTP stream, WebSocket).",
            "ttsSpeed clamped too low.",
            "A rejected emotion.",
          ],
          correctIndex: 1,
          explanation:
            "A per-sentence-start click is the classic WAV-header-as-PCM symptom. Every Sarvam path must strip the RIFF header; on the HTTP-stream path the header can span reads, so bytes are buffered to >=64 before stripping.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Final-word clipping → raise **Telephony Tail Drain (ms)** (`telephonyTailDrainMs`); it only runs at turn end, so it costs no mid-call latency; for Sarvam also verify the `flush` message.",
        "Robotic/rushed/slow → tune **TTS Playback Speed** (`ttsSpeed`, clamped per provider); check the **TTS Model**; on Cartesia confirm the turn-context path is used for smooth cross-sentence prosody.",
        "Wrong Indic/brand/number pronunciation → set **Language** (or auto-detect) so `ttsLanguage` is correct; toggle `sarvamIndicNumbers` (Sarvam `enable_preprocessing`); `₹` is stripped in `startSentenceSynthesis`; spell brand names in the prompt / use `<spell>`.",
        "Mute agent + live transcript → TTS is rejecting each sentence; read `Provider Failed` in the Execution Log — Cartesia emotion 400 (auto retry-without-controls), Sarvam 4xxx auth/quota (never retried), or a wrong voice id.",
        "High TTFB → confirm `warmup()` fires; lower **TTS Early Dispatch Threshold** (`ttsMinSentenceChars`); read `firstByteMs` in the log; a 2nd-sentence spike is WS prefetch contention (Sarvam routes it to HTTP stream).",
        "Choppy/helicopter audio → check the drift-compensated pacing loop in `drainSentenceJob`; a start-of-sentence click is a WAV header (RIFF stripping); mid-sentence crackle is byte misalignment or wrong sample rate (24kHz/MP3 played as 16kHz PCM).",
      ],
    },
  ],
};
