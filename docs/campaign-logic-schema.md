# Campaign logic schema (A–Z)

**Date:** 2026-09-19  
**What this is:** how campaigns actually work in code and data. Not visual chrome.  
**Source:** `lib/db/src/schema/campaigns.ts`, `campaign-crm.ts`, `campaign-ops.ts`, `campaign-reports.ts`; dial/refill in `batchScheduler.ts` + `campaignCaller.ts`; outcomes in `operational-outcome.ts` + `disposition/canonical.ts`; surfaces in `artifacts/dashboard/src/pages/campaigns/`.

---

## Why “4 Interested” cannot be clicked, and why dispositions are not the main filter

These are logic gaps, not paint.

1. **Overview Interested is a count, not a list.**  
   Campaign overview batch card (`campaigns/[id].tsx` `BatchKpiCard`) shows chips: Connected, Booked, Interested, Failed, Busy, No pickup, Callbacks.  
   Clicking the **card** (anywhere, including Interested) opens the whole batch workspace. It does **not** pass a filter. There is no `?outcome=interest_confirmed` from overview.

2. **Interested is not a clickable KPI on the batch page either.**  
   Batch workspace clickable cards (`coreSegments`) are: Total, Pending, Connected, Voicemail, Transferred, Failed, Busy, No pickup.  
   **No Interested card.** So the 4 leads counted as Interested have no one-click segment.

3. **Disposition filter exists, but it is a buried dropdown, not the main filters.**  
   Batch leads table has a header **Disposition** menu (`disp:` segment → `outcome=` query). That is the only place agent taxonomy filters the list. Overview and Live Queue do not use it as primary chips.

4. **Two different “interested” fields.**  
   Overview **Interested = 4** uses `operational_outcome ∈ {interest_confirmed, booking_created, transfer_completed}`.  
   Operator’s real filter is `campaign_leads.disposition` (agent label, e.g. `outcome: interested`). Those can disagree.

---

## A — Objects (tables)

| Object | Table | One row is |
|---|---|---|
| Campaign | `campaigns` | A dialer job: agent/squad, from-number, hours, concurrency, source type |
| Batch | `campaign_batches` | One import wave inside a campaign (CSV file, Meta pull, …) |
| Lead | `campaign_leads` | One phone to dial |
| Lead source | `lead_sources` | Named import definition + default field map |
| Call execution | `call_executions` | One outbound attempt + later AI analysis |
| Retry | `call_retries` | Scheduled next attempt |
| Callback | `call_callbacks` | Caller asked to be called back at a time |
| Incoming | `incoming_calls` | They called us back (does not change `call_status`) |
| Booking | `call_bookings` | Calendar booking from the call |
| Transfer (human) | `lead_transfers` / call transfers | Hand-off to a person |
| Timeline | `lead_timeline` | Immutable event log |
| Notes / tasks | `lead_notes`, lead tasks | CRM on the lead |
| DNC | `workspace_dnc` | Workspace do-not-call, match on `normalized_phone` |
| Interaction summary | `lead_interaction_summaries` | Cached last summary/sentiment |
| Daily metrics | `batch_daily_metrics` | Per batch per UTC day rollup |
| Report definition | `campaign_report_definitions` | Saved analytics email/dashboard blocks |
| Consent | `campaign_consent_basis` | Why this list may be dialed |
| Agent taxonomy | `agent_dispositions` | Categories + outcomes + meaning map |

A campaign has many batches. A batch has many leads. A lead has many executions, retries, timeline rows.

---

## B — Campaign lifecycle (`campaigns.status`)

| Status | Meaning | Dial? |
|---|---|---|
| `draft` | Created, no live dial | No |
| `active` | Allowed to dial | Yes, if a batch is running |
| `listening` | Idle inbound / waiting on webhook leads | Continuous sources |
| `paused` | Operator pause | No new dials; live calls finish |
| `stopped` | Operator stop | No; can activate again |
| `completed` | Used on some list UIs | Treat as finished |

Pause/resume/stop helpers: `artifacts/dashboard/src/lib/campaign-lifecycle.ts`.  
`isActive` boolean also exists; status is the real gate (`isCampaignDialable` in scheduler).

Campaign fields that steer dialing:

