import { CodeBlock } from "../CodeBlock";

export default function WebhooksPage() {
  return (
    <div>
      <h1>Webhooks</h1>
      <p>
        Webhooks let you receive real-time notifications from SnapServe when events occur — calls
        start and end, bookings are created or cancelled, and campaigns progress. Use webhooks to
        push data to your CRM, trigger automations, sync transcripts to a data warehouse, or
        notify your team in Slack.
      </p>

      <h2 id="registering">Registering an endpoint</h2>
      <ol>
        <li>Go to <strong>Settings → Webhooks</strong> in the sidebar.</li>
        <li>Click <strong>Add Webhook Endpoint</strong>.</li>
        <li>Enter your HTTPS endpoint URL.</li>
        <li>Select the event types you want to receive.</li>
        <li>Click <strong>Save</strong>.</li>
      </ol>
      <p>
        Or via the API:
      </p>
      <CodeBlock language="bash" code={`curl -X POST https://app.snapserve.ai/api/webhook-endpoints \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://your-server.com/webhooks/snapserve",
    "events": ["call.completed", "booking.created", "campaign.batch.finished"]
  }'`} />

      <h2 id="delivery">Delivery</h2>
      <ul>
        <li>Webhooks are sent as <strong>HTTP POST</strong> requests with a JSON body.</li>
        <li>SnapServe expects your endpoint to return <strong>HTTP 200</strong> within 10 seconds.</li>
        <li>If your endpoint returns a non-200 response or times out, SnapServe retries up to 3 times with exponential backoff (30 s, 5 min, 30 min).</li>
        <li>After 3 failed attempts, the event is dropped and logged as failed in the webhook delivery log.</li>
      </ul>

      <h2 id="verification">Verifying webhooks</h2>
      <p>
        Each webhook request includes a signature header so you can verify it originated from
        SnapServe:
      </p>
      <CodeBlock language="text" code={`X-SnapServe-Signature: sha256=<hmac-hex-digest>
X-SnapServe-Timestamp: 1718612345`} />
      <p>
        The signature is an HMAC-SHA256 of <code>timestamp.body</code> using your webhook signing
        secret (shown once when you create the endpoint). Verify it:
      </p>
      <CodeBlock language="javascript" code={`import crypto from "crypto";

function verifyWebhook(body, signature, timestamp, secret) {
  const payload = \`\${timestamp}.\${body}\`;
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}`} />

      <h2 id="event-catalog">Event catalog</h2>

      <h3 id="call-events">Call events</h3>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Event</th>
              <th className="px-4 py-3 font-semibold">When it fires</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["call.started", "A call session has been established and the agent is active"],
              ["call.completed", "A call ended normally (agent or caller hung up)"],
              ["call.failed", "A call failed to connect or ended in an error state"],
              ["call.transcript.updated", "A new turn has been added to the call transcript (streaming)"],
            ].map(([e, w]) => (
              <tr key={e} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs">{e}</td>
                <td className="px-4 py-3 text-muted-foreground">{w}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CodeBlock language="json" code={`// call.completed payload
{
  "event": "call.completed",
  "timestamp": "2026-06-17T09:32:22.000Z",
  "data": {
    "callId": "ca_abc123",
    "agentId": "ag_xyz",
    "agentName": "Support Bot",
    "status": "completed",
    "duration": 142,
    "callerNumber": "+919876543210",
    "startedAt": "2026-06-17T09:30:00.000Z",
    "endedAt": "2026-06-17T09:32:22.000Z",
    "transcript": [
      { "role": "agent", "text": "Hi, how can I help you today?" },
      { "role": "user",  "text": "I need help resetting my password." }
    ],
    "toolCalls": [
      { "tool": "send_webhook", "status": "success", "at": "2026-06-17T09:31:10.000Z" }
    ],
    "campaignId": null,
    "leadId": null
  }
}`} />

      <h3 id="booking-events">Booking events</h3>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Event</th>
              <th className="px-4 py-3 font-semibold">When it fires</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["booking.created", "A booking has been confirmed (via agent, API, or public page)"],
              ["booking.cancelled", "A booking has been cancelled"],
              ["booking.rescheduled", "A booking has been moved to a new time"],
            ].map(([e, w]) => (
              <tr key={e} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs">{e}</td>
                <td className="px-4 py-3 text-muted-foreground">{w}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CodeBlock language="json" code={`// booking.created payload
{
  "event": "booking.created",
  "timestamp": "2026-06-17T09:32:00.000Z",
  "data": {
    "bookingId": "bk_abc123",
    "eventTypeId": "et_xyz",
    "eventTypeName": "30-min Demo",
    "eventTypeSlug": "demo",
    "calendarId": "cal_abc",
    "attendeeName": "Priya Sharma",
    "attendeeEmail": "priya@example.com",
    "startTime": "2026-06-18T09:30:00.000Z",
    "endTime": "2026-06-18T10:00:00.000Z",
    "timezone": "Asia/Kolkata",
    "notes": "Interested in enterprise plan.",
    "googleMeetLink": "https://meet.google.com/abc-def-ghi",
    "bookedVia": "agent",
    "callId": "ca_abc123"
  }
}`} />

      <h3 id="campaign-events">Campaign events</h3>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Event</th>
              <th className="px-4 py-3 font-semibold">When it fires</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["campaign.batch.started", "A campaign batch has begun dialing"],
              ["campaign.batch.finished", "All leads in a batch have been processed"],
              ["campaign.lead.completed", "An individual lead's call completed successfully"],
              ["campaign.lead.failed", "An individual lead's call failed after all retries"],
            ].map(([e, w]) => (
              <tr key={e} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs">{e}</td>
                <td className="px-4 py-3 text-muted-foreground">{w}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="testing">Testing webhooks locally</h2>
      <p>
        Use a tunnelling tool like ngrok to expose a local server for webhook testing:
      </p>
      <CodeBlock language="bash" code={`# Install ngrok
npm install -g ngrok

# Start a tunnel to your local server (port 3001)
ngrok http 3001

# Your public webhook URL will be something like:
# https://abc123.ngrok-free.app/webhooks/snapserve

# Register it in SnapServe settings, trigger a WebCall test,
# and watch the events arrive on your local server.`} />
    </div>
  );
}
