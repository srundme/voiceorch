# SnapServe Agent Builder — Teaching Guide

Use this when you walk someone through **app.snapserve.ai** who has never built a voice agent. Teach the screen they are looking at, then say where that screen connects.

Open: **Agents** → pick an agent (or create one). URL looks like `/app/agents/511`.

---

## How to teach this

1. Draw the five parts of a call first: **Number → Listen → Think → Speak → Do**.
2. Then open the builder and map each tab to those five parts.
3. Do not start on Settings. Start on **Overview**, then **Script**, then **Live test**.
4. Say this sentence often: **Connections hold the keys. The builder only turns things on and picks templates.**

| They ask | You open |
|---|---|
| What is this agent? | Overview |
| What does it say? | Script |
| How does it sound? | Sound |
| Can it book / transfer / send WhatsApp *during* the call? | Actions |
| What happens when the call ends? | After the call |
| Did the call work? | Activity |
| Timing, website, CRM, compliance | Settings |
| Freeze a working version | Versions |
| WhatsApp number, email, Google Calendar | **Connections** (left nav, not a builder tab) |

---

## The one picture

```
                    CONNECTIONS (workspace)
                    WhatsApp · Email · Calendar · Phone numbers
                              │
                              ▼
┌──────────── AGENT BUILDER ──────────────────────────────────┐
│ Overview   who talks, number, knowledge, team               │
│ Script     welcome + instructions                           │
│ Sound      voice + listening + phone feel                   │
│ Actions    mid-call tools (usually leave WhatsApp off)      │
│ After the  outcome labels + WhatsApp/email when you KNOW    │
│ call       Interested vs Not Interested                     │
│ Settings   engine, limits, website, CRM notify, compliance  │
└─────────────────────────────────────────────────────────────┘
          │                    │                    │
     Live test            Call (phone)         Campaign / Sheets
     (browser)            (real number)        (many leads)
```

A live call uses **all of this at once**:

| Part of the call | Builder place | Product behind it |
|---|---|---|
| They dial / we dial | Overview → Phone | Vobiz number (or their Plivo/Twilio) |
| Listen | Overview → Transcriber | Sarvam Saaras (speech to text) |
| Think | Overview → Model + Script | Sarvam 105B (or Gemini Live) |
| Speak | Overview → Voice / Sound | Cartesia Sonic (default voice: **Gayathri**) |
| Do during the call | Actions | Calendar, transfer, end call, optional mid-call message |
| Do after the call | After the call | Disposition + WhatsApp / email templates |
| Tell a CRM | Settings → Post-call notify | Their HTTPS webhook |

---

## Words to say once

| Word on the screen | Plain meaning |
|---|---|
| **Voice agent** | Software that can hold a phone conversation and finish a small job |
| **Script / prompt** | The written job for the agent |
| **Transcriber (STT)** | Listening — speech becomes text |
| **Model (LLM)** | The brain — picks the next sentence from your rules and their words |
| **Voice (TTS)** | Speaking — text becomes a voice |
| **Latency** | How long until it replies. Shorter feels more human |
| **Disposition** | The label when the call ends: Interested, Not Interested, Callback |
| **DID / number** | The real phone number the agent uses |
| **Campaign** | Calling many people from a list |
| **Knowledge** | Files it can look up (fees, hours, FAQs) |
| **Squad / Team** | Two or more agents that hand off mid-call |

---

## Create an agent

From **Agents**, click **New agent**. Three steps.

### 1. Who is this for?

| Choice | Teach this |
|---|---|
| **One agent** | One voice, one job. Start here. |
| **Team** | Creates two agents that can hand off mid-call (example: qualifier → scheduler). Each agent still has its own Script. |
| **Or build with AI (guided)** | Leaves the builder and opens **Vibe** (`/app/vibe`) — a chat that writes the agent with you. |

### 2. Where will they talk?

| Choice | What they get | What they do **not** get |
|---|---|---|
| **Phone** | Voice calls. Can **book** a calendar (sends a Meet link to humans). | The AI does **not** join Meet / Zoom / Teams. |
| **Phone + meetings** | Phone **plus** Meeting bots that can join a room. | Extra setup on **Meeting bots** (`/app/meet`). |

Booking a slot and **joining** the meeting are different. Say that out loud.

### 3. Name your agent

Type a name. **Create agent**.

