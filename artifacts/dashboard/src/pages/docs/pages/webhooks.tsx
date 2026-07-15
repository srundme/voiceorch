import { Link } from "wouter";
import { Callout, Endpoint, PageHeader, ParamsTable } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function WebhooksPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Product guides"
        title="Webhooks"
        description="Receive call results on your HTTPS URL when a conversation finishes — transcript, summary, cost, and more."
        copyText={`X-SnapServe-Signature: sha256=<hmac-hex>
X-SnapServe-Timestamp: <unix-seconds>
Signed payload: "{timestamp}.{rawBody}"
Events: call.completed, call.failed`}
      />

      <Callout variant="info" title="Not the same as Connections">
        <strong>This page / API</strong> = SnapServe → your app (call finished).{" "}
        <strong>Connections</strong> = forms/CRM → SnapServe (inbound leads). Dashboard:{" "}
        <a href="https://app.snapserve.ai/app/webhooks" target="_blank" rel="noreferrer">
          Call webhooks
        </a>{" "}
        vs{" "}
        <a href="https://app.snapserve.ai/app/connections" target="_blank" rel="noreferrer">
          Connections
        </a>
        .
      </Callout>

      <h2 id="events">Events</h2>
      <div className="not-prose my-4 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm text-left">
          <thead className="text-[11px] uppercase tracking-wider bg-white/[0.03] text-muted-foreground border-b border-white/10">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Event</th>
              <th className="px-4 py-2.5 font-semibold">When</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["call.completed", "Call finished (normal path). Prefer this in new subscriptions."],
              ["call.failed", "Call ended with a failed status"],
              ["call.ended", "Legacy alias — still matched when we send call.completed"],
            ].map(([e, w]) => (
              <tr key={e} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-sky-300">{e}</td>
                <td className="px-4 py-3 text-muted-foreground">{w}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Endpoint
        id="register"
        method="post"
        path="/webhook-endpoints"
        title="Register endpoint"
        opId="createWebhookEndpoint"
      >
        <ParamsTable
          rows={[
            { name: "url", type: "string", required: true, description: "Your HTTPS URL that accepts POST" },
            {
              name: "events",
              type: "string[]",
              required: true,
              description: 'e.g. ["call.completed", "call.failed"]',
            },
          ]}
        />
        <CodeBlock
          language="bash"
          code={`curl -X POST https://app.snapserve.ai/api/webhook-endpoints \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://your-app.example.com/hooks/snapserve",
    "events": ["call.completed", "call.failed"]
  }'`}
        />
        <Callout variant="warn" title="Save the secret">
          The create response includes <code>secret</code> once. It is masked as{" "}
          <code>secretHint</code> afterward. Copy it immediately.
        </Callout>
      </Endpoint>

      <Endpoint
        id="list"
        method="get"
        path="/webhook-endpoints"
        title="List endpoints"
        opId="listWebhookEndpoints"
      >
        <CodeBlock
          language="bash"
          code={`curl https://app.snapserve.ai/api/webhook-endpoints \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
        />
      </Endpoint>

      <h2 id="delivery">Delivery</h2>
      <ul>
        <li>HTTP <strong>POST</strong> JSON body</li>
        <li>Respond <strong>200</strong> within ~10 seconds</li>
        <li>Failed deliveries are logged; keep your endpoint reliable</li>
      </ul>

      <h2 id="verify">Verify signatures</h2>
      <CodeBlock
        language="http"
        code={`X-SnapServe-Signature: sha256=<hmac-hex-digest>
X-SnapServe-Timestamp: 1718612345`}
      />
      <p>
        HMAC-SHA256 of <code>{"{timestamp}.{rawBody}"}</code> using your endpoint secret:
      </p>
      <CodeBlock
        language="javascript"
        code={`import crypto from "crypto";

export function verifyWebhook(rawBody, signature, timestamp, secret) {
  const payload = \`\${timestamp}.\${rawBody}\`;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (!signature || signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}`}
      />

      <h2 id="payload">Example payload</h2>
      <CodeBlock
        language="json"
        code={`{
  "event": "call.completed",
  "timestamp": "2026-07-15T12:00:00.000Z",
  "data": {
    "callId": 2920,
    "agentId": 36,
    "status": "completed",
    "toNumber": "+916383653279",
    "fromNumber": "+917971543255",
    "durationSeconds": 84,
    "costCents": 700,
    "transcript": "Agent: Hello…",
    "callSummary": "Caller asked about pricing…",
    "dispositionResult": null,
    "recordingUrl": null
  }
}`}
      />
      <p>
        <code>costCents</code> is paise. You can also load the full record with{" "}
        <Link href="/docs/api-reference/getCall">GET /calls/{"{id}"}</Link>.
      </p>

      <h2 id="local-dev">Local development</h2>
      <p>
        Tunnel your laptop (ngrok / Cloudflare Tunnel) to an HTTPS URL SnapServe can reach.
      </p>
    </div>
  );
}
