# SnapServe UI Vision — Agent at the Center

**Status:** Full-page Stripe UX rebuild.  
**Rule:** Agent is the center. Builder teaches it to speak. Operate wires how work reaches it. Connect wires how it talks.  
**Layout:** Stripe-style full pages — one `h1` per screen via `StripePage`. No multi-pane IDE. No duplicate global page title.

---

## Product line

> You create an **agent**.  
> You teach it how to speak (Builder).  
> You attach **how work reaches it** (Automation) and **which channels it can use** (Channels).  
> SnapServe runs the rest.

---

## Sidebar (shipped)

```
Home
Agents

OPERATE
  Activity
  Automation
  Dial flows
  Phone numbers

CONNECT
  Channels
  Integrations
  Scheduling
  Meet
  WhatsApp

INTELLIGENCE
  Knowledge
  Memory
  Squads
  Analytics

── Settings ──
Workspace · Providers · Developers · Billing
```

Partner Hub appears for partners. Managed clients get a trimmed nav (no Automation / Channels / Integrations).

---

## Agent Builder tabs

| Tab | Purpose |
|-----|---------|
| Overview | Checklist, test |
| Prompt | Call prompt |
| Voice | TTS |
| Tools | Mid-call tools (Booking = one suite switch) |
| Voicemail | Voicemail |
| Advanced | Engine |
| Versions | History |

**Not in builder:** Reach / Automation and Channels — those are separate Operate / Connect pages.

Meeting prompt + delegate live under **Channels → Meetings**.  
Email is **Brevo BYO only** (no managed SnapServe mail).

---

## Page chrome

| Layer | Role |
|-------|------|
| AppShell (`layout.tsx`) | Sidebar + utility strip (theme, bell). **No page title.** |
| `StripePage` | Canonical page: single h1, description, actions, optional tabs |
| `AgentContextBar` | Shared agent Select + Edit for agent-scoped pages |
| `StripeTabPage` | Settings-family tabbed pages |

---

## Safety

- Old URLs (`/app/campaigns`, `/app/whatsapp`, `/app/meet`, …) keep working.
- Partner / managed-client nav stays trimmed and functional.
- Internal API / DB field names (`campaign`, `campaignId`) are unchanged.

---

## Success tests

1. Every product surface is one click from the sidebar (or Settings).  
2. No page shows two titles (global + page).  
3. Agent-scoped pages share AgentContextBar; switching agent keeps the page.  
4. Builder remains agent-runtime only; Automation / Channels stay separate.  
5. Mobile drawer + bottom nav still work.
