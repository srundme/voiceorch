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
  "artifacts/api-server/src/orchestration/pipeline.ts",
  "artifacts/api-server/src/orchestration/session.ts",
  "artifacts/api-server/src/orchestration/types.ts",
  "artifacts/api-server/src/orchestration/transcriptQuality.ts",
  "artifacts/api-server/src/orchestration/telephony/twilio.ts",
  "artifacts/api-server/src/orchestration/telephony/plivo.ts",
  "artifacts/api-server/src/routes/webhooks.ts",
  "artifacts/api-server/src/routes/calls.ts",
  "artifacts/dashboard/src/pages/agents/edit.schema.ts",
  "artifacts/dashboard/src/pages/agents/edit.tsx",
  "artifacts/dashboard/src/pages/agents/builder.tsx",
  "artifacts/dashboard/src/pages/agents/edit.test.ts",
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
      message: `fix(voice): Agent 59 VoBiz inbound Tamil — dead air, barge-in, latency, English-switch, transfers, provider scope, form hydration (11-file spec). pipeline.ts: fix caller-memory trailer regex (={20,}; the 37-'=' trailer never matched the old 40-'=' pattern); build the greeting via buildCompactGreetingPrompt(systemPrompt, currentLang||sttConfig.language||language||"en-IN")+substituteSalutation (+greetingLlmMs/promptChars log); cap greetingEchoHoldUntil via Math.min(...,GREETING_ECHO_HOLD_CAP_MS=3000); honour explicit mid-call English requests when autoSwitchToEnglish — detectExplicitLanguageRequest on the final transcript latches en-IN and sets currentLang, with the OVERRIDE branch ahead of the ABSOLUTE-RULE language block; make executeTransferAgent return Promise<string|undefined> so tool + IVR paths only report success (and only fire onCallEnd) when the redirect actually happened; remove the now-dead input-level self-echo gate helper. session.ts: thread autoSwitchToEnglish into AgentConfig; stub agent→agent transfer (warn+logExec(agent_transfer_not_implemented)+return false) and add an explicit unsupported-provider else (wasTransferred=false, patchSessionMeta, warn, logExec, return false) so unimplemented transfers fail loudly and keep the call alive. calls.ts: scope the telephony-provider lookup to (providerName, userId, isActive=true); return 409 when a transfer has no external call ID instead of silently succeeding. twilio.ts + plivo.ts: mirror vobiz's sessionEndedBeforeReady guard so a stop/close/error during createSession still ends the session (no rows stuck in_progress). transcriptQuality.ts + types.ts: supporting types/quality tweaks. dashboard agents (edit.schema.ts/edit.tsx/builder.tsx/edit.test.ts): fix agent-form hydration so saved values populate on edit.`,
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
