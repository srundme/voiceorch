import { CodeBlock } from "../CodeBlock";

export default function QuickStartPage() {
  return (
    <div>
      <h1>Get an agent live in 5 minutes</h1>
      
      <ol>
        <li><strong>Add a provider key</strong> — Go to Providers → Add Provider. Select your ASR, LLM, TTS, and telephony provider and enter your API key. Keys are encrypted at rest.</li>
        <li><strong>Create an agent</strong> — Go to Agents → New Agent. Set a name, system prompt, and wire up your providers.</li>
        <li><strong>Configure the voice</strong> — In the agent builder, select a TTS voice and optionally enable multilingual detection.</li>
        <li><strong>Test with WebCall</strong> — Click the phone icon in the agent detail page to open a browser-based WebCall session. Talk to your agent live.</li>
        <li><strong>Go live</strong> — Connect a phone number (Providers → Telephony) and attach it to your agent. Calls now route through SnapServe.</li>
      </ol>

      <h2>Code example — making your first API call:</h2>
      <CodeBlock code={`# Fetch your agents
curl https://app.snapserve.ai/api/agents \\
  -H "Authorization: Bearer <your-session-token>"`} language="bash" />
    </div>
  );
}
