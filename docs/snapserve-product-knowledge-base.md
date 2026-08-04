# SnapServe — Complete Product Knowledge Base

**Audience:** External UI/UX designers and product partners  
**Product:** SnapServe (`app.snapserve.ai`) — Indic-first AI voice agent platform  
**Last updated:** August 2026  
**Purpose:** Full feature map, Agent Builder structure, and how every surface connects to an agent

---

## 1. What SnapServe is

SnapServe lets a business create a **voice agent**, teach it how to talk, then attach:

1. **How work reaches it** (forms, sheets, lists, dial rules, journeys)  
2. **How it talks back** (phone, WhatsApp, email, meetings, booking)

SnapServe runs the calls, logs activity, and bills by wallet/minutes.

**One-line product model:**

> You create an **agent** → you teach it how to speak → you attach **Automation** and **Channels** → SnapServe runs the rest.

---

## 2. Mental model (critical for UX)

Everything revolves around the **Agent**.

| Layer | Job | Where in the app |
|-------|-----|------------------|
| **Build** | Teach the agent to speak (prompt, voice, tools, engine) | **Agents** → Agent Builder |
| **Operate** | Bring work to the agent and watch results | Activity, Automation, Dial flows, Phone Numbers |
| **Connect** | Give the agent ways to communicate | Channels, Integrations, Scheduling, Meet, WhatsApp |
| **Intelligence** | Knowledge, memory, multi-agent teams, analytics | Knowledge, Memory, Squads, Analytics |
| **Settings** | Workspace, keys, billing | Workspace, Providers, Developers, Billing |

### Hard product rules (do not mix these in UX)

1. **Agent Builder ≠ Automation ≠ Channels**  
   - Builder = agent runtime only (prompt / voice / tools / engine / versions)  
   - Automation = how leads reach the agent  
   - Channels = how the agent communicates  

2. **Booking = one suite switch** in Tools (not five separate toggles in the UI).

3. **Email = Brevo bring-your-own only** — SnapServe does not provide managed email.

4. Agent-scoped pages use a shared **agent picker** (`?agentId=`). Switching agent keeps you on the same page.

---

## 3. App navigation (current IA)

```
Home
Agents

OPERATE
  Activity          — calls, callbacks, transfers
  Automation        — sources, call rules, journeys (per agent)
  Dial flows        — list dial / sheet dial / website forms
  Phone Numbers     — buy, assign, KYC

CONNECT
  Channels          — phone, WhatsApp, email, meetings, booking (per agent)
  Integrations      — CRM, Google Sheets, webhooks
  Scheduling        — calendars, event types, bookings
  Meet              — send agent into Meet / Zoom / Teams
  WhatsApp          — WhatsApp channel admin

INTELLIGENCE
  Knowledge         — FAQ / text / website / files for agents
  Memory            — per-caller facts & history (per agent)
  Squads            — multi-agent handoff teams
  Analytics         — KPIs and trends

── Settings ──
  Workspace · Providers · Developers · Billing
```

**Partner accounts** also see **Partner Hub**.  
**Managed clients** (run by a partner) see a trimmed nav: Home, Agents, Activity, Phone Numbers, Workspace, Billing — partner builds automation/channels for them.

---

## 4. Core objects and how they connect

```
                    ┌─────────────┐
                    │   Agent     │  ← center of the product
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           │               │               │
     ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
     │ Automation│   │ Channels  │   │  Tools /  │
     │ (Reach)   │   │           │   │ Knowledge │
     └─────┬─────┘   └─────┬─────┘   └───────────┘
           │               │
     Dial flows      Phone / WA /
     Sheets / Forms  Email / Meet /
     Journeys        Booking
           │
     ┌─────▼─────┐
     │  Calls    │ → Activity, Analytics, Memory, Wallet
     └───────────┘
```

### Binding mechanism

