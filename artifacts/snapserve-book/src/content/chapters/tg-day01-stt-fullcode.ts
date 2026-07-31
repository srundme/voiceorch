import type { Chapter } from "../types";

export const teachDay01SttFullCode: Chapter = {
  slug: "teach-day01-stt-fullcode",
  moduleId: "tg",
  number: "Day 1 · Code",
  title: "Day 01 — Sarvam STT: The Complete File, Line by Line",
  summary:
    "The entire Sarvam speech-to-text adapter — all 910 lines of sarvam.ts — shown in order with a plain-English explanation for every single line.",
  estMinutes: 120,
  fileRef: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "This page is the whole file",
      paragraphs: [
        "This is the **complete** Sarvam speech-to-text adapter — all 910 lines of `sarvam.ts`, shown in order with nothing skipped. The companion lesson-script page teaches the *ideas* (why we stream, what coalescing is, how endpointing works). This page is different: here you see **every single line** of the real file, in sequence, each one explained in plain English.",
        "Read it like a guided tour of a live phone call. When the caller speaks, their audio flows into this adapter; Sarvam sends words back; this file cleans, buffers, and times those words, then hands finished sentences to the pipeline. Every helper, every timer, and every hard-won comment below exists to make that one exchange fast and reliable.",
        "The code appears in short blocks of about 15–30 lines. Before each block, one sentence says what that section does for the call. After it, a line-by-line walkthrough covers the whole block. A few callout boxes flag the famous gotchas the comments were written to survive.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The file opens with a protocol cheat-sheet — the header comment that records how Sarvam's WebSocket really behaves on a live call.",
      code: `/**
 * Sarvam AI — Speech-to-Text
 *
 * Batch:     POST https://api.sarvam.ai/speech-to-text
 * Streaming: wss://api.sarvam.ai/speech-to-text/ws
 *
 * Official docs:
 *   https://docs.sarvam.ai/api-reference-docs/speech-to-text/apis/streaming
 *
 * ── WebSocket connection parameters (query string) ───────────────────────────
 *   model               "saaras:v3" (recommended) | "saarika:v2.5" (legacy)
 *   language_code       BCP-47, e.g. "ta-IN", "hi-IN", "en-IN"
 *   mode                "transcribe" | "codemix" | "verbatim" | "translit" | "translate"
 *                       (saaras:v3 only; translate = speech-to-English)
 *   sample_rate         16000 (default) | 8000
 *   input_audio_codec   "pcm_s16le" | "wav"
 *   high_vad_sensitivity true → silence boundary = 2 VAD frames (~64ms @16kHz, ~128ms @8kHz);
 *                        default (false) is 18-of-24 frames ≈ 1s+. Fine-tune params
 *                        (negative_frames_count etc.) can override — see Sarvam Fine VAD Tuning docs.
 *   vad_signals         true → emits START_SPEECH / END_SPEECH events
 *`,
      lines: [
        {
          lines: "1-9",
          label: "file banner + doc links",
          explanation:
            "A big comment block naming this file (**Sarvam AI Speech-to-Text**), the two endpoints — a one-shot **batch** URL and the live **streaming** `wss://` WebSocket — plus a link to the official docs. On a real call we use the streaming socket.",
        },
        {
          lines: "10-16",
          label: "WebSocket query params",
          explanation:
            "The connection settings ride in the URL: which `model`, the `language_code` (like `ta-IN`), the `mode`, the `sample_rate` (8000 for phone, 16000 for web), and `input_audio_codec`. These decide how Sarvam listens to the caller.",
        },
        {
          lines: "17-20",
          label: "VAD sensitivity + signals",
          explanation:
            "`high_vad_sensitivity` makes Sarvam decide the caller stopped talking much faster (2 frames instead of ~1 second). `vad_signals` asks Sarvam to send `START_SPEECH` / `END_SPEECH` events so we know when the caller begins and ends a phrase.",
        },
        {
          lines: "21",
          label: "blank spacer",
          explanation:
            "An empty comment line separating sections of the cheat-sheet.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The rest of the header records auth, the exact audio message shape, the reply shapes, and the close-code recovery plan.",
      code: ` * ── Auth ─────────────────────────────────────────────────────────────────────
 *   Header: api-subscription-key: <key>
 *
 * ── Audio message (JSON text, sent as each PCM chunk arrives) ────────────────
 *   { audio: { data: "<base64 raw PCM>", encoding: "audio/wav", sample_rate: 16000 } }
 *   NOTE: encoding enum MUST be "audio/wav" — "pcm_s16le" is rejected by Sarvam's
 *   Pydantic model even though the URL param \`input_audio_codec=pcm_s16le\` sets
 *   the actual codec. Confirmed via live WebSocket probe (June 2026).
 *
 * ── Server → client messages (JSON text) ─────────────────────────────────────
 *   { type: "events", data: { signal_type: "START_SPEECH" | "END_SPEECH" } }
 *   { type: "data",   data: { transcript: string } }
 *
 * ── Close codes ──────────────────────────────────────────────────────────────
 *   1000 Normal closure (intentional)
 *   1001 Going away        — reconnect
 *   1006 Abnormal (no close frame) — reconnect with backoff
 *   1011 Server error      — reconnect with backoff
 *   4xxx Auth / quota      — do NOT retry; fix first
 */
`,
      lines: [
        {
          lines: "1-3",
          label: "auth header",
          explanation:
            "Sarvam authenticates with an `api-subscription-key` header on the handshake — not a token in the URL, so the secret never lands in logs.",
        },
        {
          lines: "4-9",
          label: "the audio-message trap",
          explanation:
            "Each audio chunk is sent as JSON with the bytes **base64-encoded**. The gotcha: `encoding` must literally say `\"audio/wav\"` even though the real codec is raw PCM set by the URL param. Sending the 'correct' `\"pcm_s16le\"` here gets rejected — discovered by a live probe.",
        },
        {
          lines: "10-14",
          label: "server → client shapes",
          explanation:
            "What Sarvam sends back: `events` messages carry VAD signals (`START_SPEECH`/`END_SPEECH`); `data` messages carry the actual `transcript` text.",
        },
        {
          lines: "15-21",
          label: "close-code playbook",
          explanation:
            "The recovery policy per close code: `1000` is a clean intentional close; `1001`/`1006`/`1011` are transient so reconnect (with backoff); `4xxx` means auth/quota — do **NOT** retry, fix it first. The `*/` ends the banner.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Only two streaming models exist: saarika:v2.5 and saaras:v3",
      body: [
        "Sarvam's **streaming** WebSocket accepts exactly two model names: `saaras:v3` (recommended) and `saarika:v2.5` (legacy). That's it. A natural-looking value like `saaras:v2.5` was **never** a valid streaming model.",
        "The constructor (chunk further down) forces any unrecognised model to `saaras:v3`. Without that guard, a stale stored model name would make Sarvam reject the socket with a 400, which triggers a reconnect, which fails again — an endless loop that silently kills the call.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Now the real code begins: the imports (toolboxes this file borrows) and a tiny helper for reading numbers from environment variables.",
      code: `import { WebSocket } from "ws";
import { pcmToWav } from "../../audio.js";
import type { STTAdapter, SttFinalMetadata } from "./base.js";
import type { STTConfig, StreamSTT } from "../../types.js";
import { logger } from "../../../lib/logger.js";
import { resolveSarvamSttMode, type SarvamSttMode } from "./sarvam-mode.js";

export { resolveSarvamSttMode } from "./sarvam-mode.js";

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

const BATCH_URL = "https://api.sarvam.ai/speech-to-text";
const WS_BASE   = "wss://api.sarvam.ai/speech-to-text/ws";

/** Only saaras:v3 supports the \`mode\` parameter. */
const MODE_CAPABLE = new Set(["saaras:v3"]);
`,
      lines: [
        {
          lines: "1",
          label: "blank line",
          explanation:
            "A blank line after the banner comment.",
        },
        {
          lines: "2-7",
          label: "six imports",
          explanation:
            "The toolboxes: the `WebSocket` class, `pcmToWav` (wraps raw audio as a WAV file), the `STTAdapter`/metadata types, the shared config/handle types, the `logger`, and the mode-resolver helper. `.js` extensions are how compiled Node ES modules import each other.",
        },
        {
          lines: "8-9",
          label: "re-export the mode helper",
          explanation:
            "A blank line, then re-exporting `resolveSarvamSttMode` so other files can import it straight from here.",
        },
        {
          lines: "10-16",
          label: "envInt() helper",
          explanation:
            "Reads an environment variable and turns it into a whole number. If it is missing or not a number, it returns the supplied default `def`. Used later for a deploy-wide tuning override.",
        },
        {
          lines: "17-22",
          label: "endpoint constants",
          explanation:
            "A blank line, then the two fixed URLs: `BATCH_URL` for one-shot uploads and `WS_BASE` for the streaming socket a live call uses.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Two lookup tables and a cleanup helper that keep transcripts clean and languages valid before they reach the caller's conversation.",
      code: `/**
 * Strip leaked diarization/speaker labels (e.g. "Speaker 1:", "speaker:") from a
 * transcript line. Some Sarvam responses prefix utterances with a speaker tag that
 * would otherwise leak verbatim into the LLM context (call 548). Removes the label
 * at the start of the string or immediately after any newline, then trims.
 */
function stripDiarizationLabels(text: string): string {
  return text.replace(/(^|\\n)\\s*speaker\\s*\\d*\\s*:\\s*/gi, "$1").trim();
}

/** BCP-47 codes accepted by EVERY Sarvam STT model (saarika:v2.5's 11-language
 *  set: 10 Indian + English). Note: Odia uses od-IN, not or-IN. */
const CORE_LANG = new Set([
  "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN",
  "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
]);

/** Languages supported ONLY by saaras:v3 (the 23-language model — 22 Indian +
 *  English): Assamese, Bodo, Dogri, Konkani, Kashmiri, Maithili, Manipuri,
 *  Nepali, Sanskrit, Santali, Sindhi, Urdu. Previously these were rejected and
 *  silently fell back to en-IN even on saaras:v3. */
const SAARAS_EXTRA_LANG = new Set([
  "as-IN", "brx-IN", "doi-IN", "kok-IN", "ks-IN", "mai-IN",
  "mni-IN", "ne-IN", "sa-IN", "sat-IN", "sd-IN", "ur-IN",
]);
`,
      lines: [
        {
          lines: "1-3",
          label: "MODE_CAPABLE set",
          explanation:
            "Only the `saaras:v3` model understands the `mode` parameter. This set lets later code check that quickly. The legacy `saarika:v2.5` model ignores mode.",
        },
        {
          lines: "4-11",
          label: "stripDiarizationLabels()",
          explanation:
            "Some Sarvam replies accidentally prefix a line with a speaker tag like `Speaker 1:`. This function deletes that tag (at the start of the text or after a newline) so it never leaks into what the LLM reads. The comment cites the real call (548) where this bit them.",
        },
        {
          lines: "12-15",
          label: "CORE_LANG set",
          explanation:
            "The 11 languages **every** Sarvam model supports (10 Indian + English), as BCP-47 codes. Note the quirk: Odia is `od-IN`, not the usual `or-IN`.",
        },
        {
          lines: "16-26",
          label: "SAARAS_EXTRA_LANG set",
          explanation:
            "The 12 extra languages that **only** `saaras:v3` handles (Assamese, Urdu, Sanskrit, etc.). The comment records a past bug: these used to silently fall back to English even on the model that supports them.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "A translation table from short language codes to the exact codes Sarvam wants.",
      code: `/** ISO-639 bare codes → Sarvam BCP-47. */
const LANG_MAP: Record<string, string> = {
  bn: "bn-IN", en: "en-IN", gu: "gu-IN", hi: "hi-IN",
  kn: "kn-IN", ml: "ml-IN", mr: "mr-IN",
  or: "od-IN", od: "od-IN",             // Odia: BCP-47 is or-IN but Sarvam uses od-IN
  pa: "pa-IN", ta: "ta-IN", te: "te-IN",
  // saaras:v3-only languages
  as: "as-IN", brx: "brx-IN", doi: "doi-IN", kok: "kok-IN", ks: "ks-IN",
  mai: "mai-IN", mni: "mni-IN", ne: "ne-IN", sa: "sa-IN", sat: "sat-IN",
  sd: "sd-IN", ur: "ur-IN",
};`,
      lines: [
        {
          lines: "1-2",
          label: "LANG_MAP declaration",
          explanation:
            "Maps a bare ISO-639 code (like `ta`) to Sarvam's BCP-47 form (`ta-IN`). Callers often send the short form, so we normalise it.",
        },
        {
          lines: "3-5",
          label: "core language rows",
          explanation:
            "The straightforward mappings for the 11 core languages, plus the Odia special case: both `or` and `od` map to Sarvam's `od-IN`.",
        },
        {
          lines: "6-11",
          label: "saaras:v3-only rows",
          explanation:
            "The extra 12 languages (Assamese, Urdu, etc.) mapped to their `-IN` codes, only meaningful when the model is `saaras:v3`. The `}` closes the table.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The language-normalising function — the guard that stops a bad language code from silently muting the call.",
      code: `
function normaliseLang(code: string | null | undefined, model: string): string {
  if (!code) return "en-IN";
  // saaras models cover the full 23-language set; saarika only the 11-language core.
  const isValid = (c: string) =>
    CORE_LANG.has(c) || (model.startsWith("saaras") && SAARAS_EXTRA_LANG.has(c));
  const t = code.trim();
  if (isValid(t)) return t;
  const bare = t.split("-")[0]?.toLowerCase() ?? "";
  const mapped = LANG_MAP[bare];
  if (mapped && isValid(mapped)) return mapped;
  logger.warn({ rawLang: code, model }, "Sarvam STT: unsupported language for this model — falling back to en-IN");
  return "en-IN";
}

interface SarvamMsg {
  type: string;
  /** Sarvam attaches a request_id to responses — quoting it is the fastest path for support escalations. */
  request_id?: string;
  data?: { transcript?: string; signal_type?: string; message?: string; language_code?: string; request_id?: string };
}
`,
      lines: [
        {
          lines: "1-2",
          label: "normaliseLang() + empty guard",
          explanation:
            "Takes a raw code and the chosen model. If no code was given, it defaults to Indian English `en-IN`.",
        },
        {
          lines: "3-5",
          label: "isValid() inner check",
          explanation:
            "A little helper: a code is valid if it is in the core set, OR if the model is a saaras model and the code is in the saaras-extra set. This encodes the rule that saaras covers more languages.",
        },
        {
          lines: "6-9",
          label: "try the code as-is",
          explanation:
            "Trim whitespace; if the exact code is already valid, use it directly — no mapping needed.",
        },
        {
          lines: "10-12",
          label: "map the bare code",
          explanation:
            "Otherwise take the part before the dash (`ta` from `ta-IN`), lowercase it, look it up in `LANG_MAP`, and if the mapped result is valid, use that.",
        },
        {
          lines: "13-15",
          label: "fallback to en-IN",
          explanation:
            "If nothing valid was found, warn (with the raw code and model, for debugging) and fall back to `en-IN`. Better to run in English than to crash the call with an unsupported language.",
        },
        {
          lines: "16-22",
          label: "SarvamMsg interface",
          explanation:
            "A blank line, then the shape of a decoded server message: a `type`, an optional `request_id` (quote it for fast Sarvam support), and a `data` object that may hold the transcript, a VAD `signal_type`, an error message, the detected language, or a request id.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The adapter class begins, listing the settings each Sarvam connection remembers for the whole call.",
      code: `export class SarvamSTT implements STTAdapter {
  private readonly key: string;
  private readonly model: string;
  private readonly langCode: string;
  private readonly mode: SarvamSttMode;
  private readonly explicitMode: string | null;
  private readonly highVadSensitivity: boolean;
  private readonly speechEndFlushMs: number;
  private readonly incompleteHoldMs: number;
  private readonly cfg: STTConfig;
  /** Native sample rate to actually stream to Sarvam — 8000 for telephony, 16000 for webcall. */
  private readonly sampleRate: 8000 | 16000;

  constructor(
    apiKey: string,
    model: string | null,
    extraConfig: string | null,
    cfg: STTConfig,
  ) {
    this.key = apiKey;
    this.cfg = cfg;
    this.sampleRate = cfg.nativeSampleRate === 8000 ? 8000 : 16000;`,
      lines: [
        {
          lines: "1",
          label: "class declaration",
          explanation:
            "`SarvamSTT` promises to be an `STTAdapter`, so the pipeline can use it exactly like Deepgram or Azure — same interface, different vendor.",
        },
        {
          lines: "2-6",
          label: "identity + language fields",
          explanation:
            "Private read-only fields the call keeps: the API `key`, the chosen `model`, the resolved `langCode`, the transcription `mode`, and whatever `explicitMode` the agent config asked for.",
        },
        {
          lines: "7-9",
          label: "VAD + coalesce tuning fields",
          explanation:
            "`highVadSensitivity` controls how quickly Sarvam calls end-of-speech; `speechEndFlushMs` and `incompleteHoldMs` are timing knobs for how long we wait before committing a transcript.",
        },
        {
          lines: "10",
          label: "the STTConfig",
          explanation:
            "The full config object the pipeline handed in, kept for reference.",
        },
        {
          lines: "11-13",
          label: "native sample rate",
          explanation:
            "A comment then `sampleRate` — **8000** for a phone call, **16000** for a web call — which must match the audio the pipeline streams in. Then a blank spacer.",
        },
        {
          lines: "14-22",
          label: "constructor begins",
          explanation:
            "The `constructor` signature (API key, optional model, optional extra-config JSON, and the shared `STTConfig`), then it stores the key and config and picks 8000 vs 16000 based on whether the call is telephony.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The constructor runs once when the call sets up — it reads the config and figures out which model to use.",
      code: `
    const extra = extraConfig
      ? (JSON.parse(extraConfig) as {
          mode?: string;
          highVadSensitivity?: boolean;
          speechEndFlushMs?: number;
          incompleteHoldMs?: number;
        })
      : {};

    // Model: saaras:v3 (recommended) or saarika:v2.5 (legacy) — the ONLY two
    // models the streaming WS endpoint accepts (live-verified). "saaras:v2.5"
    // was never a valid streaming model; normalise it to saaras:v3 so a stale
    // stored value can't 400 the socket into a reconnect loop.
    const requested = (model ?? "").trim();
    this.model = ["saaras:v3", "saarika:v2.5"].includes(requested)
      ? requested
      : "saaras:v3";

    this.langCode = normaliseLang(cfg.language, this.model);
    this.explicitMode = extra.mode ?? null;

    // Mode: explicit agent config wins; else language-aware default (en-IN →
    // transcribe to avoid codemix writing English speech in Tamil script).
    this.mode = MODE_CAPABLE.has(this.model)
      ? resolveSarvamSttMode(this.langCode, this.explicitMode)
      : "transcribe";`,
      lines: [
        {
          lines: "1-6",
          label: "constructor signature",
          explanation:
            "Takes the API key, an optional model name, an optional JSON string of extra config, and the shared `STTConfig`. Then it stores the key and config and picks 8000 vs 16000 based on whether the call is telephony.",
        },
        {
          lines: "7-15",
          label: "parse extraConfig JSON",
          explanation:
            "The agent can pass tuning as a JSON string. If present, parse it into an object with optional `mode`, `highVadSensitivity`, `speechEndFlushMs`, and `incompleteHoldMs`. If absent, start from an empty object.",
        },
        {
          lines: "16-24",
          label: "model validation gotcha",
          explanation:
            "The **only** two models the streaming socket accepts are `saaras:v3` and `saarika:v2.5` (live-verified). Anything else — including the plausible-looking `saaras:v2.5` — is forced to `saaras:v3`, so a stale stored value can't 400 the socket into an endless reconnect loop.",
        },
        {
          lines: "25-27",
          label: "resolve language + explicit mode",
          explanation:
            "Normalise the caller's language for this model, and remember any explicitly requested `mode` (or `null`).",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "The audio message must say encoding: \"audio/wav\" — even though it's raw PCM",
      body: [
        "Every audio chunk goes to Sarvam as JSON with the bytes base64-encoded, and the `encoding` field must literally be the string `\"audio/wav\"`. The **actual** codec is raw 16-bit PCM, set separately by the `input_audio_codec=pcm_s16le` URL parameter.",
        "Sending the technically-correct `\"pcm_s16le\"` in the message body gets rejected by Sarvam's validator. This was confirmed by probing the live socket — a perfect example of an undocumented trap that a code comment saves the next developer from re-discovering.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Still in the constructor: choose the transcription mode and clamp the timing knobs into safe ranges.",
      code: `
    this.highVadSensitivity = typeof extra.highVadSensitivity === "boolean"
      ? extra.highVadSensitivity
      : true;
    this.speechEndFlushMs = typeof extra.speechEndFlushMs === "number" && Number.isFinite(extra.speechEndFlushMs)
      ? Math.max(0, Math.min(200, Math.round(extra.speechEndFlushMs)))
      : 30;
    // Prefer agent UI value; env SARVAM_COALESCE_INCOMPLETE_MS remains a deploy-wide override.
    const envIncomplete = envInt("SARVAM_COALESCE_INCOMPLETE_MS", -1);
    this.incompleteHoldMs = envIncomplete >= 0
      ? Math.max(50, Math.min(1000, envIncomplete))
      : (typeof extra.incompleteHoldMs === "number" && Number.isFinite(extra.incompleteHoldMs)
        ? Math.max(50, Math.min(1000, Math.round(extra.incompleteHoldMs)))
        : 220);

    logger.info(
      {
        langCode: this.langCode,
        mode: this.mode,
        model: this.model,
        explicitMode: this.explicitMode,
        highVadSensitivity: this.highVadSensitivity,
        speechEndFlushMs: this.speechEndFlushMs,
        incompleteHoldMs: this.incompleteHoldMs,
      },
      "Sarvam STT: mode resolved",
    );
  }
`,
      lines: [
        {
          lines: "1-6",
          label: "choose the mode",
          explanation:
            "Only `saaras:v3` supports modes. If it does, resolve the best mode from the language and any explicit request (e.g. English defaults to plain `transcribe` so English isn't written in Tamil script). Otherwise force `transcribe`.",
        },
        {
          lines: "7-9",
          label: "VAD sensitivity default",
          explanation:
            "Use the config's `highVadSensitivity` if it is a real boolean; otherwise default to `true` (faster end-of-speech detection).",
        },
        {
          lines: "10-12",
          label: "clamp speechEndFlushMs",
          explanation:
            "How long to wait after the caller stops before committing. Clamped between 0 and 200 ms (default 30). Keeps a bad config value from stalling replies.",
        },
        {
          lines: "13-19",
          label: "resolve incompleteHoldMs",
          explanation:
            "The pause we allow mid-thought. A deploy-wide env override wins if set (clamped 50–1000); otherwise the agent's UI value (clamped 50–1000); otherwise default 220 ms. This is the knob that lets a caller finish a sentence before we answer.",
        },
        {
          lines: "20-29",
          label: "log resolved settings",
          explanation:
            "A blank line, then log everything resolved — language, mode, model, sensitivity, and timing — so an engineer can see exactly how this call was configured.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The batch (non-streaming) path — a one-shot HTTP upload used off the live call, e.g. for recordings.",
      code: `  // ── Batch REST ──────────────────────────────────────────────────────────────

  async transcribe(audioBuffer: Buffer, sampleRate = this.sampleRate): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const formData = new FormData();
    // Copy into a plain ArrayBuffer to avoid SharedArrayBuffer incompatibility with Blob.
    const wavBuf = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
    formData.append("file", new Blob([wavBuf], { type: "audio/wav" }), "audio.wav");
    formData.append("model", this.model === "saaras:v3" ? "saaras:v3" : "saarika:v2.5");
    formData.append("language_code", this.langCode);
    if (MODE_CAPABLE.has(this.model)) {
      formData.append("mode", this.mode);
    }

    const resp = await fetch(BATCH_URL, {
      method: "POST",
      headers: { "api-subscription-key": this.key },
      body: formData,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(\`Sarvam STT batch error \${resp.status}: \${err}\`);
    }

    const json = (await resp.json()) as { transcript?: string };
    return stripDiarizationLabels(json.transcript ?? "");
  }
`,
      lines: [
        {
          lines: "1-5",
          label: "transcribe() + WAV wrap",
          explanation:
            "A comment header and the `transcribe` method: it takes a raw PCM buffer and wraps it as a real WAV file with `pcmToWav`. WAV carries the sample-rate header Sarvam's batch endpoint expects.",
        },
        {
          lines: "6-11",
          label: "build the multipart form",
          explanation:
            "Batch uses a file upload. It copies the bytes into a plain `ArrayBuffer` (avoiding a `SharedArrayBuffer`/`Blob` incompatibility), attaches the WAV file, the model, and the language, and adds `mode` only when the model supports it.",
        },
        {
          lines: "12-21",
          label: "POST to the batch URL",
          explanation:
            "Close the mode branch, then send the form to `BATCH_URL` with the auth header. This is a normal request-and-wait HTTP call — fine for a recording, far too slow for a live phone turn.",
        },
        {
          lines: "22-26",
          label: "handle a bad response",
          explanation:
            "If the HTTP status is bad, read the error text and throw a descriptive error. The `}` closes the guard.",
        },
        {
          lines: "27-30",
          label: "parse, clean, return",
          explanation:
            "Parse the JSON, pull out `transcript`, run it through `stripDiarizationLabels`, and return the clean text. The `}` ends the method, then a blank spacer.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The streaming method starts here — this is the one a live call actually uses. First it copies class fields into local variables.",
      code: `  // ── Streaming WebSocket ─────────────────────────────────────────────────────

  transcribeStream(
    onTranscript: (
      text: string,
      isFinal: boolean,
      detectedLanguage?: string,
      metadata?: SttFinalMetadata,
    ) => void,
    onClose?: () => void,
  ): StreamSTT {
    // Capture class fields as locals so closures (plain object methods, nested
    // functions) can reference them without relying on \`this\` binding.
    // langCode is MUTABLE: setLanguage() live-switches it mid-call (explicit
    // caller language request) and reconnects the socket with the new hint.
    let   langCode   = this.langCode;
    let   mode       = this.mode;
    const explicitMode = this.explicitMode;
    const model      = this.model;
    const key        = this.key;
    const sampleRate = this.sampleRate;`,
      lines: [
        {
          lines: "1-11",
          label: "transcribeStream() signature",
          explanation:
            "A comment header, then the streaming entry point. It receives `onTranscript` (called with text, an `isFinal` flag, an optional detected language, and metadata) and an optional `onClose`. It returns a `StreamSTT` handle the pipeline pushes audio into.",
        },
        {
          lines: "12-19",
          label: "capture fields as locals",
          explanation:
            "A comment, then the class fields are copied into local variables so the many nested closures below don't depend on `this`. Crucially `langCode` and `mode` are `let` (mutable) because `setLanguage()` can switch the caller's language mid-call and reconnect.",
        },
        {
          lines: "20-21",
          label: "key + sampleRate locals",
          explanation:
            "The last two captured locals: the API `key` and the `sampleRate`, ready for the socket builder and the audio sender.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "buildWsUrl() assembles the streaming URL from the current settings — rebuilt on every connect so a mid-call language switch takes effect.",
      code: `
    // Built per-connection (inside openSocket) so a reconnect after a live
    // language switch picks up the current langCode.
    const buildWsUrl = (): string => {
      const params = new URLSearchParams({
        model:              model,
        language_code:      langCode,
        sample_rate:        String(sampleRate),
        input_audio_codec:  "pcm_s16le",
        high_vad_sensitivity: this.highVadSensitivity ? "true" : "false",
        vad_signals:        "true",    // emit speech_start / speech_end events
        flush_signal:       "true",    // allow manual buffer flush via flush() call
      });
      if (MODE_CAPABLE.has(model)) {
        params.set("mode", mode);
      }
      return \`\${WS_BASE}?\${params.toString()}\`;
    };
`,
      lines: [
        {
          lines: "1-4",
          label: "buildWsUrl starts",
          explanation:
            "A blank line and comment noting it's built per-connection so a reconnect after a language switch uses the current `langCode`, then the arrow function begins.",
        },
        {
          lines: "5-13",
          label: "assemble query params",
          explanation:
            "Pack the model, current `language_code`, sample rate, and codec `pcm_s16le` into the query string. `high_vad_sensitivity` comes from config; `vad_signals: true` asks for speech-start/end events; `flush_signal: true` allows a manual flush.",
        },
        {
          lines: "14-19",
          label: "add mode + return URL",
          explanation:
            "Add `mode` only for a mode-capable model, then return `WS_BASE` plus the query string. The `};` closes `buildWsUrl`, then a blank spacer.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "More per-connection state: the reconnect cap, the pre-connect audio queue, and speech/latency trackers.",
      code: `    let ws: WebSocket;
    let wsReady = false;
    let intentionallyClosed = false;
    let switchingLanguage = false; // set by setLanguage(); close handler reopens immediately, no backoff
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const MAX_RECONNECT = 10;

    const audioQueue: Buffer[] = [];
    const MAX_QUEUE_BYTES = 64_000; // ~2 s @ 16 kHz s16le — drop oldest chunks beyond this
    let queueTrimLogged   = false;  // throttle: log queue trim at most once per reconnect episode
    let speechEndAt       = 0;     // timestamp of last END_SPEECH event for latency tracking
    let speechEndReceived = false; // true once speech_end fires; reset on speech_start
    let lastRequestId: string | undefined; // latest request_id seen — attached to transcript/error logs for Sarvam support

    // Closure variables for the onSpeechStart / onSpeechEnd callbacks. Declared here
    // (before openSocket) so the WS message handler — an async callback inside openSocket —
    // can reference them safely. Exposed on sttObj via Object.defineProperty getter/setter below.
    let _onSpeechStart: (() => void) | null = null;
    let _onSpeechEnd:   (() => void) | null = null;
`,
      lines: [
        {
          lines: "1-2",
          label: "MAX_RECONNECT + spacer",
          explanation:
            "Give up after 10 reconnect attempts, then a blank line.",
        },
        {
          lines: "3-6",
          label: "the audio queue",
          explanation:
            "Audio that arrives before the socket is open waits in `audioQueue`, capped at `MAX_QUEUE_BYTES` (~2 s). `queueTrimLogged` throttles the 'dropped stale audio' log to once per reconnect episode.",
        },
        {
          lines: "7-9",
          label: "speech-end + request-id trackers",
          explanation:
            "`speechEndAt` timestamps the last END_SPEECH (for latency math); `speechEndReceived` flips true when the caller stops; `lastRequestId` keeps Sarvam's latest id for support/debug logs.",
        },
        {
          lines: "10-15",
          label: "speech-callback closures",
          explanation:
            "A blank line and comment, then `_onSpeechStart` / `_onSpeechEnd` holders. They are declared here (before `openSocket`) so the message handler can see them, and are exposed later via getters/setters.",
        },
        {
          lines: "16-21",
          label: "start of coalescing comment",
          explanation:
            "A blank line and the opening of the big comment explaining adaptive transcript coalescing — the self-tuning pause window described next.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The coalescing constants — the timing that lets the caller finish a thought before we answer, tuned to their own pace.",
      code: `    // ── Adaptive transcript coalescing ───────────────────────────────────────
    // The hold window self-calibrates to this caller's mid-sentence pause rhythm:
    //   fast speaker → 120 ms · medium → 220 ms · slow / older caller → 350 ms
    // Seeded at COALESCE_DEFAULT_MS until at least 2 real pauses are observed;
    // converges within 2–3 turns of natural speech.
    const COALESCE_MIN_MS        = 120;
    const COALESCE_DEFAULT_MS    = 220;
    const COALESCE_MAX_MS        = 500;  // raised from 350 — covers ~400ms thinking pauses
    // Incomplete mid-thought hold — Latency Tuning UI (default 220). Env
    // SARVAM_COALESCE_INCOMPLETE_MS overrides when set.
    const COALESCE_INCOMPLETE_MS = this.incompleteHoldMs;
    const SPEECH_END_FLUSH_MS    = this.speechEndFlushMs;
    const PAUSE_HISTORY_MAX      = 5;
    const pauseHistory: number[] = [];
    let transcriptArrivedAt    = 0;   // wall-clock ms when last transcript buffered
    let coalesceMergedSegments = 0;   // # of Sarvam segments folded into current buf

    function adaptiveHoldMs(): number {
      if (pauseHistory.length < 2) return COALESCE_DEFAULT_MS;
      const avg = pauseHistory.reduce((a, b) => a + b, 0) / pauseHistory.length;
      if (avg < 150) return COALESCE_MIN_MS;
      if (avg < 400) return COALESCE_DEFAULT_MS;
      return COALESCE_MAX_MS;
    }
`,
      lines: [
        {
          lines: "1-8",
          label: "coalesce window bounds",
          explanation:
            "The hold window self-calibrates to this caller's pause rhythm: a fast speaker gets ~120 ms, medium ~220 ms, slow/older ~350–500 ms. `COALESCE_MIN_MS`, `COALESCE_DEFAULT_MS`, and `COALESCE_MAX_MS` (raised to 500 to survive ~400 ms thinking pauses) bracket it.",
        },
        {
          lines: "9-13",
          label: "incomplete + flush knobs",
          explanation:
            "`COALESCE_INCOMPLETE_MS` is the mid-thought hold (from the UI/env resolved earlier). `SPEECH_END_FLUSH_MS` is the fast flush once the caller clearly stops.",
        },
        {
          lines: "14-16",
          label: "pause history buffer",
          explanation:
            "Keep up to 5 recent pause lengths in `pauseHistory`; the average drives the adaptive window.",
        },
        {
          lines: "17-19",
          label: "coalesce trackers",
          explanation:
            "A blank line, then `transcriptArrivedAt` (when the current buffer started holding) and `coalesceMergedSegments` (how many Sarvam fragments were folded together).",
        },
        {
          lines: "20-25",
          label: "adaptiveHoldMs()",
          explanation:
            "Computes the current hold: with fewer than 2 pauses observed use the default; otherwise average the history and return min/default/max depending on how fast this caller pauses. This is the self-calibration in action.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "A dictionary of short words that are COMPLETE answers on their own, so 'yes' or 'சரி' dispatches instantly instead of waiting.",
      code: `    /**
     * Common single-word utterances that are COMPLETE responses — acknowledgements,
     * affirmatives, negatives, greetings — in English, Tamil, and Hindi. These bypass
     * the COALESCE_INCOMPLETE_MS hold so "yes" / "ஆம்" / "हाँ" dispatches in ~30 ms
     * (the normal speech_end fast-path) instead of waiting 800+ ms for "more words".
     */
    const COMPLETE_SINGLE_WORDS = new Set([
      // English — affirmatives / negatives / acknowledgements / greetings
      "yes", "no", "ok", "okay", "sure", "fine", "right", "correct", "wrong",
      "good", "great", "perfect", "excellent", "absolutely", "definitely",
      "yeah", "yep", "yup", "nope", "nah", "alright",
      "hello", "hi", "hey", "bye", "goodbye", "thanks", "thank", "thankyou",
      "done", "stop", "cancel", "confirm", "proceed", "continue", "next",
      "back", "send", "wait", "hold", "go", "start", "begin", "end",
      "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
      "first", "second", "third", "morning", "evening", "afternoon", "now", "later",
      "help", "please", "understood", "noted", "agree", "disagree",
      // Tamil — affirmatives / negatives / acknowledgements / greetings`,
      lines: [
        {
          lines: "1-6",
          label: "why this set exists",
          explanation:
            "A comment explaining that common one-word replies (acknowledgements, yes/no, greetings) should bypass the mid-thought hold and be emitted in ~30 ms — a caller saying 'yes' shouldn't wait 800 ms for imaginary 'more words'.",
        },
        {
          lines: "7-14",
          label: "English complete words",
          explanation:
            "The English one-word answers: affirmatives, negatives, numbers, greetings, commands like 'stop'/'confirm', ordinals, and politeness words.",
        },
        {
          lines: "15-18",
          label: "start of Tamil words",
          explanation:
            "A comment and the first Tamil affirmatives/negatives/greetings (ஆம், இல்லை, சரி, ஹலோ, நன்றி …) that also count as complete single-word turns.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The dictionary continues with the rest of the Tamil, Hindi, and other Indic one-word answers, then closes.",
      code: `      "ஆம்", "இல்ல", "இல்லை", "சரி", "ஓகே", "ஹலோ", "ஹலொ",
      "நன்றி", "சரிங்க", "ஆமாம்", "இல்லங்க", "ஓகேங்க", "சரிங்கள",
      "புரிஞ்சது", "தெரியும்", "தெரியல", "வேண்டாம்", "வேணும்",
      "கொஞ்சம்", "நல்லது", "ஆகும்", "ஆகாது",
      // Hindi — affirmatives / negatives / acknowledgements / greetings
      "हाँ", "हां", "नहीं", "ना", "ठीक", "ओके", "हेलो", "हाँजी", "हांजी",
      "जी", "जी।", "जी,", "धन्यवाद", "शुक्रिया", "बताओ", "आगे",
      "समझा", "समझी", "पता", "नहीं।", "बिल्कुल", "ज़रूर", "ज़रूरी",
      // Telugu, Kannada, Malayalam common acks
      "అవును", "కాదు", "సరే", "ఓకే", "హలో",
      "ಹೌದು", "ಇಲ್ಲ", "ಸರಿ", "ಓಕೆ", "ಹಲೋ",
      "അതെ", "ഇല്ല", "ശരി", "ഓകെ", "ഹലോ",
    ]);
`,
      lines: [
        {
          lines: "1-4",
          label: "remaining Tamil words",
          explanation:
            "More complete Tamil single words (புரிஞ்சது, தெரியும், வேண்டாம், நல்லது …).",
        },
        {
          lines: "5-9",
          label: "Hindi words",
          explanation:
            "A comment, then Hindi affirmatives/negatives/greetings (हाँ, नहीं, ठीक, धन्यवाद, बिल्कुल …), including forms with punctuation like जी।",
        },
        {
          lines: "10-14",
          label: "Telugu/Kannada/Malayalam + close",
          explanation:
            "A comment and common acks in three more languages (అవును, ಹೌದು, അതെ …). The `]);` closes the set.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The opposite dictionary — single words that mean the caller was cut off mid-thought and needs more time.",
      code: `    /** Single-word dangling connectors that genuinely indicate the caller was cut off mid-thought. */
    const DANGLING_SINGLE_CONNECTORS = new Set([
      "and", "or", "but", "because", "although", "though", "with", "for", "from", "into", "through", "of", "to",
      " ke", " ki", " ka", " ko", " mein", " pe", " par", " se", " ne", " aur", " lekin", " jo", " kyunki", " jab",
      "ஆனால்", "அல்லது", "ஏனெனில்", "மற்றும்", "எனவே", "அப்புறம்", "இருந்தாலும்", "சொல்லி", "பண்ணி", "வந்து",
    ]);

    /**
     * Returns true when the transcript looks like a mid-sentence fragment that the
     * caller is still formulating. Triggers COALESCE_INCOMPLETE_MS hold instead of
     * the adaptive window so the caller can finish their thought.
     *
     * Patterns detected (Tamil-aware + generic):
     *   • Single dangling connector (e.g. "and", "but", "ஆனா") — incomplete
     *   • Single content word (name, number, noun, answer)      — COMPLETE (emits immediately)
     *   • Ends with Tamil possessive suffix    — உங்களோட, என்னோட, அதோட, …
     *   • Ends with Tamil case markers         — -ஐ, -க்கு, -கிட்ட, -ல, -னால, …
     *   • Ends with common connective words    — "and", "or", "but", "also", "with"
     *   • All-caps abbreviation (e.g. "DTDC") — likely partial proper noun phrase
     */`,
      lines: [
        {
          lines: "1-5",
          label: "DANGLING connectors set",
          explanation:
            "A comment, then words that dangle: English joiners ('and', 'because', 'with', 'to' …) and Hindi/Hinglish particles (' ke', ' ki', ' aur', ' lekin' …) — note the leading spaces so they match as suffixes. If a turn ends here, the caller isn't done.",
        },
        {
          lines: "6-6",
          label: "Tamil connectors",
          explanation:
            "Tamil dangling connectors (ஆனால், அல்லது, மற்றும், வந்து …) that also signal 'more is coming'. The `]);` closes the set.",
        },
        {
          lines: "7-20",
          label: "looksIncomplete doc-comment",
          explanation:
            "A long comment describing the next function: it returns true when a transcript looks like an unfinished fragment (dangling connector, Tamil possessive/case suffix, connective word, all-caps abbreviation), so we hold for the caller to finish rather than answering early.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "looksIncomplete() begins — the heart of fragment detection. First the single-word rules and Tamil suffix checks.",
      code: `    function looksIncomplete(text: string): boolean {
      const t = text.trim();
      const words = t.split(/\\s+/);
      if (words.length === 0) return false;
      // Single word: only return true if it is a known dangling connector ("and", "but", "ஆனா" etc.)
      // All other single words (names, numbers, nouns, greetings, yes/no) emit IMMEDIATELY.
      if (words.length === 1) {
        const w = words[0].toLowerCase().replace(/[।,!?.]+$/, "");
        return DANGLING_SINGLE_CONNECTORS.has(w) || DANGLING_SINGLE_CONNECTORS.has(words[0]);
      }
      const last = words[words.length - 1];
      // Tamil possessive / genitive suffixes → more to come
      if (/[ஓோ]ட$|உடைய$|களோட$/.test(last)) return true;
      // Tamil dative, locative, instrumental markers
      if (/க்கு$|கிட்ட$|கிட்டே$|னால$|னாலே$|ஐ$/.test(last)) return true;
      // Tamil conjunctive participial (connector) forms — ALWAYS signal more is coming:
      //   -ந்து  : வந்து (having come), போந்து, கொண்டு (with)
      //   -ட்டு  : போட்டு (having placed), விட்டு (having let), ஆட்டு…
      //   -ணி/-ல்லி/-ண்ணி : சொல்லி (having said), பண்ணி (having done)
      //   -ய்    : போய் (having gone), வாய்
      //   -ட்டு also covers viṭṭu (விட்டு) and poṭṭu (போட்டு) naturally
      if (/ந்து$|ட்டு$|ண்ணி$|ல்லி$|ணி$|னி$/.test(last)) return true;
      if (/ய்$/.test(last) && last.length > 2) return true; // போய், வாய் — skip 2-char words like "ஒய்"
      // Tamil relative-participial / adverbial forms
      if (/ன்ற$|கிற$|வந்த$|போன$/.test(last)) return true;`,
      lines: [
        {
          lines: "1-4",
          label: "split into words",
          explanation:
            "Trim the text and split on whitespace into `words`. If there are none, it isn't incomplete.",
        },
        {
          lines: "5-10",
          label: "single-word rule",
          explanation:
            "For a lone word, strip trailing punctuation and check the dangling-connectors set. Only a known connector counts as incomplete — every other single word (a name, number, or 'yes') is treated as a complete answer and emitted immediately.",
        },
        {
          lines: "11-13",
          label: "Tamil possessive suffixes",
          explanation:
            "Look at the last word: Tamil genitive/possessive endings (…ஓட, …உடைய, …களோட) mean 'more to come', so return true.",
        },
        {
          lines: "14-19",
          label: "Tamil case + conjunctive endings",
          explanation:
            "Dative/locative/instrumental markers (…க்கு, …கிட்ட, …னால, …ஐ) and conjunctive participle forms (…ந்து, …ட்டு, …ல்லி) all signal the sentence continues. The comment lists real examples like வந்து (having come).",
        },
        {
          lines: "20-22",
          label: "…ய் endings",
          explanation:
            "Words ending in …ய் that are longer than two characters (போய், வாய்) are conjunctive too — but 2-char words like ஒய் are skipped to avoid false hits.",
        },
        {
          lines: "23-25",
          label: "relative-participial forms",
          explanation:
            "Tamil relative/adverbial endings (…ன்ற, …கிற, …வந்த, …போன) also mean more is coming.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "looksIncomplete() — letting the caller finish their thought",
      body: [
        "A caller often speaks in bursts: \"I want to book…\" *(pause)* \"…a slot for tomorrow.\" If we answered after the first burst, the reply would be garbage. `looksIncomplete()` reads the buffered text and asks: does this look like an unfinished fragment?",
        "It knows Tamil possessive and case suffixes, conjunctive verb forms, Hindi case markers, dangling English connectives, transitive verbs that need an object, all-caps abbreviations, and question words in several languages. If any pattern fires, the adapter holds a little longer (the `COALESCE_INCOMPLETE_MS` window) so the caller can finish.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Still inside looksIncomplete(): the special two-word Tamil rule that detects a missing predicate.",
      code: `      // 2-word utterance where the FIRST word ends with a case marker AND the second
      // word is NOT a complete verb form → predicate is missing.
      // "எனக்கு வந்து" → incomplete ✓
      // "நாளைக்கு வருவேன்" → complete (second=verb) — should NOT fire
      if (words.length === 2) {
        const first = words[0];
        const second = words[1];
        // Tamil finite verb endings that make a 2-word sentence self-contained:
        //   -வேன்/-ேன் (1ps past/future), -லாம் (hortative), -ல்ல/-ல்லை (negative),
        //   -ஆம்/-ஆகும் (equative), -ார்/-ார்கள் (3p), -கும்/-கிறது (neuter/future)
        const secondIsFiniteVerb = /ேன்$|வேன்$|ோம்$|லாம்$|ல்ல$|ல்லை$|ஆம்$|ார்$|ார்கள்$|கும்$|கிறது$|றேன்$|கிறேன்$/.test(second);
        if (!secondIsFiniteVerb && /க்கு$|கிட்ட$|கிட்டே$|ஐ$|னால$|ஆல$/.test(first)) return true;
      }
      // Also check if FIRST word (not just last) is a connector/incomplete form.
      // e.g. "போய் சொல்லு" — "போய்" is conjunctive and signals more context.
      const first = words[0];
      if (/ந்து$|ட்டு$|ண்ணி$|ல்லி$/.test(first)) return true;
      if (/ய்$/.test(first) && first.length > 2) return true;
      // Hindi/Hinglish possessives & case markers
      if (/\\bका$|\\bकी$|\\bके$|\\bको$|\\bसे$|\\bमें$|\\bने$|\\bपर$/u.test(last)) return true;
      // Generic English connectives that signal more is coming
      if (/^(and|or|but|also|with|for|of|to|the|a|an|in|on|at)$/i.test(last)) return true;`,
      lines: [
        {
          lines: "1-6",
          label: "two-word setup",
          explanation:
            "A comment with examples, then: only for a 2-word utterance, grab the first and second words. The idea — 'எனக்கு வந்து' is incomplete, but 'நாளைக்கு வருவேன்' is complete because the second word is a real verb.",
        },
        {
          lines: "7-11",
          label: "is the second word a finite verb?",
          explanation:
            "A comment listing Tamil finite-verb endings, then a regex `secondIsFiniteVerb` testing for them (…வேன், …லாம், …ல்லை, …ஆம், …கிறது …). A finite verb makes the pair self-contained.",
        },
        {
          lines: "12-13",
          label: "first-word case + no verb → incomplete",
          explanation:
            "If the second word is NOT a finite verb but the first word carries a case marker (…க்கு, …கிட்ட, …ஐ, …னால), the predicate is missing — return true. The `}` closes the 2-word block.",
        },
        {
          lines: "14-19",
          label: "first-word connector checks",
          explanation:
            "A comment and code that also inspect the FIRST word: conjunctive endings (…ந்து, …ட்டு, …ல்லி) or a long …ய் ending mean the caller is still adding context (e.g. 'போய் சொல்லு').",
        },
        {
          lines: "20-22",
          label: "Hindi possessives / case markers",
          explanation:
            "If the last word is a Hindi case marker (का, की, के, को, से, में, ने, पर), more is coming — return true. The `\\u` flag makes the Unicode word boundaries work.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The generic English rules — connectives and 'needs-an-object' verbs that mean the caller isn't finished.",
      code: `      // English transitive / mental-state verbs that virtually always need a
      // following object or complement. A bare utterance ending in one of these
      // (no terminal punctuation, no object yet) means the caller is still
      // mid-thought — e.g. "I want" → "I want to know the pricing…". Confirmed
      // from call-1659: "I want" was flushed as a complete turn and produced a
      // garbled follow-on ("I want a No good. worth pricing"). Skip this check
      // when the text already ends with terminal punctuation — STT smart_format
      // already judged it complete.
      if (!/[.?!]$/.test(t)) {
        const NEEDS_OBJECT_VERBS = new Set([
          "want", "need", "like", "love", "hate", "have", "get", "know",
          "think", "mean", "see", "hear", "feel", "believe", "wish", "hope",
          "prefer", "use", "try", "check", "understand", "remember", "ask",
          "tell", "show", "give", "take", "make", "do", "call", "book",
          "send", "discuss", "explain", "mention", "consider", "suggest",
          "recommend",
        ]);
        if (NEEDS_OBJECT_VERBS.has(last.toLowerCase())) return true;
      }`,
      lines: [
        {
          lines: "1-2",
          label: "English connectives",
          explanation:
            "If the last word is a bare connective or article ('and', 'or', 'but', 'with', 'the', 'a' …), it dangles — return true.",
        },
        {
          lines: "3-11",
          label: "needs-object verbs setup",
          explanation:
            "A long comment (citing the real garbled call-1659 'I want') explaining why: a bare utterance ending in a transitive/mental verb usually needs an object next. But we skip this whole check if the text already ends in terminal punctuation, because the STT's smart-format already judged it complete.",
        },
        {
          lines: "12-19",
          label: "the verb set",
          explanation:
            "The set of verbs that almost always need something after them ('want', 'need', 'know', 'tell', 'book', 'send' …). If the last word is one of these (and there was no ending punctuation), the caller is mid-thought — return true.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The final looksIncomplete() checks — abbreviations and question words — then the function returns.",
      code: `      // All-caps token ≥ 2 chars (e.g. "DTDC", "KYC") — check both first and last word
      if (/^[A-Z]{2,}$/.test(last) || /^[A-Z]{2,}$/.test(first)) return true;
      // Tamil interrogative words — ALWAYS require a predicate; can never end a sentence.
      // எந்த (which), என்ன (what), எப்ப/எப்போ (when), எங்க/எங்கே (where),
      // யாரு/யார் (who), எவ்வளவு (how much), எப்படி (how), ஏன் (why),
      // எது (which one), எதுக்கு (for what), எதாவது (anything/which)
      if (/^(எந்த|என்ன|எப்ப|எப்போ|எங்க|எங்கே|யாரு|யார்|எவ்வளவு|எப்படி|ஏன்|எது|எதுக்கு|எதாவது|எத்தனை|எத்தன|எவன்|எவள்|எவங்க)$/.test(last)) return true;
      // Hindi interrogatives: क्या, कब, कहाँ, कैसे, कौन, कितना, क्यों
      if (/^(क्या|कब|कहाँ|कैसे|कौन|कितना|क्यों|किसका|किसकी|किसके)$/.test(last)) return true;
      return false;
    }
`,
      lines: [
        {
          lines: "1-2",
          label: "all-caps abbreviation",
          explanation:
            "If the first or last word is an all-caps token of 2+ letters ('DTDC', 'KYC'), it is probably a partial proper-noun phrase — return true.",
        },
        {
          lines: "3-6",
          label: "Tamil interrogatives",
          explanation:
            "A comment listing Tamil question words, then a regex: எந்த/என்ன/எப்ப/எங்க/யாரு … always need a predicate, so a turn ending in one is incomplete.",
        },
        {
          lines: "7-8",
          label: "Hindi interrogatives",
          explanation:
            "A comment, then the same idea for Hindi question words (क्या, कब, कहाँ, कैसे, कौन …).",
        },
        {
          lines: "9-12",
          label: "return false + close",
          explanation:
            "If none of the rules fired, `return false` — the text looks complete. The `}` closes `looksIncomplete`, then a blank line and the start of the coalesce-buffer variables.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The coalesce buffer variables and the helper that emits a live (interim) partial transcript.",
      code: `    let coalesceBuf  = "";
    let coalesceMeta: SttFinalMetadata | undefined;
    let coalesceLang: string | undefined;
    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

    const emitPartial = () => {
      const text = coalesceBuf.trim();
      if (!text) return;
      onTranscript(text, false, coalesceLang, {
        ...coalesceMeta,
        pendingPartial: true,
        speechEndReceived,
      });
    };
`,
      lines: [
        {
          lines: "1-5",
          label: "coalesce buffer state",
          explanation:
            "`coalesceBuf` holds the text being assembled; `coalesceMeta`/`coalesceLang` remember its metadata and detected language; `coalesceTimer` is the pending emit timer. Then a blank line.",
        },
        {
          lines: "6-15",
          label: "emitPartial()",
          explanation:
            "Sends the current buffer as a **non-final** transcript (`isFinal = false`) with `pendingPartial: true` — the rough live guess the pipeline can use for barge-in but won't send to the LLM yet. Empty buffer → do nothing. The `};` and a blank line follow.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "emitCoalesced() — the moment a finished, committed transcript is handed to the pipeline.",
      code: `    const emitCoalesced = () => {
      coalesceTimer = null;
      if (!coalesceBuf) return;
      const text     = coalesceBuf;
      const lang     = coalesceLang;
      const segments = coalesceMergedSegments;
      const meta: SttFinalMetadata = {
        ...coalesceMeta,
        mergedSegments: segments,
        pauseCount:     Math.max(0, segments - 1),
      };
      coalesceBuf            = "";
      coalesceMeta           = undefined;
      coalesceLang           = undefined;
      coalesceMergedSegments = 0;
      transcriptArrivedAt    = 0;

      logger.info(
        { text: text.slice(0, 120), segments, holdMs: adaptiveHoldMs(), pauseHistory: pauseHistory.slice(), detectedLang: lang },
        "Sarvam STT: emitting adaptive-coalesced transcript",
      );
      onTranscript(text, true, lang, meta);
    };
`,
      lines: [
        {
          lines: "1-6",
          label: "snapshot the buffer",
          explanation:
            "Clear the timer handle, bail if the buffer is empty, then copy the text, language, and merged-segment count into locals before resetting.",
        },
        {
          lines: "7-11",
          label: "build final metadata",
          explanation:
            "Assemble `SttFinalMetadata`: how many Sarvam segments were merged and the pause count (segments minus one). This tells downstream how much stitching happened.",
        },
        {
          lines: "12-18",
          label: "reset coalesce state",
          explanation:
            "Empty the buffer and clear the metadata, language, segment count, and arrival timestamp so the next turn starts fresh.",
        },
        {
          lines: "19-24",
          label: "log + emit final",
          explanation:
            "Log the committed transcript (with the adaptive hold and pause history for debugging), then call `onTranscript(text, true, …)` — the `true` means **final**, so the pipeline now starts thinking. The `};` closes the helper.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Fragment coalescing self-tunes to each caller",
      body: [
        "Sarvam sends transcripts in fragments. Rather than a fixed wait, the adapter measures the caller's real mid-sentence pauses and averages the last few. A fast talker gets a short ~120 ms hold; a slower or older caller gets up to ~500 ms.",
        "This is what `adaptiveHoldMs()` and `pauseHistory` do. It converges within two or three turns of natural speech, so replies feel snappy for quick speakers without cutting off slow ones.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The zombie-socket detection comment and its state — guarding against a socket that looks open but has silently died.",
      code: `    // ── WebSocket health monitoring ───────────────────────────────────────────
    // Sarvam sends speech_start / speech_end / transcript on every event. A socket
    // can go ZOMBIE — readyState OPEN but no traffic — without ever emitting "close".
    // If >3 s pass with no inbound message WHILE we are actively streaming caller
    // audio inside a speech segment, treat it as dead and terminate the socket so the
    // ws.on("close") handler reconnects. The lastAudioSentAt guard prevents false
    // positives during send gaps — the pipeline feeds caller frames CONTINUOUSLY,
    // even during agent playback (input gating was removed after calls 772→1320);
    // real gaps come from the AMD confirmation phase, the pre-greeting window, or
    // carrier DTX/stream pauses. deadFired latches so we act once per episode.
    let lastMsgAt        = Date.now();
    let lastAudioSentAt  = 0;
    let inSpeechSegment  = false;
    let deadFired        = false;
    const HEARTBEAT_MS   = 300;
    const WS_DEAD_MS     = 3_000;
`,
      lines: [
        {
          lines: "1-14",
          label: "zombie-socket doctrine",
          explanation:
            "A detailed comment: a Sarvam socket can go **zombie** — `readyState` says OPEN but no messages flow and no 'close' ever fires. If more than 3 s pass with no inbound message *while we're actively streaming caller audio in a speech segment*, treat it as dead and terminate so the close handler reconnects. The `lastAudioSentAt` guard stops false alarms during genuine send gaps.",
        },
        {
          lines: "15-17",
          label: "health-monitor state",
          explanation:
            "`lastMsgAt` (last inbound message time), `lastAudioSentAt` (last audio we sent), `inSpeechSegment` (are we mid-utterance?), and `deadFired` (a fire-once latch).",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "sendChunk() — the low-level function that actually ships one audio chunk to Sarvam as base64 JSON.",
      code: `    const sendChunk = (chunk: Buffer) => {
      if (!wsReady || ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      // Resuming after a send gap (AMD confirmation, pre-greeting, carrier DTX/stream
      // pause — the feed itself is NOT gated during agent playback):
      // grant Sarvam a fresh WS_DEAD_MS window before the zombie check can fire. Without
      // this, a stale lastMsgAt from before the gap would trip a false positive on the
      // very first chunk after playback and terminate a perfectly healthy socket.
      if (now - lastAudioSentAt > WS_DEAD_MS) lastMsgAt = now;
      ws.send(
        JSON.stringify({
          audio: {
            data:        chunk.toString("base64"),
            encoding:    "audio/wav",   // enum must be "audio/wav"; actual codec is set via URL param
            sample_rate: sampleRate,
          },
        }),
      );
      lastAudioSentAt = now; // proves we are ACTIVELY streaming — gates the zombie detector
    };
`,
      lines: [
        {
          lines: "1-2",
          label: "guard: only when open",
          explanation:
            "Define `sendChunk`. If the socket isn't ready/open, do nothing (the caller queues instead). Capture `now`.",
        },
        {
          lines: "3-9",
          label: "fresh window after a gap",
          explanation:
            "A comment plus the key line: if it's been longer than `WS_DEAD_MS` since we last sent audio (a real gap — AMD confirmation, pre-greeting, carrier pause), reset `lastMsgAt` so the zombie check doesn't false-fire on the very first chunk after the gap.",
        },
        {
          lines: "10-18",
          label: "send the base64 audio JSON",
          explanation:
            "Ship the chunk as `{ audio: { data: <base64>, encoding: \"audio/wav\", sample_rate } }`. The `encoding` is the forced `\"audio/wav\"` enum from the gotcha above — the real codec is set in the URL.",
        },
        {
          lines: "19-21",
          label: "mark actively streaming",
          explanation:
            "Record `lastAudioSentAt = now`, which proves we're actively streaming and arms/gates the zombie detector. The `};` closes `sendChunk`.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "WAV-wrapped audio and the forced encoding enum, again",
      body: [
        "Note in `sendChunk()` the same enum trap from the header: the JSON always carries `encoding: \"audio/wav\"`. The batch path goes further and wraps the raw PCM in a real WAV container via `pcmToWav`, because the batch endpoint reads the WAV header for its sample rate.",
        "Streaming doesn't need the container (the sample rate rides in the URL and the message), but it still must *claim* `\"audio/wav\"`. Same words, two slightly different requirements — easy to confuse, which is why both are commented.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "openSocket() opens (or reopens) the WebSocket and wires up the 'open' handler that flushes queued audio.",
      code: `    const openSocket = () => {
      if (intentionallyClosed) return;
      wsReady = false;

      ws = new WebSocket(buildWsUrl(), {
        headers: { "api-subscription-key": key },
      });

      ws.on("open", () => {
        wsReady = true;
        reconnectAttempts = 0;
        deadFired         = false; // fresh socket — re-arm the zombie detector
        lastMsgAt         = Date.now(); // start silence window from now, not dead socket's last frame
        queueTrimLogged   = false; // re-arm queue-trim log for this reconnect episode
        // Reset VAD state: a stale speechEndReceived=true would send post-reconnect
        // transcripts down the 30ms fast-flush path before any fresh speech_end fires.
        inSpeechSegment   = false;
        speechEndReceived = false;
        logger.info(
          { langCode, model, mode },
          "Sarvam streaming STT: WebSocket opened",
        );
        // Flush any audio that arrived before the socket was ready.
        for (const chunk of audioQueue.splice(0)) sendChunk(chunk);
      });
`,
      lines: [
        {
          lines: "1-3",
          label: "openSocket() guard",
          explanation:
            "Define `openSocket`. If we've intentionally closed, don't reopen. Mark `wsReady = false` while connecting.",
        },
        {
          lines: "4-6",
          label: "create the socket",
          explanation:
            "Create the `WebSocket` using the freshly built URL and the `api-subscription-key` auth header. Because the URL is rebuilt here, a reconnect after a language switch uses the new language.",
        },
        {
          lines: "7-18",
          label: "on open: reset state",
          explanation:
            "When the socket opens: mark ready, reset reconnect attempts, re-arm the zombie detector (`deadFired = false`), start the silence window now, re-arm the trim log, and reset VAD state — a stale `speechEndReceived = true` would otherwise fast-flush post-reconnect transcripts before any fresh speech-end fires.",
        },
        {
          lines: "19-26",
          label: "log + flush the queue",
          explanation:
            "Log that the socket opened, then replay every chunk stashed in `audioQueue` with `splice(0)` — so no caller words are lost to connection lag. The `});` closes the open handler.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The message handler starts — parsing every frame Sarvam sends and marking the socket alive.",
      code: `      ws.on("message", (raw: Buffer | string) => {
        let msg: SarvamMsg;
        try {
          msg = JSON.parse(raw.toString()) as SarvamMsg;
        } catch {
          return; // ignore non-JSON frames
        }

        // VAD signals — official type values: "speech_start" / "speech_end"
        // (legacy guessed values "events" + signal_type also handled for safety)
        lastMsgAt = Date.now();
        deadFired = false; // any inbound frame proves the socket is alive — re-arm the detector

        // Keep the latest request_id (Sarvam docs: support/debugging requests are
        // resolved fastest when the affected call's request_id can be quoted).
        const _reqId = msg.request_id ?? msg.data?.request_id;
        if (_reqId) lastRequestId = _reqId;`,
      lines: [
        {
          lines: "1-7",
          label: "parse inbound JSON",
          explanation:
            "On each message, try to `JSON.parse` it into a `SarvamMsg`. If it isn't JSON (a stray binary frame), ignore it with an early return.",
        },
        {
          lines: "8-11",
          label: "mark socket alive",
          explanation:
            "A comment about VAD signal names, then the crucial pair: any inbound frame updates `lastMsgAt` and clears `deadFired` — proof the socket is alive, re-arming the zombie detector.",
        },
        {
          lines: "12-17",
          label: "capture request_id + speech_start branch",
          explanation:
            "Keep the latest `request_id` for support logs. Then begin the `speech_start` branch (also accepting the legacy `events`+`START_SPEECH` shape).",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The speech-start branch — the caller began talking, so cancel any pending emit and record the pause.",
      code: `        if (msg.type === "speech_start" || (msg.type === "events" && msg.data?.signal_type === "START_SPEECH")) {
          inSpeechSegment    = true;
          speechEndReceived  = false; // caller is speaking again; clear the speech_end flag
          _onSpeechStart?.();
          logger.debug({ langCode }, "Sarvam STT: speech start");
          // If we are holding a transcript and the user resumed speaking, cancel
          // the emit timer, record the pause length for adaptive calibration, and
          // wait for the next transcript to append before emitting.
          if (coalesceTimer && coalesceBuf) {
            clearTimeout(coalesceTimer);
            coalesceTimer = null;
            if (transcriptArrivedAt > 0) {
              const pauseMs = Date.now() - transcriptArrivedAt;
              if (pauseMs > 40 && pauseMs < 1200) { // filter: ignore sub-40ms noise & >1.2s stale gaps
                pauseHistory.push(pauseMs);
                if (pauseHistory.length > PAUSE_HISTORY_MAX) pauseHistory.shift();
              }
              transcriptArrivedAt = 0;
            }
            logger.debug(
              { langCode, pauseHistory: pauseHistory.slice(), nextHoldMs: adaptiveHoldMs() },
              "Sarvam STT: coalesce hold cancelled — speech resumed, pause recorded",
            );
          }
          return;
        }`,
      lines: [
        {
          lines: "1-5",
          label: "enter a speech segment",
          explanation:
            "On `speech_start` (or the legacy `events`+`START_SPEECH`): mark `inSpeechSegment = true`, clear `speechEndReceived` (the caller is speaking again), fire the optional `_onSpeechStart` hook, and log it.",
        },
        {
          lines: "6-19",
          label: "cancel hold + record pause",
          explanation:
            "A comment, then: if we were holding a transcript and the caller resumed, cancel the emit timer and measure the pause. Pauses between 40 ms and 1200 ms are pushed into `pauseHistory` (capped at `PAUSE_HISTORY_MAX`) so `adaptiveHoldMs()` can learn this caller's rhythm.",
        },
        {
          lines: "20-26",
          label: "log + return",
          explanation:
            "Log the cancelled hold with the updated pause history and next hold, then `return`. The braces close the branch.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The speech-end branch — the caller stopped, so flush the held transcript quickly.",
      code: `        if (msg.type === "speech_end" || (msg.type === "events" && msg.data?.signal_type === "END_SPEECH")) {
          inSpeechSegment   = false;
          speechEndReceived = true;
          speechEndAt       = Date.now();
          logger.debug({ langCode }, "Sarvam STT: speech end");
          // Fast-path when transcript is ALREADY buffered (multi-segment coalescing):
          // caller has stopped talking — shorten any running timer.
          // Universal thinking-pause rule (language-agnostic):
          //   • CLEARLY COMPLETE  → 30 ms fast-flush
          //       – Terminal punctuation (.?!।) — STT itself declared it done
          //       – Single known-affirmation word ("yes", "சரி", "हाँ", …)
          //   • EVERYTHING ELSE   → max(adaptiveHoldMs(), 700 ms)
          //       Covers ALL mid-sentence fragments in ALL languages without
          //       enumerating grammar patterns. "5 lakhs", "எனக்கு வந்து",
          //       "mujhe chahiye", "I want", Telugu/Kannada partials, etc.
          //       all wait 700 ms, which is enough to survive a normal human
          //       thinking pause (~1 s) while the STT silence window is shorter.
          if (coalesceBuf && coalesceTimer) {
            clearTimeout(coalesceTimer);
            // speech_end received: caller has stopped speaking — flush (UI-configured)
            coalesceTimer = setTimeout(emitCoalesced, SPEECH_END_FLUSH_MS);
            emitPartial();
            logger.debug(
              { langCode, buf: coalesceBuf.slice(0, 60), flushMs: SPEECH_END_FLUSH_MS },
              "Sarvam STT: speech_end received — flushing coalesce buffer",
            );
          }
          _onSpeechEnd?.();
          return;
        }`,
      lines: [
        {
          lines: "1-5",
          label: "leave the speech segment",
          explanation:
            "On `speech_end` (or legacy `END_SPEECH`): mark `inSpeechSegment = false`, set `speechEndReceived = true`, timestamp `speechEndAt` for latency math, and log.",
        },
        {
          lines: "6-17",
          label: "thinking-pause doctrine",
          explanation:
            "A long comment describing the language-agnostic rule: clearly-complete text (terminal punctuation, or a known one-word affirmation) fast-flushes in ~30 ms, while everything else waits `max(adaptiveHoldMs(), 700 ms)` — enough to survive a normal ~1 s human thinking pause across all languages.",
        },
        {
          lines: "18-27",
          label: "shorten the timer + flush",
          explanation:
            "If a transcript is already buffered with a running timer, cancel it and re-arm a short `SPEECH_END_FLUSH_MS` timer (the caller stopped), emit a partial, and log. The `}` closes the block.",
        },
        {
          lines: "28-30",
          label: "fire hook + return",
          explanation:
            "Fire the optional `_onSpeechEnd` hook and `return`. The `}` closes the speech-end branch.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The transcript branch begins — Sarvam sent recognized words. First it cleans the text and decides on the detected language.",
      code: `
        // Final transcript — official type: "transcript"; legacy: "data"
        if (msg.type === "transcript" || msg.type === "data") {
          inSpeechSegment = false; // segment complete
          const text = stripDiarizationLabels(msg.data?.transcript ?? "");
          // Capture the language Sarvam identified for this segment (saaras:v3 LID).
          // Last seen language_code wins across coalesced segments; reset in emitCoalesced().
          //
          // IMPORTANT: only forward the reported code when it DIFFERS from the
          // init language (langCode). When Sarvam is initialised with
          // language_code=en-IN it echoes "en-IN" on every response regardless
          // of what the caller actually spoke — this is NOT real LID; it is just
          // the init-language echoed back. Forwarding that echo would suppress
          // detectScriptLanguage() in the pipeline: the pipeline short-circuits on
          // a non-null sttLang and never reads Unicode script blocks in the
          // transcript. Leaving coalesceLang undefined on "same-as-init" responses
          // lets detectScriptLanguage() run and catch actual Indic-script characters`,
      lines: [
        {
          lines: "1-4",
          label: "transcript arrived",
          explanation:
            "A comment, then: accept `transcript` (or legacy `data`) messages, mark the segment complete, and clean the text with `stripDiarizationLabels`.",
        },
        {
          lines: "5-17",
          label: "the language-echo trap",
          explanation:
            "A long comment explaining a subtle bug: when initialised with `en-IN`, Sarvam echoes `en-IN` on every reply regardless of what was really spoken — that's not real language detection. Forwarding that echo would stop the pipeline's script-based detection from catching real Tamil/Hindi characters.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Still in the transcript branch — only forward a genuinely different language, then buffer the text with latency metadata.",
      code: `          // (Tamil, Hindi, etc.) in the transcript text.
          const reportedLang = msg.data?.language_code;
          if (reportedLang && reportedLang !== langCode) {
            coalesceLang = reportedLang;
          }
          if (!text) return;
          const meta: SttFinalMetadata = {
            endDetectToFinalMs: speechEndAt > 0 ? Date.now() - speechEndAt : undefined,
            requestId: lastRequestId,
          };
          logger.info(
            { text: text.slice(0, 80), model, mode, endDetectToFinalMs: meta.endDetectToFinalMs, requestId: lastRequestId },
            "Sarvam STT: final transcript (buffering for adaptive coalesce)",
          );`,
      lines: [
        {
          lines: "1-4",
          label: "forward real LID only",
          explanation:
            "Take the reported `language_code`; only set `coalesceLang` when it **differs** from the init language, so the echo case is left undefined and the pipeline's own script detection can run. Empty text → return.",
        },
        {
          lines: "5-8",
          label: "build latency metadata",
          explanation:
            "Assemble metadata: `endDetectToFinalMs` (how long from END_SPEECH to this final, if measured) and the current `requestId`.",
        },
        {
          lines: "9-14",
          label: "log + reset speechEndAt",
          explanation:
            "Log the final transcript (buffering for coalesce) with model, mode, latency, and request id, then reset `speechEndAt`.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The transcript is appended to the coalesce buffer and the emit timer is (re)armed based on completeness.",
      code: `          speechEndAt = 0;
          // Append to coalesce buffer (may already have a prior partial).
          coalesceBuf            = coalesceBuf ? coalesceBuf + " " + text : text;
          coalesceMeta           = meta;         // keep latest latency measurement
          coalesceMergedSegments++;
          transcriptArrivedAt    = Date.now();   // start of the hold window
          // (Re-)arm the emit timer.
          // Timer selection after each transcript segment:
          // • speech_end already received → SPEECH_END_FLUSH_MS (UI, default 30).
          // • incomplete mid-thought → COALESCE_INCOMPLETE_MS (UI, default 220).
          // • complete transcript, speech_end not yet → SPEECH_END_FLUSH_MS.
          if (coalesceTimer) clearTimeout(coalesceTimer);
          const incomplete = looksIncomplete(coalesceBuf);
          const holdMs = speechEndReceived
            ? SPEECH_END_FLUSH_MS
            : (incomplete ? COALESCE_INCOMPLETE_MS : SPEECH_END_FLUSH_MS);
          logger.debug(
            { langCode, buf: coalesceBuf.slice(0, 60), holdMs, speechEndReceived },
            "Sarvam STT: scheduling coalesce emit",
          );
          coalesceTimer = setTimeout(emitCoalesced, holdMs);
          emitPartial();
          return;
        }`,
      lines: [
        {
          lines: "1-6",
          label: "append to the buffer",
          explanation:
            "A comment, then: append the new text to `coalesceBuf` (with a space if it already had content), keep the latest metadata, bump the merged-segment count, and stamp `transcriptArrivedAt` — the hold window start.",
        },
        {
          lines: "7-16",
          label: "pick the hold time",
          explanation:
            "A comment listing the three cases, then: clear any old timer, ask `looksIncomplete()` about the whole buffer, and choose the hold — `SPEECH_END_FLUSH_MS` if the caller already stopped, else `COALESCE_INCOMPLETE_MS` for a mid-thought fragment, else the short flush. Then log the decision.",
        },
        {
          lines: "17-24",
          label: "arm timer + emit partial",
          explanation:
            "Start the emit timer with the chosen hold, emit a live partial, and `return`. The `}` closes the transcript branch. The next lines begin the `error` branch.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The error branch and the end of the message handler.",
      code: `
        if (msg.type === "error") {
          logger.error(
            { msg: msg.data?.message, requestId: msg.request_id ?? msg.data?.request_id ?? lastRequestId, langCode },
            "Sarvam STT: server error",
          );
        }
      });
`,
      lines: [
        {
          lines: "1-6",
          label: "error message",
          explanation:
            "If Sarvam sends a `type: \"error\"`, log it with the message, request id, and language for debugging. The `}` closes the branch.",
        },
        {
          lines: "7-9",
          label: "close the handler",
          explanation:
            "The `});` closes the whole `ws.on(\"message\", …)` handler. A blank line follows.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Language normalisation happens on every hint",
      body: [
        "The caller's language can arrive as a bare code (`ta`), a full BCP-47 tag (`ta-IN`), or something the chosen model doesn't support. `normaliseLang()` maps and validates it, and if all else fails, falls back to `en-IN` rather than crashing.",
        "There's also a subtle detected-language rule in the transcript branch: when Sarvam merely echoes the init language, the adapter leaves the detected language undefined so the pipeline's own script-based detection can catch real Tamil or Hindi characters.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The close handler — decides whether to reconnect, and how, when the socket drops.",
      code: `      ws.on("close", (code, reason) => {
        wsReady = false;

        if (intentionallyClosed) {
          onClose?.();
          return;
        }

        // Live language switch: we closed the socket ourselves — reopen
        // immediately with the new langCode. Not an error; no backoff and no
        // reconnectAttempts++ (audio buffered in audioQueue meanwhile).
        if (switchingLanguage) {
          switchingLanguage = false;
          logger.info({ langCode, model }, "Sarvam STT: reopening WebSocket after language switch");
          openSocket();
          return;
        }

        // Auth / quota errors: do not retry.
        if (code >= 4000 && code < 5000) {
          logger.error(
            { code, reason: reason.toString() },
            "Sarvam STT: auth/quota close — not retrying",
          );
          onClose?.();
          return;
        }`,
      lines: [
        {
          lines: "1-5",
          label: "on close: not ready",
          explanation:
            "When the socket closes, mark `wsReady = false`. If we closed it on purpose, just fire the caller's `onClose` and stop.",
        },
        {
          lines: "6-17",
          label: "language-switch reconnect",
          explanation:
            "A comment, then: if we closed it ourselves to switch languages, clear the flag and reopen **immediately** — no backoff, no attempt count — since audio was buffered meanwhile.",
        },
        {
          lines: "18-27",
          label: "auth/quota: don't retry",
          explanation:
            "A comment, then: if the close code is in the 4000–4999 range (auth/quota), log it and stop — retrying would just burn money. Fire `onClose` and return.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The rest of the close handler — the exponential backoff reconnect, plus the error handler.",
      code: `
        if (reconnectAttempts >= MAX_RECONNECT) {
          logger.error({ code, reconnectAttempts }, "Sarvam STT: max reconnects reached");
          onClose?.();
          return;
        }

        // Exponential backoff: 500ms, 1s, 2s, 4s … capped at 8s.
        const delay = Math.min(500 * 2 ** reconnectAttempts, 8000);
        reconnectAttempts++;
        logger.warn(
          { code, delay, reconnectAttempts },
          "Sarvam STT: WebSocket closed — reconnecting",
        );
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          openSocket();
        }, delay);
      });

      ws.on("error", (err) => {
        logger.error({ err }, "Sarvam STT: WebSocket error");
      });
    };
`,
      lines: [
        {
          lines: "1-5",
          label: "give up at the cap",
          explanation:
            "If we've already hit `MAX_RECONNECT` (10) attempts, log the failure, fire `onClose`, and stop trying.",
        },
        {
          lines: "6-13",
          label: "exponential backoff",
          explanation:
            "A comment, then: compute a delay of 500 ms doubling each attempt, capped at 8 s (500 ms, 1 s, 2 s, 4 s, 8 s). Bump the attempt counter and log the reconnect.",
        },
        {
          lines: "14-19",
          label: "schedule the reopen",
          explanation:
            "Clear any pending reconnect timer, then set a new one that clears itself and calls `openSocket()` after the delay. The `});` closes the close handler.",
        },
        {
          lines: "20-26",
          label: "error handler + end openSocket",
          explanation:
            "A blank line, then `ws.on(\"error\", …)` which just logs the error (the close handler drives recovery). The `};` closes the `openSocket` function.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The socket is opened for real, and the returned StreamSTT handle begins — starting with sendAudio().",
      code: `    openSocket();

    const sttObj: import("../../types.js").StreamSTT = {
      onConnectionDead: null,

      sendAudio(chunk: Buffer): void {
        if (!wsReady || ws.readyState !== WebSocket.OPEN) {
          audioQueue.push(chunk);
          // Cap the queue at ~2 s of audio — drop oldest chunks so that on reconnect
          // we don't flood Sarvam with stale audio and produce phantom transcripts.
          let total = audioQueue.reduce((a, b) => a + b.length, 0);
          if (total > MAX_QUEUE_BYTES) {
            let dropped = 0;
            while (total > MAX_QUEUE_BYTES && audioQueue.length > 1) {
              const len = audioQueue.shift()!.length;
              dropped  += len;
              total    -= len;
            }
            if (!queueTrimLogged) {
              queueTrimLogged = true;
              logger.debug({ droppedBytes: dropped }, "Sarvam STT: audio queue trimmed — dropped stale chunks during reconnect backoff");
            }
          }
        } else {
          sendChunk(chunk);
        }
      },`,
      lines: [
        {
          lines: "1-3",
          label: "kick off the connection",
          explanation:
            "A blank line, then the first `openSocket()` call — this actually connects the socket. Then a blank line before building the handle.",
        },
        {
          lines: "4-6",
          label: "build sttObj",
          explanation:
            "Create `sttObj`, typed as `StreamSTT`. `onConnectionDead` starts null — an optional hook an external consumer can set to learn about zombie deaths.",
        },
        {
          lines: "7-16",
          label: "sendAudio: queue when not ready",
          explanation:
            "The pipeline calls `sendAudio` with each chunk. If the socket isn't open yet, push the chunk into `audioQueue` and total up its size.",
        },
        {
          lines: "17-27",
          label: "trim the stale queue",
          explanation:
            "If the queue exceeds ~2 s of audio, drop the oldest chunks (keeping at least one) so a reconnect doesn't flood Sarvam with stale audio and produce phantom transcripts; log the trim once per episode. Otherwise (socket open) send immediately via `sendChunk`. The `},` ends sendAudio.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "flush() — a teardown/tooling method that immediately commits any held transcript and tells Sarvam to finalize.",
      code: `      // INVARIANT: the live pipeline never calls flush() — Sarvam's server VAD owns
      // end-of-speech (see the DO-NOT-GATE feed comment in pipeline.ts). Adding a
      // pipeline call site would reintroduce client-side endpointing racing Sarvam
      // (the calls-772→1320 regression class). flush() exists for teardown/tooling.
      flush(): void {
        // Emit any held coalesced transcript immediately (don't wait for the timer).
        // emitCoalesced() is a no-op on an empty buffer, so always call it — this
        // handles the edge case where coalesceBuf is non-empty but coalesceTimer is null.
        if (coalesceTimer) clearTimeout(coalesceTimer);
        emitCoalesced();
        // Ask Sarvam to immediately finalize its internal audio buffer.
        if (!wsReady || ws.readyState !== WebSocket.OPEN) return;
        const emptyData = Buffer.alloc(0);
        ws.send(
          JSON.stringify({
            audio: {
              data:        emptyData.toString("base64"),
              encoding:    "audio/wav",
              sample_rate: sampleRate,
            },
            flush: true,
          }),
        );
        logger.debug({ langCode }, "Sarvam STT: flush signal sent");
      },`,
      lines: [
        {
          lines: "1-4",
          label: "INVARIANT: pipeline never flushes",
          explanation:
            "A comment warning that the live pipeline must never call `flush()` — Sarvam's server VAD owns end-of-speech, and client-side flushing would race it (the calls-772→1320 regression). `flush()` exists only for teardown and tooling.",
        },
        {
          lines: "5-11",
          label: "emit held transcript",
          explanation:
            "Define `flush`. Cancel the emit timer and call `emitCoalesced()` immediately (it's a no-op on an empty buffer, per the comment), so nothing held is lost even if the timer hadn't fired.",
        },
        {
          lines: "12-25",
          label: "send flush signal to Sarvam",
          explanation:
            "If the socket is open, send an empty audio frame with `flush: true` so Sarvam finalizes its internal buffer, then log it. The `},` ends the flush method.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "setLanguage() — live-switches the caller's language mid-call and reconnects with the new hint.",
      code: `      setLanguage(lang: string): void {
        const next = normaliseLang(lang, model);
        if (next === langCode) return;           // already on it — no-op (loop guard)
        if (intentionallyClosed) return;         // stream already torn down
        const prev = langCode;
        langCode = next;
        mode = resolveSarvamSttMode(langCode, explicitMode);
        logger.info(
          { from: prev, to: next, mode, model },
          "Sarvam STT: live language switch — reconnecting stream with new language hint",
        );
        // Drain any transcript held in the OLD language before switching.
        if (coalesceTimer) { clearTimeout(coalesceTimer); emitCoalesced(); }
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          switchingLanguage = true;              // close handler reopens immediately with new langCode
          try { ws.close(1000); } catch {
            switchingLanguage = false;
            try { ws.terminate(); } catch { /* noop */ }
            openSocket();
          }
        }
        // else: socket is between reconnects — the pending reconnect timer's
        // openSocket() will pick up the new langCode via buildWsUrl().
      },`,
      lines: [
        {
          lines: "1-4",
          label: "normalise + guards",
          explanation:
            "Define `setLanguage` and normalise the requested language for this model. If it's already the current one, do nothing (loop guard). If the stream is torn down, do nothing.",
        },
        {
          lines: "5-11",
          label: "switch language + mode, log",
          explanation:
            "Remember the old language, set the new `langCode`, recompute `mode` for it, and log the switch. `buildWsUrl()` will pick these up on the next connect.",
        },
        {
          lines: "12-16",
          label: "drain then close to reconnect",
          explanation:
            "Drain any transcript held in the OLD language, and if the socket is open/connecting, set `switchingLanguage = true` (so the close handler reopens with no backoff) and try `ws.close(1000)`.",
        },
        {
          lines: "17-24",
          label: "close-failure fallback + else",
          explanation:
            "If the close throws, clear the flag, terminate, and reopen directly. The `}` closes the branches; the trailing comment notes that if the socket is mid-reconnect, the pending timer's `openSocket()` picks up the new language. The `},` ends setLanguage.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "close() — the clean teardown the pipeline calls when the call ends.",
      code: `      close(): void {
        // Drain the coalesce buffer before closing so no transcript is lost.
        if (coalesceTimer) { clearTimeout(coalesceTimer); emitCoalesced(); }
        intentionallyClosed = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        clearInterval(heartbeatInterval);
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close(1000);
        }
      },
      getPendingTranscript(): string {
        return coalesceBuf.trim();
      },`,
      lines: [
        {
          lines: "1-4",
          label: "drain then mark closed",
          explanation:
            "First drain any held transcript so no words are lost, then set `intentionallyClosed = true` so no handler tries to reconnect.",
        },
        {
          lines: "5-9",
          label: "cancel timers",
          explanation:
            "Clear the pending reconnect timer and the heartbeat interval — leaving these running would leak across thousands of calls a day.",
        },
        {
          lines: "10-19",
          label: "close the socket + getPendingTranscript",
          explanation:
            "If the socket is open or connecting, close it cleanly with code 1000. Then `getPendingTranscript()` returns the trimmed buffer (useful for teardown inspection). The `};` closes the whole handle object.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Wiring the speech-start/end callbacks onto the handle via getters and setters.",
      code: `    };

    // Expose _onSpeechStart / _onSpeechEnd via getter/setter so the WS handler (which
    // closes over these variables, declared before openSocket) stays in sync with whatever
    // callback the caller assigns after sttObj is returned.
    Object.defineProperty(sttObj, "onSpeechStart", {
      get(): (() => void) | null { return _onSpeechStart; },
      set(cb: (() => void) | null): void { _onSpeechStart = cb; },
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(sttObj, "onSpeechEnd", {
      get(): (() => void) | null { return _onSpeechEnd; },
      set(cb: (() => void) | null): void { _onSpeechEnd = cb; },
      configurable: true,
      enumerable: true,
    });`,
      lines: [
        {
          lines: "1-6",
          label: "expose onSpeechStart",
          explanation:
            "A comment, then define an `onSpeechStart` property on `sttObj` whose getter/setter read and write the `_onSpeechStart` closure variable — so whatever callback the caller assigns after the handle is returned stays in sync with the message handler that closes over it.",
        },
        {
          lines: "7-12",
          label: "expose onSpeechEnd",
          explanation:
            "The same pattern for `onSpeechEnd`, backed by `_onSpeechEnd`. Both are configurable and enumerable.",
        },
        {
          lines: "13-17",
          label: "end of onSpeechEnd definition",
          explanation:
            "The setter and the property flags, then the closing `});` of the second `Object.defineProperty`.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The idle keep-alive setup — a near-silent frame that stops Sarvam hanging up during a long agent monologue.",
      code: `
    // Sarvam closes the streaming WS after ~60 s of inactivity (documented
    // limit). The pipeline gates caller frames during agent playback, so a long
    // agent monologue / hold can starve the socket into an idle close + a
    // pointless reconnect cycle. After 15 s with nothing sent, ship a short
    // near-silent PCM frame as a keep-alive (official guidance). Sent RAW — not
    // via sendChunk — so it never updates lastAudioSentAt/lastMsgAt: keep-alives
    // must neither arm the zombie detector nor count as "actively streaming".
    const KEEPALIVE_IDLE_MS = 15_000;
    const KEEPALIVE_FRAME   = Buffer.alloc(Math.floor(sampleRate * 0.2) * 2); // 200 ms silence, s16le mono
    let   lastKeepAliveAt   = 0;

    // Start the heartbeat AFTER sttObj is created so the interval can reference it.
    const heartbeatInterval = setInterval(() => {
      if (intentionallyClosed) return;                     // torn down
      // ── Idle keep-alive (only OUTSIDE speech segments — real audio covers the rest) ──
      const nowMs = Date.now();`,
      lines: [
        {
          lines: "1-8",
          label: "why keep-alive exists",
          explanation:
            "A comment: Sarvam closes the socket after ~60 s of inactivity. During a long agent reply or hold, the pipeline gates caller frames, so nothing is sent and the socket would idle-close. The fix: after 15 s idle, send a short near-silent PCM frame — sent RAW (not via `sendChunk`) so it never arms the zombie detector or counts as active streaming.",
        },
        {
          lines: "9-11",
          label: "keep-alive constants",
          explanation:
            "`KEEPALIVE_IDLE_MS` (15 s), a `KEEPALIVE_FRAME` buffer of 200 ms of silence at the current sample rate (s16le mono), and `lastKeepAliveAt` to throttle it.",
        },
        {
          lines: "12-17",
          label: "start the heartbeat interval",
          explanation:
            "A comment, then start `heartbeatInterval` (created after `sttObj` so `close()` can clear it). It bails immediately if the stream was torn down.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Inside the heartbeat: send the idle keep-alive frame only when truly idle and outside speech.",
      code: `      if (
        wsReady && ws.readyState === WebSocket.OPEN && !inSpeechSegment &&
        nowMs - lastAudioSentAt > KEEPALIVE_IDLE_MS &&
        nowMs - lastKeepAliveAt > KEEPALIVE_IDLE_MS
      ) {
        lastKeepAliveAt = nowMs;
        try {
          ws.send(JSON.stringify({
            audio: {
              data:        KEEPALIVE_FRAME.toString("base64"),
              encoding:    "audio/wav",
              sample_rate: sampleRate,
            },
          }));
          logger.debug({ langCode }, "Sarvam STT: idle keep-alive frame sent (60s inactivity guard)");
        } catch { /* socket racing closed — the close handler's reconnect path covers it */ }
      }`,
      lines: [
        {
          lines: "1-8",
          label: "idle keep-alive condition",
          explanation:
            "A comment, then: only when the socket is open, we're NOT mid-speech, and both the last audio and last keep-alive were more than 15 s ago, do we fire — real caller audio covers all the busy time.",
        },
        {
          lines: "9-17",
          label: "send the silent frame",
          explanation:
            "Stamp `lastKeepAliveAt`, then send the silent frame as the same base64 `audio/wav` JSON and log it. If the socket raced closed, the catch swallows it — the close handler's reconnect covers that case.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The end of the heartbeat — the zombie-socket check that self-heals a dead-but-open connection — then the handle is returned.",
      code: `      if (deadFired) return;                               // zombie already handled this episode
      if (!inSpeechSegment) return;                        // zombie check only meaningful mid-utterance
      if (ws.readyState !== WebSocket.OPEN) return;        // CONNECTING/CLOSING handled elsewhere
      // Suppress false positives: during genuine send gaps (AMD confirmation phase,
      // pre-greeting window, carrier DTX/stream pauses) we are NOT sending audio and
      // Sarvam is legitimately silent. Only suspect death while actively streaming.
      if (Date.now() - lastAudioSentAt > WS_DEAD_MS) return;
      const silenceMs = Date.now() - lastMsgAt;
      if (silenceMs > WS_DEAD_MS) {
        deadFired = true; // fire-once latch: reset by any inbound message or a fresh socket
        logger.warn(
          { langCode, silenceMs },
          "Sarvam STT: WS silent while streaming audio — terminating zombie socket to force reconnect",
        );
        try { sttObj.onConnectionDead?.(); } catch { /* optional external consumer hook */ }
        // Self-heal: terminate the dead socket so ws.on("close") runs the existing
        // exponential-backoff reconnect (terminate → 1006, which is not an auth code).
        try { ws.terminate(); } catch { try { ws.close(); } catch { /* noop */ } }
      }
    }, HEARTBEAT_MS);

    return sttObj;
  }
}`,
      lines: [
        {
          lines: "1-3",
          label: "zombie-check guards",
          explanation:
            "Skip if the zombie was already handled this episode, if we're not mid-utterance (the check is only meaningful while the caller is speaking), or if the socket isn't OPEN.",
        },
        {
          lines: "4-8",
          label: "suppress false positives",
          explanation:
            "A comment, then: if it's been longer than `WS_DEAD_MS` since we last sent audio, we're in a genuine send gap (AMD, pre-greeting, carrier pause) — Sarvam is legitimately quiet, so don't suspect death. Then measure `silenceMs` since the last inbound message.",
        },
        {
          lines: "9-15",
          label: "declare the socket dead",
          explanation:
            "If silence exceeds `WS_DEAD_MS` (3 s) while actively streaming, latch `deadFired`, log the zombie, and fire the optional `onConnectionDead` hook.",
        },
        {
          lines: "16-24",
          label: "terminate + return the handle",
          explanation:
            "Self-heal by terminating the dead socket (which triggers a 1006 close → the backoff reconnect). The `}, HEARTBEAT_MS)` closes the interval (runs every 300 ms), a blank line, `return sttObj`, and the two closing braces end `transcribeStream` and the `SarvamSTT` class.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Heartbeats and zombie sockets keep the call alive",
      body: [
        "Two silent-failure modes are handled here. First, Sarvam idle-closes after ~60 s with no audio; during a long agent reply the pipeline sends nothing, so a 15 s keep-alive frame keeps the pipe open.",
        "Second, a socket can go **zombie** — `readyState` says OPEN but no messages flow and no close event ever fires. The heartbeat detects >3 s of silence *while actively streaming caller audio* and terminates the socket, which forces the backoff reconnect. The `lastAudioSentAt` guard stops false alarms during genuine send gaps.",
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "The whole file exists to serve one live exchange: caller audio in, clean finished sentences out, as fast as safely possible.",
        "Only two streaming models are valid — `saaras:v3` and `saarika:v2.5`; anything else is forced to `saaras:v3` to avoid a reconnect loop.",
        "Every audio message is base64 JSON with `encoding` forced to `\"audio/wav\"`, while the real codec `pcm_s16le` is set in the URL.",
        "Fragment coalescing plus `looksIncomplete()` let a caller finish a thought; the hold window self-tunes to their pause rhythm.",
        "`normaliseLang()` maps and validates every language hint, falling back to `en-IN`, and avoids forwarding Sarvam's echoed init-language so script detection still works.",
        "A 15 s keep-alive stops idle closes, and a >3 s silence check while streaming terminates zombie sockets so the backoff reconnect can heal the call.",
        "Close codes drive recovery: 1000 is intentional, 1001/1006/1011 reconnect with backoff, and 4xxx (auth/quota) must NOT retry.",
      ],
    },
  ],
};
