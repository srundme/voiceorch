---
name: Campaign rolling concurrency refill
description: How campaign outbound concurrency is kept topped-up and the invariants any change must preserve
---

# Campaign rolling concurrency

Campaigns keep N calls live (campaign.concurrentCallLimit) by **event-driven
refill**, not by the 60s poll. The single source of truth for "how many are
live" is a DB count of campaign_leads in `calling`/`connected` status (NOT the
in-memory activeCampaignCalls map in batchScheduler.ts, which is defined but
unused).

**Rule:** every code path that moves a lead OUT of the active state must trigger
a refill, or slots sit idle until the poll. Those paths are:
- non-connected terminal webhook (`handleCampaignLeadTerminalStatus`, webhooks.ts)
- connected/completed/transferred/callback (`endSession`, session.ts)
Both call `refillCampaignConcurrency` / `refillCampaignForLead` (batchScheduler.ts).

**Why serialized per-campaign (refillInFlight set):** slot count is computed
then leads are claimed in a second statement. Two simultaneous call-ends both
reading the same free-slot count would each claim up-to-`slots` *different*
leads and blow past the limit. In-process serialization (single Node process on
Railway) prevents this; a re-run flag ensures a refill requested mid-flight runs
once more so no freed slot is missed.

**Why atomic pre-claim (UPDATE ... AND call_status='pending' RETURNING id):**
same guard as fireStartBatch — a concurrent claim on the same rows sees the
committed 'calling' and skips them, so the same lead is never double-dialed even
when the poll races an event refill.

**Poll is backstop only** — keep it (scheduled starts, processRetries, stuck
sweeps, missed-webhook recovery, reconciliation). Its draft-start and
running-batch queueing now delegate to refillCampaignConcurrency.

**Ceilings that must agree:** campaign gate default 20 (campaignCaller/
batchScheduler) and the per-user hard ceiling (session.ts, = users.concurrentLimit,
schema default 15). An account anomalously set below the campaign limit silently
caps dialing AND clamps the create-wizard slider (Math.min). Fix is data-only via
the admin set-concurrent-limit capability, not schema.

**Known residual race (out of scope):** retryEngine.processRetries sets a due
lead to `pending` then dials it itself after callDelaySeconds; a refill in that
window could grab the same lead and double-dial. Narrow (free slot + 5s window)
and pre-existing; retry timing was explicitly out of scope.
