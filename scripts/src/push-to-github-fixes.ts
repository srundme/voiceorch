import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");
const GITHUB_TOKEN = process.env["GITHUB_PERSONAL_ACCESS_TOKEN"] ?? process.env["GITHUB_PAT"] ?? "";
if (!GITHUB_TOKEN) { console.error("ERROR: No GitHub token found"); process.exit(1); }
const OWNER = "srundme", REPO = "voiceorch", BRANCH = "main";
const FILES_TO_PUSH = [
  "artifacts/api-server/src/routes/campaign-webhook.ts",
  "lib/api-spec/openapi.yaml",
  "lib/api-zod/src/generated/api.ts",
  "lib/api-client-react/src/generated/api.schemas.ts",
];
const COMMIT_MESSAGE = [
  "fix(campaigns): stopped guard + completed in status enum (architect review)",
  "",
  "1. Webhook ingestion now rejects leads when campaign.status === 'stopped'",
  "   - Returns 500 error to caller so external CRM gets clear signal",
  "   - Prevents any downstream dial from stopped campaigns",
  "",
  "2. OpenAPI status enum updated: [draft, active, paused, stopped, completed]",
  "   - Backend still sets 'completed' for CSV batch finish; spec now matches",
  "",
  "3. batchScheduler: 'queued' leads treated same as 'pending' for claiming,",
  "   completion counting, and active-lead checks",
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
  try { sha = ((await ghFetch(`contents/${relPath}?ref=${BRANCH}`)) as { sha: string }).sha; } catch { /* */ }
  await ghFetch(`contents/${relPath}`, {
    method: "PUT",
    body: JSON.stringify({ message: COMMIT_MESSAGE, content: encoded, branch: BRANCH, ...(sha ? { sha } : {}) }),
  });
  console.log(`  \u2713 ${relPath}`);
}

(async () => {
  console.log(`Pushing ${FILES_TO_PUSH.length} file(s)\u2026`);
  for (const f of FILES_TO_PUSH) await pushFile(f);
  console.log("Done.");
})().catch(e => { console.error(e); process.exit(1); });
