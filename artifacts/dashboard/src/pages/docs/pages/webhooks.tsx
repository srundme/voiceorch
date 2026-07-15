import { CodeBlock } from "../CodeBlock";
import { Link } from "wouter";

export default function WebhooksPage() {
  return (
    <div>
      <h1>Webhooks</h1>
      <p>
        Point SnapServe at your HTTPS endpoint to receive call lifecycle events in your own
        application. Create endpoints via API or Settings → Webhooks in the dashboard.
      </p>

      <h2 id="register">Register an endpoint</h2>
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
        Save the signing secret returned at create time — it is not shown again. List / patch /
        delete: <code>GET|PATCH|DELETE /webhook-endpoints</code>.
      </p>

      <h2 id="delivery">Delivery</h2>
      <ul>
        <li>HTTP <strong>POST</strong> with a JSON body.</li>
        <li>Respond <strong>200</strong> within ~10 seconds.</li>
        <li>Failed deliveries retry with backoff (typically a few attempts), then mark failed.</li>
      </ul>

      <h2 id="verify">Verify signatures</h2>
      <CodeBlock
        language="text"
        code={`X-SnapServe-Signature: sha256=<hmac-hex-digest>
X-SnapServe-Timestamp: 1718612345`}
      />
      <p>
        Signatures are HMAC-SHA256 of <code>{"{timestamp}.{rawBody}"}</code> using your endpoint
        secret. Always verify before trusting the payload:
      </p>
      <CodeBlock
        language="javascript"
        code={`import crypto from "crypto";

function verifyWebhook(rawBody, signature, timestamp, secret) {
  const payload = \`\${timestamp}.\${rawBody}\`;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}`}
      />

      <h2 id="events">Useful events for app builders</h2>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Event</th>
              <th className="px-4 py-3 font-semibold">When</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["call.started", "Session established; agent is live"],
              ["call.completed", "Normal hang-up; invoice duration/cost available"],
              ["call.failed", "Connect failure or error exit"],
            ].map(([e, w]) => (
              <tr key={e} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs">{e}</td>
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
        Use a tunnel (ngrok, Cloudflare Tunnel) so SnapServe can reach{" "}
        <code>https://…/hooks/snapserve</code> on your laptop.
      </p>
    </div>
  );
}
