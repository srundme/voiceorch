# SnapServe UI Vision — Agent at the Center

**Status:** Phases 1–7 shipped.  
**Rule:** Agent Builder is the center. Everything binds to the agent.  
**Constraint:** Do not break or gut the existing Agent Builder. Migrate around it in phases.

---

## Product line

> You create an **agent**.  
> You teach it how to speak.  
> You attach **how work reaches it** and **which channels it can use**.  
> SnapServe runs the rest.

No top-level Campaigns product. Dial flows, WhatsApp, Meet, Squads, Knowledge, Scheduling, and Memory stay reachable via **Agent → Reach / Channels** (and legacy URLs).

---

## Sidebar (shipped)

```
Home
Agents

OPERATE
  Activity
  Phone numbers

Integrations

── Settings ──
Workspace · Providers · Developers · Billing
```

Former **More** items are not in the sidebar. Open them from the agent, Integrations, or direct URL (`/app/campaigns`, `/app/whatsapp`, `/app/meet`, `/app/squads`, `/app/knowledge-bases`, `/app/scheduling`, `/app/memory`).

---

## Agent Builder tabs

| Tab | Purpose |
|-----|---------|
| Overview | Checklist, test, armed Reach flows |
| Prompt | Call prompt |
| Voice | TTS |
| Tools | Mid-call tools |
| Knowledge | KBs |
| **Reach** | Presets → knobs → custom steps (replaces campaigns/journeys UX) |
| **Channels** | Phone, WA, Email, Meetings (mode / delegate) |
| Advanced | Engine |
| Versions | History |

Meeting prompt + delegate live under **Channels → Meetings**.  
Squads = specialist handoffs on the Call step (and `/app/squads`).

---

## Phases

| Phase | Ship | Touch builder? |
|-------|------|----------------|
| **1 Shell** | Sidebar, agent-first Home, Create agent CTA, keep all routes | **No** |
| **2 Reach presets** | Reach tab on agent + presets deep-link to existing engines; journey moved under Reach | Additive tab — existing tabs kept |
| **3 Call rules** | Reach → Call rules: agent defaults + per-flow overrides (retry, quiet hours, caps) | Additive panel on Reach |
| **4 Channels** | Meetings card: meeting prompt, self vs delegate, memory/call-context toggles; WA/Email unchanged | Additive card on Channels |
| **5 Custom Reach** | Journey step editor on Reach: add/reorder/edit Call, Wait, WA, Email, Callback, Webhook, If…; fork preset → `custom` | Additive on JourneyPanel |
| **6 Squads runtime** | Call step optional squad picker; workflow dial stamps campaign.squadId for live handoffs | Light (Reach editor + workflow-engine) |
| **7 Polish** | Home checklist; remove More; Calls→Activity; campaign→dial-flow copy; Settings labels | Cleanup |

---

## Safety

- Old URLs (`/app/campaigns`, `/app/whatsapp`, `/app/meet`, …) keep working.
- Partner / managed-client nav stays trimmed and functional.
- Internal API / DB field names (`campaign`, `campaignId`) are unchanged.

---

## Success tests

1. New user finds **Create agent** in under a minute.  
2. Existing agent builder still opens every current tab.  
3. Dial flows / WhatsApp / Meet still reachable via agent or URL.  
4. Form→call, meeting mode/delegate, custom Reach steps, and squad on Call all work from the agent.
