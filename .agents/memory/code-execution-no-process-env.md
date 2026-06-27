---
name: code_execution sandbox has no process.env
description: Why env-dependent scripts (e.g. GitHub push using a token secret) must run via bash/node, not the code_execution tool
---

The `code_execution` JavaScript sandbox does NOT expose `process.env` — reading
`process.env.ANY_SECRET` throws `Cannot read properties of undefined`. The sandbox
shares the workspace filesystem and can `await import("child_process")`, but
environment variables / secrets are not injected into it.

**Why:** the sandbox is isolated from the process environment for safety; secrets
live in the real shell environment, not the notebook.

**How to apply:** any script that needs a secret (GitHub token, API keys, DB URL)
must run as a real Node/tsx process via the `bash` tool, where `process.env` is
populated. Pattern that works for pushing files to `srundme/voiceorch`: write a
one-off `.mjs` to `/tmp`, then `node /tmp/script.mjs` from bash. Node 24 has global
`fetch`, so the Git Data API push (blobs → tree with `base_tree` → commit → PATCH
ref) needs no extra deps. Scope the tree to only the changed paths and rely on
`base_tree` inheritance so unrelated files (and unrelated local deletions) are NOT
propagated.
