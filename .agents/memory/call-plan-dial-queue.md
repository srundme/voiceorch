---
name: Call plan dial queue
description: Call plans dial through the campaign engine (running batch + rolling refill)
---

# Call plan dial queue (= campaign engine)

Call plans reuse the **same dial path as People campaigns**:

1. Hidden `leadSource=workflow` campaign, `status=active`, `concurrentCallLimit = users.concurrentLimit`
2. Long-running batch `__call_plan_queue` (`status=running`)
3. `make_call` inserts a `pending` lead with `batchId`, parks `workflow_runs` as `waiting_call`
4. Dialing = `refillCampaignConcurrency` (atomic pre-claim → `scheduleCampaignCall` / `fireCampaignCall`)
5. Call-end → `refillCampaignForLead` → workflow branch tops up via campaign refill
6. Post-call steps stay on `resumeWaitingCallRuns` → `advanceRun`

**Account pool:** for `leadSource=workflow`, `doRefillCampaignConcurrency` counts
`calling`/`connected` across all of the user’s workflow campaigns and uses
`users.concurrentLimit` for free slots.

**Pause:** journey `autoFeed=false` + claim SQL requires active journey; if no
other active plan shares the agent, the workflow campaign is paused.

**Auto-feed:** `call-plan-queue-feed.ts` keeps starting workflow runs from the
people source (list/sheet) so the batch never starves — same idea as a large
campaign batch, without materializing 100k rows in one request.

**Files:** `workflow-dial-queue.ts`, `batchScheduler.ts` (workflow branch),
`workflow-engine.ts` beginCall, `call-plan-queue-feed.ts`.
