import { PageHeader } from "../DocsUi";

export default function ChangelogPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Reference"
        title="Changelog"
        description="Notable documentation and API-consumer changes."
      />

      <h2 id="2026-08-10-builder-analytics">2026-08-10 — Analytics inside Agent Builder</h2>
      <ul>
        <li>
          Agent Builder top-level <strong>Analytics</strong> tab — call volume, success, spend, latency
          for that agent (same data as <code>/app/analytics/agents/:id</code>).
        </li>
        <li>
          Settings → former Analytics sub-tab remains <strong>Webhooks</strong> (CRM post-call URL only).
        </li>
      </ul>

      <h2 id="2026-08-10-analytics-nav">2026-08-10 — Analytics in primary nav</h2>
      <ul>
        <li>
          Platform <strong>Analytics</strong> moved from sidebar More into the primary nav (with History).
        </li>
        <li>
          Agent Settings sub-tab renamed <strong>Webhooks</strong> (was mislabeled Analytics) so it
          does not collide with platform Analytics.
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