What SnapServe puts on a new agent (they do not pick this yet):

| Piece | Default |
|---|---|
| Language | English (India) `en-IN` |
| Listen | Sarvam Saaras v3 |
| Think | Sarvam 105B Conversations |
| Speak | Cartesia Sonic 3.5 · **Gayathri** |
| Phone carrier | Vobiz |
| Welcome | “Hello! How can I help you today?” |
| Actions | **End Call** only |

Then you land on **Overview**. Badge will say something like **2 to finish** (usually Script + phone number).

---

## The chrome (every tab)

Top of the builder — teach this before the tabs.

| Control | What it does |
|---|---|
| Agent name (click) | Rename |
| **ID** `#511` | Copy the agent id (campaigns, API, support) |
| **Live** / **Draft** | Whether this agent can take production traffic |
| **Unsaved** | You edited and have not hit Save |
| **Script** / **Sound** chips | Quick “is the conversation and voice ready?” |
| Cost chip | Rough ₹ per minute (platform + listen + think + speak) |
| **Call** | Real outbound test to a phone you type |
| **Live test** | Talk in the **browser**. No phone bill. Use this first. |
| **Save** | Writes the agent (Script, Sound, Actions, Settings, Voicemail) |
| ⋮ **Publish version** | Freeze a snapshot as Production |
| ⋮ **Refine with AI** | Opens Vibe against this agent |
| ⋮ **API keys** | Provider keys page |
| ⋮ **Delete agent** | Gone. Confirm first |

**Teach:** browser **Live test** before **Call**. Phone second.

On a phone, the sticky bar is **Phone · Web · Save**.

If the agent is on a team, a bar shows the squad name, teammate chips, and **Manage** (opens Squads).

---

## Overview

Left nav: **Overview**.

This is the dashboard of “can we test yet?” Header says **Ready to test** or **Still needs call prompt, welcome message, voice, phone number**.

### How it talks

Three cards. Click a card to edit. Unsaved dialog: **Keep Editing** / **Discard Changes**.

#### Transcriber (or Language, if Gemini Live)

| Control | Teach this | Connects to |
|---|---|---|
| **Language** | What the caller is expected to speak. New agents: English (India). | Sarvam listen + speak |
| **Model** | Leave **Default** / Saaras v3. | Sarvam STT |
| **How speech is written** | **Mixed** = Hinglish/Tanglish on screen. **Native script** = हिंदी / தமிழ். **English text** = any language spoken, written in English. | Sarvam transcript style |
| **Brand names & terms** | Words STT must not mangle (your product name). | Sarvam STT prompt |
| **Switch language during call** | Off unless they truly need two languages in one call. | Multilingual ASR/LLM |
| **Languages allowed** | Only if switch is on. | Same |
| **Output numbers in Indic** | On by default. “two thousand” vs “2000” style in Indic TTS. | Sarvam speak |

If they see a **legacy transcriber** banner: click **Use Saaras v3**.

#### Model

| Control | Teach this | Connects to |
|---|---|---|
| **Voice stack → Classic** | Listen + Think + Speak as three steps. This is what you teach first. | Sarvam STT + LLM + Cartesia/Sarvam TTS |
| **Voice stack → Gemini Live 3.1** | Google native audio. Hides the normal transcriber/voice cards. Advanced. | Gemini Live |
| **Provider / Model** | Default: **Sarvam 105B Conversations (recommended — voice)**. | LLM |
| **Temperature — Creativity** | Default **0.40**. Lower = stick to the script. Higher = more wander. Stay near 0.3–0.5 for phone. | LLM |

#### Voice

| Control | Teach this | Connects to |
|---|---|---|
| **Provider** | **Cartesia (Sonic)** on new agents. Sarvam Bulbul is the other India option. | TTS |
| **Model** | **Sonic 3.5** — 42 languages, lowest latency (default). | Cartesia |
| **Choose voice** | Default **Gayathri**. English agents see **all** listed voices. Other languages see matching voices first. | Cartesia catalog |
| **Clone voice** / **Add Sarvam clone** | Their own voice. Optional. | Voices + clone APIs |
| **Paste custom Voice ID** | Only if they already have a Cartesia/Sarvam id. | TTS |

Gemini Live instead: **Preset voice** (default **Kore**) + **Thinking level** (use **Minimal**).