| Binding | How |
|---------|-----|
| Builder | Route `/app/agents/:id` |
| Automation, Channels, Meet, Memory | Query `?agentId=` + agent picker |
| Campaigns / sheet pipelines / journeys | Foreign key `agentId` on the flow |
| Phone numbers | Number assigned to `agentId` |
| Knowledge | Sources attached on agent (`knowledgeSourceIds`) |
| Live production | Published **Version** snapshot (not unsaved draft) |

---

## 5. Agent Builder (current shape)

**Route:** `/app/agents` → opens last/first agent → `/app/agents/:id`  
**Create:** Home / sidebar “New agent” → Vibe Build (AI) or manual configure.

### Builder chrome

- Back, agent name (rename), Live/Draft status, Unsaved
- Actions: Phone test, Live test (browser webcall), Save
- More: Publish version, Refine with AI, Delete
- Horizontal segment tabs (below header)

### Builder tabs (ONLY these)

| Tab | What the user does |
|-----|--------------------|
| **Overview** | Pipeline chips (ASR / LLM / Voice), greeting, prompt preview, attach knowledge sources, quick health |
| **Prompt** | Full system prompt, AI generate, prompt variables, timezone, end-call phrases |
| **Voice** | ASR + LLM + TTS stack, voice picker/cloning, ambient noise, speech rate; Gemini Live vs classic |
| **Tools** | Mid-call capabilities (see below) |
| **Voicemail** | Outbound answering-machine detect: hang up or leave TTS message |
| **Advanced** | Engine timing, limits, post-call webhook, dispositions, India compliance (IRDAI / DPDP / TRAI) |
| **Versions** | Draft / Production snapshots — compare, restore, publish |

**Not in Builder anymore:** Automation (Reach) and Channels. Those live as separate sidebar pages.

### Tools tab (capabilities the agent can use mid-call)

| Tool / control | Purpose |
|----------------|---------|
| **Booking** (one switch) | Enables book / check availability / list / reschedule / cancel — needs Scheduling calendar + event type |
| **End call** | Agent can hang up politely |
| **Send email** | Mid-call email via Brevo (Channels → Email must be set) |
| **Send WhatsApp** | Mid-call WhatsApp (channel must be connected) |
| **Call transfer** | Warm transfer to a human number |
| **Custom HTTP tools** | User-defined webhooks with JSON schema |
| **Call recording** | Record conversations |
| **Gender detection** | Optional signal |
| **Voice memory** | Remember facts about the caller across calls |

### Advanced tab (engine & ops)

- **Engine:** Fast / Balanced / Patient presets, barge-in, endpointing, VAD tuning  
- **Limits:** max duration, auto-redial, telephony provider (Vobiz managed / Plivo / Twilio BYO)  
- **Analytics / Integrations:** post-call CRM webhook URL + HMAC; disposition categories  
- **Compliance:** optional Indian regulatory prompt injections  

### Versions

- **Save** updates the working draft  
- **Publish** promotes draft → **Production** (what live calls use)  
- Previous Production becomes a frozen published snapshot  

### How users create an agent

1. **Vibe Build** (`/app/vibe`) — describe the use case; AI scaffolds prompt/voice  
2. **Manual** — empty agent → fill Prompt / Voice / Tools  
3. **Refine with AI** — from builder, reopen Vibe against an existing agent  

---

## 6. Automation (how work reaches the agent)

**Route:** `/app/automation?agentId=`  
**UI:** Agent picker + Reach panel

Automation answers: *“When should this agent place or receive work?”*

### Source presets (common journeys)

| Preset | What happens |
|--------|----------------|
| **Website form → Call** | Form posts to webhook → lead → instant dial |
| **Google Sheet → Call** | New/updated rows enqueue outbound calls |
| **Upload list → Call** | CSV / list campaign batches |
| **Join a meeting** | Deep-link to Meet with this agent |
| **Call rules** | Retries, quiet hours, concurrency, delays |
| **After-call sequence (Journey)** | WhatsApp / email / wait / callback / webhook after the call |
| **Custom sequence** | Custom journey step editor |

