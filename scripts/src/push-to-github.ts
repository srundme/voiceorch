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
  "artifacts/api-server/src/routes/webhooks.ts",
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
      message: `fix(voice): repair broken live outbound VoBiz calls (dead air + helicopter + barge-in). (1) webhooks.ts: distrust VoBiz's synchronous AMD machine flag — it false-positives on live humans and routed answered calls into voicemail-delivery mode (~12s dead air + a dropped voicemail message; call 1320). Add trustMachineFlag (default true, Twilio/Plivo unchanged); VoBiz passes false so a machine verdict is logged/persisted but NOT enacted, opening the normal AI stream. (2) pipeline.ts: raise keepalive watchdog fill threshold 60ms→500ms so the pump no longer injects silence/ambient frames into live speech on ordinary streaming jitter (the chopping "helicopter"); still fills genuine stalls well under VoBiz's 2s 4010 drop. (3) pipeline.ts: narrow the streaming-STT input self-echo gate to the per-sentence echo-grace + greeting-grace window instead of isPlaying||bargeInHoldUntil (which muted Sarvam for the whole reply → loud-shout-only barge-in); residual echo is still rejected at the transcript level by isSelfEcho()/tail-echo guard, restoring normal-volume interruptions`,
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
