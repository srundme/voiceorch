import { Link } from "wouter";

export default function IntroductionPage() {
  return (
    <div>
      <h1>SnapServe Documentation</h1>
      <p>
        SnapServe is an AI voice agent orchestration platform. You bring your own API keys for any
        combination of speech recognition (ASR), language model (LLM), text-to-speech (TTS), and
        telephony providers — SnapServe handles the real-time orchestration layer between them.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-8">
        {[
          { title: "Platform Concepts", desc: "Understand how agents, providers, and calls fit together", href: "/docs/platform-concepts" },
          { title: "Quick Start", desc: "Create your first working voice agent in under 10 minutes", href: "/docs/quick-start" },
          { title: "Agent Builder", desc: "Detailed walkthrough of every agent configuration option", href: "/docs/agent-builder" },
          { title: "API Reference", desc: "Full REST API documentation with request and response schemas", href: "/docs/api-reference" },
        ].map(card => (
          <Link key={card.href} href={card.href}
            className="block p-5 rounded-xl border border-border bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20 transition-all group">
            <p className="font-semibold text-foreground group-hover:text-primary transition-colors mb-1">{card.title}</p>
            <p className="text-sm text-muted-foreground">{card.desc}</p>
          </Link>
        ))}
      </div>

      <h2 id="what-is-snapserve">What is SnapServe?</h2>
      <p>
        Building a production-grade AI voice agent requires stitching together half a dozen real-time
        systems: a WebSocket bridge to your telephony provider, streaming audio framing, ASR partial
        results, LLM streaming tokens, TTS audio buffering, barge-in detection, tool call execution,
        and graceful session teardown. SnapServe handles all of that so you can focus on the agent's
        persona and business logic.
      </p>
      <p>
        You keep full control over which providers you use and pay for — SnapServe charges only for
        orchestration. There is no lock-in to a specific ASR, LLM, or TTS vendor.
      </p>

      <h2 id="key-capabilities">Key capabilities</h2>
      <ul>
        <li>
          <strong>Multi-provider pipeline</strong> — Mix and match providers per agent. Use Deepgram
          for STT, Anthropic Claude for reasoning, and ElevenLabs for a lifelike voice — all in one agent.
        </li>
        <li>
          <strong>Real-time voice calls</strong> — Sub-second latency orchestration via WebSocket
          bridges to Twilio, Plivo, and Vonage. Browser-based WebCall for testing and web deployments.
        </li>
        <li>
          <strong>Streaming everywhere</strong> — ASR partial results feed the LLM before the
          speaker has finished. LLM streaming tokens feed TTS as they arrive. End-to-end latency under 600 ms on a warm session.
        </li>
        <li>
          <strong>Barge-in detection</strong> — When the caller speaks while the agent is talking,
          audio playback stops immediately and the pipeline restarts listening.
        </li>
        <li>
          <strong>Tool calling</strong> — Agents can call external APIs mid-conversation: check
          calendars, book appointments, look up CRM records, transfer calls, send SMS, and more.
        </li>
        <li>
          <strong>Knowledge base</strong> — Attach documents, FAQs, and product manuals to an agent.
          Relevant passages are retrieved at runtime and injected into the LLM context.
        </li>
        <li>
          <strong>Outbound campaigns</strong> — Upload a lead list, connect an agent, and run batch
          outbound calls with per-call analytics and retry logic.
        </li>
        <li>
          <strong>Scheduling engine</strong> — Multi-tenant booking system with Google Calendar sync,
          availability windows, date overrides, and public booking pages.
        </li>
        <li>
          <strong>Analytics</strong> — Call volume charts, success rate trends, average duration, and
          transcript search across all calls.
        </li>
      </ul>

      <h2 id="supported-providers">Supported providers</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Providers</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["ASR (Speech-to-Text)", "Deepgram, Azure Speech, OpenAI Whisper"],
              ["LLM (Language Model)", "OpenAI, Anthropic, DeepSeek, Mistral, Cohere"],
              ["TTS (Text-to-Speech)", "ElevenLabs, Cartesia, Azure, AWS Polly, OpenAI, Deepgram Aura"],
              ["Telephony", "Twilio, Plivo, Vonage"],
            ].map(([cat, providers]) => (
              <tr key={cat} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium">{cat}</td>
                <td className="px-4 py-3 text-muted-foreground">{providers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="next-steps">Next steps</h2>
      <ul>
        <li>Read <Link href="/docs/platform-concepts" className="text-primary hover:underline">Platform Concepts</Link> to understand the system model.</li>
        <li>Follow the <Link href="/docs/quick-start" className="text-primary hover:underline">Quick Start</Link> to build your first agent.</li>
        <li>Add your API keys on the <Link href="/app/providers" className="text-primary hover:underline">Providers page</Link>.</li>
      </ul>
    </div>
  );
}
