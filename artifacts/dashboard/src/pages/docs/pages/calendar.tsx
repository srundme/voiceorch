import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function CalendarPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Product guides"
        title="Bookings calendar"
        description="Let agents check availability and book appointments on Google Calendar. Separate from Meeting bots that join video rooms."
      />

      <Callout variant="warn" title="Booking ≠ join">
        <strong>Connections → Bookings calendar</strong> creates invites (often with a Meet link).{" "}
        <strong>Meeting bots</strong> (<code>/app/meet</code>) join a room that already exists. See the{" "}
        <Link href="/docs/meetings">Meetings guide</Link>.
      </Callout>

      <h2 id="connect-google">1. Connect Google</h2>
      <ol>
        <li>
          Go to{" "}
          <a href="https://app.snapserve.ai/app/connections?setup=calendar" target="_blank" rel="noreferrer">
            Connections → Bookings calendar
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
        <li>Open the agent builder → Actions → Booking.</li>
        <li>Connect Google Calendar and pick the meeting callers can book — all on that tab.</li>
        <li>
          <strong>Save the agent first</strong> before enabling calendar tools if the UI prompts
          you.
        </li>
        <li>Test with a live or web-call: ask to book a slot and confirm it appears in Google.</li>
      </ol>

      <Callout variant="warn" title="Common mistakes">
        No Google account on the calendar, wrong calendar linked to the agent, or agent not saved
        after tool changes. Confirm Connections → Bookings calendar shows a connected account.
      </Callout>

      <h2 id="api">API note</h2>
      <p>
        Calendar connect and booking tools are configured in the dashboard. The public API Reference
        focuses on agents, calls, and webhooks — use Connections → Bookings calendar for Google setup
        rather than low-level calendar REST.
      </p>

      <h2 id="next">Next</h2>
      <p>
        <Link href="/docs/agents">Agents &amp; builder</Link> ·{" "}
        <Link href="/docs/meetings">Meeting agents</Link> ·{" "}
        <Link href="/docs/variables">Variables</Link> for guest name/email in prompts
      </p>
    </div>
  );
}
