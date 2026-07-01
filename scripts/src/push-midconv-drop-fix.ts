import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");
const GITHUB_TOKEN = process.env["GITHUB_PERSONAL_ACCESS_TOKEN"] ?? "";
if (!GITHUB_TOKEN) { console.error("ERROR: No GitHub token"); process.exit(1); }
const OWNER = "srundme", REPO = "voiceorch", BRANCH = "main";
const FILES = ["artifacts/api-server/src/orchestration/session.ts"];
const MSG = [
  "fix(campaigns): retry mid-conversation dropped calls",
  "",
  "Campaign calls that drop mid-conversation were silently marked 'completed'",
  "and never retried. The auto-redial (scheduleNetworkDropCallback) explicitly",
  "skips campaign calls (!isCampaignCall guard), so nothing triggered a redial.",
  "",
  "Fix: when a campaign lead's call ends with:",
  "  - naturalEndTriggered = false (agent didn't say goodbye / use end_call tool)",
  "  - wasTransferred = false",
  "  - durationSeconds > 15 (real connected conversation, not a pre-greeting fail)",
  "",
  "Then mark the lead 'failed' (not 'completed') and call scheduleRetry() with",
  "reason='network_drop', respecting batch-level maxAttempts and retryDelayMinutes.",
  "scheduleRetry() itself gates on attempts remaining — if maxAttempts is already",
  "exhausted the lead stays 'failed' with no further retry (correct behavior).",
  "",
  "Also propagate 'failed' into computeOperationalOutcome so the batch KPI",
  "dashboard correctly reflects the drop rather than counting it as a conversion.",
].join("\n");

async function ghFetch(p: string, opts: RequestInit = {}) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json", ...(opts.headers as Record<string, string> ?? {}) },
  });
  if (!r.ok) throw new Error(`GH ${r.status} ${p}: ${await r.text()}`);
  return r.json();
}

(async () => {
  for (const f of FILES) {
    const content = Buffer.from(fs.readFileSync(path.join(REPO_ROOT, f), "utf8")).toString("base64");
    let sha: string | undefined;
    try { sha = ((await ghFetch(`contents/${f}?ref=${BRANCH}`)) as { sha: string }).sha; } catch { /**/ }
    await ghFetch(`contents/${f}`, { method: "PUT", body: JSON.stringify({ message: MSG, content, branch: BRANCH, ...(sha ? { sha } : {}) }) });
    console.log(`  ✓ ${f}`);
  }
  console.log("Done.");
})().catch(e => { console.error(e); process.exit(1); });
