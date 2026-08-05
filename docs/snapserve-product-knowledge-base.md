# SnapServe — Complete Product Knowledge Base

**Audience:** External UI/UX designers, product partners, and internal agents  
**Product:** SnapServe (`app.snapserve.ai`) — Indic-first AI voice agent platform  
**Last updated:** August 2026  
**Purpose:** Full feature map under the **Call plans IA** — how agents, plans, people, and connections fit together

---

## 1. What SnapServe is

SnapServe lets a business:

1. Create an **agent** (who talks on phone and/or in meetings)  
2. Make a **call plan** (ordered steps for each person)  
3. Attach **people** (list, sheet, or paste) and **Start queue**  
4. Wire **connections** once (Sheets, WhatsApp, email, website form, Meta, phone)

SnapServe dials at concurrency (and calling hours), logs **History**, and bills by wallet / minutes.

**One-line product model:**

> You create an **agent** → you make a **call plan** → you attach **people** → **Start queue** → SnapServe dials at your concurrency (and calling hours).

Journeys, campaigns, and dial engines still power execution under the hood. Product language prefers **Call plans**, **Leads**, **History**, and **Connections** — not “Journey”, “Automation”, or “Dial flows” as primary labels.

---

## 2. Mental model (critical for UX)

| Layer | Job | Where in the app |
|-------|-----|------------------|
| **Agent** | Who talks — prompt, voice, tools, versions | **Agents** → Agent Builder |
| **Call plan** | What happens next for each person (ordered steps) | **Call plans** |
| **Leads** | Who to reach — CSV lists | **Leads** |
| **Connections** | Shared wiring — Sheets, WhatsApp, email, website form, Meta | **Connections** |
| **History** | What happened — calls, callbacks, transfers | **History** |
| **Intelligence** | Knowledge, memory, teams, analytics, scheduling | MORE section |
| **Settings** | Workspace, keys, billing | Workspace · Providers · Developers · Billing |

### Hard product rules

1. **Agent ≠ Call plan ≠ Leads ≠ Connections**  
   - Agent = runtime (prompt / voice / tools / engine / versions)  
   - Call plan = ordered steps (call → WhatsApp → wait → if… → meet → stop)  
   - Leads = who to dial / message  
   - Connections = account wiring used by plans and agents  

2. **Retries:** plan steps can express **no answer → wait → call again**; agent **Auto-redial** (Advanced) is the mid-call / immediate redial setting. Link both clearly in the plan editor.

3. **Provider and model names stay visible** (Sarvam, Gemini, Cartesia, Vobiz, etc.).

4. **Booking = one suite switch** in Tools (not five separate toggles).

5. **Email = Brevo bring-your-own only** — SnapServe does not provide managed email.

6. Agent-scoped deep pages (**Meetings**, **Memory**) use `?agentId=` + an agent picker. Phone / WhatsApp / email wiring lives under **Connections** (not a primary “Agent channels” nav).

---

## 3. App navigation (Call plans IA)

```
Home
Call plans
Agents
Leads
Connections
History

MORE
  Knowledge
  Memory
  Squads
  Analytics
  Scheduling

── Settings ──
  Workspace · Providers · Developers · Billing
```

**Mobile bottom:** Home · Plans · Create · Agents · History  

**Partner accounts** also see **Partner Hub**.  

**Managed clients** (run by a partner) see a trimmed nav: Home · Call plans · Agents · History · Connections · Wallet · Workspace.

### Legacy URLs (redirected, not deleted)

| Old | New home |
|-----|----------|
| `/app/automation` | `/app/call-plans` |
| `/app/campaigns` | `/app/people` |
| `/app/automatic-calls` (list) | `/app/connections?setup=sheets` |
| `/app/meta-leads` | `/app/connections?setup=meta` |
| `/app/calls`, `/app/activity` | `/app/history` |
| `/app/callbacks` | `/app/history?tab=callbacks` |
| `/app/transfers` | `/app/history?tab=transfers` |

**Deep-links kept** (not primary nav): `/app/channels` redirects into Connections / Meetings, `/app/whatsapp`, `/app/meet`, campaign / sheet detail routes.

---

## 4. Core objects and how they connect

