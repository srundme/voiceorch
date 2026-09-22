# Audit: `Failed` leads with duration / positive dispositions

**Date:** 2026-09-19  
**Scope:** read-only. No code, data, or UI changes.  
**Production snapshot:** campaign **449** / batch **412** “One Thousand Records”, `max_attempts=2`. KPI Failed was ~138 earlier; at audit time **128** leads had `call_status='failed'`.

---

## Verdict (short)

The batch workspace is **not** mixing duration from call A with a Failed badge from an unrelated execution in the Interested / 38s examples.

It is combining **two different status machines on the same lead**:

| Field on the row | Source | What it actually is |
|---|---|---|
| Status | `campaign_leads.call_status` | **Latest lead-level telephony / retry flag.** An answered hangup without `naturalEndTriggered` is written **`failed`**. |
| Duration, Call ID, Cost | `calls` row pointed to by `campaign_leads.call_id` | **Latest session that answered** (`recordCallExecution` on connect). |
| Disposition | `campaign_leads.disposition` | Latest taxonomy label from `disposeCall` on that answered session. |
| Connected KPI | `call_status IN (connected, completed, transferred)` | Latest-attempt **lead** status, not answered-ever. |
| Failed KPI | `call_status = 'failed'` | Same column. **Leads**, not executions. |

So: **calls.status = completed** and **lead.call_status = failed** on **104 / 128** Failed rows. The History/call row says the conversation completed; the campaign lead says Failed so it can be retried (`network_drop`).

That is why you see:

`Status = Failed` · `Duration = 38s` · `Disposition = interested`

---

## 1. Field traces (DB → API → UI)

### 1.1 `campaign_leads.call_status`

- **Column:** `lib/db/src/schema/campaigns.ts` `callStatus` default `pending`.
- **Writers (terminal):**
  - `session.ts` `endSession` → `terminalLeadStatus` (`completed` / `failed` / `voicemail` / `transferred`)
  - `webhooks.ts` `handleCampaignLeadTerminalStatus` → `no_pickup` / `busy` / `failed` (only if lead is still `calling` or `connected`)
  - `campaignCaller.ts` dial exception / max-attempts skip → `failed`
  - `batchScheduler.ts` `sweepStuckCallingLeads` → `failed` (calling/connected > 15 min)
  - `retryEngine.ts` `processRetries` → **`pending`** before redial (does **not** clear disposition or `call_id`)
  - claim paths → `calling`
  - `createSession` → `connected`
- **API:** `GET /campaigns/:id/batches/:batchId/workspace/leads` selects `campaignLeadsTable.callStatus` (`batch-workspace.ts`).
- **UI:** Status badge via `callStatusCfg(lead.callStatus)` (`[batchId].tsx`). Filter Failed = `status=failed` → `eq(callStatus, 'failed')`.

### 1.2 `campaign_leads.operational_outcome`

- Written only by `setOperationalOutcome` (`operational-outcome.ts`).
- Priority: DNC → booking → transfer → callback → **interest_confirmed (disposition)** → no_contact → failed → pending.
- **Disposition is checked before `call_status === failed`.** Interested/callback can win while the lead is still Failed.
- `endSession` first computes outcome with `disposition: null`, then async `applyCampaignDispositionOutcome` recomputes with taxonomy.
- Timeline on lead 11810: `pending → failed → interest_confirmed` while `call_status` stayed `failed`.

### 1.3 Disposition

- Taxonomy extract: `disposeCall` (`disposition.ts`) → `calls.disposition_result`.
- Copied to lead: `applyCampaignDispositionOutcome` → `campaign_leads.disposition` as `"primary: sub"` (`disposition-meaning.ts` `dispositionLabelForLead`).
- Extra: `callbackDetector.ts` can set `disposition = 'callback_requested'` (different string).
- **Not cleared on retry.** A later no-connect fail keeps the old label unless a new session disposes again.

### 1.4 Attempts / executions

- `campaign_leads.call_attempts` incremented atomically on dial claim (`campaignCaller.ts`).
- `call_executions` inserted **only on answer** (`recordCallExecution` from `createSession`). No-connect attempts have **no** execution row.
- UI Attempts = lead `callAttempts` vs batch `maxAttempts`. Eye uses `lead.attempts[]` (executions + `call_id`).

### 1.5 Connected / answered

- Lead `connected` = media session started (`createSession`).
- Funnel **Connected** = latest `call_status ∈ {connected, completed, transferred}` — **not** answered-ever.
- A lead that answered and then `failed` (mid-drop) is **not** in Connected KPI.

### 1.6 Duration / cost / Call ID

- `campaign_leads.call_id` overwritten to the **new** `calls.id` on every answer (`recordCallExecution`).
- Unanswered retry does **not** change `call_id`.
- Workspace duration/cost/executionId: lookup `calls` where `id = lead.callId` (`batch-workspace.ts` ~387–468).
- **Same call as disposition** when the last answer produced both. **Not** the same as `call_status` when mid-drop marked the lead failed.

