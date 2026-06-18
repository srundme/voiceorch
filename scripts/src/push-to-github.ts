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
  // Multilingual removal
  "artifacts/api-server/src/orchestration/telephony/webcall.ts",
  "artifacts/api-server/src/orchestration/pipeline.ts",
  "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
  "artifacts/api-server/src/orchestration/types.ts",
  "artifacts/api-server/src/orchestration/session.ts",
  "artifacts/api-server/src/orchestration/callerMemory.ts",
  "artifacts/dashboard/src/components/webcall-panel.tsx",
  // Migration fixes + agents route guard
  "artifacts/api-server/src/routes/agents.ts",
  "artifacts/api-server/src/index.ts",
  "lib/db/drizzle/0003_catch_all_missing_columns.sql",
  "lib/db/drizzle/0004_create_missing_tables.sql",
  "lib/db/drizzle/meta/_journal.json",
  // Push script itself
  "scripts/src/push-to-github.ts",
  // Memory
  ".agents/memory/MEMORY.md",
  ".agents/memory/drizzle-bootstrap-migration-gap.md",
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
      message: `sync: full Replit→GitHub sync — multilingual removal, migration 0003/0004, agents route guard, bootstrapMigrationJournal`,
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
