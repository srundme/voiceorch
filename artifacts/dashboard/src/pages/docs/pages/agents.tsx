export default function AgentsPage() {
  return (
    <div>
      <h1>Agents</h1>
      <p>An agent is the core unit in SnapServe. It defines the full voice pipeline: how speech is transcribed, how the language model reasons, and how responses are spoken.</p>

      <h2>Pipeline components</h2>
      <ul>
        <li><strong>Transcriber (ASR)</strong> — Converts caller speech to text. Choose from Deepgram (Nova-2, Nova-3), Azure, or Whisper.</li>
        <li><strong>Model (LLM)</strong> — Reasons over the transcript and generates a response. Supports OpenAI, Anthropic, DeepSeek, Mistral, and Cohere.</li>
        <li><strong>Voice (TTS)</strong> — Synthesizes text into speech. Supports ElevenLabs, Cartesia, Azure, AWS Polly, OpenAI TTS, and Deepgram.</li>
        <li><strong>Telephony</strong> — Routes inbound/outbound calls. Supports Twilio, Plivo, and Vonage.</li>
      </ul>

      <h2>Agent settings</h2>
      <ul>
        <li><strong>System prompt</strong> — Instructions for the LLM. Supports variable injection with <code>{`{{variable_name}}`}</code>.</li>
        <li><strong>Language</strong> — Primary language for the agent. Enables language-aware TTS voice selection.</li>
        <li><strong>Silence timeout</strong> — Seconds of silence before the agent hangs up (0 = never).</li>
        <li><strong>Max duration</strong> — Maximum call length in seconds.</li>
        <li><strong>Tools</strong> — Functions the agent can call: book_appointment, check_availability, end_call, transfer_call, send_webhook.</li>
      </ul>

      <h2>Knowledge base</h2>
      <p>Attach knowledge sources (plain text documents) to an agent. The agent uses semantic search to pull relevant excerpts into context before generating a response.</p>

      <h2>Agent status</h2>
      <p>Agents are either active or inactive. Inactive agents reject inbound calls.</p>

      <h2>Versions</h2>
      <p>Every time you save an agent, a version snapshot is created. Roll back to any previous version from the agent detail page.</p>
    </div>
  );
}
