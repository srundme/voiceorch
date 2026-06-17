import { Link } from "wouter";

export default function LlmProvidersPage() {
  return (
    <div>
      <h1>LLM Providers</h1>
      <p>
        The language model drives the agent's reasoning, persona, and tool calling. SnapServe
        supports five LLM providers. All are used in streaming mode — tokens arrive and are fed to
        TTS as they generate, minimising the time before the caller hears the response.
      </p>

      <h2 id="comparison">Model comparison</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Model</th>
              <th className="px-4 py-3 font-semibold">Provider</th>
              <th className="px-4 py-3 font-semibold">Best for</th>
              <th className="px-4 py-3 font-semibold">TTFT</th>
              <th className="px-4 py-3 font-semibold">Context</th>
              <th className="px-4 py-3 font-semibold">Input cost / 1M</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["gpt-4o-mini", "OpenAI", "Cost-effective voice agents", "~350 ms", "128K", "$0.15"],
              ["gpt-4o", "OpenAI", "Complex reasoning + tool calling", "~500 ms", "128K", "$2.50"],
              ["claude-haiku-3-5", "Anthropic", "Fastest Anthropic, great instructions", "~300 ms", "200K", "$0.80"],
              ["claude-sonnet-3-5", "Anthropic", "Balanced quality and speed", "~450 ms", "200K", "$3.00"],
              ["deepseek-v3", "DeepSeek", "Lowest cost, strong reasoning", "~400 ms", "128K", "$0.07"],
              ["deepseek-r1", "DeepSeek", "Complex multi-step reasoning", "~600 ms", "128K", "$0.55"],
              ["mistral-large", "Mistral", "European data residency", "~400 ms", "128K", "$2.00"],
              ["mistral-small", "Mistral", "Fast European-hosted model", "~300 ms", "32K", "$0.20"],
              ["command-r-plus", "Cohere", "RAG + grounded generation", "~500 ms", "128K", "$2.50"],
              ["command-r", "Cohere", "Fast + knowledge base use cases", "~350 ms", "128K", "$0.15"],
            ].map(([m, p, b, t, ctx, c]) => (
              <tr key={m} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs text-foreground/80">{m}</td>
                <td className="px-4 py-3 text-muted-foreground">{p}</td>
                <td className="px-4 py-3 text-muted-foreground">{b}</td>
                <td className="px-4 py-3 text-muted-foreground">{t}</td>
                <td className="px-4 py-3 text-muted-foreground">{ctx}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground/60">
        TTFT = Time to first token. Costs are approximate and subject to provider changes.
        Check each provider's pricing page for current rates.
      </p>

      <h2 id="openai">OpenAI</h2>
      <p>
        OpenAI's models have the best-in-class tool calling reliability and instruction following,
        making them the safest default for new agents. GPT-4o-mini is the best choice when you want
        low cost and fast response times without sacrificing tool calling accuracy.
      </p>
      <p><strong>Getting a key:</strong> <code>platform.openai.com/api-keys</code></p>
      <ul>
        <li><strong>gpt-4o-mini</strong> — Recommended for most voice agents. Fast, cheap, great tool calling.</li>
        <li><strong>gpt-4o</strong> — Use when you need the highest reasoning quality or very complex tool call chains.</li>
        <li><strong>gpt-4o-realtime-preview</strong> — OpenAI's native real-time audio model. Not yet supported via SnapServe pipeline — coming soon.</li>
      </ul>

      <h2 id="anthropic">Anthropic</h2>
      <p>
        Claude models excel at following nuanced instructions and staying in character. The Claude
        Haiku 3.5 model is fast enough for voice and considerably better at instruction adherence
        than comparably-priced OpenAI models — particularly useful for agents with complex persona
        and escalation rules.
      </p>
      <p><strong>Getting a key:</strong> <code>console.anthropic.com</code></p>
      <ul>
        <li><strong>claude-haiku-3-5</strong> — Best for voice. Lowest latency Anthropic model, very strong at following voice-specific instructions.</li>
        <li><strong>claude-sonnet-3-5</strong> — Use for complex use cases requiring deeper reasoning while still being fast enough for voice.</li>
        <li><strong>claude-opus-4</strong> — Highest quality but slower. Not recommended for real-time voice calls.</li>
      </ul>

      <h2 id="deepseek">DeepSeek</h2>
      <p>
        DeepSeek V3 is the lowest-cost LLM option with strong English and Mandarin capability.
        Particularly well-suited for structured data extraction and logic-heavy use cases. DeepSeek
        R1 adds chain-of-thought reasoning for complex multi-step problems — it is slower but
        useful for high-stakes decision-making agents.
      </p>
      <p><strong>Getting a key:</strong> <code>platform.deepseek.com</code> — new accounts get $5 free credit.</p>
      <ul>
        <li><strong>deepseek-v3</strong> — Best value for money. Comparable to GPT-4o-mini quality at ~10x lower cost.</li>
        <li><strong>deepseek-r1</strong> — For agents that need to reason through complex logic before responding.</li>
      </ul>

      <h2 id="mistral">Mistral</h2>
      <p>
        Mistral models run on EU-hosted infrastructure — useful when data processing must stay within
        European boundaries. Mistral Small is fast and cost-effective; Mistral Large is comparable
        to GPT-4o quality.
      </p>
      <p><strong>Getting a key:</strong> <code>console.mistral.ai</code></p>

      <h2 id="cohere">Cohere</h2>
      <p>
        Cohere's Command R models are optimised for retrieval-augmented generation. If your agent
        uses a large knowledge base, Cohere's models tend to ground their responses to retrieved
        content more reliably than other providers — reducing hallucination in knowledge base
        answering scenarios.
      </p>
      <p><strong>Getting a key:</strong> <code>dashboard.cohere.com</code></p>

      <h2 id="choosing">Recommendations by use case</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Use case</th>
              <th className="px-4 py-3 font-semibold">Recommended model</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["General support / FAQ bot", "gpt-4o-mini or deepseek-v3"],
              ["Complex persona, strict instructions", "claude-haiku-3-5"],
              ["Lead qualification + appointment booking", "gpt-4o-mini"],
              ["Knowledge base heavy (lots of documents)", "command-r or claude-haiku-3-5"],
              ["Lowest possible cost", "deepseek-v3"],
              ["European data residency required", "mistral-small or mistral-large"],
              ["Multi-step reasoning, complex decisions", "deepseek-r1 or claude-sonnet-3-5"],
            ].map(([u, m]) => (
              <tr key={u} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 text-muted-foreground">{u}</td>
                <td className="px-4 py-3 font-mono text-xs text-foreground/80">{m}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        See the <Link href="/docs/prompting-guide" className="text-primary hover:underline">Prompting Guide</Link> for
        how to configure LLM settings (temperature, max tokens) for voice-optimised responses.
      </p>
    </div>
  );
}
