# Campaign page UI / UX schema + problems

**Date:** 2026-09-19  
**Scope:** every campaign surface in the customer dashboard. Layout, chrome, clicks, empty states, and every UX problem found in live code.  
**Not this file:** product-wide tokens (see `docs/ui-ux-schema.md`). Dial/retry/outcome **logic** (see `docs/campaign-logic-schema.md`).  
**Source:** `artifacts/dashboard/src/pages/campaigns/**`, `App.tsx` routes.

---

## 0. Operator job (what the pages are for)

A campaign operator needs, in order:

1. Start a list (CSV / form / Meta / Zoho / Sheets).
2. See **who is queued / ringing / talking** right now.
3. After the run: **filter by disposition** and act (export, redial, transfer, open the lead).
4. Change hours, concurrency, agent, transfer.

The current UI is built around **campaigns → batches → telephony status**. Disposition and Interested are secondary or display-only. That mismatch is the core of the problems below.

---

## 1. Route map

| URL | File | What the operator sees |
|---|---|---|
| `/app/campaigns` | `tabbed.tsx` → `index.tsx` | List of campaigns + “New from” sources |
| `/app/campaigns/:id` | `[id].tsx` | One campaign. Tabs via `?tab=` |
| `/app/campaigns/:id?tab=overview` | same (default, no query) | Batch cards + optional disposition **actions** |
| `/app/campaigns/:id?tab=analytics` | `campaign-analytics-tab.tsx` | Ask / Reports / Results |
| `/app/campaigns/:id?tab=live-queue` | `live-queue.tsx` | Floor: queued / calling / connected / retry |
| `/app/campaigns/:id?tab=incoming` | `incoming.tsx` | Inbound calls on this campaign |
| `/app/campaigns/:id?tab=callbacks` | `callbacks.tsx` | Scheduled callbacks |
| `/app/campaigns/:id?tab=transfers` | `transfers.tsx` | Human transfers |
| `/app/campaigns/:id?tab=bookings` | `bookings.tsx` | Meetings booked |
| `/app/campaigns/:id?tab=config` | `[id].tsx` config block | Hours, lead transfer, source extras |
| `/app/campaigns/:id/batches/new` | `batch-wizard.tsx` | 7-step Create Batch |
| `/app/campaigns/:id/batches/:batchId` | `[id]/batches/[batchId].tsx` | Batch workspace: KPI chips + leads table |
| `/app/campaigns/:id/leads/:leadId` | `[id]/leads/[leadId].tsx` | Lead CRM (exists; **almost nothing links here**) |

Leaves this product: Website / Meta “New from” → `/app/connections?setup=…`. Sheets → `/app/automatic-calls/new`. Header **View Analytics** → `/app/analytics?campaignId=`.

---

## 2. List page — `/app/campaigns`

**Chrome:** `StripePage` title **Campaigns**. Description: “Start a campaign from Meta, Website, Google Sheets, CSV, or Zoho CRM.” `fullBleed`, locked scroll.

### 2.1 Top strip — “New from”

Chips (not a single primary CTA): **Meta · Website · Sheets · CSV · Zoho**.

| Chip | Goes to |
|---|---|
| Meta | Connections Meta setup |
| Website | Connections website setup |
| Sheets | Automatic Calls wizard (different product) |
| CSV | In-page `CampaignWizard` dialog |
| Zoho | OAuth if disconnected, else same dialog locked to CRM |

### 2.2 MetricStrip (only if ≥1 campaign)

6 tiles, not clickable: **Active · Listening · Live calls · Queued · Leads (today) · Booked (today)**. Poll 10s.

### 2.3 Toolbar

Search (name / agent) · Source select · Status select · Clear · Export CSV · Campaign guide (sheet).

**No disposition filter. No Interested filter.**

### 2.4 Table (md+)

Grid columns: Campaign · Status · Agent / Number · Live · Batches · Progress · Queued · Booked · actions.

Row click → campaign detail. Open button same. ⋮ = Edit / Pause / Resume / Activate / Stop / Delete.

Progress = `completedLeads / totalLeads` (answered-ish / imported), **not** talking-now.

