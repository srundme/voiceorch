export default function ProvidersPage() {
  return (
    <div>
      <h1>Providers</h1>
      <p>Providers are your API keys for third-party AI and telephony services. SnapServe uses them at runtime to route audio and LLM requests.</p>

      <h2>Supported providers</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-6 py-3 font-semibold">Category</th>
              <th className="px-6 py-3 font-semibold">Providers</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-white/5 hover:bg-white/5">
              <td className="px-6 py-4 font-medium">ASR (Speech-to-Text)</td>
              <td className="px-6 py-4 text-muted-foreground">Deepgram, Azure Speech, OpenAI Whisper</td>
            </tr>
            <tr className="border-b border-white/5 hover:bg-white/5">
              <td className="px-6 py-4 font-medium">LLM (Language Model)</td>
              <td className="px-6 py-4 text-muted-foreground">OpenAI, Anthropic, DeepSeek, Mistral, Cohere</td>
            </tr>
            <tr className="border-b border-white/5 hover:bg-white/5">
              <td className="px-6 py-4 font-medium">TTS (Text-to-Speech)</td>
              <td className="px-6 py-4 text-muted-foreground">ElevenLabs, Cartesia, Azure, AWS Polly, OpenAI, Deepgram</td>
            </tr>
            <tr className="hover:bg-white/5 border-b border-white/5">
              <td className="px-6 py-4 font-medium">Telephony</td>
              <td className="px-6 py-4 text-muted-foreground">Twilio, Plivo, Vonage</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Adding a provider</h2>
      <ol>
        <li>Navigate to Providers in the sidebar</li>
        <li>Click "Add Provider"</li>
        <li>Select the provider type and enter your API key</li>
        <li>Save — the key is encrypted with AES-256-GCM before storage</li>
      </ol>
      <p>Keys are never exposed in the UI beyond the last 4 characters.</p>

      <h2>Provider priority</h2>
      <p>If you have multiple keys for the same provider type, the most recently added key is used by default. You can pin a specific key to an agent in the agent builder.</p>
    </div>
  );
}
