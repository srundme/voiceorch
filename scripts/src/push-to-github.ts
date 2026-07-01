/**
 * Push changed files to srundme/voiceorch main branch via GitHub Contents API.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");

const GITHUB_TOKEN =
  process.env["GITHUB_PERSONAL_ACCESS_TOKEN"] ??
  process.env["GITHUB_PAT"] ?? "";

if (!GITHUB_TOKEN) {
  console.error("ERROR: No GitHub token found");
  process.exit(1);
}

const OWNER = "srundme";
const REPO  = "voiceorch";
const BRANCH = "main";

const FILES_TO_PUSH = [
  "artifacts/api-server/src/orchestration/pipeline.ts",
];

async function ghFetch(apiPath: string, options: RequestInit = {}) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/${apiPath}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} for ${apiPath}: ${body}`);
  }
  return res.json();
}

async function pushFile(relPath: string) {
  const fullPath = path.join(REPO_ROOT, relPath);
  const content = fs.readFileSync(fullPath, "utf8");
  const encoded = Buffer.from(content, "utf8").toString("base64");

  let sha: string | undefined;
  try {
    const existing = await ghFetch(`contents/${relPath}?ref=${BRANCH}`) as { sha: string };
    sha = existing.sha;
  } catch {
    console.log(`  ${relPath}: new file — will create`);
  }

  await ghFetch(`contents/${relPath}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `fix(voice): barge-in now works on streaming-STT telephony (Sarvam/VoBiz). Root cause: handleProcessedAudio() returned from the streaming-STT branch (this.streamSTT.sendAudio) BEFORE the batch energy/frame barge-in block, so streaming STT could only interrupt via a transcript — a semantic-interim keyword or a FINAL-transcript word-count. On telephony Sarvam rarely finalizes while the caller talks over the agent (it endpoints on silence), so ordinary interruptions ("actually…", "I have a question") never fired even though playback abort on bargeInRequested works. Fix: extract the energy detector into tryEnergyBargeIn(pcm8k, hasSpeech, source, respectHoldUntil) and call it on BOTH paths. Batch keeps respectHoldUntil=true (its extended bargeInHoldUntil spans the whole estimated sentence — fine for VAD-gated batch STT). Streaming passes respectHoldUntil=false so the full-sentence hold can't re-suppress it; it relies only on the per-sentence echo grace (bargeInSentenceStartAt+bargeInEchoGraceMs) + greetingEchoHoldUntil, matching the streaming transcript barge-in. Anti-echo: on a no-AEC carrier the agent's own TTS echoes back with real energy while actively streaming, so during isSendingTtsAudio on non-webcall providers the energy bar is raised to max(configuredThreshold, BARGE_IN_TELEPHONY_ACTIVE_TTS_ENERGY_FLOOR=1200); webcall (AEC) and between-sentence gaps honour the configured Energy Threshold as-is. Min Words / Min Voice Duration still drive effectiveMinFrames. Adds an "energy"/"streaming_energy" Barge-in Detected log with frames+effectiveMinFrames+effectiveThreshold for tuning.`,
      content: encoded,
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });

  console.log(`  ✓ pushed ${relPath}`);
}

async function main() {
  console.log(`Pushing ${FILES_TO_PUSH.length} files to ${OWNER}/${REPO}@${BRANCH} …`);
  for (const f of FILES_TO_PUSH) {
    await pushFile(f);
  }
  console.log("Done — Railway will redeploy automatically.");
}

main().catch((err) => {
  console.error("Push failed:", err);
  process.exit(1);
});
