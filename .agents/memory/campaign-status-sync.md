---
name: Campaign & batch status sync to execution state
description: How batch/campaign auto-complete + reopen is evaluated without touching dialing/refill logic
---

Batch and campaign status must track real execution state, separate from the dialing/concurrency/claim/retry-scheduling engine (never fold status logic into those paths).

**Completion is dialability-independent.** `evaluateBatchCompletion`/`evaluateCampaignCompletion` (batchScheduler.ts) must fire even while the campaign is paused or outside business hours — a batch with zero pending + zero calling/connected leads + zero pending call_retries is done regardless of whether it *could* dial. Terminal-completion and the refill/dialable gate are deliberately decoupled: refill runs behind `isCampaignDialable`, completion eval runs unconditionally in the same poll pass.

**Every state UPDATE is status-guarded** (`WHERE status='running'` for batch complete, `WHERE status IN ('active','draft')` for campaign complete, `WHERE status='completed'` for reopen). This is what lets completion, reopen, and a concurrent user pause/cancel coexist without races — a user-chosen paused/cancelled is never overwritten.

**Reopen (`reopenCampaignIfCompleted`) only ever flips completed→active**, called from every work-re-entry path: batch start / PATCH→running / batch-create autostart / redial (campaign-batches.ts), and retry fire time (retryEngine.ts, gated on a `wasAutoCompleted` snapshot taken before the dialable check). Redial also reopens the *batch* completed→running so the running-only refill poll tops it up.

**Campaign completion covers batchless/instant leads** by counting active leads campaign-wide (batch_id can be null), and never completes a campaign with zero total leads.

**Frontend badge derives live state**: campaign header shows "active" whenever `batches.some(b => b.status==='running')`, else the persisted campaign.status — covers both a draft campaign whose batch auto-started and the reopen window. Batch controls: Start disabled for running/completed/cancelled; Stop/Pause enabled only for running/paused.
