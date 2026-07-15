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
        Batch-dial CSV leads with retries and dispositions without writing a dialer. Good for
        sales teams; API builders usually orchestrate calls from their own app instead. See{" "}
        <Link href="/docs/campaigns">Campaigns</Link>.
      </p>

      <h2 id="embed">Apps on top of the API</h2>
      <ul>
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
