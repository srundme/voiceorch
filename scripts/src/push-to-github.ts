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
  // DB schema + migration
  "lib/db/src/schema/campaigns.ts",
  "lib/db/drizzle/meta/_journal.json",
  "lib/db/drizzle/0039_campaign_calling_hours_toggle.sql",
  // OpenAPI + codegen
  "lib/api-spec/openapi.yaml",
  "lib/api-zod/src/generated/api.ts",
  "lib/api-client-react/src/generated/api.schemas.ts",
  // Backend routes
  "artifacts/api-server/src/routes/campaigns.ts",
  "artifacts/api-server/src/routes/campaign-webhook.ts",
  "artifacts/api-server/src/services/batchScheduler.ts",
  "artifacts/api-server/src/services/campaign-dialable.ts",
  // Frontend
  "artifacts/dashboard/src/lib/campaign-status.ts",
  "artifacts/dashboard/src/pages/campaigns/[id].tsx",
  "artifacts/dashboard/src/pages/campaigns/index.tsx",
];

const COMMIT_MESSAGE = [
  "feat(campaigns): calling-hours toggle + continuous campaign lifecycle + control buttons",
  "",
  "Issue 01: Calling Hours Toggle",
  "- Add is_calling_hours_enabled boolean column (default true) to campaigns table",
  "- Migration 0039 applied via drizzle-kit push",
  "- When OFF: campaign dials 24/7 regardless of saved schedule (schedule preserved)",
  "- Frontend toggle switch in Calling Hours card + 'Clear Schedule' button",
  "",
  "Issue 02: Website/Form Campaign Lifecycle",
  "- Continuous lead sources (webhook, meta_ads, crm) NEVER auto-complete",
  "- Auto-created as status=active, triggerMode=instant, isActive=true",
  "- No 'Campaign Completed' badge for continuous campaigns",
  "",
  "Issue 03: Outside-hours queuing",
  "- When toggle ON + lead outside hours: status='queued' (was 'pending')",
  "- Batch scheduler now claims both 'pending' and 'queued' leads",
  "- 'queued' prioritized (ORDER BY call_status) so waiting leads dial first",
  "",
  "Issue 04: Control Buttons",
  "- All campaigns get unified Pause/Resume/Stop (not CSV dropdown vs instant inline)",
  "- Stopped continuous campaigns show 'Activate' button to re-enable",
  "- CSV campaigns still show 'Create Batch' when relevant",
  "- 'Idle / Listening' status badge shown for active continuous campaigns with no active batches",
  "",
  "Other:",
  "- Added 'stopped' to NON_DIALABLE_CAMPAIGN_STATUSES",
  "- Added 'stopped' to CampaignStatusBadge and CAMPAIGN_STATUS_MAP",
  "- CampaignUpdate Zod schema now accepts isCallingHoursEnabled",
  "- campaign.status enum updated in OpenAPI spec: [draft, active, paused, stopped]",
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
