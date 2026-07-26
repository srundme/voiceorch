---
name: Environment restart can revert fresh edits
description: An unexpected Replit environment restart rolled back a file edit made seconds earlier
---

Rule: after an unexpected environment restart (all workflows suddenly NOT_STARTED, /tmp/logs wiped, 502s from every port), re-verify the last few minutes of file edits before doing anything else — one edit was silently reverted to pre-edit content while all older edits survived.

**Why:** Jul 2026 — an Express route fix was applied and the workflow restarted successfully; the environment then restarted itself and the file was back to the broken version. The failure looked like "my edit didn't work" when actually it no longer existed.

**How to apply:** On detecting an env restart, run `git status --short` + grep for the most recent changes (a quick per-file marker check) and re-apply anything missing. Don't debug "why didn't the fix work" until file contents are confirmed.
