/**
 * Concurrent webcall load-test — VoiceOrch / SnapServe
 *
 * Usage:
 *   AGENT_ID=46 pnpm --filter @workspace/scripts run loadtest-calls
 *
 * Optional env vars:
 *   CONCURRENCY   — simultaneous WebSocket clients (default: 20)
 *   TURNS         — speaking turns per client (default: 2)
 *   API_URL       — HTTP base (default: http://localhost:8080)
 *   WS_URL        — WS base  (default: ws://localhost:8080)
 *
 * The server must be started with STUB_PROVIDERS=1 so all provider
 * calls are replaced by in-process stubs (STT=120ms, LLM~700ms, TTS~700ms).
 *
 * Auth: a throwaway HS256 JWT is minted using SESSION_SECRET (must be set).
 * Each virtual user fetches its own single-use ticket (POST /api/webcall/ticket)
 * before opening the WebSocket so the ticket system is exercised correctly.
 */

import WebSocket from "ws";
import { createHmac, randomBytes } from "crypto";

const AGENT_ID    = Number(process.env["AGENT_ID"]    ?? "0");
const CONCURRENCY = Number(process.env["CONCURRENCY"] ?? "20");
const TURNS       = Number(process.env["TURNS"]       ?? "2");
const API_URL     = process.env["API_URL"]  ?? "http://localhost:8080";
const WS_URL      = process.env["WS_URL"]  ?? "ws://localhost:8080";
const SESSION_SECRET = process.env["SESSION_SECRET"] ?? "";
const USER_ID     = process.env["USER_ID"]  ?? "loadtest-user";

if (!AGENT_ID) { console.error("AGENT_ID env var is required"); process.exit(1); }
if (!SESSION_SECRET) { console.error("SESSION_SECRET env var is required"); process.exit(1); }

// ── Minimal HS256 JWT (no deps needed) ────────────────────────────────────────
function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function mintJwt(sub: string, secret: string, ttlSeconds = 3600): string {
  const header  = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now     = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub, email: "loadtest@snapserve.ai", name: "LoadTest", iat: now, exp: now + ttlSeconds }));
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

const JWT = mintJwt(USER_ID, SESSION_SECRET);

