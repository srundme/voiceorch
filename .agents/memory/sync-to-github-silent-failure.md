---
name: sync-to-github silent failure
description: The sync-to-github script can report success while NOT pushing code files; always verify, fall back to Git Data API.
---

`pnpm --filter @workspace/scripts run sync-to-github` diffs against a stored
last-synced commit ref. When that stored ref is not present in the GitHub repo
history it prints `fatal: Invalid revision range <sha>..HEAD`, then uploads only
a fallback set (memory files, attached_assets) and STILL prints
`Done — synced N file change(s)` and creates a commit — **without your actual
code file blobs**. The result looks successful but `git/contents` for your
changed source files returns 404 on `main`.

**Why:** the script trusts its stored diff base; an invalid base silently
narrows the file set instead of erroring out.

**How to apply:** after any `sync-to-github` run that touches code, VERIFY the
files landed (e.g. `curl -s -o /dev/null -w "%{http_code}" -H "Authorization:
token $GITHUB_PERSONAL_ACCESS_TOKEN" .../contents/<path>?ref=main`). If 404,
push directly via the GitHub **Git Data API** as one atomic commit: GET
ref heads/main → GET base commit → create blobs (encoding utf-8) → create tree
with `base_tree` → create commit with `parents:[base]` → PATCH ref heads/main.
Use `GITHUB_PERSONAL_ACCESS_TOKEN` (header `Authorization: token ...`), never
`GITHUB_PAT`.
