import { Link } from "wouter";
import { Callout, LanguageTabs, PageHeader, ParamsTable } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function QuickStartPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Get started"
        title="Quick Start (API)"
        updated="18 Aug 2026"
        description="From a backend: authenticate, list agents, place one outbound PSTN call, then read transcript and summary. Campaigns stay in the dashboard."
        copyText={`export SNAPSERVE_API_KEY=sk_live_YOUR_KEY
curl https://app.snapserve.ai/api/agents -H "Authorization: Bearer $SNAPSERVE_API_KEY"
curl -X POST https://app.snapserve.ai/api/calls/outbound \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" -H "Content-Type: application/json" \\
  -d '{"agentId":123,"toNumber":"+919876543210"}'`}
      />

      <h2 id="prerequisites">Prerequisites</h2>
      <ul>
        <li>
          An <strong>active</strong> agent — create in <Link href="/docs/vibe">Vibe</Link> or the{" "}
          <Link href="/docs/agents">builder</Link>.
        </li>
        <li>
          A <code>sk_live_…</code> key — <Link href="/docs/authentication">Authentication</Link>.
          Never put it in a browser.
        </li>
        <li>
          Wallet balance (₹500 welcome credit). Empty wallet → <code>402</code>.
        </li>
        <li>
          A from-number on the agent (SnapServe DID or your Twilio/Plivo/Vobiz creds). India DIDs
          need KYC. <Link href="/docs/phone-numbers">Phone numbers</Link>.
        </li>
      </ul>

      <Callout variant="tip" title="Production">
        Register <code>call.completed</code> instead of polling —{" "}
        <Link href="/docs/webhooks">Event subscriptions</Link>.
      </Callout>

      <h2 id="1-list-agents">1. List agents</h2>
      <CodeBlock
        language="bash"
        code={`export SNAPSERVE_API_KEY=sk_live_YOUR_KEY

curl https://app.snapserve.ai/api/agents \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />
      <CodeBlock
        language="json"
        code={`[
  {
    "id": 123,
    "name": "Support desk",
    "status": "active",
    "language": "en-IN"
  }
]`}
      />
      <p>
        Use an agent with <code>status: "active"</code>. Draft agents may still dial; do not rely on
        that in production.
      </p>

      <h2 id="2-wallet">2. Confirm wallet (optional)</h2>
      <CodeBlock
        language="bash"
        code={`curl https://app.snapserve.ai/api/wallet \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />
      <p>
        <code>balanceCents</code> is paise. <code>50000</code> = ₹500 ≈ 100 minutes at ₹5/min.{" "}
        <Link href="/docs/pricing">Pricing</Link>.
      </p>

      <h2 id="3-outbound">3. Place an outbound call</h2>
      <ParamsTable
        rows={[
          { name: "agentId", type: "integer", required: true, description: "Agent you own" },
          { name: "toNumber", type: "string", required: true, description: "Destination E.164, e.g. +919876543210" },
          {
            name: "webhookBaseUrl",
            type: "string",
            description: "Rare: override public base URL for telephony callbacks. Omit in production.",
          },
        ]}
      />
      <Callout variant="warn" title="No variables on this endpoint">
        The public body is only <code>agentId</code>, <code>toNumber</code>, and optional{" "}
        <code>webhookBaseUrl</code>. Extra JSON fields are ignored. Per-lead{" "}
        <code>{"{{customer_name}}"}</code> injection is a <Link href="/docs/campaigns">campaign</Link>{" "}
        field-mapping feature, not this API. Put stable facts in the agent prompt, or run a campaign.
      </Callout>
      <LanguageTabs
        tabs={[
          {
            label: "cURL",
            language: "bash",
            code: `curl -X POST https://app.snapserve.ai/api/calls/outbound \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": 123,
    "toNumber": "+919876543210"
  }'`,
          },
          {
            label: "Node / TypeScript",
            language: "typescript",
            code: `const response = await fetch("https://app.snapserve.ai/api/calls/outbound", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SNAPSERVE_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ agentId: 123, toNumber: "+919876543210" }),
});
if (!response.ok) {
  throw new Error(\`\${response.status} \${await response.text()}\`);
}
const call = await response.json();
console.log("Call ID:", call.id, call.status);`,
          },
          {
            label: "Python",
            language: "python",
            code: `import json, os, urllib.request, urllib.error

req = urllib.request.Request(
    "https://app.snapserve.ai/api/calls/outbound",
    data=json.dumps({"agentId": 123, "toNumber": "+919876543210"}).encode(),
    headers={
        "Authorization": f"Bearer {os.environ['SNAPSERVE_API_KEY']}",
        "Content-Type": "application/json",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req) as resp:
        call = json.loads(resp.read().decode())
        print("Call ID:", call["id"], call["status"])
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode())`,
          },
        ]}
      />
      <CodeBlock
        language="json"
        code={`{
  "id": 456,
  "status": "initiated",
  "agentId": 123,
  "toNumber": "+919876543210",
  "fromNumber": "+917971543255"
}`}
      />
      <p>Common failures:</p>
      <ul>
        <li>
          <code>401</code> — missing/invalid key
        </li>
        <li>
          <code>402</code> — wallet empty
        </li>
        <li>
          <code>403</code> — IRDAI prompt incomplete, TRAI quiet hours / DNC, or KYC required for
          own Vobiz
        </li>
        <li>
          <code>404</code> — agent or telephony provider missing
        </li>
      </ul>

      <h2 id="4-result">4. Get the result</h2>
      <p>
        Poll until <code>status</code> is terminal (<code>completed</code>, <code>failed</code>,{" "}
        <code>no_pickup</code>, …), or handle <code>call.completed</code> on your webhook.
      </p>
      <LanguageTabs
        tabs={[
          {
            label: "cURL",
            language: "bash",
            code: `curl https://app.snapserve.ai/api/calls/456 \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`,
          },
          {
            label: "Node / TypeScript",
            language: "typescript",
            code: `const res = await fetch("https://app.snapserve.ai/api/calls/456", {
  headers: { Authorization: \`Bearer \${process.env.SNAPSERVE_API_KEY}\` },
});
const call = await res.json();
console.log(call.status, call.callSummary, call.costCents);`,
          },
          {
            label: "Python",
            language: "python",
            code: `import json, os, urllib.request
req = urllib.request.Request(
    "https://app.snapserve.ai/api/calls/456",
    headers={"Authorization": f"Bearer {os.environ['SNAPSERVE_API_KEY']}"},
)
with urllib.request.urlopen(req) as resp:
    call = json.loads(resp.read().decode())
    print(call["status"], call.get("callSummary"), call.get("costCents"))`,
          },
        ]}
      />
      <CodeBlock
        language="json"
        code={`{
  "id": 456,
  "agentId": 123,
  "status": "completed",
  "toNumber": "+919876543210",
  "fromNumber": "+917971543255",
  "durationSeconds": 84,
  "costCents": 700,
  "transcript": "Agent: Hello…",
  "callSummary": "Caller asked about clinic hours.",
  "dispositionResult": "Interested",
  "recordingUrl": "https://…"
}`}
      />
      <p>
        <code>costCents</code> is paise (700 = ₹7.00). Full field list:{" "}
        <Link href="/docs/outbound-calls">Calls &amp; history</Link> ·{" "}
        <Link href="/docs/api-reference/getCall">GET /calls/{"{id}"}</Link>.
      </p>

      <h2 id="next">Next</h2>
      <ul>
        <li>
          <Link href="/docs/webhooks">Verify webhook signatures</Link>
        </li>
        <li>
          Official SDK: <code>npm install @snapserveai/sdk</code> —{" "}
          <Link href="/docs/sdks">API Wrappers &amp; SDKs</Link>
        </li>
        <li>
          Batch dialing: <Link href="/docs/campaigns">Campaigns</Link> (dashboard, not this API)
        </li>
      </ul>
    </div>
  );
}
