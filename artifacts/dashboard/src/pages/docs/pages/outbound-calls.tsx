import { Link } from "wouter";
import { Callout, LanguageTabs, PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function OutboundCallsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Calls & campaigns"
        title="Calls & history"
        updated="18 Aug 2026"
        description="Place outbound PSTN calls, watch live status, and pull transcript, summary, disposition, and cost into your app."
      />

      <h2 id="dashboard">In the dashboard</h2>
      <p>
        <a href="https://app.snapserve.ai/app/calls" target="_blank" rel="noreferrer">
          Calls
        </a>{" "}
        lists every conversation — phone, webcall, and meetings — with status, duration, cost,
        recording, transcript, and summary. Filter failed or completed dials. Vibe → Test places a
        single outbound or webcall without a campaign.
      </p>

      <h2 id="place">Place a call (API)</h2>
      <p>
        Body is <code>agentId</code> + <code>toNumber</code> (E.164). Optional{" "}
        <code>variables</code> (or <code>parameters</code>) injects patient fields and questions for
        that dial only — <Link href="/docs/variables">Variables</Link>. Optional{" "}
        <code>webhookBaseUrl</code> only if you must override telephony callbacks.
      </p>
      <LanguageTabs
        tabs={[
          {
            label: "cURL",
            language: "bash",
            code: `curl -X POST https://app.snapserve.ai/api/calls/outbound \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"agentId": 36, "toNumber": "+919876543210", "variables": {"patient_name": "Priya", "questions": ["How is your pain today?"]}}'`,
          },
          {
            label: "Node",
            language: "typescript",
            code: `await fetch("https://app.snapserve.ai/api/calls/outbound", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SNAPSERVE_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    agentId: 36,
    toNumber: "+919876543210",
    variables: { patient_name: "Priya", questions: ["How is your pain today?"] },
  }),
});`,
          },
        ]}
      />
      <p>
        Schema:{" "}
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
          <code>dispositionResult</code> — label from the agent Outcomes taxonomy
        </li>
        <li>
          <code>costCents</code> — paise · <code>durationSeconds</code>
        </li>
        <li>
          <code>recordingUrl</code> — when recording is on and upload succeeded
        </li>
      </ul>
      <CodeBlock
        language="bash"
        code={`curl https://app.snapserve.ai/api/calls/2920 \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />
      <CodeBlock
        language="json"
        code={`{
  "id": 2920,
  "status": "completed",
  "durationSeconds": 84,
  "costCents": 700,
  "transcript": "Agent: Hello…",
  "callSummary": "Caller asked about pricing…",
  "dispositionResult": "Callback",
  "recordingUrl": "https://…"
}`}
      />

      <Callout variant="tip">
        Prefer <Link href="/docs/webhooks">webhooks</Link> (<code>call.completed</code>) over
        polling. Do not retry identical <code>POST /calls/outbound</code> on timeout without checking
        whether the call already exists.
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
          <Link href="/docs/api-reference/transferCall">Transfer</Link> (warm or cold)
        </li>
      </ul>
    </div>
  );
}
