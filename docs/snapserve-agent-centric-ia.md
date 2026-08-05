# SnapServe UI Vision — Call plans IA

**Status:** Phase 4 nav cleanup (Call plans front door).  
**Rule:** Agents talk. Call plans decide what happens next for each person. Journeys / dial engines stay under the hood.  
**Layout:** Stripe-style full pages — one `h1` per screen via `StripePage`.

---

## Product line

> You create an **agent** (who talks).  
> You make a **call plan** (ordered steps: call → WhatsApp → wait → meet → stop).  
> You attach **people** (CSV / Sheet / forms).  
> You wire **connections** once (phone, WhatsApp, Sheets, Meet).  
> **History** shows what happened.

---

## Sidebar (Phase 4)

```
Home
Call plans
Agents
People
Connections
History

MORE
  Knowledge · Memory · Squads · Analytics · Scheduling

── Settings ──
Workspace · Providers · Developers · Billing
```

Mobile bottom: Home · Plans · Create · Agents · History

Partner Hub appears for partners. Managed clients get a trimmed nav (Home · Call plans · Agents · History · Connections).

---

## Redirects (legacy URLs kept)

| Old | New home |
|-----|----------|
| `/app/automation` | `/app/call-plans` |
| `/app/campaigns` | `/app/people` |
| `/app/automatic-calls` (list) | `/app/people?tab=scheduled` |
| `/app/meta-leads` | `/app/people?tab=lead-sources` |
| `/app/calls`, `/app/activity` | `/app/history` |
| `/app/callbacks` | `/app/history?tab=callbacks` |
| `/app/transfers` | `/app/history?tab=transfers` |

Deep-links kept (not primary nav): `/app/channels`, `/app/whatsapp`, `/app/meet`, campaign/sheet detail routes.

---

## Phases

1. Agent create wizard + dual prompt (calls / meetings) — done  
2. Call plans MVP — done  
3. Richer steps + Keep live — done  
4. Nav cleanup (this doc) — done  
5. Team create polish + plain-language If… — done  
