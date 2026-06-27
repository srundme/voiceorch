import type { Chapter } from "../types";

export const adapterPattern: Chapter = {
  slug: "adapter-pattern",
  moduleId: "m5",
  number: "6.1",
  title: "The Adapter Pattern: One Interface, Many Vendors",
  summary:
    "The design trick that lets SnapServe swap OpenAI for DeepSeek, or Deepgram for Azure, without changing the pipeline.",
  estMinutes: 16,
  fileRef: "artifacts/api-server/src/orchestration/types.ts",
  prerequisites: ["session-and-pipeline"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "A SnapServe agent is really three AI services glued together: something that turns the caller's voice into **text** (STT), something that **thinks** of a reply (LLM), and something that turns that reply back into **speech** (TTS). For each of those three jobs there are a dozen competing vendors — Deepgram, Azure, Sarvam for speech recognition; OpenAI, Anthropic, DeepSeek, Sarvam for the brain; ElevenLabs, Cartesia, OpenAI for the voice.",
        "Here's the problem: every vendor's API is different. Deepgram speaks one WebSocket dialect, Sarvam another. OpenAI streams tokens one way, Google another. If the call pipeline had to know all those differences, it would be a tangled mess of `if (provider === \"deepgram\")` branches — and adding a new vendor would mean rewriting the heart of the system.",
        "The **adapter pattern** is the trick that saves us. We define ONE shared interface per job, then write a thin wrapper (an 'adapter') around each vendor that makes it conform to that interface. The pipeline only ever talks to the interface. It never knows — or cares — which vendor is on the other side.",
      ],
    },
    {
      kind: "concept",
      title: "What is the adapter pattern?",
      body: [
        "An **interface** in TypeScript is a contract: a list of method names and their shapes, with no implementation. It says *what* something can do, never *how*. The `LLMAdapter` interface, for example, promises a single `chat(...)` method — but says nothing about whether OpenAI or DeepSeek is behind it.",
        "An **adapter** is a class that `implements` an interface by wrapping some messy real-world thing and exposing it through the clean contract. The `OpenAILLM` class wraps the OpenAI SDK; the `DeepSeekLLM` class wraps DeepSeek's HTTP endpoint. Both satisfy `LLMAdapter`, so to the pipeline they are interchangeable.",
        "The payoff is **polymorphism**: code written against the interface works with any implementation. The pipeline calls `this.llm.chat(...)` and the right vendor responds — whichever one the agent was configured with. Swapping vendors becomes a one-line config change, not a code change.",
      ],
    },
    {
      kind: "analogy",
      title: "The universal travel plug",
      body: [
        "You land in a new country and your laptop charger doesn't fit the wall socket. You don't rewire your laptop — you snap on a **travel adapter**. The laptop side is always the same; the wall side changes per country. The adapter bridges the two.",
        "SnapServe's pipeline is the laptop: it always expects the same shape of plug (`transcribe`, `chat`, `synthesize`). Each vendor is a different country's wall socket. The adapter classes are the little plugs that make any vendor fit the one socket the pipeline knows.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/types.ts",
      language: "typescript",
      intro:
        "Here are the two simplest contracts, side by side. Notice they describe behaviour only — no vendor names, no URLs, no HTTP.",
      code: `export interface LLMAdapter {
  chat(
    messages: ConversationTurn[],
    systemPrompt: string,
    onToken: (token: string) => void,
    onDone: (fullText: string, usage?: LLMUsage) => void,
    options?: {
      tools?: ToolDefinition[];
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
      onUsage?: (usage: LLMUsage) => void;
      kvCache?: boolean;
    }
  ): Promise<void>;
}

export interface TTSAdapter {
  synthesize(text: string): Promise<{ audio: Buffer; characters: number }>;
  synthesizeStream?(
    text: string,
    onChunk: (chunk: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal
  ): Promise<void>;
}`,
      lines: [
        {
          lines: "1-14",
          label: "interface LLMAdapter",
          explanation:
            "Every LLM vendor must offer a single `chat` method. It takes the conversation, a system prompt, and two callbacks: `onToken` (fired per streamed word) and `onDone` (fired once at the end). The pipeline supplies these callbacks; the adapter calls them. This is the whole brain contract.",
        },
        {
          lines: "8-12",
          label: "the options bag",
          explanation:
            "Optional, advanced features live in an `options?` object so simple adapters can ignore them. `tools` + `onToolCall` enable function-calling (next chapter); `onUsage` reports token counts for billing; `kvCache` is an Anthropic-only optimization. The `?` means 'may be absent.'",
        },
        {
          lines: "16-24",
          label: "interface TTSAdapter",
          explanation:
            "Two methods: `synthesize` returns the full audio at once, and the optional `synthesizeStream?` streams audio chunks as they're generated for lower latency. The `?` means an adapter can skip streaming and the pipeline will fall back to the batch method.",
        },
        {
          lines: "17",
          label: "the return shape",
          explanation:
            "`Promise<{ audio: Buffer; characters: number }>` — the audio bytes plus how many characters were submitted. That character count flows straight into billing, so it's baked into the contract every vendor must honour.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/base.ts",
      language: "typescript",
      intro:
        "The speech-to-text contract lives in its own `base.ts`. It's a little richer because live transcription needs streaming, language detection, and timing metadata.",
      code: `export interface STTAdapter {
  transcribe(audioBuffer: Buffer, sampleRate?: number): Promise<string>;
  transcribeStream?(
    onTranscript: (text: string, isFinal: boolean, detectedLanguage?: string, metadata?: SttFinalMetadata) => void,
    onClose?: () => void,
  ): StreamSTT;
}`,
      lines: [
        {
          lines: "2",
          label: "transcribe",
          explanation:
            "The batch method: hand it a buffer of audio, get back a string of text. Simple, one-shot. Used as a safety fallback when live streaming isn't available.",
        },
        {
          lines: "3-6",
          label: "transcribeStream?",
          explanation:
            "The streaming method: instead of returning text, it takes an `onTranscript` callback fired repeatedly as words are recognized. `isFinal` distinguishes a polished final transcript from a rough interim guess. It returns a `StreamSTT` handle the pipeline uses to push audio in and close the stream.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Narrow interface, infinite vendors",
      body: [
        "Notice how *small* these contracts are. `LLMAdapter` has exactly one method. `TTSAdapter` has two. That narrowness is the point: the fewer things a vendor must implement, the easier it is to add a new one — and the less the pipeline can accidentally depend on a vendor-specific quirk.",
        "This is why SnapServe supports **eleven** LLM providers, **five** STT providers, and **six** TTS providers without the pipeline ballooning in complexity. Each new vendor is just one more small class.",
      ],
    },
    {
      kind: "concept",
      title: "The factory: turning a config string into an adapter",
      body: [
        "If the pipeline never names a vendor, who decides which class to build? A **factory function**. The agent's config carries a plain string like `\"openai\"` or `\"deepseek\"`; the factory maps that string to the right adapter class and returns it typed as the interface.",
        "This is the one — and only — place in the whole system where vendor names are written down. Everything downstream sees only the interface. Add a vendor here, and it's instantly available everywhere.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/index.ts",
      language: "typescript",
      intro:
        "The LLM factory. A giant `switch` is the entire vendor-selection logic for the brain of every call.",
      code: `export function createLLMAdapter(
  provider: string,
  apiKey: string,
  model: string | null,
  baseUrl?: string,
  genParams?: LLMGenerationParams
): LLMAdapter {
  if (STUB_PROVIDERS_ENABLED) return createStubLLM();
  switch (provider.toLowerCase()) {
    case "openai":
      return new OpenAILLM(apiKey, model);
    // …
    case "deepseek":
      return new DeepSeekLLM(apiKey, model);
    case "anthropic":
    case "claude":
      return new AnthropicLLM(apiKey, model);
    // …
    default:
      throw new Error(\`Unknown LLM provider: \${provider}\`);
  }
}`,
      lines: [
        {
          lines: "1-7",
          label: "the signature",
          explanation:
            "Takes everything an adapter might need — provider name, API key, model — and crucially **returns `LLMAdapter`**, the interface, never a concrete class. Callers can't tell which vendor came back.",
        },
        {
          lines: "8",
          label: "STUB_PROVIDERS_ENABLED",
          explanation:
            "A test escape hatch: when load-testing, every provider returns a fake stub instead of hitting a real API. Because everything is behind the interface, the pipeline doesn't notice the difference — that's the adapter pattern paying off.",
        },
        {
          lines: "9-10",
          label: "switch on provider.toLowerCase()",
          explanation:
            "The config string drives the choice. `.toLowerCase()` makes `\"OpenAI\"` and `\"openai\"` both work. Each `case` constructs one concrete adapter.",
        },
        {
          lines: "13-16",
          label: "two cases, one class",
          explanation:
            "`\"anthropic\"` and `\"claude\"` both build `AnthropicLLM` — falling through to share the same return. Aliases like this let the UI use friendly names while the factory normalizes them.",
        },
        {
          lines: "18-19",
          label: "default → throw",
          explanation:
            "An unknown provider string is a configuration error, so the factory throws immediately rather than silently doing nothing. Fail loud, fail early.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "The factory is the only place vendor names appear",
      body: [
        "If you ever find yourself writing `if (provider === \"deepgram\")` inside the pipeline, stop — that's a leak. The whole value of the pattern is that vendor knowledge stays trapped inside the adapter classes and the factory. The pipeline stores `this.llm`, `this.stt`, `this.tts` typed as interfaces and forgets the rest.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "The pipeline holds three interface-typed slots; three factories fill them from config. Click a box to dive into that vendor family.",
      nodes: [
        { id: "pipeline", label: "OrchestrationPipeline", sublabel: "talks to interfaces only", chapterSlug: "session-and-pipeline" },
        { id: "interfaces", label: "STTAdapter / LLMAdapter / TTSAdapter", sublabel: "types.ts — THE CONTRACTS", current: true },
        { id: "sttFactory", label: "createSTTAdapter()", sublabel: "picks a speech vendor", chapterSlug: "stt-adapters" },
        { id: "llmFactory", label: "createLLMAdapter()", sublabel: "picks a brain vendor", chapterSlug: "llm-adapters" },
        { id: "ttsFactory", label: "createTTSAdapter()", sublabel: "picks a voice vendor", chapterSlug: "tts-adapters" },
        { id: "fallback", label: "Fallback chains", sublabel: "swap in a backup on failure", chapterSlug: "fallback-chains" },
      ],
      edges: [
        { from: "pipeline", to: "interfaces", label: "calls methods on" },
        { from: "interfaces", to: "sttFactory", label: "implemented by" },
        { from: "interfaces", to: "llmFactory", label: "implemented by" },
        { from: "interfaces", to: "ttsFactory", label: "implemented by" },
        { from: "llmFactory", to: "fallback", label: "primary + backup" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What does the `createLLMAdapter` factory return?",
          choices: [
            "A concrete class like `OpenAILLM`.",
            "The `LLMAdapter` interface type — the caller can't tell which vendor it is.",
            "A JSON config object.",
            "A WebSocket connection.",
          ],
          correctIndex: 1,
          explanation:
            "The factory returns the interface type. That's what makes vendors interchangeable: the pipeline holds an `LLMAdapter` and never learns which concrete class is behind it.",
        },
        {
          prompt: "Why does `LLMAdapter` describe `chat` but contain no HTTP or vendor code?",
          choices: [
            "TypeScript forbids HTTP in interfaces.",
            "An interface is a contract — it declares *what* methods exist, never *how* they work; the 'how' lives in each adapter class.",
            "It's an unfinished file.",
            "HTTP is added later by the compiler.",
          ],
          correctIndex: 1,
          explanation:
            "Interfaces are pure contracts. The implementation (HTTP calls, SDK usage, streaming) lives in concrete classes like `OpenAILLM` and `DeepSeekLLM` that `implements LLMAdapter`.",
        },
        {
          prompt: "An agent is configured with `llmProvider: \"deepseek\"`. To make this work, what had to change in the pipeline's turn loop?",
          choices: [
            "A new `if (provider === \"deepseek\")` branch in the loop.",
            "Nothing — the loop calls `this.llm.chat(...)`, and the factory already maps the string to `DeepSeekLLM`.",
            "The TTS code.",
            "A database migration.",
          ],
          correctIndex: 1,
          explanation:
            "Adding DeepSeek only touched the adapter class and the factory's switch. The pipeline calls the interface method and is none the wiser — that's the whole point of the pattern.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "An interface is a contract (what); an adapter is a class that implements it for one vendor (how).",
        "SnapServe defines one interface per job: `STTAdapter`, `LLMAdapter`, `TTSAdapter`.",
        "The pipeline talks only to interfaces, so vendors are interchangeable — swapping is a config change, not a code change.",
        "Factory functions (`createSTTAdapter`, `createLLMAdapter`, `createTTSAdapter`) are the ONE place vendor name strings appear.",
        "Narrow interfaces keep adding a new vendor cheap — just one more small class plus a `case` in the switch.",
        "An unknown provider string makes the factory throw immediately — fail loud, fail early.",
      ],
    },
  ],
};
