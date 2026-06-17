---
name: GitHub push required after every edit
description: User preference — all code changes must be pushed to GitHub via the API after editing files locally in Replit.
---

After making any file edits in this project, always push the changed files to GitHub using the GitHub REST API via code_execution.

**Why:** The project is deployed on Railway which pulls from `srundme/voiceorch` on GitHub. Changes only take effect on Railway after they are pushed to the `main` branch.

**Secret name:** `GITHUB_PERSONAL_ACCESS_TOKEN` (NOT `GITHUB_PAT` — that var exists but contains the wrong/old value).

**How to apply:** At the end of every task (or sub-task that produces file edits), use code_execution to push all changed files via the GitHub Contents API (PUT /repos/srundme/voiceorch/contents/<path>). Repo: `srundme/voiceorch`, branch: `main`.

**Important — env var not available in code_execution sandbox or bash tool.** The bash tool and code_execution sandbox run in processes started before secrets are updated, so `process.env.GITHUB_PERSONAL_ACCESS_TOKEN` is undefined there. Use this workaround:
1. Write a tsx push script to `scripts/src/push-xyz.ts` using `process.env.GITHUB_PERSONAL_ACCESS_TOKEN`
2. Add it as a script in `scripts/package.json`
3. Temporarily change the pitch-deck artifact.toml `[services.development] run` to `pnpm --filter @workspace/scripts run push-xyz` (via artifact.edit.toml + verifyAndReplaceArtifactToml callback)
4. Call `restart_workflow("artifacts/pitch-deck: web")` — Replit workflow processes get fresh env vars
5. Check logs — look for ✓ lines
6. Restore pitch-deck artifact.toml and remove the temp script + package.json entry

**Pattern for push script:**
```ts
const TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
// For each file: GET sha, then PUT with b64 content + sha + commit message
```
