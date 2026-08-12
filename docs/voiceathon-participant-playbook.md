# SnapServe Voiceathon Participant Playbook

**Event:** SnapServe Voiceathon  
**Audience:** Teams building live AI voice agents on SnapServe  
**Goal:** Zero → working demo: real call (or meeting), a trigger (website / Sheets), WhatsApp or email follow-up, clear disposition — optional squads / meeting bots for top teams.

> **Rule of thumb:** use **Connections** for WhatsApp + Website **or** Sheets, build Outcomes on the **agent**, dial via **Campaigns**. Skip Meta Business / BYON / Zapier unless a mentor asks.

**Clarity doc:** [snapserve-product-clarity.md](./snapserve-product-clarity.md) · **Meetings:** [meetings.md](./meetings.md)

---

## Table of contents

1. [What is SnapServe?](#1-what-is-snapserve)
2. [Product map (who owns what)](#2-product-map-who-owns-what)
3. [Features & benefits](#3-features--benefits)
4. [How to crack the Voiceathon](#4-how-to-crack-the-voiceathon)
5. [What a Top-20 team looks like](#5-what-a-top-20-team-looks-like)
6. [Hello World in 15 minutes](#6-hello-world-in-15-minutes)
7. [Connections hub](#7-connections-hub)
8. [WhatsApp (Instant)](#8-whatsapp-instant)
9. [Website → automatic call](#9-website--automatic-call)
10. [Google Sheets Automatic Calls](#10-google-sheets-automatic-calls)
11. [Outcomes, after-call messages, lead transfer](#11-outcomes-after-call-messages-lead-transfer)
12. [Squads](#12-squads)
13. [Meeting agents](#13-meeting-agents)
14. [Power features](#14-power-features)
15. [Judging & demo checklist](#15-judging--demo-checklist)
16. [Glossary & dashboard map](#16-glossary--dashboard-map)

---

## 1. What is SnapServe?

SnapServe is a **voice-agent platform for India**. You design what the agent says and does; SnapServe handles telephony, real-time audio, STT/LLM/TTS, memory, campaigns, and integrations — plus **meeting bots** for Meet/Zoom/Teams.

| You focus on | SnapServe handles |
|--------------|-------------------|
| Problem, script, persona | Phone numbers & call audio |
| Knowledge (PDFs, FAQs) | STT → LLM → TTS (or Gemini Live) |
| Outcomes & follow-ups | Transcripts, dispositions, memory |
| Connections (WA, Sheets, site) | TRAI-aware calling windows |
| Meeting prompt & deck | Join Meet/Zoom/Teams as a bot |

---

## 2. Product map (who owns what)

Read this once — it prevents most “where do I click?” confusion.

| Layer | Owns | Path |
|-------|------|------|
| **Agent** | Prompt, voice, tools, KB, **Outcomes**, **after-call WhatsApp/email**, meeting settings | `/app/agents` |
| **Campaign** | Lead list, dial queue, retries, **lead transfer** to webhook/Sheets | `/app/campaigns` |
| **Connections** | WhatsApp, Email, Sheets, Website, Meta, Calendar, Meetings entry | `/app/connections` |
| **Squads** | Mid-call handoff + follow-up tasks | `/app/squads` |
| **Meetings** | Paste link / calendar join into video rooms | `/app/meet` |

```text
Connections bring leads in  →  Campaign dials  →  Agent talks
                                      ↓
                         Disposition (agent Outcomes)
                                      ↓
              After-call WA/email (agent)   +   Lead transfer (campaign, optional)
```

---

## 3. Features & benefits

### Core voice

| Feature | Benefit |
|---------|---------|
| Outbound / inbound / Webcall | Real phone + fast prompt iteration |
| Multilingual | Hindi, Tamil, Telugu, Kannada, Hinglish + more |
| Gemini Live | Ultra-low latency demos |

### Intelligence

| Feature | Benefit |
|---------|---------|
| Caller memory | Remembers across calls |
| Knowledge base | Answers from your docs |
| Disposition / Outcomes | Labels + data fields after every call |
| Funnel meaning | Map labels → Interested / Callback / DNC |
| Tools | Booking, webhooks, transfer mid-call |

### Distribution

| Feature | Benefit |
|---------|---------|
| Instant WhatsApp | Post-call / call-me — no Meta setup |
| Email (Brevo) | After-call email via Connections |
| Website form | Submit → auto dial |
| Google Sheets | Row → call; outcomes write back |
| Campaigns | Bulk lists, sources, lead transfer |
| Squads | Handoff + follow-up between agents |
| **Meetings** | Agent joins Meet / Zoom / Teams |

---

## 4. How to crack the Voiceathon

### Winning formula

```text
Real India problem
  + Live call OR meeting demo
  + ≥ 3 platform capabilities
  + One data loop (Sheet / website / WhatsApp)
  + Tight 3-minute story
```

### Day plan

| When | Do this |
|------|---------|
| Hour 0–1 | Pick problem + script on paper |
| Hour 1–2 | Agent + Webcall until natural |
| Hour 2–3 | Outcomes + KB or memory |
| Hour 3–4 | **Connections**: Website **or** Sheets |
| Hour 4–5 | Instant WhatsApp + after-call rule |
| Hour 5–6 | Optional: Squad **or** Meeting join |
| Before demo | Rehearse live 5×; have fallback recording |

### Prompt tips

Define: **who**, **goal**, **must-ask**, **must-never**, objections, **end of call**.  
Set an explicit **Greeting message** — do not rely on the agent title as the company name.

---

## 5. What a Top-20 team looks like

| Dimension | Bar |
|-----------|-----|
| Problem | Named ICP + pain |
| Live demo | Webcall **and** phone **or** meeting |
| Depth | ≥ 3 capabilities |
| Conversation | Stays on script; no invented facts |
| Integration | Trigger → call → outcome visible |
| Story | 3 min: problem → live → proof |

### Example shapes

| Track | Show |
|-------|------|
| Healthcare | Booking + WhatsApp + disposition |
| Schools | Hindi + Sheets + memory |
| Hiring | Squad qualifier → scheduler + calendar |
| Collections | Outcomes + Sheet writeback + lead transfer |
| Local business | Website → call + Instant WhatsApp |
| **Pro / meetings** | Meeting bot + slides/chat + leave |

---

## 6. Hello World in 15 minutes

1. Sign in → **Agents → New agent**.  
2. Write prompt + **Greeting message** (exact first line).  
3. **Webcall** 60s; fix prompt.  
4. Optional: assign a **Phone number**.  
5. Keep wallet topped up for demo dials.

---

## 7. Connections hub

**Path:** `/app/connections`

Everything that wires the outside world lives here:

| Card | Purpose |
|------|---------|
| Phone numbers | DID / caller ID (or `/app/phone-numbers`) |
| Google Sheets | Automatic Calls pipelines |
| Bookings calendar | Create booking events (write) |
| Meetings | Opens `/app/meet` |
| WhatsApp | Instant or Meta / BYON |
| Email (Brevo) | After-call / tool email |
| Website form | Lead webhook / embed |
| Meta Lead Ads | Form leads → campaign |

---

## 8. WhatsApp (Instant)

### Steps

1. Build the agent first.  
2. **Connections → WhatsApp** (or `/app/connections?setup=whatsapp`).  
3. Choose **Instant** → enable → business name + call-me agent.  
4. Link templates / post-call slots as shown.  
5. In **Agent → Outcomes → After-call messages**, turn on WhatsApp for “every call” or matching outcomes.  
6. Complete a test call → confirm message log.

### Skip during Voiceathon

Meta WABA, BYON, advanced BSP — unless a mentor requires them.  
Old BYO webhook connections can override Instant — disconnect if messages never send.

---

## 9. Website → automatic call

1. Agent ready.  
2. **Connections → Website form** *or* **Campaigns →** start from Website.  
3. Create website campaign: agent + calling hours.  
4. Paste embed / webhook into your form page.  
5. Submit a test lead → watch Campaign live queue / History.

---

## 10. Google Sheets Automatic Calls

1. **Connections → Google Sheets** → connect.  
2. Start pipeline / Automatic Calls: sheet URL, phone column, agent.  
3. Add a row → agent dials (in calling window).  
4. Disposition / summary write back when configured.  
5. Optional: campaign **lead transfer** for CRM-style push of hot leads.

---

## 11. Outcomes, after-call messages, lead transfer

### Agent → Outcomes

1. Add outcome categories (or use a Sales preset).  
2. Map **Funnel meaning**: which labels = Interested / Callback / DNC.  
3. Add **Data to collect** (WhatsApp number, city, email…).  
4. **After-call messages:**  
   - Every call → WA / email toggles  
   - Or rules: disposition chips → WA / email  
5. Save. Connect WhatsApp/email under Connections if not ready yet (rules still save).

### Campaign → Lead transfer only

On the campaign **Configuration** tab: pick dispositions → webhook URL and/or Google Sheet.  
Messaging is **not** configured here anymore — agent owns WA/email.

### Callback meaning vs squad

- **Callback** disposition = analytics + schedule follow-up later (not a live transfer).  
- Live Agent 01 → Agent 02 on the open line = **squad handoff** (or LLM `transfer_to_*`).  
- Post-call “Agent 02 should dial later” = follow-up / scheduled callback (squad follow-up or schedule_callback tool).

---

## 12. Squads

**Path:** `/app/squads`

1. Create a squad with ≥ 2 agents (roles, e.g. Qualifier + Closer).  
2. Attach to campaign / phone as your flow requires.  
3. During the call, the LLM can call `transfer_to_<role>` for a **live** handoff.  
4. `create_followup_task` schedules a later call with a target agent.

Disposition-driven “callback → Agent 02 dials later” is the product direction for automation; today show live handoff + follow-up tools clearly in the demo.

---

## 13. Meeting agents

Full map: [meetings.md](./meetings.md)

### Quick demo

1. Agent → enable **Meetings** + meeting prompt (and optional deck URL).  
2. Open **`/app/meet`** → select agent → paste Meet/Zoom/Teams link → Join.  
3. Admit the bot if needed.  
4. Show leave / mute / slides / chat as configured.  
5. Optional: Connect Google on Meet page → toggle Join on a calendar event.

Do **not** confuse Meeting bots calendar connect with **Connections → Bookings calendar**.

---

## 14. Power features

| Feature | Where |
|---------|--------|
| Knowledge base | Agents / Knowledge |
| Caller memory | Memory / agent settings |
| Booking mid-call | Tools + Connections calendar |
| Gemini Live | Agent voice / engine |
| MCP / Claude skill | `/docs/claude-skill` · `https://app.snapserve.ai/api/mcp` |
| API Reference | `/docs/api-reference` (agents, calls, **meetings**, …) |
| Webhooks | Connections / Webhooks docs |

---

## 15. Judging & demo checklist

### Before you walk on stage

- [ ] Explicit greeting message set  
- [ ] Webcall works  
- [ ] One real phone **or** meeting join works  
- [ ] One trigger (website or Sheets) shown live  
- [ ] Disposition visible after a call  
- [ ] WhatsApp or email follow-up (if claimed)  
- [ ] Fallback 30s recording if network dies  
- [ ] 3-minute story rehearsed  

### Demo arc (3 minutes)

1. Problem (20s)  
2. Live call or meeting (90s)  
3. Proof: disposition + Sheet/WA/dashboard (40s)  
4. Why voice / next step (20s)

---

## 16. Glossary & dashboard map

| Term | Meaning |
|------|---------|
| **Agent** | Conversation owner (prompt, outcomes, messages, meetings) |
| **Campaign** | Dial list + queue + lead transfer |
| **Connections** | External wires (WA, email, Sheets, website, Meta, calendars) |
| **Disposition / Outcomes** | Post-call labels + fields from AI |
| **After-call messages** | Agent rules → WhatsApp / email |
| **Lead transfer** | Campaign push of leads by disposition |
| **Squad** | Multi-agent handoff / follow-up |
| **Meeting bot** | Agent inside Meet/Zoom/Teams |
| **Instant WhatsApp** | Hosted WA without Meta WABA |
| **Webcall** | Browser test call |

### Live nav

**Home · Campaigns · Agents · Phone numbers · Connections · History · Analytics**

Legacy names (**People**, **Call plans**) redirect into Campaigns / Home — ignore old slides that still say them.

### Support links

- Clarity: [snapserve-product-clarity.md](./snapserve-product-clarity.md)  
- Meetings: [meetings.md](./meetings.md)  
- In-app docs: https://app.snapserve.ai/docs  
- API: https://app.snapserve.ai/docs/api-reference  
- Product KB: [snapserve-product-knowledge-base.md](./snapserve-product-knowledge-base.md)
