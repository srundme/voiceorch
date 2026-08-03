/**
 * Live probe for the two Sarvam VAD windows that decide whether a turn is heard at
 * all, and how long the caller waits for a reply.
 *
 * Every Sarvam VAD parameter is a count of frames, and a frame is a fixed 512
 * samples — 32ms at 16kHz but 64ms at 8kHz. So every frame-count default means
 * TWICE as long on telephony as the docs imply. Two consequences, one per probe:
 *
 *   first-turn   `first_turn_min_speech_frames` defaults to 8 = ~512ms at 8kHz, so
 *                short first replies ("yes", "okay", "ஆமா") never open a speech
 *                segment: no speech_start, no transcript, turn lost outright.
 *
 *   end-of-speech `high_vad_sensitivity` is a two-position switch over the silence
 *                boundary, and at 8kHz both positions are bad — ON is ~128ms (chops
 *                callers mid-sentence) and OFF is ~1150ms+ (audible dead air on
 *                every turn). This measures the real boundary so an explicit
 *                negative_frames_count/window can be chosen with evidence.
 *
 * The probe imports the SAME helpers the adapter uses, so a pass here is evidence
 * about production rather than about a reimplementation. It also acts as a deploy
 * gate: it proves Sarvam accepts these query params instead of rejecting the
 * socket (cf. the Aug 2026 WAV-wrapping incident, where an unverified "fix"
 * produced zero transcripts on live calls).
 *
 * Usage:
 *   SARVAM_API_KEY=... pnpm tsx src/scripts/probe-sarvam-vad.ts <speech.wav>
 *
 * The WAV should be 8kHz mono PCM16 of a SHORT word. Convert anything else first:
 *   ffmpeg -i in.mp3 -ar 8000 -ac 1 -c:a pcm_s16le speech.wav
 */

import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
import {
  DEFAULT_FIRST_TURN_MIN_SPEECH_MS,
  endOfSpeechFrames,
  msToVadFrames,
  vadFrameMs,
} from "../orchestration/adapters/stt/sarvam.js";

const WS_BASE = "wss://api.sarvam.ai/speech-to-text/ws";
const SAMPLE_RATE = 8000 as const;
const CHUNK_MS = 20;
const BYTES_PER_CHUNK = (SAMPLE_RATE * 2 * CHUNK_MS) / 1000; // 320 bytes @8kHz PCM16

/** Sarvam's own first-turn default, read at 8kHz: 8 frames x 64ms. */
const SERVER_DEFAULT_FIRST_TURN_MS = 8 * vadFrameMs(SAMPLE_RATE);

const FIRST_TURN_MS_CELLS = [SERVER_DEFAULT_FIRST_TURN_MS, DEFAULT_FIRST_TURN_MIN_SPEECH_MS, 128];
const SHORT_SPEECH_MS_CELLS = [250, 400, 600];

/** null = send no explicit boundary, leaving whichever preset the flag selects. */
const END_OF_SPEECH_CELLS: Array<{ silenceMs: number | null; highVad: boolean }> = [
  { silenceMs: null, highVad: false }, // today's platform default
  { silenceMs: null, highVad: true }, // the other preset
  { silenceMs: 300, highVad: false },
  { silenceMs: 400, highVad: false },
  { silenceMs: 600, highVad: false },
];

interface Options {
  firstTurnMinSpeechMs: number;
  endOfSpeechSilenceMs: number | null;
  highVad: boolean;
}

interface ProbeResult {
  speechStart: boolean;
  speechEnd: boolean;
  transcript: string | null;
  /** ms from the last speech chunk to the transcript — what the caller waits. */
  msFromSpeechEndToTranscript: number | null;
  error: string | null;
}

/** Strip a 44-byte RIFF header if present; we stream raw PCM. */
function readPcm(path: string): Buffer {
  const buf = readFileSync(path);
  return buf.subarray(0, 4).toString("ascii") === "RIFF" ? buf.subarray(44) : buf;
}