// ── Get a per-VU single-use ticket ────────────────────────────────────────────
async function getTicket(): Promise<string> {
  const res = await fetch(`${API_URL}/api/webcall/ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${JWT}` },
    body: JSON.stringify({ agentId: AGENT_ID }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ticket fetch failed: HTTP ${res.status} — ${body}`);
  }
  const { ticket } = await res.json() as { ticket: string };
  return ticket;
}

// ── PCM16 sine-wave (1.5 s @ 16 kHz) ─────────────────────────────────────────
const SAMPLE_RATE = 16_000;
const SPEECH_SECS = 1.5;
const FREQ_HZ     = 440;
const SAMPLES     = Math.ceil(SAMPLE_RATE * SPEECH_SECS);
const AMPLITUDE   = 8_000;

const SPEECH_PCM = Buffer.allocUnsafe(SAMPLES * 2);
for (let i = 0; i < SAMPLES; i++) {
  SPEECH_PCM.writeInt16LE(Math.round(AMPLITUDE * Math.sin(2 * Math.PI * FREQ_HZ * i / SAMPLE_RATE)), i * 2);
}
const SILENCE_PCM = Buffer.alloc(Math.ceil(SAMPLE_RATE * 0.4) * 2, 0);

// ── Per-VU session ─────────────────────────────────────────────────────────────
type TurnResult = { turnMs: number; ok: boolean; error?: string };

async function runClient(vuIdx: number): Promise<TurnResult[]> {
  let ticket: string;
  try { ticket = await getTicket(); }
  catch (e) {
    console.error(`[vu${vuIdx}] ticket error: ${e}`);
    return [{ turnMs: 0, ok: false, error: String(e) }];
  }

  return new Promise((resolve) => {
    const url = `${WS_URL}/api/ws/webcall/${AGENT_ID}?ticket=${encodeURIComponent(ticket)}`;
    const ws  = new WebSocket(url);
    ws.binaryType = "nodebuffer";

    const results: TurnResult[] = [];
    let turn = 0;
    let tFlush = 0;
    let waitingForAudio = false;

    function sendSpeech() {
      if (ws.readyState !== WebSocket.OPEN) return;
      tFlush = performance.now();
      waitingForAudio = true;
      const CHUNK = SAMPLE_RATE * 2 * 0.02; // 20 ms chunks
      let offset = 0;
      function sendChunk() {
        if (!waitingForAudio) return;
        if (offset < SPEECH_PCM.length) {
          const end = Math.min(offset + CHUNK, SPEECH_PCM.length);
          ws.send(SPEECH_PCM.subarray(offset, end));
          offset = end;
          setTimeout(sendChunk, 20);
        } else {
          ws.send(SILENCE_PCM);
        }
      }
      sendChunk();
    }

    ws.on("open",  () => { setTimeout(sendSpeech, 1_200); }); // wait for greeting
    ws.on("error", (err) => {
      console.error(`[vu${vuIdx}] WS error: ${err.message}`);
      results.push({ turnMs: 0, ok: false, error: err.message });
      resolve(results);
    });
    ws.on("message", (data) => {
      if (typeof data === "string") {
        try {
          const m = JSON.parse(data) as { type: string };
          if (m.type === "error") {
            console.error(`[vu${vuIdx}] server error: ${data}`);
            ws.close(); resolve(results);
          }
        } catch { /* ignore */ }
        return;
      }
      if (waitingForAudio) {
        const ms = Math.round(performance.now() - tFlush);
        results.push({ turnMs: ms, ok: true });
        waitingForAudio = false;
        turn++;
        process.stdout.write(`  vu${vuIdx} turn${turn} ${ms}ms\n`);
        if (turn >= TURNS) { ws.close(1000, "done"); resolve(results); }
        else { setTimeout(sendSpeech, 2_500); }
      }
    });
    ws.on("close", (code) => {
      if (turn < TURNS) console.warn(`[vu${vuIdx}] closed early after ${turn}/${TURNS} turns (code ${code})`);
      resolve(results);
    });
    setTimeout(() => { if (ws.readyState === WebSocket.OPEN) ws.close(1001, "timeout"); resolve(results); }, 5 * 60_000);
  });
}

// ── Percentile ─────────────────────────────────────────────────────────────────
function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nSnapServe webcall concurrency test`);
  console.log(`  agentId=${AGENT_ID}  concurrency=${CONCURRENCY}  turns=${TURNS}`);
  console.log(`  apiUrl=${API_URL}  wsUrl=${WS_URL}  (STUB_PROVIDERS must=1)\n`);

  // Stagger VU start slightly so they don't all hit DB simultaneously
  const stagger = Math.min(50, 2000 / CONCURRENCY); // spread over up to 2s
  const clientPromises = Array.from({ length: CONCURRENCY }, async (_, i) => {
    await new Promise(r => setTimeout(r, i * stagger));
    return runClient(i + 1).catch(err => { console.error(`vu${i+1} fatal:`, err); return [] as TurnResult[]; });
  });

  const all = await Promise.all(clientPromises);
  const allMs = all.flat().filter(r => r.ok).map(r => r.turnMs).sort((a, b) => a - b);
  const errors = all.flat().filter(r => !r.ok).length;
  const total  = all.flat().length;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Webcall Concurrency Test — ${CONCURRENCY} VUs × ${TURNS} turns`);
  console.log(`${"═".repeat(60)}`);
  for (let i = 0; i < all.length; i++) {
    const turns = all[i]!;
    const ms = turns.filter(t => t.ok).map(t => t.turnMs);
    if (!ms.length) { console.log(`  vu${i+1}: FAILED (${turns.map(t => t.error).join(", ")})`); continue; }
    console.log(`  vu${i+1}: ${ms.length}/${TURNS} turns  avg=${Math.round(ms.reduce((a,b)=>a+b,0)/ms.length)}ms  [${ms.join(", ")}]ms`);
  }
  console.log(`${"─".repeat(60)}`);
  if (allMs.length) {
    console.log(`  successful turns : ${allMs.length} / ${total}`);
    console.log(`  errors           : ${errors}`);
    console.log(`  p50              : ${pct(allMs,50)}ms`);
    console.log(`  p95              : ${pct(allMs,95)}ms`);
    console.log(`  p99              : ${pct(allMs,99)}ms`);
    console.log(`  max              : ${allMs[allMs.length-1]}ms`);
  } else {
    console.log("  No successful turns.");
  }
  console.log(`${"═".repeat(60)}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
