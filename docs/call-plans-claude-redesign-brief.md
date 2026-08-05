# Call plans — full brief for redesign (Claude)

**Product:** SnapServe (`app.snapserve.ai`)  
**Audience:** Claude (or any planner) helping rethink Call plans UX / IA / flows  
**Date:** August 2026  
**Status:** Shipped IA exists; founder is **not satisfied** and wants a rethink. This doc describes **what exists today**, not what we wish existed.

Use this as ground truth. Propose a better product story and UX; do not invent APIs that aren’t listed here without marking them as “new build.”

---

## 1. One-line product job

> A **call plan** is the ordered path SnapServe runs for **each lead**: who talks (agent), who to reach (leads), what happens next (steps), then **Start queue** (dial at concurrency + calling hours).

**Default path we teach:**  
`Agent → Call plan → Leads → Start queue`

**Not:** a Zapier graph, a campaign ops console, or a second Agent Builder.

---

## 2. Mental model (layers)

| Layer | Job | Product surface |
|-------|-----|-----------------|
| **Agent** | Who talks — prompt, voice, tools, auto-redial, versions | Agents → Builder |
| **Call plan** | What happens next for each lead (ordered steps) | Call plans |
| **Leads** | Who to reach — CSV lists (nav label **Leads**; route still `/app/people`) | Leads |
| **Connections** | Shared wiring — Sheets, WhatsApp, email, website form, Meta | Connections |
| **History** | Call outcomes, callbacks, transfers | History |

**Hard rules today**

1. Agent ≠ Call plan ≠ Leads ≠ Connections.  
2. Plan steps can express retries (`no answer → wait → call again`). Agent **Auto-redial** (Builder → Advanced) is separate (immediate redial).  
3. Product language: **Call plans**, **Leads**, **Start queue**, **Drain / Drip** — not Journey / Campaign / Automation as primary labels.  
4. Under the hood: journeys + workflows + campaign dial engine. Users should not need those words.

---

## 3. What a call plan contains

### 3.1 Identity

- Name  
- Bound **agent** (who dials / talks)  
- Status: `draft` | `active` | `paused`  
- Optional description  

### 3.2 Steps (timeline, not a graph)

Ordered list. User reorders with up/down (no drag canvas, no node graph).

| UI label | Engine type | Notes |
|----------|-------------|--------|
| Call them | `make_call` | Optional Team/Squad for mid-call handoff |
| Send WhatsApp | `send_whatsapp` | Needs WhatsApp connected |
| Send email | `send_email` | Brevo via Connections |
| Wait | `delay` | minutes / hours / days |
| Schedule callback | `schedule_callback` | Plan-level later dial |
| Join a meeting | `join_meeting` | Meet / Zoom / Teams URL on lead |
| Update the list | `update_sheet` | Write status back to Google Sheet row |
| If… | `condition` | Gate **or** Then/Else (see below) |
| Stop | `stop` / stop-like condition | End this lead’s path |

**If… modes**

1. **Gate (legacy default):** false → path **stops**.  
2. **Then / Else paths:** true runs next N “then” steps; false runs following M “else” steps; then rejoins. Example: answered → WhatsApp A, else → WhatsApp B.

**Recipes** = named **templates** of step lists used at create time (not a runtime concept):

| Recipe id | Intent |
|-----------|--------|
| `lead_followup` | Call → miss → WA → wait 1d → call again → … |
| `soft_nudge` | Call → WA → wait 2d → call again |
| `sheet_live` | Call → update sheet → miss path → retry → update sheet |
| `form_followup` | New form/Meta lead follow-up |
| `callback_rescue` | Miss → schedule callback + WA |
| `blank` | Minimal Call → WA → Wait → Stop |

“Recipe” in Build with AI = which of these templates to materialize into steps. After create, user edits steps freely.

### 3.3 Leads attachment (on the plan)

| Mode | Meaning |
|------|---------|
| **Lead list (CSV)** | Attach a list from Leads (`/app/people`) |
| **Google Sheet** | Attach a sheet pipeline; see Drain vs Drip |
| **Paste phones** | One-off numbers |

**Optional intake** (More settings): website form / Meta Lead Ads can also feed the plan (hook URL). Overlaps conceptually with “lead source” chosen at create — easy to confuse.

### 3.4 Sheet modes

| Mode | Product copy | Behaviour |
|------|--------------|-----------|
| `once` | **Drain this list** | Queue current rows; dial until done; don’t keep watching |
| `live` | **Drip new rows** | Keep watching sheet; new rows enter same queue (cursor) |

### 3.5 Calling hours

On plan settings: enable + start hour + end hour + timezone.  
Synced onto hidden workflow campaign so **queue does not dial outside window** (same gate as campaign dialing).

### 3.6 Start / control

| Action | Meaning |
|--------|---------|
| **Start queue** | Begin / feed dial queue for attached leads |
| **Start drip** | Same for sheet live mode |
| **Pause / Resume** | Plan active ↔ paused; gates auto-feed |
| **Stop drip** | Stop new sheet rows entering |
| **Continue** | Legacy leftover for old batch cursor; auto-feed usually replaces this |

