import type { Chapter } from "../types";

export const sttTroubleshooting: Chapter = {
  slug: "d1-stt-troubleshooting",
  moduleId: "d1",
  number: "17.5",
  title: "STT Troubleshooting & Tuning Playbook",
  summary:
    "Symptom → cause → the exact file, setting, or dashboard field to change. Misheard words, dropped 'yes', wrong language, Tanglish, silent agent, endpointing too fast or slow.",
  estMinutes: 22,
  fileRef: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
  prerequisites: [
    "d1-stt-pipeline-path",
    "d1-sarvam-stt-complete",
    "d1-azure-stt-complete",
    "d1-other-stt-adapters",
  ],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "How to use this playbook",
      paragraphs: [
        "When a call goes wrong at the ears of the agent, the fix is almost always **one setting in one place**. This chapter is a lookup table: find the symptom, read the cause, change the named thing. Each callout gives you the exact file constant, the `STTConfig` / `AgentConfig` field, or the dashboard label to touch.",
        "Two orientation facts first. (1) The agent's provider and language come from the dashboard's ASR settings, stored as `asrProvider`, `asrModel`, and the language that becomes `STTConfig.language`. (2) Turn-timing knobs live in the agent's **Latency Tuning** UI and map to `vadSilenceMs`, `endpointingSilenceMs`, and Sarvam's `speechEndFlushMs` / `incompleteHoldMs`.",
        "Always confirm the diagnosis in the **call execution log** (the STT rows) before changing anything — the adapters log warnings for most of these failures.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: The agent mishears words (wrong or garbled transcripts)",
      body: [
        "**Cause A — background noise.** In a noisy room the noise gate isn't filtering hard enough, so noise mixes into speech. Fix: set the agent's **Mic Sensitivity** to `low` on the dashboard. That maps to `micSensitivity: \"low\"` in `mic-sensitivity.ts`, raising `gateRatio` to 5.0 and `vadThreshold` to 110.",
        "**Cause B — a brand/product name is misheard.** Add the term to the agent's **key terms** list. It becomes `STTConfig.keyterms`: Deepgram sends it as `keywords`, Azure as a `phraseList`, AssemblyAI as `word_boost`.",
        "**Cause C — wrong model for the language.** Confirm `asrModel`. For Sarvam prefer `saaras:v3`; for Google the `telephony` model with `useEnhanced` is tuned for phone audio.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: Short one-word replies are dropped ('yes' / 'no' never registers)",
      body: [
        "**Cause A — the noise gate deleted it.** Very soft replies can be attenuated below what the vendor catches. Fix: set **Mic Sensitivity** to `high` (`micSensitivity: \"high\"` → `gateRatio: 2.5`, `vadThreshold: 60`). Never re-introduce hard-zeroing in `audio.ts` — `GATE_ATTENUATION = 0.15` exists precisely to keep soft words alive (call 2039).",
        "**Cause B (Sarvam) — the reply was held, not dropped.** If `yes` registers but *late*, the coalescer treated it as mid-thought. The word should be in `COMPLETE_SINGLE_WORDS` in `sarvam.ts`; if it's a language variant that's missing (e.g. a regional 'okay'), add it there so it takes the ~30 ms fast path instead of waiting `COALESCE_INCOMPLETE_MS`.",
        "**Cause C — the echo guard ate it.** `isSelfEcho` in `pipeline.ts` deliberately never discards single affirmations in `AFFIRMATIONS`. If a genuine short reply is being suppressed as echo, verify the word is covered there.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/audio.ts",
      language: "typescript",
      intro:
        "The exact constant behind dropped one-word replies. Do not raise GATE_ATTENUATION toward 0, and prefer Mic Sensitivity over editing this directly.",
      code: `// Below-threshold frames are ATTENUATED, not replaced with pure digital silence.
// Hard-zeroing erased short/soft utterances ("yes", "okay") entirely before they
// reached any STT provider — the provider-independent one-word-reply loss (call
// 2039). Attenuated frames keep enough residual signal for STT VADs to latch
// onto quiet speech onsets while still suppressing background noise.
const GATE_ATTENUATION    = 0.15;  // scale gated frames to 15% instead of zeroing
const GATE_HANGOVER_FRAMES = 5;    // 5 × 20 ms = 100 ms hangover`,
      lines: [
        {
          lines: "6",
          label: "GATE_ATTENUATION",
          explanation:
            "Quiet frames keep 15% of their signal. If soft replies still vanish, the lever to move is Mic Sensitivity (`high`), which lowers the `vadThreshold` so more frames count as speech in the first place.",
        },
        {
          lines: "7",
          label: "GATE_HANGOVER_FRAMES",
          explanation:
            "The 100 ms hangover protects word tails. Lowering it risks clipping the end of `yes`.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: Transcripts come back in the wrong language (Tamil agent transcribes in English)",
      body: [
        "**Cause A (Sarvam) — language fell back to en-IN.** Search the STT logs for `Sarvam STT: unsupported language for this model — falling back to en-IN` from `normaliseLang` in `sarvam.ts`. This fires when the language isn't valid for the model. Most common trigger: a **saaras:v3-only language** (Urdu, Nepali, Assamese…) selected while `asrModel` is `saarika:v2.5`. Fix: set `asrModel` to `saaras:v3`.",
        "**Cause B — the dashboard ASR Language is wrong.** Confirm the language that feeds `STTConfig.language`. For Sarvam it must resolve to a BCP-47 code like `ta-IN` (note Odia is `od-IN`, not `or-IN`).",
        "**Cause C (Azure) — a stray suffix.** If someone pasted `ta-IN-neural`, `normalizeLocale` in `azure.ts` trims it to `ta-IN` — but check the raw agent language field so it's clean at the source.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Symptom: Tanglish / Hinglish written in the wrong script ('business' shows up in Tamil letters)",
      body: [
        "**Cause — wrong Sarvam mode.** The mode controls the output script. `codemix` keeps English words in Latin script even inside an Indic sentence; `transcribe` writes clean native script. If English words are being rendered in Indic script on an English-primary call, the mode resolved to `transcribe`.",
        "**Fix:** the default rule in `resolveSarvamSttMode` (`sarvam-mode.ts`) is `en → codemix`, everything else `→ transcribe`. To override per agent, set an explicit `mode` in the Sarvam `extraConfig` — an explicit mode always wins. Use `codemix` for English-primary agents that expect surprise Hindi/Tamil mixing.",
        "The opposite symptom — a Tamil-primary call writing English phonetically ('Futures-ல' instead of ஃபீச்சர்ஸ்) — means you want `transcribe`, which is already the Indic default. Don't force `codemix` on an Indic-primary agent.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam-mode.ts",
      language: "typescript",
      intro:
        "The mode resolver. Explicit config wins; otherwise language decides.",
      code: `export function resolveSarvamSttMode(
  languageCode: string | null | undefined,
  explicitMode?: string | null,
): SarvamSttMode {
  if (explicitMode && VALID_MODES.has(explicitMode)) {
    return explicitMode as SarvamSttMode;
  }
  const lang = (languageCode ?? "en-IN").toLowerCase();
  return lang.startsWith("en") ? "codemix" : "transcribe";
}`,
      lines: [
        {
          lines: "5-7",
          label: "the override point",
          explanation:
            "Set `mode` in the Sarvam `extraConfig` JSON to pin the script behaviour regardless of language. This is the surgical fix for a specific agent that mixes languages unusually.",
        },
        {
          lines: "8-9",
          label: "the default rule",
          explanation:
            "English → `codemix`, everything else → `transcribe`. If Tanglish is going wrong and you haven't set an explicit mode, verify the agent's language actually starts with `en`.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Symptom: The agent doesn't hear the caller AT ALL (silent, stuck 'Listening…')",
      body: [
        "**Cause A — bad API key or wrong region.** This is the most common total failure. The streaming callback logs `Streaming STT permanently disconnected — falling back to batch STT. Check your API key and (for Azure) confirm the region matches your Speech resource.` For Azure specifically, a quick-close (<2 s) in the logs means auth/region — fix the key or set the correct `region` in `extraConfig`.",
        "**Cause B (Azure) — a stuck 'Listening…' with no transcripts.** A malformed locale (extra suffix) makes Azure accept the socket but never recognise. `normalizeLocale` guards this; confirm the agent language field isn't something like `en-IN-standard`.",
        "**Cause C (Sarvam) — a zombie socket.** If audio flows but nothing comes back, the heartbeat in `sarvam.ts` terminates the socket after 3 s of inbound silence (`WS_DEAD_MS`) to force a reconnect. Repeated zombie warnings point to a network path problem, not config.",
        "**Cause D — wrong provider name.** `createSTTAdapter` throws `No API key found for STT provider: <x>` if `asrProvider` doesn't match a configured key. Confirm the provider slug.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Symptom: Endpointing too FAST (agent interrupts, cuts callers off mid-sentence)",
      body: [
        "**Cause — the end-of-turn silence window is too short.** The agent finalises before the caller finishes a thought.",
        "**Azure fix:** raise `endpointingSilenceMs` (Latency Tuning UI). It maps to Azure's `segmentationSilenceTimeoutMs`. Try 400-600 ms for speakers who pause naturally. Clamped to [50, 5000].",
        "**Deepgram fix:** raise `endpointingSilenceMs` too — but remember the **2000 ms cap** in silence mode (`azure`/`deepgram` differ here). Above 2000 the Deepgram socket closes; the adapter clamps it, so effectively 2000 is your ceiling in silence mode. Use smart endpointing (`smartEndpointing` = `vapi`) for ML-based, more forgiving end detection.",
        "**Sarvam fix:** raise `incompleteHoldMs` (default 220, range 50-1000) so mid-thought fragments wait longer, and consider setting `highVadSensitivity` to `false` in `extraConfig` so Sarvam's own VAD waits ~1 s instead of ~64 ms before declaring end-of-speech.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Symptom: Endpointing too SLOW (long awkward pause before the agent replies)",
      body: [
        "**Cause — the end-of-turn window is too long**, or Sarvam is holding a complete reply as if incomplete.",
        "**Azure/Deepgram fix:** lower `endpointingSilenceMs` (e.g. 150-250 ms) for snappier turns. Too low risks splitting a sentence at a breath — balance it.",
        "**Sarvam fix:** lower `incompleteHoldMs`, and confirm `highVadSensitivity` is `true` (the default) so end-of-speech is detected quickly. `speechEndFlushMs` (default 30) is how fast a buffered transcript flushes once speech ends — keep it small.",
        "**Pipeline fix:** the batch-STT path uses `vadSilenceMs` (default 150 ms in `pipeline.ts`) as the silence window before flushing. Lower it for faster batch turns.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The Sarvam turn-timing knobs, all clamped. These are the exact levers behind 'too fast' / 'too slow'.",
      code: `    this.speechEndFlushMs = typeof extra.speechEndFlushMs === "number" && Number.isFinite(extra.speechEndFlushMs)
      ? Math.max(0, Math.min(200, Math.round(extra.speechEndFlushMs)))
      : 30;
    const envIncomplete = envInt("SARVAM_COALESCE_INCOMPLETE_MS", -1);
    this.incompleteHoldMs = envIncomplete >= 0
      ? Math.max(50, Math.min(1000, envIncomplete))
      : (typeof extra.incompleteHoldMs === "number" && Number.isFinite(extra.incompleteHoldMs)
        ? Math.max(50, Math.min(1000, Math.round(extra.incompleteHoldMs)))
        : 220);`,
      lines: [
        {
          lines: "1-3",
          label: "speechEndFlushMs (0-200, default 30)",
          explanation:
            "How fast a buffered transcript flushes once Sarvam signals speech_end. Small = snappy. Set via the Sarvam `extraConfig`.",
        },
        {
          lines: "4-9",
          label: "incompleteHoldMs (50-1000, default 220)",
          explanation:
            "How long an apparently-incomplete fragment waits for more words. The agent-UI value applies unless the deploy-wide env `SARVAM_COALESCE_INCOMPLETE_MS` overrides it. Raise it to stop cutting callers off; lower it to speed up replies.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Symptom: Good STT accuracy needed but latency matters less — or vice versa",
      body: [
        "**Need max accuracy, latency is fine:** pick a batch provider. Gemini (LLM-as-STT, precise, prompt-driven) or AssemblyAI (`best` model) via `asrProvider`. These have no live barge-in.",
        "**Need lowest latency and live barge-in:** pick a streaming provider — Sarvam (Indic), Azure, or Deepgram — so interim results and mid-turn interruption work.",
        "**Confidence too aggressive (valid speech dropped):** lower `confidenceThreshold`. Note Azure streaming already floors the effective threshold at 0.15 for Indic languages, but AssemblyAI uses a hard gate — a high threshold there returns empty strings on shaky-but-valid transcripts.",
      ],
    },
    {
      kind: "callout",
      variant: "why",
      title: "Why so many of these map to one number",
      body: [
        "Most STT complaints reduce to a trade-off between two failure modes: filtering too hard (drops soft/quiet speech) versus too soft (lets noise and echo through), and finalising too fast (cuts people off) versus too slow (awkward pauses).",
        "That's why Mic Sensitivity and the endpointing/coalescing milliseconds are the levers you'll reach for again and again. Change one thing, re-run the call, read the STT log rows, repeat.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "A Tamil agent's transcripts keep coming back in English. Where do you look first?",
          choices: [
            "The KeepAlive interval in deepgram.ts.",
            "The STT log for the normaliseLang 'falling back to en-IN' warning — likely a saaras-only language on saarika:v2.5; set asrModel to saaras:v3.",
            "The GATE_ATTENUATION constant.",
            "The X-RequestId header.",
          ],
          correctIndex: 1,
          explanation:
            "normaliseLang in sarvam.ts logs that exact warning when the language isn't valid for the model, then defaults to en-IN. The fix is usually switching asrModel to saaras:v3.",
        },
        {
          prompt: "The agent keeps cutting callers off mid-sentence on Azure. What do you change?",
          choices: [
            "Raise endpointingSilenceMs (→ Azure's segmentationSilenceTimeoutMs), e.g. to 400-600 ms.",
            "Lower the confidence threshold.",
            "Switch to Gemini.",
            "Disable the noise gate.",
          ],
          correctIndex: 0,
          explanation:
            "Cutting people off means the end-of-turn silence window is too short. Raising endpointingSilenceMs makes Azure wait longer after the last word before finalising.",
        },
        {
          prompt: "English words like 'business' are being written in Tamil letters on an English-primary Sarvam agent. The fix?",
          choices: [
            "Set Mic Sensitivity to low.",
            "Force Sarvam mode to `codemix` via extraConfig so English words stay in Latin script.",
            "Raise incompleteHoldMs.",
            "Switch to the saarika:v2.5 model.",
          ],
          correctIndex: 1,
          explanation:
            "codemix keeps English in Latin script even inside Indic sentences. An explicit mode in extraConfig always wins over the language-based default.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Misheard words → Mic Sensitivity `low`, add key terms (`keyterms`), or confirm `asrModel`.",
        "Dropped 'yes'/'no' → Mic Sensitivity `high`; never hard-zero in audio.ts; for Sarvam ensure the word is in COMPLETE_SINGLE_WORDS.",
        "Wrong language → check the `normaliseLang` fallback warning; set `asrModel` to saaras:v3 and confirm the dashboard ASR Language (Odia = od-IN).",
        "Tanglish in wrong script → set Sarvam `mode`: codemix (English-primary) vs transcribe (Indic-primary), overridable in extraConfig.",
        "Agent hears nothing → check API key / Azure region (quick-close logs); a stuck 'Listening…' is often a malformed Azure locale.",
        "Endpointing too fast → raise endpointingSilenceMs / incompleteHoldMs; too slow → lower them (and vadSilenceMs for batch). Deepgram silence mode caps at 2000 ms.",
      ],
    },
  ],
};
