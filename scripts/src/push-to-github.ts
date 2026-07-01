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
  "artifacts/api-server/src/orchestration/audio.ts",
];

const COMMIT_MESSAGE = [
  "fix(voice): self-calibrating (adaptive) energy barge-in for streaming-STT telephony (Sarvam/VoBiz).",
  "",
  "Call 1356 proved the previous FIXED floor was wrong: the energy bar was pinned at",
  "max(configuredThreshold, 1200) during active TTS, but a normal-volume caller's inbound RMS on",
  "this VoBiz line never sustained 20 frames above 1200, so energy barge-in fired only ONCE all",
  "call (a near-shouted 'call me'); every genuine interruption failed. Transcript barge-in can't",
  "help either -- Sarvam endpoints on silence and only finalizes AFTER the agent's playback ends",
  "(caller's 'what is wellness coin', spoken during 13:47:43-57, finalized at 13:48:02), so it is",
  "structurally too late. A single fixed number is unsolvable because echo level is line-specific:",
  "200 (the user's setting) sits below the ~300 VAD speech-gate and self-triggers on the agent's",
  "own returning echo, while 1200 is too high for a normal voice.",
  "",
  "FIX: measure the carrier's returning-echo RMS PER CALL (playbackEchoFloor) and set the active-TTS",
  "bar = max(configuredThreshold, min(echoFloor x MARGIN(1.6), MAX(2500))).",
  "",
  "Robustness (per architect review, since this deploys blind to prod):",
  "(a) the floor is sampled ONLY in the first BARGE_IN_ECHO_CALIBRATION_MS(250ms) after each line",
  "    starts -- human reaction to talk over THIS line is >~300ms, so those frames are",
  "    near-certainly pure echo, NOT the caller; prevents a caller who barges in early from",
  "    poisoning the floor against themselves.",
  "(b) below-bar frames are NEVER fed to the floor (a normal caller can be below the bar -- that is",
  "    the very bug being fixed).",
  "(c) asymmetric EMA: rise slow (0.05) / fall fast (0.3) so a stray loud sample barely nudges it",
  "    and any over-estimate self-heals within a few frames.",
  "(d) the learned floor is trusted only after BARGE_IN_ECHO_FLOOR_MIN_SAMPLES(10) samples; until",
  "    then the 1200 cold-start fallback is used so echo can't self-trigger on frame 1.",
  "(e) adaptive applies ONLY while isSendingTtsAudio; between sentences the configured threshold is",
  "    honoured unchanged.",
  "(f) clamp only caps the echo-derived BOOST at MAX -- a user threshold above MAX is never",
  "    silently lowered.",
  "",
  "Streaming path also caps min-frames at BARGE_IN_STREAMING_MIN_FRAMES(8, ~160ms) since energy is",
  "now the only real-time signal. Adds a throttled 'energy barge-in monitor' log",
  "(currentRms/echoFloor/effectiveThreshold/configured/frames) + echoFloor+currentRms on the",
  "'Barge-in detected (energy)' record. All knobs env-tunable. Batch STT and webcall (AEC) paths",
  "unchanged. Adds frameRms() to audio.ts.",
].join("\n");

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
      message: COMMIT_MESSAGE,
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
