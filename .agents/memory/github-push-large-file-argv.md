---
name: GitHub Contents API push script — large file argv limit
description: base64-encoding a large file and passing it as a node -e argv string fails with "Argument list too long"; pass content via a temp file instead.
---

When scripting pushes to GitHub via the Contents API (per `github-push-required.md`), do NOT pass
base64-encoded file content as a shell/node argv argument (e.g. `node -e '...' "$content_b64"`).
Large files (e.g. a multi-thousand-line OpenAPI spec, `pnpm-lock.yaml`) exceed the OS argv size
limit and fail with `Argument list too long`, aborting the whole push loop partway through.

**How to apply:** write the base64 content to a temp file (`base64 -w0 file > /tmp/_content_b64.txt`)
and have the Node helper `fs.readFileSync` it to build the JSON payload, rather than threading it
through `process.argv`. Keep small identifiers (path, sha) as argv — only the content itself needs
the file-based indirection.
