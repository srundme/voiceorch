import { Link } from "wouter";
import { Callout, Endpoint, PageHeader, ParamsTable } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function OutboundCallsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Calls"
        title="Outbound Calls"
        description="Start voice calls from your application. SnapServe dials the destination, runs your agent, and writes transcript / cost to the call record."
        copyText={`POST   https://app.snapserve.ai/api/calls/outbound
GET    https://app.snapserve.ai/api/calls
GET    https://app.snapserve.ai/api/calls/{id}
PATCH  https://app.snapserve.ai/api/calls/{id}/end
PATCH  https://app.snapserve.ai/api/calls/{id}/disposition
POST   https://app.snapserve.ai/api/calls/{id}/transfer`}
      />

      <Callout variant="tip">
        Use <Link href="/docs/webhooks">webhooks</Link> (<code>call.completed</code>) in production.
        Polling is fine for demos.
      </Callout>

      <Endpoint
        id="create"
        method="post"
        path="/calls/outbound"
        title="Create outbound call"
        opId="initiateOutboundCall"
      >
        <ParamsTable
          rows={[
            { name: "agentId", type: "integer", required: true, description: "Your active agent" },
            { name: "toNumber", type: "string", required: true, description: "E.164 destination" },
            {
              name: "webhookBaseUrl",
              type: "string",
              description: "Advanced override for telephony callbacks (optional)",
            },
          ]}
        />
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
        <CodeBlock
          language="json"
          code={`{
  "id": 456,
  "status": "initiated",
  "agentId": 123,
  "toNumber": "+919876543210",
  "fromNumber": "+9180XXXXXX"
}`}
        />
        <p>
          Caller ID uses the agent&apos;s assigned SnapServe number when configured. Insufficient
          wallet or TRAI quiet hours may reject the dial (<code>402</code> / <code>403</code>).
        </p>
      </Endpoint>

      <Endpoint id="list" method="get" path="/calls" title="List calls" opId="listCalls">
        <CodeBlock
          language="bash"
          code={`curl "https://app.snapserve.ai/api/calls?limit=20" \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
        />
      </Endpoint>

      <Endpoint id="get" method="get" path="/calls/{id}" title="Get call" opId="getCall">
        <CodeBlock
          language="bash"
          code={`curl https://app.snapserve.ai/api/calls/456 \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
        />
        <p>
          Useful fields: <code>status</code>, <code>durationSeconds</code>, <code>costCents</code>{" "}
          (paise / INR×100), transcript and disposition when available.
        </p>
        <CodeBlock
          language="json"
          code={`{
  "id": 456,
  "status": "completed",
  "durationSeconds": 84,
  "costCents": 700,
  "toNumber": "+919876543210",
  "disposition": "interested"
}`}
        />
      </Endpoint>

      <Endpoint id="end" method="patch" path="/calls/{id}/end" title="End live call" opId="endCall">
        <CodeBlock
          language="bash"
          code={`curl -X PATCH https://app.snapserve.ai/api/calls/456/end \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
        />
      </Endpoint>

      <Endpoint
        id="disposition"
        method="patch"
        path="/calls/{id}/disposition"
        title="Set disposition"
        opId="updateCallDisposition"
      >
        <CodeBlock
          language="bash"
          code={`curl -X PATCH https://app.snapserve.ai/api/calls/456/disposition \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "disposition": "interested" }'`}
        />
      </Endpoint>

      <Endpoint
        id="transfer"
        method="post"
        path="/calls/{id}/transfer"
        title="Transfer call"
        opId="transferCall"
      >
        <p>Warm / cold transfer to a human number. See the OpenAPI body for current fields.</p>
        <CodeBlock
          language="bash"
          code={`curl -X POST https://app.snapserve.ai/api/calls/456/transfer \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "toNumber": "+919811122233" }'`}
        />
      </Endpoint>

      <h2 id="events">Async results</h2>
      <p>
        Register for <code>call.started</code>, <code>call.completed</code>, and{" "}
        <code>call.failed</code> — <Link href="/docs/webhooks">Webhooks</Link>.
      </p>
    </div>
  );
}