```
     Connections          Leads
     (Sheets, WA,         (CSV lists
      email, website,      only)
      Meta)
           │                     │
           └──────────┬──────────┘
                      ▼
              ┌───────────────┐
              │  Call plan    │  ordered steps per person
              └───────┬───────┘
                      │ uses
                      ▼
              ┌───────────────┐
              │    Agent      │  who talks (+ optional Team / Squad)
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │   History     │  calls, callbacks, transfers
              └───────────────┘
```

### Binding mechanism

| Binding | How |
|---------|-----|
| Builder | Route `/app/agents/:id` |
| Call plan | Journey + workflow under the hood; UI = `/app/call-plans/:id` |
| Lead lists / sheets / forms | Legacy campaign / automatic-call / webhook engines; UI = `/app/people` (labeled Leads) |
| Meetings / Memory | Query `?agentId=` + agent picker; phone/WA/email via **Connections** |
| Phone numbers | Number assigned to `agentId` (or squad) |
| Knowledge | Sources attached on agent (`knowledgeSourceIds`) |
| Live production | Published **Version** snapshot (not unsaved draft) |

---

## 5. Agent Builder (current shape)

**Route:** `/app/agents` → `/app/agents/:id`  
**Create:** Home / Agents → create wizard, or Vibe Build (`/app/vibe`).

### Create wizard

1. **Who** — One agent **or** Team (first agent, then assemble on Squads)  
2. **Where** — Phone **or** Phone + meetings  
3. **Name** — create → Builder, or Squads with `?seedAgent=` for teams  

Phone + meetings enables meeting join and a separate **In meetings** prompt.

### Builder chrome

- Back, agent name (rename), Live/Draft, Unsaved  
- **Team strip** — which Squads this agent belongs to, or “Add to team”  
- Actions: Phone test, Live test (browser webcall), Save  
- More: Publish version, Refine with AI, Delete  
- Horizontal segment tabs  

### Builder tabs

| Tab | What the user does |
|-----|--------------------|
| **Overview** | Pipeline chips (ASR / LLM / Voice), greeting, **Talk** preview with **On calls \| In meetings**, knowledge sources |
| **Prompt** | Dual surfaces: **On calls** and **In meetings** (`meetingPrompt`); variables, timezone, end-call phrases |
| **Voice** | ASR + LLM + TTS stack, voice picker/cloning, ambient noise; Gemini Live vs classic |
| **Tools** | Mid-call capabilities (see below) |
| **Voicemail** | Outbound answering-machine detect: hang up or leave TTS message |
| **Advanced** | Engine timing, limits, post-call webhook, dispositions, India compliance |
| **Versions** | Draft / Production snapshots — compare, restore, publish |

Meeting **join / delegate / memory** toggles live under **Meetings** (Connections → Meet / `/app/meet?agentId=`), not as a second prompt editor in the Builder.

### Tools tab

| Tool / control | Purpose |
|----------------|---------|
| **Booking** (one switch) | Book / check / list / reschedule / cancel — needs Scheduling calendar + event type |
| **End call** | Hang up politely |
| **Send email** | Mid-call email via Brevo (Connections → Email) |
| **Send WhatsApp** | Mid-call WhatsApp (Connections → WhatsApp must be connected) |
| **Call transfer** | Warm transfer to a human number |
| **Custom HTTP tools** | User-defined webhooks with JSON schema |
| **Call recording** | Record conversations |
| **Gender detection** | Optional signal |
| **Voice memory** | Remember facts about the caller across calls |

### Advanced tab

- **Engine:** Fast / Balanced / Patient, barge-in, endpointing, VAD  
- **Limits:** max duration, auto-redial, telephony (Vobiz / Plivo / Twilio BYO)  
- **Analytics / Integrations:** post-call CRM webhook + HMAC; dispositions  
- **Compliance:** optional Indian regulatory prompt injections  

### Versions

- **Save** updates the working draft  
- **Publish** promotes draft → **Production** (what live calls use)  

### How users create an agent

1. **Create wizard** — one / team · phone / phone+meet  
2. **Vibe Build** — describe the job; AI scaffolds prompt/voice  
3. **Refine with AI** — reopen Vibe against an existing agent  

---

## 6. Call plans (what happens next)

**Routes:** `/app/call-plans`, `/app/call-plans/:id`  

A call plan is an **ordered timeline of steps** for each person — not a node graph, not a use-case gallery.

### Create

Two doors on Call plans:

1. **Suggest a starter** — describe the path in plain language; SnapServe picks a starter timeline you edit on the plan.  
2. **Compose** — opens the single-screen builder (empty steps → pick a starter inline).

