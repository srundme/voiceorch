---
name: GitHub push required after every edit
description: User preference — all code changes must be pushed to GitHub via the API after editing files locally in Replit.
---

After making any file edits in this project, always push the changed files to GitHub using the GitHub REST API via code_execution.

**Why:** The project is deployed on Railway which pulls from `srundme/voiceorch` on GitHub. Changes only take effect on Railway after they are pushed to the `main` branch.

**How to apply:** At the end of every task (or sub-task that produces file edits), use code_execution to push all changed files via the GitHub Trees + Commits API. Remote URL is `github` (use `git --no-optional-locks remote get-url github` to extract the token). Repo: `srundme/voiceorch`, branch: `main`.

**Pattern:**
1. Create blobs for each changed file
2. Create a new tree on top of the current HEAD tree
3. Create a commit pointing to the new tree
4. PATCH the branch ref to the new commit SHA