### Phone

Marked **Required**.

| What they see | Teach this |
|---|---|
| **+ Buy a phone number** | They do not have a DID yet. Opens Numbers. Wallet pays. |
| Shared trial line (example `+917971543255`) | **Outbound test only.** A few tests per day. **Inbound will not ring this agent.** |
| A number they own, **Live** | This is the real line. Inbound rings here. Outbound shows this caller ID. Click to reassign or remove. |
| Their own Plivo/Twilio | BYO carrier. Keys live under Connections / providers. Unlimited on their account. |

**Connected to:** Vobiz (platform default), or Plivo/Twilio if they chose BYO in Settings → Limits.

Without a purchased/assigned number they can still **Live test** in the browser.

### Knowledge

Optional. **Select knowledge sources**. Types: **FAQ**, **Text**, **Website**, **File**.

Teach: empty is fine. Attach a source only if the agent must look something up (fees, hours, syllabus). This is not the Script. Script is the job. Knowledge is the facts.

**Connected to:** Knowledge bases, injected during the live call.

### Team

| State | Teach this |
|---|---|
| **Solo agent** + **Add to team** | One personality. **Add to team** seeds a squad. |
| Squad name + chips + **Manage** | Handoffs. Each teammate has their **own** Script tab. |

**Connected to:** Squads (`/app/squads`).

### Website embed

Snippet so a website can open a **browser** call to this agent (webcall). Same idea as **Live test**, for their site.

---

## Script

Left nav: **Script**.

This is the job. Four beats you already taught: Hello → Listen → Confirm → Close.

| Control | Teach this | Connects to |
|---|---|---|
| **Generate** | Fills a first draft from name, company, inbound/outbound, language, call flow. Always edit after. | Prompt generation |
| **Team prompts** | Jump to a teammate’s Script. Only on a squad. | Squads |
| **Who speaks first → Assistant speaks first** | Agent says the welcome. Normal. | First utterance |
| **Who speaks first → User speaks first** | Agent stays quiet until the caller talks. Use for inbound “they already know why they called.” | Same |
| Welcome box | First sentence out loud. Keep it short. Example: “Hi, I am Aarthi from Green Valley Clinic. I can help you book a visit. Is now a good time?” | TTS |
| **Talk** (main box) | The instructions. One job. What to collect. What never to say. When to end. When Interested vs Not Interested. | LLM |
| **On calls** / **In meetings** | Second tab only if they created **Phone + meetings**. Meeting bot uses **In meetings**. | Meeting bots |
| **Timezone** | Injected so “tomorrow evening” is the right city. | Prompt context |
| **End-call phrases** | Comma list. If the caller says one of these, hang up. | Call control |
| **Prompt variables** + **Add** | `{{name}}`, `{{city}}` filled by outbound API / campaign row. | `POST /calls/outbound` `variables` |

**Ready rule:** prompt about 40+ characters, welcome about 4+ characters. Overview uses that to clear “Still needs call prompt.”

**Save** in the header. Then **Live test**.

---

## Sound

Left nav: **Sound**.

Three panels: **Speaking**, **Listening**, **Phone feel**.

### Speaking

Same voice stack / provider / voice / model as Overview → Voice, plus:

| Control | Teach this |
|---|---|
| **Preview Voice** | Hear a sample. No phone call. |
| **Speaking speed** | Default **1.0×**. Range about 0.7–1.5. Faster is not always better on phone. |

### Listening

| Control | Default | Teach this |
|---|---|---|
| **Noise Cancellation** | On | Cuts fan/street noise. Leave on. |
| **Backchanneling** | Off | Soft “mm-hmm” while they talk. Turn on only if it feels natural in a test. |
| **Background Noise** | Off | Fake office/cafe bed. Demo candy. Usually off for production. |
| **Track** / **Background bed volume** | — | Only if background is on. Tracks come from admin-uploaded beds. |

### Phone feel

How soon it replies after a pause. Same knobs as Settings → Engine.

| Preset | Say this |
|---|---|
| **Fast** | Replies quickly, cuts in sooner. Sales follow-up. |
| **Balanced** | Default natural pace. Start here. |
| **Patient** | Waits if the caller thinks mid-sentence. Elders, medical, confused parents. |

If they tweak sliders later, the hint says **edited — saves as set**. The named preset is just a starting point.