---

## 4. Dial queue (how dialing actually works)

**User story:** “I have 1,000 / 1 lakh leads — dial up to my concurrency; don’t open 1,000 calls at once.”

**Implementation (today):**

1. Hidden campaign with `leadSource=workflow`, uses account `users.concurrentLimit`.  
2. Long-running batch `__call_plan_queue`.  
3. `make_call` parks workflow run as waiting; campaign refill dials pending leads.  
4. Auto-feed (`call-plan-queue-feed`) keeps starting runs from list/sheet so the batch doesn’t starve.  
5. Calling hours checked via campaign dialable gate.  
6. Activity page shows queued / dialing / outcomes; full call detail in History.

**Key files**

- `artifacts/api-server/src/services/workflow-dial-queue.ts`  
- `artifacts/api-server/src/services/call-plan-queue-feed.ts`  
- `artifacts/api-server/src/services/workflow-engine.ts`  
- `artifacts/api-server/src/routes/journeys.ts`  
- `.agents/memory/call-plan-dial-queue.md`

---

## 5. Current UX (screens)

### 5.1 List — `/app/call-plans`

- Empty state teaches: Agent → plan → attach leads → Start queue.  
- Two CTAs: **Build with AI** | **Compose**.

### 5.2 Compose (manual create dialog)

4-step wizard:

1. Agent  
2. Lead source (+ Drain/Drip if sheet)  
3. Recipe (filtered by source)  
4. Name + summary → create → navigate to plan detail  

### 5.3 Build with AI (plan Vibe) — dialog on Call plans

**Not** full agent Vibe (`/app/vibe`).

Flow:

1. Pick agent  
2. Natural language prompt  
3. `POST /api/journeys/vibe-draft` → draft `{ name, leadSource, templateId, sheetRunMode, summary }`  
4. User can edit name / lead source / recipe / drip  
5. Create via normal `POST /api/journeys` with `stepsForTemplate(...)`  
6. Land on plan — **still must attach concrete list/sheet/phones and Start queue**

Drafting: keyword heuristic always; Gemini refine if key available.  
**Does not** invent free-form step graphs — only maps onto recipes.

### 5.4 Detail — `/app/call-plans/:id`

Layout (recent polish):

- Banner if no leads attached yet  
- **Left hero: Leads** (list / sheet / paste)  
- Compact plan name + agent  
- **More settings** (collapsed): calling hours + intake  
- **Right hero: What happens next** (step editor)  
- Header: Save, Pause/Resume, Start queue / Start drip  
- Activity summary → full Activity page  

### 5.5 Activity — `/app/call-plans/:id/activity`

Per-run / lead progress, filters, History links. Pagination ~50.

---

## 6. Related surfaces

| Surface | Role vs call plans |
|---------|-------------------|
| **Leads** (`/app/people`) | CSV lists; attach to plan |
| **Connections** | Sheets OAuth, WA, email, website, Meta |
| **Agents / Builder** | Who talks; Auto-redial; Call Transfer now under Tools → Call Control (not Custom Tools) |
| **Agent Vibe** `/app/vibe` | Builds **agents** only |
| **History** | Call logs |
| **Campaigns** (legacy URLs) | Engine behind lists; product says Leads |

---

## 7. Known friction / why founder is unhappy (honest)

Capture these as redesign inputs — not as “bugs only”:

1. **Create vs detail duplication** — create picks lead source / recipe; detail re-asks attach + drain/drip. Story breaks.  
2. **“Recipe” is jargon** — users don’t know it means “starter steps.”  
3. **Build with AI is shallow** — maps to templates; can’t truly build answered→A / else→B from one prompt without manual If… edit after.  
4. **Intake vs People source** — website/Meta at create vs “Also start from intake” on detail overlaps.  
5. **Cognitive load on Start** — concurrency, auto-feed, continue, preview re-dial, drip vs drain.  
6. **Step editor is powerful but dense** — WA templates, If Then/Else counts, squads packed into expand rows.  
7. **Two Vibe brands** — Agent Vibe vs Plan “Build with AI”; easy to confuse.  
8. **Legacy words leak** — journeys API, campaigns under the hood, `/app/people` URL vs Leads label.  
9. **Success path unclear after create** — land on empty Leads section; “what do I do next?” still weak.  
10. **Sheet setup still deep-links** automatic-calls / Connections in mixed ways.

---

## 8. What must be preserved (constraints)

When redesigning, keep unless you explicitly propose migration:

- Ordered **timeline** (not node graph) as the mental model for steps — product decision.  
- Concurrency dial queue for large lists (campaign-engine path).  
- Calling hours gate.  
- Drain vs drip for sheets.  
- Agent ownership of voice/prompt/tools; plan owns sequence.  
- Connections for WA/email/sheets/forms.  
- Wallet / minutes billing.  
- Greyscale / existing dashboard design system (StripePage, cards, etc.).  
- Managed-client restrictions (some create paths denied).

---

