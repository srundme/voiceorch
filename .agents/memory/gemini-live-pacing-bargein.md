---
name: Gemini Live outbound pacing & barge-in
description: Why Gemini Live audio must be paced locally and interruption handled synchronously
---

**Rule:** Gemini Live streams a reply's audio far faster than real time. Never forward it to the carrier as it arrives — hold frames in a local paced pump (20ms frames, ~240ms lead) and drop the local queue on `serverContent.interrupted`. Carrier `clearAudio` alone cannot un-buffer seconds of pre-dumped audio, so barge-in "doesn't stop" and stale audio sounds like the agent answering a previous question.

**Also:** server messages are serialized through a promise chain (tool calls await inside), so `interrupted` MUST be handled synchronously in `onmessage` before the chain — otherwise a slow tool call head-of-line blocks barge-in.

**How to apply:** any Live-API (realtime speech) adapter feeding a telephony carrier needs (1) local real-time pacing, (2) local queue clear on interrupt + carrier clear event, (3) control messages exempt from ordered/awaited handling, (4) record agent audio at playback time, not arrival time.

Note: Gemini Live pipeline has NO per-turn exec logging — call logs show only setup/end rows; diagnose from code, not exec log emptiness.