- `agentId` / `squadId` — who talks  
- `fromNumber` — CLI  
- `leadSource` — `csv` \| `webhook` \| `meta_ads` \| `crm` \| `google_sheets`  
- `triggerMode` — `instant` \| `batch`  
- `concurrentCallLimit` — per-campaign live slots (UI hard max 10; env `CAMPAIGN_MAX_CONCURRENT_CALLS`)  
- `callDelaySeconds`, `maxAttempts`, `retryDelayMinutes` — defaults; batch can override  
- `timezone`, `businessHoursStart/End`, `isCallingHoursEnabled`  
- `fieldMappings` — `{ phone, name?, email?, … }`  
- `leadTransfer`, `afterCallBranches`, `analyticsQuestions`

Server-wide extra cap: `PLATFORM_MAX_CONCURRENT_CALLS` (counts leads in `calling` + `connected` across **all** campaigns). Account cap: `users.concurrent_limit` (session lease). Effective live sessions = min of those.

---

## C — Batch lifecycle (`campaign_batches.status`)

| Status | Meaning |
|---|---|
| `draft` | Imported or scheduled; not dialing |
| `running` | Scheduler may claim pending leads |
| `paused` | No new claims |
| `completed` | No more work |
| `stopped` | Operator stopped; can restart |
| `cancelled` | Dead |

CSV path: wizard `POST /campaigns/:id/batches` → leads `pending` → `fireStartBatch` claims `pending` → `calling` (stamps `last_attempt_at`) → `scheduleCampaignCall`.

Duplicate policy on batch: `ignore` \| `skip` \| `reject_with_report`.

---

## D — Lead `call_status` (telephony / dialer)

This is “where is this lead in the phone machine.”

| Value | Meaning |
|---|---|
| `pending` | Not claimed |
| `queued` | Waiting (same family as pending for claims) |
| `calling` | Slot taken: ringing / connecting (counts against concurrency) |
| `connected` | Live answered (in progress) |
| `completed` | Answered call ended (also counted as “Connected” in funnel KPIs) |
| `transferred` | Handed to human |
| `voicemail` | AMD / voicemail |
| `busy` | Busy |
| `no_pickup` | No answer |
| `failed` | Carrier/system fail |
| `skipped` | DNC / invalid / not dialed |
| `exhausted` | Retries used up (maps to operational `failed`) |

Funnel **Connected** = `call_status ∈ {connected, completed, transferred}`.  
That is **answered ever**, not “talking now”. Live talking is only `connected` (and sometimes still `calling` while ringing).

---

## E — Lead `operational_outcome` (system funnel)

Written only by `computeOperationalOutcome` / `setOperationalOutcome`. Not by the LLM.

Priority order:

1. DNC (`workspace_dnc` or meaning map `dnc`) → `dnc_blocked`  
2. Has booking → `booking_created`  
3. Completed transfer → `transfer_completed`  
4. Pending callback or meaning `callback` → `callback_requested`  
5. Meaning `interested` **or** disposition matches default positive set → `interest_confirmed`  
6. Max attempts and never connected → `no_contact`  
7. `call_status` failed/exhausted → `failed`  
8. Else → `pending`

Default positive disposition tokens: `interested`, `very_interested`, `wants_callback`, `follow_up`, `hot`, `warm` (normalized). Agent meaning map can mark extra taxonomy labels as Interested / Callback / DNC.

**Overview Interested KPI** = count of leads with  
`operational_outcome ∈ {interest_confirmed, booking_created, transfer_completed}`.

---

## F — Lead `disposition` (agent taxonomy — operator’s real filter)

Set **after the call** by `disposeCall` from:

- Builder taxonomy (`agent_dispositions.taxonomy`: category → outcomes[])  
- Stored on the lead as `"primary: sub"` (example: `outcome: interested`, `outcome: busy`)

Canonical buckets (`lib/disposition/canonical.ts`) collapse synonyms for analytics:  
`no answer` / `NOT_CONNECTED` → `no pickup`; `hot lead` → `interested`; `declined` → `not interested`; etc.

This string is what operators mean by “filter by disposition.”  
It is **not** what overview chips filter on.

---

## G — Funnel KPIs (one SQL, two screens)

Shared select: `campaignLeadFunnelSelect()` in `campaign-lead-funnel.ts`.

| Chip | SQL |
|---|---|
| Imported / Total | all leads |
| Called | `call_attempts > 0` |
| Connected | `call_status in (connected, completed, transferred)` |
| Interested | `operational_outcome in (interest_confirmed, booking_created, transfer_completed)` |
| Booked | `operational_outcome = booking_created` |
| Transferred | `operational_outcome = transfer_completed` |
| Failed | `call_status = failed` |
| Busy | `call_status = busy` |
| No pickup | `call_status = no_pickup` |
| Voicemail | `call_status = voicemail` |
| Pending | `call_status = pending` |
| Success rate | Interested / Called |

