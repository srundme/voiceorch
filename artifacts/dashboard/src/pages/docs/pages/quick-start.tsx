import { CodeBlock } from "../CodeBlock";
import { Link } from "wouter";

export default function QuickStartPage() {
  return (
    <div>
      <h1>Quick Start</h1>
      <p>
        In about five minutes you will authenticate, list agents, and start an outbound call
        from your own backend.
      </p>

      <h2 id="prerequisites">Prerequisites</h2>
      <ul>
        <li>A SnapServe account with an <strong>active agent</strong> (create one in the dashboard).</li>
        <li>An API key (<code>sk_live_…</code>) — see <Link href="/docs/authentication">Authentication</Link>.</li>
        <li>Wallet balance (new accounts get ₹500 welcome credit).</li>
        <li>A verified destination number if your account requires destination OTP for test calls.</li>
      </ul>

      <h2 id="1-list-agents">1. List agents</h2>
      <CodeBlock
        language="bash"
        code={`export SNAPSERVE_API_KEY=sk_live_YOUR_KEY

curl https://app.snapserve.ai/api/agents \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />
      <p>Note an agent <code>id</code> that is <code>active</code>.</p>

      <h2 id="2-outbound">2. Place an outbound call</h2>
      <CodeBlock
        language="bash"
        code={`curl -X POST https://app.snapserve.ai/api/calls/outbound \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": 123,
    "toNumber": "+919876543210"
  }'`}
      />
      <p>
        Response includes a call <code>id</code>. Poll <code>GET /calls/{"{id}"}</code> or
        register a webhook to get <code>call.completed</code>. See{" "}
        <Link href="/docs/outbound-calls">Outbound Calls</Link> and{" "}
        <Link href="/docs/webhooks">Webhooks</Link>.
      </p>

      <h2 id="node">Node.js (SDK)</h2>
      <CodeBlock language="bash" code={`npm install @snapserve/sdk`} />
      <CodeBlock
        language="javascript"
        code={`import { SnapServe } from "@snapserve/sdk";

const client = new SnapServe({ apiKey: process.env.SNAPSERVE_API_KEY });

const agents = await client.agents.list();
const agentId = agents[0].id;

const call = await client.calls.outbound({
  agentId,
  toNumber: "+919876543210",
});
console.log("started", call.id);`}
      />

      <h2 id="python">Python (SDK)</h2>
      <CodeBlock language="bash" code={`pip install snapserve`} />
      <CodeBlock
        language="python"
        code={`import os
from snapserve import SnapServe

client = SnapServe(api_key=os.environ["SNAPSERVE_API_KEY"])
agents = client.agents.list()
call = client.calls.outbound(agent_id=agents[0]["id"], to_number="+919876543210")
print("started", call["id"])`}
      />

      <h2 id="next">Next steps</h2>
      <ul>
        <li><Link href="/docs/webhooks">Verify webhook signatures</Link> in your app.</li>
        <li><Link href="/docs/agents">Create or update agents via API</Link>.</li>
        <li><Link href="/docs/api-reference">Browse the full OpenAPI reference</Link>.</li>
      </ul>
    </div>
  );
}