### Armed flows

Shows active campaigns and sheet pipelines for the selected agent, with status and deep links into Dial flows.

### Call rules (agent defaults + per-flow overrides)

- Max attempts, retry delay, call delay  
- Concurrent call limit  
- Business hours + timezone  
- Auto-redial on drop  

### Journeys (after-call sequences)

Multi-step workflows on the agent:

- Steps: Call, Wait, WhatsApp, Email, Callback, Webhook, conditionals, Squad handoff  
- Triggers: e.g. no-answer, interested, always after call  
- Status: draft / active / paused  

---

## 7. Channels (how the agent communicates)

**Route:** `/app/channels?agentId=&channel=`  
**Tabs:** Phone · WhatsApp · Email · Meetings · Booking  

| Channel | What it configures |
|---------|-------------------|
| **Phone** | Assign purchased/managed number for inbound + outbound caller ID; trial line for limited testing; link to Phone Numbers |
| **WhatsApp** | Status of Meta Business / BYO BSP connection; open WhatsApp admin to configure |
| **Email** | Brevo API key + verified from-address + templates/variables (BYO only) |
| **Meetings** | Meeting-specific prompt; or delegate another agent; pass memory / call context into the room |
| **Booking** | Readiness for calendar + event type; links to Scheduling and Builder → Tools → Booking |

---

## 8. Dial flows (account-wide campaigns)

**Route:** `/app/campaigns`  
**Tabs:**

| Tab | Purpose |
|-----|---------|
| **List dials** | CSV/list outbound campaigns, batches, leads |
| **Sheet dial** | Google Sheets automatic-call pipelines |
| **From Website** | Website webhook campaigns + Meta Lead Ads |

Every dial flow is bound to an **agentId** — that agent’s Production config handles the call.

Detail routes: campaign detail, batch wizard, lead profile, sheet pipeline detail.

---

## 9. Integrations

**Route:** `/app/connections`  
Account-level credentials used by Automation / Dial flows:

- **CRM:** HubSpot, Zoho — OAuth, field mapping, import to campaigns, writeback  
- **Google Sheets:** OAuth for sheet dial  
- **Webhooks:** listen/capture sample payload, map fields to agent variables  
- **Meta Lead Ads:** forms → instant dial  
- Recipes for Zapier / Make  

**Note:** Per-agent post-call CRM webhook also exists under Builder → Advanced. Integrations page = shared connectors; Advanced = that agent’s outbound post-call URL.

---

## 10. Phone Numbers

**Route:** `/app/phone-numbers`  

| Tab | Purpose |
|-----|---------|
| **My numbers** | List, assign/unassign to agents, release |
| **Buy number** | Purchase DIDs (India-focused; KYC may be required) |
| **Verification** | KYC / identity verification |

Without an assigned number: inbound won’t ring the agent; outbound uses a shared trial line with daily caps (unless BYO telephony).

---

## 11. Activity

**Route:** `/app/calls`  

| Tab | Purpose |
|-----|---------|
| **All calls** | Full call log, filters, export, detail |
| **Callbacks** | Scheduled callbacks + auto-redials |
| **Transfers** | Human transfer history |

Call detail includes transcript, recording (if enabled), disposition, cost, agent.

---

## 12. Scheduling & Booking

**Route:** `/app/scheduling`  

- Bookings list  
- Calendars (e.g. Google Calendar sync)  
- Event types (duration, buffers, public booking page `/book/:slug`)  
- Availability  
- Conferencing (Meet / Zoom / Teams links for bookings)  

**Connection to agent:** Tools → Booking suite uses the agent’s linked calendar + event type. Channels → Booking shows readiness.

---

## 13. Meet

**Route:** `/app/meet?agentId=`  

- Paste Google Meet / Zoom / Teams URL  
- Launch bot with selected agent  
- Meeting behaviour configured under Channels → Meetings (prompt or delegate agent)

---

## 14. WhatsApp

