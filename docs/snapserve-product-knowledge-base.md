# SnapServe — product knowledge base

**Purpose:** Feature map for the **Campaigns** core system (outbound dialing at scale).

## Primary navigation

Home · **Campaigns** · Agents · Connections · History

## Default path

1. Create an **agent**
2. Open **Campaigns** → **Start a campaign** from a source
3. Attach agent + phone → activate → dial → track in History

## Campaigns (`/app/campaigns`)

Single page (no tabs). Top section is the starter:

| Start with | Opens |
|------------|--------|
| **Meta** | New campaign wizard (Meta Lead Ads) |
| **Website** | New campaign wizard (webhook / form) |
| **Google Sheets** | `/app/automatic-calls/new` sheet pipeline |
| **CSV file** | New campaign wizard (batch upload) |
| **Zoho CRM** | New campaign wizard (CRM import) |

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
