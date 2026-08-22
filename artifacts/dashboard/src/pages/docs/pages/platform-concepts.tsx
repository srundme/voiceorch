import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function PlatformConceptsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Get started"
        title="Platform concepts"
        description="Who owns what — agents, campaigns, connections, dispositions, squads, and meetings."
      />

      <Callout variant="tip">
        Short rule: the <strong>agent</strong> owns the conversation and messages; the{" "}
        <strong>campaign</strong> owns the lead list and dial; <strong>Connections</strong> wires
        the outside world.
      </Callout>

      <h2 id="jarvis">Jarvis</h2>
      <p>
        In-app support on the dashboard. Speak or type; Jarvis reads agents, numbers, campaigns,
        and wallet, then recommends the next step and can do confirmable jobs.{" "}
        <Link href="/docs/jarvis">Jarvis guide</Link>.
      </p>

      <h2 id="agent">Agent</h2>
      <p>
        A voice persona: system prompt, greeting, language, ASR/LLM/TTS (or BYOP), tools, knowledge
        base, phone number, variables, <strong>Outcomes / dispositions</strong>,{" "}
        <strong>after-call WhatsApp &amp; email rules</strong>, and optional{" "}
        <Link href="/docs/meetings">meeting</Link> settings. Create in{" "}
        <Link href="/docs/vibe">Vibe</Link> or configure in{" "}
        <a href="https://app.snapserve.ai/app/agents" target="_blank" rel="noreferrer">
          Agents
        </a>
        . Toggle <strong>active</strong> before production calls.
      </p>

      <h2 id="campaign">Campaign</h2>
      <p>
        Outbound dialing at scale: lead sources (CSV, Sheets, Website, Meta, CRM), queue, retries,
        calling hours, and <strong>lead transfer</strong> (push matching dispositions to a webhook
        or Google Sheet). Messaging after the call is configured on the{" "}
        <strong>agent</strong>, not the campaign.{" "}
        <Link href="/docs/campaigns">Campaigns guide</Link>.
      </p>

      <h2 id="connections">Connections</h2>
      <p>
        Hub for wires used by agents and campaigns: WhatsApp, Email (Brevo), Google Sheets, Website
        form, Meta Lead Ads, Calendar &amp; booking, and Meetings entry.{" "}
        <Link href="/docs/connections">Connections guide</Link> ·{" "}
        <Link href="/docs/whatsapp">WhatsApp</Link>.
      </p>

      <h2 id="disposition">Disposition / Outcomes</h2>
      <p>
        After each call, AI picks an outcome from the agent’s taxonomy and fills data fields you
        define. Map labels to funnel meanings (Interested / Callback / DNC) for analytics. Set under
        Agent Builder → <strong>After the call</strong>.
      </p>

      <h2 id="after-call">After-call messages</h2>
      <p>
        Agent-owned WhatsApp / email rules: every call, or only for matching dispositions.
        Connect WhatsApp and email under <strong>Connections</strong>, then pick the Meta
        template per outcome on <strong>After the call</strong>.
        Campaigns no longer map WA/email branches — they only{" "}
        <strong>transfer leads</strong>.
      </p>

      <h2 id="lead-transfer">Lead transfer</h2>
      <p>
        Campaign Configuration → when disposition matches, POST the lead to a webhook and/or append
        to a Google Sheet. Use this for CRM / ops handoff — not for customer messaging.
      </p>

      <h2 id="squad">Squad</h2>
      <p>
        Multi-agent team: mid-call live handoff (<code>transfer_to_*</code>) and follow-up tasks for
        a later outbound. Callback <em>disposition</em> means “call later”; it is not automatically
        a live handoff.
      </p>

      <h2 id="meeting">Meeting</h2>
      <p>
        Same agent inside Google Meet / Zoom / Teams. Join via paste link, calendar Join toggles, or
        booking auto-dispatch. <Link href="/docs/meetings">Meetings guide</Link>.
      </p>

      <h2 id="call">Call</h2>
      <p>
        One phone (or meeting) conversation. SnapServe stores status, duration, cost, transcript,
        summary, evaluation, and disposition. Retrieve with{" "}
        <Link href="/docs/api-reference/getCall">GET /calls/{"{id}"}</Link> or listen on webhooks.
      </p>

      <h2 id="phone">Phone number</h2>
      <p>
        Caller ID outbound and DID inbound. India numbers need KYC.{" "}
        <Link href="/docs/phone-numbers">Phone numbers guide</Link>.
      </p>

      <h2 id="wallet">Wallet</h2>
      <p>
        Prepaid INR balance. Usage deducts per minute.{" "}
        <Link href="/docs/wallet">Wallet</Link>.
      </p>

      <h2 id="variables">Variables</h2>
      <p>
        Placeholders like <code>{"{{customer_name}}"}</code> in the prompt, filled per call.{" "}
        <Link href="/docs/variables">Variables</Link>.
      </p>

      <h2 id="tools">Tools</h2>
      <p>
        Functions mid-conversation (book slot, transfer, HTTP webhook, meeting controls). Configured
        in the agent builder <strong>Actions</strong> tab. Connect WhatsApp, email, and
        Google Calendar under <strong>Connections</strong>, then pick the template or
        meeting on the agent.
      </p>

      <h2 id="knowledge">Knowledge base</h2>
      <p>
        Documents the agent can search during a call (RAG).{" "}
        <Link href="/docs/knowledge-base">Knowledge base</Link>.
      </p>

      <h2 id="webhooks">Event subscriptions &amp; related URLs</h2>
      <p>
        Do not confuse these four jobs that all used to say “webhook”:
      </p>
      <ul>
        <li>
          <strong>Event subscriptions</strong> — Developers → workspace-wide call events.{" "}
          <Link href="/docs/webhooks">Guide</Link>.
        </li>
        <li>
          <strong>Post-call notify</strong> — Agent Builder → Settings → notify URL for that agent only.
        </li>
        <li>
          <strong>Form intake</strong> — Connections / Campaigns → website form POSTs leads into SnapServe.
        </li>
        <li>
          <strong>Lead transfer</strong> — Campaign Configuration → push matching dispositions to CRM / Sheets.
        </li>
      </ul>

      <h2 id="api-key">API key</h2>
      <p>
        <code>sk_live_…</code> for server-to-server REST. Create under{" "}
        <a href="https://app.snapserve.ai/app/api-keys" target="_blank" rel="noreferrer">
          API Keys
        </a>
        . <Link href="/docs/authentication">Authentication</Link>. Meeting bot launch typically uses
        a logged-in session (dashboard) — see{" "}
        <Link href="/docs/api-reference">API Reference → Meetings</Link>.
      </p>
    </div>
  );
}
