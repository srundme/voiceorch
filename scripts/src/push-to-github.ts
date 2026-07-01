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

const COMMIT_MESSAGE = [
  "fix(voice): fix webcall barge-in — lower AEC threshold + cap frame count at 160 ms",
  "",
  "Root cause (calls 784/787, Agent 59 webcall path):",
  "streamingCarrier = false for webcalls (telephonyProvider === 'webcall'), so",
  "useAdaptive = false. This had two knock-on problems:",
  "",
  "1. Threshold 1200: designed for telephony carriers that echo agent TTS back.",
  "   Browser webcall AEC cancels agent echo before audio reaches the pipeline,",
  "   so 1200 is 3-4× too high for a normal browser mic.",
  "",
  "2. Frame count 40 (800 ms): the streaming frame-count cap (BARGE_IN_STREAMING_MIN_FRAMES=8)",
  "   was inside `if (useAdaptive)` — webcall never entered that branch, so it",
  "   needed 40 consecutive above-threshold frames (~800 ms) to fire instead of 8 (~160 ms).",
  "   Call 784 got 6 discarded attempts. Call 787 worked only because rms=2487 (loud).",
  "",
  "Fix:",
  "- Add BARGE_IN_WEBCALL_AEC_THRESHOLD=400 (env-tunable). When isWebcallStreaming,",
  "  effectiveThreshold is capped at 400 (browser AEC removes the echo risk).",
  "- Change frame-count cap from `if (useAdaptive)` to `if (!respectHoldUntil)` so",
  "  ALL streaming STT paths (telephony + webcall) get the 8-frame (~160 ms) cap.",
  "- Add 'webcall energy barge-in monitor' diagnostic log (same data as telephony log).",
  "",
  "Result: webcall barge-in fires after ~160 ms of normal speaking volume instead of",
  "~800 ms of shouting.",
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
