import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");
const GITHUB_TOKEN = process.env["GITHUB_PERSONAL_ACCESS_TOKEN"] ?? process.env["GITHUB_PAT"] ?? "";
if (!GITHUB_TOKEN) { console.error("ERROR: No GitHub token found"); process.exit(1); }
const OWNER = "srundme", REPO = "voiceorch", BRANCH = "main";

// All files changed in this session
const FILES_TO_PUSH = [
  "artifacts/api-server/src/orchestration/session.ts",
  "artifacts/api-server/src/routes/batch-workspace.ts",
  "artifacts/api-server/src/routes/live-queue.ts",
  "artifacts/dashboard/src/pages/calls/[id].tsx",
  "artifacts/dashboard/src/pages/calls/index.tsx",
  "artifacts/dashboard/src/pages/campaigns/[id]/batches/[batchId].tsx",
  "artifacts/dashboard/src/pages/campaigns/live-queue.tsx",
  "artifacts/dashboard/src/pages/command-center/index.tsx",
  "artifacts/dashboard/src/lib/execution-id.ts",
  "lib/api-client-react/src/generated/api.schemas.ts",
  "lib/api-spec/openapi.yaml",
  "lib/api-zod/src/generated/api.ts",
  "scripts/package.json",
  "scripts/src/backfill-execution-id.ts",
];

const COMMIT_MESSAGE = [
  "feat(execution-id): make exec_xxxxxxxx the single canonical Execution ID",
  "",
  "- createSession now generates a real executionId (exec_<8 hex>) at call creation",
  "  (routes/calls.ts insert paths already did this)",
  "- Added idempotent backfill-execution-id script for existing NULL/empty rows",
  "- New shared frontend helper getExecutionId() — never fabricates EXE-.../#<id>,",
  "  shows \"Not available\" only when truly missing",
  "- Applied consistently in Call Log, Call Detail (header + Details panel),",
  "  Campaign batch view, Live Queue, and Command Center recent/failed call lists",
  "- Live Queue + batch workspace API responses now include executionId",
  "  (OpenAPI schemas + route mappings updated, Orval hooks/Zod regenerated)",
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
  if (!res.ok) { const b = await res.text(); throw new Error(`GitHub ${res.status} ${apiPath}: ${b}`); }
  return res.json();
}

async function pushFile(relPath: string) {
  const content = fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
  const encoded = Buffer.from(content).toString("base64");
  let sha: string | undefined;
  try { sha = ((await ghFetch(`contents/${relPath}?ref=${BRANCH}`)) as { sha: string }).sha; } catch { /* new file */ }
  await ghFetch(`contents/${relPath}`, {
    method: "PUT",
    body: JSON.stringify({
      message: COMMIT_MESSAGE,
      content: encoded,
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  console.log(`  \u2713 ${relPath}`);
}

(async () => {
  console.log(`Pushing ${FILES_TO_PUSH.length} file(s)\u2026`);
  for (const f of FILES_TO_PUSH) await pushFile(f);
  console.log("Done.");
})().catch(e => { console.error(e); process.exit(1); });
