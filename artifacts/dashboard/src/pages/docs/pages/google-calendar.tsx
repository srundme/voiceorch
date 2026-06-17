import { CodeBlock } from "../CodeBlock";

export default function GoogleCalendarPage() {
  return (
    <div>
      <h1>Google Calendar Integration</h1>
      <p>
        SnapServe integrates with Google Calendar to sync your scheduling: new bookings create
        Google Calendar events automatically, and existing events on your calendar are treated
        as busy slots — preventing double-booking across both systems.
      </p>

      <h2 id="how-it-works">How it works</h2>
      <ol>
        <li>You connect a Google account from the Scheduling settings page.</li>
        <li>When a booking is created (via agent, API, or public booking page), SnapServe creates a Google Calendar event in the linked calendar.</li>
        <li>When computing available slots, SnapServe fetches busy times from Google Calendar and blocks them off — so if you have a team meeting from 2–3 PM, no booking slot will be offered in that window.</li>
        <li>Meeting links (Google Meet) are generated automatically if your Google account has Meet enabled.</li>
      </ol>

      <h2 id="connecting">Connecting a Google account</h2>
      <ol>
        <li>Go to <strong>Scheduling → Calendars</strong>.</li>
        <li>Open or create a calendar.</li>
        <li>Click <strong>Connect Google Account</strong>.</li>
        <li>Complete the Google OAuth consent screen. SnapServe requests:
          <ul>
            <li><code>calendar.events</code> — to create and read events</li>
            <li><code>calendar.readonly</code> — to read free/busy information</li>
          </ul>
        </li>
        <li>After connecting, select which of your Google Calendars to sync (you may have multiple — Personal, Work, etc.).</li>
        <li>Save. The calendar is now linked.</li>
      </ol>
      <p>
        You can connect multiple Google accounts. Each SnapServe calendar can be mapped to a
        specific Google account and calendar — allowing you to separate different use cases across
        Google Calendars.
      </p>

      <h2 id="event-creation">What gets created in Google Calendar</h2>
      <p>When a booking is confirmed, SnapServe creates a Google Calendar event with:</p>
      <ul>
        <li><strong>Title</strong> — event type name + attendee name (e.g. "30-min Demo — Priya Sharma")</li>
        <li><strong>Start and end time</strong> — booking time + duration in the calendar's timezone</li>
        <li><strong>Attendee email</strong> — attendee is invited to the event and receives a Google Calendar notification</li>
        <li><strong>Description</strong> — includes booking confirmation ID and any notes passed during booking</li>
        <li><strong>Google Meet link</strong> — auto-generated conference link (if Google Meet is enabled on the account)</li>
      </ul>

      <h2 id="busy-blocking">Busy slot blocking</h2>
      <p>
        When a user requests available slots via the booking page or the <code>check_availability</code>
        tool, SnapServe calls the Google Calendar free/busy API to fetch all busy windows for the
        requested date. Any window that overlaps with an existing event is excluded from the
        available slots returned to the caller.
      </p>
      <p>
        This means if you accept an external meeting via any other tool (LinkedIn meeting, Calendly,
        etc.) and it appears on your Google Calendar, SnapServe will automatically honour it and
        not double-book that slot.
      </p>

      <h2 id="multiple-accounts">Multiple Google accounts</h2>
      <p>
        SnapServe supports multiple Google account connections per user. This is useful when:
      </p>
      <ul>
        <li>You have separate personal and work Google accounts</li>
        <li>You manage calendars on behalf of other team members</li>
        <li>You want different event types to sync to different Google Calendars</li>
      </ul>
      <p>
        Each SnapServe calendar can be assigned to a specific connected Google account via
        <strong>Scheduling → Calendars → Google Connection</strong>.
      </p>

      <h2 id="token-refresh">Token management</h2>
      <p>
        Google OAuth tokens expire after one hour. SnapServe automatically refreshes access tokens
        using the stored refresh token — no action is required from you. Tokens are encrypted at
        rest using AES-256-GCM.
      </p>
      <p>
        If a refresh fails (e.g. the user revoked access via Google's security page), the calendar
        connection is marked as disconnected. SnapServe will continue accepting bookings but will
        not create Google Calendar events or check free/busy until reconnected.
      </p>

      <h2 id="reconnecting">Reconnecting or revoking</h2>
      <ul>
        <li>
          <strong>Reconnect:</strong> Go to Scheduling → Calendars, open the calendar, and click{" "}
          <strong>Reconnect Google Account</strong>. Complete the OAuth flow again.
        </li>
        <li>
          <strong>Disconnect:</strong> Go to Scheduling → Google Connections and click Delete on the
          connection. This removes SnapServe's access token. The calendar continues to function
          without Google Calendar sync.
        </li>
        <li>
          <strong>Full revocation:</strong> Visit <code>myaccount.google.com/permissions</code> and
          revoke SnapServe's access. Then reconnect from the Scheduling page if desired.
        </li>
      </ul>

      <h2 id="api">API endpoints</h2>
      <CodeBlock language="text" code={`# List connected Google accounts
GET /api/scheduling/google/connections

# Initiate OAuth connection
GET /api/scheduling/google/connect

# OAuth callback (handled automatically)
GET /api/scheduling/google/callback

# Remove a Google account connection
DELETE /api/scheduling/google/connections/:connectionId

# List available Google Calendars for a connected account
GET /api/scheduling/google/calendar-links

# Assign a Google account to a SnapServe calendar
PATCH /api/scheduling/calendars/:id/google-connection
Body: { "googleCalendarConnectionId": "conn_abc123" }`} />
    </div>
  );
}
