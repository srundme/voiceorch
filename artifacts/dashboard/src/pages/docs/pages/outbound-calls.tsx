import { CodeBlock } from "../CodeBlock";
import { Link } from "wouter";

export default function OutboundCallsPage() {
  return (
    <div>
      <h1>Outbound Calls</h1>
      <p>
        Start voice calls from your application. SnapServe dials the destination, runs your
        agent, and writes transcript / cost back to the call record. Prefer webhooks for
        completion — polling works for demos.
      </p>

      <h2 id="create">Create an outbound call</h2>
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
      <ul>
        <li><code>agentId</code> — must belong to your account and be active.</li>
        <li><code>toNumber</code> — E.164 format (e.g. <code>+91…</code>).</li>
        <li>Optional <code>webhookBaseUrl</code> — override callback base for telephony (advanced).</li>
      </ul>
      <p>
        The agent’s assigned SnapServe phone number is used as caller ID when configured.
        Insufficient wallet balance or TRAI quiet hours may reject the dial.
      </p>

      <h2 id="get">Get a call</h2>
      <CodeBlock
        language="bash"
        code={`curl https://app.snapserve.ai/api/calls/456 \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />
      <p>
        Useful fields: <code>status</code>, <code>durationSeconds</code>, <code>costCents</code>{" "}
        (paise), transcript / disposition when available.
      </p>

      <h2 id="list">List calls</h2>
      <CodeBlock
        language="bash"
        code={`curl "https://app.snapserve.ai/api/calls?limit=20" \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />

      <h2 id="end">End a live call</h2>
      <CodeBlock
        language="bash"
        code={`curl -X PATCH https://app.snapserve.ai/api/calls/456/end \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />

      <h2 id="disposition">Set disposition</h2>
      <CodeBlock
        language="bash"
        code={`curl -X PATCH https://app.snapserve.ai/api/calls/456/disposition \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "disposition": "interested" }'`}
      />

      <h2 id="transfer">Transfer</h2>
      <p>
        Warm / cold transfer to a human number via{" "}
        <code>POST /calls/{"{id}"}/transfer</code>. See the OpenAPI schema for the current body.
      </p>

      <h2 id="events">Async results</h2>
      <p>
        Register for <code>call.started</code>, <code>call.completed</code>, and{" "}
        <code>call.failed</code> — <Link href="/docs/webhooks">Webhooks</Link>.
      </p>
    </div>
  );
}
