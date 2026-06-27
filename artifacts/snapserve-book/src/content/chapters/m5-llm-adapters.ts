import type { Chapter } from "../types";

export const llmAdapters: Chapter = {
  slug: "llm-adapters",
  moduleId: "m5",
  number: "5.3",
  title: "LLM Adapters & Tool Calls",
  summary:
    "Streaming replies token-by-token, and how the AI triggers actions (booking, transfers) mid-conversation.",
  estMinutes: 18,
  fileRef: "artifacts/api-server/src/orchestration/adapters/llm/openai.ts",
  prerequisites: ["adapter-pattern", "stt-adapters"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "The LLM adapter is the **brain** of the agent. STT handed it the caller's words; now it has to think of something to say back — and say it *fast*. On a phone call, every 100 ms of silence feels like an eternity, so the adapter can't wait for the model to finish writing a paragraph before speaking. It must **stream**: emit each word the instant it's generated, so the voice can start talking while the rest of the sentence is still being thought up.",
        "But modern agents do more than chat. They **book appointments**, **transfer the call to a human**, **schedule callbacks**, and **fire webhooks** — real actions in the real world. The mechanism for that is **tool calling** (a.k.a. function calling): the model, instead of replying with text, replies with a structured request like 'call the tool `book_appointment` with these arguments.' The adapter has to detect that, parse it, and hand it to the pipeline to execute.",
        "We'll walk the **OpenAI** adapter, which is the template the OpenAI-compatible vendors (DeepSeek, Groq, Mistral, Sarvam, Qwen, Cohere) all follow. One file, two superpowers: streaming text and tool calls.",
      ],
    },
    {
      kind: "concept",
      title: "Streaming an async iterator, and what a tool call is",
      body: [
        "When you ask OpenAI to `stream: true`, the SDK returns an **async iterable** — an object you can loop over with `for await (const chunk of stream)`. Each `chunk` is a tiny slice of the response (usually one or two tokens). The loop body runs once per slice, so we can forward each token to the voice immediately. The loop ends when the model is done.",
        "A **tool** (or function) is something you describe to the model in JSON: a name, a description, and the shape of its arguments. The model decides *on its own* whether a tool is the right response. When it picks one, the API doesn't send back prose — it sends back `tool_calls`: the chosen tool's name and a JSON string of arguments, streamed in fragments just like text.",
        "So a single `chat()` call has two possible endings: a **text reply** (fire `onDone`) or a **tool request** (fire `onToolCall`). The adapter's job is to stream tokens as they arrive, accumulate any tool-call fragments, and at the end fire exactly one of those two callbacks.",
      ],
    },
    {
      kind: "analogy",
      title: "A waiter who can also place the order",
      body: [
        "A plain chatbot is a waiter who only *talks*: you ask a question, they answer. A tool-using agent is a waiter who can also walk to the kitchen and **place your order**. When you say 'I'll have the 3 pm slot,' they don't just say 'okay' — they actually write it on the ticket and pin it up.",
        "Streaming is that same waiter repeating your order back to you word by word as they write it, instead of going quiet and then reciting the whole thing at the end. You hear progress immediately, and if they got something wrong you can interrupt.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/openai.ts",
      language: "typescript",
      intro:
        "First, translate SnapServe's neutral tool definitions into OpenAI's required shape, then open the stream.",
      code: `const openAiTools = options?.tools?.length
  ? options.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
  : undefined;

const stream = await this.client.chat.completions.create({
  model: this.model,
  stream: true,
  stream_options: { include_usage: true },
  messages: [
    { role: "system", content: systemPrompt },
    ...toOpenAIMessages(messages),
  ] as any,
  ...(openAiTools ? { tools: openAiTools, tool_choice: "auto" } : {}),
});`,
      lines: [
        {
          lines: "1-10",
          label: "neutral tools → OpenAI tools",
          explanation:
            "The pipeline passes vendor-neutral `ToolDefinition`s. Here we reshape them into OpenAI's `{ type: \"function\", function: {...} }` wrapper. Each vendor adapter does its own translation — Anthropic and Google want different shapes — which is precisely why this lives in the adapter, not the pipeline.",
        },
        {
          lines: "1",
          label: "options?.tools?.length",
          explanation:
            "If no tools were supplied (or the list is empty), `openAiTools` stays `undefined` and we skip tool wiring entirely. Optional chaining keeps this safe when `options` itself is absent.",
        },
        {
          lines: "12-15",
          label: "stream: true + include_usage",
          explanation:
            "`stream: true` is what turns the response into the async iterator we loop over. `include_usage` asks OpenAI to send token counts in a final chunk — that's how we bill accurately without estimating.",
        },
        {
          lines: "16-19",
          label: "system prompt + history",
          explanation:
            "Messages are the system prompt first, then the conversation. `toOpenAIMessages` converts SnapServe's `ConversationTurn[]` (including prior tool calls and their results) into OpenAI's format — a shared helper reused by every OpenAI-compatible adapter.",
        },
        {
          lines: "20",
          label: "tool_choice: \"auto\"",
          explanation:
            "Only attach tools if we have any. `tool_choice: \"auto\"` lets the model decide for itself whether to reply with text or call a tool — we never force it.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/openai.ts",
      language: "typescript",
      intro:
        "The streaming loop — the engine room. Every chunk is either a usage report, a text token, or a fragment of a tool call.",
      code: `let full = "";
let toolCallName = "";
let toolCallArgs = "";
let isToolCall = false;
let usage: LLMUsage | undefined;

for await (const chunk of stream) {
  if (chunk.usage) {
    usage = {
      inputTokens: chunk.usage.prompt_tokens,
      outputTokens: chunk.usage.completion_tokens,
    };
  }

  const delta = chunk.choices[0]?.delta;
  if (!delta) continue;

  // Regular text tokens
  const token = delta.content ?? "";
  if (token) {
    full += token;
    onToken(token);
  }

  // Tool call deltas (streamed in fragments)
  if (delta.tool_calls) {
    isToolCall = true;
    for (const tc of delta.tool_calls) {
      if (tc.function?.name) toolCallName += tc.function.name;
      if (tc.function?.arguments) toolCallArgs += tc.function.arguments;
    }
  }
}`,
      lines: [
        {
          lines: "1-5",
          label: "the accumulators",
          explanation:
            "Before the loop, set up running totals: `full` collects the whole text reply, `toolCallName`/`toolCallArgs` collect tool-call fragments, `isToolCall` flips true the moment a tool fragment appears, and `usage` captures token counts. These survive across every chunk.",
        },
        {
          lines: "7",
          label: "for await … of stream",
          explanation:
            "This is the streaming loop. It pauses at each iteration until the next chunk arrives over the network, then runs the body. No chunk is missed and nothing blocks the event loop while we wait.",
        },
        {
          lines: "8-13",
          label: "capture usage",
          explanation:
            "The final chunk carries `usage` (because of `include_usage`). We stash it for later. It arrives once, near the end.",
        },
        {
          lines: "18-22",
          label: "forward each text token live",
          explanation:
            "`delta.content` is the new text in this chunk. We append it to `full` AND immediately call `onToken(token)` — that's what lets the TTS start speaking before the sentence is finished. This single line is the whole reason calls feel responsive.",
        },
        {
          lines: "25-31",
          label: "accumulate tool-call fragments",
          explanation:
            "Tool calls stream in pieces too: the name might arrive in one chunk, the JSON arguments dribble in across several. We CONCATENATE them — `toolCallName += …`, `toolCallArgs += …` — until the stream ends. You can never parse the arguments mid-stream because they're incomplete.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Tool arguments arrive in fragments",
      body: [
        "A booking call's arguments — `{\"name\":\"Asha\",\"time\":\"3pm\"}` — don't arrive whole. They stream as `{\"na`, then `me\":\"As`, then `ha\",\"ti`, and so on. If you tried `JSON.parse` on any single fragment you'd get a syntax error.",
        "That's why the loop only **appends** strings during streaming and waits until the very end to parse. Concatenate first, parse once. Every OpenAI-compatible adapter in the repo (DeepSeek, Sarvam, Groq…) repeats this exact pattern.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/openai.ts",
      language: "typescript",
      intro:
        "After the loop ends, the adapter fires exactly ONE terminal callback — a tool request or a text reply, never both.",
      code: `if (usage) options?.onUsage?.(usage);

if (isToolCall && toolCallName && options?.onToolCall) {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCallArgs || "{}") as Record<string, unknown>;
  } catch {
    // malformed args — pass empty
  }
  options.onToolCall(toolCallName, args);
} else {
  onDone(full, usage);
}`,
      lines: [
        {
          lines: "1",
          label: "report usage first",
          explanation:
            "Fire `onUsage` once, before the terminal callback, so billing is recorded whether this turn ended in a tool call or a text reply. Optional chaining means it's a no-op if the pipeline didn't ask for usage.",
        },
        {
          lines: "3",
          label: "the fork: tool call?",
          explanation:
            "If a tool was requested AND we got a name AND the pipeline supplied an `onToolCall` handler, this is a tool turn. All three must be true.",
        },
        {
          lines: "4-9",
          label: "parse the accumulated args — safely",
          explanation:
            "Now — and only now — we `JSON.parse` the fully-assembled argument string. The `try/catch` is defensive: a model occasionally emits malformed JSON, and we'd rather call the tool with empty args than crash the whole turn.",
        },
        {
          lines: "10",
          label: "onToolCall → pipeline executes",
          explanation:
            "Hand the tool name and parsed args to the pipeline. The pipeline then runs the real action — booking a slot, dialing a transfer, firing a webhook — and feeds the result back into the next `chat()` call.",
        },
        {
          lines: "11-12",
          label: "else → onDone",
          explanation:
            "No tool? Then it was a plain text reply. Fire `onDone(full, usage)` with the complete text. Exactly one of these two branches runs — that's the contract the pipeline relies on.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Exactly one terminal callback",
      body: [
        "The pipeline assumes a `chat()` call ends with **either** `onToolCall` **or** `onDone` — never both, never neither. Fire both and the pipeline would try to speak a reply AND execute a tool for the same turn. Fire neither and the turn hangs forever in 'thinking…'.",
        "Look at the Sarvam adapter and you'll see the same discipline spelled out: after dispatching a tool call it `return`s immediately so `onDone` can't also fire. This single-terminal-callback rule is part of the unwritten `LLMAdapter` contract.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/llm/openai-messages.ts",
      language: "typescript",
      intro:
        "How does a completed tool call get back into the conversation so the model remembers it called the tool? This shared helper formats history for the next turn.",
      code: `export function toOpenAIMessages(turns: ConversationTurn[]): any[] {
  return turns.map((m): Record<string, unknown> => {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.toolCallId ?? "call_unknown",
        content: m.content,
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.args },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}`,
      lines: [
        {
          lines: "3-9",
          label: "the tool RESULT message",
          explanation:
            "After the pipeline executes a tool, it stores the outcome as a `role: \"tool\"` turn. Here it becomes an OpenAI tool message keyed by `tool_call_id` — the link that ties the result back to the specific call the model made.",
        },
        {
          lines: "10-19",
          label: "the assistant's tool REQUEST",
          explanation:
            "The assistant turn that *made* the call is re-encoded with its `tool_calls` array. The model needs to see its own prior request and the matching result, or OpenAI-compatible APIs return a 400 — or worse, call the same tool again in a loop.",
        },
        {
          lines: "20",
          label: "the ordinary case",
          explanation:
            "Plain user/assistant turns pass straight through as `{ role, content }`. Most of the conversation is this simple; the tool branches above are the special cases.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "The LLM adapter turns transcript into either spoken words or a real-world action. Click to explore.",
      nodes: [
        { id: "stt", label: "STT adapter", sublabel: "the caller's words", chapterSlug: "stt-adapters" },
        { id: "pipeline", label: "OrchestrationPipeline", sublabel: "drives the turn, supplies callbacks", chapterSlug: "session-and-pipeline" },
        { id: "factory", label: "createLLMAdapter()", sublabel: "picks the brain vendor", chapterSlug: "adapter-pattern" },
        { id: "openai", label: "OpenAILLM.chat()", sublabel: "openai.ts — THIS FILE", current: true },
        { id: "tools", label: "Tool executor", sublabel: "booking · transfer · webhook", chapterSlug: "session-and-pipeline" },
        { id: "tts", label: "TTS adapter", sublabel: "speaks each token", chapterSlug: "tts-adapters" },
        { id: "fallback", label: "Fallback LLM", sublabel: "backup if primary fails", chapterSlug: "fallback-chains" },
      ],
      edges: [
        { from: "stt", to: "pipeline", label: "final transcript" },
        { from: "factory", to: "openai", label: "creates" },
        { from: "pipeline", to: "openai", label: "chat(messages, …)" },
        { from: "openai", to: "tts", label: "onToken (live text)" },
        { from: "openai", to: "tools", label: "onToolCall(name, args)" },
        { from: "openai", to: "fallback", label: "on failure" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does the adapter call `onToken(token)` inside the streaming loop instead of waiting until the end?",
          choices: [
            "To save memory.",
            "So the TTS can start speaking each word as it's generated, keeping the call responsive instead of going silent for seconds.",
            "Because OpenAI requires it.",
            "To count the tokens.",
          ],
          correctIndex: 1,
          explanation:
            "Streaming each token immediately lets the voice start talking before the full sentence exists. Waiting until the end would produce long, awkward silences mid-call.",
        },
        {
          prompt: "Why are tool-call arguments concatenated (`toolCallArgs += …`) during the loop and only parsed afterward?",
          choices: [
            "JSON parsing is slow.",
            "The arguments stream in fragments; any single fragment is incomplete JSON, so you must assemble the whole string before `JSON.parse`.",
            "OpenAI sends them encrypted.",
            "The pipeline parses them instead.",
          ],
          correctIndex: 1,
          explanation:
            "Tool arguments arrive in pieces across chunks. Parsing a partial fragment throws a syntax error, so the adapter appends all fragments first and parses once at the end.",
        },
        {
          prompt: "At the end of `chat()`, how many terminal callbacks fire?",
          choices: [
            "Both `onToolCall` and `onDone` always.",
            "Exactly one — `onToolCall` for a tool turn, or `onDone` for a text reply.",
            "Always `onDone`.",
            "None; the pipeline polls instead.",
          ],
          correctIndex: 1,
          explanation:
            "It's a strict either/or: a tool request fires `onToolCall`, a text reply fires `onDone`. Firing both (or neither) would break the pipeline's turn handling.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "The LLM adapter streams the reply token-by-token via `onToken`, so the voice can speak before the sentence is finished.",
        "`stream: true` turns the response into an async iterator looped over with `for await (const chunk of stream)`.",
        "Tool (function) calling lets the model trigger real actions — booking, transfer, callback, webhook — instead of replying with text.",
        "Tool-call name and arguments stream in fragments; the adapter concatenates them and parses the JSON only once, at the end.",
        "Each `chat()` fires exactly one terminal callback: `onToolCall` (a tool turn) OR `onDone` (a text reply).",
        "`toOpenAIMessages` re-encodes prior tool requests + results into history so the model doesn't loop or 400 on the next turn.",
      ],
    },
  ],
};
