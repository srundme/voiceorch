/**
 * Concurrent webcall load-test script.
 *
 * Usage:
 *   AGENT_ID=<uuid> pnpm --filter @workspace/scripts run loadtest-calls
 *
 * Optional env vars:
 *   CONCURRENCY    — number of simultaneous WebSocket clients (default: 5)
 *   TURNS          — speaking turns per client (default: 3)
 *   WS_URL         — base WebSocket URL (default: ws://localhost:80)
 *   AUTH_TOKEN     — JWT session token; required if auth is enabled
 *
 * The server must be started with STUB_PROVIDERS=1 so all provider calls
 * are replaced by in-process stubs (no real ASR/LLM/TTS keys needed).
 *
 * Each client:
 *   1. Opens a WebSocket to /api/calls/webcall?agentId=<id>
 *   2. Streams 1.5 s of 16-kHz sine-wave PCM to simulate speech
 *   3. Waits for the agent to reply (first `audio` message)
 *   4. Records `return_ms` (vad-flush → first audio out) per turn
 *   5. Repeats TURNS times then hangs up
 *
 * Prints a per-client summary and aggregate P50/P95/P99/max when done.
 */

import WebSocket from "ws";

const AGENT_ID   = process.env["AGENT_ID"]    ?? "";
const CONCURRENCY = Number(process.env["CONCURRENCY"] ?? "5");
const TURNS       = Number(process.env["TURNS"]       ?? "3");
const WS_URL      = process.env["WS_URL"]     ?? "ws://localhost:80";
const AUTH_TOKEN  = process.env["AUTH_TOKEN"] ?? "";

if (!AGENT_ID) {
  console.error("AGENT_ID env var is required");
  process.exit(1);
}

// ── PCM16 sine-wave generator (16 kHz, 1.5 s) ──────────────────────────────
const SAMPLE_RATE   = 16_000;
const SPEECH_SECS   = 1.5;
const FREQ_HZ       = 440;
const SAMPLES       = Math.ceil(SAMPLE_RATE * SPEECH_SECS);
const AMPLITUDE     = 8_000;

function makeSinePcm(): Buffer {
  const buf = Buffer.allocUnsafe(SAMPLES * 2);
  for (let i = 0; i < SAMPLES; i++) {
    const v = Math.round(AMPLITUDE * Math.sin(2 * Math.PI * FREQ_HZ * i / SAMPLE_RATE));
    buf.writeInt16LE(v, i * 2);
  }
  return buf;
}

const SPEECH_PCM = makeSinePcm();

// ── 200 ms of silence — sent after speech so VAD flushes ───────────────────
const SILENCE_SECS  = 0.4;
const SILENCE_SAMPLES = Math.ceil(SAMPLE_RATE * SILENCE_SECS);
const SILENCE_PCM   = Buffer.alloc(SILENCE_SAMPLES * 2, 0);

// ── One client session ──────────────────────────────────────────────────────
type TurnResult = { turnMs: number; ok: boolean };

function runClient(clientIdx: number): Promise<TurnResult[]> {
  return new Promise((resolve, reject) => {
    const url = `${WS_URL}/api/calls/webcall?agentId=${AGENT_ID}${AUTH_TOKEN ? `&token=${AUTH_TOKEN}` : ""}`;
    const ws = new WebSocket(url);
    ws.binaryType = "nodebuffer";

    const results: TurnResult[] = [];
    let turn = 0;
    let tFlush = 0;
    let waitingForAudio = false;

    function sendSpeech() {
      if (ws.readyState !== WebSocket.OPEN) return;
      tFlush = performance.now();
      waitingForAudio = true;
      // Send speech in 20 ms chunks (matching real browser behaviour)
      const CHUNK = SAMPLE_RATE * 2 * 0.02; // 20 ms at 16 kHz, 16-bit
      let offset = 0;
      function sendChunk() {
        if (!waitingForAudio) return; // barge-in reset; skip remaining
        if (offset < SPEECH_PCM.length) {
          const end = Math.min(offset + CHUNK, SPEECH_PCM.length);
          ws.send(SPEECH_PCM.subarray(offset, end));
          offset = end;
          setTimeout(sendChunk, 20);
        } else {
          // Send silence to trigger VAD flush
          ws.send(SILENCE_PCM);
        }
      }
      sendChunk();
    }

    ws.on("open", () => {
      console.log(`[client ${clientIdx}] connected`);
      // Small delay so the server finishes its greeting
      setTimeout(sendSpeech, 1_500);
    });

    ws.on("message", (data) => {
      if (typeof data === "string") {
        try {
          const msg = JSON.parse(data) as { type: string };
          if (msg.type === "error") {
            console.error(`[client ${clientIdx}] server error:`, data);
            ws.close();
            resolve(results);
          }
        } catch { /* non-JSON text, ignore */ }
        return;
      }
      // Binary = audio chunk from TTS
      if (waitingForAudio) {
        const returnMs = Math.round(performance.now() - tFlush);
        results.push({ turnMs: returnMs, ok: true });
        waitingForAudio = false;
        turn++;
        console.log(`[client ${clientIdx}] turn ${turn} return_ms=${returnMs}`);
        if (turn >= TURNS) {
          ws.close(1000, "done");
          resolve(results);
        } else {
          // Wait for agent to finish speaking before next turn
          setTimeout(sendSpeech, 2_500);
        }
      }
    });

    ws.on("error", (err) => {
      console.error(`[client ${clientIdx}] WS error:`, err.message);
      reject(err);
    });

    ws.on("close", (code) => {
      if (turn < TURNS) {
        console.warn(`[client ${clientIdx}] closed early after ${turn}/${TURNS} turns (code ${code})`);
      }
      resolve(results);
    });

    // Hard timeout: 5 minutes max
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1001, "timeout");
      resolve(results);
    }, 5 * 60_000);
  });
}

// ── Aggregate stats ─────────────────────────────────────────────────────────
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nSnapServe webcall load test`);
  console.log(`  agentId=${AGENT_ID}  concurrency=${CONCURRENCY}  turns=${TURNS}`);
  console.log(`  wsUrl=${WS_URL}  STUB_PROVIDERS must=1 on server\n`);

  const clientPromises = Array.from({ length: CONCURRENCY }, (_, i) =>
    runClient(i + 1).catch((err: unknown) => {
      console.error(`client ${i + 1} fatal:`, err);
      return [] as TurnResult[];
    })
  );

  const allResults = await Promise.all(clientPromises);

  const allMs = allResults.flat().filter(r => r.ok).map(r => r.turnMs).sort((a, b) => a - b);

  console.log(`\n── Results ──────────────────────────────────────`);
  for (let i = 0; i < allResults.length; i++) {
    const turns = allResults[i]!;
    const ms = turns.map(t => t.turnMs);
    if (ms.length === 0) { console.log(`  client ${i + 1}: no completed turns`); continue; }
    const avg = Math.round(ms.reduce((a, b) => a + b, 0) / ms.length);
    console.log(`  client ${i + 1}: ${turns.length} turns  avg=${avg}ms  [${ms.join(", ")}]ms`);
  }

  if (allMs.length > 0) {
    console.log(`\n── Aggregate (N=${allMs.length} turns) ──────────────────`);
    console.log(`  min=${allMs[0]}ms`);
    console.log(`  p50=${percentile(allMs, 50)}ms`);
    console.log(`  p95=${percentile(allMs, 95)}ms`);
    console.log(`  p99=${percentile(allMs, 99)}ms`);
    console.log(`  max=${allMs[allMs.length - 1]}ms`);
  } else {
    console.log(`\nNo completed turns recorded.`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
