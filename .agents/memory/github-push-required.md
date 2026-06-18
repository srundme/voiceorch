---
name: GitHub push required after every edit
description: User preference — all code changes must be pushed to GitHub via the API after editing files locally in Replit.
---

After making any file edits in this project, always push the changed files to GitHub using the GitHub REST API.

**Why:** The project is deployed on Railway which pulls from `srundme/voiceorch` on GitHub. Changes only take effect on Railway after they are pushed to the `main` branch.

**Secret name:** `GITHUB_PERSONAL_ACCESS_TOKEN` — this is the correct, working secret. `GITHUB_PAT` also exists in the env but was stale/expired; always prefer `GITHUB_PERSONAL_ACCESS_TOKEN`.

**How to apply:** The post-merge setup script (`scripts/post-merge.sh`) now runs `pnpm --filter @workspace/scripts run sync-to-github` automatically after every task merge. For ad-hoc pushes:
```
pnpm --filter @workspace/scripts run sync-to-github
```

**Repo / branch:** `srundme/voiceorch`, branch `main`.

**Do NOT use `git push` via HTTPS:** Replit's `GIT_ASKPASS=replit-git-askpass` helper intercepts the credential prompt; even with `unset GIT_ASKPASS` + `GIT_TERMINAL_PROMPT=0 git -c credential.helper=''`, GitHub returns "Invalid username or token". Use the GitHub Git Data API instead.

**Sync script pattern (`scripts/src/sync-to-github.ts`):**
- Gets GitHub's full recursive tree (blob SHAs) via API
- Gets local tree via `git ls-tree -r HEAD`
- Only uploads blobs where SHA differs (fast incremental pushes — typically < 20 files per task)
- Uses `base_tree` on the tree create so unchanged files are inherited
- Falls back to full-tree upload if repos have diverged histories (first-time sync)
- Creates a commit + updates the branch ref atomically