### 1.7 Retry

- `call_retries` via `scheduleRetry`. Reasons used in prod: `network_drop`, `busy`, `no_pickup`, `failed`, `voicemail`, `stuck_calling`.
- `endSession` schedules `network_drop` when `midConvDrop`.
- Retry fire sets lead `pending`, then dial. `completed` leads **cancel** pending retries (`retryEngine.ts` ~127). `failed` leads **are** retried.

### 1.8 Latest vs previous attempt (what supplies each cell)

| Cell | Which attempt |
|---|---|
| Status | **Latest lead write** (often mid-drop `failed`, or later busy/no-answer webhook) |
| Disposition | Latest **answered** session’s `disposeCall` (retry without answer leaves previous) |
| Duration / Cost / Call ID | Latest **answered** `calls` row (`lead.call_id`) |
| Connected KPI | Latest lead `call_status` only |
| Attempts counter | Dial claims (includes no-connect) |

Production check on batch 412 multi-exec Failed leads: **25/25** displayed `call_id` = last execution. So the Interested/38s row is **same execution** for duration+disposition+call id; Status is the other machine.

---

## 2. Status dictionary (do not trust the label)

### `calling`
Claimed outbound slot. `campaignCaller` / scheduler. Counts against concurrency (includes ringing).

### `connected`
Answered, session live. `createSession` in `session.ts` ~1806. Still counts against concurrency.

### `completed`
Lead-level: `endSession` when **not** voicemail, **not** transferred, **not** `midConvDrop`.  
Call-level: almost every session with turns is stored as `calls.status='completed'` even when the lead is `failed`.

### `transferred`
`session.wasTransferred`.

### `failed` (the overloaded one)
Written when:

| Path | File | Meaning |
|---|---|---|
| **A. Mid-conversation drop** | `session.ts` ~3166–3202 | Answered, duration **> 15s**, no `naturalEndTriggered`, not transferred → lead `failed`, retry `network_drop`. **Call row still `completed`.** |
| Silent agent | `session.ts` ~2992–3004 | Caller audio, no agent audio → **calls.status** `failed` (lead uses midConvDrop/completed separately) |
| Carrier terminal (never connected) | `webhooks.ts` `FAILED_STATUSES` | `failed`/`canceled`/`congestion`/`machine`/`voicemail`/… → lead `failed` (AMD voicemail here is **not** `voicemail`) |
| Unknown status while still `calling` | `webhooks.ts` ~168–174 | Treated as `failed` to free the slot |
| Dial throw | `campaignCaller.ts` ~430–435 | e.g. `fetch failed` |
| Max attempts on a claimed slot | `campaignCaller.ts` ~215–228 | notes `Max attempts` |
| Stuck sweep | `batchScheduler.ts` ~633–660 | `calling`/`connected` > 15 min |
| Unknown webhook | same | |

**`midConvDrop` does not use `hasClosingSignal`.** Closing phrases set `calls.conversation_completed` / `calls.status=completed` but the lead can still be Failed.

### `busy` / `no_pickup`
Webhook map (`webhooks.ts` `mapRawStatusToLeadStatus`). Only if lead is still `calling`/`connected`. Hangup `completed`/`hangup`/`answered` → **ignore** (endSession owns it).

### `voicemail`
`endSession` AMD/transcript/tool. Webhook `machine`/`voicemail` currently map to **`failed`**, not `voicemail`.

---

## 3. Hypotheses A–G against production (batch 412)

| # | Hypothesis | Result |
|---|---|---|
| A | Connected then technical fail after answer | **Primary.** 104 Failed leads have `calls.status=completed` and duration > 0. 102 have `conversation_completed=false`. Retry reason `network_drop`. This is `midConvDrop`. |
| B | Later retry failed after earlier successful talk | **Also real.** 58 Failed leads have `call_attempts>=2` and ≥1 answered execution. Retry fire does not clear disposition/`call_id`. |
| C | `call_status` overwritten by latest attempt | **Yes, by design.** Single column. Retry → `pending` → terminal again. |
| D | UI mixes fields from different executions | **Not for duration vs disposition vs Call ID** (same `lead.call_id`). **Yes for Status vs those three** (lead failed vs call completed). If retry never answers, duration is still the previous talk. |
| E | Hangup webhook turns answered call to failed | Possible if raw status ∈ `FAILED_STATUSES` while lead still `connected`. Dominant evidence is `network_drop` from `endSession`, not webhook `failed`. |
| F | KPI Failed counts latest technical status | **Yes.** `count(*) filter (where call_status = 'failed')` — **leads**, latest `call_status`. |
| G | Other | 24 never-connected (`fetch failed`, queue notes, no `calls` row). 38 notes still `Queued — concurrency limit (10)`. 0 stuck-sweep notes. |

---

## 4. Classification of current Failed leads (n=128)

Exclusive (sum 128):

