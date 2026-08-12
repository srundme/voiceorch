import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function MeetingsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Product guides"
        title="Meeting agents"
        description="Send a SnapServe agent into Google Meet, Zoom, or Microsoft Teams — paste a link, auto-join calendar events, or dispatch from bookings."
      />

      <h2 id="overview">What meetings are</h2>
      <p>
        A <strong>meeting agent</strong> is the same agent brain as phone calls, running inside a
        video room via a Recall.ai bot. Configure a meeting prompt (and optional slide deck) on the
        agent, then join from{" "}
        <a href="https://app.snapserve.ai/app/meet" target="_blank" rel="noreferrer">
          Meetings
        </a>{" "}
        (<code>/app/meet</code>).
      </p>
      <Callout variant="tip">
        Meetings do not replace Campaigns. Campaigns dial phone leads; Meetings join a video URL
        that already exists.
      </Callout>

      <h2 id="enable">Enable on an agent</h2>
      <ol>
        <li>Open the agent in the Builder.</li>
        <li>Turn on Meetings / Phone+meetings and set a <strong>meeting prompt</strong>.</li>
        <li>
          Optional: bot display name, duration, silence timeout, mute-when-idle, presentation URL,
          auto-start slides, who joins (self vs delegate agent).
        </li>
        <li>The agent appears on the Meetings page.</li>
      </ol>

      <h2 id="join-paths">Three join paths</h2>
      <table>
        <thead>
          <tr>
            <th>Path</th>
            <th>Where</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Paste link</td>
            <td>
              <code>/app/meet</code>
            </td>
            <td>Ad-hoc join now</td>
          </tr>
          <tr>
            <td>Google Calendar (AI meetings)</td>
            <td>
              <code>/app/meet</code> → Connect Google → Join toggles
            </td>
            <td>Auto-join upcoming events</td>
          </tr>
          <tr>
            <td>Booking auto-dispatch</td>
            <td>Scheduling / bookings with a Meet link</td>
            <td>Bot joins near the slot</td>
          </tr>
        </tbody>
      </table>
      <Callout variant="warn">
        <strong>Two Google Calendar connects.</strong> Connections → Bookings calendar creates
        booking events (write). Meeting bots → Connect Google is readonly for AI meeting join. Do
        not treat them as the same button.
      </Callout>

      <h2 id="in-meeting">In-meeting capabilities</h2>
      <p>When the agent is inside a meeting, these tools are available:</p>
      <ul>
        <li>
          <code>leave_meeting</code> — exit cleanly
        </li>
        <li>
          <code>mute_meeting</code> / <code>unmute_meeting</code>
        </li>
        <li>
          <code>send_meeting_chat</code> — optional pin
        </li>
        <li>
          <code>start_presentation</code>, <code>stop_presentation</code>, <code>next_slide</code>,{" "}
          <code>previous_slide</code>, <code>goto_slide</code>
        </li>
        <li>
          <code>schedule_meet_rejoin</code> — rejoin the same URL later
        </li>
      </ul>
      <p>Hosts may need to <strong>admit</strong> the bot from the Meet waiting room.</p>

      <h2 id="api">Meetings API</h2>
      <p>
        Session-authenticated endpoints are listed in the API Reference under{" "}
        <strong>Meetings</strong>:
      </p>
      <ul>
        <li>
          <Link href="/docs/api-reference/createMeetBot">POST /meet-bots</Link> — launch
        </li>
        <li>
          <Link href="/docs/api-reference/getMeetBot">GET /meet-bots/{"{botId}"}</Link> — status
        </li>
        <li>
          <Link href="/docs/api-reference/leaveMeetBot">DELETE /meet-bots/{"{botId}"}</Link> — leave
        </li>
        <li>
          <Link href="/docs/api-reference/getMeetBotIdentity">GET /meet-bots/identity</Link>
        </li>
        <li>
          <Link href="/docs/api-reference/getMeetCalendarConnection">
            GET /meet-calendar/connection
          </Link>
        </li>
        <li>
          <Link href="/docs/api-reference/listMeetCalendarEvents">GET /meet-calendar/events</Link>
        </li>
        <li>
          <Link href="/docs/api-reference/enableMeetCalendarEventBot">
            POST /meet-calendar/events/{"{eventId}"}/bot
          </Link>
        </li>
        <li>
          <Link href="/docs/api-reference/disableMeetCalendarEventBot">
            DELETE /meet-calendar/events/{"{eventId}"}/bot
          </Link>
        </li>
      </ul>

      <h2 id="related">Related</h2>
      <ul>
        <li>
          <Link href="/docs/platform-concepts">Platform concepts</Link> — who owns what
        </li>
        <li>
          <Link href="/docs/agents">Agents &amp; builder</Link> — Outcomes &amp; prompts
        </li>
        <li>
          <Link href="/docs/calendar">Bookings calendar</Link> — booking write path
        </li>
        <li>
          <Link href="/docs/campaigns">Campaigns</Link> — phone dialing at scale
        </li>
      </ul>
    </div>
  );
}
