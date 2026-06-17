import fs from "fs";

const TOKEN = process.env.GITHUB_PAT;
const REPO = "srundme/voiceorch";
const BRANCH = "main";
const COMMIT_MSG =
  "fix: STT language normalisation + Deepgram endpointing cap\n\n- Deepgram: normalise BCP-47 codes (hi-IN→hi, ta-IN→ta etc); cap endpointing at 2000ms\n- Sarvam: fix Odia or-IN→od-IN mapping; base-code fallback in normaliseSarvamLang";

if (!TOKEN) {
  console.error("GITHUB_PAT not set");
  process.exit(1);
}

const FILES = [
  "artifacts/api-server/src/orchestration/adapters/stt/deepgram.ts",
  "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
];

async function pushFile(filePath: string) {
  const content = fs.readFileSync(`/home/runner/workspace/${filePath}`, "utf-8");
  const b64 = Buffer.from(content).toString("base64");

  const getRes = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${filePath}?ref=${BRANCH}`,
    { headers: { Authorization: `token ${TOKEN}`, Accept: "application/vnd.github.v3+json" } }
  );
  const existing = (await getRes.json()) as { sha: string; message?: string };
  if (!existing.sha) {
    console.error(`Could not get SHA for ${filePath}:`, existing.message);
    process.exit(1);
  }

  const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: COMMIT_MSG, content: b64, sha: existing.sha, branch: BRANCH }),
  });
  const result = (await putRes.json()) as { content?: { sha: string }; message?: string };
  if (putRes.ok) {
    console.log(`✓ ${filePath} → ${result.content?.sha?.slice(0, 7)}`);
  } else {
    console.error(`✗ ${filePath}: HTTP ${putRes.status} — ${result.message}`);
    process.exit(1);
  }
}

for (const f of FILES) {
  await pushFile(f);
}
console.log("Done — Railway will redeploy automatically.");