Live = `callingLeads` (includes ringing). Same word as Live Queue “Connected” (talking) — different numbers.

### 2.5 Mobile

Separate `CampaignMobileCard` (`md:hidden`). Same click. Desktop row and mobile card **both rendered** in the DOM.

### 2.6 Empty / error

- No campaigns: **Start a CSV campaign** + Campaign guide.
- Filter miss: Clear filters.
- Load fail: Retry.

### 2.7 Create campaign dialog (`CampaignWizard`)

Steps: **Details → Source → CRM Mode (Zoho only) → Agent → Transfer → Settings → Review**.  
From “New from” chips, source is locked (CSV or CRM). Website/Meta/Sheets never use this dialog.

Settings include concurrency, delay, attempts, hours. Caller ID is taken from the agent’s number, not asked here.

Edit campaign = `CampaignFormDialog` (rename / fields), not the full wizard.

---

## 3. Campaign detail — `/app/campaigns/:id`

**Chrome:** `DetailNav` crumbs (Campaigns → name). Header left: name + status badge + `Agent #{id}` + from-number + source chip.

**Header right (overflows on small screens):**

| Control | When |
|---|---|
| View Analytics | always → **global** `/app/analytics` |
| Delete (ghost trash) | always |
| Campaign Completed badge | batch-mode + all batches terminal + 0 pending retries |
| Re-campaign | finished **or** any dispositions / failed |
| Create Batch | not continuous, or draft continuous |
| Activate | continuous + stopped |
| Pause / Resume / Stop | active or paused |

Status badge can show **Listening** when instant + active + no running batch.

### 3.1 Tab bar (8 tabs, horizontal scroll)

Overview · Analytics · Live Queue · Incoming · Callbacks · Transfers · Bookings · Configuration.

Underline `border-primary`. Overview has **no icon**; others do.

### 3.2 Overview tab

Scroll region `maxHeight: calc(100vh - 248px)`.

**Order on the page:**

1. Google Sheets banner (if sheet auto) → Live Queue / Pipeline.
2. **Dispositions action list** — only if `analytics.dispositions.length > 0`. Each row: label + count + **Export · Transfer · Create batch**. Row itself is **not** a filter. Does not open the 4 Interested leads.
3. Amber banner if `queuedLeadsCount > 0`.
4. **Batches** heading. Cards via `BatchKpiCard` (instant campaigns: grouped “Daily Batches”).

**There is no campaign-wide KPI strip on overview.** `resolveCampaignOverviewMetrics` is computed and then only `failed` is used (to decide whether to show Re-campaign). Imported / Called / Connected / Interested campaign totals are **not painted**.

### 3.3 Batch KPI card (the “4 Interested” card)

Shows: batch name, status, source, agent name (from KPI API), lead count, last activity, ETR, % called bar.

Chips (only if count > 0): **Connected · Booked · Interested · Failed · Busy · No pickup · Callbacks**.

**Click contract:** entire card (`window.location.href`) → batch workspace, **no query, no segment**. Chips are `<span>`, not buttons. Interested is not selectable.

Full page reload (not wouter). Delete is only on dead `BatchRow`, which is **not rendered**.

### 3.4 Analytics tab

Inner: **Results · Ask · Reports**. Purchase intent, emotion, objections, hot leads, NL insight, email reports. Separate from overview chips and from header “View Analytics”.

### 3.5 Live Queue tab

Clickable metric cards: **Queued · Calling · Connected · Retry · Callbacks · No Pickup · Exhausted**. Toggle off → all.

Search. Bulk: Retry / Pause selected. Row → lead **drawer** (not lead profile page). Poll 10s.

**Connected here = talking now.** Overview Connected = answered ever. **Failed here is labelled Exhausted.** Overview Failed = `call_status=failed`. Same English, three meanings.

No disposition chip row.

### 3.6 Incoming / Callbacks / Transfers / Bookings

Each is its own table + status chips + bulk-ish actions. Disposition column exists on Incoming and Callbacks (hidden until sm/md). These are **event lists**, not the campaign lead funnel.

