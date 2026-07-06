---
name: Detached method calls lose `this` binding
description: Extracting `obj.method` into a local variable before calling it drops `this`, and if the callee is async/fire-and-forget the resulting error can be silently swallowed far from the call site.
---

Calling `const fn = obj.method; fn(...)` instead of `obj.method(...)` (or `fn.bind(obj)`) loses the `obj` receiver. If `method`'s implementation reads `this.*` internally (e.g. an SDK client field, API key, voice id), the call throws immediately — but if that call happens inside a detached `async` IIFE (`void (async () => { try { await fn(...) } catch (err) { stashError(err) } })()`), the exception is caught, stored, and only surfaces later (or is misreported) instead of failing loudly at the call site.

**Why:** During a refactor that split a large synthesis/playback function into synthesis-start + drain phases, the streaming TTS call was changed from `this.tts.synthesizeStream(...)` to a hoisted `const synthesizeStream = this.tts.synthesizeStream; ...synthesizeStream(...)` for readability. This silently broke the adapter's internal `this` context, so every streaming TTS call failed instantly (no network round trip even attempted) and completed in ~6ms. Because the failure path only skips the "TTS response" log line but still logs "Playback Completed" with a normal-looking `reason: "completed"`, the symptom read as "TTS returns instantly and plays nothing" rather than an obvious crash — worth checking call logs for an unusually fast (sub-50ms) playback duration paired with a missing TTS response log as the fingerprint of this class of bug.

**How to apply:** When hoisting/extracting a method reference off an object during a refactor, always `.bind(obj)` it (or keep calling it as `obj.method(...)`) unless you've confirmed the method doesn't rely on instance state. Prefer keeping the call site as `obj.method(...)` unless there's a real reason to detach it.
