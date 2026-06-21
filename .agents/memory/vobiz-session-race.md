---
name: VoBiz session race condition
description: Race condition where VoBiz closes WS before createSession completes → sessionId is null → endSession never called → record stuck in_progress
---

## Rule
`vobiz.ts` uses a `sessionEndedBeforeReady` flag. Set it to `true` in the `stop` case and `close`/`error` handlers when `sessionId` is null (i.e. `createSession` hasn't returned yet). After `createSession` resolves, if `sessionEndedBeforeReady` is true, immediately call `endSession(sessionId)`.

**Why:** VoBiz has a ~2-second timeout: if no `playAudio` is received after the WS connects, it sends `stop` and closes. `createSession` can take >2s on Railway (10+ sequential DB queries). When stop/close fires before the `await createSession(...)` resolves, `sessionId` is null, so both the `stop` case and `close` handler skip `endSession`. By the time `createSession` returns, nothing will ever clean up the record.

**How to apply:** Any time async setup runs inside a WS message handler that relies on an out-of-scope variable (like `sessionId`), use this flag pattern to detect early termination and call cleanup after the async work completes.
