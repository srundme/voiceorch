# SnapServe UI Vision — Agent at the Center

**Status:** Approved 2026-08-04  
**Rule:** Agent Builder is the center. Everything binds to the agent.  
**Constraint:** Do not break or gut the existing Agent Builder. Migrate around it in phases.

---

## Product line

> You create an **agent**.  
> You teach it how to speak.  
> You attach **how work reaches it** and **which channels it can use**.  
> SnapServe runs the rest.

No top-level Campaigns product long-term. No Workflows kingdom. Campaigns/WhatsApp/Meet stay available until moved into the agent.

---

## Sidebar (target)

```
Home
Agents              ← main (Squads as Agents sub-nav later)

OPERATE
  Activity
  Phone numbers

Integrations

── Settings ──
Workspace · Providers · Developers · Billing
```

**Phase 1:** Primary nav above + a temporary **More** group (Campaigns, WhatsApp, Meetings, Squads, Knowledge, Scheduling, Memory) so nothing is stranded while Reach/Channels land inside the builder.

---

## Agent Builder tabs (future — do not rewrite overnight)

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
Squads = specialist handoffs, not call-vs-meet prompts.

---

## Phases

| Phase | Ship | Touch builder? |
|-------|------|----------------|
| **1 Shell** | Sidebar, agent-first Home, Create agent CTA, keep all routes | **No** |
| **2 Reach presets** | Move website/sheet/list/journey UX into agent Reach | Additive tab/panel only |
| **3 Call rules** | Retry, quiet hours, caps on Call steps | Additive |
| **4 Channels** | WA / Email / Meetings mode+delegate on agent | Additive |
| **5 Custom Reach** | Step editor | Additive |
| **6 Squads runtime** | Pick squad on Call step | Light |
| **7 Polish** | Onboarding, purge “campaign” copy, remove More | Cleanup |

---

## Safety

- Never delete Agent Builder tabs or rewrite `builder.tsx` wholesale in Phase 1.
- Old URLs (`/app/campaigns`, `/app/whatsapp`, `/app/meet`, …) keep working until their UI is absorbed into the agent.
- Partner / managed-client nav stays trimmed and functional.

---

## Success tests

1. New user finds **Create agent** in under a minute.  
2. Existing agent builder still opens every current tab.  
3. Campaigns / WhatsApp / Meet still reachable during migration.  
4. Later: form→call without leaving the agent; meeting mode/delegate; custom Reach steps.
