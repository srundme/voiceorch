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
        <li>Create a campaign and pick an active agent + phone number.</li>
        <li>Upload leads (CSV) and map columns to variables.</li>
        <li>Start a batch; SnapServe paces concurrent dials from your wallet.</li>
        <li>Review live queue, dispositions, callbacks, and recordings in the workspace.</li>
      </ol>

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
