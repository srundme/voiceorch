import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function CalendarPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Product guides"
        title="Calendar & booking"
        description="Let agents check availability and book appointments on Google Calendar (or SnapServe scheduling)."
      />

      <h2 id="connect-google">1. Connect Google</h2>
      <ol>
        <li>
          Go to{" "}
          <a href="https://app.snapserve.ai/app/scheduling" target="_blank" rel="noreferrer">
            Scheduling
          </a>{" "}
          in the dashboard.
        </li>
        <li>Create or open a calendar and connect a Google account.</li>
        <li>Grant calendar read/write scopes SnapServe requests.</li>
      </ol>

      <h2 id="event-types">2. Event types &amp; availability</h2>
      <p>
        Define what can be booked (duration, buffers) and when you are free. Availability rules
        drive slot search during the call.
      </p>

      <h2 id="agent-tools">3. Link the agent</h2>
      <ol>
        <li>Open the agent builder → Tools / scheduling section.</li>
        <li>Select the calendar (and event type) for booking tools.</li>
        <li>
          <strong>Save the agent first</strong> before enabling calendar tools if the UI prompts
          you.
        </li>
        <li>Test with a live or web-call: ask to book a slot and confirm it appears in Google.</li>
      </ol>

      <Callout variant="warn" title="Common mistakes">
        No Google account on the calendar, wrong calendar linked to the agent, or agent not saved
        after tool changes. Confirm Scheduling → calendar shows a connected account.
      </Callout>

      <h2 id="api">Via API</h2>
      <p>
        Calendars, event types, availability, slots, and bookings are available under{" "}
        <Link href="/docs/api-reference">API Reference → Scheduling</Link> (
        <code>listCalendars</code>, <code>getAvailableSlots</code>, <code>createBooking</code>, …).
      </p>

      <h2 id="next">Next</h2>
      <p>
        <Link href="/docs/agents">Agents &amp; builder</Link> ·{" "}
        <Link href="/docs/variables">Variables</Link> for guest name/email in prompts
      </p>
    </div>
  );
}
