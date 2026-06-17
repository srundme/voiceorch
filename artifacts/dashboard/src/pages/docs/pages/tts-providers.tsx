export default function TtsProvidersPage() {
  return (
    <div>
      <h1>TTS / Text-to-Speech Providers</h1>
      <p>
        SnapServe supports six TTS providers. The choice of voice dramatically affects caller
        experience — it determines how natural, trustworthy, and on-brand the agent sounds.
        All providers stream audio chunks as they generate, so the caller hears audio within
        100–300 ms of the agent starting to speak.
      </p>

      <h2 id="comparison">Provider comparison</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Provider</th>
              <th className="px-4 py-3 font-semibold">Voice quality</th>
              <th className="px-4 py-3 font-semibold">Latency</th>
              <th className="px-4 py-3 font-semibold">Languages</th>
              <th className="px-4 py-3 font-semibold">Cost / 1M chars</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["ElevenLabs", "Best-in-class, very natural", "~200 ms", "29+", "$11–$330"],
              ["Cartesia Sonic", "Excellent, fastest streaming", "~100 ms", "15+", "$65"],
              ["Azure Neural", "Enterprise-grade, widest coverage", "~180 ms", "140+", "$16"],
              ["AWS Polly (Neural)", "Solid, widely used", "~200 ms", "60+", "$16"],
              ["OpenAI TTS", "Natural, simple API", "~250 ms", "57 (via multilingual)", "$15"],
              ["Deepgram Aura", "Good for phone audio", "~120 ms", "English (US/UK/AU)", "$7.50"],
            ].map(([p, q, l, lang, c]) => (
              <tr key={p} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium">{p}</td>
                <td className="px-4 py-3 text-muted-foreground">{q}</td>
                <td className="px-4 py-3 text-muted-foreground">{l}</td>
                <td className="px-4 py-3 text-muted-foreground">{lang}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="elevenlabs">ElevenLabs</h2>
      <p>
        ElevenLabs produces the most natural-sounding AI voices available today. Their library
        includes hundreds of voices across ages, accents, and tones — including several Indian
        English voices. They also support voice cloning if you want a proprietary brand voice.
      </p>
      <p><strong>Getting a key:</strong> Sign up at <code>elevenlabs.io</code> — 10,000 characters free per month.</p>
      <h3>Popular voices for India</h3>
      <div className="my-4 flex flex-wrap gap-2">
        {["Rachel (en-US, warm)", "Priya (en-IN, professional)", "Aarav (en-IN, friendly)", "Charlotte (en-GB, clear)", "Adam (en-US, authoritative)"].map(v => (
          <span key={v} className="text-xs px-2.5 py-1 rounded-full border border-border bg-white/5 text-muted-foreground">{v}</span>
        ))}
      </div>
      <p>Browse all voices at <code>elevenlabs.io/voice-library</code>. Copy the Voice ID and paste it into the TTS Voice field in the agent builder.</p>

      <h2 id="cartesia">Cartesia Sonic</h2>
      <p>
        Cartesia Sonic has the lowest latency of any TTS provider supported by SnapServe — first
        audio chunk arrives in under 100 ms. Voice quality is excellent, slightly below ElevenLabs'
        best premium voices but imperceptible on phone call audio. Ideal when latency is the
        primary concern.
      </p>
      <p><strong>Getting a key:</strong> Sign up at <code>cartesia.ai</code> — 1 million characters per month free.</p>
      <h3>Recommended voices</h3>
      <div className="my-4 flex flex-wrap gap-2">
        {["Barbra (warm, professional)", "Chloe (clear, friendly)", "Archer (deep, authoritative)", "Aria (conversational)"].map(v => (
          <span key={v} className="text-xs px-2.5 py-1 rounded-full border border-border bg-white/5 text-muted-foreground">{v}</span>
        ))}
      </div>

      <h2 id="azure">Azure Neural TTS</h2>
      <p>
        Azure has the widest language and locale coverage of any provider — 140+ languages including
        comprehensive Indic language support with neural voices. Use Azure TTS when you need
        Hindi, Tamil, Telugu, Marathi, or other regional language voices.
      </p>
      <p><strong>Getting a key:</strong> Same key and region as Azure Speech (ASR) — you can use a single Azure Speech resource for both STT and TTS.</p>
      <h3>Indic language voices (Azure)</h3>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Language</th>
              <th className="px-4 py-3 font-semibold">Voice name</th>
              <th className="px-4 py-3 font-semibold">Gender</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Hindi (hi-IN)", "hi-IN-SwaraNeural", "Female"],
              ["Hindi (hi-IN)", "hi-IN-MadhurNeural", "Male"],
              ["Tamil (ta-IN)", "ta-IN-PallaviNeural", "Female"],
              ["Telugu (te-IN)", "te-IN-ShrutiNeural", "Female"],
              ["Marathi (mr-IN)", "mr-IN-AarohiNeural", "Female"],
              ["Bengali (bn-IN)", "bn-IN-TanishaaNeural", "Female"],
              ["Gujarati (gu-IN)", "gu-IN-DhwaniNeural", "Female"],
              ["Kannada (kn-IN)", "kn-IN-SapnaNeural", "Female"],
              ["Malayalam (ml-IN)", "ml-IN-SobhanaNeural", "Female"],
            ].map(([l, v, g]) => (
              <tr key={v} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 text-muted-foreground">{l}</td>
                <td className="px-4 py-3 font-mono text-xs text-foreground/80">{v}</td>
                <td className="px-4 py-3 text-muted-foreground">{g}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="aws-polly">AWS Polly (Neural)</h2>
      <p>
        AWS Polly's Neural TTS produces natural-sounding speech with broad language coverage.
        Use Neural voices rather than Standard voices for best quality. Polly integrates with AWS
        infrastructure, making it a good fit if you're already running workloads on AWS.
      </p>
      <p><strong>Getting a key:</strong> Create an AWS IAM user with Polly permissions and generate an access key. You'll need <code>AWS_ACCESS_KEY_ID</code>, <code>AWS_SECRET_ACCESS_KEY</code>, and an AWS region.</p>

      <h2 id="openai-tts">OpenAI TTS</h2>
      <p>
        OpenAI offers two TTS models: <code>tts-1</code> (lower latency, for real-time use) and
        <code>tts-1-hd</code> (higher quality, for non-real-time). For voice agents, always use
        <code>tts-1</code>. Six built-in voices are available: Alloy, Echo, Fable, Onyx, Nova, Shimmer.
      </p>
      <p><strong>Getting a key:</strong> Use your existing OpenAI API key — TTS is billed to the same account as your LLM usage.</p>

      <h2 id="deepgram-aura">Deepgram Aura</h2>
      <p>
        Deepgram's Aura TTS model is optimised for telephony audio quality — low latency and
        natural-sounding output on 8 kHz phone lines. If you're already using Deepgram for ASR,
        Aura shares the same key and billing account, simplifying your setup.
      </p>
      <p>Currently English-only (US, UK, Australian accents). Supports Aura-2 (latest) and Aura (legacy).</p>

      <h2 id="choosing">Recommendations</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Situation</th>
              <th className="px-4 py-3 font-semibold">Recommended provider</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Best overall voice quality (English)", "ElevenLabs"],
              ["Lowest latency", "Cartesia Sonic"],
              ["Hindi / Indic language voice", "Azure Neural (hi-IN-SwaraNeural etc.)"],
              ["Already using Deepgram ASR", "Deepgram Aura (same billing)"],
              ["AWS-only deployment", "AWS Polly Neural"],
              ["Simple setup, OpenAI key already added", "OpenAI TTS (tts-1)"],
            ].map(([s, p]) => (
              <tr key={s} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 text-muted-foreground">{s}</td>
                <td className="px-4 py-3 font-medium">{p}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
