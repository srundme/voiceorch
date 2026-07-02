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
  "lib/api-spec/openapi.yaml",
  "lib/api-zod/src/generated/api.ts",
  "lib/api-client-react/src/generated/api.schemas.ts",
  "artifacts/api-server/src/routes/platform-analytics.ts",
  "artifacts/dashboard/src/pages/analytics.tsx",
];

const COMMIT_MESSAGE = [
  "fix(analytics): scope Analytics page overview to the selected campaign",
  "",
  "- GET /platform/analytics/overview now accepts an optional campaignId query param",
  "  (mirrors the ownership-check pattern already used by /platform/analytics/funnel)",
  "- When campaignId is present, every sub-query (lead funnel, callback stats,",
  "  avg call duration, daily trend) is scoped to that single campaign instead of",
  "  the user's full campaign-ID list; 403 if the campaign isn't owned by the user",
  "- OpenAPI + regenerated Orval hooks/Zod schemas for the new param",
  "- Frontend Analytics page passes campaignId from the URL through to the hook and",
  "  shows a campaign-scoped subtitle (fetches campaign name via useGetCampaign)",
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
    body: JSON.stringify({
      message: COMMIT_MESSAGE,
      content: encoded,
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  console.log(`  ✓ ${relPath}`);
}

(async () => {
  console.log(`Pushing ${FILES_TO_PUSH.length} file(s)…`);
  for (const f of FILES_TO_PUSH) await pushFile(f);
  console.log("Done.");
})().catch(e => { console.error(e); process.exit(1); });
