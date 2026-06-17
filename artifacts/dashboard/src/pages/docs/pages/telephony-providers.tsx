import { CodeBlock } from "../CodeBlock";

export default function TelephonyProvidersPage() {
  return (
    <div>
      <h1>Telephony Providers</h1>
      <p>
        Telephony providers connect SnapServe to the public telephone network. They route inbound
        calls to your agent and place outbound calls from campaigns. SnapServe bridges audio between
        the telephony WebSocket and the ASR/TTS pipeline.
      </p>

      <h2 id="comparison">Provider comparison</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Provider</th>
              <th className="px-4 py-3 font-semibold">Best for</th>
              <th className="px-4 py-3 font-semibold">India DID?</th>
              <th className="px-4 py-3 font-semibold">Outbound?</th>
              <th className="px-4 py-3 font-semibold">Free trial</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Twilio", "Global coverage, best docs, largest ecosystem", "Yes", "Yes", "$15 credit"],
              ["Plivo", "Cost-effective India numbers, local rates", "Yes", "Yes", "$0.50 credit"],
              ["Vonage", "API-first, good for SMS + voice combined", "Yes", "Yes", "$2 credit"],
            ].map(([p, b, ind, out, t]) => (
              <tr key={p} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium">{p}</td>
                <td className="px-4 py-3 text-muted-foreground">{b}</td>
                <td className="px-4 py-3 text-muted-foreground">{ind}</td>
                <td className="px-4 py-3 text-muted-foreground">{out}</td>
                <td className="px-4 py-3 text-muted-foreground">{t}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="twilio">Twilio</h2>
      <p>
        Twilio is the most widely used telephony provider and has the best documentation, widest
        geographic coverage, and most mature API. It is the recommended provider for most deployments.
      </p>
      <p><strong>Getting credentials:</strong> Sign up at <code>console.twilio.com</code>. You'll need your <strong>Account SID</strong> and <strong>Auth Token</strong>.</p>

      <h3>Setting up inbound calls (Twilio)</h3>
      <ol>
        <li>Purchase or port a phone number in the Twilio console.</li>
        <li>Go to the number's configuration page.</li>
        <li>Under <strong>Voice & Fax → A call comes in</strong>, set it to <strong>Webhook</strong>.</li>
        <li>Enter the SnapServe webhook URL:</li>
      </ol>
      <CodeBlock language="text" code={`https://app.snapserve.ai/api/telephony/twilio/inbound/<agent-id>

HTTP method: HTTP POST`} />
      <ol start={5}>
        <li>Save. Calls to this number now route to your agent.</li>
      </ol>

      <h3>Twilio credentials in SnapServe</h3>
      <CodeBlock language="json" code={`{
  "category": "telephony",
  "provider": "twilio",
  "accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "authToken": "your_auth_token",
  "label": "Production Twilio"
}`} />

      <h2 id="plivo">Plivo</h2>
      <p>
        Plivo offers competitive pricing for India numbers and outbound calls, with better local
        rates than Twilio for Indian PSTN termination. The API is similar to Twilio.
      </p>
      <p><strong>Getting credentials:</strong> Sign up at <code>console.plivo.com</code>. You'll need your <strong>Auth ID</strong> and <strong>Auth Token</strong>.</p>

      <h3>Setting up inbound calls (Plivo)</h3>
      <ol>
        <li>Purchase a number in the Plivo console under <strong>Phone Numbers → Buy Numbers</strong>.</li>
        <li>Go to <strong>Applications → Voice</strong> and create a new application.</li>
        <li>Set the Answer URL:</li>
      </ol>
      <CodeBlock language="text" code={`Answer URL: https://app.snapserve.ai/api/telephony/plivo/inbound/<agent-id>
HTTP method: POST`} />
      <ol start={4}>
        <li>Assign the application to your phone number.</li>
      </ol>

      <h2 id="vonage">Vonage (Nexmo)</h2>
      <p>
        Vonage (formerly Nexmo) is a strong choice when you need SMS + voice in a single provider,
        or when building in markets where Vonage has better local number availability than Twilio.
      </p>
      <p><strong>Getting credentials:</strong> Sign up at <code>dashboard.nexmo.com</code>. You'll need your <strong>API Key</strong> and <strong>API Secret</strong>.</p>

      <h3>Setting up inbound calls (Vonage)</h3>
      <ol>
        <li>Purchase a number in the Vonage dashboard.</li>
        <li>Go to <strong>Your Applications → Create a new application</strong>.</li>
        <li>Enable Voice capability and set the Answer URL:</li>
      </ol>
      <CodeBlock language="text" code={`Answer URL: https://app.snapserve.ai/api/telephony/vonage/inbound/<agent-id>
Event URL:  https://app.snapserve.ai/api/telephony/vonage/events/<agent-id>`} />
      <ol start={4}>
        <li>Link your phone number to the application.</li>
      </ol>

      <h2 id="outbound-calls">Outbound calls</h2>
      <p>
        Outbound calls are placed by the campaign engine using the telephony provider configured
        on the agent. The agent must have a <strong>Caller ID</strong> configured — this is the
        number that appears on the recipient's phone.
      </p>
      <p>
        The caller ID must be a number you own or have verified in your telephony provider's
        dashboard. Using unverified numbers will cause calls to fail.
      </p>

      <h2 id="webcall">WebCall (browser-based)</h2>
      <p>
        WebCall does not require a telephony provider. It connects directly from the browser using
        WebRTC. Use WebCall to test agents without setting up a phone number.
      </p>
      <p>
        WebCall is available on any agent — click the phone icon in the agent detail page. Microphone
        access must be granted when prompted.
      </p>

      <h2 id="troubleshooting">Troubleshooting</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Symptom</th>
              <th className="px-4 py-3 font-semibold">Likely cause</th>
              <th className="px-4 py-3 font-semibold">Fix</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Call connects but no audio", "ASR not receiving audio frames", "Check ASR provider key is valid and not expired"],
              ["Inbound call goes to voicemail", "Webhook URL not configured", "Verify the webhook URL in your telephony provider dashboard"],
              ["Agent hangs up immediately", "Agent is inactive", "Toggle the agent to active status"],
              ["Outbound call fails", "Invalid caller ID", "Verify the caller ID number in your telephony provider"],
              ["401 error in Twilio logs", "Invalid Auth Token", "Regenerate the token in Twilio console and update in SnapServe"],
              ["Echo on the call", "Audio loopback in WebCall", "Use headphones when testing with WebCall"],
            ].map(([s, c, f]) => (
              <tr key={s} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 text-muted-foreground">{s}</td>
                <td className="px-4 py-3 text-muted-foreground">{c}</td>
                <td className="px-4 py-3 text-muted-foreground">{f}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
