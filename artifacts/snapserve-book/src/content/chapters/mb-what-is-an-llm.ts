import type { Chapter } from "../types";

export const whatIsAnLlm: Chapter = {
  slug: "what-is-an-llm",
  moduleId: "mb",
  number: "0.2",
  title: "What Is an LLM?",
  summary:
    "The 'brain' of the agent, in plain English: a program that predicts the next word — and why that simple trick is enough to hold a conversation.",
  estMinutes: 12,
  prerequisites: ["what-is-a-voice-agent"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The brain, demystified",
      paragraphs: [
        "**LLM** stands for **Large Language Model**. It's the part of the agent that reads the conversation so far and writes what to say next. When people say 'AI' today, they usually mean an LLM. ChatGPT is an LLM with a chat window around it. The famous ones come from a handful of companies: OpenAI (GPT), Anthropic (Claude), Google (Gemini), plus open models like Llama and Indian-built models like Sarvam.",
        "The word 'large' is literal — these models have read a huge fraction of the public internet and were trained on enormous amounts of computer power. But the core idea is almost embarrassingly simple, and worth understanding deeply because it explains everything an LLM does well **and** everything it does badly.",
      ],
    },
    {
      kind: "concept",
      title: "It predicts the next word. That's it.",
      body: [
        "At heart, an LLM does one thing: given some text, it predicts what word most likely comes next. Then it adds that word and predicts the next one. And again. And again. A whole paragraph is just this tiny guess, repeated hundreds of times.",
        "That sounds too simple to be useful — but if you've read enough of humanity's writing, predicting the next word **really well** turns out to require understanding grammar, facts, tone, logic, and context. The ability to chat, answer questions, and follow instructions all emerge from that one prediction game played at enormous scale.",
      ],
    },
    {
      kind: "analogy",
      title: "Autocomplete that read the entire library",
      body: [
        "You know the autocomplete on your phone that suggests the next word as you type? An LLM is that same idea, except instead of learning from your last few texts, it learned from billions of books, articles, and web pages — and instead of one weak guess, it weighs the entire context of the conversation.",
        "So when the caller says \"my policy number is four-five-six\", the agent's reply isn't pulled from a script. The model simply continues the conversation in the most plausible, helpful way, the same way a well-trained human would.",
      ],
    },
    {
      kind: "concept",
      title: "Tokens — the LLM's idea of a 'word'",
      body: [
        "LLMs don't actually work in whole words; they work in **tokens** — little chunks of text. A token might be a whole short word (\"cat\"), part of a longer word (\"orchestr\" + \"ation\"), or even a single punctuation mark. As a rough rule, one token is about ¾ of an English word.",
        "Why care? Two reasons. First, providers **charge by the token**, so cost and length are measured in tokens. Second, and crucially for voice: the model emits its reply **one token at a time**, in a live stream. We don't have to wait for the whole answer — we can start reading the first sentence aloud while the model is still writing the second. That **streaming** behaviour is the single biggest reason SnapServe feels fast.",
      ],
    },
    {
      kind: "concept",
      title: "The system prompt and the context window",
      body: [
        "An LLM out of the box has no personality and no job. You give it both through a **system prompt** — a block of instructions like \"You are Maya, a friendly insurance assistant. Be concise. Never give medical advice.\" In SnapServe, the system prompt is how a user defines what their agent **is**.",
        "Everything the model can 'see' at once — the system prompt, plus the back-and-forth of the conversation so far — lives in its **context window**. Think of it as the model's short-term memory: a fixed-size desk it can spread papers on. It has no memory between separate calls on its own; if you want the agent to remember a caller from last week, you (the platform) must store that and feed it back in. That's a whole system we'll meet later, called caller memory.",
      ],
    },
    {
      kind: "concept",
      title: "Tool calling — when the brain needs to DO something",
      body: [
        "A model that only talks is limited. Real tasks need actions: book an appointment, look up an order, transfer the call. Modern LLMs support **tool calling** (also called function calling). You hand the model a list of tools it's allowed to use, and instead of replying with words, it can reply with \"please run `bookAppointment` with these details.\"",
        "Your code runs the real function, hands the result back to the model, and the model continues the conversation using that result. This is how an agent moves from 'chatbot that sounds nice' to 'assistant that actually gets things done'.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Hallucination — the price of a confident guesser",
      body: [
        "Because an LLM is always producing the most *plausible* continuation, it will sometimes produce something plausible-sounding that is simply **false** — an invented policy detail, a made-up date, a confident wrong answer. This is called **hallucination**, and it's not a bug you can fully patch; it's the flip side of how the technology works.",
        "This is why agents are given tight system prompts, real tools to fetch real data, and guardrails. Never assume an LLM's answer is true just because it sounds sure. Much of building a *trustworthy* agent is about constraining the brain so its confident guesses stay inside the lines.",
      ],
    },
    {
      kind: "connections",
      title: "Where the brain plugs in",
      intro:
        "The LLM is one of four blocks. Here's how it sits between the ears and the mouth — and where to read the real code later.",
      nodes: [
        { id: "stt", label: "Ears: STT", sublabel: "speech → text", chapterSlug: "what-is-stt" },
        { id: "llm", label: "Brain: LLM", sublabel: "THIS CHAPTER", current: true },
        { id: "tts", label: "Mouth: TTS", sublabel: "text → speech", chapterSlug: "what-is-tts" },
        { id: "code", label: "The LLM adapters", sublabel: "real code, Module 6", chapterSlug: "llm-adapters" },
      ],
      edges: [
        { from: "stt", to: "llm", label: "caller's words" },
        { from: "llm", to: "tts", label: "reply tokens (streamed)" },
        { from: "llm", to: "code", label: "how it's wired up" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "At its core, what does an LLM actually do?",
          choices: [
            "It searches a database of pre-written answers.",
            "It repeatedly predicts the next token (chunk of text), building a reply one piece at a time.",
            "It records and plays back human voices.",
            "It connects calls to the phone network.",
          ],
          correctIndex: 1,
          explanation:
            "An LLM predicts the most likely next token over and over. Conversation, reasoning, and instruction-following all emerge from doing that prediction extremely well at scale.",
        },
        {
          prompt: "Why does the LLM streaming its reply token by token matter so much for a voice agent?",
          choices: [
            "It makes the reply more accurate.",
            "It lets the agent start speaking the first sentence before the whole answer is written, cutting the delay before the caller hears something.",
            "It reduces the cost per token.",
            "It prevents hallucination.",
          ],
          correctIndex: 1,
          explanation:
            "Streaming means we don't wait for the full answer. The pipeline reads early sentences aloud while later ones are still being generated — the key trick for low latency.",
        },
        {
          prompt: "What is 'hallucination'?",
          choices: [
            "When the model crashes.",
            "When the model confidently produces plausible-sounding information that is actually false.",
            "When two models disagree.",
            "When the audio cuts out.",
          ],
          correctIndex: 1,
          explanation:
            "Because the model always generates the most plausible continuation, it can invent false-but-believable details. Tools, tight prompts, and guardrails exist to contain this.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "An LLM is the agent's brain: it reads the conversation and writes the reply.",
        "Its one trick is predicting the next token; everything else emerges from doing that well.",
        "It streams its reply token by token — letting the agent speak before the answer is complete.",
        "The system prompt gives the agent its job and personality; the context window is its short-term memory for one call.",
        "Tool calling lets the brain trigger real actions (booking, lookups). Hallucination is the built-in risk that guardrails exist to contain.",
      ],
    },
  ],
};
