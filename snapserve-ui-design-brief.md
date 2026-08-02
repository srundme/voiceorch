# SnapServe — Complete UI/UX Design Brief
> Use this document as the primary source for designing the SnapServe console.  
> It covers what the product is, how it works end-to-end, every screen's purpose and content, data flows, and design direction notes.

---

## 1. What is SnapServe?

SnapServe is a **voice AI infrastructure platform**. It is not a single voice-agent product — it is the infrastructure layer that lets businesses *build, deploy, and operate* AI voice agents at scale. Think of it like Twilio (telephony infra) combined with OpenAI (AI) but purpose-built for voice agents that call people in Indian languages.

**Customers are:**
- Businesses building their own AI call centres (e.g. an expo organiser running an outbound booking campaign)
- Developers integrating voice AI into their products via the SnapServe API
- Operators running agents on behalf of their clients (partner accounts)

**The platform provides (building blocks):**
1. AI voice agents (LLM + prompt + memory)
2. STT (speech-to-text) — converts caller audio to text
3. TTS (text-to-speech) — converts AI reply to audio
4. Telephony — phone numbers, inbound/outbound calls, WhatsApp
5. Knowledge bases — documents the agent can look up mid-call
6. Caller memory — remembers facts about each phone number across calls
7. Campaigns — automated outbound dialling at scale
8. Analytics — call logs, recordings, transcripts, quality metrics
9. Developer tools — REST API, webhooks, API keys, docs

---

## 2. Core Mental Model: Building Blocks

Every agent is **assembled from building blocks** that exist independently:
- A **voice** (TTS engine + voice character) is set up once and reused across agents
- A **knowledge base** is a collection of documents — one KB can feed multiple agents
- A **phone number** is provisioned once and pointed at an agent
- An **LLM provider key** is added once and shared across all agents using that provider
- **Caller memory** is stored per phone-number per agent — the agent remembers who called before

The UI must make this assembly model explicit. The home screen shows blocks with live status. The agent builder assembles blocks step by step.

---

## 3. Two Audiences — One Dashboard

| | Business User | Developer |
|---|---|---|
| **Background** | Non-technical founder / ops team | API integrator / backend engineer |
| **Language** | Plain English / Tamil | Technical terms, provider names, model IDs |
| **Needs** | Which agents are live, how many calls today, wallet balance | Latency numbers, API usage, webhook events, error traces |
| **Navigation** | Agents, Calls, Campaigns, Wallet | Also: API Keys, Webhooks, API Docs, raw event logs |

**Implementation:** Same navigation for both. Developer items live at the bottom of the left sidebar under a "Developers" section. Business users can ignore that section. No separate mode or toggle.

---

## 4. Information Architecture (Navigation)

The left sidebar has these sections in order:

```
[Logo + Account Switcher]
[Search bar — ⌘K]

HOME                      ← landing dashboard

BUILD
  Agents
  Knowledge
  Voices & Languages
  Intelligence            ← LLM providers, fallback, caller memory settings

CONNECT
  Phone Numbers
  WhatsApp
  Integrations            ← Google Calendar, CRM webhooks, meeting bots

OPERATE
  Calls                   ← live + historical call log
  Campaigns
  Analytics

DEVELOPERS
  API Keys
  Webhooks
  API Docs / Explorer

ACCOUNT
  Wallet & Billing
  Team
  Partner Console         ← only visible for partner accounts
```

Bottom of sidebar always shows:
- Current wallet balance + a thin colour bar (green = healthy, amber = low)
- User avatar + account name

---

## 5. Screen-by-Screen Specification

---

### 5.1 HOME

**Purpose:** Status overview — the infrastructure at a glance.  
**URL:** `/`

#### Layout

**Top bar:**
- Search field (⌘K opens full command palette)
- System status indicator: "All systems operational" in green, or "Degraded: VoBiz latency" in amber
- Notification bell
- User avatar