function buildUrl(opts: Options): string {
  const params = new URLSearchParams({
    model: "saaras:v3",
    language_code: "en-IN",
    mode: "transcribe",
    sample_rate: String(SAMPLE_RATE),
    input_audio_codec: "pcm_s16le",
    high_vad_sensitivity: opts.highVad ? "true" : "false",
    vad_signals: "true",
    flush_signal: "true",
    first_turn_min_speech_frames: String(msToVadFrames(opts.firstTurnMinSpeechMs, SAMPLE_RATE)),
  });
  if (opts.endOfSpeechSilenceMs !== null) {
    const { count, window } = endOfSpeechFrames(opts.endOfSpeechSilenceMs, SAMPLE_RATE);
    params.set("negative_frames_count", String(count));
    params.set("negative_frames_window", String(window));
  }
  return `${WS_BASE}?${params.toString()}`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function sendAudio(ws: WebSocket, chunk: Buffer): void {
  ws.send(
    JSON.stringify({
      audio: {
        data: chunk.toString("base64"),
        // The enum must be audio/wav; the real codec is set by the URL param.
        encoding: "audio/wav",
        sample_rate: SAMPLE_RATE,
      },
    }),
  );
}

async function probe(
  key: string,
  pcm: Buffer,
  opts: Options,
  speechMs: number,
  trailingSilenceMs: number,
): Promise<ProbeResult> {
  const result: ProbeResult = {
    speechStart: false,
    speechEnd: false,
    transcript: null,
    msFromSpeechEndToTranscript: null,
    error: null,
  };

  let speechStoppedAt = 0;
  const ws = new WebSocket(buildUrl(opts), { headers: { "api-subscription-key": key } });

  const done = new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* noop */
      }
      resolve();
    };

    ws.on("error", (err: Error) => {
      result.error = err.message;
      finish();
    });

    ws.on("close", (code, reason) => {
      // A 4xxx close means auth/quota or a REJECTED PARAMETER — surface it, since
      // that is exactly the failure mode this probe exists to catch.
      if (code >= 4000 && !result.transcript) {
        result.error = `close ${code}: ${reason.toString()}`;
      }
      finish();
    });

    ws.on("message", (raw: Buffer) => {
      let msg: {
        type?: string;
        data?: { transcript?: string; signal_type?: string; message?: string };
      };
      try {
        msg = JSON.parse(raw.toString()) as typeof msg;
      } catch {
        return;
      }
      const type = msg.type ?? "";
      const signal = msg.data?.signal_type ?? "";

      if (type === "speech_start" || signal === "START_SPEECH") {
        result.speechStart = true;
      } else if (type === "speech_end" || signal === "END_SPEECH") {
        result.speechEnd = true;
      } else if (type === "error") {
        result.error = msg.data?.message ?? "unknown server error";
        finish();
      } else if (type === "transcript" || type === "data") {
        const text = (msg.data?.transcript ?? "").trim();
        if (text) {
          result.transcript = text;
          result.msFromSpeechEndToTranscript = speechStoppedAt ? Date.now() - speechStoppedAt : null;
          finish();
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  }).catch((err: Error) => {
    result.error = err.message;
  });
  if (result.error) return result;

  // Stream speech, paced in real time like the live carrier feed.
  const wanted = Math.min(pcm.length, (SAMPLE_RATE * 2 * speechMs) / 1000);
  for (let off = 0; off < wanted; off += BYTES_PER_CHUNK) {
    if (ws.readyState !== WebSocket.OPEN) break;
    sendAudio(ws, pcm.subarray(off, Math.min(off + BYTES_PER_CHUNK, wanted)));
    await sleep(CHUNK_MS);
  }
  // From here on the caller is silent — this is the clock the boundary is measured on.
  speechStoppedAt = Date.now();

  const silence = Buffer.alloc(BYTES_PER_CHUNK);
  const silenceChunks = Math.ceil(trailingSilenceMs / CHUNK_MS);
  for (let i = 0; i < silenceChunks && ws.readyState === WebSocket.OPEN; i++) {
    sendAudio(ws, silence);
    await sleep(CHUNK_MS);
  }

  await Promise.race([done, sleep(3000)]);
  try {
    ws.close();
  } catch {
    /* noop */
  }
  return result;
}

function verdictOf(r: ProbeResult): string {
  if (r.error) return `ERROR ${r.error}`;
  if (r.transcript) return `"${r.transcript}"`;
  if (r.speechStart) return "speech_start but NO transcript";
  return "NO speech_start — turn lost";
}

async function main(): Promise<void> {
  const key = process.env.SARVAM_API_KEY;
  const audioPath = process.argv[2];
  if (!key) throw new Error("SARVAM_API_KEY is not set");
  if (!audioPath) throw new Error("usage: probe-sarvam-vad.ts <speech.wav> (8kHz mono PCM16)");

  const pcm = readPcm(audioPath);
  const availableMs = (pcm.length / 2 / SAMPLE_RATE) * 1000;
  console.log(
    `audio: ${audioPath} — ${availableMs.toFixed(0)}ms of 8kHz PCM16\n` +
      `one VAD frame = 512 samples = ${vadFrameMs(SAMPLE_RATE)}ms at this rate\n`,
  );

  // ── Probe 1: is a short FIRST utterance heard at all? ──────────────────────
  console.log("── first-turn gate ─────────────────────────────────────────────");
  const firstTurnResults: Array<{ gateMs: number; lost: boolean; error: boolean }> = [];
  for (const gateMs of FIRST_TURN_MS_CELLS) {
    const frames = msToVadFrames(gateMs, SAMPLE_RATE);
    for (const speechMs of SHORT_SPEECH_MS_CELLS) {
      if (speechMs > availableMs) {
        console.log(`skip gate=${gateMs}ms speech=${speechMs}ms — audio file is shorter`);
        continue;
      }
      const r = await probe(
        key,
        pcm,
        { firstTurnMinSpeechMs: gateMs, endOfSpeechSilenceMs: null, highVad: true },
        speechMs,
        800,
      );
      firstTurnResults.push({
        gateMs,
        lost: !r.transcript && !r.error,
        error: Boolean(r.error),
      });
      console.log(
        `gate=${String(gateMs).padStart(3)}ms (${frames}f)  ` +
          `speech=${String(speechMs).padStart(3)}ms  →  ${verdictOf(r)}`,
      );
      await sleep(500); // be gentle on the streaming concurrency limit
    }
  }

  // ── Probe 2: how long does the caller wait after they stop talking? ────────
  console.log("\n── end-of-speech boundary (turn latency) ───────────────────────");
  const speechMs = Math.min(1200, availableMs);
  for (const cell of END_OF_SPEECH_CELLS) {
    const label =
      cell.silenceMs === null
        ? `preset high_vad=${String(cell.highVad).padEnd(5)}`
        : `explicit ${String(cell.silenceMs).padStart(3)}ms       `;
    const r = await probe(
      key,
      pcm,
      {
        firstTurnMinSpeechMs: DEFAULT_FIRST_TURN_MIN_SPEECH_MS,
        endOfSpeechSilenceMs: cell.silenceMs,
        highVad: cell.highVad,
      },
      speechMs,
      2500,
    );
    const waited =
      r.msFromSpeechEndToTranscript === null ? "  n/a" : `${String(r.msFromSpeechEndToTranscript).padStart(5)}ms`;
    console.log(`${label}  caller waited ${waited}   ${verdictOf(r)}`);
    await sleep(500);
  }

  const lostAtDefault = firstTurnResults.filter(
    (r) => r.lost && r.gateMs === SERVER_DEFAULT_FIRST_TURN_MS,
  ).length;
  const lostAtOurs = firstTurnResults.filter(
    (r) => r.lost && r.gateMs === DEFAULT_FIRST_TURN_MIN_SPEECH_MS,
  ).length;
  console.log(
    `\nfirst-turn: ${lostAtDefault} lost at Sarvam's ${SERVER_DEFAULT_FIRST_TURN_MS}ms default, ` +
      `${lostAtOurs} lost at our ${DEFAULT_FIRST_TURN_MIN_SPEECH_MS}ms window.`,
  );
  if (firstTurnResults.every((r) => r.error)) {
    console.log("Every cell errored — check the key, or whether Sarvam rejected a query param.");
  }
  console.log(
    "\nPick the smallest end-of-speech value that still transcribes the whole utterance,\n" +
      "then set it per-agent as sarvamEndOfSpeechSilenceMs (or deploy-wide via\n" +
      "SARVAM_END_OF_SPEECH_SILENCE_MS). Leaving it unset keeps today's preset behaviour.",
  );
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
