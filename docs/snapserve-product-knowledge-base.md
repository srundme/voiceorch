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
3. Attach **people** (CSV, Google Sheet, website forms)  
4. Wire **connections** once (phone, WhatsApp, Sheets, Meet, CRM)

SnapServe runs the work, logs **History**, and bills by wallet / minutes.

**One-line product model:**

> You create an **agent** → you make a **call plan** → you attach **people** → you wire **connections** → SnapServe runs the rest.

Journeys, campaigns, and dial engines still power execution under the hood. Product language prefers **Call plans**, **People**, **History**, and **Connections** — not “Journey”, “Automation”, or “Dial flows” as primary labels.

---

## 2. Mental model (critical for UX)

| Layer | Job | Where in the app |
|-------|-----|------------------|
| **Agent** | Who talks — prompt, voice, tools, versions | **Agents** → Agent Builder |
| **Call plan** | What happens next for each person (ordered steps) | **Call plans** |
| **People** | Who to reach — lists, sheets, website forms | **People** |
| **Connections** | Shared wiring — phone, WhatsApp, Sheets, CRM, Meet | **Connections** (+ deep-links) |
| **History** | What happened — calls, callbacks, transfers | **History** |
| **Intelligence** | Knowledge, memory, teams, analytics, scheduling | MORE section |
| **Settings** | Workspace, keys, billing | Workspace · Providers · Developers · Billing |

### Hard product rules

1. **Agent ≠ Call plan ≠ People ≠ Connections**  
   - Agent = runtime (prompt / voice / tools / engine / versions)  
   - Call plan = ordered steps (call → WhatsApp → wait → if… → meet → stop)  
   - People = who to dial / message  
   - Connections = account wiring used by plans and agents  

2. **Retries / “call me back” live on the Agent**, not on the call plan.

3. **Provider and model names stay visible** (Sarvam, Gemini, Cartesia, Vobiz, etc.).

4. **Booking = one suite switch** in Tools (not five separate toggles).

5. **Email = Brevo bring-your-own only** — SnapServe does not provide managed email.

6. Agent-scoped deep pages (Agent channels, Meet, Memory) use `?agentId=` + an agent picker.

---

## 3. App navigation (Call plans IA)

```
Home
Call plans
Agents
People
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
| `/app/automatic-calls` (list) | `/app/people?tab=scheduled` |
| `/app/meta-leads` | `/app/people?tab=lead-sources` |
| `/app/calls`, `/app/activity` | `/app/history` |
| `/app/callbacks` | `/app/history?tab=callbacks` |
| `/app/transfers` | `/app/history?tab=transfers` |

**Deep-links kept** (not primary nav): `/app/channels` (Agent channels), `/app/whatsapp`, `/app/meet`, campaign / sheet detail routes.

---

## 4. Core objects and how they connect

```
     Connections          People
     (phone, WA,          (CSV / Sheet /
      Sheets, CRM)         website forms)
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
| People lists / sheets / forms | Legacy campaign / automatic-call / webhook engines; UI = `/app/people` |
| Agent channels / Meet / Memory | Query `?agentId=` + agent picker |
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

Meeting **join / delegate / memory** toggles live under **Agent channels → Meetings** (deep-link from Connections / Meet), not as a second prompt editor there.

### Tools tab

| Tool / control | Purpose |
|----------------|---------|
| **Booking** (one switch) | Book / check / list / reschedule / cancel — needs Scheduling calendar + event type |
| **End call** | Hang up politely |
| **Send email** | Mid-call email via Brevo (Agent channels → Email) |
| **Send WhatsApp** | Mid-call WhatsApp (channel must be connected) |
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

### Step palette

| Step | Meaning |
|------|---------|
| **Call them** | Dial with the plan’s agent; optional **Team** for mid-call handoffs |
| **Send WhatsApp** | Template-style follow-up (needs WhatsApp connected) |
| **Send email** | Brevo email (needs Agent channels → Email) |
| **Wait** | Pause (minutes / hours / days) |
| **Join a meeting** | Bot joins Meet / Zoom / Teams from a link on the person |
| **Update the list** | Write status back to the Sheet row (when people came from a sheet) |
| **If…** | Continue only when a condition is true (else this person’s path stops). Plain language: answered / didn’t answer / succeeded / custom |
| **Stop** | End this person’s path |

