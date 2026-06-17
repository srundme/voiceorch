/**
 * Push two changed files to srundme/voiceorch main branch via GitHub Contents API.
 * Run via: pnpm --filter @workspace/scripts run push-migration-fix
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
  console.error("ERROR: No GitHub token found (tried GITHUB_PERSONAL_ACCESS_TOKEN, GITHUB_PAT)");
  process.exit(1);
}

const OWNER = "srundme";
const REPO  = "voiceorch";
const BRANCH = "main";

const FILES_TO_PUSH = [
  "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
  "artifacts/api-server/src/orchestration/telephony/webcall.ts",
];

async function ghFetch(path: string, options: RequestInit = {}) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/${path}`;
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
    throw new Error(`GitHub API ${res.status} for ${path}: ${body}`);
  }
  return res.json();
}

async function pushFile(relPath: string) {
  const fullPath = path.join(REPO_ROOT, relPath);
  const content = fs.readFileSync(fullPath, "utf8");
  const encoded = Buffer.from(content, "utf8").toString("base64");

  // Get current SHA so GitHub knows what to replace
  let sha: string | undefined;
  try {
    const existing = await ghFetch(`contents/${relPath}?ref=${BRANCH}`) as { sha: string };
    sha = existing.sha;
  } catch {
    console.log(`  ${relPath}: not found on remote — will create`);
  }

  await ghFetch(`contents/${relPath}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `fix: STT locale normalisation + webcall extractSentences Indic support`,
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
  console.log("Done.");
}

main().catch((err) => {
  console.error("Push failed:", err);
  process.exit(1);
});
