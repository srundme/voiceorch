---
name: Campaign retry cancellation orphans leads outside calling hours
description: Why widening/disabling a campaign's calling-hours window sometimes fails to resume a stuck lead, and the fix pattern (requeue, don't cancel).
---

## The bug

A due `call_retries` row whose campaign was outside its configured calling-hours
window used to be marked `status: "cancelled"` outright, instead of being
pushed forward to re-check later. This had a cascading effect:

1. The lead's `call_status` stays at its terminal-ish value (`failed`/`busy`/
   `no_pickup`) from the earlier attempt — no other path resets it to
   `pending`/`queued` except a retry firing or a manual "Redial" action.
2. With the retry gone, `evaluateBatchCompletion()` sees zero pending/queued
   leads, zero active leads, and zero pending retries for the batch — so on
   the very next 60s poll tick it flips the batch to `"completed"`.
3. `refillCampaignConcurrency` (the automatic dialer) only scans batches with
   `status = "running"`, so a completed batch is now permanently invisible to
   it — widening or even disabling the calling-hours window afterward does
   nothing automatically, because there's no pending retry and no running
   batch left to reopen.
4. The only way to unstick it was a manual "Redial" button, which resets
   `failed`/`skipped` leads to `pending` and reopens the batch directly,
   bypassing the whole retry/completion pipeline (and notably does NOT check
   calling hours at all).

**Why:** completion-evaluation logic correctly treats a *pending* retry as
"work remaining", but cancelling on an hours-block silently converts
"temporarily blocked" into "no work remaining", which is a lie.

**How to apply:** Any time-window/dialability gate that can transiently block
a scheduled unit of work must distinguish an explicit halt (user paused/
stopped/cancelled — safe to cancel, never auto-resurrect) from a transient
gate (business hours, rate limit, etc. — must reschedule/requeue, never
cancel), or downstream "is there still work to do" completion checks will
wrongly conclude the job is done and close a state machine that can never
reopen itself later.
