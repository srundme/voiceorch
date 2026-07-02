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
  "lib/db/src/schema/agents.ts",
  "lib/db/drizzle/meta/_journal.json",
  "lib/db/drizzle/0041_agent_system_prompt_gen_meta.sql",
  // OpenAPI + codegen
  "lib/api-spec/openapi.yaml",
  "lib/api-zod/src/generated/api.ts",
  "lib/api-client-react/src/generated/api.ts",
  "lib/api-client-react/src/generated/api.schemas.ts",
  // Backend services + routes
  "artifacts/api-server/src/services/system-prompt-template.ts",
  "artifacts/api-server/src/services/system-prompt-guardrails.ts",
  "artifacts/api-server/src/services/prompt-template.ts",
  "artifacts/api-server/src/routes/wizard.ts",
  // Frontend
  "artifacts/dashboard/src/pages/agents/edit.schema.ts",
  "artifacts/dashboard/src/pages/agents/generate-prompt-sheet.tsx",
  "artifacts/dashboard/src/pages/agents/builder.tsx",
];

const COMMIT_MESSAGE = [
  "feat(agents): wire layered System Prompt Templates store into Generate modal",
  "",
  "- Add systemPromptGenMeta jsonb column to agents (migration 0041) for version traceability",
  "- OpenAPI: GET /wizard/system-prompt-store + POST /wizard/generate-system-prompt;",
  "  SystemPromptGenerationMeta on AgentInput + AgentUpdate; regenerated hooks + Zod",
  "- Layered generation (Foundation -> Domain -> Client Details -> form inputs)",
  "  fetched live at click; hard-fail 422 (no_foundation / no_domain), no legacy fallback",
  "- Server-side guardrail named pass/fail list (system-prompt-guardrails.ts)",
  "- Modal: dynamic Use-case dropdown from Domain templates + Custom/Other,",
  "  required-field gating, foundation-missing block, guardrail list, version badges,",
  "  diff/overwrite gating when System Prompt has content; keeps fill-not-save behavior",
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
