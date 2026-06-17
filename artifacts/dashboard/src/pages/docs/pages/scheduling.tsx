import { CodeBlock } from "../CodeBlock";

export default function SchedulingPage() {
  return (
    <div>
      <h1>Scheduling</h1>
      <p>SnapServe includes a full multi-tenant scheduling engine. Your agents can book appointments, reschedule, and cancel — all via voice, mid-call.</p>

      <h2>Concepts</h2>
      <ul>
        <li><strong>Calendar</strong> — A bookable resource (e.g. "Sales Calls", "Support Slots"). Each calendar has an owner and can sync to a Google Calendar.</li>
        <li><strong>Event type</strong> — A booking template: duration, name, slug, and buffer time. e.g. "30-min Demo" at slug <code>demo</code>.</li>
        <li><strong>Availability schedule</strong> — Weekly hours per calendar (e.g. Mon-Fri 9am–5pm IST).</li>
        <li><strong>Date overrides</strong> — Block out specific dates or add extra availability.</li>
        <li><strong>Booking</strong> — A confirmed reservation with attendee info and confirmation email.</li>
      </ul>

      <h2>Public booking page</h2>
      <p>Every event type gets a public URL: <code>https://app.snapserve.ai/book/:slug</code></p>
      <p>Attendees pick a slot, fill in their name and email, and confirm. No login required.</p>

      <h2>Google Calendar sync</h2>
      <p>Connect a Google account from the Scheduling → Calendars page. New bookings create Google Calendar events and auto-block the slot.</p>

      <h2>Agent tool: book_appointment</h2>
      <p>When an agent has the book_appointment tool enabled, it can confirm a booking mid-call:</p>
      <CodeBlock code={`Agent: "I can book a 30-minute demo for you. What date works?"
Caller: "Tomorrow at 3pm"
Agent: "Done! You're booked for tomorrow at 3pm IST. Confirmation sent to your email."`} language="text" />
    </div>
  );
}
