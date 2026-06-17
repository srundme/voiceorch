import { Link } from "wouter";

export default function ProvidersPage() {
  return (
    <div>
      <h1>Providers</h1>
      <p>
        Providers are the third-party AI and telephony services that power your agents. SnapServe
        never bundles its own ASR, LLM, or TTS models — you bring your own API keys and pay
        providers directly. SnapServe charges only for orchestration.
      </p>

      <h2 id="provider-categories">Provider categories</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Role in pipeline</th>
              <th className="px-4 py-3 font-semibold">Supported providers</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["ASR", "Converts caller audio to text in real time", "Deepgram, Azure Speech, OpenAI Whisper"],
              ["LLM", "Generates the agent's responses", "OpenAI, Anthropic, DeepSeek, Mistral, Cohere"],
              ["TTS", "Converts text responses to audio", "ElevenLabs, Cartesia, Azure, AWS Polly, OpenAI, Deepgram Aura"],
              ["Telephony", "Routes inbound/outbound phone calls", "Twilio, Plivo, Vonage"],
            ].map(([cat, role, providers]) => (
              <tr key={cat} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium">{cat}</td>
                <td className="px-4 py-3 text-muted-foreground">{role}</td>
                <td className="px-4 py-3 text-muted-foreground">{providers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="adding-a-provider">Adding a provider</h2>
      <ol>
        <li>Open <strong>Providers</strong> in the sidebar.</li>
        <li>Click <strong>Add Provider</strong>.</li>
        <li>Select the provider category (ASR / LLM / TTS / Telephony).</li>
        <li>Select the specific provider from the dropdown.</li>
        <li>Enter your API key. For some providers (AWS Polly, Azure) additional fields may appear.</li>
        <li>Click <strong>Save</strong>.</li>
      </ol>
      <p>
        Keys are encrypted with AES-256-GCM before being stored in the database. Only the last four
        characters are ever shown in the UI. Provider keys are used server-side by the orchestration
        pipeline — they are never sent to the browser.
      </p>

      <h2 id="key-management">Key management</h2>
      <ul>
        <li>
          <strong>Multiple keys per provider</strong> — You can add multiple keys for the same
          provider. This is useful for separating usage by team, environment, or cost center.
        </li>
        <li>
          <strong>Agent-level assignment</strong> — In the agent builder, you can pin a specific
          provider key to an agent. If no key is pinned, the most recently added key for that
          category is used.
        </li>
        <li>
          <strong>Removing a key</strong> — Deleting a provider key does not affect active calls
          in progress, but agents pinned to that key will fail on the next call. Reassign the
          agent to a different key before deleting.
        </li>
      </ul>

      <h2 id="where-to-get-keys">Where to get API keys</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Provider</th>
              <th className="px-4 py-3 font-semibold">Dashboard URL</th>
              <th className="px-4 py-3 font-semibold">Free tier?</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Deepgram", "console.deepgram.com", "Yes — $200 credit on signup"],
              ["OpenAI Whisper", "platform.openai.com/api-keys", "No — pay-as-you-go"],
              ["Azure Speech", "portal.azure.com", "Yes — 5 hours/month free"],
              ["OpenAI", "platform.openai.com/api-keys", "No — pay-as-you-go"],
              ["Anthropic", "console.anthropic.com", "No — pay-as-you-go"],
              ["DeepSeek", "platform.deepseek.com", "Yes — $5 free credit"],
              ["Mistral", "console.mistral.ai", "Yes — trial credits"],
              ["Cohere", "dashboard.cohere.com", "Yes — trial key"],
              ["ElevenLabs", "elevenlabs.io", "Yes — 10,000 chars/month"],
              ["Cartesia", "cartesia.ai", "Yes — 1M chars/month free"],
              ["AWS Polly", "aws.amazon.com/polly", "Yes — 5M chars/month free (12 months)"],
              ["Deepgram Aura", "console.deepgram.com", "Yes — shared with STT credit"],
              ["Twilio", "console.twilio.com", "Yes — $15 trial credit"],
              ["Plivo", "console.plivo.com", "Yes — trial credit"],
              ["Vonage", "dashboard.nexmo.com", "Yes — trial credit"],
            ].map(([p, url, free]) => (
              <tr key={p} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium">{p}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{url}</td>
                <td className="px-4 py-3 text-muted-foreground">{free}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="deep-dives">Deep dives</h2>
      <ul>
        <li><Link href="/docs/asr-providers" className="text-primary hover:underline">ASR / Speech-to-Text providers</Link> — model options, language support, streaming configuration</li>
        <li><Link href="/docs/llm-providers" className="text-primary hover:underline">LLM providers</Link> — model selection, context window, cost comparison</li>
        <li><Link href="/docs/tts-providers" className="text-primary hover:underline">TTS / Text-to-Speech providers</Link> — voice libraries, latency, multilingual support</li>
        <li><Link href="/docs/telephony-providers" className="text-primary hover:underline">Telephony providers</Link> — inbound/outbound setup, webhook configuration, phone number provisioning</li>
      </ul>
    </div>
  );
}
