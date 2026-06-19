---
name: Expo/metro crash after adding a dependency
description: Adding an npm dep can transiently crash the family-mobile expo workflow via metro's file watcher; clear metro cache.
---

After `pnpm add <pkg>` (e.g. undici), the `family-mobile` expo workflow can crash
with `Error: ENOENT: no such file or directory, watch
'.../node_modules/.pnpm/<pkg>@x/node_modules/<pkg>_tmp_NNNN/...'` from metro's
`FallbackWatcher`. Two compounding causes:
1. pnpm extracts to a `<pkg>_tmp_NNNN` dir then renames; an interrupted/slow
   install leaves it briefly, and metro starts watching it before it vanishes.
2. metro persists a file-map (haste map) cache that records the now-deleted temp
   path and keeps trying to `watch()` it on every restart — so a plain restart
   does NOT fix it.

**Why:** metro's polling walker recursively watches the entire `.pnpm` store and
caches the file map across runs; a stale entry for a removed dir is fatal.

**How to apply:** clear the caches, then restart expo:
`rm -rf /tmp/metro-cache /tmp/metro-file-map-* artifacts/family-mobile/.expo node_modules/.cache`.
This is unrelated to the new dependency itself — the dep is fine; only the
watcher cache is stale.