---

## Actions

Left nav: **Actions**.

Header idea: **Turn on an action, then pick the calendar, WhatsApp template, or email already connected. The plug-in itself is under Connections.**

These tools run **during** the call, when the model decides to use them.

### Scheduling & bookings

| Control | Teach this | Connects to |
|---|---|---|
| **Booking** switch | Turns on five tools: book, check availability, list, reschedule, cancel. | Google Calendar |
| **Any meeting** (event type) | Which calendar event to create. | Calendar event types |
| **Connect Google Calendar** | If nothing is linked. | Connections |
| **Test & schema** | Run a fake book with JSON. Fix here, not on a live lead. | Tool test API |

Phone-only agents **book** links. They do **not** join Meet. Joining needs **Phone + meetings** + **Meeting bots**.

### Meeting bots

Only if surfaces = phone + meetings. **Can join Meet / Zoom / Teams**. Button **Open Meeting bots**.

### Messaging

| Switch | Default | Teach this | Connects to |
|---|---|---|---|
| **Send Email** | Off | Mid-call email (rare). Needs Brevo on Connections. | Email |
| **Send WhatsApp** | Off | **Leave off** unless the person asks for a link *during* the call. Interested / Not Interested templates do **not** belong here. | WhatsApp |

Status pill: **Connected**. If it says saved but not wired: they must paste Phone Number ID, WABA ID, and a permanent System User token on **Connections**, then come back.

### Call control

| Switch | Default | Teach this |
|---|---|---|
| **End Call** | **On** | Model hangs up when the job is done. Leave on. |
| **Call Transfer** | Off | Live handoff to a human number. |

Transfer fields (when on):

| Field | Teach this |
|---|---|
| **Function Name** | What the model calls (snake_case). |
| **Transfer To** | E.164, like `+9198…` |
| **Description (shown to LLM)** | When to transfer. |
| **Warm Handoff Message** | What the caller hears before the jump. |
| **Transfer Mode** | **Cold — connect immediately** vs **Warm — brief the agent first**. |
| **Briefing Prompt** | Optional extra for warm mode. |

**Connected to:** Vobiz / Plivo / Twilio transfer.

### Recording & summaries

| Control | Default | Teach this |
|---|---|---|
| **Call Recording** | On for new agents | They hear this back in Activity. Needed to improve the Script. |
| **Auto Summarization** | Off | Extra LLM pass after the call. Cost. Turn on when they want a short recap in the log. |

### Caller intelligence

| Control | Default | Teach this |
|---|---|---|
| **Gender Identification** (Beta) | Off | Guess from voice. Do not teach as required. |
| **Voice Memory** (Beta) | Off | Remember a caller’s voice next time. Opt-in. |

### Custom tools

**Add** a **Mid-call HTTP** webhook.

| Field | Teach this |
|---|---|
| **Function Name** / **Description** | What the model sees |
| **Pre-call Message** | Optional line spoken before the HTTP call |
| **Endpoint URL** / **Method** / **X-Webhook-Secret** | Their API |
| **Parameters** | Fields the model must fill (name, type, required) |

This is mid-call. After-call CRM dump is **Settings → Post-call notify**, not here.

---

## After the call

Left nav: **After the call**.

This is the correct place for Interested vs Not Interested WhatsApp.

Header: label what happened, pick the WhatsApp template for each outcome, decide voicemail.

**Different save button:** **Save Outcomes** (not the header Save). Header Save still writes Voicemail on this tab.

### Outcome labels

The model picks one label when the call ends.

| Control | Teach this |
|---|---|
| **Use Sales preset** / **Support** / **Lead qual** | Instant starter set. Then edit. |
| **Add category** | Group + comma labels. Example category “Result”, labels `interested, not_interested, callback, wrong_number`. |
| **What each label means** | A sentence the AI uses to decide. Write “Said they want a demo this week” not just “good lead.” |

Without labels, after-call rules have nothing to match.

### After-call messages

Copy on the panel: **Sends when the call ends and the outcome is known — Interested vs Not Interested cannot be decided mid-call.**

| Control | Teach this |
|---|---|
| **One template for all outcomes** | Same WhatsApp/email to everyone. Fine for a first demo. |
| **WhatsApp template** | Pick an **approved** Meta template. |
| **Skip universal when a disposition rule matches** | Rules win over the one-for-all template. |
| **Add rule** | Tap one or more labels (Interested, Not Interested), pick a different template. |
| **Connect WhatsApp** / **Connect email** | Jumps to Connections, then back here. |