**Greeting header:**
```
Good morning, [Name]
Your voice infrastructure at a glance — [N] agents live, [N] calls today.
```
Plus a primary CTA button: **+ Create agent**

**Alert strip (conditional):**
Only shown when there is an actionable problem. Examples:
- "WhatsApp channel for [Agent Name] is pending verification — brochures won't send until approved. [Fix now]"
- "Wallet balance ₹420 — estimated runway 2 days at current spend. [Top up]"
- "Knowledge base [Name] needs re-sync — content changed. [Sync now]"

Each alert has a one-line description + a direct action link.

**Stat strip (4 cards across):**
- Calls today: `128` / `+18% vs yesterday`
- Live right now: `3` / `2 outbound · 1 inbound`
- Avg. answer quality: `94%` / `STT confidence, 7-day avg`
- Spend today: `₹312.40` / `₹2.44 avg / call`

**Building blocks grid (2×3 or 3×2):**

Each block is a card with:
- Icon + block name
- Status line: green dot "3 live · 1 draft" or amber dot "1 source needs re-sync"
- 3 key facts (key → value pairs)
- A link "Open [block] →"
- Arrow icon top-right (navigates to the block's main page)

The 6 blocks are:
1. **Agents** — N live · N draft, lists top 3 agent names + status
2. **Phone Numbers** — N active, lists numbers + assigned agents
3. **Intelligence** — LLM + memory health, shows current LLM, fallback, memory count
4. **Voices & Languages** — N voices in use, TTS/STT providers, language list
5. **Knowledge** — N sources, shows sync status per source
6. **Campaigns** — N running, shows running campaign name + progress

**Recent calls table:**
- Columns: Status dot | Phone number | Agent name | Direction + duration | Outcome summary | Time ago
- 5–10 rows
- "View all →" link

---

### 5.2 AGENTS LIST

**Purpose:** See all agents, their live status, and create new ones.  
**URL:** `/agents`

#### Layout

**Header:** "Agents" + "New agent" button

**Filter bar:** All · Live · Draft · Archived + Search

**Agent cards (grid or list, user can toggle):**

Each card shows:
- Agent name (large)
- Status badge: LIVE / DRAFT / ARCHIVED
- Language(s): "Tamil · English"
- LLM: "Gemini 3.6 Flash"
- Attached number: "+91 44 6142 0198" or "No number"
- Calls this week: `43`
- Last call: "2 hours ago"
- 3-dot menu: Edit · Duplicate · Archive · Delete

**Empty state:**
"You haven't built any agents yet. An agent is the AI that talks to your callers — it needs a voice, a prompt, and a phone number. [Build your first agent →]"

---

### 5.3 AGENT DETAIL (view an existing agent)

**URL:** `/agents/[id]`

**Status header:**
```
[Agent Name]
● LIVE   Last call: 2 hours ago   Calls today: 12   Avg. duration: 2m 18s
[Edit agent]  [View calls]  [Test call]
```

**Tabs:** Overview · Calls · Analytics · Settings

**Overview tab shows:**
- The assembled block stack as a visual column:
  - Identity (name, description, welcome message)
  - Brain (LLM, fallback, memory on/off)
  - Voice (TTS voice, STT engine, language)
  - Phone (attached number, inbound/outbound)
  - Knowledge (attached KBs with entry count)
  - Behavior (system prompt summary, transfer settings)
- Each block item has an "Edit" link that deep-links into the builder

---

### 5.4 AGENT BUILDER (create / edit)

**URL:** `/agents/new` or `/agents/[id]/edit`

This is the most important screen. It is a **guided 6-step wizard** with:
- Left: step navigation rail
- Centre: current step's form
- Right: live "agent so far" assembly panel

#### Step Rail (left sidebar, ~240px wide)

Shows all 6 steps vertically:
- Each step has: step number (or ✓ if done) + step name + one-line hint if active
- Done steps: green circle with checkmark
- Active step: highlighted (indigo/brand colour)
- Future steps: grey, not clickable until unlocked

Steps:
1. **Identity** — Name, company, persona, welcome message
2. **Brain** — LLM model, fallback model, caller memory on/off, knowledge selection
3. **Voice & Ears** — TTS voice picker, STT engine, language/dialect
4. **Phone** — Attach number, or buy new, or BYO carrier
5. **Behavior** — System prompt (with structured template), call flow, transfers
6. **Test & Launch** — Web call test, readiness checklist, go live

At the bottom of the step rail, a small callout:
> "Each step pulls from your building blocks — voices, numbers, and knowledge you configure once and reuse across agents."

#### Step 1: Identity

Fields:
- **Agent name** (internal) e.g. "Fortune Expo Agent"
- **Company / brand** e.g. "Fortune Trade Fairs"
- **What does this agent do?** (one line) e.g. "Books stall visits for Codissia expo"
- **Welcome message mode:** radio
  - "Agent speaks first" → show text field for first spoken line
  - "Wait for caller to speak first"
- **Persona notes** (optional) — tone, style hints

#### Step 2: Brain

**LLM selection:**
Cards for each provider: Gemini 3.6 Flash (Recommended), Gemini 2.5 Pro, Groq Llama, Krutrim, OpenAI.  
Each card shows: provider logo, model name, latency badge (p50 TTFB), note (e.g. "Best for Tamil")  
User can also enter a custom API key or use the platform's managed key.

**Fallback LLM:**
Same picker, smaller. "If primary fails, use this." Default: Groq Llama 3.

**Caller memory:**
Toggle: ON / OFF  
Description: "The agent remembers facts about each caller across calls (name, company, previous interest). Stored per phone number."

**Knowledge bases:**
Multi-select checkboxes from the user's knowledge bases, each showing: name, entry count, sync status.  
Link: "Add new knowledge base →"

#### Step 3: Voice & Ears

**TTS Voice picker:**
4–8 voice cards in a 2-column grid. Each card:
- Play button (▶) — plays a 5-second sample
- Voice name (e.g. Meera)
- Language + dialect (e.g. Tamil · Chennai)
- Provider (e.g. Cartesia Sonic-3)
- Tone descriptor (e.g. Warm, friendly)
- Latency badge (p50 TTFB in ms)
- Selected state: highlighted border + "Selected" tag

**Language / Dialect:**
Dropdown. Options include:
- Tamil (Chennai spoken) + English mix
- Tamil (Neutral) + English mix
- English (Indian accent)
- Hindi + English mix
- Custom (type BCP-47 code)

Description: "The agent replies in the caller's language and switches mid-call if they switch."

**STT Engine:**
Dropdown with recommendation flag:
- Sarvam Saaras v3 ← Recommended for Tamil / code-mixed
- Azure STT (en-IN, ta-IN)
- Google STT

Each option shows: provider, model name, WER estimate for Indian languages, streaming support.

**Advanced (collapsed):**
- TTS speed (slider 0.8× – 1.4×)
- Barge-in sensitivity (Low / Medium / High)
- Endpointing silence (ms) — how long to wait after speech before agent replies
- Noise gate: On / Off

#### Step 4: Phone

**Three options (tabs):**

**Tab A — Use an existing number:**
List of the account's phone numbers with their current assignment (or "Unassigned").  
User selects one. If a number is already assigned to another agent, show a warning.

**Tab B — Get a new number:**
Search field: "Search by prefix, city, or type"  
Results list: number, location, type (local/mobile/TF), monthly cost  
[Buy ₹X/mo] button  
Number is provisioned immediately and attached to this agent.

**Tab C — BYO carrier:**
Input fields: SIP trunk details or VoBiz / Plivo account credentials.  
Link to docs for BYO setup.

**WhatsApp (below phone section):**
Optional. "Connect a WhatsApp channel to let this agent send follow-up messages."  
Dropdown of existing WA channels or [Set up WhatsApp →]

#### Step 5: Behavior

**System prompt:**
Large textarea with a structured template pre-loaded:
```
IDENTITY
[Who you are and what you do]

LANGUAGE AND SPEECH
[Language rules]

FACTS — YOUR ONLY SOURCE OF TRUTH
[Key facts the agent must know]

CALL FLOW
[How the call should go, goal by goal]

HARD CONSTRAINTS
[What you must never do]
```
Tab: "Use template" | "Write from scratch" | "Let AI build this for me →"

**Transfer to human:**
Toggle. If on: enter a phone number / SIP endpoint to transfer to, and the conditions for transfer (e.g. "caller asks to speak to a human").

**Scheduling / booking:**
Toggle. If on: connect Google Calendar (OAuth) and define booking behaviour.

**Call limits:**
- Max call duration (minutes)
- Auto-redial: on/off, max attempts, retry delay

#### Step 6: Test & Launch

**Readiness checklist:**
Each item: ✓ green (done) or ✗ amber (missing):
- ✓ Identity configured
- ✓ LLM model selected
- ✓ Voice selected
- ✓ Phone number attached
- ✗ System prompt empty — [Edit]
- ✓ Knowledge base attached

**Web call test:**
A panel simulating a phone call in the browser:
- [▶ Start test call] button
- When active: live transcript panel (caller side left, agent side right)
- Status: "Listening…" / "Agent speaking…"
- End call button

**Go live:**
- Toggle: DRAFT → LIVE
- Confirmation: "This will make the agent answerable on +91 44 6142 0198 and dialable from campaigns."
- [Activate agent] button (primary, full-width)

#### Right Panel: "Agent so far" (persists across all steps)

A vertical stack showing each block as it gets filled in:
- Block name + icon
- Brief value summary (filled green / empty grey)
- E.g. "Voice: Meera · Tamil Chennai" in green, "Phone: Not chosen yet" in grey

At the bottom: "Test call unlocks at step 6" with a locked icon.

---

### 5.5 KNOWLEDGE

**URL:** `/knowledge`

**Header:** "Knowledge" + "Add source" button

**Sources list:**
Each source card:
- Source name (e.g. "Expo Brochure 2026")
- Type badge: DOCUMENT / URL / SPREADSHEET / MANUAL
- Entry count: "42 entries"
- Sync status: "Synced 2h ago" (green) or "Re-sync needed" (amber) or "Sync failed" (red)
- Used by: "Fortune Expo Agent, Policy Renewals Agent" (linked)
- Last synced timestamp
- Actions: Sync now · Edit · Delete

**Creating a source:**
Modal or side panel:
- Name
- Type: upload file / enter URL / paste text / connect Google Sheet
- Description (optional)
- Preview of extracted entries after processing

**Entries view (click a source):**
Table: Entry title | Content preview | Last updated | Delete icon  
Search bar within the source.

---

### 5.6 VOICES & LANGUAGES

**URL:** `/voices`

**Purpose:** Browse all available voices, preview them, and see which agents are using which.

**Layout:**

**Filter bar:** Provider (All / Cartesia / Sarvam / Azure) · Language (All / Tamil / Hindi / English) · Gender

**Voice cards (grid):**
Each card:
- Voice name (e.g. Meera)
- Language + dialect
- Provider
- Tone descriptor
- ▶ Play sample button (plays in-card)
- "Used by N agents" link
- [Use in agent →] button

**My active voices (top section):**
Voices currently used by at least one agent, shown as a compact list with live status.

---

### 5.7 INTELLIGENCE

**URL:** `/intelligence`

**Sections:**

**LLM Providers:**
Cards for each provider the user has configured:
- Provider name + logo
- Auth method: "Platform managed key" or "Your API key (ends …abc)"
- Status: Healthy / Degraded
- [Manage key] button

[+ Add provider] button opens a modal: select provider, enter API key (hidden input), test connection.

**Fallback chain:**
Visual chain: Primary → Fallback → (last resort)  
User can drag-reorder or edit each slot.

**Caller Memory:**
Toggle: ON / OFF (account-wide default; agents can override)  
Stat: "Memory stored for X callers across Y agents"  
Retention setting: "Delete memory after N days of no calls" (dropdown)  
[Export all memory data] and [Delete all memory data] buttons (destructive actions behind confirmation)

**Voice Prints:**
Toggle: ON / OFF  
Description: "Detect mid-call if a different person picks up (e.g. a gatekeeper)."  
Stat: "N voice prints enrolled"

---

### 5.8 PHONE NUMBERS

**URL:** `/numbers`

**Header:** "Phone Numbers" + "Get a number" button

**Active numbers list:**
Each row:
- Phone number (E.164 format, e.g. +91 44 6142 0198)
- Type: Local / Mobile / Toll-Free
- Provider: VoBiz / Plivo / BYO
- Assigned to: "[Agent Name]" (linked) or "Unassigned" (amber)
- Monthly cost: ₹X/mo
- Calls this month: N
- Actions: Reassign · Release

**Get a number flow (modal or slide-out):**
1. Search: prefix / city / type / country
2. Results table: number, city, type, monthly cost
3. Select + [Confirm purchase]
4. Auto-assigned to the agent you came from (if launched from agent builder), or "Unassigned"

**BYO Carrier tab:**
Form to add a Plivo or VoBiz sub-account, or raw SIP trunk credentials.  
Shows connected carriers with status dot.

---

### 5.9 WHATSAPP

**URL:** `/whatsapp`

**Channels list:**
Each channel:
- WhatsApp number / WABA ID
- Display name
- Status: Verified / Pending / Blocked
- Used by: N agents
- Template count: N approved templates

**Inbound chatbot:**
Toggle per channel.  
Responses: Connect to an agent (AI replies) or define keyword→response rules.

**Brochure sending:**
Per-agent setting (also accessible from the agent's Behavior step):
"After a call ends, send a follow-up message with [select template]."  
Preview of the template with variables.

---

### 5.10 CALLS LOG

**URL:** `/calls`

**Filter bar:** Direction (All / Inbound / Outbound) · Agent · Status (Completed / No answer / Failed) · Date range · Phone number search

**Table columns:**
Direction icon | Phone number | Agent | Duration | Outcome tag | Spend | Date/time

**Outcome tags:** Booked · Info given · Transferred · No answer · Voicemail · Hung up · Failed

**Click a row → Call Detail page:**
- Header: direction, number, agent, timestamp, duration
- Status timeline: Dialled → Answered (Xm Ys) → Agent greeting → [events] → Ended
- Transcript: alternating caller / agent speech bubbles, timestamps, language labels (TA / EN per line)
- Recording player (if recording enabled)
- Call execution log: internal events (STT confidence, LLM latency, TTS latency, tool calls)
- Memory snapshot: facts extracted from this call
- Cost breakdown: LLM tokens + TTS chars + STT seconds + telephony seconds

---

### 5.11 CAMPAIGNS

**URL:** `/campaigns`

**Campaign cards:**
- Campaign name
- Status badge: RUNNING / PAUSED / COMPLETED / DRAFT
- Agent: [Agent Name]
- Progress bar: N / Total dialled
- Connect rate: X%
- Retries queued: N
- Next batch start: Xh Ym (if scheduled)
- [View] [Pause / Resume] [Edit]

**Create campaign flow:**
1. Name + agent selection
2. Upload leads (CSV: phone, name, notes) or pull from integration
3. Calling hours (days of week, time window, timezone)
4. Retry settings (max attempts, delay between retries)
5. Concurrency (simultaneous calls limit)
6. Review + launch

**Campaign detail:**
- Stats header: total / dialled / connected / booked / no-answer / failed
- Live calls strip (calls happening right now)
- Leads table: status per lead, call attempts, last outcome
- Export results CSV button

---

### 5.12 ANALYTICS

**URL:** `/analytics`

**Date range picker** at the top.

**Sections:**

**Call volume chart** — bar chart, daily, split by agent colour

**Outcome breakdown** — donut chart: Booked / Info given / No answer / Hung up

**Quality metrics table** — per agent: avg STT confidence, avg LLM latency, avg call duration, dropout rate

**Spend chart** — line chart, daily, split by: telephony / LLM / TTS / STT

**Top callers** — phone numbers with the most calls (useful for identifying repeat visitors)

**Language breakdown** — pie chart of calls by language

---

### 5.13 API KEYS

**URL:** `/developers/keys`

**Table:**
Key name | Key prefix (…last 4 chars) | Created | Last used | Permissions | Revoke

[+ Create API key] → modal:
- Name (e.g. "Production server")
- Permissions: Full access / Read-only / Specific scopes (calls, agents, campaigns)
- Copy the key immediately (shown only once warning)

---

### 5.14 WEBHOOKS

**URL:** `/developers/webhooks`

**Endpoint list:**
Each endpoint:
- URL
- Events subscribed: call.started, call.ended, call.transcript, campaign.completed, memory.updated, etc.
- Status: Active / Failing (N consecutive failures)
- Last triggered: N minutes ago
- [Edit] [Test] [Delete]

[+ Add endpoint] → modal:
- URL input
- Event checkboxes
- Signing secret (auto-generated, shown once)
- [Test webhook] button — sends a sample payload immediately

---

### 5.15 API DOCS

**URL:** `/developers/docs`

Auto-generated from the platform's OpenAPI spec.  
Left sidebar: endpoint categories.  
Centre: endpoint description, request schema, response schema, code examples (cURL / Node / Python).  
"Try it" copy button (copies curl command, doesn't execute in browser).

---

### 5.16 WALLET & BILLING

**URL:** `/account/wallet`

**Balance card:**
- Current balance: ₹4,280.50
- Estimated runway at current burn: "~14 days"
- [Top up] button (Razorpay integration)

**Spend breakdown (this month):**
Bar chart split by: Telephony · LLM · TTS · STT

**Transaction history:**
Date | Type (Debit / Top-up) | Description | Amount | Balance after

**Alert settings:**
- Low balance alert threshold: ₹___ (default ₹500)
- Alert via: Email / WhatsApp

---

### 5.17 TEAM

**URL:** `/account/team`

**Members list:**
Avatar | Name | Email | Role (Owner / Admin / Member / View-only) | Joined | Remove

[Invite member] → modal: email + role

**Role permissions table:**
| Permission | Owner | Admin | Member | View-only |
|---|---|---|---|---|
| Create/edit agents | ✓ | ✓ | ✓ | — |
| Delete agents | ✓ | ✓ | — | — |
| View calls/transcripts | ✓ | ✓ | ✓ | ✓ |
| Manage billing | ✓ | — | — | — |
| API keys | ✓ | ✓ | — | — |

---

### 5.18 PARTNER CONSOLE

**URL:** `/account/partner`  
**Visible only to:** accounts with partner status

**Client accounts list:**
Client name | Status | Agents | Calls this month | Spend | [Manage]

[Add client account] → creates a sub-account with its own login, agents, numbers, and billing.

**Acting as a client:**
Banner shown at top when managing a client:  
"You are viewing [Client Name]'s account. [Exit]"

All pages work normally but data is scoped to the selected client.

---

## 6. Data Flows (How the Platform Works Under the Hood)

Understanding these flows is essential for designing screens that show the right status at the right time.

### 6.1 Inbound Call Flow

```
Caller dials a number
  → VoBiz / Plivo routes to SnapServe
  → SnapServe looks up which agent is assigned to that number
  → Creates a call session (logs call.started)
  → Loads: agent config, system prompt, knowledge base, caller memory for that phone number
  → Opens STT WebSocket stream
  → Agent speaks greeting (TTS → audio back to caller)
  → Caller speaks → STT transcribes → LLM generates reply → TTS speaks reply
  → Loop continues until: caller hangs up, agent ends call, or transfer triggered
  → On end: extract memory facts from transcript, debit wallet, log call record
```

### 6.2 Outbound Campaign Flow

```
User creates campaign → uploads lead list → sets calling hours + retries
  → Campaign runner picks up batch at scheduled time
  → For each lead (respecting concurrency limit):
      → Dial lead's number via telephony provider
      → If answered: start agent pipeline (same as inbound)
      → If no answer / voicemail: log attempt, schedule retry if retries remain
  → Campaign auto-completes when all leads are in terminal state
  → User can pause/resume, adjust calling hours, or add more leads mid-run
```

### 6.3 Agent Memory Flow

```
After every call:
  → LLM extracts structured facts from transcript
     (e.g. {name: "Ravi", company: "TechCorp", interested_in: "Hall B stall"})
  → Stored in DB keyed by: (agent_id, phone_number)

On next call from the same number:
  → Memory is injected into system prompt as {prior_facts}
  → Greeting prompt includes a [RETURNING CALLER] rule
  → Agent opens with an acknowledgement of the prior context
```

### 6.4 Knowledge Base Retrieval Flow

```
During a call, when agent needs information:
  → Hybrid search: vector similarity + full-text search on KB entries
  → Top N results injected into the LLM context for that turn
  → Source attribution tracked (which KB entry answered what)

On KB sync:
  → Document parsed → chunked → embedded → stored in pgvector
  → Old embeddings invalidated, new ones computed
  → Status flips to "Synced" once all entries are embedded
```

### 6.5 Wallet / Billing Flow

```
Every call consumes credits:
  → STT: per second of audio transcribed
  → LLM: per input+output token
  → TTS: per character synthesised
  → Telephony: per minute of call time

Deduction happens at call end (atomic DB operation).
If balance hits ₹0: active calls complete, new calls blocked until topped up.
Low-balance alert fires when balance drops below user's configured threshold.
```

---

## 7. Key Components / UI Patterns

### Status Dots
Used everywhere to show live health:
- 🟢 Green = live / healthy / connected
- 🟡 Amber = needs attention / pending / warning
- 🔴 Red = failed / disconnected
- ⚪ Grey = inactive / not configured

### Building Block Cards (Home page)
Consistent card structure:
- Icon + title + status line
- 3 key facts (label → value)
- CTA link

### Readiness Checklist
Used in Agent Builder step 6 and anywhere a multi-step setup must be complete:
- ✓ Item (green) = done
- ✗ Item (amber) = required, missing → [Fix] link
- Items with warnings don't block launch but show a note

### Alert Strip
Full-width below the top bar when there's an actionable issue.
Never more than 2 alerts visible at once (stack with a "3 more →" link).

### Confirmation for Destructive Actions
Any delete, archive, release, or deactivation shows a modal:
- What will be affected
- "This cannot be undone" if permanent
- Require typing the name or clicking a confirm button

### Empty States
Every list page has a designed empty state:
- Icon related to the section
- Explanation in plain language: "You haven't added any knowledge sources yet"
- What it does: "Knowledge lets the agent look up information mid-call"
- CTA: "Add your first source →"

### Command Palette (⌘K)
Search across: agents, calls (by phone number), campaigns, numbers, settings.  
Jump commands: "New agent", "Top up wallet", "View API keys".

---

## 8. Design Direction

### Visual Identity
- **Tone:** Serious infrastructure, not a toy. Like Stripe or Linear — clean, dense, precise.
- **Not:** A marketing site, not playful, not consumer-app bright.

### Colour palette suggestion
- Background: Near-white (`#F8FAFC`) or deep slate (`#0A0E17`) for dark mode
- Brand accent: Indigo (`#4F46E5`)
- Success / live: Emerald (`#10B981`)
- Warning: Amber (`#F59E0B`)
- Error / failed: Red (`#EF4444`)
- Text: Slate scale (`#0F172A` primary, `#64748B` secondary, `#94A3B8` muted)

### Typography
- UI text: Inter (system-ui fallback)
- Technical values (numbers, IDs, code, latency): Monospace (JetBrains Mono or IBM Plex Mono)
- Use monospace for: phone numbers, API keys, model names, latency/cost values, webhook URLs, config snippets

### Density
- Dashboard and list views: compact (14px text, 8-12px row padding) — users are power users, not one-time visitors
- Forms / builders: more spacious (breathing room around steps, clear labels)

### Interaction patterns
- Sidebar navigation is always visible (not collapsible on desktop)
- Tables have hover state with a quick-action row that appears on hover
- Status changes (agent going live, sync completing) should feel immediate — use optimistic UI
- Numbers that change frequently (calls today, wallet) can animate on update

---

## 9. Screens Summary (quick reference)

| Screen | URL | Primary User | Core Action |
|---|---|---|---|
| Home | `/` | All | Status overview + "Create agent" |
| Agents List | `/agents` | Business | Browse agents |
| Agent Builder | `/agents/new` | Business + Dev | Build an agent step by step |
| Agent Detail | `/agents/[id]` | Business | View agent health + calls |
| Knowledge | `/knowledge` | Business | Manage KB sources |
| Voices | `/voices` | Business | Browse and preview voices |
| Intelligence | `/intelligence` | Business + Dev | LLM, memory, voice print settings |
| Phone Numbers | `/numbers` | Business | Provision and manage numbers |
| WhatsApp | `/whatsapp` | Business | WhatsApp channels and templates |
| Calls Log | `/calls` | Business + Dev | Searchable call history |
| Call Detail | `/calls/[id]` | Business + Dev | Transcript, recording, cost, events |
| Campaigns | `/campaigns` | Business | Outbound campaign management |
| Analytics | `/analytics` | Business | Charts and quality metrics |
| API Keys | `/developers/keys` | Dev | Create and revoke keys |
| Webhooks | `/developers/webhooks` | Dev | Manage webhook endpoints |
| API Docs | `/developers/docs` | Dev | OpenAPI reference |
| Wallet | `/account/wallet` | Business | Balance, top up, transactions |
| Team | `/account/team` | Owner | Members and roles |
| Partner Console | `/account/partner` | Partner | Client sub-accounts |

---

## 10. Terminology Glossary

| Term | Meaning |
|---|---|
| **Agent** | An AI voice entity — has a prompt, voice, LLM, and phone number |
| **Building block** | Any reusable component of an agent (voice, number, KB, LLM key) |
| **STT** | Speech-to-text — converts what the caller says into text |
| **TTS** | Text-to-speech — converts the agent's text reply into audio |
| **LLM** | Large language model — the AI "brain" that generates replies |
| **Caller memory** | Facts the agent remembers about a phone number across calls |
| **Knowledge base** | Collection of documents the agent can search mid-call |
| **Campaign** | An automated outbound dialling run with a list of leads |
| **TTFB** | Time-to-first-byte — how fast the AI starts responding (latency) |
| **WER** | Word error rate — STT accuracy (lower is better) |
| **VoBiz / Plivo** | Telephony carriers SnapServe integrates with |
| **BYO carrier** | "Bring your own" — user connects their own Plivo/Twilio account |
| **Barge-in** | When the caller speaks while the agent is mid-sentence |
| **Wallet** | Pre-paid credits used to pay for calls |
| **Partner account** | An account that manages sub-accounts (reseller / agency) |
| **Voice print** | A voiceprint embedding used to detect if a different person picks up |
| **Transfer** | Routing the call to a human agent during a live call |

---

*This document describes the full SnapServe console as of August 2026. Use it as the authoritative brief for UI/UX design work.*
