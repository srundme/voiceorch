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

**Reschedule = MOVE the event, don't delete+recreate.** All three paths move the
existing Google event in-place via `updateCalendarEvent` (events.patch) when an
`existingGoogleEventId` is present, falling back to `createCalendarEvent` only when
there's no prior event. Moving preserves the Meet link (recreating mints a new one).
On the authed/public paths, after a successful move, carry `google_event_id`/`meet_link`
onto the NEW booking row and NULL them on the old rescheduled-from row (the agent path
mutates the same row, so no carry-over needed there).

**gcal helpers return a discriminated union, not nullable.** `createCalendarEvent` /
`updateCalendarEvent` return `CalendarEventResult` = `{ok:true,meetLink,eventId}` |
`{ok:false,error}` (see `google-calendar.ts`). Never swallow a falsy result — branch on
`.ok` and `logger.error` the `.error` (which carries `needsReconnect`). A failing gcal
call also flips `needs_reconnect`/`reconnect_reason` on the connection row (cleared on
reconnect/upsert and on the next successful call); the dashboard surfaces this in
Conferencing + Calendars. `classifyGcalError` treats invalid_grant/401/insufficient-scope
as `needsReconnect`; delete 404/410 is "already gone", not a failure.
