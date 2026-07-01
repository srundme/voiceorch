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
  "lib/db/src/schema/campaigns.ts",
  "lib/api-spec/openapi.yaml",
  "lib/api-client-react/src/generated/api.ts",
  "lib/api-zod/src/generated/api.ts",
  "artifacts/api-server/src/routes/campaigns.ts",
  "artifacts/api-server/src/routes/campaign-webhook.ts",
  "artifacts/dashboard/src/pages/campaigns/[id].tsx",
];

const COMMIT_MESSAGE = [
  "feat(campaigns): Meta Lead Ads form_id layer-2 validation + Integration UI",
  "",
  "DB schema (campaigns.ts):",
  "  - source_form_id text nullable — expected Meta form_id for this campaign",
  "  - source_page_id text nullable — optional expected Meta page_id",
  "  - last_validation_error json nullable — audit record of last mismatch",
  "",
  "Webhook handler (campaign-webhook.ts):",
  "  - Extract value.form_id + value.page_id from Meta leadgen payload",
  "  - When campaign.sourceFormId set: reject change if form_id absent or mismatches",
  "  - When campaign.sourcePageId set: reject change if page_id mismatches",
  "  - Rejected changes: write CampaignValidationError audit to lastValidationError",
  "  - Fully valid batch with at least one accepted lead: clear lastValidationError",
  "  - Always return 200 to Meta (non-200 causes unwanted Meta retries)",
  "",
  "API serializer (campaigns.ts toCampaign):",
  "  - Return sourceFormId, sourcePageId, lastValidationError, lastWebhookAt,",
  "    lastWebhookStatus (were previously missing from API response)",
  "",
  "OpenAPI spec / codegen:",
  "  - Add sourceFormId, sourcePageId, lastWebhookAt, lastWebhookStatus,",
  "    lastValidationError to Campaign schema",
  "  - Add sourceFormId, sourcePageId to CampaignUpdate schema",
  "  - Regenerated api.ts hooks + zod schemas",
  "",
  "Dashboard UI (campaigns/[id].tsx):",
  "  - Replace simple Instagram hint with MetaIntegrationCard component",
  "  - Shows webhook status badge, last-lead-received timestamp",
  "  - Amber banner with audit detail when form_id/page_id mismatch detected",
  "  - Configure button: inline form to set/clear sourceFormId + sourcePageId",
  "  - Saves via PATCH /campaigns/:id, invalidates campaign query on save",
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
