import type { Chapter } from "../types";

export const whatIsStt: Chapter = {
  slug: "what-is-stt",
  moduleId: "mb",
  number: "0.3",
  title: "What Is Speech-to-Text (STT)?",
  summary:
    "The agent's ears: how a caller's voice becomes written words — and the surprisingly hard problem of knowing when they've stopped talking.",
  estMinutes: 11,
  prerequisites: ["what-is-a-voice-agent"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Turning sound into words",
      paragraphs: [
        "**STT** stands for **Speech-to-Text**. You'll also hear it called **ASR** — Automatic Speech Recognition. Same thing: it takes audio of someone speaking and produces the words they said, as text. It's the agent's ears.",
        "This is the very first step of every turn. A caller's voice arrives as raw sound, and nothing downstream — not the LLM brain, not any logic — can do anything with sound. So STT goes first, and if it gets the words wrong, everything after it is wrong too. Good STT is the foundation the whole conversation stands on.",
        "Like the brain, SnapServe doesn't build STT itself. It plugs into specialists: **Deepgram**, **Whisper** (from OpenAI), **Azure**, and **Sarvam** (strong on Indian languages), among others.",
      ],
    },
    {
      kind: "analogy",
      title: "A court stenographer with headphones on",
      body: [
        "Imagine a stenographer typing every word of a conversation in real time. They don't wait for a sentence to finish — they type as the words come, occasionally fixing an earlier guess when the rest of the sentence makes the meaning clear. (\"I scream\"… ah, \"ice cream\".)",
        "That's exactly how the best STT works on a live call. It's listening continuously and emitting its best guess as it goes, refining as more audio arrives. That refining behaviour is the key idea in the next concept.",
      ],
    },
    {
      kind: "concept",
      title: "Two flavours: batch vs streaming",
      body: [
        "There are two ways to do speech-to-text, and SnapServe supports both.",
        "**Batch** (or 'pre-recorded'): you collect a chunk of audio, send the whole thing at once, and get back the transcript. Simple and accurate, but you have to wait until the person has stopped talking before you even start — which adds delay.",
        "**Streaming** (or 'live'): you open a continuous connection and pour audio in as it arrives. The provider sends back results as it listens, never waiting for the end. This is faster and feels more natural, which is why it's preferred for real conversation — but it's more complex to wire up.",
      ],
    },
    {
      kind: "concept",
      title: "Partials and finals",
      body: [
        "Streaming STT emits two kinds of result. A **partial** is a live, not-yet-confirmed guess — it can change as more audio arrives (\"four… forty… forty-five\"). A **final** is the provider's committed answer for a stretch of speech: this is what was said, locked in.",
        "Why does this distinction matter? Because the agent has to decide **when the caller has finished their turn** so it can start replying. Partials tell it the caller is still mid-thought. A final is a strong signal a thought is complete. Getting this timing right is the difference between an agent that interrupts you constantly and one that feels patient and natural.",
      ],
    },
    {
      kind: "concept",
      title: "Endpointing — the 'are you done talking?' problem",
      body: [
        "Here's a problem you never think about with humans because you solve it effortlessly: how do you know when someone has finished their turn versus just pausing mid-sentence? Wait too long and the agent feels sluggish. Jump in too soon and it cuts the caller off. This decision is called **endpointing** (or turn-detection), and it's one of the genuinely hard parts of voice AI.",
        "The naive answer — \"wait for half a second of silence\" — fails constantly. Someone reading out a phone number pauses between digits. Someone saying just \"yes\" is done instantly. SnapServe uses an **adaptive** window that waits longer or shorter depending on context. There's a whole chapter on it later; for now just know that 'detecting silence' is way subtler than it sounds.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Why STT is genuinely hard",
      body: [
        "Real calls are messy. There's background noise, bad phone-line quality, strong accents, people talking over each other, names and brand words the model has never seen, and digits that sound alike (\"fifteen\" vs \"fifty\"). On Indian calls there's also **code-switching** — sliding between Hindi and English in a single sentence.",
        "This is why provider choice matters and why SnapServe layers extra logic on top of raw STT — noise cancellation, voice-activity detection, and language handling. STT is never 'solved'; it's a constant fight against the real world's mess.",
      ],
    },
    {
      kind: "connections",
      title: "Where the ears sit",
      intro:
        "STT is the first block in every turn. Here's what it feeds, and where the real code lives in later modules.",
      nodes: [
        { id: "tel", label: "Phone line", sublabel: "caller's voice", chapterSlug: "what-is-telephony" },
        { id: "stt", label: "Ears: STT", sublabel: "THIS CHAPTER", current: true },
        { id: "llm", label: "Brain: LLM", sublabel: "gets the words", chapterSlug: "what-is-an-llm" },
        { id: "code", label: "The STT adapters", sublabel: "real code, Module 6", chapterSlug: "stt-adapters" },
        { id: "end", label: "Endpointing", sublabel: "are you done?", chapterSlug: "endpointing" },
      ],
      edges: [
        { from: "tel", to: "stt", label: "audio frames" },
        { from: "stt", to: "llm", label: "transcript" },
        { from: "stt", to: "end", label: "partials / finals" },
        { from: "stt", to: "code", label: "how it's wired up" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What does STT (also called ASR) do?",
          choices: [
            "Turns text into spoken audio.",
            "Turns a caller's spoken audio into written text.",
            "Decides what the agent should say.",
            "Connects the call to the phone network.",
          ],
          correctIndex: 1,
          explanation:
            "Speech-to-Text / Automatic Speech Recognition converts the caller's voice into words. It's the first step of every turn — the agent's ears.",
        },
        {
          prompt: "What's the difference between a 'partial' and a 'final' in streaming STT?",
          choices: [
            "Partials are in one language, finals in another.",
            "A partial is a live guess that can still change; a final is the committed transcript for a stretch of speech.",
            "Partials are free, finals cost money.",
            "There is no difference.",
          ],
          correctIndex: 1,
          explanation:
            "Partials update live as more audio arrives; a final is locked in. The agent uses these signals to judge when a caller's turn is complete.",
        },
        {
          prompt: "Why is 'endpointing' (knowing when the caller stopped talking) hard?",
          choices: [
            "Phones don't transmit silence.",
            "A fixed silence timeout fails — people pause mid-sentence (e.g. between digits) but finish a 'yes' instantly, so the wait must adapt to context.",
            "STT can't detect silence at all.",
            "It's actually trivial.",
          ],
          correctIndex: 1,
          explanation:
            "A single fixed pause length is wrong for most situations. SnapServe adapts the silence window to context so it doesn't cut people off or feel sluggish.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "STT (a.k.a. ASR) is the agent's ears: caller audio → text. It runs first in every turn.",
        "Batch transcribes a whole chunk at once; streaming transcribes live as audio arrives (preferred for conversation).",
        "Streaming emits partials (live guesses) and finals (committed transcripts).",
        "Endpointing — knowing when the caller's turn is over — is a hard, adaptive problem, not a fixed timer.",
        "Noise, accents, similar-sounding digits, and code-switching make STT a constant fight; SnapServe layers extra logic on top.",
      ],
    },
  ],
};
