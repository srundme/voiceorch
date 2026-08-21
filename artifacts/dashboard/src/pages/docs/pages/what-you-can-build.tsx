import { Link } from "wouter";
import { PageHeader } from "../DocsUi";

export default function WhatYouCanBuildPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Get started"
        title="What you can build"
        description="SnapServe runs the live phone conversation. Your product owns UI, leads, CRM, and business logic."
      />

      <h2 id="vibe">Vibe (fastest first agent)</h2>
      <p>
        Describe the business in chat. Vibe writes the prompt and stays open as a studio (Chat,
        Agent, Connect, Test). <Link href="/docs/vibe">Vibe builder</Link>.
      </p>

      <h2 id="inbound">Inbound voice assistants</h2>
      <p>
        Buy or bring a number, assign it to an agent, and answer customers 24/7 — appointments,
        support, FAQs — with tools that check calendars or create tickets.
      </p>

      <h2 id="outbound">Outbound dialers &amp; workflows</h2>
      <p>
        Trigger <code>POST /calls/outbound</code> from your backend when a lead fills a form, a
        deal moves stage, or a reminder is due. Get transcript + summary back via webhooks.
      </p>

      <h2 id="booking">Booking agents</h2>
      <p>
        Connect Google Calendar (or SnapServe scheduling), put booking tools on the agent, and let
        callers schedule themselves. See <Link href="/docs/calendar">Calendar &amp; booking</Link>.
      </p>

      <h2 id="campaigns">Campaigns (dashboard)</h2>
      <p>
        Batch-dial CSV / Sheets / website / Meta leads with retries, dispositions, and lead
        transfer to webhook or Sheets. After-call WhatsApp/email rules live on the agent. See{" "}
        <Link href="/docs/campaigns">Campaigns</Link>.
      </p>

      <h2 id="whatsapp">WhatsApp chatbot &amp; calling</h2>
      <p>
        After-call templates, inbound AI text replies, or 1:1 WhatsApp voice — not a bulk WhatsApp
        campaign. <Link href="/docs/whatsapp">WhatsApp guide</Link>.
      </p>

      <h2 id="meetings">Meeting agents</h2>
      <p>
        Send the same agent into Google Meet, Zoom, or Teams — paste a link, auto-join calendar
        events, or dispatch from bookings. In-meeting tools cover leave, mute, chat, and slides.{" "}
        <Link href="/docs/meetings">Meetings guide</Link>.
      </p>

      <h2 id="embed">Apps on top of the API</h2>
      <ul>
        <li>
          Website voice widget — copy per-agent embed code from Settings → Website.{" "}
          <Link href="/docs/website-embed">Website webcall embed</Link>
        </li>
        <li>Custom CRM dialer UI</li>
        <li>Internal “call this contact” buttons</li>
        <li>Zapier-style automations / n8n workflows</li>
        <li>Post-call analytics from transcript + disposition</li>
      </ul>

      <h2 id="next">Next</h2>
      <p>
        Learn the building blocks in <Link href="/docs/platform-concepts">Platform concepts</Link>,
        then configure an agent in the{" "}
        <Link href="/docs/agents">dashboard builder</Link> or jump to{" "}
        <Link href="/docs/quick-start">Quick Start (API)</Link>.
      </p>
    </div>
  );
}
