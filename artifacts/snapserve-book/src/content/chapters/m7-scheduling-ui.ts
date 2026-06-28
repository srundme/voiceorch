import type { Chapter } from "../types";

export const schedulingUi: Chapter = {
  slug: "scheduling-ui",
  moduleId: "m7",
  number: "8.5",
  title: "Scheduling UI & Public Booking",
  summary:
    "The dashboard's scheduling section and the public `/book/:slug` page — calendars, event types, availability windows, and how a visitor goes from picking a slot to seeing it in Google Calendar.",
  estMinutes: 13,
  fileRef: "artifacts/dashboard/src/pages/scheduling",
  prerequisites: ["data-hooks", "scheduling"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Two audiences, two surfaces",
      paragraphs: [
        "The scheduling feature has two distinct UIs: the **dashboard scheduling section** (authenticated, for the calendar owner to configure their setup) and the **public booking page** (unauthenticated, for attendees to pick a slot and book).",
        "The dashboard section lives under `/scheduling` and is built with the same React + TanStack Query pattern as the rest of the dashboard. It wraps six backend resources: calendars, event types, availability schedules, availability overrides, bookings, and Google Calendar connections.",
        "The public booking page lives at `/book/:slug` — where `slug` is the event type's URL-safe identifier. It is fully unauthenticated and uses three public API endpoints that require no session token. The page is designed to be embeddable as an iframe on any external site.",
      ],
    },
    {
      kind: "concept",
      title: "The six building blocks",
      body: [
        "**Calendar** — the top-level container. Each calendar has a name, timezone, and can be linked to a Google Calendar connection. A user can have multiple calendars (personal, work, etc.).",
        "**Event Type** — what someone can book (e.g. '30-minute intro call'). Has a slug, duration, buffer time, max daily bookings, and belongs to one calendar. The slug is what appears in `/book/:slug`.",
        "**Availability Schedule** — the recurring weekly availability windows (Mon 9am–5pm, etc.). Stored as day-of-week + time-of-day ranges in the calendar's timezone.",
        "**Availability Override** — a one-time modification for a specific date: either block the day entirely or provide different hours. Used for holidays, travel days, and focused work blocks.",
        "**Booking** — a confirmed slot. Stores attendee name + email + notes, the start/end time, a Google Meet link (if calendar is GCal-connected), and the booking status.",
        "**Google Calendar Connection** — an OAuth token pair (access + refresh) for a user's Google account, stored AES-encrypted. One user can connect multiple Google accounts; each calendar can be mapped to one connection.",
      ],
    },
    {
      kind: "prose",
      heading: "The public booking flow",
      paragraphs: [
        "When a visitor opens `/book/intro-call`, the page makes three sequential API calls (all unauthenticated): `GET /api/scheduling/public/event-types/intro-call` (gets the event type and its calendar config), `GET /api/scheduling/public/slots?eventTypeId=…&date=…` (gets available slots for a selected date), and `POST /api/scheduling/public/bookings` (creates the booking).",
        "The slot engine on the server (`services/scheduling/slot-engine.ts`) is where the availability math happens. For a given date, it: 1) loads the recurring schedule (which days/hours are open), 2) applies any overrides for that date, 3) loads existing bookings for that date, 4) generates all possible slots at `duration` intervals, 5) removes slots that overlap existing bookings or are within `bufferMinutes` of them.",
        "Booking creation uses `pg_try_advisory_xact_lock(slotStartMs)` to prevent two simultaneous booking requests from grabbing the same slot. The lock key is the Unix timestamp (in ms) of the requested slot start time — two requests for the same slot will hash to the same key and only one will succeed.",
      ],
    },
    {
      kind: "code",
      filename: "routes/scheduling/public.ts",
      language: "typescript",
      intro: "The public booking endpoint — advisory lock prevents double-booking the same slot.",
      code: `router.post("/scheduling/public/bookings", async (req, res) => {
  const { eventTypeId, startAt, attendeeName, attendeeEmail, notes } = req.body;

  const startMs = new Date(startAt).getTime();

  const booking = await db.transaction(async (tx) => {
    // Advisory lock keyed on slot start time (ms).
    // Two concurrent requests for the same slot race here; only one wins.
    const [lock] = await tx.execute(
      sql\`SELECT pg_try_advisory_xact_lock(\${startMs})\`
    );
    if (!lock?.pg_try_advisory_xact_lock) {
      throw new Error("SLOT_TAKEN");
    }

    // Re-check availability inside the transaction (lock + check = atomic)
    const slots = await computeAvailableSlots(tx, eventTypeId, new Date(startAt));
    const isAvailable = slots.some(s => s.startAt.getTime() === startMs);
    if (!isAvailable) throw new Error("SLOT_TAKEN");

    return tx.insert(bookingsTable).values({
      eventTypeId, startAt: new Date(startAt),
      attendeeName, attendeeEmail, notes: notes ?? null,
      status: "confirmed",
    }).returning().then(r => r[0]!);
  });

  res.status(201).json(booking);
});`,
      lines: [
        {
          lines: "7-12",
          label: "advisory lock on startMs",
          explanation:
            "The slot's start time in milliseconds is a unique, deterministic integer for any given slot. Two attendees booking the same 10:00 AM slot will both try `pg_try_advisory_xact_lock(1718000400000)`. Only one transaction wins the lock; the other gets `false` and throws `SLOT_TAKEN`.",
        },
        {
          lines: "15-17",
          label: "re-check inside the transaction",
          explanation:
            "The availability check is repeated INSIDE the transaction (after acquiring the lock). Without this, a TOCTOU (time-of-check-time-of-use) race is possible: the slot was available when the user saw it, but another booking committed between then and the lock acquisition.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Google Calendar sync on booking",
      body: [
        "After the booking row is inserted, `syncBookingToGoogleCalendar(booking)` is called if the event type's calendar has a Google Calendar connection. It creates a Google Calendar event via the Google Calendar API, invites the attendee (which triggers Google's own email notification), and saves the GCal event ID to the booking row. If GCal sync fails, the booking row still exists — the failure is logged but the attendee is confirmed. Email notification via Gmail/nodemailer fires separately.",
      ],
    },
    {
      kind: "connections",
      title: "Public booking flow",
      nodes: [
        { id: "visitor", label: "Visitor", sublabel: "/book/:slug" },
        { id: "eventtypes", label: "GET /public/event-types/:slug", sublabel: "event type + calendar" },
        { id: "slots", label: "GET /public/slots", sublabel: "slot engine" },
        { id: "slotengine", label: "Slot Engine", sublabel: "slot-engine.ts", chapterSlug: "scheduling" },
        { id: "book", label: "POST /public/bookings", sublabel: "advisory lock" },
        { id: "gcal", label: "Google Calendar API", sublabel: "event created" },
        { id: "email", label: "Email Notification", sublabel: "nodemailer/Gmail" },
      ],
      edges: [
        { from: "visitor", to: "eventtypes", label: "1. GET" },
        { from: "visitor", to: "slots", label: "2. GET (date selected)" },
        { from: "slots", to: "slotengine", label: "compute" },
        { from: "visitor", to: "book", label: "3. POST (slot chosen)" },
        { from: "book", to: "gcal", label: "async sync" },
        { from: "book", to: "email", label: "async notify" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Two visitors submit booking requests for the same 10:00 AM slot simultaneously. What guarantees only one succeeds?",
          choices: [
            "A unique index on (eventTypeId, startAt) prevents the second INSERT",
            "pg_try_advisory_xact_lock keyed on the slot's Unix ms timestamp — only one transaction wins",
            "The slot engine re-checks availability before inserting; the second request sees zero slots",
            "The UI disables the slot after the first click",
          ],
          correctIndex: 1,
          explanation:
            "`pg_try_advisory_xact_lock(startMs)` is the primary guard. Both requests try to acquire the same lock (same `startMs` = same slot). Only one succeeds; the other gets `false` and throws `SLOT_TAKEN`. A unique index would also catch it, but the advisory lock provides the error message and prevents the second DB write from even reaching the INSERT.",
        },
        {
          prompt: "If Google Calendar sync fails after the booking is inserted, what happens to the booking?",
          choices: [
            "The booking is rolled back — atomicity requires both the DB row and the GCal event",
            "The booking row remains confirmed; GCal sync failure is logged but not surfaced to the attendee",
            "The booking status is set to 'pending' until GCal confirms",
            "The attendee receives an error email and must try again",
          ],
          correctIndex: 1,
          explanation:
            "GCal sync is fire-and-forget after the booking transaction commits. A GCal API failure doesn't roll back the booking. The attendee is confirmed. This is a deliberate choice: GCal is a convenience sync, not a booking authority — the SnapServe DB is the source of truth.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Dashboard section: full CRUD on 6 resource types (calendars, event types, availability, overrides, bookings, GCal connections)",
        "Public booking page: 3 unauthenticated endpoints, no session required, embeddable",
        "Slot engine: recurring schedule + overrides + existing bookings → available slots",
        "`pg_try_advisory_xact_lock(startMs)` prevents double-booking the same slot",
        "GCal sync is post-commit and non-blocking — booking confirmation never depends on Google API",
      ],
    },
  ],
};
