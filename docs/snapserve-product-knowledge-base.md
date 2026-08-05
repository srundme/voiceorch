# SnapServe — product knowledge base

**Purpose:** Feature map for the restored **Campaigns** core system (outbound dialing at scale).

## Primary navigation

Home · **Campaigns** · Agents · Connections · History

(Plus Knowledge, Memory, Squads, Analytics, Bookings under More.)

## Default path

1. Create an **agent**
2. Create a **campaign** (agent + phone + lead source)
3. Upload leads / connect webhook / Meta / sheet
4. Activate → batches dial → track outcomes in History

## Campaigns (`/app/campaigns`)

Tabbed manager:

| Tab | What |
|-----|------|
| **Campaigns** | Full campaign list — CSV, webhook, Meta, CRM. Create, activate, pause. |
| **Automatic Calls** | Google Sheets → dial pipelines |
| **From Website** | Website form webhooks + Meta Lead Ads |

Deep links (unchanged):

- `/app/campaigns/:id` — detail, Activate / Pause / Resume / Stop, batches
- `/app/campaigns/:id/batches/new` — batch wizard
- `/app/campaigns/:id/batches/:batchId` — batch workspace
- `/app/campaigns/:id/leads/:leadId` — lead profile

## Legacy redirects

| Old | Now |
|-----|-----|
| `/app/people` | `/app/campaigns` |
| `/app/automatic-calls` | `/app/campaigns?tab=scheduled` |
| `/app/call-plans` | `/app/home` (Call plans product removed) |
| `/app/meta-leads` | Connections → Meta |

## Key concepts

| Concept | Definition |
|---------|------------|
| **Campaign** | Container: agent, settings, lead pool |
| **Batch** | Scheduled subset of leads to dial |
| **Lead** | Person to call (phone, name, metadata) |
| **Outcome / Disposition** | Call result categories |

See also: [SnapServe-Campaign-Book.md](./SnapServe-Campaign-Book.md) for deep technical detail.
