---
name: Recording track alignment (RecordingBuffer)
description: Why agent-track recordings must align to the track's own audio cursor, not per-frame wall-clock
---
RecordingBuffer (orchestration/recorder.ts) builds a stereo WAV (L=caller, R=agent) from PCM frames captured during a call. Alignment must use each track's OWN written-sample count as the primary cursor and append back-to-back frames contiguously (zero padding).

**Why:** Agent playback paces frames with `await setTimeout(40)` per 40 ms frame, so each loop iteration takes slightly MORE than 40 ms wall-clock while carrying exactly 40 ms of audio. Any scheme that pads a track up to its wall-clock position on EVERY append injects a few ms of silence before nearly every agent frame → a periodic ~40 ms-cadence silence chop (~10-25 Hz) heard as buzzing/helicopter/fluttering ONLY in the recording (live playback is buffered and plays contiguously, so it's unaffected).

**How to apply:** Insert silence only (1) to anchor a track's FIRST chunk to its real start offset, and (2) to re-sync after a GENUINE idle gap (track not written for > ~120 ms, a real conversational pause). A continuous 40 ms-frame stream must produce contiguous samples. Re-syncing at genuine gaps re-anchors to wall-clock so there is no progressive cross-track drift across a long call. Never pad the OPPOSITE track (that serializes overlapping speech and breaks talk-over mixing). The same RecordingBuffer is fed by both webcall.ts and pipeline.ts.
