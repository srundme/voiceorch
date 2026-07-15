import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function OutboundCallsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Product guides"
        title="Calls & history"
        description="Place outbound calls, watch live status in the dashboard, and pull transcript / summary / disposition into your app."
      />

      <h2 id="dashboard">In the dashboard</h2>
      <p>
        <a href="https://app.snapserve.ai/app/calls" target="_blank" rel="noreferrer">
          Calls
        </a>{" "}
        lists every conversation — status, duration, cost, recording, transcript, and summary when
        available. Use filters to find failed or completed dials.
      </p>

      <h2 id="place">Place a call (API)</h2>
      <CodeBlock
        language="bash"
        code={`curl -X POST https://app.snapserve.ai/api/calls/outbound \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": 36,
    "toNumber": "+919876543210"
  }'`}
      />
      <p>
        Details:{" "}
        <Link href="/docs/api-reference/initiateOutboundCall">initiateOutboundCall</Link>.
      </p>

      <h2 id="results">Transcript, summary &amp; disposition</h2>
      <p>
        After completion, <Link href="/docs/api-reference/getCall">GET /calls/{"{id}"}</Link>{" "}
        includes:
      </p>
      <ul>
        <li>
          <code>transcript</code> — full conversation text
        </li>
        <li>
          <code>callSummary</code> — short AI summary
        </li>
        <li>
          <code>successEvaluation</code> — outcome evaluation when enabled
        </li>
        <li>
          <code>dispositionResult</code> / disposition fields
        </li>
        <li>
          <code>costCents</code> — cost in paise · <code>durationSeconds</code>
        </li>
        <li>
          <code>recordingUrl</code> — when recording is available
        </li>
      </ul>
      <CodeBlock
        language="bash"
        code={`curl https://app.snapserve.ai/api/calls/2920 \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />

      <Callout variant="tip">
        Prefer <Link href="/docs/webhooks">webhooks</Link> (<code>call.completed</code>) over
        polling in production.
      </Callout>

      <h2 id="more-api">More call APIs</h2>
      <ul>
        <li>
          <Link href="/docs/api-reference/listCalls">List calls</Link>
        </li>
        <li>
          <Link href="/docs/api-reference/endCall">End live call</Link>
        </li>
        <li>
          <Link href="/docs/api-reference/updateCallDisposition">Set disposition</Link>
        </li>
        <li>
          <Link href="/docs/api-reference/transferCall">Transfer</Link>
        </li>
      </ul>
    </div>
  );
}
