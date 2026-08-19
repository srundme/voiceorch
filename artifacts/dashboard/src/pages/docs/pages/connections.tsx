import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function ConnectionsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Connect & channels"
        title="Connections"
        updated="18 Aug 2026"
        description="One hub for the outside world: messaging, lead intake, calendar, and meetings. Agents own conversation rules; campaigns own the lead list."
      />

      <p>
        Open{" "}
        <a href="https://app.snapserve.ai/app/connections" target="_blank" rel="noreferrer">
          Connections
        </a>
        . Vibe’s Connect tab embeds the same hub.
      </p>

      <h2 id="cards">What lives here</h2>
      <ul>
        <li>
          <strong>WhatsApp</strong> — own WABA / Vobiz channel or webhook-only BSP.{" "}
          <Link href="/docs/whatsapp">WhatsApp guide</Link>.
        </li>
        <li>
          <strong>Email (Brevo)</strong> — email only, not WhatsApp. Paste a Brevo API key and a
          verified From address, then enable Send Email on the agent.
        </li>
        <li>
          <strong>Google Sheets</strong> — campaign lead source and/or lead-transfer destination.
        </li>
        <li>
          <strong>Website form</strong> — form POSTs into SnapServe as leads (form intake).
        </li>
        <li>
          <strong>Meta Lead Ads</strong> — Facebook / Instagram leads into a campaign.
        </li>
        <li>
          <strong>Bookings calendar</strong> — Google Calendar or SnapServe scheduling.{" "}
          <Link href="/docs/calendar">Calendar guide</Link>.
        </li>
        <li>
          <strong>Meetings</strong> — Meet / Zoom / Teams bots.{" "}
          <Link href="/docs/meetings">Meetings guide</Link>.
        </li>
      </ul>

      <Callout variant="info" title="Four things people used to call “webhook”">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Event subscriptions</strong> — workspace call events.{" "}
            <Link href="/docs/webhooks">Guide</Link>.
          </li>
          <li>
            <strong>Post-call notify</strong> — Agent Settings URL for that agent only.
          </li>
          <li>
            <strong>Form intake</strong> — website form → SnapServe leads.
          </li>
          <li>
            <strong>Lead transfer</strong> — campaign pushes matching dispositions to CRM / Sheets.
          </li>
        </ul>
      </Callout>

      <h2 id="ownership">Who owns what</h2>
      <p>
        After-call WhatsApp and email rules sit on the <strong>agent Outcomes</strong> tab.
        Campaigns dial and transfer leads. Connecting a channel here does not send messages until
        the agent (or inbound WhatsApp chatbot) is configured.
      </p>
    </div>
  );
}
