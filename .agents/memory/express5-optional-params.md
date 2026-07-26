---
name: Express 5 optional route params
description: path-to-regexp 8 (Express 5) rejects the ':param?' optional syntax — server crashes at boot
---

Rule: in Express 5 (router 2.x / path-to-regexp 8), optional route segments must use brace syntax `{/:param}` — the old `:param?` suffix throws `PathError: Unexpected ? at index …` at module load, killing the whole server before it binds the port.

**Why:** Hit when adding `/public/wa-assets/:token/:filename?`; the API server crash-looped on boot until the route became `/public/wa-assets/:token{/:filename}`.

**How to apply:** Any new/edited Express route with an optional trailing segment. Also remember wildcard changes (`*` → `/*splat`) in Express 5. A boot-time PathError stack pointing at a route file = this.