**Route:** `/app/whatsapp`  

Standalone admin for Meta Business API and BYO BSP connections, templates, and agent binding. Channels → WhatsApp shows readiness and deep-links here. Instant (shared SnapServe) WhatsApp is no longer offered for new enrollments.

---

## 15. Knowledge

**Route:** `/app/knowledge-bases`  

Sources:

- FAQ  
- Free text  
- Website crawl  
- File upload  

Attach sources to an agent on Builder → Overview. Agent can ground answers on that content during calls.

---

## 16. Memory

**Route:** `/app/memory?agentId=&caller=`  

Per-agent, per-caller:

- Facts the agent remembered  
- Call episodes / history  
- Edit notes, delete facts, reset memory  

Requires Voice memory enabled in Tools for capture during calls.

---

## 17. Squads

**Route:** `/app/squads`  

Multi-agent teams:

- Supervisor / specialist roles  
- Handoff instructions  
- Attach to journey Call steps or dial flows for live specialist handoff  

---

## 18. Analytics

**Route:** `/app/analytics`  

Workspace KPIs: leads, connected, booked, transferred, rates, daily trends; filter by campaign. Per-agent analytics also available.

---

## 19. Settings

| Page | Contents |
|------|----------|
| **Workspace** | Profile, workspace settings, Team |
| **Providers** | Voices library + BYO ASR / LLM / TTS / telephony API keys |
| **Developers** | API keys (`sk_live_…`), workspace webhooks |
| **Billing** | Wallet balance, Razorpay top-up, auto-pay, GST/invoices, Usage |

Default India stack (when not BYO): Sarvam ASR, Google LLM, Cartesia/Sarvam TTS, Vobiz telephony.

---

## 20. Partner & managed clients

| Role | Experience |
|------|------------|
| **Partner** | Partner Hub: invite clients, wallets, earnings, “Act as client” to build on their account |
| **Managed client** | Trimmed UI — can test agents and see activity/numbers; cannot configure Automation/Channels/Integrations themselves |

---

## 21. End-to-end user journeys

### Journey A — Create → teach → go live

1. Create agent (Vibe or manual)  
2. Builder: Prompt + Voice + Tools  
3. Live test (browser) and/or Phone test  
4. Publish version → Production  
5. Agent status: Live  

### Journey B — Go live on phone

1. Buy / verify phone number  
2. Channels → Phone → assign number to agent  
3. Inbound rings this agent; outbound uses this caller ID  

### Journey C — Website form → instant call

1. Integrations / Dial flows → From Website → create webhook campaign bound to agent  
2. Paste webhook into website form  
3. Form submit → lead → agent dials  
4. Optional: Automation → Journey for WhatsApp/email follow-up  

### Journey D — Google Sheet dialer

1. Integrations → connect Google Sheets  
2. Automation → Sheet → Call (or Dial flows → Sheet dial)  
3. Map columns; start pipeline  
4. Monitor Activity + Analytics  

### Journey E — Book meetings from calls

1. Scheduling: calendar + event type  
2. Builder → Tools → Booking ON  
3. Channels → Booking shows linked  
4. Agent books slots mid-call; optional Meet join via Channels → Meetings  

---

## 22. UX structure notes for designers

### Current chrome system

- **Sidebar** = global IA  
- **StripePage** = one page title + one-line description + actions (no second global title bar)  
- **AgentContextBar** = agent Select + “Edit agent” on agent-scoped pages  
- **Tabs** under the page header for multi-section screens (Activity, Dial flows, Settings, etc.)  

### Design principles the product expects

1. **Agent is always visible** when configuring Automation / Channels / Meet / Memory.  
2. **Do not put Automation or Channels back inside Builder** — separation is intentional.  
3. Prefer **flat full pages** over nested card-in-card chrome.  
4. Show **connection** between surfaces with clear cross-links (e.g. Channels → Manage numbers, Automation → Open Dial flows).  
5. Empty states should point to the next required step (create agent → buy number → wire source).  