| # | Category | Count |
|---|---|---|
| 1 | Never connected — genuine failure (no `call_id`, duration 0) | **24** |
| 2 | One answered session, then lead marked failed (mid-drop / network_drop) | **46** |
| 3 | ≥2 attempts, at least one answered execution, currently failed | **58** |
| 7 | Unknown/other | **0** |

Overlaps (same leads can sit in 1–3 above):

| # | Category | Count |
|---|---|---|
| 4 | Positive disposition (`outcome: interested`) but Failed | **2** |
| 5 | Callback requested but Failed | **6** |
| 6 | `calls.status=completed` vs lead `failed` (duration shown from that call) | **104** |

Duration histogram on Failed: 24 at 0s · 0 in 1–15s · **101 in 16–60s** · 3 > 60s.  
The 16s floor matches `durationSeconds > 15` in `midConvDrop`.

KPI: Failed=128, Connected=347, both on one lead=**0**. Failed ∩ Interested operational=**2**. Failed ∩ callback operational=**2** (4 more have callback **disposition** but `operational_outcome=no_contact`).

---

## 5. Real examples (campaign 449 / batch 412)

**User’s pattern — Failed + 38s + interested (same call, two status machines)**

Lead **11431**: attempt 1 18s busy → `network_drop` retry. Attempt 2 call **26477** 38s, `calls.status=completed`, `conversation_completed=false`, disposition `outcome: interested`. Lead `call_status=failed`, `operational_outcome=interest_confirmed`. Notes `Auto-retry #2`. Timeline: `failed` then `interest_confirmed`.

Lead **11810**: single attempt call **26441** 29s completed / interested. Lead Failed, `interest_confirmed`. Retry `network_drop` still **pending**.

**Failed + 18s + call back requested**

Lead **11414**: attempt 1 33s busy; attempt 2 call **26475** 18s `call back requested`, calls completed. Lead Failed, `callback_requested`.

Lead **11717**: 38s, `outcome: busy`, calls completed, lead Failed, retry pending. Same badge as Interested rows.

**Never connected**

Lead **10859**: attempts 2, no `call_id`, notes concurrency queue, retry `failed:fired`. Genuine Failed.

**Answered-ever but latest retry did not connect (duration from earlier talk)**

Lead **10925**: 289s callback, `conversation_completed=true`, only 1 execution, attempts=2, last webhook raw `busy`, lead Failed. Duration is the **previous** conversation.

---

## 6. Answers to the product questions

**Should `call_status` be latest attempt or lead-level telephony history?**  
Today it is **latest lead write**, used as both live slot state and terminal outcome. It is **not** answered-ever history.

**Should an answered lead ever return to `failed` at lead level?**  
Today **yes**: `midConvDrop` exists specifically to retry answered hangups. That is why Failed includes conversations.

**Is Connected answered-ever or latest-attempt?**  
**Latest-attempt lead status.** Answered-then-failed is excluded from Connected.

**Why does Failed include conversation duration?**  
Because the UI duration is `calls.duration_seconds` for `lead.call_id` (the answered session), while Status is lead `failed` from mid-drop or a later attempt.

**Is batch KPI Failed counting leads or executions?**  
**Leads** (`campaign-lead-funnel.ts`).

**Can one lead be Connected and Failed?**  
**Not on `call_status` (single value).** It **can** be Failed KPI and Interested KPI (`operational_outcome`) at once. It **can** show Failed + a completed call’s duration.

**Are KPI buckets mutually exclusive?**  
Telephony chips (Failed / Busy / No pickup / Connected) are exclusive — they all use `call_status`. Interested / Booked / Transferred use `operational_outcome` and **overlap** Failed.

**Which field is the lead’s final business result?**  
`disposition` + `operational_outcome`.

**Which field is technical attempt diagnostics?**  
`call_status` (and `calls.status` / retries / notes). Today the UI treats `call_status` as the main Status.

---

## 7. Files

- `artifacts/api-server/src/orchestration/session.ts` — `createSession` connected; `endSession` midConvDrop → lead failed  
- `artifacts/api-server/src/routes/webhooks.ts` — `mapRawStatusToLeadStatus`, `handleCampaignLeadTerminalStatus`  
- `artifacts/api-server/src/orchestration/campaignCaller.ts` — claim, dial fail, `recordCallExecution`  
- `artifacts/api-server/src/services/retryEngine.ts` — pending overwrite, skip if `completed`  
- `artifacts/api-server/src/services/batchScheduler.ts` — stuck sweep  
- `artifacts/api-server/src/services/operational-outcome.ts` — disposition beats failed  
- `artifacts/api-server/src/services/campaign-disposition-outcome.ts`  
- `artifacts/api-server/src/lib/campaign-lead-funnel.ts` — KPI SQL  
- `artifacts/api-server/src/routes/batch-workspace.ts` — leads payload  
- `artifacts/dashboard/src/pages/campaigns/[id]/batches/[batchId].tsx` — Status / Duration / Disposition columns
