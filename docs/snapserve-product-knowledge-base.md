# SnapServe — product knowledge base

**Purpose:** Short feature map for the live product. For the ownership model see [snapserve-product-clarity.md](./snapserve-product-clarity.md).

## Primary navigation

Home · **Campaigns** · Agents · Phone numbers · **Connections** · History  
(+ Knowledge, Memory, Squads, Analytics, Bookings)

## Default path (phone)

1. Create an **agent** (prompt + greeting + Outcomes)
2. Wire **Connections** (WhatsApp / Sheets / Website as needed)
3. **Campaigns** → start from a source → attach agent + phone → activate
4. Track in History; after-call messages fire from the **agent**

## Who owns what (summary)

| Layer | Owns |
|-------|------|
| **Agent** | Prompt, voice, tools, KB, Outcomes, after-call WA/email, meeting settings |
| **Campaign** | Leads, dial queue, **lead transfer** (webhook / Sheets) |
| **Connections** | WhatsApp, Email, Sheets, Website, Meta, Calendar, Meetings entry |
| **Squads** | Live handoff + follow-up tasks |
| **Meetings** | Join Meet / Zoom / Teams |

## Campaigns (`/app/campaigns`)

| Start with | Opens |
|------------|--------|
| **Meta** | Connections → Meta Lead Ads |
| **Website** | Connections → Website form |
| **Google Sheets** | Automatic Calls / sheet pipeline |
| **CSV file** | CSV campaign wizard |
| **Zoho CRM** | CRM campaign wizard |

Campaign Configuration: **lead transfer** by disposition. WhatsApp/email after-call rules live on the **agent** (Disposition → After-call messages).

## Meetings — three join paths

| Path | Where | Use when |
|------|--------|----------|
| **Paste link** | `/app/meet` | Ad-hoc join now |
| **Google Calendar (AI meetings)** | `/app/meet` → Connect Google → Join toggles | Auto-join calendar events |
| **Booking auto-dispatch** | Bookings with `meet_link` | Bot near slot time |

Capabilities: leave, mute/unmute, chat, slides (`start/stop/next/previous/goto`), schedule rejoin. Full map: [meetings.md](./meetings.md).

Booking “Connect Google Calendar” under Connections is for **creating** booking events. AI meetings connect is **readonly** for Recall — different button.

Ops: [recall-calendar-v2-ops.md](./recall-calendar-v2-ops.md)

## Legacy redirects

| Old | Now |
|-----|-----|
| `/app/people` | `/app/campaigns` |
| `/app/call-plans` | `/app/home` |

## See also

- [Product clarity](./snapserve-product-clarity.md)  
- [Voiceathon playbook](./voiceathon-participant-playbook.md)  
- [Meetings](./meetings.md)  
- [Brand kit](./brand/BRAND.md)  
- In-app docs: https://app.snapserve.ai/docs  
- API Reference: https://app.snapserve.ai/docs/api-reference  
