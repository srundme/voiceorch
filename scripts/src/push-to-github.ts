import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");

const GITHUB_TOKEN = process.env["GITHUB_PERSONAL_ACCESS_TOKEN"] ?? process.env["GITHUB_PAT"] ?? "";
if (!GITHUB_TOKEN) { console.error("ERROR: No GitHub token found"); process.exit(1); }

const OWNER = "srundme";
const REPO  = "voiceorch";
const BRANCH = "main";

const FILES_TO_PUSH = [
  "artifacts/dashboard/src/pages/campaigns/[id].tsx",
];

const COMMIT_MESSAGE = [
  "feat(campaigns): delete campaign with name-confirmation dialog",
  "",
  "- Trash icon button in campaign header (always visible, red on hover)",
  "- Dialog opens on click; shows campaign name, red warning banner,",
  "  and a text input — Delete button stays disabled until the user",
  "  types the exact campaign name (Enter key also triggers delete)",
  "- On confirm: calls DELETE /api/campaigns/:id, navigates to /campaigns",
  "- Loading spinner + disabled state while the request is in flight",
  "- Uses existing useDeleteCampaign hook (was already generated from spec)",
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
  try { sha = ((await ghFetch(`contents/${relPath}?ref=${BRANCH}`)) as { sha: string }).sha; } catch { /**/ }
  await ghFetch(`contents/${relPath}`, {
    method: "PUT",
    body: JSON.stringify({ message: COMMIT_MESSAGE, content: encoded, branch: BRANCH, ...(sha ? { sha } : {}) }),
  });
  console.log(`  ✓ ${relPath}`);
}

async function main() {
  console.log(`Pushing ${FILES_TO_PUSH.length} file(s) to ${OWNER}/${REPO}@${BRANCH}…`);
  for (const f of FILES_TO_PUSH) await pushFile(f);
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