### 3.7 Configuration tab

- Webhook URL (non-CSV with token)
- Meta integration card
- Zoho import/guide
- Lead transfer settings + Save
- Calling hours (toggle, start/end hour 0–23, timezone)
- CSV: extra dashed card **“No extra configuration needed”** even though hours + transfer sit above it

**Not on this tab:** concurrency, max attempts, retry delay, agent swap, squad, disposition taxonomy (taxonomy lives on the **agent** builder). Operator cannot change concurrent cap without Edit on the list page.

### 3.8 Re-campaign dialog

Pick disposition labels and/or no-pickup/failed/busy/skipped → clone into a **new draft batch**. Does not **view** the current 4 Interested; it copies them forward.

### 3.9 Dead UI still in `[id].tsx`

Unused: `CampaignTabPlaceholder` (“Coming in Phase 3”), `CreateBatchWizard` (4-step dialog; real path is `/batches/new`), `BatchRow`. Inflates the file; Create Batch in the header goes to the 7-step page.

---

## 4. Create Batch — `/app/campaigns/:id/batches/new`

7 steps: **Batch Info → Source Config → Variable Mapping → Validation → Duplicate Policy → Execution Rules → Review & Launch**.

CSV: upload, map phone/name/email, duplicate policy, max attempts, retry delay, schedule. Footer Next / Create.

Non-CSV skips some steps (CRM still walks all). Long; execution rules (the numbers that decide talk/retry) are step 6.

---

## 5. Batch workspace — `/app/campaigns/:id/batches/:batchId`

**Chrome:** crumbs Campaigns → campaign → batch. Title + batch status. From-number, agent name, source.

**Actions:** Export CSV · Start · Pause · Stop. Terminal batch: “Batch Completed” (no Start).

### 5.1 Call outcomes strip (clickable)

Copy: “Click any card to filter the list.”

Cards: **Total Leads · Pending · Connected · Voicemail · Transferred · Failed · Busy · No pickup**.

**No Interested. No Booked. No Callbacks. No disposition chips.**

Click sets `segment` → `status` / `outcome` query on `GET …/workspace/leads`.

### 5.2 Leads table

Columns: Lead (name+phone) · Date · Call ID · **Status** (`call_status`) · **Disposition** (header is a dropdown of agent taxonomy) · Attempts · Duration · Cost · Actions.

Disposition filter: `disp:` prefix → `outcome=<label>`. **Hidden on viewports `< sm`.**

Search name/phone. Pagination.

**Row is not a link.** Eye → `CallDetailDrawer` (recording/transcript). Retry icon if `failed`. **No navigation to `/leads/:leadId`.**

Fullscreen toggle exists.

### 5.3 Lead profile — `/leads/:leadId` (orphan)

Three-zone: header, tabs **Overview / Interactions / Timeline / Notes / Memory / Tasks**, right sidebar.

This is the CRM the operator would use after picking Interested. Batch table and overview chips do not open it. Live Queue uses a thinner drawer instead.

---

## 6. Click contract (what happens today)

| User click | Actual result |
|---|---|
| List metric “Live calls” | nothing |
| List row | campaign overview |
| Overview Interested = 4 | whole batch, unfiltered, full reload |
| Overview Connected / Failed chips | same, unfiltered |
| Overview disposition row | not a list; Export / Transfer / Create batch only |
| Overview disposition label | nothing |
| Header View Analytics | **different app page** `/app/analytics` |
| Tab Analytics | in-campaign Ask/Reports/Results |
| Live Queue Connected | talking-now list |
| Batch KPI Connected | answered-ever list |
| Batch Disposition dropdown | taxonomy filter (only place) |
| Batch row Eye | call drawer, not lead CRM |
| Re-campaign | new draft batch, leave current view |

---

## 7. Word collisions (same label, different math)

| Label on screen | List | Overview chip | Batch card | Live Queue |
|---|---|---|---|---|
| Live / Calling | `callingLeads` (ring+talk claim) | — | — | `calling` |
| Connected | — | answered ever | answered ever | talking now |
| Interested | — | operational funnel (incl. booked+transferred) | not a card | badge on `interest_confirmed` only |
| Failed | — | `call_status=failed` | same | labelled **Exhausted** |
| Queued | pending-ish | amber banner | Pending card | `queued` metric |
| Progress | completed/total | % called | % called | — |