Agent **Vibe** (`/app/vibe`) still builds agents only. Plan suggest is not Agent Vibe.

**Builder screen** (`/app/call-plans/:id`): Agent + name · **Who** (List / Sheet / Paste / Form / Meta) · **What happens** (starters when empty) · **Start**.

### Step palette

| Step | Meaning |
|------|---------|
| **Call them** | Dial with the plan’s agent; optional **Team** for mid-call handoffs |
| **Send WhatsApp** | Template-style follow-up (needs WhatsApp connected) |
| **Send email** | Brevo email (needs Connections → Email) |
| **Wait** | Pause (minutes / hours / days) |
| **Join a meeting** | Bot joins Meet / Zoom / Teams from a link on the person |
| **Update the list** | Write status back to the Sheet row (when people came from a sheet) |
| **If…** | Two modes: **Gate** (false → stop) or **Then / Else paths** (e.g. answered → WhatsApp A, else → WhatsApp B). Plain language conditions: answered / didn’t answer / succeeded / custom |
| **Stop** | End this person’s path |

**Retries:** plan editor surfaces **no answer → wait → call again** as steps; agent **Auto-redial** remains on Builder → Advanced for immediate redials.

### Leads on a plan

- **CSV / list** — attach a Lead list  
- **Paste phones** — one-off numbers  
- **Google Sheet** — attach a sheet pipeline  

### Dial queue

**Start queue** feeds people into a concurrency dial queue (same engine as campaigns): dials up to the account **concurrent limit**, auto-feeds the rest, respects plan **calling hours** (start/end + timezone). Watch **Activity** for queued / dialing.

### Sheet run modes

| Mode | Behaviour |
|------|-----------|
| **Drain this list** | Queue current sheet rows once; dial until done. No new rows after Start (unless you Start again). |
| **Drip new rows** | Keep watching the sheet; new rows enter the same queue (sheet cursor skips already-processed rows). |

List / paste people always use the drain/queue path (Start queue).

**Pause / Resume** — stop or restart an active plan without deleting it. **Stop drip** — stop new sheet rows from entering.

### Intake on a plan

Optional intake sources on the plan itself (in addition to attached lists/sheets):

- **Website form** — form webhook leads enter this plan  
- **Meta Lead Ads** — Meta form submissions enter this plan  

Configure the form/Meta connection under **Connections**, then enable intake on the plan.

### Results

Per-person / run progress on the plan detail page (**Activity**); export via **CSV**. Full call outcomes also in **History**.

**Under the hood:** journeys + workflows. Product copy says **Call plans**.

---

## 7. Leads (who you reach)

**Route:** `/app/people`  

CSV / list leads only. Create a list → upload CSV batches → attach to a **call plan** → Start queue.

Website forms, Google Sheets auto-dial, and Meta Lead Ads live under **Connections** — not on this page.

Detail routes for list / batch / lead still exist under `/app/campaigns/:id` for deep work.

---

## 8. Connections (wire once)

**Route:** `/app/connections`  

Five integrations only — brand logos, Ready / Set up:

1. **Google Sheets**  
2. **WhatsApp**  
3. **Email (Brevo)** — BYO key  
4. **Website form**  
5. **Meta Lead Ads**  

Phone numbers are **not** here — assign on **Agents → Overview**.

Deep setup: `/app/connections?setup=sheets|email|website|meta` · WhatsApp → `/app/whatsapp`.

---

## 9. History

**Route:** `/app/history` (legacy `/app/calls` still works)  

| Tab | Purpose |
|-----|---------|
| **Calls** | Full call log, filters, export, detail |
| **Callbacks** | Scheduled callbacks + auto-redials |
| **Transfers** | Human transfer history |

Call detail: transcript, recording (if enabled), disposition, cost, agent.

---

## 12. Scheduling & Booking

**Route:** `/app/scheduling` (MORE)  

- Bookings, calendars (e.g. Google Calendar), event types, availability, conferencing  
- Public booking page: `/book/:slug`  

**Connection:** Tools → Booking uses the agent’s linked calendar + event type. Connections / Meetings show calendar readiness.

---

## 13. Meet

**Route:** `/app/meet?agentId=` (from Connections)  

- Paste Google Meet / Zoom / Teams URL → launch bot  
- Meeting prompt: Builder → Prompt → In meetings  
- Join / delegate: Meetings (Connections → Meet)  

---

## 14. WhatsApp

