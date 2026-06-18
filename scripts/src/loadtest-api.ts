/**
 * Severe HTTP API load test — VoiceOrch / SnapServe
 *
 * Usage:
 *   BASE_URL=http://localhost:80  pnpm --filter @workspace/scripts run loadtest-api
 *
 * Optional env vars:
 *   CONCURRENCY    — virtual users (default 50)
 *   DURATION_S     — how many seconds to run (default 30)
 *   RAMP_S         — ramp-up period in seconds (default 5)
 *   AUTH_TOKEN     — bearer JWT for authenticated routes
 *   ADMIN_TOKEN    — x-admin-token for /admin routes
 */

const BASE_URL    = process.env["BASE_URL"]    ?? "http://localhost:80";
const CONCURRENCY = Number(process.env["CONCURRENCY"]  ?? "50");
const DURATION_S  = Number(process.env["DURATION_S"]   ?? "30");
const RAMP_S      = Number(process.env["RAMP_S"]       ?? "5");
const AUTH_TOKEN  = process.env["AUTH_TOKEN"]  ?? "";
const ADMIN_TOKEN = process.env["ADMIN_TOKEN"] ?? "";

// ── Endpoint catalogue ────────────────────────────────────────────────────────
interface Endpoint { label: string; path: string; headers?: Record<string,string>; weight: number }

const ENDPOINTS: Endpoint[] = [
  // ── Unauthenticated ──────────────────────────────────────────────────────
  { label: "GET /healthz",             path: "/api/healthz",              weight: 10 },
  // ── Authenticated user routes ────────────────────────────────────────────
  ...(AUTH_TOKEN ? [
    { label: "GET /agents",            path: "/api/agents",               headers: { Authorization: `Bearer ${AUTH_TOKEN}` }, weight: 10 },
    { label: "GET /dashboard/stats",   path: "/api/dashboard/stats",      headers: { Authorization: `Bearer ${AUTH_TOKEN}` }, weight: 8 },
    { label: "GET /calls",             path: "/api/calls?limit=20",       headers: { Authorization: `Bearer ${AUTH_TOKEN}` }, weight: 8 },
    { label: "GET /wallet",            path: "/api/wallet",               headers: { Authorization: `Bearer ${AUTH_TOKEN}` }, weight: 4 },
    { label: "GET /providers",         path: "/api/providers",            headers: { Authorization: `Bearer ${AUTH_TOKEN}` }, weight: 4 },
    { label: "GET /dashboard/volume",  path: "/api/dashboard/call-volume",headers: { Authorization: `Bearer ${AUTH_TOKEN}` }, weight: 4 },
  ] satisfies Endpoint[] : []),
  // ── Admin routes ─────────────────────────────────────────────────────────
  ...(ADMIN_TOKEN ? [
    { label: "GET /admin/agents",      path: "/api/admin/agents",         headers: { "x-admin-token": ADMIN_TOKEN }, weight: 3 },
    { label: "GET /admin/finance",     path: "/api/admin/finance/summary",headers: { "x-admin-token": ADMIN_TOKEN }, weight: 3 },
    { label: "GET /admin/alerts",      path: "/api/admin/alerts",         headers: { "x-admin-token": ADMIN_TOKEN }, weight: 2 },
  ] satisfies Endpoint[] : []),
];

// Build weighted picker
const weightedPool: Endpoint[] = [];
for (const e of ENDPOINTS) for (let w = 0; w < e.weight; w++) weightedPool.push(e);

function pickEndpoint(): Endpoint {
  return weightedPool[Math.floor(Math.random() * weightedPool.length)]!;
}

// ── Per-endpoint stats ────────────────────────────────────────────────────────
interface Stats {
  latencies: number[];
  errors:    number;
  requests:  number;
}

const stats: Record<string, Stats> = {};

function record(label: string, latencyMs: number, ok: boolean) {
  if (!stats[label]) stats[label] = { latencies: [], errors: 0, requests: 0 };
  stats[label]!.requests++;
  if (ok) stats[label]!.latencies.push(latencyMs);
  else    stats[label]!.errors++;
}

