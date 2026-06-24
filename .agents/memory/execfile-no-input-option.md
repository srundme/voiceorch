---
name: async execFile has no input option
description: Piping a Buffer to a child process via promisified execFile silently hangs forever
---

Promisified/async `child_process.execFile` (and `exec`) do **NOT** support an
`input` option — only the *Sync variants (`execFileSync`, `spawnSync`) do. If you
spawn a tool with `-i pipe:0` and pass `{ input: buffer }` to async execFile, the
option is silently ignored, the child waits on stdin forever, and the promise
never resolves or rejects (no timeout by default).

**Why:** This caused ambient-sound uploads to never populate `pcm_data`: a
`getDurationSeconds()` helper ran `ffprobe -i pipe:0` via execFileAsync with
`input`, hanging the `Promise.all([getDurationSeconds, transcode])` with zero
logs (no success, no error).

**How to apply:** To feed a buffer to a child process asynchronously, use `spawn`
and write to `proc.stdin` then `proc.stdin.end()` (drain stdout via 'data'/'close').
For audio duration, derive it from transcoded PCM length instead of ffprobe:
`pcm.length / bytesPerSample / sampleRate` (exact for resampled audio).
