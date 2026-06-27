import type { Chapter } from "../types";

export const whatIsAVoiceAgent: Chapter = {
  slug: "what-is-a-voice-agent",
  moduleId: "mb",
  number: "0.1",
  title: "What Even Is a Voice Agent?",
  summary:
    "Before any code: what SnapServe actually builds, and the four jobs that turn a computer into something you can talk to on the phone.",
  estMinutes: 10,
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Start here — assume nothing",
      paragraphs: [
        "If you've never heard the words **LLM**, **STT**, **TTS**, or **telephony**, you are in exactly the right place. This whole first module exists to take you from zero to comfortable. We won't read a single line of code. We'll just build the mental picture that every later chapter quietly assumes you already have.",
        "So, the big question: **what is a voice agent?** A voice agent is a piece of software you can phone up — or that can phone you — and have a real, spoken conversation with. It listens to what you say, understands it, decides how to respond, and talks back, all on its own, with no human on the other end. SnapServe is a platform for building and running these agents.",
        "You have almost certainly already spoken to one. \"Press 1 for billing\" is the ancient, dumb ancestor. A modern voice agent is the opposite of that: it has no menu. You just talk to it like a person — \"hi, I need to reschedule my appointment to next Tuesday\" — and it handles it.",
      ],
    },
    {
      kind: "analogy",
      title: "A call-center employee who never sleeps",
      body: [
        "Picture the best phone agent at a busy company. They answer instantly, never get tired, never have a bad day, remember every previous call with you, speak five languages, and you can clone a thousand of them for the price of one. That clone is a voice agent.",
        "Everything in this codebase is in service of making that clone feel **human** — fast enough that you don't notice the gap before it replies, smart enough to actually help, and polite enough to stop talking the moment you interrupt.",
      ],
    },
    {
      kind: "concept",
      title: "The four jobs every voice agent must do",
      body: [
        "Strip away the details and a voice agent is just four jobs chained together — like the parts of a person having a conversation:",
        "**1. Ears — Speech-to-Text (STT).** The caller's voice is sound. Computers can't 'understand' sound directly, so the first job is turning that sound into written words. This is also called **ASR** (Automatic Speech Recognition).",
        "**2. Brain — the LLM (Large Language Model).** Now that we have the caller's words as text, something has to decide what to say back. That's the LLM — the AI 'brain' that reads the conversation and writes a reply.",
        "**3. Mouth — Text-to-Speech (TTS).** The brain's reply is text. But you can't hear text down a phone line. So the last job is turning that text back into natural-sounding speech.",
        "**4. The phone line — Telephony.** None of the above matters if the audio can't physically travel to and from a real phone. Telephony is the plumbing that connects the agent to the actual phone network.",
      ],
    },
    {
      kind: "concept",
      title: "The loop: listen → think → speak, over and over",
      body: [
        "A conversation is just **turns**. You talk, then I talk, then you talk again. A voice agent runs one tight loop for every turn: capture the caller's speech (ears), convert it to text, send the text to the brain, get a reply, convert the reply to speech (mouth), and play it down the line. Then it goes quiet and listens for the next turn.",
        "That's the entire skeleton. The next four chapters zoom in on each of the four jobs one at a time. Later modules show the real code that makes the loop fast and reliable — but you'll never lose sight of this simple shape: **STT → LLM → TTS**, wrapped in a phone call.",
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Why speed is the whole game",
      body: [
        "When you talk to a human, they reply in roughly half a second. Any longer and the silence feels broken — you start saying \"hello? are you there?\". A voice agent has to hit that same target while doing four hard things in a row across the internet.",
        "This is why so much of the codebase looks complicated: it's all about shaving milliseconds. Starting to speak before the brain has finished thinking. Keeping network connections warm. Guessing when you've stopped talking. If you ever wonder \"why is this code so fussy?\", the answer is almost always **latency**.",
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "What SnapServe itself actually does",
      body: [
        "Here's the subtle part. SnapServe usually does **not** build its own ears, brain, or mouth. The best STT, LLM, and TTS in the world are made by specialist companies (OpenAI, Deepgram, ElevenLabs, and many more). SnapServe lets a user plug in whichever of those they want.",
        "SnapServe's real product is the **orchestration** — the conductor that wires those pieces together into a single, fast, reliable phone call, and handles everything around it: billing per minute, remembering callers, scheduling, compliance, and more. Keep that word, **orchestration**, in your back pocket. It's the heart of the whole system.",
      ],
    },
    {
      kind: "connections",
      title: "The four building blocks",
      intro:
        "These are the four jobs we just met. Each one gets its own chapter next — click ahead if you're curious.",
      nodes: [
        { id: "agent", label: "A Voice Agent", sublabel: "THIS CHAPTER", current: true },
        { id: "stt", label: "Ears: STT", sublabel: "speech → text", chapterSlug: "what-is-stt" },
        { id: "llm", label: "Brain: LLM", sublabel: "text → reply", chapterSlug: "what-is-an-llm" },
        { id: "tts", label: "Mouth: TTS", sublabel: "text → speech", chapterSlug: "what-is-tts" },
        { id: "tel", label: "Phone line: Telephony", sublabel: "the network", chapterSlug: "what-is-telephony" },
      ],
      edges: [
        { from: "tel", to: "stt", label: "caller's voice" },
        { from: "stt", to: "llm", label: "words" },
        { from: "llm", to: "tts", label: "reply text" },
        { from: "tts", to: "tel", label: "spoken reply" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What are the four jobs that make up a voice agent?",
          choices: [
            "Database, server, frontend, and deployment.",
            "Speech-to-text (ears), an LLM (brain), text-to-speech (mouth), and telephony (the phone line).",
            "Login, billing, scheduling, and analytics.",
            "Twilio, OpenAI, Deepgram, and ElevenLabs.",
          ],
          correctIndex: 1,
          explanation:
            "Ears (STT) turn the caller's voice into text, the brain (LLM) decides the reply, the mouth (TTS) turns the reply back into speech, and telephony carries the audio to and from a real phone.",
        },
        {
          prompt: "What is SnapServe's core product, given that it usually doesn't build the STT/LLM/TTS itself?",
          choices: [
            "The phone hardware.",
            "The orchestration — wiring third-party pieces into one fast, reliable call, plus everything around it (billing, memory, scheduling).",
            "Training its own AI models.",
            "A menu system (press 1 for billing).",
          ],
          correctIndex: 1,
          explanation:
            "Users bring their own providers; SnapServe is the conductor that orchestrates them into a working product and handles billing, caller memory, scheduling, and compliance.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "A voice agent is software you can have a real spoken phone conversation with — no human, no menu.",
        "It does four jobs in a loop: ears (STT), brain (LLM), mouth (TTS), and the phone line (telephony).",
        "A conversation is just turns: listen → think → speak, repeated.",
        "Latency is the obsession — a reply needs to land in well under a second to feel human.",
        "SnapServe's product is orchestration: conducting third-party AI pieces into one reliable call.",
      ],
    },
  ],
};
