# SnapServe Voiceathon Participant Playbook

**Event:** SnapServe Voiceathon · **Target date:** 5 September  
**Audience:** Hackathon teams building live AI voice agents on SnapServe  
**Goal:** Go from zero → working demo that can place/receive real calls, trigger from a website or Google Sheet, follow up on WhatsApp, and (for top teams) run multi-agent squads.

> **Rule of thumb for Voiceathon:** use **Instant WhatsApp**, **Website lead webhook**, and **Google Sheets Automatic Calls**. Skip Meta Business / BYON / Zapier unless a mentor explicitly asks you to.

---

## Table of contents

1. [What is SnapServe?](#1-what-is-snapserve)
2. [Features & benefits (capability map)](#2-features--benefits-capability-map)
3. [How to crack the Voiceathon](#3-how-to-crack-the-voiceathon)
4. [What a Top-20 team looks like](#4-what-a-top-20-team-looks-like)
5. [Hello World in 15 minutes](#5-hello-world-in-15-minutes)
6. [Playbook: Connect WhatsApp to your agent](#6-playbook-connect-whatsapp-to-your-agent)
7. [Playbook: Connect a website (automatic call triggers)](#7-playbook-connect-a-website-automatic-call-triggers)
8. [Playbook: Connect Google Sheets to your agent](#8-playbook-connect-google-sheets-to-your-agent)
9. [Playbook: Squad agents (multi-agent teams)](#9-playbook-squad-agents-multi-agent-teams)
10. [Power features worth using](#10-power-features-worth-using)
11. [Judging criteria](#11-judging-criteria)
12. [Demo day checklist](#12-demo-day-checklist)
13. [Glossary & dashboard map](#13-glossary--dashboard-map)

---

## 1. What is SnapServe?

SnapServe is a **voice-agent platform for India**. You design what the agent says and does; SnapServe handles telephony, real-time audio, STT/LLM/TTS, memory, and integrations.

**Think of it as:** your voice-call backend + agent builder + WhatsApp / Sheets / website trigger layer.

| You focus on | SnapServe handles |
|--------------|-------------------|
| Problem, script, persona | Phone numbers & call audio |
| Knowledge (PDFs, FAQs) | STT → LLM → TTS (or Gemini Live) |
| Tools (booking, webhooks) | Transcripts, dispositions, memory |
| Integrations (WA, Sheets, site) | TRAI-aware calling windows |

**Why voice (not just a chatbot)?** India still runs on phone calls — clinics, collections, field sales, school admin, hiring. A great Voiceathon project makes **talking** the natural interface, not a gimmick on top of a form.

---

## 2. Features & benefits (capability map)

### Core voice

| Feature | Benefit for your project |
|---------|---------------------------|
| **Outbound calls** | Agent dials a lead from API, Sheets, website, or campaign |
| **Inbound calls** | Assign a DID to an agent; callers get answered live |
| **Browser Webcall** | Test without a phone — iterate prompts fast |
| **Multilingual** | Hindi, Tamil, Telugu, Kannada, Hinglish + more (Sarvam / Azure) |
| **Gemini Live** | Ultra-low latency demos (audio in/out, no STT→TTS hop) |

### Intelligence

| Feature | Benefit |
|---------|---------|
| **Persistent caller memory** | Remembers name, preferences, past issues across calls |
| **Knowledge base (RAG)** | Ground answers in your PDFs / FAQs / policies |
| **Disposition engine** | Auto-label outcomes (hot lead, callback, not interested…) |
| **Custom webhook tools** | Agent calls *your* API mid-call (CRM, inventory, KYC status) |
| **In-call booking** | Check slots & book on Google Calendar / Cal.com while talking |

### Distribution & automation

| Feature | Benefit |
|---------|---------|
| **WhatsApp (Instant)** | Post-call summary / booking / “call me” — no Meta setup |
| **Website lead capture** | Form submit → auto dial |
| **Google Sheets auto-dial** | New row → call; outcomes write back to the sheet |
| **Campaigns** | Bulk lists, retries, lead sources |
| **Squads** | Mid-call handoff + follow-up tasks between specialist agents |

### Why this stack wins hackathons

1. **Live phone demos** beat slideware.  
2. **Data loop** (call → transcript → disposition → Sheet / WhatsApp) looks like a real product.  
3. **Indic languages** differentiate you from English-only teams.  
4. **Squads** turn “a bot” into “a team that scales.”

---

## 3. How to crack the Voiceathon

### The winning formula

```text
Real India problem
  + Working live call (Webcall + real phone)
  + At least 3 platform capabilities
  + One clear data loop (Sheet / website / WhatsApp)
  + Tight 3-minute demo story
```

### Day-by-day plan (suggested)

| When | Do this |
|------|---------|
| **Hour 0–1** | Pick problem + write the conversation script on paper |
| **Hour 1–2** | Create agent, Webcall until the script feels natural |
| **Hour 2–3** | Attach KB or memory; add booking or one webhook tool |
| **Hour 3–4** | Wire **one** trigger: Website **or** Sheets |
| **Hour 4–5** | Enable **Instant WhatsApp**; send a test + post-call message |
| **Hour 5–6** | Optional: Squad (qualifier → scheduler) |
| **Before demo** | Rehearse live call 5×; prepare 30s fallback recording |

### Do / Don’t

| Do | Don’t |
|----|--------|
| Solve one sharp problem deeply | Boil the ocean (10 agents, no demo) |
| Use Instant WhatsApp | Dive into Meta WABA / BYON on day one |
| Show Sheet or website → call live | Only show a recorded video |
| Write a ruthless system prompt | Rely on a one-line “you are helpful” prompt |
| Test silence, “call later”, language mix | Assume the happy path only |

### Prompt tips (80% of quality)

Your system prompt should define:

1. **Who** the agent is (name, company, tone)  
2. **Goal** of the call (qualify / book / remind / collect)  
3. **Must ask** questions (in order)  
4. **Must never** say (illegal claims, prices you don’t have)  
5. **Objection handling** (“I’m busy”, “send WhatsApp”, “wrong person”)  
6. **End of call** (summary, next step, disposition)

---

## 4. What a Top-20 team looks like

Judges shortlist teams that feel **shippable**, not just clever.

### Scorecard: Top-20 bar

| Dimension | Top-20 standard |
|-----------|-----------------|
| **Problem** | Named ICP + pain (“clinic no-shows costing X”) |
| **Live demo** | Webcall **and** at least one real phone call works |
| **Depth** | ≥ 3 capabilities (e.g. Memory + KB + WhatsApp, or Sheets + Disposition + Squad) |
| **Conversation** | Stays on script, handles “call later”, doesn’t invent facts |
| **Integration** | Visible flywheel: trigger → call → outcome in Sheet/WA/dashboard |
| **Story** | 3 minutes: problem → live call → proof of data → why voice |

### Architecture of a strong submission

```text
[Website form / Google Sheet row]
        ↓
   SnapServe campaign / auto-dial
        ↓
   Voice agent (prompt + KB + tools)
        ↓
   ┌────┴────┐
   ↓         ↓
 Disposition  WhatsApp follow-up
   ↓
 Sheet writeback / booking / squad follow-up
```

### Example Top-20 project shapes

| Track | Shape | Capabilities to show |
|-------|--------|----------------------|
| **Healthcare** | Missed-appointment recovery | Inbound/outbound + booking + WhatsApp reminder |
| **Edtech / schools** | Parent outreach in Hindi | Multilingual + Sheets dialer + memory |
| **Hiring** | Screen → schedule | Squad (qualifier ↔ scheduler) + calendar |
| **Collections / lending** | Soft reminder calls | Disposition taxonomy + Sheet writeback |
| **Local business** | Website lead → instant call | Website widget + Instant WhatsApp |

### What drops you out of Top-20

- Agent only works in Webcall, fails on real numbers  
- English-only for a clearly India/Bharat use case with no reason  
- No integration (just chat)  
- Hallucinated prices / medical advice  
- Demo dies and no fallback recording  
- Confusing WhatsApp setup that never sent a message

---

## 5. Hello World in 15 minutes

1. Sign in to the SnapServe dashboard.  
2. **Agents → New agent** — name it, paste a short system prompt.  
3. Open the agent → **Webcall** → talk for 60 seconds; fix the prompt.  
4. (Optional) **Phone Numbers** — buy/assign a number to the agent for inbound, or use outbound from campaigns.  
5. Keep wallet topped up enough for demo calls.

You now have a voice agent. Next sections add WhatsApp, website, Sheets, and Squads.

---

## 6. Playbook: Connect WhatsApp to your agent

### What you get

With **Instant WhatsApp** (recommended for Voiceathon):

- SnapServe-hosted WhatsApp channel (shared tier)  
- Post-call messages (summary / booking / callback — depending on toggles)  
- Customer can ask to be called back (“call me”) → your agent dials  
- Optional chatbot replies in-thread  
- **No Meta Business Manager, no WABA token, no BYON**

### Step-by-step (Instant — do this)

1. Build and test your agent first (Section 5).  
2. Go to **WhatsApp** in the sidebar (`/app/whatsapp`).  
3. Choose **Instant · most users** → **Enable Instant WhatsApp**.  
4. Enter:
   - **Business name** (appears in messages), e.g. `CarePlus Clinic`  
   - **Call-me agent** — select **the same agent** you built  
5. Confirm / enable.  
6. On the channel panel:
   - Turn on the post-call options you need (summary / booking / callback).  
   - Set **inbound / call-me agent** to your agent if not already set.  
7. Use **Send test** (if available) and check the **message log**.  
8. Make a short outbound/Webcall that completes successfully → confirm a WhatsApp follow-up appears in the log.

### Also from the agent builder

**Agents → your agent → Channels → WhatsApp → Configure WhatsApp**  
Same destination; after Instant is on, the builder should show the channel as ready.

### Engage extras (optional, after Instant works)

On the WhatsApp page, once connected:

- **Chatbot agent** — replies in WhatsApp chat with agent logic  
- **Brochure** — auto-send a PDF/image on keywords  
- **Templates** — mainly for **own** Meta numbers (skip for Instant / Voiceathon)

### Paths to ignore during Voiceathon

| Path | Why skip now |
|------|----------------|
| Business / own Meta WABA | Needs permanent token + Phone Number ID |
| Buy WhatsApp-ready number | Payment + Meta + pending states |
| BYON (voice DID → WhatsApp) | OTP / Meta verification rabbit hole |
| Advanced BYO BSP (Zapier / Interakt) | Easy to override Instant silently |

> If an old **BYO webhook connection** exists, it can **override** native Instant post-call sends. Disconnect it if Instant messages never appear.

### Demo script for judges

1. Complete a call with the agent.  
2. Show WhatsApp message log / phone receiving the follow-up.  
3. (Optional) Reply “call me” on WhatsApp → agent dials back.

---

## 7. Playbook: Connect a website (automatic call triggers)

### What you get

A visitor submits a lead on your site → SnapServe creates a campaign lead → your agent **calls them automatically** (within calling window / queue rules).

### Where in the product

**Campaigns → Lead sources / From Website** (`/app/campaigns` — “From Website” / website webhook flow)

### Step-by-step

1. Create (or pick) the **agent** that should dial leads.  
2. Open **Campaigns** → **From Website** (Lead sources).  
3. Create a **website-webhook campaign**:
   - Name the campaign  
   - Select the **agent**  
   - Set timezone + calling window (e.g. IST 9:00–20:00)  
4. Copy the **embed snippet** SnapServe shows. It looks like:

```html
<script src="https://YOUR_APP_ORIGIN/api/widget/lead-capture.js"
        data-token="YOUR_TOKEN"></script>
```

5. On your landing page (or a simple HTML file for the demo), include that script.  
6. Submit a lead from JS (field names must match what you configured):

```js
SnapServe.submit({
  "phone": "+919876543210",
  "name": "Priya Sharma",
  "email": "priya@example.com"
})
.then(() => console.log("Lead sent!"))
.catch((err) => console.error(err.message));
```

7. Watch the campaign / calls UI — the number should enter the dial queue.  
8. Answer the phone; agent runs your script.

### Demo tips

- Use a real phone you control.  
- Keep the calling window **open now** (don’t set hours that block midday demos).  
- Show judges: form submit → call ringing within seconds → transcript in dashboard.

### Common mistakes

| Mistake | Fix |
|---------|-----|
| Wrong phone field name | Match the campaign’s phone field exactly |
| Agent has no outbound capability / no wallet | Top up wallet; confirm agent can place calls |
| Outside calling window | Widen window for hackathon day |
| Token from another campaign | Re-copy snippet after creating the campaign |

---

## 8. Playbook: Connect Google Sheets to your agent

### What you get

- Connect Google once (OAuth)  
- Map columns (Phone, Name, Email)  
- Agent auto-dials new/backfilled rows  
- Call outcomes can **write back** to the same sheet and/or a Call Log tab  

### Where in the product

1. **Connections** (or the wizard’s Connect step) → **Google Sheets**  
2. **Automatic Calls** wizard (`/app/automatic-calls` or equivalent sidebar entry)

### Step-by-step

1. Prepare a Sheet with headers, e.g.:

| Phone | Name | Email |
|-------|------|-------|
| +9198XXXX | Ravi | ravi@… |

2. Dashboard → connect **Google** (OAuth). Approve access.  
3. Open **Automatic Calls** wizard.  
4. Steps:
   - **Connect** — pick your Google connection  
   - **Sheet** — pick spreadsheet + tab (or create new)  
   - **Map** — Phone (required), Name, Email  
   - Preview a few rows (invalid phones show skip reasons)  
   - **Agent** — select your voice agent  
   - **Modes** — e.g. `backfill_then_watch` + writeback `both` (same sheet + call log)  
5. Create + start.  
6. Add a **new row** with your phone → agent should dial.  
7. After the call, refresh the Sheet — status / disposition columns or Call Log rows should update.

### Writeback modes (choose one)

| Mode | Use when |
|------|----------|
| **same_sheet** | Keep everything in one tab |
| **call_log** | Clean audit trail in another tab/sheet |
| **both** | Best for demos — original list + detailed log |

### Demo tips

- Share the Sheet on screen while the call runs.  
- Show a new row appearing → call → row updating. That **data flywheel** is Top-20 material.

### Common mistakes

| Mistake | Fix |
|---------|-----|
| Phone without country code | Use `+91…` or consistent 10-digit + mapping |
| Header typo (“Phne”) | Remap columns in the wizard |
| Watching wrong tab | Confirm sheet name / gid  
| Agent busy / no minutes | Check wallet + concurrent call limits |

---

## 9. Playbook: Squad agents (multi-agent teams)

### What a squad is

A **squad** is a team of agents that:

1. **Hand off mid-call** — same phone call continues with another specialist (no redial).  
2. **Share caller memory** — facts learned by Agent A are available to Agent B.  
3. **Create follow-up tasks** — “Scheduler should call this lead tomorrow at 3” becomes an automatic outbound with context.

### When to use a squad

| Use a squad | Stay single-agent |
|-------------|-------------------|
| Qualify → schedule → confirm | One simple reminder call |
| Reception → specialist | One FAQ bot |
| Sales → collections | Time-boxed first demo with &lt;2h left |

### Step-by-step

1. Build **2–3 agents** first, each with a clear job and prompt, e.g.:
   - **Qualifier** — asks need, budget, timeline  
   - **Scheduler** — has `native_booking` / calendar tool  
   - **Follow-up** — confirms attendance / collects feedback  
2. Go to **Squads** (`/app/squads`) → **New Squad**.  
3. Name it (e.g. `Clinic Squad`).  
4. Add members:
   - Role name (Receptionist, Scheduler…)  
   - Role type: **supervisor** vs **specialist**  
   - Enable **handoff** on agents that should transfer live  
   - Optional per-member instructions  
5. Open the squad → connect:
   - **Phone number(s)** and/or **campaigns** that should land on this team  
6. In prompts, teach handoff language, e.g.:
   - Qualifier: “When the lead is ready to book, hand off to the Scheduler.”  
7. Test:
   - Webcall / phone → force a handoff path  
   - Confirm Agent 2 continues with context  
   - Create a follow-up task and verify the later outbound

### Demo narrative (judges love this)

> “One agent is a feature. A squad is a product. Watch the qualifier hand the live call to the scheduler — same conversation, shared memory — then WhatsApp confirms the slot.”

### Common mistakes

| Mistake | Fix |
|---------|-----|
| Two agents with identical prompts | Specialize ruthlessly |
| Handoff never fires | Explicit tool/handoff instructions in prompt |
| No phone/campaign linked to squad | Attach DID or campaign on squad detail |
| Handoff mid-demo fails | Rehearse the exact phrase that triggers transfer |

---

## 10. Power features worth using

Pick **2–3** beyond basic talk:

| Feature | Where | Why for Voiceathon |
|---------|-------|--------------------|
| **Persistent memory** | Agent / caller profiles | Returning-caller magic |
| **Knowledge base** | Upload PDF / text to agent | Grounded answers, less hallucination |
| **Native booking** | Agent tools + Scheduling | Live slot booking on call |
| **Disposition** | Agent disposition config | Auto labels for Sheet / CRM story |
| **Webhook tool** | Agent tools | Live API lookup mid-call |
| **Instant WhatsApp** | WhatsApp page | Follow-up without Meta |
| **Website leads** | Campaigns | Trigger without a spreadsheet |
| **Sheets auto-dial** | Automatic Calls | Visible ops dashboard for judges |
| **Squads** | Squads page | Scalability story |
| **Indic stack** | Agent STT/TTS/LLM | Sarvam / Azure LID for Hindi–Tamil |

---

## 11. Judging criteria

Use this to prioritize time:

| Weight | Criterion | What to prove |
|--------|-----------|---------------|
| **25%** | Problem fit | Real users, voice is the right medium |
| **25%** | Technical depth | ≥3 platform capabilities, not a thin wrapper |
| **20%** | Conversation quality | Natural, on-task, edge cases handled |
| **20%** | Demo impact | Live call works; transcript / Sheet / WA visible |
| **10%** | Market potential | Who pays, why now (one slide is enough) |

---

## 12. Demo day checklist

### 60 minutes before

- [ ] Wallet balance OK  
- [ ] Agent Webcall works  
- [ ] Real phone call works (inbound or outbound)  
- [ ] Instant WhatsApp test message sent successfully  
- [ ] Website **or** Sheet trigger tested once in the last hour  
- [ ] Calling window open for the demo slot  
- [ ] Fallback: 60–90s screen recording of a successful call  

### During the 3-minute pitch

1. **30s** — Problem + who hurts  
2. **90s** — Live call (or trigger form/Sheet → call)  
3. **45s** — Show proof: transcript, disposition, Sheet row, WhatsApp message  
4. **15s** — Why this wins commercially / scales (squads if you have them)

### Backup lines if something fails

- “Here’s the recording from this morning — same agent, same Sheet.”  
- Switch to Webcall while keeping the integration screens open.

---

## 13. Glossary & dashboard map

### Glossary

| Term | Meaning |
|------|---------|
| **Agent** | One voice persona (prompt, voice, tools, KB) |
| **Squad** | Team of agents with handoff + shared memory + tasks |
| **Instant WhatsApp** | Shared SnapServe WA channel — no Meta setup |
| **Webcall** | Browser mic test of an agent |
| **Disposition** | AI label of call outcome |
| **Automatic Calls** | Google Sheets → dial + writeback |
| **Website lead** | Embed / `SnapServe.submit` → campaign dial |
| **BYON** | Bring your own (voice) number onto WhatsApp — skip for hackathon |

### Where to click

| Task | Nav |
|------|-----|
| Build agent | **Agents** |
| Test voice | Agent → **Webcall** |
| WhatsApp | **WhatsApp** → Instant |
| Website triggers | **Campaigns** → From Website |
| Google Sheets | **Connections** + **Automatic Calls** |
| Multi-agent | **Squads** |
| Numbers | **Phone Numbers** |
| Money | **Wallet / Billing** |
| Journey / post-call | Agent builder → Journey / Channels |

---

## Quick reference: Instant WhatsApp vs Website vs Sheets

| | Instant WhatsApp | Website leads | Google Sheets |
|--|------------------|---------------|---------------|
| **Best for** | Follow-up after a call | “Call me now” from a landing page | Ops lists & demos of writeback |
| **Setup time** | ~2 minutes | ~10 minutes | ~15 minutes |
| **Meta required?** | No | No | No |
| **Shows judges** | Omnichannel | Instant response | Data flywheel |

**Recommended combo for Top-20:**  
**Agent + Instant WhatsApp + (Sheets *or* Website) + (Memory *or* KB) + optional Squad.**

---

## Support

- Use in-dashboard docs under **Docs** for API details.  
- **Claude skill & MCP:** Docs → [Claude skill & MCP](https://app.snapserve.ai/docs/claude-skill) — connect Claude Desktop / Claude Code with your `sk_live_` key to create agents, campaigns, and website webhooks in chat.  
- Prefer Webcall for prompt iteration; save phone minutes for final demos.  
- If WhatsApp Instant fails, check: channel active, correct agent selected, no old BYO webhook override, message log errors.

---

*SnapServe Voiceathon Participant Playbook · Keep Instant WhatsApp simple · Ship a live call · Show the data loop.*
