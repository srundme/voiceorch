/**
 * Live probe: does `first_turn_min_speech_frames` decide whether a SHORT first
 * utterance is transcribed at all on 8kHz telephony audio?
 *
 * Background: a Sarvam VAD frame is a fixed 512 samples, so it is 64ms at 8kHz
 * (vs 32ms at 16kHz). The server default of 8 frames therefore demands ~512ms of
 * continuous speech before the FIRST speech segment of a connection opens, and
 * short replies never open one — no speech_start, no transcript, turn lost.
 *
 * This opens one connection per (frames, duration) cell, streams a short burst of
 * real speech in 20ms chunks the way pipeline.ts does, and reports whether
 * speech_start / transcript ever arrived.
 *
 * Also serves as a deploy gate: it proves Sarvam accepts the extra query param
 * rather than rejecting the socket (cf. the Aug 2026 WAV-wrapping incident, where
 * an unverified "fix" produced zero transcripts on live calls).
 *
 * Usage:
 *   SARVAM_API_KEY=... pnpm tsx src/scripts/probe-sarvam-first-turn.ts <speech.wav>
 *
 * The WAV should be 8kHz mono PCM16 of a SHORT word ("yes" / "okay" / "ஆமா").
 * Convert anything else first:
 *   ffmpeg -i in.mp3 -ar 8000 -ac 1 -c:a pcm_s16le speech.wav
 */

import { readFileSync } from "node:fs";
import { WebSocket } from "ws";

const WS_BASE = "wss://api.sarvam.ai/speech-to-text/ws";
const SAMPLE_RATE = 8000;
const CHUNK_MS = 20;
const BYTES_PER_CHUNK = (SAMPLE_RATE * 2 * CHUNK_MS) / 1000; // 320 bytes @8kHz PCM16

const FRAME_COUNTS = [8, 4, 2]; // 8 = server default (~512ms @8kHz)
const DURATIONS_MS = [250, 400, 600]; // short reply → comfortably over the default

interface ProbeResult {
  frames: number;
  durationMs: number;
  speechStart: boolean;
  transcript: string | null;
  msToTranscript: number | null;
  error: string | null;
}

/** Strip a 44-byte RIFF header if present; we stream raw PCM. */
function readPcm(path: string): Buffer {
  const buf = readFileSync(path);
  return buf.subarray(0, 4).toString("ascii") === "RIFF" ? buf.subarray(44) : buf;
}

function buildUrl(frames: number): string {
  const params = new URLSearchParams({
    model: "saaras:v3",
    language_code: "en-IN",
    mode: "transcribe",
    sample_rate: String(SAMPLE_RATE),
    input_audio_codec: "pcm_s16le",
    high_vad_sensitivity: "true",
    vad_signals: "true",
    flush_signal: "true",
    first_turn_min_speech_frames: String(frames),
  });
  return `${WS_BASE}?${params.toString()}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function probe(
  key: string,
  pcm: Buffer,
  frames: number,
  durationMs: number,
): Promise<ProbeResult> {
  const result: ProbeResult = {
    frames,
    durationMs,
    speechStart: false,
    transcript: null,
    msToTranscript: null,
    error: null,
  };

  let startedAt = 0;

  const ws = new WebSocket(buildUrl(frames), {
    headers: { "api-subscription-key": key },
  });

  const done = new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
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
      // A 4xxx close means auth/quota or a rejected parameter — surface it.
      if (code >= 4000 && !result.transcript) {
        result.error = `close ${code}: ${reason.toString()}`;
      }
      finish();
    });

    ws.on("message", (raw: Buffer) => {
      let msg: { type?: string; data?: { transcript?: string; signal_type?: string; message?: string } };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const type = msg.type ?? "";
      const signal = msg.data?.signal_type ?? "";

      if (type === "speech_start" || signal === "START_SPEECH") {
        result.speechStart = true;
      } else if (type === "error") {
        result.error = msg.data?.message ?? "unknown server error";
        finish();
      } else if (type === "transcript" || type === "data") {
        const text = (msg.data?.transcript ?? "").trim();
        if (text) {
          result.transcript = text;
          result.msToTranscript = Date.now() - startedAt;
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

  startedAt = Date.now();

  // Stream `durationMs` of speech, paced in real time like the live carrier feed.
  const wanted = Math.min(pcm.length, (SAMPLE_RATE * 2 * durationMs) / 1000);
  for (let off = 0; off < wanted; off += BYTES_PER_CHUNK) {
    if (ws.readyState !== WebSocket.OPEN) break;
    const chunk = pcm.subarray(off, Math.min(off + BYTES_PER_CHUNK, wanted));
    ws.send(
      JSON.stringify({
        audio: {
          data: chunk.toString("base64"),
          encoding: "audio/wav", // enum must be audio/wav; real codec set via URL param
          sample_rate: SAMPLE_RATE,
        },
      }),
    );
    await sleep(CHUNK_MS);
  }

  // Trailing silence so the server VAD can close the segment, then grace for the transcript.
  const silence = Buffer.alloc(BYTES_PER_CHUNK);
  for (let i = 0; i < 40 && ws.readyState === WebSocket.OPEN; i++) {
    ws.send(
      JSON.stringify({
        audio: {
          data: silence.toString("base64"),
          encoding: "audio/wav",
          sample_rate: SAMPLE_RATE,
        },
      }),
    );
    await sleep(CHUNK_MS);
  }

  await Promise.race([done, sleep(4000)]);
  try {
    ws.close();
  } catch {
    /* noop */
  }
  return result;
}

async function main(): Promise<void> {
  const key = process.env.SARVAM_API_KEY;
  const audioPath = process.argv[2];

  if (!key) throw new Error("SARVAM_API_KEY is not set");
  if (!audioPath) throw new Error("usage: probe-sarvam-first-turn.ts <speech.wav> (8kHz mono PCM16)");

  const pcm = readPcm(audioPath);
  const availableMs = (pcm.length / 2 / SAMPLE_RATE) * 1000;
  console.log(
    `audio: ${audioPath} — ${availableMs.toFixed(0)}ms of 8kHz PCM16 ` +
      `(one VAD frame = 512 samples = 64ms at this rate)\n`,
  );

  const results: ProbeResult[] = [];
  for (const frames of FRAME_COUNTS) {
    for (const durationMs of DURATIONS_MS) {
      if (durationMs > availableMs) {
        console.log(`skip frames=${frames} ${durationMs}ms — audio file is shorter than that`);
        continue;
      }
      const r = await probe(key, pcm, frames, durationMs);
      results.push(r);
      const verdict = r.error
        ? `ERROR ${r.error}`
        : r.transcript
          ? `"${r.transcript}" (${r.msToTranscript}ms)`
          : r.speechStart
            ? "speech_start but NO transcript"
            : "NO speech_start — turn lost";
      console.log(
        `frames=${String(frames).padStart(2)} ` +
          `(~${String(frames * 64).padStart(3)}ms gate)  ` +
          `speech=${String(durationMs).padStart(3)}ms  →  ${verdict}`,
      );
      await sleep(500); // be gentle on the streaming concurrency limit
    }
  }

  const lost = results.filter((r) => !r.transcript && !r.error);
  const lostAtDefault = lost.filter((r) => r.frames === 8);
  console.log(
    `\n${results.length - lost.length}/${results.length} transcribed. ` +
      `Lost at the frames=8 default: ${lostAtDefault.length}/${lost.length || 1}.`,
  );
  if (results.every((r) => r.error)) {
    console.log("Every cell errored — check the key, or whether Sarvam rejected a query param.");
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