**Route:** `/app/whatsapp` (from Connections)  

Meta Business API and BYO BSP admin, templates, agent binding. Instant (shared SnapServe) WhatsApp is not offered for new enrollments.

---

## 15. Knowledge

**Route:** `/app/knowledge-bases`  

FAQ · free text · website crawl · file upload. Attach on Builder → Overview.

---

## 16. Memory

**Route:** `/app/memory?agentId=&caller=`  

Per-agent, per-caller facts and episodes. Requires Voice memory in Tools.

---

## 17. Squads (Teams)

**Route:** `/app/squads` (MORE)  

Multi-agent teams for mid-call handoffs and shared caller memory.

- Create from Agents → Team wizard (`?seedAgent=`) or Squads → New team  
- Team strip on Agent Builder shows membership  
- Call plan **Call** step can dial with a team for live handoffs  

---

## 18. Analytics

**Route:** `/app/analytics`  

Workspace KPIs and trends; filter by campaign / flow. Per-agent analytics available.

---

## 19. Settings

| Page | Contents |
|------|----------|
| **Workspace** | Profile, workspace settings, Team |
| **Providers** | Voices library + BYO ASR / LLM / TTS / telephony keys |
| **Developers** | API keys (`sk_live_…`), workspace webhooks |
| **Billing** | Wallet, Razorpay top-up, auto-pay, GST/invoices, Usage |

Default India stack (when not BYO): Sarvam ASR, Google LLM, Cartesia/Sarvam TTS, Vobiz telephony.

---

## 20. Partner & managed clients

| Role | Experience |
|------|------------|
| **Partner** | Partner Hub: invite clients, wallets, earnings, “Act as client” |
| **Managed client** | Trimmed UI — Home, Call plans, Agents, History, Connections; partner builds deeper config for them |

---

## 21. End-to-end user journeys

### A — Create agent → go live

1. Create agent (wizard or Vibe) — phone or phone + meetings  
2. Builder: Prompt (calls / meetings) + Voice + Tools  
3. Live test and/or Phone test  
4. Publish version → Production  

### B — Go live on phone

1. Connections → Phone numbers → buy / verify  
2. Assign number to agent (Phone Numbers or Connections → Phone)  
3. Inbound rings this agent; outbound uses this caller ID  

### C — Call plan: list → call → WhatsApp

1. Create / pick agent  
2. Call plans → new plan → steps: Call → WhatsApp → Wait…  
3. Leads → attach list / paste / sheet  
4. **Start queue** (respects concurrency + calling hours)  
5. Watch plan Activity + History  

### D — Sheet drip vs drain

1. Connections → Google Sheets → connect  
2. Set up sheet (`/app/automatic-calls/new` or Connections → Sheets)  
3. Call plan → attach sheet → **Drain this list** (batch) or **Drip new rows** (ongoing)  
4. Optional: **Update the list** step writes status back  

### E — Website form → call plan

1. Connections → Website form → create webhook bound to agent  
2. Paste webhook into the site form  
3. Attach / use with a call plan for dial + follow-ups  

### F — Book meetings from calls

1. Scheduling: calendar + event type  
2. Builder → Tools → Booking ON  
3. Agent books slots mid-call; optional Meet join via Meetings (Connections → Meet)  

### G — Team handoffs

1. Create → Team (or Squads → New team) with 2+ agents  
2. On a call plan Call step, pick the **Team**  
3. Agents hand off mid-call with shared memory  

---

## 22. UX structure notes

### Chrome system

- **Sidebar** = Call plans IA  
- **StripePage** = one page title + one-line description + actions  
- **AgentContextBar** = agent Select on agent-scoped deep pages  
- **Tabs** under the header for Leads, History, Phone Numbers, Settings, etc.  

### Design principles

1. First teach **Agent → Call plan → Leads → Start queue**.  
2. Do not revive **Automation / Dial flows / Journey / Agent channels** as primary nav labels.  
3. Prefer flat full pages; one job per screen.  
4. Cross-link generously (plan → Leads, Connections → Meetings, Meet → Prompt).  
5. Empty states point to the next step (agent → call plan → people → start queue).  

### Surfaces that must feel like one family

Home · Call plans · Agents · Leads · Connections · History  

Builder is a focused editor. MORE and Settings are secondary / administrative.

---

## 23. Feature checklist (A–Z)