### Surfaces that must feel like one family

Home · Automation · Channels · Integrations · Activity · Dial flows · Phone Numbers  

These are the Operate/Connect spine. Builder is a focused editor; Settings are administrative.

---

## 23. Feature checklist (A–Z)

| Feature | Exists | Primary surface |
|---------|--------|-----------------|
| Agent create (manual / Vibe AI) | Yes | Agents, Vibe |
| Prompt + variables | Yes | Builder → Prompt |
| Voice stack + cloning | Yes | Builder → Voice, Providers |
| Mid-call tools | Yes | Builder → Tools |
| Booking suite | Yes | Tools + Scheduling + Channels |
| Voicemail AMD | Yes | Builder → Voicemail |
| Engine / barge-in / VAD | Yes | Builder → Advanced |
| Versions / publish | Yes | Builder → Versions |
| Live browser test | Yes | Builder toolbar |
| Outbound phone test | Yes | Builder toolbar |
| Knowledge bases | Yes | Knowledge + Builder Overview |
| Phone buy / assign / KYC | Yes | Phone Numbers + Channels |
| WhatsApp Meta Business / BYO | Yes | WhatsApp + Channels |
| Email via Brevo | Yes | Channels → Email |
| Meetings join (Meet/Zoom/Teams) | Yes | Meet + Channels → Meetings |
| Website form → call | Yes | Dial flows + Automation |
| CSV / list campaigns | Yes | Dial flows |
| Google Sheets dialer | Yes | Dial flows + Integrations |
| Meta Lead Ads | Yes | Dial flows / Integrations |
| Call rules / quiet hours | Yes | Automation |
| After-call journeys | Yes | Automation |
| CRM (HubSpot, Zoho) | Yes | Integrations |
| Post-call webhook | Yes | Builder Advanced |
| Dispositions | Yes | Builder Advanced |
| Call logs / callbacks / transfers | Yes | Activity |
| Caller memory | Yes | Memory + Tools toggle |
| Squads / handoffs | Yes | Squads + Journeys |
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
| **Agent** | The AI voice persona (prompt, voice, tools, published version) |
| **Builder** | UI to configure the agent’s speaking behaviour |
| **Automation / Reach** | How leads and dial rules reach an agent |
| **Channels** | Communication rails: phone, WA, email, meetings, booking |
| **Dial flow / Campaign** | Outbound list, sheet, or website intake bound to an agent |
| **Journey** | After-call multi-step sequence |
| **Production version** | Published snapshot used on live calls |
| **Webcall** | Browser-based live test of the agent |
| **Squad** | Multi-agent team for specialist handoffs |
| **BYO** | Bring your own (keys / telephony / Brevo / BSP) |

---

## 25. Suggested UX redesign brief (for outside help)

**Goal:** Make SnapServe feel structured, connected, and professional — Stripe-quality full pages, agent always at the center.

**Must preserve**

- Builder vs Automation vs Channels separation  
- Full sidebar discoverability of product surfaces  
- Agent picker on agent-scoped pages  
- Booking as one switch; Email as Brevo-only  

**Problems to solve**

- Users don’t see how Builder → Channels → Automation → Dial flows connect  
- Dense / uneven visual hierarchy across pages  
- Setup path (agent → number → source → journey) is easy to lose  

**Primary screens to redesign first**

1. Home (setup + health)  
2. Agent Builder  
3. Automation  
4. Channels  
5. Dial flows  
6. Activity  

**Success criteria**

- New user can create an agent and place a test call in &lt; 10 minutes  
- User can answer: “Which agent am I configuring?” on every Operate/Connect page  
- No duplicate page titles; clear one-job-per-screen  
- Cross-links make the agent connection obvious without dumping everything into Builder  

---

*This document describes the shipped product model as of the Stripe-style full-page UX rebuild. Internal API field names (e.g. `campaign`, `campaignId`) may still use legacy naming.*
