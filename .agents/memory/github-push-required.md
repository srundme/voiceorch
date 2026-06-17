---
name: GitHub push required after every edit
description: User preference — all code changes must be pushed to GitHub via the API after editing files locally in Replit.
---

After making any file edits in this project, always push the changed files to GitHub using the GitHub REST API.

**Why:** The project is deployed on Railway which pulls from `srundme/voiceorch` on GitHub. Changes only take effect on Railway after they are pushed to the `main` branch.

**Secret name:** `GITHUB_PAT` — this is the correct secret name available in this Replit environment.

**How to apply:** Write a tsx push script in `scripts/src/`, add a matching npm script in `scripts/package.json`, then run it directly via bash:
```
pnpm --filter @workspace/scripts run <script-name>
```

The bash tool can access `process.env.GITHUB_PAT` directly — **no workflow workaround needed**. The previous note about the pitch-deck artifact.toml workaround was based on a stale observation; direct bash execution works fine.

**Repo / branch:** `srundme/voiceorch`, branch `main`.

**Pattern for push script:**
```ts
const TOKEN = process.env["GITHUB_PAT"] ?? "";
// For each file: GET sha, then PUT with b64 content + sha + commit message
// Use GitHub Contents API: PUT /repos/srundme/voiceorch/contents/<path>
```

See `scripts/src/push-to-github.ts` for a working example.