**Connected to:** Meta WhatsApp (or Vobiz only if SnapServe sold the WhatsApp number). Email via Brevo on Connections.

**Teach the mistake:** mapping Interested on Actions → Send WhatsApp. Mid-call does not know the outcome. A Not Interested lead can get the Interested template. Map outcomes **here**.

### Data to collect

Structured bits pulled from the transcript (and usable after the call).

Quick adds: **+ WhatsApp number**, **+ Email**, **+ City**, **+ Callback time**, **+ Alternate number**.

Each field: **Label**, **Key**, **Type** (Phone / WhatsApp, Short text, Number, Yes / No, Choice).

### Voicemail

Outbound only. Saved with header **Save**.

| Control | Teach this |
|---|---|
| **Detection Mode → Disabled** | Default. Agent does not special-case voicemail. |
| **Detect Message End — wait for beep** | AMD. Wait, then hang up or leave a message. |
| **When voicemail detected** | **Hang up immediately** or **Leave a voicemail message**. |
| **Voicemail Message** | What TTS speaks into the box. |
| **Lead-in Pause (seconds)** | Default 2. Twilio/Plivo. Vobiz may ignore. |

---

## Settings

Left nav: **Settings**. Sub-nav: **Engine · Limits · Website · Post-call notify · Compliance**.

### Engine

Fine timing. Most people should use Sound → **Phone feel** instead.

| Control | Teach this |
|---|---|
| **Allow barge-in** | On. Caller can interrupt. |
| **Words before interrupt** | How many caller words before the agent stops talking. Default around 3. |
| **Extra pause before speaking** | Add wait after they finish. 0 is fine. |
| **Advanced timing** | Fragment hold (listening/playing), **Tail drain** (carrier leftover audio). Rarely needed. |
| **Silence check-in** | Default 30s. Prompt, then hang up if nobody speaks. |

### Limits

| Control | Teach this | Connects to |
|---|---|---|
| **Enable Auto-Redial** + **Max Attempts per Day** | If the call drops, try again. Default 3. | Outbound / campaigns |
| **Max Call Duration** | Hard cutoff. New agents 480s (8 min). | Call engine |
| **Telephony Provider** | **VoBiz (platform / own number)** default. **Plivo — your own account** / **Twilio — your own account** if they bring a carrier. | Phone |

### Website

Same website webcall embed as Overview.

### Post-call notify

**Not** WhatsApp. This is JSON to Zapier / CRM / their server after **every** call.

| Control | Teach this |
|---|---|
| **Notify URL** | Must be `https://` |
| **Signing Secret** | Header `X-SnapServe-Signature` |
| **JSON body template** | Tokens like `{{callId}}`, `{{status}}`, `{{transcript}}`, `{{dispositionResult}}` |

Footer on this panel points them to **After the call** for human messages.

### Compliance

Toggles that tighten the Script / calling rules. Confirm dialogs on enable.

| Toggle | Badge | Teach this |
|---|---|---|
| **IRDAI** | Insurance | Disclosure language for insurance use |
| **DPDP Act** | Data Privacy | What they may collect and say |
| **TRAI** | Telecom | 9–9 IST style calling, suppression, opt-out |

Do not enable as decoration. Only if that framework applies.

---

## Activity

Left nav: **Activity**.

Call history for this agent: listen, transcript, disposition, duration. This is how you **improve** — one real call, change one line in Script, Live test again.

**Connected to:** Calls, recordings, analytics, wallet minutes.

---

## Versions

Left nav: **Versions**. Also ⋮ → **Publish version**.

| Idea | Teach this |
|---|---|
| Header **Save** | Edits the live draft row |
| **Publish version** | Named snapshot. Becomes **Production**. Old Production becomes **Published** |
| Limit | 10 published versions |
| Sub-tabs | **Published** / **Drafts**. Archive when full |
| Compare | Prompt, ASR, LLM, Voice, Telephony, Tools, Knowledge, Scheduling, Compliance |
| **Restore** | Roll back a bad prompt change |

Version name + what changed are required on publish.

---

## Connections (outside the builder)

Left nav of the app, not a builder tab. The builder **consumes** these.