Retries and call-backs are **agent** settings — not plan steps.

### People on a plan

- **CSV / list** — attach a People list  
- **Paste phones** — one-off numbers  
- **Google Sheet** — attach a sheet pipeline  

### Run modes

| Mode | Behaviour |
|------|-----------|
| **Start once** | Run the attached people through the plan |
| **Keep live** | For Sheet people — keep watching new/updated rows |

### Results

Per-person / run progress on the plan detail page; full call outcomes also in **History**.

**Under the hood:** journeys + workflows. Product copy says **Call plans**.

---

## 7. People (who you reach)

**Route:** `/app/people`  

| Tab | Purpose | Legacy engine |
|-----|---------|---------------|
| **Lists / CSV** | Outbound list campaigns, batches, leads | `/app/campaigns` |
| **Google Sheet** | Sheet automatic-call pipelines | `/app/automatic-calls` |
| **Website forms** | Website webhook + Meta Lead Ads | `/app/meta-leads`, form campaigns |

Every list / sheet / form is bound to an **agent** (and usually attached to a **call plan** to Start).

Detail routes for campaign / batch / lead / sheet pipeline still exist for deep work.

---

## 8. Connections (wire once)

**Route:** `/app/connections`  

Hub for shared account wiring. Shortcut cards:

- **Phone numbers** → `/app/phone-numbers`  
- **WhatsApp** → `/app/whatsapp`  
- **Meetings** → `/app/meet`  
- **Agent channels** → `/app/channels` (per-agent WhatsApp / Email / Meetings / Booking)  
- **People lists** → `/app/people`  

Also on this page:

- **CRM:** HubSpot, Zoho — OAuth, field mapping, import, writeback  
- **Google Sheets:** OAuth for sheet people / write-back  
- **Lead webhooks:** listen/capture payload, map fields  
- **Meta Lead Ads** when connected  
- Recipes for Zapier / Make  

**Note:** Per-agent post-call CRM webhook also lives under Builder → Advanced. Connections = shared connectors; Advanced = that agent’s outbound post-call URL.

---

## 9. Agent channels (deep-link)

**Route:** `/app/channels?agentId=&channel=`  
**Not in primary nav** — opened from Connections / Meet / in-product links.

**Tabs:** Phone · WhatsApp · Email · Meetings · Booking  

| Channel | What it configures |
|---------|-------------------|
| **Phone** | Assign number; trial line; link to Phone Numbers |
| **WhatsApp** | Connection status; open WhatsApp admin |
| **Email** | Brevo API key + from-address + templates (BYO only) |
| **Meetings** | Enable join; this agent or **delegate**; pass memory / call context. Meeting **prompt** is edited in Builder → Prompt → In meetings |
| **Booking** | Calendar + event type readiness; links to Scheduling and Tools → Booking |

---

## 10. Phone Numbers

**Route:** `/app/phone-numbers` (also from Connections)  

| Tab | Purpose |
|-----|---------|
| **My numbers** | List, assign/unassign to agents, release |
| **Buy number** | Purchase DIDs (India-focused; KYC may be required) |
| **Verification** | KYC / identity verification |

Without an assigned number: inbound won’t ring the agent; outbound may use a shared trial line with daily caps (unless BYO telephony).

---

## 11. History

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

**Connection:** Tools → Booking uses the agent’s linked calendar + event type. Agent channels → Booking shows readiness.

---

## 13. Meet

**Route:** `/app/meet?agentId=` (from Connections)  

- Paste Google Meet / Zoom / Teams URL → launch bot  
- Meeting prompt: Builder → Prompt → In meetings  
- Join / delegate: Agent channels → Meetings  

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
2. Assign number to agent (Phone Numbers or Agent channels → Phone)  
3. Inbound rings this agent; outbound uses this caller ID  

### C — Call plan: list → call → WhatsApp

1. Create / pick agent  
2. People → Lists / CSV → upload bound to agent  
3. Call plans → new plan → steps: Call → WhatsApp → Wait…  
4. Attach list → **Start once**  
5. Watch plan results + History  

### D — Sheet keep-live