Batch workspace extra: callbacks (two tables), incoming, bookings, transfers, cost, ETR, **disposition histogram** (`dispositions[]` canonical keys + `undispositioned`).

---

## H — Lead sources

`campaigns.leadSource` + per-batch `campaign_batches.leadSource` / `leadSourceId`.

| Source | How leads arrive |
|---|---|
| `csv` | Batch wizard upload |
| `webhook` / website form | Inbound form → campaign token |
| `meta_ads` | Meta leadgen webhook + Graph fetch |
| `google_sheets` | Sheet auto-calls / mapping |
| `crm` | CRM / Zoho-style |

Field map: source column → `phone` / `name` / `email` / extra `lead_data` keys (pushed into call variables).

---

## I — Import and identity

- Phone stored raw + `normalized_phone`  
- Duplicate: `duplicateOfLeadId`, `duplicateStatus`; policy on batch  
- `externalLeadId` for Meta/webhook idempotency  
- Consent basis required for activate on some paths (IRDAI gate on agent can block start)

---

## J — Dial engine (outbound)

1. Batch `running` + campaign dialable.  
2. `refillCampaignConcurrency` / `fireStartBatch`:  
   slots = `concurrentCallLimit − count(calling|connected)` then min with platform headroom.  
3. Atomic claim: `UPDATE … SET call_status='calling', last_attempt_at=now() WHERE pending|queued LIMIT slots`.  
4. `scheduleCampaignCall` → Vobiz/Twilio/Plivo dial.  
5. Answer → media WS → `createSession` → `reserveCall(users.concurrent_limit)`.  
6. Hangup / busy / no-answer webhook → terminal `call_status` → refill.

Ringing occupies a `calling` slot. That is why “6 concurrent” is not “6 talking.”

Stuck `calling`/`connected` swept every 60s (`STUCK_CALLING_TIMEOUT_MS`) so ghosts do not fill the cap.

---

## K — Concurrency (three ceilings)

| Cap | Where | Counts |
|---|---|---|
| Campaign | `campaigns.concurrent_call_limit` | This campaign `calling`+`connected` |
| Platform | `PLATFORM_MAX_CONCURRENT_CALLS` | All campaigns `calling`+`connected` |
| Account | `users.concurrent_limit` | Live `voice_call_leases` at session start |

CSV UI max concurrent = 10 (`CAMPAIGN_MAX_CONCURRENT_CALLS`, dashboard `MAX_CONCURRENT_CALLS = 10`).

---

## L — Retries

Table `call_retries`: `pending` \| `fired` \| `cancelled`.  
Reasons: `no_answer` \| `busy` \| `failed` \| `voicemail` \| `manual`.

`maxAttempts` / `retryDelayMinutes` from batch else campaign.  
`processRetries` fires due rows (after `callDelaySeconds`). Pending retries are the real “still in queue” after first-pass pending hits 0.

---

## M — Callbacks

- Detected from transcript / `schedule_callback` tool  
- `call_callbacks` + `scheduled_callbacks`  
- Sets operational `callback_requested`  
- Campaign tab `callbacks`

---

## N — DNC

`workspace_dnc` per account, `normalized_phone`.  
Pre-dial skip → `skipped` / `dnc_blocked`.  
Disposition meaning `dnc` also sets `dnc_blocked`.

---

## O — After the call (always async)

On hangup (enough transcript):

1. Archive + caller memory extract (if phone key exists)  
2. `disposeCall` → `campaign_leads.disposition`  
3. Recompute `operational_outcome`  
4. `call_executions` intelligence (summary, sentiment, intent, purchase score, …)  
5. Lead transfer rules if disposition matches  
6. After-call branches (WhatsApp / email / webhook)  
7. Timeline `disposition_set` / `call_ended`  
8. `refillCampaignConcurrency`

No disposition → `undispositioned`; overview Interested stays 0 for that lead.

---

## P — Lead transfer and after-call branches

`campaigns.leadTransfer`: enabled + rules `{ dispositions[], destination: webhook|google_sheets, fieldMap }`.  
`campaigns.afterCallBranches`: `{ dispositions[], actions: whatsapp|email|webhook }`.  
Match is on stored disposition labels, not on overview KPI buckets.

---

## Q — Bookings and human transfers

