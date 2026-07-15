import { PageHeader } from "../DocsUi";

export default function ChangelogPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Reference"
        title="Changelog"
        description="Notable documentation and API-consumer changes."
      />

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