1. Connections → connect Google Sheets  
2. People → Google Sheet → map columns to agent  
3. Call plan → attach sheet → **Keep live**  
4. Optional: **Update the list** step writes status back  

### E — Website form → call plan

1. People → Website forms → webhook campaign bound to agent  
2. Paste webhook into the site form  
3. Attach / use with a call plan for dial + follow-ups  

### F — Book meetings from calls

1. Scheduling: calendar + event type  
2. Builder → Tools → Booking ON  
3. Agent books slots mid-call; optional Meet join via Agent channels → Meetings  

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
- **Tabs** under the header for People, History, Phone Numbers, Settings, etc.  

### Design principles

1. First teach **Agent → Call plan → People → Connections → History**.  
2. Do not revive **Automation / Dial flows / Journey / Activity** as primary nav labels.  
3. Prefer flat full pages; one job per screen.  
4. Cross-link generously (plan → People, Connections → Agent channels, Meet → Prompt).  
5. Empty states point to the next step (create agent → phone → call plan → people).  

### Surfaces that must feel like one family

Home · Call plans · Agents · People · Connections · History  

Builder is a focused editor. MORE and Settings are secondary / administrative.

---

## 23. Feature checklist (A–Z)

| Feature | Exists | Primary surface |
|---------|--------|-----------------|
| Agent create (wizard / Vibe) | Yes | Agents, Vibe |
| Dual prompts (calls / meetings) | Yes | Builder → Prompt / Overview |
| Voice stack + cloning | Yes | Builder → Voice, Providers |
| Mid-call tools | Yes | Builder → Tools |
| Booking suite | Yes | Tools + Scheduling + Agent channels |
| Voicemail AMD | Yes | Builder → Voicemail |
| Engine / barge-in / VAD | Yes | Builder → Advanced |
| Versions / publish | Yes | Builder → Versions |
| Live browser / phone test | Yes | Builder toolbar |
| Knowledge bases | Yes | Knowledge + Builder Overview |
| Phone buy / assign / KYC | Yes | Phone Numbers + Connections |
| WhatsApp Meta / BYO | Yes | WhatsApp + Agent channels |
| Email via Brevo | Yes | Agent channels → Email |
| Meetings join | Yes | Meet + Agent channels → Meetings |
| Call plans timeline | Yes | Call plans |
| If… (plain language) | Yes | Call plans steps |
| Start once / Keep live | Yes | Call plans |
| Sheet write-back step | Yes | Call plans |
| People lists / CSV | Yes | People |
| Google Sheets people | Yes | People + Connections |
| Website forms / Meta leads | Yes | People |
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
| **People** | Who you reach — CSV, Sheet, website forms |
| **Connections** | Shared wiring — phone, WhatsApp, Sheets, CRM, Meet |
| **History** | Calls, callbacks, transfers (what happened) |
| **Agent channels** | Per-agent phone / WA / email / meetings / booking deep page |
| **Team / Squad** | Multi-agent handoff group |
| **Production version** | Published snapshot used on live calls |
| **Webcall** | Browser live test |
| **BYO** | Bring your own (keys / telephony / Brevo / BSP) |
| **Journey / campaign** | Internal engine names — prefer Call plan / People in product copy |

---

## 25. UX redesign brief (current target)

**Goal:** SnapServe feels like voice orchestration you compose — agents talk, call plans decide what happens next.

**Must preserve**

- Call plans IA sidebar and redirects  
- Builder focused on speaking behaviour (not a second workflow canvas)  
- Retries on Agent, not on plans  
- Visible provider/model names  
- Booking as one switch; Email as Brevo-only  
- Current color theme  

**Primary screens**

1. Home (what’s running + create CTAs)  
2. Call plans (timeline editor)  
3. Agents / Builder (dual prompt + team strip)  
4. People  
5. Connections  
6. History  

**Success criteria**

- New user can create an agent and start a call plan without training  
- User never needs “Journey / Automation / Dial flows” words to succeed  
- No node graph; no retry controls on the plan  
- Cross-links make Agent ↔ Plan ↔ People ↔ Connections obvious  

---

*This document describes the shipped Call plans IA (Phases 1–5). Internal API field names (e.g. `journey`, `campaign`, `campaignId`) may still use legacy naming.*