Booking → `call_bookings` + `operational_outcome = booking_created`.  
Human transfer → transfer tables + `call_status = transferred` + `transfer_completed`.

---

## R — Screens vs logic (what each tab actually is)

| Surface | Route | Logic |
|---|---|---|
| Campaign list | `/app/campaigns` | Filter by **source** and **campaign status** only |
| Overview | `/app/campaigns/:id` | Batches + KPI **counts**; click = open batch, no filter |
| Batch workspace | `.../batches/:batchId` | KPI chips filter **call_status** (and transferred outcome); Disposition **dropdown** filters `disposition` |
| Live queue | tab `live-queue` | Operational floor: queued/calling/connected/retry; polls ~10s |
| Incoming | `incoming` | Inbound matches |
| Callbacks | `callbacks` | Callback queue |
| Transfers | `transfers` | Human transfers |
| Bookings | `bookings` | Meetings |
| Config | `config` | Hours, concurrency, transfer, agent |
| Lead | `.../leads/:leadId` | One lead CRM |
| Recampaign | dialog | Clone leads by **disposition list** and/or no-pickup/failed into a new draft batch |

Live Queue “Interested” badge maps `operational_outcome = interest_confirmed`. It is not the overview chip.

---

## S — Filters that exist today

| Place | Filter dimension |
|---|---|
| Campaign list | source, campaign status |
| Overview chips | **none** (display only) |
| Batch KPI cards | `call_status` pending/connected/voicemail/failed/busy/no_pickup + `operational_outcome=transfer_completed` |
| Batch Disposition dropdown | agent taxonomy → `disposition` string |
| Batch search | name/phone |
| Live queue | operational status / search / bulk actions |
| Recampaign | selected disposition labels + failed/no-pickup flags |
| Reports | optional `filters.dispositions[]` |

**Missing as primary chips:** Interested (`interest_confirmed`), raw disposition buckets as first-class KPI cards on overview, talking vs ringing.

Lead list API: `GET .../workspace/leads?status=&outcome=&search=&page=`  
`outcome=all|booking_created|transfer_completed|callback_requested|__undispositioned__|<taxonomy label>`.  
There is **no** `outcome=interest_confirmed` wired from a chip (API could take a taxonomy label; UI never sends Interested).

---

## T — Recampaign

Operator picks disposition keys (and/or no-pickup/failed) → new **draft** batch of cloned leads. This is the only productized “give me all Interested / Not interested as a list to act on” path, and it is a clone-forward, not a view of the current 4.

---

## U — Hours, IRDAI, consent

Calling hours: campaign timezone + start/end hours; skip outside window.  
IRDAI: agent compliance can **409 start**.  
Consent basis stored per campaign for marketing lists.

---

## V — Analytics questions and reports

`campaigns.analytics_questions` → filled on `call_executions.analytics_answers`.  
Report blocks: kpis, dispositions, sentiment, purchase funnel, objections, agent performance, custom questions, hot leads.

---

## W — Timeline and executions

Every state change should write `lead_timeline` (`call_started`, `disposition_set`, `retry_scheduled`, …).  
`call_executions.attempt_number` = which try. `outcome` on execution is attempt-level, separate from lead `call_status`.

---

## X — Inbound / webhook campaigns

`webhookToken` + optional HMAC. Meta: encrypt page token, validate `sourceFormId`. Instant trigger can dial on insert instead of batch start.

---

## Y — Identity of a “result” the operator wants

When someone says “show Interested”:

| Layer | Field | Example |
|---|---|---|
| Dial result | `call_status` | `completed` |
| Funnel | `operational_outcome` | `interest_confirmed` |
| Agent label | `disposition` | `outcome: interested` |

The number **4** on overview is the funnel layer. The list they want to click is the lead rows behind that SQL. That click is not implemented. The labels they want to filter by are the disposition layer, only in the batch dropdown.

---

## Z — Gaps to fix when you open this (logic, not theme)

1. Overview / batch **Interested** chip → filter leads `operational_outcome in (interest_confirmed, booking_created, transfer_completed)` and land on that list (clickable, selectable).  
2. Make **disposition** the primary filter row (chips from taxonomy + observed buckets), not a header dropdown.  
3. Split **Connected** into talking-now (`connected`) vs answered-ever (`completed`).  
4. Show **retry queue** (`call_retries.status=pending`) as first-class “still to dial”.  
5. Optional: one URL `?disposition=` / `?outcome=` from overview so the 4 leads are a real selection.

No new OSS campaign product required for 1–5; the data is already on `campaign_leads`.
