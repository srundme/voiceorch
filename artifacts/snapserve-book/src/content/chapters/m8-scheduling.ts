import type { Chapter } from "../types";

export const scheduling: Chapter = {
  slug: "scheduling",
  moduleId: "m8",
  number: "9.2",
  title: "The Scheduling Engine",
  summary:
    "A multi-tenant booking system: calendars, availability, advisory-locked slots, and Google Calendar sync.",
  estMinutes: 18,
  fileRef: "artifacts/api-server/src/services/scheduling/",
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "When a SnapServe agent says 'I can book you in for Tuesday at 3pm', something real has to happen behind the scenes: the system must know the business's working hours, see which slots are already taken, offer only the free ones, and — critically — make sure **two callers can't grab the same slot at the same instant**.",
        "That whole job lives in `services/scheduling/`. It's a self-contained, multi-tenant booking engine (think a tiny Calendly that every agent shares). This chapter walks the two files that do the heavy lifting: `slot-engine.ts`, which computes available times, and `lock.ts`, which guarantees nobody double-books.",
      ],
    },
    {
      kind: "concept",
      title: "The pieces: calendars, event types, availability, bookings",
      body: [
        "The scheduling system spans **6 database tables**: `scheduling_calendars` (the top-level container, with a timezone), `event_types` (a bookable thing — '30-min consult' — with a duration and buffers), `availability_schedules` (weekly working hours, e.g. Mon–Fri 9–5), `availability_overrides` (one-off changes, like 'closed Dec 25'), `bookings` (the actual reservations), and `google_calendar_connections` (OAuth links for syncing).",
        "A **slot** is one candidate appointment time. The engine's job is to walk a date range, lay out the working windows, chop them into duration-sized slots, and remove any that collide with existing bookings.",
        "**Buffers** are padding around an appointment — `bufferBeforeMins` and `bufferAfterMins`. A 30-min meeting with a 10-min after-buffer occupies 40 minutes of the calendar, so the next slot can't start for 40 minutes. This stops back-to-back meetings with no breathing room.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Timezones are the #1 source of scheduling bugs",
      body: [
        "Every slot calculation is **timezone-anchored** to the calendar's IANA zone (e.g. `Asia/Kolkata`) using `date-fns-tz`. The code repeatedly warns: **never** use `new Date()` + `setHours()`, because those write hours in the server's local timezone (UTC on Railway), which then gets re-interpreted as calendar-local — producing a doubly-shifted, wrong time.",
        "The fix is to pass ISO strings straight into `fromZonedTime(\`${dateStr}T${time}:00\`, tz)`, which converts a calendar-local wall-clock time to the correct UTC instant in one step.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/services/scheduling/slot-engine.ts",
      language: "typescript",
      intro:
        "The slot engine starts by loading the event type and its calendar, then converting the requested date range into UTC instants anchored to the calendar's timezone.",
      code: `export async function getAvailableSlots(
  eventTypeId: number,
  startDateStr: string,
  endDateStr: string,
): Promise<TimeSlot[]> {
  const eventType = await db
    .select()
    .from(eventTypesTable)
    .where(eq(eventTypesTable.id, eventTypeId))
    .then((r) => r[0]);
  if (!eventType || !eventType.isActive) return [];

  const calendar = await db
    .select()
    .from(schedulingCalendarsTable)
    .where(eq(schedulingCalendarsTable.id, eventType.calendarId))
    .then((r) => r[0]);
  if (!calendar || !calendar.isActive) return [];

  const tz = calendar.timezone;
  const durationMins = eventType.durationMinutes;
  const bufferBefore = eventType.bufferBeforeMins;
  const bufferAfter = eventType.bufferAfterMins;

  const rangeStartUTC = fromZonedTime(\`\${startDateStr}T00:00:00\`, tz);
  const rangeEndUTC   = fromZonedTime(\`\${endDateStr}T23:59:59\`, tz);`,
      lines: [
        {
          lines: "1-4",
          label: "the inputs",
          explanation:
            "An event type id plus a date range as plain `\"yyyy-MM-dd\"` strings. It returns a `Promise<TimeSlot[]>` — a list of `{ slotStart, slotEnd }` pairs.",
        },
        {
          lines: "5-11",
          label: "load + guard the event type",
          explanation:
            "Fetch the event type; if it doesn't exist or is inactive, return an **empty array** rather than throwing. The whole engine fails soft — no slots is a valid, safe answer.",
        },
        {
          lines: "13-19",
          label: "load + guard the calendar",
          explanation:
            "Every event type belongs to a calendar, which carries the all-important `timezone`. Same soft-fail guard.",
        },
        {
          lines: "21-24",
          label: "pull out the knobs",
          explanation:
            "The timezone, the appointment duration, and the two buffers — the four numbers that shape every slot.",
        },
        {
          lines: "26-27",
          label: "anchor the range to the calendar's tz",
          explanation:
            "`fromZonedTime(\"2025-06-01T00:00:00\", tz)` reads that wall-clock string **as if** it were in the calendar's timezone and returns the matching UTC instant. This is the safe pattern that avoids the double-shift bug.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/services/scheduling/slot-engine.ts",
      language: "typescript",
      intro:
        "Next it fetches every existing booking that OVERLAPS the range — using an open-interval check so boundary-touching bookings are never missed.",
      code: `  const existingBookings = await db
    .select({
      slotStart: bookingsTable.slotStart,
      slotEnd: bookingsTable.slotEnd,
      eventTypeId: bookingsTable.eventTypeId,
    })
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.calendarId, calendar.id),
        or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
        lt(bookingsTable.slotStart, rangeEndUTC),
        gt(bookingsTable.slotEnd, rangeStartUTC),
      ),
    );`,
      lines: [
        {
          lines: "9-10",
          label: "this calendar, live bookings only",
          explanation:
            "Filter to the calendar in question, and only bookings that actually occupy time — `pending` or `confirmed`. Cancelled bookings free their slot back up.",
        },
        {
          lines: "11-12",
          label: "the open-interval overlap test",
          explanation:
            "`slotStart < rangeEnd AND slotEnd > rangeStart` is the classic interval-overlap formula. It catches every booking that touches the range, including ones starting or ending exactly on a boundary — a subtle correctness detail the comments call out explicitly.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/services/scheduling/slot-engine.ts",
      language: "typescript",
      intro:
        "The core loop: for each day, lay out the working windows, then step through them duration-by-duration, keeping only slots that don't collide.",
      code: `      let cursor = windowStartUTC;
      while (true) {
        const slotStart = cursor;
        const slotEnd = addMinutes(slotStart, durationMins);

        if (isAfter(slotEnd, windowEndUTC)) break;

        // Effective window occupied by THIS slot (including its own buffers)
        const effectiveStart = addMinutes(slotStart, -bufferBefore);
        const effectiveEnd = addMinutes(slotEnd, bufferAfter);

        let bufferConflicts = 0;
        let exactConflicts = 0;
        for (const b of existingBookings) {
          // ...
          if (isOverlapping(effectiveStart, effectiveEnd, bEffectiveStart, bEffectiveEnd)) {
            bufferConflicts++;
          }
          if (isOverlapping(slotStart, slotEnd, b.slotStart, b.slotEnd)) {
            exactConflicts++;
          }
        }

        const withinCapacity = exactConflicts < eventType.maxBookingsPerSlot;
        const noBufferViolation = bufferConflicts === exactConflicts;
        if (withinCapacity && noBufferViolation) {
          slots.push({ slotStart, slotEnd });
        }

        cursor = addMinutes(cursor, durationMins + bufferAfter);
      }`,
      lines: [
        {
          lines: "1-4",
          label: "walk the window slot by slot",
          explanation:
            "A `cursor` starts at the window's beginning. Each iteration carves out one candidate slot of `durationMins` length.",
        },
        {
          lines: "6",
          label: "stop at the window edge",
          explanation:
            "If a slot would run past the end of the working window, break — you can't book a 30-min meeting that ends after closing time.",
        },
        {
          lines: "8-10",
          label: "expand by buffers",
          explanation:
            "The 'effective' window is the slot **plus its buffers** — the real footprint this appointment would occupy on the calendar.",
        },
        {
          lines: "12-21",
          label: "count two kinds of conflict",
          explanation:
            "For every existing booking, count `bufferConflicts` (does the buffer-expanded footprint overlap?) and `exactConflicts` (does the bare slot overlap?). Tracking both is what lets the engine support multi-capacity slots without breaking buffer rules.",
        },
        {
          lines: "23-27",
          label: "the availability rule",
          explanation:
            "A slot is free if it's `withinCapacity` (fewer exact overlaps than `maxBookingsPerSlot`) AND `noBufferViolation` (every conflict is an exact same-slot overlap, not a buffer-adjacent one). Only then is it pushed.",
        },
        {
          lines: "29",
          label: "advance the cursor",
          explanation:
            "Step forward by `durationMins + bufferAfter` so the next slot respects the after-buffer gap. This is why slots aren't always perfectly back-to-back.",
        },
      ],
    },
    {
      kind: "concept",
      title: "The double-booking problem",
      body: [
        "Computing availability is the easy half. The hard half is a **race condition**: two callers see the same 3pm slot as free, and both hit 'book' within milliseconds. Both requests pass the availability check, both insert a booking — and now you've sold the same seat twice.",
        "Re-checking availability inside the booking request isn't enough on its own, because two requests can interleave: A checks (free), B checks (free), A inserts, B inserts. The check-then-act gap is the bug.",
        "The fix is a **lock**: a way to say 'only one request may work on this specific slot at a time'. SnapServe uses a PostgreSQL **advisory transaction lock** — a lightweight, app-defined lock that the database releases automatically when the transaction ends.",
      ],
    },
    {
      kind: "analogy",
      title: "The single bathroom key",
      body: [
        "Picture a café with one bathroom and one physical key at the counter. To use it you must hold the key. If someone else has it, you wait. When you're done, you return it.",
        "`pg_try_advisory_xact_lock` is that key, scoped to a single slot. The first booking request to grab the key for 'calendar 7, 3pm Tuesday' proceeds; any concurrent request for the **same** slot is told 'key's taken' and bails out with a 409. The moment the first transaction commits (or rolls back), the key is returned automatically — no risk of someone walking off with it.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/services/scheduling/lock.ts",
      language: "typescript",
      intro:
        "The entire lock helper — two tiny functions. This is the double-booking guard.",
      code: `export async function tryAdvisoryLock(lockKey: string): Promise<boolean> {
  const result = await db.execute(
    sql\`SELECT pg_try_advisory_xact_lock(hashtext(\${lockKey})) AS acquired\`
  );
  const row = result.rows[0] as { acquired: boolean } | undefined;
  return row?.acquired === true;
}

/**
 * Builds a deterministic lock key from a calendar ID and slot start time.
 */
export function buildSlotLockKey(calendarId: number, slotStart: Date): string {
  return \`scheduling:\${calendarId}:\${slotStart.toISOString()}\`;
}`,
      lines: [
        {
          lines: "1-2",
          label: "pg_try_advisory_xact_lock",
          explanation:
            "`try` means **non-blocking**: it grabs the lock if free and returns `true`, or returns `false` immediately if someone else holds it (instead of waiting). `xact` means the lock is bound to the current transaction and auto-releases on commit/rollback — no manual unlock, no leaked locks if the request crashes.",
        },
        {
          lines: "2",
          label: "hashtext(lockKey)",
          explanation:
            "Advisory locks are keyed by integers, not strings. `hashtext()` hashes our string key into the integer Postgres needs. Two requests with the same slot key hash to the same lock.",
        },
        {
          lines: "4-5",
          label: "read the result",
          explanation:
            "The query returns one row with an `acquired` boolean. We return `true` only when it's strictly `true` — a safe, explicit check.",
        },
        {
          lines: "12-13",
          label: "buildSlotLockKey — deterministic",
          explanation:
            "The key is `scheduling:<calendarId>:<ISO start time>`. **Deterministic** is the whole point: the same slot always produces the exact same string, so two concurrent bookings for it collide on the same lock. The ISO timestamp gives a stable, timezone-unambiguous representation.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/scheduling/bookings.ts",
      language: "typescript",
      intro:
        "Here's the lock in action inside the booking route — acquired at the top of a transaction, re-checking for conflicts, then inserting.",
      code: `  await db.transaction(async (tx) => {
    const lockResult = await tx.execute(
      sql\`SELECT pg_try_advisory_xact_lock(hashtext(\${lockKey})) AS acquired\`
    );
    const acquired = (lockResult.rows[0] as any)?.acquired === true;
    if (!acquired) { lockConflict = true; return; }

    // ... buffer-aware in-transaction conflict re-check ...

    if (exactOverlapCount >= eventType.maxBookingsPerSlot || overlapCount > exactOverlapCount) {
      lockConflict = true; return;
    }

    const [inserted] = await tx.insert(bookingsTable).values({
      eventTypeId: eventType.id,
      calendarId: calendar.id,
      // ...
      slotStart,
      slotEnd,
      status: eventType.confirmationMode === "instant" ? "confirmed" : "pending",
      bookedVia: parsed.data.bookedVia ?? "api",
    }).returning();
    booking = inserted;
  });

  if (lockConflict || !booking) {
    res.status(409).json({ error: "Slot already booked — please try another slot" });
    return;
  }`,
      lines: [
        {
          lines: "1",
          label: "everything inside a transaction",
          explanation:
            "The lock is an `xact` lock, so it only exists for the life of this `db.transaction`. Wrapping the lock + check + insert together means they're atomic from a concurrency standpoint.",
        },
        {
          lines: "2-6",
          label: "grab the lock or bail",
          explanation:
            "Acquire the slot lock. If `acquired` is false, another request is mid-booking this exact slot — set `lockConflict` and return, which rolls back the transaction.",
        },
        {
          lines: "10-12",
          label: "belt-and-suspenders re-check",
          explanation:
            "Even with the lock held, it re-counts overlaps **inside** the transaction (including buffer-adjacent races). Lock + re-check together close the check-then-act gap completely.",
        },
        {
          lines: "14-22",
          label: "insert the booking",
          explanation:
            "Now safe to insert. `confirmationMode === \"instant\"` decides whether it lands as `confirmed` or `pending` (needs manual approval). `.returning()` hands back the new row.",
        },
        {
          lines: "26-29",
          label: "409 on conflict",
          explanation:
            "If the lock was taken or the insert never happened, respond `409 Conflict` — the standard HTTP code for 'someone got there first'. The caller can retry another slot.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Booking also syncs to Google Calendar",
      body: [
        "After a booking commits, the route attempts to create a real Google Calendar event with a Meet link via `services/scheduling/google-calendar.ts`. SnapServe owns **one** Google OAuth app (SaaS-style) so users just click 'Connect with Google' — no developer setup. Tokens are encrypted at rest and auto-refreshed.",
        "Crucially, GCal sync happens **outside** the booking transaction and is wrapped in its own try/catch. If Google is down, the booking still succeeds — the row just gets a `calendarSyncStatus` of `skipped`/failed. The local DB is the source of truth; Google is best-effort mirroring.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "The scheduling engine is wired between the booking routes, the database tables, and Google. Click a box to jump to its chapter.",
      nodes: [
        { id: "route", label: "POST /scheduling/bookings", sublabel: "routes/scheduling/bookings.ts", chapterSlug: "routes-anatomy" },
        { id: "engine", label: "slot-engine.ts", sublabel: "THIS MODULE — getAvailableSlots", current: true },
        { id: "lock", label: "lock.ts", sublabel: "THIS MODULE — advisory lock", current: true },
        { id: "tables", label: "6 scheduling tables", sublabel: "calendars, event_types, bookings…", chapterSlug: "drizzle-intro" },
        { id: "gcal", label: "google-calendar.ts", sublabel: "OAuth sync + Meet links" },
        { id: "agent", label: "AI agent on a call", sublabel: "books via tool call", chapterSlug: "the-call-journey" },
      ],
      edges: [
        { from: "agent", to: "route", label: "'book me Tuesday 3pm'" },
        { from: "route", to: "engine", label: "is the slot offered?" },
        { from: "route", to: "lock", label: "claim the slot" },
        { from: "engine", to: "tables", label: "read bookings + windows" },
        { from: "route", to: "tables", label: "insert booking" },
        { from: "route", to: "gcal", label: "best-effort sync" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does the booking route use `pg_try_advisory_xact_lock` instead of just re-checking availability before inserting?",
          choices: [
            "It's faster than a SELECT.",
            "A bare check-then-insert has a race window; the lock ensures only one request works on a slot at a time, and it auto-releases at transaction end.",
            "Advisory locks store the booking data.",
            "Postgres requires a lock before any INSERT.",
          ],
          correctIndex: 1,
          explanation:
            "Two concurrent requests can both pass an availability check before either inserts. The advisory lock serializes them per-slot, and being an `xact` lock it releases automatically on commit/rollback — no leaked locks.",
        },
        {
          prompt: "What's the purpose of `buildSlotLockKey` returning a deterministic string?",
          choices: [
            "To make logs readable.",
            "So two booking attempts for the SAME slot produce the same key and therefore collide on the same lock.",
            "To encrypt the slot.",
            "Postgres can't hash random strings.",
          ],
          correctIndex: 1,
          explanation:
            "Determinism is the whole point: `scheduling:<calId>:<ISO time>` is identical for the same slot every time, so concurrent requests for it hash to the same advisory lock and contend.",
        },
        {
          prompt: "Why must the slot engine avoid `new Date()` + `setHours()` when building window boundaries?",
          choices: [
            "Those functions are deprecated.",
            "They write hours in the server's local timezone (UTC on Railway), which then gets re-interpreted as calendar-local, double-shifting the time.",
            "They're too slow for a loop.",
            "They can't handle minutes.",
          ],
          correctIndex: 1,
          explanation:
            "`setHours` uses the runtime's local tz. Passing an ISO string directly into `fromZonedTime(..., tz)` converts calendar-local wall-clock to the correct UTC instant in one safe step.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Scheduling spans 6 tables: calendars, event types, availability schedules, overrides, bookings, and Google connections.",
        "`getAvailableSlots` walks each day's working windows, chops them into duration-sized slots, and removes ones that collide (respecting buffers and per-slot capacity).",
        "All time math is anchored to the calendar's IANA timezone via `date-fns-tz` — never `setHours()`, to avoid double-shift bugs.",
        "Double-booking is prevented by `pg_try_advisory_xact_lock`: a non-blocking, per-slot lock that auto-releases at transaction end.",
        "The booking route holds the lock AND re-checks conflicts inside the transaction, then returns 409 if the slot was taken.",
        "Google Calendar sync runs outside the transaction as best-effort — the local DB stays the source of truth even if Google fails.",
      ],
    },
  ],
};
