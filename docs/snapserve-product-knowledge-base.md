# SnapServe — product knowledge base

**Purpose:** Feature map for the **Campaigns** core system (outbound dialing at scale).

## Primary navigation

Home · **Campaigns** · Agents · Connections · History

## Default path

1. Create an **agent**
2. Open **Campaigns** → **Start a campaign** from a source
3. Attach agent + phone → activate → dial → track in History

## Campaigns (`/app/campaigns`)

Single page. Top section is source-specific setup (not one universal wizard):

| Start with | Opens |
|------------|--------|
| **Meta** | Connections → Meta Lead Ads setup |
| **Website** | Connections → Website form / webhook setup |
| **Google Sheets** | `/app/automatic-calls/new` sheet pipeline |
| **CSV file** | CSV campaign wizard → then batch upload |
| **Zoho CRM** | Connect Zoho OAuth (if needed) → CRM campaign wizard → detail |

Below: **Your campaigns** list, metrics, search/filter (when any exist).

Deep links:

- `/app/campaigns/:id` — detail, Activate / Pause / Resume / Stop, batches
- `/app/campaigns/:id/batches/new` — batch wizard
- `/app/automatic-calls` — sheet pipeline list

## Legacy redirects

| Old | Now |
|-----|-----|
| `/app/people` | `/app/campaigns` |
| `/app/call-plans` | `/app/home` |

## Meetings — three join paths

| Path | Where | Use when |
|------|--------|----------|
| **Paste link** | `/app/meet` → paste Meet/Zoom/Teams URL | Ad-hoc join now |
| **Google Calendar (AI meetings)** | `/app/meet` → Connect Google → toggle Join per event | Self-serve: user connects their calendar; SnapServe schedules bots via Recall Calendar V2 |
| **Booking auto-dispatch** | Scheduling / bookings with `meet_link` | SnapServe booking creates Meet link; worker launches bot near slot time |

Booking “Connect Google Calendar” under Connections is for **creating** booking events (write). AI meetings connect uses **readonly** calendar scopes and hands the refresh token to Recall — do not treat them as the same connect button.

Ops: [recall-calendar-v2-ops.md](./recall-calendar-v2-ops.md)

See also: [SnapServe-Campaign-Book.md](./SnapServe-Campaign-Book.md) · [Brand kit](./brand/BRAND.md) (logo, colors, assets).
