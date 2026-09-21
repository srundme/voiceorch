/**
 * Smoke-test ai-coustics Quail Voice Focus against AIC_SDK_LICENSE.
 * Usage: npx tsx src/scripts/smoke-ai-coustics.ts
 * Reads artifacts/api-server/.env when present (gitignored).
 */
import { loadLocalEnv } from "../lib/load-local-env.js";
loadLocalEnv();

import {
  aiCousticsConfigured,
  ensureAiCousticsModel,
  AiCousticsCallEnhancer,
} from "../orchestration/ai-coustics.js";

function tonePcm8k(freqHz: number, ms: number, amp = 0.25): Buffer {
  const samples = Math.floor((8000 * ms) / 1000);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const s = Math.sin((2 * Math.PI * freqHz * i) / 8000) * amp;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s * 32767))), i * 2);
  }
  return buf;
}

async function main(): Promise<void> {
  if (!aiCousticsConfigured()) {
    console.error("AIC_SDK_LICENSE is not set");
    process.exit(1);
  }
  console.log("Loading model…");
  const status = await ensureAiCousticsModel();
  console.log(status);
  if (!status.ok) process.exit(1);

  const enh = new AiCousticsCallEnhancer("smoke");
  if (!(await enh.init())) {
    console.error("processor init failed");
    process.exit(1);
  }

  const frame = tonePcm8k(1000, 20);
  const t0 = Date.now();
  let outLen = 0;
  for (let i = 0; i < 50; i++) {
    const out = enh.processPcm8k(frame);
    outLen += out.length;
  }
  const ms = Date.now() - t0;
  console.log(`Processed 50×20ms frames in ${ms}ms (out bytes=${outLen})`);
  enh.dispose();
  console.log("ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
