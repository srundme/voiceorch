import { Link } from "wouter";
import { Callout, Endpoint, PageHeader, ParamsTable } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function WebhooksPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Webhooks"
        title="Webhooks"
        description="Receive call lifecycle events on your HTTPS endpoint. Verify every payload with HMAC before trusting it."
        copyText={`X-SnapServe-Signature: sha256=<hmac-hex>
X-SnapServe-Timestamp: <unix-seconds>
Signed payload: "{timestamp}.{rawBody}"`}
      />

      <Callout variant="warn" title="Verify signatures">
        Always check <code>X-SnapServe-Signature</code> with your endpoint secret. Reject requests
        that fail verification.
      </Callout>

      <Endpoint
        id="register"
        method="post"
        path="/webhook-endpoints"
        title="Register endpoint"
        opId="createWebhookEndpoint"
      >
        <ParamsTable
          rows={[
            { name: "url", type: "string", required: true, description: "HTTPS URL that accepts POST" },
            {
              name: "events",
              type: "string[]",
              required: true,
              description: 'e.g. ["call.started","call.completed","call.failed"]',
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
    "events": ["call.completed", "call.failed", "call.started"]
  }'`}
        />
        <p>
          Save the signing <strong>secret</strong> from the create response — it is not shown again.
        </p>
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

      <h2 id="delivery">Delivery rules</h2>
      <ul>
        <li>HTTP <strong>POST</strong> with a JSON body.</li>
        <li>Respond <strong>200</strong> within ~10 seconds.</li>
        <li>Failed deliveries retry with backoff, then mark failed.</li>
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
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// Express-style handler (use raw body buffer/string)
app.post("/hooks/snapserve", express.raw({ type: "*/*" }), (req, res) => {
  const rawBody = req.body.toString("utf8");
  const ok = verifyWebhook(
    rawBody,
    req.get("X-SnapServe-Signature"),
    req.get("X-SnapServe-Timestamp"),
    process.env.SNAPSERVE_WEBHOOK_SECRET,
  );
  if (!ok) return res.status(401).send("invalid signature");
  const event = JSON.parse(rawBody);
  // handle event.event / event.data
  res.sendStatus(200);
});`}
      />
      <CodeBlock
        language="python"
        code={`import hmac, hashlib

def verify_webhook(raw_body: bytes, signature: str, timestamp: str, secret: str) -> bool:
    payload = f"{timestamp}.".encode() + raw_body
    digest = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    expected = f"sha256={digest}"
    return hmac.compare_digest(signature, expected)`}
      />

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
              ["call.started", "Session established; agent is live"],
              ["call.completed", "Normal hang-up; duration/cost available"],
              ["call.failed", "Connect failure or error exit"],
            ].map(([e, w]) => (
              <tr key={e} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-sky-300">{e}</td>
                <td className="px-4 py-3 text-muted-foreground">{w}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CodeBlock
        language="json"
        code={`{
  "event": "call.completed",
  "timestamp": "2026-07-15T12:00:00.000Z",
  "data": {
    "callId": 456,
    "agentId": 123,
    "status": "completed",
    "durationSeconds": 84,
    "costCents": 700,
    "toNumber": "+919876543210"
  }
}`}
      />
      <p>
        <code>costCents</code> is <strong>paise</strong> (INR × 100). See{" "}
        <Link href="/docs/wallet">Wallet</Link>.
      </p>

      <h2 id="local-dev">Local development</h2>
      <p>
        Tunnel your laptop (ngrok / Cloudflare Tunnel) so SnapServe can reach{" "}
        <code>https://…/hooks/snapserve</code>.
      </p>
    </div>
  );
}
