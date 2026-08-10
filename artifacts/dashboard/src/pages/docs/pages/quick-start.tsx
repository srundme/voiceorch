import { Link } from "wouter";
import { Callout, LanguageTabs, PageHeader, ParamsTable } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function QuickStartPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Overview"
        title="Quick Start"
        description="Authenticate, list agents, and start an outbound call from your backend in a few minutes."
        copyText={`curl https://app.snapserve.ai/api/agents -H "Authorization: Bearer $SNAPSERVE_API_KEY"
curl -X POST https://app.snapserve.ai/api/calls/outbound -H "Authorization: Bearer $SNAPSERVE_API_KEY" -H "Content-Type: application/json" -d '{"agentId":123,"toNumber":"+919876543210"}'`}
      />

      <h2 id="prerequisites">Prerequisites</h2>
      <ul>
        <li>
          Active <strong>agent</strong> (create one in the dashboard).
        </li>
        <li>
          API key — <Link href="/docs/authentication">Authentication</Link>.
        </li>
        <li>Wallet balance (₹500 welcome credit on signup).</li>
      </ul>

      <Callout variant="tip" title="Tip">
        Prefer webhooks over polling for production — see{" "}
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
        Pick an agent with <code>status: "active"</code>.
      </p>

      <h2 id="2-outbound">2. Place an outbound call</h2>
      <ParamsTable
        rows={[
          { name: "agentId", type: "integer", required: true, description: "Active agent ID from list/create" },
          { name: "toNumber", type: "string", required: true, description: "Destination in E.164 (e.g. +919876543210)" },
        ]}
      />
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
    "Authorization": \`Bearer \${process.env.SNAPSERVE_API_KEY}\`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    agentId: 123,
    toNumber: "+919876543210"
  })
});

const call = await response.json();
console.log("Call initiated ID:", call.id);`,
          },
          {
            label: "Python",
            language: "python",
            code: `import os
import json
import urllib.request

req = urllib.request.Request(
    "https://app.snapserve.ai/api/calls/outbound",
    data=json.dumps({"agentId": 123, "toNumber": "+919876543210"}).encode("utf-8"),
    headers={
        "Authorization": f"Bearer {os.environ['SNAPSERVE_API_KEY']}",
        "Content-Type": "application/json"
    },
    method="POST"
)

with urllib.request.urlopen(req) as resp:
    call = json.loads(resp.read().decode("utf-8"))
    print("Call ID:", call["id"])`,
          },
        ]}
      />
      <CodeBlock
        language="json"
        code={`{
  "id": 456,
  "status": "initiated",
  "agentId": 123,
  "toNumber": "+919876543210"
}`}
      />

      <h2 id="3-result">3. Get the result</h2>
      <p>
        Poll <code>GET /calls/{"{id}"}</code> or register for <code>call.completed</code>. Full
        guide: <Link href="/docs/outbound-calls">Outbound Calls</Link>.
      </p>

      <h2 id="install-sdks">API Client Wrappers</h2>
      <p>
        Copy ready-to-use client wrapper classes for TypeScript, Python, and Go:{" "}
        <Link href="/docs/sdks">API Wrappers & SDKs</Link>. Full OpenAPI interactive schemas:{" "}
        <Link href="/docs/api-reference">API Reference</Link>.
      </p>
    </div>
  );
}
