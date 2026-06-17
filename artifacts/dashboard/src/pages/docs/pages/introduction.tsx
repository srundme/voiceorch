export default function IntroductionPage() {
  return (
    <div>
      <h1>SnapServe Documentation</h1>
      <p>
        SnapServe is the orchestration layer for AI voice agents. You bring your API keys for any combination of ASR, LLM, TTS, and telephony provider — SnapServe handles real-time audio routing, session management, tool calling, and analytics.
      </p>

      <h2>Key capabilities</h2>
      <ul>
        <li><strong>Multi-provider pipeline</strong> — Mix and match providers per agent. Use Deepgram for STT, Anthropic for reasoning, and ElevenLabs for voice.</li>
        <li><strong>Real-time voice calls</strong> — Sub-second latency orchestration with WebSocket-based telephony bridges (Twilio, Plivo, Vonage) and browser-based WebCall.</li>
        <li><strong>Tool calling</strong> — Agents can check calendars, book appointments, transfer calls, and run custom webhooks mid-conversation.</li>
        <li><strong>Outbound campaigns</strong> — Upload lead lists, configure dial-in logic, and run batch outbound call campaigns with full analytics.</li>
        <li><strong>Scheduling engine</strong> — Multi-tenant booking system with Google Calendar sync, availability windows, and public booking pages.</li>
        <li><strong>Knowledge base</strong> — Attach text knowledge sources to agents for retrieval-augmented responses.</li>
      </ul>
    </div>
  );
}
