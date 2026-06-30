---
name: Campaign retry spacing authority
description: How the configured retry delay is enforced between campaign dial attempts, and the two invariants any new dial path must keep.
---

# Campaign retry spacing — scheduledAt is the single source of truth

The configured Retry Delay is honored only if no path dials a retry-awaiting
lead before its scheduled retry time. Two durable invariants enforce this:

**1. Retry-timing gate.** Every path that claims a `pending` campaign lead and
dials it immediately (rolling refill, batch start, and the direct fire path)
must skip leads that still carry a not-yet-due pending retry row. The only path
allowed to dial a due retry is the retry poller, which gates on the retry's
scheduled time being in the past.

**Why:** producers (provider terminal-status webhook, the dialer's catch path,
the stuck-calling sweep) leave a failed lead in a terminal status with a
future-scheduled retry — so a claim keyed on `call_status='pending'` normally
skips it. But the concurrency-limit re-queue and the retry poller both move
leads back through `pending`, so any new claim path that omits the gate will
grab such a lead and dial it early, collapsing the spacing.

**2. Attempts/Last-Activity truth.** The dial transition must be a single atomic
conditional claim keyed on the expected `call_status` — never a read-then-write
increment — so two racing paths can't both increment the attempt counter and
both place a call. The attempt counter and last-attempt timestamp must only be
written at the real dial, not at pre-claim (a pre-claim that later gets skipped,
e.g. by the max-attempts guard, would otherwise lie about "Last Activity").

**How to apply:** when adding any new campaign dial/claim path, copy both
invariants — the not-yet-due-retry gate and the atomic claim that writes the
counter/timestamp only on a placed dial.
