import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function CampaignsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Product guides"
        title="Campaigns"
        description="Dashboard auto-dialer: upload leads, dial in batches, retry, and capture dispositions — no custom dialer required."
      />

      <Callout variant="info">
        Building your own product? Prefer <Link href="/docs/quick-start">outbound API calls</Link>{" "}
        + your CRM. Campaigns are best for in-house sales ops on SnapServe UI.
      </Callout>

      <h2 id="flow">Typical flow</h2>
      <ol>
        <li>Create a campaign from a source (CSV, Sheets, Website, Meta, CRM) and pick an active agent + phone number.</li>
        <li>Map columns / fields to variables when uploading.</li>
        <li>Start / activate; SnapServe paces concurrent dials from your wallet.</li>
        <li>Review live queue, dispositions, callbacks, and recordings in the workspace.</li>
      </ol>

      <h2 id="ownership">What campaigns own</h2>
      <ul>
        <li>
          <strong>Lead transfer</strong> — Configuration tab: when disposition matches, push the lead
          to a webhook and/or Google Sheet.
        </li>
        <li>
          Dial queue, retries, calling hours, analytics slices (export / transfer / create batch).
        </li>
      </ul>
      <p>
        WhatsApp / email after a call are configured on the{" "}
        <strong>agent</strong> (Builder → Outcomes → After-call messages), with channels under{" "}
        <a href="https://app.snapserve.ai/app/connections" target="_blank" rel="noreferrer">
          Connections
        </a>
        . See <Link href="/docs/platform-concepts">Platform concepts</Link>.
      </p>

      <h2 id="compliance">Compliance</h2>
      <p>
        Indian telephony may enforce quiet hours and KYC for numbers. Keep consent for outbound
        marketing dials. DNC lists can be managed in the campaign tools.
      </p>

      <h2 id="api">API note</h2>
      <p>
        Campaign REST endpoints exist for advanced automation but are intentionally{" "}
        <strong>not</strong> featured in the public API Reference (too product-specific). Use the
        dashboard, or dial individually with{" "}
        <Link href="/docs/api-reference/initiateOutboundCall">POST /calls/outbound</Link>.
      </p>
    </div>
  );
}