Disposition vs Interested vs Connected is the collision operators feel as “UI broken”.

---

## 8. Problem catalog

Severity: **P0** blocks the job (see 4 Interested / dispositions). **P1** wrong or conflicting. **P2** clutter / dead / polish.

### P0 — cannot select the result they came for

| ID | Where | Problem |
|---|---|---|
| P0-1 | Overview `BatchKpiCard` | Interested (and every chip) is display-only. Click opens unfiltered batch. The 4 leads cannot be selected. |
| P0-2 | Batch KPI strip | Interested is not a card. After landing from overview, still no one-click Interested list. |
| P0-3 | Overview + batch | Dispositions are the operator’s primary filter. They are **not** the main chips. Overview has an action list (export/transfer/clone) that never **opens** the slice. Batch has a header **dropdown**, hidden on mobile. |
| P0-4 | Batch leads | ~~No click-through~~ **Fixed:** row click → lead profile; menu keeps quick inspect. |
| P0-5 | URLs | No `?outcome=` / `?disposition=` / `?segment=` from overview. Selection cannot be shared or bookmarked. |

### P1 — wrong model, duplicate rooms, conflicting words

| ID | Where | Problem |
|---|---|---|
| P1-1 | Three “Connected” | Overview/batch = answered ever. Live Queue = talking now. List “Live” = ringing+claimed. Operator cannot see talking vs done. |
| P1-2 | Interested math vs label | Chip includes `booking_created` + `transfer_completed`. A booked lead inflates Interested. Operator thinks it is the disposition “interested”. |
| P1-3 | Failed vs Exhausted | Same English, different SQL. |
| P1-4 | Two Analytics | Header **View Analytics** leaves the campaign. Tab **Analytics** is a third product (Ask/Reports). Operator does not know which is “the numbers”. |
| P1-5 | Two create-batch UIs | Header → 7-step page. Dead 4-step wizard still in `[id].tsx`. List create-campaign wizard is a third flow. |
| P1-6 | Sheets is not a campaign | “New from Sheets” leaves `/app/campaigns` for Automatic Calls. Campaign overview then explains the split with a banner. |
| P1-7 | Website/Meta leave the page | “New from” does not stay in Campaigns. Mental model: five sources, five products. |
| P1-8 | 8 tabs | Incoming/Callbacks/Transfers/Bookings/Analytics/Config compete with the floor + results. Horizontal scroll; Overview is not a command center. |
| P1-9 | Campaign totals missing | ~~Only unused overviewMetrics~~ **Fixed:** ContactOutcomeHero from lead-reporting (Answered / Retry / Failed=technical). |
| P1-10 | Retry queue invisible on overview | ~~Only Live Queue~~ **Fixed:** Retry chip on ContactOutcomeHero + LiveFloor when retryPending. |
| P1-11 | Ringing vs talking vs cap | No floor viz of slots (e.g. 9 ringing + 1 talking vs concurrent 10). Live Queue has the data; overview and list do not. |
| P1-12 | Config incomplete | Concurrency / attempts / agent not editable on Configuration. CSV shows “no extra config” while hours exist. Taxonomy not here (agent builder). |
| P1-13 | Header `Agent #id` | ~~Detail shows id~~ **Fixed:** `GET /campaigns/:id` returns `agentName`. |
| P1-14 | Batch card full reload | ~~`window.location.href`~~ **Fixed:** wouter `navigate` on batch cards. |
| P1-15 | Disposition actions ≠ view | Export / Transfer / Create batch operate on a slice the operator never sees as a table first. Easy to clone the wrong set. |
| P1-16 | Re-campaign vs Create batch on slice | Two “dial these again” buttons (header Re-campaign vs per-disposition Create batch) plus batch Start. Unclear which to use. |
| P1-17 | Live Queue drawer vs lead page | Two CRM surfaces. Notes/memory/tasks only on the orphan lead page. |
| P1-18 | Status column vs Disposition column | ~~Loud Status~~ **Fixed:** Disposition primary; attempt status muted meta. |
| P1-19 | List Progress | Uses completed/total, not called/total (overview) and not success rate. Third progress definition. |
| P1-20 | MetricStrip not a filter | List Active/Live/Queued cannot drill into those campaigns or leads. |

