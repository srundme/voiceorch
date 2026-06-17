import { CodeBlock } from "../CodeBlock";

export default function AsrProvidersPage() {
  return (
    <div>
      <h1>ASR / Speech-to-Text Providers</h1>
      <p>
        SnapServe supports three ASR providers. The provider you choose affects accuracy, latency,
        language support, and cost. All three stream partial transcripts in real time — the
        differences are in model quality and feature set.
      </p>

      <h2 id="comparison">Provider comparison</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Provider</th>
              <th className="px-4 py-3 font-semibold">Best for</th>
              <th className="px-4 py-3 font-semibold">Languages</th>
              <th className="px-4 py-3 font-semibold">Latency</th>
              <th className="px-4 py-3 font-semibold">Cost (per min)</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Deepgram Nova-3", "Indian English, Indic languages, speed", "30+", "~150 ms", "$0.0043"],
              ["Azure Speech", "Enterprise, data residency, 100+ locales", "100+", "~200 ms", "$0.016"],
              ["OpenAI Whisper", "Accuracy-first, non-real-time acceptable", "57+", "~500 ms", "$0.006"],
            ].map(([p, b, l, lat, c]) => (
              <tr key={p} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium">{p}</td>
                <td className="px-4 py-3 text-muted-foreground">{b}</td>
                <td className="px-4 py-3 text-muted-foreground">{l}</td>
                <td className="px-4 py-3 text-muted-foreground">{lat}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="deepgram">Deepgram</h2>
      <p>
        Deepgram is the recommended ASR provider for most SnapServe use cases. Nova-3 is their
        latest streaming model and delivers the lowest latency for real-time voice applications.
        It has excellent accuracy for Indian English and supports Indic languages natively.
      </p>
      <p><strong>Getting a key:</strong> Sign up at <code>console.deepgram.com</code> — new accounts get $200 in free credit.</p>

      <h3>Available models</h3>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Model</th>
              <th className="px-4 py-3 font-semibold">Use case</th>
              <th className="px-4 py-3 font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["nova-3", "General purpose, recommended", "Best accuracy + latency balance. Supports code-switching (English ↔ Hindi mid-sentence)."],
              ["nova-2", "Proven production model", "Slightly older than Nova-3 but very stable. Good for Indic languages."],
              ["nova-2-phonecall", "Phone call audio quality", "Optimised for 8 kHz µ-law audio from telephony bridges. Use for Twilio/Plivo/Vonage."],
              ["enhanced", "Legacy, higher accuracy", "Slower than Nova models. Only recommended if Nova-3 has specific accuracy issues."],
              ["base", "Lowest cost", "Fastest but least accurate. Use for high-volume, low-stakes use cases."],
            ].map(([m, u, n]) => (
              <tr key={m} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs text-foreground/80">{m}</td>
                <td className="px-4 py-3 text-muted-foreground">{u}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Supported Indic languages (Nova-3)</h3>
      <div className="my-4 flex flex-wrap gap-2">
        {["Hindi (hi)", "Bengali (bn)", "Tamil (ta)", "Telugu (te)", "Marathi (mr)", "Gujarati (gu)", "Kannada (kn)", "Malayalam (ml)", "Punjabi (pa)", "Urdu (ur)"].map(l => (
          <span key={l} className="text-xs px-2.5 py-1 rounded-full border border-border bg-white/5 text-muted-foreground">{l}</span>
        ))}
      </div>

      <h2 id="azure">Azure Speech</h2>
      <p>
        Azure Speech Service is ideal for enterprise deployments with data residency requirements,
        compliance needs, or when you need the widest possible language coverage (100+ locales).
      </p>
      <p><strong>Getting a key:</strong> Create an Azure account and provision a Speech Service resource in the Azure Portal. You will need the resource key and region.</p>

      <div className="my-4 p-4 rounded-xl border border-border bg-white/[0.02]">
        <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">Azure configuration fields</p>
        <div className="space-y-2 text-sm">
          <div className="flex gap-4">
            <span className="font-mono text-xs text-foreground/70 w-28 shrink-0">API Key</span>
            <span className="text-muted-foreground">The Speech resource key from Azure Portal</span>
          </div>
          <div className="flex gap-4">
            <span className="font-mono text-xs text-foreground/70 w-28 shrink-0">Region</span>
            <span className="text-muted-foreground">Azure region (e.g. eastus, southeastasia, centralindia)</span>
          </div>
          <div className="flex gap-4">
            <span className="font-mono text-xs text-foreground/70 w-28 shrink-0">Locale</span>
            <span className="text-muted-foreground">Language locale (e.g. en-IN, hi-IN, ta-IN)</span>
          </div>
        </div>
      </div>

      <h3>Recommended Azure locales for India</h3>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Locale code</th>
              <th className="px-4 py-3 font-semibold">Language</th>
            </tr>
          </thead>
          <tbody>
            {[["en-IN", "English (India)"], ["hi-IN", "Hindi"], ["ta-IN", "Tamil"], ["te-IN", "Telugu"], ["mr-IN", "Marathi"], ["bn-IN", "Bengali"], ["gu-IN", "Gujarati"], ["kn-IN", "Kannada"], ["ml-IN", "Malayalam"]].map(([c, l]) => (
              <tr key={c} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs">{c}</td>
                <td className="px-4 py-3 text-muted-foreground">{l}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="whisper">OpenAI Whisper</h2>
      <p>
        Whisper is OpenAI's speech recognition model, available via their API. It has strong
        multilingual accuracy and handles accented speech well, but has higher latency than Deepgram
        (~400–600 ms per transcript segment) — making it less suitable for ultra-low-latency
        conversational agents.
      </p>
      <p>
        Use Whisper when accuracy is more important than speed, or for transcription tasks where
        you're processing pre-recorded audio rather than live calls.
      </p>
      <p><strong>Getting a key:</strong> Use your existing OpenAI API key at <code>platform.openai.com/api-keys</code>. Whisper is billed separately from GPT models.</p>
      <CodeBlock language="text" code={`Model: whisper-1
Cost: $0.006 / minute
Supported languages: 57 (auto-detected if not specified)
Audio formats: mp3, mp4, mpeg, mpga, m4a, wav, webm`} />

      <h2 id="choosing">Choosing a provider</h2>
      <ul>
        <li><strong>Most use cases:</strong> Deepgram Nova-3</li>
        <li><strong>Indian English or Indic languages:</strong> Deepgram Nova-3 (or nova-2 for stability)</li>
        <li><strong>Maximum language coverage:</strong> Azure Speech</li>
        <li><strong>Enterprise / data residency:</strong> Azure Speech with India region (<code>centralindia</code>)</li>
        <li><strong>Highest accuracy, latency not critical:</strong> OpenAI Whisper</li>
        <li><strong>Telephony bridge audio (8 kHz µ-law):</strong> Deepgram nova-2-phonecall</li>
      </ul>
    </div>
  );
}
