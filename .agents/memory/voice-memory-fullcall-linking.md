---
name: Voice memory full-call print + linked-memory injection
description: Rules for refining voiceprints across the whole call and handing memory across phone numbers on a voice match
---
Rule 1: The first-call voiceprint starts from the ~2.5s enroll window, then folds every strong verify window (>= adapt threshold) into a running mean; the refined mean is persisted ONCE via SpeakerVerifier.finalize() at pipeline.close().
**Why:** a 2.5s print is weak; but persisting after a speaker handoff would write the SECOND speaker under the original caller's phone. resetForNewSpeaker() clears handoffFired, so finalize() must gate on a never-reset `hadAnyHandoff` latch, and briefly waits out an in-flight verify so it snapshots the latest mean.
Rule 2: On cross-number voice match ("enrolled" with linkedFromPhone), the OLD number's caller memory (name, latest summary, top facts) is loaded async and injected into the volatile per-turn prompt tail EVERY turn (before dtInjection, cache-safe); cleared immediately on handoff.
**How to apply:** any change to voice-match behavior must preserve: no persist after any handoff, linked memory cleared on handoff, injection stays in the volatile tail. Residual PII note: linked memory reaches the model before identity is confirmed — mitigation is prompt-level ("confirm before revealing sensitive details").
