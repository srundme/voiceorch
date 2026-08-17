import { PageHeader } from "../DocsUi";

export default function ChangelogPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Reference"
        title="Changelog"
        description="Notable documentation and API-consumer changes."
      />

      <h2 id="2026-08-18-docs">2026-08-18 — Docs coverage for the live product</h2>
      <ul>
        <li>
          New guides: <strong>Vibe builder</strong>, <strong>WhatsApp</strong> (text, calling,
          Meta rules), <strong>Connections</strong>, <strong>Test an agent</strong>,{" "}
          <strong>Team workspace</strong>, <strong>Compliance</strong>.
        </li>
        <li>Sidebar grouped by job (build, connect, calls, account) with prev/next and search.</li>
        <li>
          Vibe builder chat uses managed <code>sarvam-105b</code> with high reasoning; live agents
          still default to <code>sarvam-105b-conversations</code>.
        </li>
        <li>
          Deepened <strong>Quick Start</strong>, <strong>Campaigns</strong>, and{" "}
          <strong>Pricing</strong> — WhatsApp paise rate card, campaign sources/pacing, and honest
          outbound API body (no <code>variables</code> field).
        </li>
      </ul>

      <h2 id="2026-08-10-webhook-names">2026-08-10 — Rename the four “webhook” surfaces</h2>
      <ul>
        <li>
          <strong>Event subscriptions</strong> — Developers (was “Webhooks”)
        </li>
        <li>
          <strong>Post-call notify</strong> — Agent Settings (was “Webhooks” / CRM webhook)
        </li>
        <li>
          <strong>Form intake</strong> — Campaigns / Connections website (was “form webhook”)
        </li>
        <li>
          <strong>Lead transfer</strong> — Campaign push to CRM URL / Sheets (label clarified)
        </li>
        <li>
          <strong>Mid-call HTTP</strong> — Agent Tools custom function
        </li>
      </ul>

      <h2 id="2026-08-10-builder-analytics">2026-08-10 — Analytics inside Agent Builder</h2>
      <ul>
        <li>
          Agent Builder top-level <strong>Analytics</strong> tab — call volume, success, spend, latency
          for that agent (same data as <code>/app/analytics/agents/:id</code>).
        </li>
        <li>
          Settings → former Analytics sub-tab is <strong>Post-call notify</strong> (CRM URL for that agent).
        </li>
      </ul>

      <h2 id="2026-08-10-analytics-nav">2026-08-10 — Analytics in primary nav</h2>
      <ul>
        <li>
          Platform <strong>Analytics</strong> moved from sidebar More into the primary nav (with History).
        </li>
      </ul>

      <h2 id="2026-08-10-outcomes-ux">2026-08-10 — Outcomes tab &amp; naming clarity</h2>
      <ul>
        <li>
          Agent Builder: top-level <strong>Outcomes</strong> tab (taxonomy + after-call messages) — no longer
          buried under Settings → Analytics.
        </li>
        <li>
          Naming: Bookings calendar vs Meeting bots; mid-call WhatsApp (Tools) vs after-call (Outcomes);
          display name ≠ spoken brand callout on Prompt.
        </li>
        <li>Squads: edit members in-app; Callback disposition ≠ live handoff callout.</li>
      </ul>

      <h2 id="2026-08-10-clarity">2026-08-10 — Product clarity, meetings, playbook</h2>
      <ul>
        <li>
          <strong>Platform concepts</strong> — agent vs campaign vs Connections vs Outcomes /
          after-call messages vs lead transfer vs squads vs meetings.
        </li>
        <li>
          <strong>Meetings guide</strong> — paste link, calendar Join, booking dispatch, in-meeting
          tools; API Reference tag <strong>Meetings</strong>.
        </li>
        <li>
          <strong>Agents / Campaigns guides</strong> — Outcomes + after-call on agent; lead transfer
          on campaign.
        </li>
        <li>
          <strong>Voiceathon playbook</strong> — rewritten for Connections hub, disposition dynamics,
          meetings, and current nav (see repo <code>docs/voiceathon-participant-playbook.md</code>).
        </li>
      </ul>

      <h2 id="2026-07-30-claude">2026-07-30 — Claude skill &amp; MCP</h2>
      <ul>
        <li>
          <strong>Docs</strong> — new guide{" "}
          <a href="/docs/claude-skill">Claude skill &amp; MCP</a> for Claude Desktop / Claude Code
          (agents, campaigns, website webhooks, and more via live tools).
        </li>
        <li>
          <strong>MCP</strong> — <code>@snapserve/mcp</code> (<code>lib/snapserve-mcp</code>) with
          <code>SNAPSERVE_API_KEY</code> against <code>https://app.snapserve.ai/api</code>.
        </li>
      </ul>

      <h2 id="2026-07-15-docs">2026-07-15 — Docs restructure</h2>
      <ul>
        <li>
          <strong>Learning guides</strong> — what you can build, platform concepts, agents builder,
          variables, knowledge base, calendar, campaigns, FAQ.
        </li>
        <li>
          <strong>Curated API Reference</strong> — Bolna-style public surface only (agents, calls /
          transcript+summary, variables, webhooks, phones, wallet, knowledge, scheduling). Campaigns
          and admin APIs hidden from the sidebar.
        </li>
        <li>
          <strong>API key auth</strong> — <code>Bearer sk_live_…</code> on the public API.
        </li>
        <li>
          <strong>INR billing</strong> — ₹500 welcome, ₹5/min, phones ₹800+GST, card only.
        </li>
      </ul>
    </div>
  );
}
