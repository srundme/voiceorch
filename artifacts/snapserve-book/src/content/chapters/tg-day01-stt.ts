import type { Chapter } from "../types";

export const teachDay01Stt: Chapter = {
  slug: "teach-day01-stt",
  moduleId: "tg",
  number: "Day 1",
  title: "Day 01 — Voice AI Basics + STT (Sarvam)",
  summary:
    "A teacher's script for the founder: run a 2-hour class that takes 4 interns from 'what is sound?' to reading every line of the real Sarvam speech-to-text file.",
  estMinutes: 90,
  fileRef: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
  prerequisites: [],
  status: "published",
  blocks: [
    // ─────────────────────────────────────────────────────────────────────
    // 1. HOW TO RUN TODAY'S CLASS
    // ─────────────────────────────────────────────────────────────────────
    {
      kind: "prose",
      heading: "Read this first (this page is for YOU, the founder)",
      paragraphs: [
        "You do not need to know how to code to teach this class. This chapter is your **script**. Everywhere you see **Teacher says:** you can read the words out loud, almost exactly as written, and your 4 interns will follow along.",
        "The single question we keep asking today is: **\"How does this help the phone call?\"** Every part of the code exists so that a customer can call a phone number, speak, and be understood. If an intern ever looks lost, bring them back to that one question.",
        "Speak slowly. Most of the class is in simple English so that everyone — including anyone whose first language is not English — can follow. When a word is new, write it on the whiteboard.",
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Two golden teaching habits for today",
      body: [
        "**Ask before you tell.** Before you explain a new idea, ask the class to guess. Example: \"A phone call is just sound. How do you think a computer stores sound?\" Let them try. Wrong guesses are good — they make the right answer stick.",
        "**Draw on the whiteboard.** Every diagram in this chapter should also be drawn by hand, live, with your interns watching the arrows appear one by one. People remember what they watched being drawn far better than a finished picture.",
      ],
    },
    {
      kind: "concept",
      title: "Today's 2-hour agenda (keep this on screen)",
      body: [
        "**0:00–0:20 — Intro (20 min).** Welcome, why voice AI matters for SnapServe, and the one question we keep asking: \"How does this help the phone call?\" Do a round of introductions.",
        "**0:20–0:50 — Basics (30 min).** What sound is, how a computer stores it (sampling, 8kHz phone audio, PCM bytes), what speech-to-text does, and why we transcribe word-by-word (streaming) instead of waiting for the whole sentence.",
        "**0:50–1:05 — The adapter contract (15 min).** Show the real interface that every speech vendor must obey. Explain why one shared contract lets us swap Sarvam, Deepgram, Azure, and others without rewriting the rest of the app.",
        "**1:05–1:50 — Sarvam file walkthrough (45 min).** Read the real `sarvam.ts` file top to bottom, block by block. This is the heart of the class.",
        "**1:50–2:00 — Q&A + quiz (10 min).** Ask the class the quiz questions at the end, hand out homework.",
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Teacher says (opening line)",
      body: [
        "\"Today we learn how a computer listens. When a customer calls SnapServe, they speak — and somewhere in our code a program turns their voice into text so the AI can read it and reply. By the end of today, you will have read the exact file that does this for Indian languages, line by line. Nothing today is magic. It is all just code that we can read together.\"",
      ],
    },

    // ─────────────────────────────────────────────────────────────────────
    // 2. BASICS
    // ─────────────────────────────────────────────────────────────────────
    {
      kind: "prose",
      heading: "Basics — how a computer listens (30 min)",
      paragraphs: [
        "Before we open any code, the interns need four small ideas: **what sound is**, **how a computer stores sound**, **what speech-to-text does**, and **why we do it word-by-word**. Teach these in order — each one builds on the last.",
      ],
    },
    {
      kind: "concept",
      title: "1) What sound is",
      body: [
        "Sound is just **air wobbling**. When you speak, your voice pushes the air back and forth very fast. A microphone feels those wobbles and turns them into a wiggly electrical signal — a wave that goes up and down.",
        "**Teacher says:** \"Say the word 'hello' and imagine the air in front of your mouth shaking. A microphone feels that shaking. So far there is no computer involved — just a wiggle.\"",
      ],
    },
    {
      kind: "concept",
      title: "2) Sampling — turning a wiggle into numbers",
      body: [
        "A computer cannot store a smooth wiggle. So it measures the height of the wave many thousands of times per second and writes down each measurement as a number. Each measurement is called a **sample**. Doing this is called **sampling**.",
        "**8kHz** means the computer takes **8,000 samples every second**. That is the quality of a normal phone call — narrow and a little muffled, but enough to understand words. A music CD uses about 44,000 samples per second, which is why music sounds richer than a phone call.",
        "**Teacher says:** \"A phone line gives us 8,000 little numbers every second. That is our raw material. It is not perfect quality — it is 'phone quality' — but it is enough to hear the words.\"",
      ],
    },
    {
      kind: "concept",
      title: "3) PCM bytes — how those numbers are packed",
      body: [
        "Those measured numbers, stored back-to-back, are called **PCM** (that just means 'the raw sound numbers'). Each number is packed into a small amount of computer memory called **bytes**. In our system each sample is 16 bits, which is 2 bytes.",
        "So a stream of PCM is simply: number, number, number, thousands per second, packed as bytes. There is no 'file', no header, no music — just the raw wave written as numbers. Later you will see the code call this `pcm_s16le` (PCM, signed 16-bit, little-endian). Do not worry about the fancy name — it just means 'our raw sound numbers'.",
      ],
    },
    {
      kind: "concept",
      title: "4) What speech-to-text (STT) does",
      body: [
        "Speech-to-text, or **STT**, is a program that takes those sound numbers and gives back **words as text**. In: raw sound. Out: \"I want to book an appointment.\"",
        "We do not build the STT ourselves. Clever companies (Sarvam, Deepgram, Azure, Google) have trained huge models to do it. We just **send them the sound and read back the text**. Sarvam is the one we use for Indian languages like Tamil, Hindi, and Telugu.",
        "**Teacher says:** \"STT is the ear of our AI. The AI brain can be brilliant, but if the ear hears the wrong words, the brain answers the wrong question. So getting STT right is the whole game.\"",
      ],
    },
    {
      kind: "analogy",
      title: "STT is a court stenographer, not a typist you mail a tape to",
      body: [
        "Imagine two ways to get a meeting written down. One: you record the whole meeting, mail the tape to a typist, and get a document back next week. That is slow — it is 'wait for the whole thing, then type'.",
        "Two: a **court stenographer** sits in the room and types every word the instant it is spoken. You can watch the words appear live on their screen while people are still talking.",
        "Our STT is the stenographer. Sound flows in continuously, and words come out continuously — we do not wait for the caller to finish and hang up. This live, word-by-word way of working is called **streaming**.",
      ],
    },
    {
      kind: "callout",
      variant: "why",
      title: "Why streaming beats waiting for the whole sentence (say this on a call)",
      body: [
        "On a real phone call the customer expects a reply almost immediately after they pause. If we waited until the whole sentence was finished before we even started transcribing, the customer would sit in silence far too long and think the line is dead.",
        "Streaming lets us start understanding the very first words while the caller is still talking. By the time they stop, we are almost done — so the AI can reply fast and the call feels natural, like talking to a person.",
        "**Teacher says:** \"Speed is the whole point. A slow-but-perfect transcript is useless on a live call. We need words as they speak them.\"",
      ],
    },
    {
      kind: "connections",
      title: "The journey of one spoken word (draw this on the whiteboard)",
      intro:
        "Walk the class along this line left to right. Draw one box, one arrow, then the next box. Ask: \"Where in this chain do you think today's file lives?\" (Answer: the STT adapter box.)",
      nodes: [
        { id: "caller", label: "Caller's phone", sublabel: "speaks — air wobbles" },
        { id: "carrier", label: "Phone carrier", sublabel: "sends 8kHz audio" },
        { id: "vobiz", label: "VoBiz WebSocket", sublabel: "audio enters our system" },
        { id: "pipeline", label: "Pipeline", sublabel: "orchestrates the call" },
        { id: "stt", label: "STT adapter", sublabel: "sarvam.ts — TODAY'S FILE", current: true, chapterSlug: "d1-sarvam-stt-complete" },
        { id: "transcript", label: "Transcript", sublabel: "words as text" },
        { id: "llm", label: "LLM", sublabel: "the AI brain reads + replies" },
      ],
      edges: [
        { from: "caller", to: "carrier", label: "voice" },
        { from: "carrier", to: "vobiz", label: "8kHz audio" },
        { from: "vobiz", to: "pipeline", label: "audio bytes" },
        { from: "pipeline", to: "stt", label: "sendAudio()" },
        { from: "stt", to: "transcript", label: "onTranscript()" },
        { from: "transcript", to: "llm", label: "the words" },
      ],
    },

    // ─────────────────────────────────────────────────────────────────────
    // 3. THE STT ADAPTER CONTRACT
    // ─────────────────────────────────────────────────────────────────────
    {
      kind: "prose",
      heading: "The STT adapter contract (15 min)",
      paragraphs: [
        "An **adapter** is a small piece of code that lets our app talk to one outside company. A **contract** is a written promise about exactly what an adapter must accept and what it must give back. If every speech vendor's adapter obeys the same contract, our app never has to care which vendor is behind it.",
        "Below is the real contract, from the file `base.ts`. It is short — two promises. Read it slowly with the class.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/base.ts",
      language: "typescript",
      intro:
        "Teacher says: \"This is the contract EVERY speech vendor must sign — Sarvam, Deepgram, Azure, all of them. It lists what the adapter must be able to do. It's only two things.\"",
      code: `export interface STTAdapter {
  transcribe(audioBuffer: Buffer, sampleRate?: number): Promise<string>;
  transcribeStream?(
    onTranscript: (text: string, isFinal: boolean, detectedLanguage?: string, metadata?: SttFinalMetadata) => void,
    onClose?: () => void,
  ): StreamSTT;
}`,
      lines: [
        {
          lines: "2",
          label: "transcribe(...) — the batch way",
          explanation:
            "The first promise: give me a whole chunk of sound (`audioBuffer`) and I will give back the full text. This is the slow 'mail the tape, get a document' way — good for recordings, not for live calls. `Promise<string>` just means \"the text will arrive a little later\".",
        },
        {
          lines: "3-6",
          label: "transcribeStream(...) — the live way",
          explanation:
            "The second promise, and the one we use on live calls. Instead of returning text at the end, the vendor calls the function we hand it — `onTranscript` — again and again, once for every piece of words it recognises. The `?` after the name means this one is optional, but our streaming vendors all provide it.",
        },
        {
          lines: "4",
          label: "onTranscript(text, isFinal, detectedLanguage, metadata)",
          explanation:
            "This is the phone-call heartbeat. `text` is the words heard. `isFinal` tells us if these words are polished-and-final (`true`) or a rough live guess that might still change (`false`). `detectedLanguage` says which language it heard. `metadata` carries extra notes we'll meet later. **Every vendor promises to call this the same way** — that's the magic.",
        },
        {
          lines: "5",
          label: "onClose",
          explanation:
            "A function the vendor calls if the connection ends, so our app knows to clean up. On a call this is how we notice \"the ear went offline\".",
        },
      ],
    },
    {
      kind: "callout",
      variant: "why",
      title: "Why one contract lets us swap vendors (the big idea)",
      body: [
        "Because Sarvam, Deepgram, and Azure all sign the SAME contract — same `sendAudio()` in, same `onTranscript()` out — the rest of our app talks to them in exactly one way. If Sarvam has an outage, we can switch a call to Deepgram and **nothing else in the code has to change**. All the vendor's weird private rules stay locked inside its own adapter file.",
        "**Teacher says:** \"Think of a wall plug. Any lamp, any charger — as long as the plug shape matches the socket, it works. The contract is the plug shape. Vendors are the different devices. Our app is the wall.\"",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/types.ts",
      language: "typescript",
      intro:
        "Teacher says: \"When streaming starts, the vendor hands us back this little control panel — a StreamSTT. These are the buttons WE press to feed it audio and shut it down.\"",
      code: `export interface StreamSTT {
  sendAudio(chunk: Buffer): void;
  flush?(): void;
  setLanguage?(lang: string): void;
  close(): void;
  onConnectionDead?: (() => void) | null;
  onSpeechStart?: (() => void) | null;
  onSpeechEnd?: (() => void) | null;
  getPendingTranscript?: () => string;
}`,
      lines: [
        {
          lines: "2",
          label: "sendAudio(chunk)",
          explanation:
            "We call this over and over, handing over one small piece of sound each time. This is us feeding the ear. On the call, every 8,000-numbers-per-second chunk flows through here.",
        },
        {
          lines: "3-4",
          label: "flush + setLanguage (optional)",
          explanation:
            "`flush` says \"finish up now, don't wait\". `setLanguage` lets us switch the language mid-call — e.g. the caller says \"can we speak in Tamil?\" and we retune the ear live. The `?` means a vendor may skip these if it can't do them.",
        },
        {
          lines: "5",
          label: "close()",
          explanation:
            "When the call ends we press this to hang up the connection cleanly. Skipping it would leak connections — with thousands of calls a day, that would pile up and crash things.",
        },
        {
          lines: "6-8",
          label: "onConnectionDead / onSpeechStart / onSpeechEnd",
          explanation:
            "These are little alarms the vendor rings for us. `onSpeechStart` = the caller just began talking. `onSpeechEnd` = they just stopped. `onConnectionDead` = the connection silently died and we should fall back fast. They help the pipeline react at exactly the right moment.",
        },
      ],
    },

    // ─────────────────────────────────────────────────────────────────────
    // 4. SARVAM FILE WALKTHROUGH — EVERY LINE
    // ─────────────────────────────────────────────────────────────────────
    {
      kind: "prose",
      heading: "The Sarvam file, line by line (45 min)",
      paragraphs: [
        "This is the main event. We now read the real `sarvam.ts` file top to bottom. Sarvam is the vendor that understands Indian languages — Tamil, Hindi, Telugu, and 9+ more. Its adapter obeys the contract we just read, but inside it has a lot of hard-won tricks. We'll cover the whole file in chunks.",
        "**Teacher says:** \"Take a breath. This looks long, but it is just the contract we already know, plus a lot of small careful notes written by people who got burned. Every comment in here is a scar. We'll read them together.\"",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The file opens with a cheat-sheet comment — the rules of Sarvam's connection. Teacher says: \"Before any code, someone wrote down the traps. Line 27 is the most important sentence in this whole file.\"",
      code: ` * ── Audio message (JSON text, sent as each PCM chunk arrives) ────────────────
 *   { audio: { data: "<base64 raw PCM>", encoding: "audio/wav", sample_rate: 16000 } }
 *   NOTE: encoding enum MUST be "audio/wav" — "pcm_s16le" is rejected by Sarvam's
 *   Pydantic model even though the URL param \`input_audio_codec=pcm_s16le\` sets
 *   the actual codec. Confirmed via live WebSocket probe (June 2026).
 *
 * ── Close codes ──────────────────────────────────────────────────────────────
 *   1000 Normal closure (intentional)
 *   1001 Going away        — reconnect
 *   1006 Abnormal (no close frame) — reconnect with backoff
 *   1011 Server error      — reconnect with backoff
 *   4xxx Auth / quota      — do NOT retry; fix first`,
      lines: [
        {
          lines: "1-2",
          label: "how we send sound to Sarvam",
          explanation:
            "Sarvam does not want raw bytes. It wants each chunk wrapped in a little JSON message, with the sound written as `base64` text. `base64` just means \"turn the raw numbers into safe-to-send letters\". Different vendor, different wrapping — that's why we hide it inside this file.",
        },
        {
          lines: "3-5",
          label: "the 'audio/wav' trap (READ THIS ALOUD)",
          explanation:
            "The `encoding` label MUST say `\"audio/wav\"` even though the sound is actually raw PCM. Writing the technically-correct `\"pcm_s16le\"` makes Sarvam reject it. Someone found this by testing the live connection and wrote it down so nobody wastes hours again. **How it helps the call:** get this wrong and the caller is never heard.",
        },
        {
          lines: "7-12",
          label: "close-code playbook",
          explanation:
            "When a connection ends it gives a number. This table is the recovery plan: 1006/1011 mean 'it broke, try again after a wait'. But 4xxx means 'your key or your quota is wrong' — retrying is pointless and just burns money, so the adapter does NOT retry those.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The imports and a couple of small helpers. Teacher says: \"This section says which tools this file borrows, and defines one cleaner.\"",
      code: `import { WebSocket } from "ws";
import { pcmToWav } from "../../audio.js";
import type { STTAdapter, SttFinalMetadata } from "./base.js";
import type { STTConfig, StreamSTT } from "../../types.js";
import { logger } from "../../../lib/logger.js";
import { resolveSarvamSttMode, type SarvamSttMode } from "./sarvam-mode.js";

export { resolveSarvamSttMode } from "./sarvam-mode.js";

function stripDiarizationLabels(text: string): string {
  return text.replace(/(^|\\n)\\s*speaker\\s*\\d*\\s*:\\s*/gi, "$1").trim();
}`,
      lines: [
        {
          lines: "1-6",
          label: "borrowed tools",
          explanation:
            "`WebSocket` is the always-open two-way pipe we use for live calls. `pcmToWav` wraps raw sound. `STTAdapter` and `StreamSTT` are the contract we read earlier. `logger` writes notes so we can debug a call afterwards. Point out line 3: this file promises to obey `STTAdapter`.",
        },
        {
          lines: "10-12",
          label: "stripDiarizationLabels",
          explanation:
            "Sometimes Sarvam prefixes text with \"Speaker 1:\". We don't want that noise reaching the AI, so this cleaner removes it. **How it helps the call:** keeps the transcript clean so the AI reads what was actually said, not label junk.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Constants: the addresses and the list of models that actually work. Teacher says: \"These next lines pin down the ONLY valid models — a real trap lives here.\"",
      code: `const BATCH_URL = "https://api.sarvam.ai/speech-to-text";
const WS_BASE   = "wss://api.sarvam.ai/speech-to-text/ws";

/** Only saaras:v3 supports the \`mode\` parameter. */
const MODE_CAPABLE = new Set(["saaras:v3"]);`,
      lines: [
        {
          lines: "1-2",
          label: "the two addresses",
          explanation:
            "`BATCH_URL` is where we send a whole recording (the slow way). `WS_BASE` starting with `wss://` is the live streaming pipe (the fast way we use on calls).",
        },
        {
          lines: "4-5",
          label: "which model supports 'mode'",
          explanation:
            "Sarvam has two brains. Only the newer `saaras:v3` understands the extra `mode` setting (like transcribe vs translate). This set remembers that so we don't ask the older model to do something it can't.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Only two streaming models are valid: saarika:v2.5 and saaras:v3",
      body: [
        "The live streaming connection accepts **only** `saaras:v3` (the recommended one) or `saarika:v2.5` (the older one). Anything else — even a plausible-looking name like `saaras:v2.5` — will be rejected and the connection dies in a retry loop.",
        "That is why the constructor (below) forces any unknown model back to `saaras:v3`. **How it helps the call:** a wrong stored model name could otherwise crash every single call before the caller says a word.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Language normalisation. Teacher says: \"Sarvam is fussy about how you name a language. This function turns whatever we have into a name Sarvam accepts, and falls back to English if it truly can't.\"",
      code: `function normaliseLang(code: string | null | undefined, model: string): string {
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
}`,
      lines: [
        {
          lines: "2",
          label: "no language given → English-India",
          explanation:
            "If nobody told us the language, default to `en-IN` (English, India). A sensible safe start.",
        },
        {
          lines: "3-5",
          label: "which languages this model can do",
          explanation:
            "The older `saarika` model knows 11 languages; the newer `saaras` knows 23. This checker makes sure we only ask a model for a language it actually supports.",
        },
        {
          lines: "8-10",
          label: "try to fix a messy code",
          explanation:
            "If we get a short code like `ta` instead of `ta-IN`, we look it up and convert it to the full name Sarvam expects. **How it helps the call:** a Tamil caller gets Tamil transcription instead of a silent failure.",
        },
        {
          lines: "11-12",
          label: "give up safely to English",
          explanation:
            "If nothing matches, we log a warning and fall back to English rather than crashing. Better a slightly-wrong language than a dead call.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The class begins, and its constructor picks the model. Teacher says: \"This is where the trap from earlier is actually defended against — watch lines 5 to 9.\"",
      code: `export class SarvamSTT implements STTAdapter {
  constructor(
    apiKey: string,
    model: string | null,
    extraConfig: string | null,
    cfg: STTConfig,
  ) {
    this.key = apiKey;
    this.cfg = cfg;
    this.sampleRate = cfg.nativeSampleRate === 8000 ? 8000 : 16000;

    const requested = (model ?? "").trim();
    this.model = ["saaras:v3", "saarika:v2.5"].includes(requested)
      ? requested
      : "saaras:v3";

    this.langCode = normaliseLang(cfg.language, this.model);
  }`,
      lines: [
        {
          lines: "1",
          label: "implements STTAdapter",
          explanation:
            "This word `implements STTAdapter` is the class formally signing the contract. It promises the compiler: I provide `transcribe` and `transcribeStream`, exactly as agreed.",
        },
        {
          lines: "10",
          label: "8kHz for phone, 16kHz for web",
          explanation:
            "Phone audio is 8,000 samples per second; a web-call microphone is 16,000. We keep phone audio at its real rate instead of faking extra samples, which keeps recognition cleaner on already-lossy phone lines.",
        },
        {
          lines: "12-15",
          label: "force a valid model (the defence)",
          explanation:
            "Here is the guard. If the requested model isn't one of the two valid streaming names, we quietly replace it with `saaras:v3`. **How it helps the call:** a stale or wrong model in the database can never crash a call — it self-corrects.",
        },
        {
          lines: "17",
          label: "normalise the language",
          explanation:
            "We run the caller's language through the fixer we just read, so the connection opens with a name Sarvam accepts.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The batch method — the slow 'whole recording' path. Teacher says: \"We rarely use this on a live call, but it shows the simplest shape: send everything, get text back.\"",
      code: `  async transcribe(audioBuffer: Buffer, sampleRate = this.sampleRate): Promise<string> {
    const wav = pcmToWav(audioBuffer, sampleRate);

    const formData = new FormData();
    const wavBuf = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
    formData.append("file", new Blob([wavBuf], { type: "audio/wav" }), "audio.wav");
    formData.append("model", this.model === "saaras:v3" ? "saaras:v3" : "saarika:v2.5");
    formData.append("language_code", this.langCode);

    const resp = await fetch(BATCH_URL, {
      method: "POST",
      headers: { "api-subscription-key": this.key },
      body: formData,
    });

    const json = (await resp.json()) as { transcript?: string };
    return stripDiarizationLabels(json.transcript ?? "");
  }`,
      lines: [
        {
          lines: "2",
          label: "wrap raw sound in WAV",
          explanation:
            "`pcmToWav` puts a small header on the raw numbers so it becomes a proper `.wav` file Sarvam accepts. **How it helps the call:** without this wrapping, the caller's audio would be gibberish to Sarvam.",
        },
        {
          lines: "10-14",
          label: "send it and wait",
          explanation:
            "We POST the whole file with our secret key in the `api-subscription-key` header, then wait for the reply. This is the 'mail the tape' pattern — fine for a recording, too slow for live.",
        },
        {
          lines: "16-17",
          label: "read the text back, cleaned",
          explanation:
            "We take the transcript out of the reply and run our label-cleaner over it before returning it.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Now the live streaming method starts — the one used on real calls. First it builds the connection address. Teacher says: \"This URL IS the settings. Every rule we chose rides in the web address.\"",
      code: `  transcribeStream(
    onTranscript: (
      text: string,
      isFinal: boolean,
      detectedLanguage?: string,
      metadata?: SttFinalMetadata,
    ) => void,
    onClose?: () => void,
  ): StreamSTT {
    let   langCode   = this.langCode;
    let   mode       = this.mode;
    const model      = this.model;
    const key        = this.key;
    const sampleRate = this.sampleRate;

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
    };`,
      lines: [
        {
          lines: "1-9",
          label: "the streaming entry point",
          explanation:
            "This is the contract's `transcribeStream`. The caller hands us `onTranscript` — the function Sarvam will call every time it hears words. We return a control panel (`StreamSTT`) at the end.",
        },
        {
          lines: "10-14",
          label: "copy settings into local boxes",
          explanation:
            "We copy the language, model, key, etc. into local variables so the helper functions below can use them freely. `langCode` is a `let` (not fixed) because the caller can switch language mid-call.",
        },
        {
          lines: "18-24",
          label: "the settings ride in the URL",
          explanation:
            "The web address carries every choice: which model, which language, the sample rate, and `vad_signals: true` which asks Sarvam to tell us when speech starts and stops. **How it helps the call:** these signals let us react the instant the caller stops talking.",
        },
        {
          lines: "25-27",
          label: "add 'mode' only if supported",
          explanation:
            "Only `saaras:v3` understands `mode`, so we add it only for that model — respecting the capability set from earlier.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "How each chunk of caller audio is actually sent. Teacher says: \"This is the exact moment the caller's voice leaves our building and reaches Sarvam. Line 8 is our earlier trap in action.\"",
      code: `    const sendChunk = (chunk: Buffer) => {
      if (!wsReady || ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
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
    };`,
      lines: [
        {
          lines: "2",
          label: "only send if the pipe is open",
          explanation:
            "If the connection isn't ready yet, we don't try to send — that would throw an error. (Chunks that arrive too early get queued; we'll see that below.)",
        },
        {
          lines: "6-12",
          label: "wrap the sound as JSON + base64",
          explanation:
            "We turn the raw sound into base64 text and wrap it in the little JSON message Sarvam wants. Notice `encoding: \"audio/wav\"` — the exact trap from the top of the file. **How it helps the call:** this line is literally the caller being heard.",
        },
        {
          lines: "14",
          label: "record that we just sent",
          explanation:
            "We remember the time we last sent audio. Later, a watchdog uses this to tell 'the caller is silent' apart from 'the connection secretly died'.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Opening the socket and flushing early audio. Teacher says: \"Opening a connection takes a moment. Any audio that arrives during that moment must not be lost — line 18 rescues it.\"",
      code: `    const openSocket = () => {
      if (intentionallyClosed) return;
      wsReady = false;

      ws = new WebSocket(buildWsUrl(), {
        headers: { "api-subscription-key": key },
      });

      ws.on("open", () => {
        wsReady = true;
        reconnectAttempts = 0;
        inSpeechSegment   = false;
        speechEndReceived = false;
        logger.info(
          { langCode, model, mode },
          "Sarvam streaming STT: WebSocket opened",
        );
        // Flush any audio that arrived before the socket was ready.
        for (const chunk of audioQueue.splice(0)) sendChunk(chunk);
      });`,
      lines: [
        {
          lines: "5-7",
          label: "open the pipe with our key",
          explanation:
            "We open the WebSocket to Sarvam's address, sending our secret key in a header (not in the URL — URLs get logged, headers usually don't). This is the ear picking up the phone.",
        },
        {
          lines: "9-13",
          label: "when it opens, reset state",
          explanation:
            "The `open` handler runs once the pipe is ready. We mark it ready and reset our counters for a clean fresh start.",
        },
        {
          lines: "18-19",
          label: "replay the queued audio",
          explanation:
            "Audio that arrived before the pipe was open was saved in `audioQueue`. The moment we connect, we send it all. **How it helps the call:** the caller's first words are never lost to connection lag.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The message handler — every reply from Sarvam lands here. First, the speech-start and speech-end signals. Teacher says: \"Sarvam tells us when the caller starts and stops. This is how we know a turn is over.\"",
      code: `      ws.on("message", (raw: Buffer | string) => {
        let msg: SarvamMsg;
        try {
          msg = JSON.parse(raw.toString()) as SarvamMsg;
        } catch {
          return; // ignore non-JSON frames
        }

        lastMsgAt = Date.now();
        deadFired = false; // any inbound frame proves the socket is alive

        if (msg.type === "speech_start" || (msg.type === "events" && msg.data?.signal_type === "START_SPEECH")) {
          inSpeechSegment    = true;
          speechEndReceived  = false; // caller is speaking again
          _onSpeechStart?.();
          return;
        }
        if (msg.type === "speech_end" || (msg.type === "events" && msg.data?.signal_type === "END_SPEECH")) {
          inSpeechSegment   = false;
          speechEndReceived = true;
          _onSpeechEnd?.();
          return;
        }`,
      lines: [
        {
          lines: "1-7",
          label: "read the reply safely",
          explanation:
            "Every reply from Sarvam is text we turn into an object. If a reply isn't valid, we quietly ignore it rather than crash — a call must never die from one bad message.",
        },
        {
          lines: "9-10",
          label: "\"the connection is alive\"",
          explanation:
            "Any reply proves the pipe is healthy, so we note the time and clear the 'dead?' flag. This feeds the watchdog we'll meet at the end.",
        },
        {
          lines: "12-16",
          label: "speech_start — caller began talking",
          explanation:
            "When Sarvam's voice detector hears the caller start, we flip `inSpeechSegment` on and ring the `onSpeechStart` alarm so the pipeline knows a new turn began.",
        },
        {
          lines: "18-22",
          label: "speech_end — caller stopped",
          explanation:
            "When the caller stops, we ring `onSpeechEnd`. This is the pipeline's early warning to get ready to reply, even before the final words are polished.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Still in the message handler: the actual transcript arrives. Teacher says: \"Here are the words. But we don't rush them out — we may WAIT a tiny bit in case the caller is mid-sentence. That waiting is called coalescing.\"",
      code: `        if (msg.type === "transcript" || msg.type === "data") {
          inSpeechSegment = false; // segment complete
          const text = stripDiarizationLabels(msg.data?.transcript ?? "");
          const reportedLang = msg.data?.language_code;
          if (reportedLang && reportedLang !== langCode) {
            coalesceLang = reportedLang;
          }
          if (!text) return;

          coalesceBuf            = coalesceBuf ? coalesceBuf + " " + text : text;
          coalesceMergedSegments++;
          transcriptArrivedAt    = Date.now();

          if (coalesceTimer) clearTimeout(coalesceTimer);
          const incomplete = looksIncomplete(coalesceBuf);
          const holdMs = speechEndReceived
            ? SPEECH_END_FLUSH_MS
            : (incomplete ? COALESCE_INCOMPLETE_MS : SPEECH_END_FLUSH_MS);
          coalesceTimer = setTimeout(emitCoalesced, holdMs);
          emitPartial();
          return;
        }`,
      lines: [
        {
          lines: "3",
          label: "clean the words",
          explanation:
            "The words come out and we strip any 'Speaker 1:' junk immediately.",
        },
        {
          lines: "4-7",
          label: "note the detected language",
          explanation:
            "If Sarvam heard a different language than we set up with, we remember it — but only if it's actually different, to avoid a false echo. This keeps the reply in the right script.",
        },
        {
          lines: "10-12",
          label: "add to the buffer (coalescing)",
          explanation:
            "Instead of firing every scrap of text, we glue new words onto a buffer. Callers often pause mid-sentence (\"I want... to book\"). Gluing pieces together gives the AI one clean sentence, not three fragments.",
        },
        {
          lines: "14-18",
          label: "wait a smart little bit",
          explanation:
            "We set a short timer before releasing the text. If `looksIncomplete` thinks the caller is mid-thought, we wait a bit longer (`COALESCE_INCOMPLETE_MS`) to let them finish. **How it helps the call:** the AI answers the whole question, not half of it.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "looksIncomplete + fragment coalescing — the cleverest part",
      body: [
        "`looksIncomplete()` is a big function that checks if the transcript ends in a way that means \"more is coming\" — an English word like \"and\" or \"but\", a Tamil connector like \"போய்\", a Hindi case marker, a question word, or a verb that needs an object like \"I want\". If so, the adapter holds a little longer before sending the words to the AI.",
        "It also has the opposite list: complete single words like \"yes\", \"சரி\", \"हाँ\" get sent out **immediately** so a simple \"yes\" doesn't wait around.",
        "**How it helps the call:** without this, a caller saying \"I want... (pause) ...to know the price\" would get chopped into two half-questions and confuse the AI. Coalescing stitches it into one clear sentence.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "When the timer fires, the finished sentence is finally released. Teacher says: \"THIS is the moment the words reach the AI brain, marked as final.\"",
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
      coalesceMergedSegments = 0;
      onTranscript(text, true, lang, meta);
    };`,
      lines: [
        {
          lines: "3",
          label: "nothing buffered? do nothing",
          explanation:
            "If there are no words waiting, we stop. Safe to call anytime.",
        },
        {
          lines: "7-11",
          label: "attach notes",
          explanation:
            "We attach `metadata` — like how many pieces we glued together. This helps us later measure and debug call quality.",
        },
        {
          lines: "14",
          label: "onTranscript(text, true, ...) — the final!",
          explanation:
            "This is the payoff. We call the contract's `onTranscript` with `isFinal = true`. That `true` tells the pipeline: these words are committed, send them to the AI. **This single line is why the whole file exists.**",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The control panel we hand back — the buttons the pipeline presses. Teacher says: \"Remember the StreamSTT contract? Here Sarvam actually builds it. sendAudio and close are the two must-haves.\"",
      code: `      sendAudio(chunk: Buffer): void {
        if (!wsReady || ws.readyState !== WebSocket.OPEN) {
          audioQueue.push(chunk);
          let total = audioQueue.reduce((a, b) => a + b.length, 0);
          if (total > MAX_QUEUE_BYTES) {
            while (total > MAX_QUEUE_BYTES && audioQueue.length > 1) {
              const len = audioQueue.shift()!.length;
              total    -= len;
            }
          }
        } else {
          sendChunk(chunk);
        }
      },`,
      lines: [
        {
          lines: "1",
          label: "sendAudio — the pipeline feeds us here",
          explanation:
            "The pipeline calls this with every small piece of the caller's voice. This is the front door for audio.",
        },
        {
          lines: "2-3",
          label: "not ready yet? queue it",
          explanation:
            "If the pipe isn't open, we stash the chunk in `audioQueue` — the same queue the `open` handler drains. No first words lost.",
        },
        {
          lines: "4-10",
          label: "don't let the queue grow forever",
          explanation:
            "If the connection stays down, we cap the queue at about 2 seconds of audio and drop the oldest. **How it helps the call:** on reconnect we don't flood Sarvam with stale audio and produce ghost transcripts.",
        },
        {
          lines: "11-12",
          label: "ready? send now",
          explanation:
            "If the pipe is open, send immediately via `sendChunk`.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Two more control-panel buttons: switching language live, and closing cleanly. Teacher says: \"setLanguage is how we retune the ear mid-call; close is how we hang up without leaking.\"",
      code: `      setLanguage(lang: string): void {
        const next = normaliseLang(lang, model);
        if (next === langCode) return;           // already on it — no-op
        if (intentionallyClosed) return;         // stream already torn down
        langCode = next;
        mode = resolveSarvamSttMode(langCode, explicitMode);
        if (coalesceTimer) { clearTimeout(coalesceTimer); emitCoalesced(); }
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          switchingLanguage = true;              // close handler reopens with new langCode
          try { ws.close(1000); } catch {
            switchingLanguage = false;
            openSocket();
          }
        }
      },
      close(): void {
        if (coalesceTimer) { clearTimeout(coalesceTimer); emitCoalesced(); }
        intentionallyClosed = true;
        clearInterval(heartbeatInterval);
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000);
        }
      },`,
      lines: [
        {
          lines: "1-6",
          label: "setLanguage — retune mid-call",
          explanation:
            "If the caller asks to switch language, we normalise the new one, and if it's genuinely different we prepare to reconnect with the new language hint. **How it helps the call:** a caller can start in English and switch to Tamil, and the ear follows.",
        },
        {
          lines: "7",
          label: "don't lose held words on switch",
          explanation:
            "Before switching, we release any words still held in the buffer so nothing said in the old language is lost.",
        },
        {
          lines: "16-22",
          label: "close — clean hang-up",
          explanation:
            "On call end we release any last words, stop the watchdog timer (`clearInterval`), and close the pipe with a normal code (1000). Clean teardown matters: thousands of calls means thousands of connections to not leak.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "The last piece: a heartbeat that keeps the pipe alive and notices if it dies silently. Teacher says: \"A connection can go quiet in two ways — the caller is silent, OR the pipe secretly died. This watchdog tells them apart.\"",
      code: `    const heartbeatInterval = setInterval(() => {
      if (intentionallyClosed) return;                     // torn down
      const nowMs = Date.now();
      if (
        wsReady && ws.readyState === WebSocket.OPEN && !inSpeechSegment &&
        nowMs - lastAudioSentAt > KEEPALIVE_IDLE_MS &&
        nowMs - lastKeepAliveAt > KEEPALIVE_IDLE_MS
      ) {
        lastKeepAliveAt = nowMs;
        ws.send(JSON.stringify({
          audio: {
            data:        KEEPALIVE_FRAME.toString("base64"),
            encoding:    "audio/wav",
            sample_rate: sampleRate,
          },
        }));
      }
      if (deadFired) return;
      if (!inSpeechSegment) return;
      if (Date.now() - lastAudioSentAt > WS_DEAD_MS) return;
      const silenceMs = Date.now() - lastMsgAt;
      if (silenceMs > WS_DEAD_MS) {
        deadFired = true;
        try { sttObj.onConnectionDead?.(); } catch {}
        try { ws.terminate(); } catch { try { ws.close(); } catch {} }
      }
    }, HEARTBEAT_MS);`,
      lines: [
        {
          lines: "4-16",
          label: "keep-alive during silence",
          explanation:
            "Sarvam hangs up after ~60 seconds of nothing. During a long agent reply the caller isn't talking, so we send a tiny near-silent frame to keep the pipe open. **How it helps the call:** the ear doesn't fall asleep during the AI's turn.",
        },
        {
          lines: "18-19",
          label: "only worry while the caller is talking",
          explanation:
            "If the caller isn't currently speaking, silence from Sarvam is normal — so we don't panic. We only suspect death mid-utterance.",
        },
        {
          lines: "20-25",
          label: "the zombie check",
          explanation:
            "If the caller is talking but Sarvam has said nothing for 3 seconds, the pipe is probably a 'zombie' — open but dead. We ring `onConnectionDead` and force a reconnect. **How it helps the call:** we fall back fast instead of leaving the caller talking to a dead ear.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Zoom back out (say this to close the walkthrough)",
      body: [
        "\"Look what we just read. Underneath all the careful notes, this file only does what the contract promised: the pipeline calls `sendAudio()`, and Sarvam calls `onTranscript()` back. Everything else — the WAV trap, the model list, coalescing, the watchdog — is Sarvam's private mess, trapped inside this one file. That is why we could swap Sarvam for Deepgram tomorrow and the rest of SnapServe would not notice.\"",
      ],
    },

    // ─────────────────────────────────────────────────────────────────────
    // 5. QUIZ
    // ─────────────────────────────────────────────────────────────────────
    {
      kind: "quiz",
      questions: [
        {
          prompt:
            "Ask the class: Why do we transcribe word-by-word (streaming) on a live call instead of waiting for the whole sentence?",
          choices: [
            "Because streaming is cheaper.",
            "So we can start understanding while the caller is still talking, keeping the reply fast and the call natural.",
            "Because Sarvam only supports streaming.",
            "To record the call for later.",
          ],
          correctIndex: 1,
          explanation:
            "On a live call the customer expects a quick reply. Streaming lets us understand the first words while they're still speaking, so by the time they pause we're nearly done — the call feels like talking to a person.",
        },
        {
          prompt:
            "In `onTranscript(text, isFinal, ...)`, what does `isFinal` mean?",
          choices: [
            "The phone call has ended.",
            "Whether the words are polished-and-committed (true) or a rough live guess that may still change (false).",
            "Whether the caller spoke loudly enough.",
            "Which language was heard.",
          ],
          correctIndex: 1,
          explanation:
            "`isFinal = true` means the words are committed and safe to send to the AI. `false` means it's an interim guess that might still change. The pipeline only acts on finals.",
        },
        {
          prompt:
            "Sarvam's audio message must say `encoding: \"audio/wav\"` even though the sound is raw PCM. Why is this written in a comment?",
          choices: [
            "It's a typo nobody fixed.",
            "It's a hidden vendor quirk found by live testing — sending the 'correct' value gets rejected, so the comment saves the next person hours.",
            "WAV is always required by all WebSockets.",
            "The comment was auto-generated.",
          ],
          correctIndex: 1,
          explanation:
            "It's an undocumented Sarvam trap confirmed by probing the live connection. Get it wrong and the caller is never heard. Writing traps down in the adapter is how per-vendor pain stays contained.",
        },
        {
          prompt:
            "Which are the ONLY two valid streaming models for Sarvam, and what does the code do with anything else?",
          choices: [
            "saaras:v3 and saarika:v2.5 — anything else is forced to saaras:v3.",
            "Any model name works fine.",
            "saaras:v2.5 and nova-2 — others cause a crash we can't prevent.",
            "Only saarika:v2.5 — the newer one is disabled.",
          ],
          correctIndex: 0,
          explanation:
            "Only `saaras:v3` and `saarika:v2.5` are accepted by the streaming connection. The constructor forces any unknown value to `saaras:v3` so a stale model name can never crash every call.",
        },
        {
          prompt:
            "Why does the adapter sometimes WAIT a little before sending words to the AI (coalescing / looksIncomplete)?",
          choices: [
            "To save money on Sarvam usage.",
            "Because the caller may be mid-sentence — waiting lets us glue fragments into one clean question so the AI answers the whole thing.",
            "To slow the call down on purpose.",
            "Because Sarvam requires a fixed 1-second delay.",
          ],
          correctIndex: 1,
          explanation:
            "Callers pause mid-thought (\"I want... to book\"). `looksIncomplete` detects a dangling phrase and holds a bit longer, stitching pieces into one sentence — while complete words like \"yes\" go out immediately.",
        },
      ],
    },

    // ─────────────────────────────────────────────────────────────────────
    // 6. HOMEWORK / KEY TAKEAWAYS
    // ─────────────────────────────────────────────────────────────────────
    {
      kind: "keyTakeaways",
      items: [
        "Homework 1: Read the deeper chapter \"d1-sarvam-stt-complete\" on your own — it covers the same file in more technical detail.",
        "Homework 2: Make ONE test web call, speak a sentence, and watch the live transcript appear. Notice how words show up before you finish talking — that's streaming.",
        "Homework 3: In your own words, write 3 sentences answering \"How does STT help the phone call?\" Bring them to Day 2.",
        "Remember: sound → samples (8kHz on phone) → PCM bytes → STT turns bytes into words → the AI reads the words.",
        "Remember the contract: every vendor promises `sendAudio()` in and `onTranscript(text, isFinal, ...)` out — that one shared shape is why we can swap Sarvam for Deepgram without rewriting the app.",
        "Remember Sarvam's traps: only `saaras:v3` / `saarika:v2.5` stream, audio must be WAV-wrapped with `encoding: \"audio/wav\"`, and coalescing waits for mid-sentence pauses so the AI hears the whole question.",
      ],
    },
  ],
};