## 9. APIs (current)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/journeys` | List plans |
| GET | `/api/journeys/:id` | Plan detail |
| POST | `/api/journeys` | Create (`agentId`, `steps`, `settings`, `trigger`, …) |
| PATCH | `/api/journeys/:id` | Update |
| POST | `/api/journeys/:id/start` | Start queue |
| POST | `/api/journeys/:id/start-preview` | Preview already-walked leads |
| POST | `/api/journeys/:id/activate` / `pause` | Status |
| POST | `/api/journeys/:id/stop-live` | Stop drip |
| POST | `/api/journeys/vibe-draft` | NL → draft classification |
| GET | `/api/journeys/:id/runs` | Activity rows |
| GET | `/api/journeys/:id/runs/stats` | Stats |

Settings blob (conceptual): `peopleSource`, `campaignId`, `sheetPipelineId`, `runMode`, `leadSource`, `sheetCursorRow`, `autoFeed`, calling-hours fields, start offsets, etc.

---

## 10. Frontend / backend file map

**Dashboard**

- `artifacts/dashboard/src/pages/call-plans/index.tsx` — list + compose wizard  
- `artifacts/dashboard/src/pages/call-plans/plan-vibe-dialog.tsx` — Build with AI  
- `artifacts/dashboard/src/pages/call-plans/[id].tsx` — detail  
- `artifacts/dashboard/src/pages/call-plans/step-editor.tsx` — steps + recipes  
- `artifacts/dashboard/src/pages/call-plans/lead-sources.tsx` — lead source options  
- `artifacts/dashboard/src/pages/call-plans/activity-panel.tsx` — activity UI  
- `artifacts/dashboard/src/pages/people/index.tsx` — Leads page shell  

**API**

- `artifacts/api-server/src/routes/journeys.ts`  
- `artifacts/api-server/src/services/workflow-engine.ts`  
- `artifacts/api-server/src/services/workflow-dial-queue.ts`  
- `artifacts/api-server/src/services/call-plan-queue-feed.ts`  
- `artifacts/api-server/src/services/call-plan-vibe.ts`  
- `artifacts/api-server/src/services/journey-presets.ts`  

**Docs**

- `docs/snapserve-product-knowledge-base.md` — broader product IA  
- `.agents/memory/call-plan-dial-queue.md` — dial architecture  

**DB (names)**

- `journeys` table — product “call plan”  
- `workflows` / `workflow_runs` — execution  
- Campaigns / leads — dial queue substrate  

---

## 11. Example user stories (today)

### A — CSV list follow-up

1. Create agent (or Vibe agent).  
2. Leads → upload CSV.  
3. Call plans → Compose → list → Lead follow-up recipe.  
4. Attach list → Start queue.  
5. Watch Activity / History.

### B — Sheet drip

1. Connections → Google Sheets.  
2. Set up sheet pipeline.  
3. Plan → attach sheet → Drip new rows → Start drip.  
4. Optional Update-the-list step writes status back.

### C — Build with AI

1. Build with AI → “Call my Google Sheet leads. If no answer, WhatsApp, wait 1 day, call again. Drip new rows.”  
2. Review draft → Create plan.  
3. Attach the actual sheet → Start drip.  
4. For true answered/else branches, edit If… on the plan.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **Call plan** | Product name for a journey: steps + leads + queue |
| **Recipe** | Create-time step template |
| **Leads** | Who you reach (nav); route `/app/people` |
| **Start queue** | Begin concurrency dialing |
| **Drain / Drip** | Sheet once vs keep-live |
| **Calling hours** | Dial window on the plan |
| **Journey / workflow / campaign** | Internal engines — avoid in UI |
| **Build with AI (plan)** | Plan draft dialog |
| **Vibe** | Agent builder chat at `/app/vibe` |

---

## 13. Ask for Claude (redesign brief)

Founder wants a **better Call plan product**. Using this doc:

1. Critique the current create → attach → start story.  
2. Propose a clearer IA and primary screens (wireframes in words / structure OK).  
3. Decide fate of “Recipe,” Build with AI depth, and Lead source vs intake.  
4. Keep timeline steps + concurrency queue unless you have a strong alternative.  
5. Output a **phased plan**: UX-only vs needs API changes.  
6. Call out what to delete vs rename vs rebuild.  
7. Write success criteria a non-technical user can pass in &lt;10 minutes.

**Do not** assume Zapier-style graphs unless arguing why to abandon the timeline decision.  
**Do** prefer SnapServe language: Agent, Call plan, Leads, Connections, Start queue.

---

## 14. Recent shipped changes (context)

- Calling hours on plans  
- Plan retry helper (no answer → wait → call again) + agent Auto-redial link  
- If… Then/Else paths  
- Drain / Drip copy for sheets  
- Home empty state path  
- People → **Leads** product label  
- Compose wizard + Build with AI draft  
- Detail: Leads hero, More settings collapsed  
- Call Transfer moved from Custom Tools → Platform Tools → Call Control  

---

*End of brief. Pair with `docs/snapserve-product-knowledge-base.md` for full product map.*
