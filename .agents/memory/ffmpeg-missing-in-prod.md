---
name: ffmpeg missing in prod build images
description: ffmpeg exists in Replit dev (Nix) but is absent from every Railway prod build image; bundle it, never assume PATH
---

`ffmpeg` is on PATH in the Replit dev container (provided by Nix) but is **NOT
present in any of the prod build images**: the root `Dockerfile` (node:24-slim)
and api-server `Dockerfile` (node:22-slim) install only `libgomp1`, and the
nixpacks/railpack configs add nothing. So any code that `spawn("ffmpeg", …)`
works in dev and silently fails in prod.

This was the root cause of inaudible **uploaded** ambient tracks: the
upload-time + self-heal transcode-to-PCM steps threw `ENOENT` in prod →
`pcm_data` never populated → `loadPcmLoop` throws → ambient disabled for that
call. Built-in procedural tracks were unaffected (no ffmpeg needed).

**Why builder-invariant matters:** the remote has 3 competing build configs
(`railway.json` builder=RAILPACK, `railway.toml` dockerfilePath="Dockerfile",
`nixpacks.toml`) and the active one can't be confirmed. So the fix can't rely on
editing only one Dockerfile.

**How to apply:** for any ffmpeg (or other system-binary) need in this repo:
1. Add `ffmpeg-static` to the consuming artifact's `dependencies` AND to
   `pnpm-workspace.yaml` `onlyBuiltDependencies` (so its postinstall downloads
   the binary).
2. Mark `ffmpeg-static` **external** in that artifact's esbuild `build.mjs` — its
   binary path is resolved from `__dirname` at runtime, so it must not be bundled.
3. Resolve the path at runtime: `ffmpeg-static`'s path if it exists on disk, else
   fall back to `"ffmpeg"` on PATH (cache + log which source). See
   `artifacts/api-server/src/lib/ffmpeg.ts` (`resolveFfmpegPath`).
4. Belt-and-suspenders: also `apt-get install ffmpeg` in the active Dockerfile so
   the PATH fallback works too.

**Verification limit:** an inaudible-ambient fix can't be confirmed without a
real telephony call (human + carrier). The per-call "Ambient noise enabled" log
and one-time "first silence chunk emitted" log in `pipeline.ts` are the
instruments to confirm ambient actually goes on the wire on the next real call.
