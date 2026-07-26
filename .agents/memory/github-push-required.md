---
name: GitHub push required after every edit
description: How code reaches srundme/voiceorch main (Railway deploy source) — proven push path
---

All file edits must land on GitHub `srundme/voiceorch` **main** — Railway deploys from it. Work is NOT done until pushed and verified.

**Proven path (Jul 2026):** local git is in sync with origin/main, so use plain git: `git add -A && git commit` in bash, then the `gitPush({ branch: "main" })` callback from the git-remote skill (CodeExecution) — it injects the user's connected-GitHub credentials that plain `git push` lacks. Verify with a follow-up `gitPull({ branch: "main" })` no-op plus `git log -1` unchanged, or a remote SHA check.

**Why:** `GITHUB_TOKEN` is not in the shell env (no repl integration attached), so raw GitHub API pushes have no credential source; the old sync-to-github script also silently failed in the past. The gitPush callback is the only credentialed path that worked.

**How to apply:** at the end of any session that edited files: check local↔origin divergence (`git rev-list --count` both ways) before committing; commit; gitPush; verify. If histories have diverged (past API-based pushes created remote-only commits), reconcile before pushing — never force-push.
