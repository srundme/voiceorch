import { CodeBlock } from "../CodeBlock";
import { Link } from "wouter";

export default function SchedulingPage() {
  return (
    <div>
      <h1>Scheduling</h1>
      <p>
        SnapServe includes a full multi-tenant scheduling engine. Your agents can book, reschedule,
        and cancel appointments during a live voice call. The same system powers a public booking
        page for attendees who prefer to self-serve via the web.
      </p>

      <h2 id="concepts">Core concepts</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Concept</th>
              <th className="px-4 py-3 font-semibold">Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Calendar", "A bookable resource — e.g. 'Sales Calls', 'Support Slots'. Each calendar has an owner, timezone, and optionally a linked Google Calendar."],
              ["Event type", "A booking template with a name, slug, duration, and buffer time. e.g. '30-min Demo' at slug demo. One calendar can have multiple event types."],
              ["Availability schedule", "Weekly recurring hours for a calendar — e.g. Mon–Fri 9 am–6 pm IST. Set separately per calendar."],
              ["Date overrides", "Block out specific dates (holidays, vacations) or add extra availability windows on top of the weekly schedule."],
              ["Booking", "A confirmed reservation. Stores attendee name, email, start time, end time, and custom metadata."],
              ["Google Calendar connection", "OAuth-linked Google account. Bookings create events in the linked calendar, and existing events block off availability."],
            ].map(([c, d]) => (
              <tr key={c} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium whitespace-nowrap">{c}</td>
                <td className="px-4 py-3 text-muted-foreground">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="setup">Setting up scheduling</h2>
      <ol>
        <li>
          <strong>Create a calendar</strong> — Go to <strong>Scheduling → Calendars → New Calendar</strong>.
          Set a name and timezone. Optionally link a Google account (see{" "}
          <Link href="/docs/google-calendar" className="text-primary hover:underline">Google Calendar integration</Link>).
        </li>
        <li>
          <strong>Set availability</strong> — Open the calendar and click <strong>Edit Availability</strong>.
          Set the weekly hours you want to accept bookings.
        </li>
        <li>
          <strong>Create an event type</strong> — Go to <strong>Scheduling → Event Types → New Event Type</strong>.
          Choose a calendar, name, slug, and duration (in minutes). The slug becomes part of the
          public booking URL.
        </li>
        <li>
          <strong>Test the booking page</strong> — Visit{" "}
          <code>https://app.snapserve.ai/book/&lt;slug&gt;</code> in a browser. You should see
          available slots.
        </li>
      </ol>

      <h2 id="public-booking-page">Public booking page</h2>
      <p>
        Every event type automatically gets a public, unauthenticated booking page:
      </p>
      <CodeBlock language="text" code={`https://app.snapserve.ai/book/<slug>`} />
      <p>
        Attendees select a date, pick an available time slot, enter their name and email, and confirm.
        No account is required. After confirmation:
      </p>
      <ul>
        <li>A booking record is created in the database.</li>
        <li>A confirmation email is sent to the attendee (if email is configured).</li>
        <li>A Google Calendar event is created (if a Google account is linked).</li>
        <li>Any registered webhooks receive a <code>booking.created</code> event.</li>
      </ul>

      <h2 id="availability-engine">Availability engine</h2>
      <p>
        The slot engine computes available time slots by layering three sources:
      </p>
      <ol>
        <li><strong>Weekly schedule</strong> — the base recurring availability windows.</li>
        <li><strong>Date overrides</strong> — additions or blocks on top of the weekly schedule.</li>
        <li><strong>Existing bookings</strong> — confirmed bookings plus the configured buffer time block off slots.</li>
      </ol>
      <p>
        If a Google Calendar is linked, events in that calendar are also fetched and treated as
        busy slots, preventing double-booking across systems.
      </p>
      <p>All slot calculations are timezone-aware using the calendar's configured timezone.</p>

      <h2 id="double-booking-prevention">Double-booking prevention</h2>
      <p>
        Concurrent booking requests (e.g. two callers picking the last available slot at the same
        moment) are safe. SnapServe uses a PostgreSQL advisory lock
        (<code>pg_try_advisory_xact_lock</code>) scoped to the event type and slot start time.
        Only one booking can commit for a given slot; the other receives a conflict error and is
        prompted to pick a different time.
      </p>

      <h2 id="agent-integration">Agent integration — voice booking</h2>
      <p>
        When an agent has the <code>check_availability</code> and <code>book_appointment</code> tools
        enabled, it can manage bookings mid-call:
      </p>
      <CodeBlock language="text" code={`Caller: "Can I book a 30-minute demo for tomorrow afternoon?"
Agent:  "Let me check... I have 2 PM, 3 PM, and 4 PM available tomorrow. Which works for you?"
Caller: "3 PM."
Agent:  "Done! I've booked you in for tomorrow at 3 PM IST. You'll receive a confirmation at the email on file."`} />
      <p>
        The agent uses the <code>check_availability</code> tool to fetch open slots for the
        requested date and event type, then calls <code>book_appointment</code> to confirm the
        reservation. The attendee's email is collected during the call if not already known.
      </p>

      <h2 id="notifications">Email notifications</h2>
      <p>
        SnapServe sends confirmation emails to attendees when a booking is created. Email delivery
        requires <code>GMAIL_USER</code> and <code>GMAIL_APP_PASSWORD</code> environment variables
        to be set by the platform operator. Emails are sent via Gmail SMTP using nodemailer.
      </p>
      <p>If email is not configured, bookings still work — only email delivery is skipped.</p>

      <h2 id="webhooks">Webhooks</h2>
      <p>
        Register a webhook endpoint to receive scheduling events in real time:
      </p>
      <CodeBlock language="json" code={`{
  "event": "booking.created",
  "booking": {
    "id": "bk_abc123",
    "eventTypeId": "et_xyz",
    "attendeeName": "Priya Sharma",
    "attendeeEmail": "priya@example.com",
    "startTime": "2026-06-18T09:30:00.000Z",
    "endTime": "2026-06-18T10:00:00.000Z",
    "timezone": "Asia/Kolkata"
  }
}`} />
      <p>
        See the <Link href="/docs/webhooks" className="text-primary hover:underline">Webhooks reference</Link> for
        all event types and delivery semantics.
      </p>

      <h2 id="api">API endpoints</h2>
      <CodeBlock language="text" code={`# Calendars
GET    /api/scheduling/calendars
POST   /api/scheduling/calendars
GET    /api/scheduling/calendars/:id
PATCH  /api/scheduling/calendars/:id
DELETE /api/scheduling/calendars/:id

# Event types
GET    /api/scheduling/event-types
POST   /api/scheduling/event-types
GET    /api/scheduling/event-types/:id
PATCH  /api/scheduling/event-types/:id
DELETE /api/scheduling/event-types/:id

# Availability
GET    /api/scheduling/availability/:calendarId
PUT    /api/scheduling/availability/:calendarId

# Date overrides
GET    /api/scheduling/overrides/:calendarId
POST   /api/scheduling/overrides/:calendarId
DELETE /api/scheduling/overrides/:calendarId/:date

# Bookings
GET    /api/scheduling/bookings
DELETE /api/scheduling/bookings/:id

# Public (no auth)
GET    /api/scheduling/public/event-types/:slug
GET    /api/scheduling/public/slots?slug=demo&date=2026-06-18
POST   /api/scheduling/public/bookings`} />
    </div>
  );
}