// ── Single request ────────────────────────────────────────────────────────────
async function doRequest(ep: Endpoint): Promise<void> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE_URL}${ep.path}`, {
      headers: ep.headers ?? {},
      signal: AbortSignal.timeout(10_000),
    });
    const ms = Math.round(performance.now() - t0);
    record(ep.label, ms, res.ok);
  } catch {
    const ms = Math.round(performance.now() - t0);
    record(ep.label, ms, false);
  }
}

// ── Virtual user (runs continuously until `stop` is set) ─────────────────────
async function virtualUser(stop: { v: boolean }, idx: number): Promise<void> {
  // Staggered start within ramp-up window
  const stagger = Math.random() * RAMP_S * 1000;
  await new Promise(r => setTimeout(r, stagger));
  if (idx % 10 === 0) process.stdout.write(`  vu${idx} started\n`);
  while (!stop.v) {
    await doRequest(pickEndpoint());
    // Tiny think-time (0–20 ms) to avoid thundering-herd
    await new Promise(r => setTimeout(r, Math.random() * 20));
  }
}

// ── Percentile ────────────────────────────────────────────────────────────────
function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

// ── Summary printer ───────────────────────────────────────────────────────────
function printSummary(elapsed_s: number) {
  const all: number[] = [];
  let totalReq = 0, totalErr = 0;

  const pad = (s: string, n: number) => s.padEnd(n);
  const rpad = (s: string, n: number) => s.padStart(n);

  console.log(`\n${"═".repeat(90)}`);
  console.log(`  SnapServe API Load Test — ${CONCURRENCY} VUs × ${DURATION_S}s   base=${BASE_URL}`);
  console.log(`${"═".repeat(90)}`);
  console.log(
    pad("endpoint", 32) +
    rpad("reqs", 7) + rpad("err%", 7) + rpad("req/s", 7) +
    rpad("p50", 7) + rpad("p95", 7) + rpad("p99", 7) + rpad("max", 7)
  );
  console.log("─".repeat(90));

  for (const [label, s] of Object.entries(stats).sort((a,b)=>a[0].localeCompare(b[0]))) {
    const sorted = [...s.latencies].sort((a,b) => a - b);
    all.push(...sorted);
    totalReq += s.requests;
    totalErr += s.errors;
    const errPct  = s.requests ? ((s.errors / s.requests) * 100).toFixed(1) : "—";
    const rps     = (s.requests / elapsed_s).toFixed(1);
    console.log(
      pad(label, 32) +
      rpad(String(s.requests), 7) +
      rpad(`${errPct}%`, 7) +
      rpad(rps, 7) +
      rpad(sorted.length ? `${pct(sorted, 50)}ms` : "—", 7) +
      rpad(sorted.length ? `${pct(sorted, 95)}ms` : "—", 7) +
      rpad(sorted.length ? `${pct(sorted, 99)}ms` : "—", 7) +
      rpad(sorted.length ? `${sorted[sorted.length-1]}ms` : "—", 7)
    );
  }

  console.log("─".repeat(90));
  const sortedAll = all.sort((a,b)=>a-b);
  const errPctAll = totalReq ? ((totalErr / totalReq)*100).toFixed(1) : "0.0";
  const rpsAll    = (totalReq / elapsed_s).toFixed(1);
  console.log(
    pad("TOTAL", 32) +
    rpad(String(totalReq), 7) +
    rpad(`${errPctAll}%`, 7) +
    rpad(rpsAll, 7) +
    rpad(sortedAll.length ? `${pct(sortedAll,50)}ms` : "—", 7) +
    rpad(sortedAll.length ? `${pct(sortedAll,95)}ms` : "—", 7) +
    rpad(sortedAll.length ? `${pct(sortedAll,99)}ms` : "—", 7) +
    rpad(sortedAll.length ? `${sortedAll[sortedAll.length-1]}ms` : "—", 7)
  );
  console.log(`${"═".repeat(90)}\n`);
}

// ── Ticker ────────────────────────────────────────────────────────────────────
function ticker(stop: { v: boolean }) {
  let prev = 0;
  const id = setInterval(() => {
    if (stop.v) { clearInterval(id); return; }
    const cur = Object.values(stats).reduce((s,v)=>s+v.requests,0);
    process.stdout.write(`  ${new Date().toISOString().slice(11,19)}  total_req=${cur}  +${cur-prev}/s\n`);
    prev = cur;
  }, 1000);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (ENDPOINTS.length === 0) {
    console.error("No endpoints configured — set AUTH_TOKEN and/or ADMIN_TOKEN env vars, or check BASE_URL.");
    process.exit(1);
  }

  console.log(`\nVoiceOrch / SnapServe — Severe API Load Test`);
  console.log(`  base=${BASE_URL}  vus=${CONCURRENCY}  duration=${DURATION_S}s  ramp=${RAMP_S}s`);
  console.log(`  endpoints: ${ENDPOINTS.map(e=>e.label).join("  |  ")}`);
  console.log(`\nStarting ramp-up...\n`);

  const stop = { v: false };
  ticker(stop);

  const t0 = performance.now();
  const vus = Array.from({ length: CONCURRENCY }, (_, i) => virtualUser(stop, i + 1));

  await new Promise(r => setTimeout(r, (DURATION_S + RAMP_S) * 1000));
  stop.v = true;
  await Promise.all(vus);

  const elapsed_s = (performance.now() - t0) / 1000;
  printSummary(elapsed_s);
}

main().catch(err => { console.error(err); process.exit(1); });
