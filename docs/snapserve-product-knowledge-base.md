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

See also: [SnapServe-Campaign-Book.md](./SnapServe-Campaign-Book.md).
