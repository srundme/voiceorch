import { Link } from "wouter";
import { PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function SdksPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Reference"
        title="SDKs"
        description="Official clients wrap the REST API. Set apiKey to your sk_live_ key. Default base URL: https://app.snapserve.ai/api."
        copyText={`npm install @snapserve/sdk
pip install snapserve`}
      />

      <h2 id="node">Node.js — @snapserve/sdk</h2>
      <CodeBlock language="bash" code={`npm install @snapserve/sdk`} />
      <CodeBlock
        language="javascript"
        code={`import { SnapServe } from "@snapserve/sdk";

const client = new SnapServe({
  apiKey: process.env.SNAPSERVE_API_KEY,
  // baseUrl: "https://app.snapserve.ai/api", // optional
});

const agents = await client.agents.list();
const call = await client.calls.outbound({
  agentId: agents[0].id,
  toNumber: "+919876543210",
});

// Escape hatch for any path
await client.request("GET", "/wallet");`}
      />
      <p>
        Typed helpers typically cover: agents, calls, phoneNumbers, webhookEndpoints, wallet,
        account, analytics.
      </p>

      <h2 id="python">Python — snapserve</h2>
      <CodeBlock language="bash" code={`pip install snapserve`} />
      <CodeBlock
        language="python"
        code={`import os
from snapserve import SnapServe

client = SnapServe(api_key=os.environ["SNAPSERVE_API_KEY"])
agents = client.agents.list()
call = client.calls.outbound(
    agent_id=agents[0]["id"],
    to_number="+919876543210",
)
wallet = client.request("GET", "/wallet")`}
      />

      <h2 id="curl">Prefer curl first</h2>
      <p>
        When debugging auth or payloads, use the <Link href="/docs/quick-start">Quick Start</Link>{" "}
        curl examples, then port working requests into the SDK.
      </p>

      <h2 id="reference">OpenAPI</h2>
      <p>
        Interactive schemas: <Link href="/docs/api-reference">API Reference</Link>.
      </p>
    </div>
  );
}
