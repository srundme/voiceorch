import { CodeBlock } from "../CodeBlock";
import { Link } from "wouter";

export default function QuickStartPage() {
  return (
    <div>
      <h1>Quick Start</h1>
      <p>
        This guide walks you through creating a fully working AI voice agent from scratch. By the end
        you will have an agent you can call via a browser session or a real phone number.
      </p>

      <h2 id="step-1-add-providers">Step 1 — Add provider keys</h2>
      <p>
        SnapServe needs API keys for at least three services: speech-to-text (ASR), a language model
        (LLM), and text-to-speech (TTS). A telephony key is only required for real phone calls.
      </p>
      <ol>
        <li>Open <strong>Providers</strong> in the sidebar.</li>
        <li>Click <strong>Add Provider</strong>.</li>
        <li>
          Choose a category and provider. For the fastest start we recommend:
          <ul>
            <li><strong>ASR</strong> — Deepgram (Nova-3 has the best accuracy for Indian English)</li>
            <li><strong>LLM</strong> — OpenAI GPT-4o or Anthropic Claude Haiku (low latency)</li>
            <li><strong>TTS</strong> — ElevenLabs or Cartesia</li>
          </ul>
        </li>
        <li>Paste your API key and click <strong>Save</strong>. Keys are encrypted at rest (AES-256-GCM) and never exposed beyond the last four characters.</li>
      </ol>
      <p>
        See the <Link href="/docs/providers" className="text-primary hover:underline">Providers guide</Link> for
        where to get keys for each service.
      </p>

      <h2 id="step-2-create-agent">Step 2 — Create an agent</h2>
      <ol>
        <li>Open <strong>Agents</strong> in the sidebar and click <strong>New Agent</strong>.</li>
        <li>Give the agent a name (e.g. "Support Bot").</li>
        <li>
          Write a system prompt. Keep it specific:
        </li>
      </ol>
      <CodeBlock language="text" code={`You are a friendly customer support agent for SnapServe.
Your job is to help users troubleshoot their voice agents.
Keep answers concise — this is a phone call, not a chat window.
Do not use bullet points or markdown in your responses.
If you cannot answer, say so and offer to escalate.`} />
      <ol start={4}>
        <li>Select your ASR, LLM, and TTS providers from the dropdowns.</li>
        <li>Choose a voice from the TTS voice picker.</li>
        <li>Click <strong>Save</strong>.</li>
      </ol>

      <h2 id="step-3-test-with-webcall">Step 3 — Test with WebCall</h2>
      <p>
        WebCall lets you talk to your agent directly in the browser — no phone number or telephony
        setup needed.
      </p>
      <ol>
        <li>Open the agent you just created.</li>
        <li>Click the <strong>phone icon</strong> in the top-right of the agent detail page.</li>
        <li>Allow microphone access when prompted.</li>
        <li>Talk to your agent. You will see the transcript update in real time.</li>
        <li>Click <strong>End call</strong> when finished.</li>
      </ol>
      <p>
        The call will appear in the Calls Log with a full transcript and duration. Use this to
        iterate on your system prompt before going live.
      </p>

      <h2 id="step-4-connect-telephony">Step 4 — Connect telephony (optional)</h2>
      <p>
        To handle real inbound or outbound phone calls, add a telephony provider key and configure a
        phone number to route to your agent.
      </p>
      <ol>
        <li>Add a Twilio, Plivo, or Vonage API key in <strong>Providers → Telephony</strong>.</li>
        <li>
          In your telephony provider's dashboard, configure the webhook URL for your phone number:
        </li>
      </ol>
      <CodeBlock language="text" code={`Twilio webhook URL:
https://app.snapserve.ai/api/telephony/twilio/inbound/<agent-id>

Plivo webhook URL:
https://app.snapserve.ai/api/telephony/plivo/inbound/<agent-id>

Vonage webhook URL:
https://app.snapserve.ai/api/telephony/vonage/inbound/<agent-id>`} />
      <ol start={3}>
        <li>Call your phone number. The call routes to your agent immediately.</li>
      </ol>

      <h2 id="step-5-api-access">Step 5 — Access via API</h2>
      <p>
        All SnapServe features are available via a REST API. Authenticate using the session token
        from your browser's localStorage:
      </p>
      <CodeBlock language="javascript" code={`// Get your token after signing in
const token = localStorage.getItem("voiceorch:session");

// List your agents
const res = await fetch("https://app.snapserve.ai/api/agents", {
  headers: { Authorization: \`Bearer \${token}\` }
});
const { agents } = await res.json();`} />

      <CodeBlock language="bash" code={`# Or with curl
curl https://app.snapserve.ai/api/agents \\
  -H "Authorization: Bearer <your-token>"`} />

      <h2 id="next-steps">Next steps</h2>
      <ul>
        <li>Learn all agent configuration options in the <Link href="/docs/agent-builder" className="text-primary hover:underline">Agent Builder guide</Link>.</li>
        <li>Write a better system prompt using the <Link href="/docs/prompting-guide" className="text-primary hover:underline">Prompting Guide</Link>.</li>
        <li>Enable <Link href="/docs/tools" className="text-primary hover:underline">Tools</Link> so your agent can take actions mid-call.</li>
        <li>Run outbound calls at scale with <Link href="/docs/campaigns" className="text-primary hover:underline">Campaigns</Link>.</li>
      </ul>
    </div>
  );
}
