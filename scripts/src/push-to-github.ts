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
  "lib/db/drizzle/0038_campaign_meta_page_token.sql",
  "lib/db/drizzle/meta/_journal.json",
  "lib/api-spec/openapi.yaml",
  "lib/api-client-react/src/generated/api.ts",
  "lib/api-zod/src/generated/api.ts",
  "artifacts/api-server/src/routes/campaigns.ts",
  "artifacts/api-server/src/routes/campaign-webhook.ts",
  "artifacts/dashboard/src/pages/campaigns/[id].tsx",
];

const COMMIT_MESSAGE = [
  "feat(campaigns): Meta Graph API lead fetch + Page Access Token",
  "",
  "Root cause fix: Meta webhooks only deliver a leadgen_id notification.",
  "The actual field_data (phone, name, email) must be fetched from the",
  "Graph API: GET /v20.0/{leadgen_id}?fields=field_data&access_token=...",
  "",
  "DB (migration 0038):",
  "  - Add meta_page_access_token text nullable to campaigns table",
  "  - Stored AES-256-GCM encrypted (same as provider API keys)",
  "",
  "Webhook handler (campaign-webhook.ts):",
  "  - If field_data present in payload (older apps / some test tools): use it",
  "  - Else if metaPageAccessToken configured: fetch from Graph API v20.0",
  "  - Else: warn + skip (logs actionable message pointing to Configure UI)",
  "  - Graph API errors (bad token, expired, etc): warn + skip with status/body",
  "  - AbortSignal.timeout(8000) guards against slow Graph API responses",
  "",
  "Campaign PATCH handler (campaigns.ts):",
  "  - Extract metaPageAccessToken from body before ...rest spread",
  "  - Encrypt with encryptKey before storing; null clears the stored value",
  "",
  "toCampaign serializer:",
  "  - Return metaPageAccessTokenHint = last 6 chars of decrypted token",
  "  - Full token never returned in any GET response",
  "",
  "OpenAPI spec + codegen:",
  "  - Add metaPageAccessTokenHint to Campaign schema (read)",
  "  - Add metaPageAccessToken to CampaignUpdate schema (write)",
  "",
  "Dashboard UI (MetaIntegrationCard):",
  "  - Red banner when Page Access Token not configured",
  "  - Token status row shows hint or 'Not set' warning badge",
  "  - Configure form: password input for token (blank = keep existing)",
  "  - Form ID and Page ID inputs moved below token (optional isolation)",
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