| Feature | Exists | Primary surface |
|---------|--------|-----------------|
| Agent create (wizard / Vibe) | Yes | Agents, Vibe |
| Dual prompts (calls / meetings) | Yes | Builder → Prompt / Overview |
| Voice stack + cloning | Yes | Builder → Voice, Providers |
| Mid-call tools | Yes | Builder → Tools |
| Booking suite | Yes | Tools + Scheduling + Connections |
| Voicemail AMD | Yes | Builder → Voicemail |
| Engine / barge-in / VAD | Yes | Builder → Advanced |
| Versions / publish | Yes | Builder → Versions |
| Live browser / phone test | Yes | Builder toolbar |
| Knowledge bases | Yes | Knowledge + Builder Overview |
| Phone buy / assign / KYC | Yes | Phone Numbers + Connections |
| WhatsApp Meta / BYO | Yes | Connections → WhatsApp |
| Email via Brevo | Yes | Connections → Email |
| Meetings join | Yes | Connections → Meet / Meetings |
| Call plans timeline | Yes | Call plans |
| If… Then / Else | Yes | Call plans steps |
| Calling hours on plans | Yes | Call plan settings |
| Dial queue (concurrency) | Yes | Call plans Start queue |
| Drain list / Drip new rows | Yes | Call plans (sheet people) |
| Sheet write-back step | Yes | Call plans |
| Lead lists / CSV | Yes | Leads |
| Google Sheets people | Yes | Connections |
| Website forms / Meta leads | Yes | Connections |
| CRM (HubSpot, Zoho) | Yes | Connections |
| Post-call webhook | Yes | Builder Advanced |
| Dispositions | Yes | Builder Advanced |
| Call logs / callbacks / transfers | Yes | History |
| Caller memory | Yes | Memory + Tools |
| Teams / squads / handoffs | Yes | Squads + Call plan Call step + Builder strip |
| Scheduling / public book page | Yes | Scheduling |
| Analytics | Yes | Analytics |
| Wallet / usage | Yes | Billing |
| API keys / webhooks | Yes | Developers |
| Partner / managed client | Yes | Partner Hub |
| Managed SnapServe email | **No** | — (Brevo BYO only) |

---

## 24. Glossary

| Term | Meaning |
|------|---------|
| **Agent** | AI voice persona (prompt, voice, tools, published version) |
| **Builder** | UI to configure how the agent speaks |
| **Call plan** | Ordered steps for each person (product front door for journeys) |
| **Leads** | Who you reach — CSV lists, paste, or sheets on a plan |
| **Connections** | Shared wiring — Sheets, WhatsApp, email, website form, Meta, phone |
| **History** | Calls, callbacks, transfers (what happened) |
| **Meetings** | Per-agent meet join / delegate (deep page with `?agentId=`) |
| **Dial queue** | Concurrency-limited outbound dialing for a call plan (campaign engine under the hood) |
| **Drain / Drip** | Sheet modes: queue current rows once vs keep feeding new rows |
| **Team / Squad** | Multi-agent handoff group |
| **Production version** | Published snapshot used on live calls |
| **Webcall** | Browser live test |
| **BYO** | Bring your own (keys / telephony / Brevo / BSP) |
| **Journey / campaign** | Internal engine names — prefer Call plan / Leads / dial queue in product copy |

---

## 25. UX redesign brief (current target)

**Goal:** SnapServe feels like voice orchestration you compose — agents talk, call plans decide what happens next.

**Must preserve**

- Call plans IA sidebar and redirects  
- Builder focused on speaking behaviour (not a second workflow canvas)  
- Plan retries as steps + agent Auto-redial linked clearly  
- Visible provider/model names  
- Booking as one switch; Email as Brevo-only  
- Current color theme  

**Primary screens**

1. Home (what’s running + Agent → Call plan → Leads → Start queue)  
2. Call plans (timeline editor + dial queue)  
3. Agents / Builder (dual prompt + team strip)  
4. Leads  
5. Connections (incl. Meetings)  
6. History  

**Success criteria**

- New user can create an agent, make a plan, add people, and start the queue without training  
- User never needs “Journey / Automation / Dial flows / Agent channels” words to succeed  
- No node graph; If… supports Then / Else paths  
- Cross-links make Agent ↔ Plan ↔ Leads ↔ Connections obvious  

---

*This document describes the shipped Call plans IA (Phases 1–5). Internal API field names (e.g. `journey`, `campaign`, `campaignId`) may still use legacy naming.*
