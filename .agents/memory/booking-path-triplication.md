---
name: Scheduling booking path triplication
description: The three booking execution paths that must each duplicate gcal + notification logic
---

# Scheduling booking path triplication

Any booking-side effect (Google Calendar event create/update/delete, attendee emails,
host notifications, webhook dispatch) lives in THREE separate places that do not share
a code path. A change to one almost always needs the same change in the other two:

1. **Agent / voice path** — `services/tool-executor.ts` (`executeNativeBooking`,
   `executeNativeReschedule`, `executeNativeCancel`). This is the path AI agents take
   during a call.
2. **Public unauthenticated path** — `routes/scheduling/public.ts` (create / cancel /
   reschedule for the `/book/:slug` attendee page, token-driven).
3. **Authenticated dashboard path** — `routes/scheduling/bookings.ts` (create /
   reschedule / cancel / confirm for the logged-in user).

**Why:** there is no single `createBooking` service that all three call; the gcal +
email + webhook orchestration is inlined in each. Historically the agent path was
missing gcal-event creation and host emails entirely because someone updated only the
web paths.

**How to apply:** when adding/altering booking notifications, Google Calendar sync,
attendees, or webhook payloads, grep all three files and update each. Connection
resolution pattern in every path: calendar-specific `google_calendar_connection_id`
(raw SQL on `scheduling_calendars`) else `getFirstConnectionForUser(userId)`.
`meet_link` / `google_event_id` columns exist in DB but NOT in the Drizzle schema —
read/write them via raw `sql`.