### P2 — clutter, a11y, leftover, small screens

| ID | Where | Problem |
|---|---|---|
| P2-1 | `[id].tsx` | ~~Dead `BatchRow` / wizard / placeholder~~ **Removed** (orphan delete-batch dialog also gone). |
| P2-2 | List | Desktop row + mobile card both mounted. |
| P2-3 | Detail header | Pause/Stop/Create Batch/Analytics/Delete wrap and fight on mobile. Delete next to Analytics. |
| P2-4 | Overview height | Magic `calc(100vh - 248px)` + inner scroll. Nested scroll with StripePage. |
| P2-5 | Batch KPI | Zero-count chips hidden — cannot click a zero to see empty filter. |
| P2-6 | Disposition dropdown | `< sm` the whole Disposition column (and its filter) disappears. |
| P2-7 | Batch name | Truncated; no delete on the live card. |
| P2-8 | Guide sheet | Repeats New-from chips. |
| P2-9 | Search icon | List search uses Activity icon, not Search. |
| P2-10 | Listening vs Idle | Badge “Listening” vs status map “Idle / Listening”. |
| P2-11 | Color | Interested/Booked both green-family; Failed/Busy/No pickup all warm. Chips don’t scan as a funnel. |
| P2-12 | Analytics inner tabs | Results/Ask/Reports is a product on a product. Empty until analysed. |
| P2-13 | Incoming status | Unreviewed/Reviewed/Actioned is a different status system from call_status. |
| P2-14 | No bulk select on batch leads | Live Queue can multi-select; batch table cannot. Cannot select the 4 Interested even after filtering (if that filter existed). |
| P2-15 | Create Batch on empty + header | Duplicate CTAs. |
| P2-16 | Campaign list Export | All campaigns CSV; easy to confuse with batch Export. |

---

## 9. What a fixed information architecture would be (not built)

Keep one campaign object. Change **what is clickable**, not the database.

1. **Floor** (now): queued / ringing / talking / retry — Live Queue math, on overview.
2. **Results** (after): disposition chips as the primary filter, Interested as the first chip, click → lead table with those rows selected, row → lead profile.
3. **Telephony** (secondary): pending / no pickup / busy / failed / voicemail.
4. One Analytics, in-campaign.
5. Create stays: list New-from + one batch wizard. Kill dead wizards.

Data already on `campaign_leads`. This is click-contract + hierarchy, not a new dialer.

---

## 10. File index

| File | Role |
|---|---|
| `pages/campaigns/tabbed.tsx` | Stripe shell |
| `pages/campaigns/index.tsx` | List + create wizard + edit/delete |
| `pages/campaigns/[id].tsx` | Detail tabs + overview cards + config + dead wizards |
| `pages/campaigns/batch-wizard.tsx` | Create batch |
| `pages/campaigns/[id]/batches/[batchId].tsx` | Batch KPIs + leads + disposition dropdown |
| `pages/campaigns/[id]/leads/[leadId].tsx` | Lead CRM (orphan) |
| `pages/campaigns/live-queue.tsx` | Floor |
| `pages/campaigns/incoming.tsx` `callbacks.tsx` `transfers.tsx` `bookings.tsx` | Event tabs |
| `pages/campaigns/campaign-analytics-tab.tsx` | Ask/Reports/Results |
| `pages/campaigns/recampaign-dialog.tsx` | Clone by disposition |
| `pages/campaigns/lead-transfer-settings.tsx` | Transfer form |
| `lib/campaign-status.ts` | Badge colors |
| `lib/campaign-lifecycle.ts` | Pause/resume gates |
| `lib/campaign-overview-metrics.ts` | Unused campaign tiles (except failed) |