| Connection | Used by | Typical setup |
|---|---|---|
| **WhatsApp** | After the call (outcome templates). Actions Send WhatsApp only if they ask mid-call. | Meta: WABA ID, Phone Number ID, permanent System User token. Vobiz only if SnapServe sold the WhatsApp number or they want WhatsApp **calling**. |
| **Email** | After the call and/or Actions Send Email | Brevo |
| **Google Calendar** | Actions → Booking | OAuth on Connections |
| **Phone numbers** | Overview → Phone | Buy DID or assign existing |
| **Providers / API keys** | BYO LLM/TTS/telephony | Only if not using the platform stack |

If they already run a Meta text bot on a number, do **not** point SnapServe inbound chat at that same number (one webhook). Voice + Meta-direct send is the path.

---

## How a call uses the whole builder

### Browser Live test

Header **Live test**. WebRTC. Uses Script + Sound + Actions. No DID required. Best first demo.

### Outbound **Call**

Header **Call** → number in E.164 (`+91…`). Uses assigned caller ID, or the shared trial line (limited, no inbound).

### Inbound

Someone dials the assigned Vobiz/BYO number. Same agent.

### Campaign / Sheets / website form

Same agent, many leads. Campaign and Automatic Calls live **outside** this builder. The agent’s Script, Sound, After the call, and number still apply.

```
Form / Sheet / CSV
        → campaign or automatic call
        → this agent’s Script + Gayathri + tools
        → call ends
        → After the call label
        → WhatsApp template for that label
        → Settings notify URL (optional CRM)
```

---

## Two save buttons (say this twice)

| Button | Where | What it writes |
|---|---|---|
| **Save** | Header | Script, Sound, Actions, Settings, Voicemail, How it talks |
| **Save Outcomes** | After the call | Labels, after-call WhatsApp/email rules, data to collect |

People lose WhatsApp maps because they only hit header Save.

---

## 30-minute live teach path

Use this order. It matches the webinar live build.

1. **Create** — One agent, Phone, name it.
2. **Overview** — Point at Transcriber / Model / Voice (Gayathri). Skip buying a number.
3. **Script** — Write one sentence: *This agent [does what] for [whom] so that [result].* Welcome + four beats. **Save**.
4. **Live test** — Talk. Fix the greeting. One change at a time.
5. **After the call** — Sales or Lead qual preset. Add rule: Interested → template A, Not Interested → template B. **Save Outcomes**. (Skip if WhatsApp is not connected.)
6. **Actions** — Show End Call on. Show Send WhatsApp **off**. Show Booking only if Calendar is connected.
7. **Sound → Phone feel** — Balanced. Optional Preview Voice.
8. **Call** — One real outbound if they have wallet + trial or DID.
9. **Activity** — Play the recording. Change one Script line.

What’s next / Q&A can use Settings (redial, TRAI), Versions, Connections, campaigns.

---

## Gotchas to say out loud

1. **Outcome WhatsApp is After the call, not Actions.** Mid-call cannot know Interested vs Not Interested.
2. **New agents speak as Gayathri.** Old agents keep whatever they had until someone changes Voice.
3. **English (India) sees every listed Cartesia voice.** Tamil/Hindi lists filter; if none match, the full list comes back.
4. **Trial number ≠ inbound.** Shared line is outbound practice only.
5. **Connections vs Actions.** Keys and WABA live on Connections. The builder only toggles and picks templates.
6. **Book ≠ join Meet.** Phone-only books. Phone + meetings joins.
7. **Team = two Scripts.** Handoff is not one mega-prompt.
8. **Gemini Live** hides Classic listen/speak. Do not demo it in a first session.
9. **Voicemail** is outbound and uses header Save.
10. **Compliance** toggles change behaviour. Do not flip them “to look complete.”

---

## What “done” looks like for a first agent

- [ ] One-sentence job in Script  
- [ ] Short welcome  
- [ ] Gayathri (or a voice they previewed)  
- [ ] Live test works in the browser  
- [ ] End Call on; Send WhatsApp off  
- [ ] After the call labels + templates if they have WhatsApp  
- [ ] Outcomes saved  
- [ ] Number attached only when they want a real phone  
- [ ] One Activity recording reviewed  

Start: [app.snapserve.ai](https://app.snapserve.ai)
