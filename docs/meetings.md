# SnapServe Meeting bots — feature map

Send a voice **agent** into **Google Meet / Zoom / Microsoft Teams**. Same agent brain as phone calls; different channel (Recall.ai bot + WebRTC page).

**Not the same as Bookings calendar:** Connections → Bookings calendar creates appointments with a Meet link on the invite. Meeting bots (`/app/meet`) join a room that already exists.

## Enable meetings on an agent

1. **Agents →** open agent → enable **Meetings** (Phone + meetings / meetings settings).
2. Set a **meeting prompt** (can differ from the phone prompt).
3. Optional: bot display name, max duration, silence timeout, mute-when-idle, presentation deck URL, auto-start slides, who joins (`self` vs delegate agent).
4. Agent appears on **`/app/meet`**.

## Three join paths

| Path | Where | Use when |
|------|--------|----------|
| **Paste link** | `/app/meet` → paste Meet/Zoom/Teams URL → Join | Ad-hoc “join now” |
| **Google Calendar (AI meetings)** | `/app/meet` → Connect Google → toggle **Join** per event | Auto-join upcoming calendar meetings |
| **Booking auto-dispatch** | Scheduling / bookings with a `meet_link` | Bot joins near the booked slot |

> **Two Google Calendar connects:**  
> - **Connections → Bookings calendar** = create booking events (write).  
> - **Meeting bots → Connect Google** = AI meetings (readonly calendar → Recall). They are not the same button.

## In-meeting capabilities (tools)

The runtime injects meeting tools when the agent is inside a meeting:

| Capability | Tool(s) | Notes |
|------------|---------|--------|
| Leave | `leave_meeting` | Bot exits cleanly |
| Mute / unmute | `mute_meeting`, `unmute_meeting` | Soft mute-when-idle also available |
| Chat | `send_meeting_chat` | Optional pin |
| Slides / present | `start_presentation`, `stop_presentation`, `next_slide`, `previous_slide`, `goto_slide` | Deck URL on agent meetings config |
| Rejoin later | `schedule_meet_rejoin` | Same URL, later time |

Also: participant roster / speaker tags (Recall realtime), dual prompt (call vs meeting), admit bot if Meet waiting room requires it.

## Dashboard checklist

1. Create agent with meetings enabled + meeting prompt.  
2. Open `/app/meet` → select agent → paste URL → Join.  
3. Admit the bot if the host UI asks.  
4. Demo leave / mute / slides / chat as needed.  
5. After the call: History → recording / transcript (meeting recording endpoints when available).

## API (session auth)

Documented in **API Reference → Meetings**. Primary endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/meet-bots` | Launch bot `{ agentId, meetingUrl, joinAsSelected? }` |
| `GET` | `/api/meet-bots/:botId` | Status |
| `DELETE` | `/api/meet-bots/:botId` | Leave |
| `GET` | `/api/meet-bots/identity` | Bot email / Meet identity for invites |
| `GET` | `/api/meet-calendar/connection` | Calendar connection status |
| `GET` | `/api/meet-calendar/events` | Upcoming events + join flags |
| `POST` | `/api/meet-calendar/events/:eventId/bot` | Enable join for event |
| `DELETE` | `/api/meet-calendar/events/:eventId/bot` | Disable join |

Internal/public bot pages (`/meet-bots/page`, present, recall-events) are used by Recall — not for app developers.

Ops notes for Calendar V2: [recall-calendar-v2-ops.md](./recall-calendar-v2-ops.md)

## Mental model

Meetings do **not** replace Campaigns.  
- **Phone / campaign** = dial people.  
- **Meetings** = join a video room already scheduled or pasted.  
Disposition + after-call messages still belong on the **agent**; use them if you want WhatsApp/email after a meeting call ends (when the meeting session produces a call record).
