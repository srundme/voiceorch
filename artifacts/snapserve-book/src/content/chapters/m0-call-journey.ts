import type { Chapter } from "../types";

export const callJourney: Chapter = {
  slug: "the-call-journey",
  moduleId: "m0",
  number: "0.1",
  title: "The Journey of a Single Phone Call",
  summary:
    "Before we read a single line of code, let's follow one phone call from the moment it rings to the moment the AI talks back. This is the map for everything else.",
  estMinutes: 12,
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Start with the whole, then zoom in",
      paragraphs: [
        "SnapServe is big. Over a hundred thousand lines of code, dozens of files, many moving parts. If you start by reading random files, you'll drown.",
        "So we won't. We start the way you'd learn a city — from the air. This chapter is a single, slow flight over **one phone call**: someone dials a SnapServe agent, has a short conversation with an AI, and hangs up. Everything that happens in between is the entire product in miniature.",
        "By the end of this chapter you won't understand the code yet — but you'll have a **mental map**. Every later chapter is a street on this map.",
      ],
    },
    {
      kind: "concept",
      title: "What does \"orchestration\" actually mean?",
      body: [
        "SnapServe's tagline is that it's an **orchestration layer** for voice AI. That word matters, so let's pin it down.",
        "An AI phone agent is not one piece of software. It's at least four separate services talking to each other in real time: something that turns **speech into text** (ASR / STT), something that **thinks of a reply** (the LLM), something that turns **text back into speech** (TTS), and something that **carries the phone call** (telephony, like Twilio).",
        "SnapServe doesn't build any of those four. Instead it's the **conductor**: it takes the audio from the phone, hands it to whichever speech-recognizer you picked, feeds the result to whichever AI brain you picked, sends the reply to whichever voice you picked, and streams that back down the phone line — fast enough that it feels like a real conversation. That coordination job is the orchestration layer.",
      ],
    },
    {
      kind: "analogy",
      title: "The restaurant kitchen",
      body: [
        "Think of SnapServe as the **head chef** in a kitchen who never actually cooks.",
        "The order comes in (the caller speaks). The chef shouts it to the right station — the grill, the fryer, the pastry chef (STT, LLM, TTS). Each station is a specialist hired from outside. The chef's only job is **timing and routing**: making sure each station gets the right input at the right moment, and the finished plate goes out hot.",
        "If the plate is late, the diner notices. In voice AI, \"late\" means an awkward silence on the phone. So almost every hard problem in this codebase is really about **timing** — getting each specialist's output to the next one without a gap the caller can hear.",
      ],
    },
    {
      kind: "prose",
      heading: "The eight beats of a call",
      paragraphs: [
        "Here is the whole journey, start to finish. Read it once now; you'll meet each step again as its own chapter later.",
        "**1. The phone rings.** A caller dials a number you bought through a telephony provider — Twilio, Plivo, or VoBiz. That provider answers and needs somewhere to send the live audio.",
        "**2. A WebSocket opens.** The provider opens a long-lived two-way connection to our server at a special address. Our server's startup file accepts that connection and figures out which agent the call is for.",
        "**3. A session is born.** We create one in-memory \"session\" object that will hold everything about this one call — who's calling, which AI brain to use, the conversation so far. One call, one session.",
        "**4. Sound becomes numbers.** The phone network sends compressed 8-bit audio called μ-law. We decode it into normal numbers a computer can process, then clean it up (remove background hum and hiss).",
        "**5. Numbers become words.** The cleaned audio streams to a speech-to-text service. It sends back a live transcript of what the caller is saying.",
        "**6. We decide the caller is done talking.** This is subtler than it sounds. The system has to detect the natural end of the caller's turn — not interrupt them mid-sentence, but also not leave them hanging. This is called **endpointing**.",
        "**7. The AI replies.** The transcript (plus the conversation history and the agent's instructions) goes to the LLM. As the AI's answer streams out word by word, we immediately send it to the text-to-speech service.",
        "**8. Words become sound, going back.** The TTS audio is re-encoded into μ-law and streamed back down the same WebSocket to the caller's phone. The caller hears the AI speak. Then it loops back to step 5 for the caller's next turn — until someone hangs up.",
      ],
    },
    {
      kind: "connections",
      title: "The call pipeline, end to end",
      intro:
        "This is the single most important diagram in the course. Every box is a real part of the system you'll learn. Boxes you can click jump straight to the chapter that teaches them — explore freely, then come back.",
      nodes: [
        { id: "phone", label: "Caller's phone", sublabel: "dials your number" },
        { id: "provider", label: "Telephony provider", sublabel: "Twilio / Plivo / VoBiz", chapterSlug: "telephony-overview" },
        { id: "upgrade", label: "WebSocket upgrade", sublabel: "index.ts accepts the call", chapterSlug: "server-bootstrap" },
        { id: "session", label: "Session created", sublabel: "one call = one session", chapterSlug: "session-and-pipeline" },
        { id: "audio", label: "Decode + clean audio", sublabel: "orchestration/audio.ts", chapterSlug: "audio-ts", current: false },
        { id: "stt", label: "Speech → Text (STT)", sublabel: "ASR adapter", chapterSlug: "adapter-pattern" },
        { id: "endpoint", label: "End-of-turn detection", sublabel: "endpointing.ts", chapterSlug: "endpointing" },
        { id: "llm", label: "Text → Reply (LLM)", sublabel: "LLM adapter", chapterSlug: "adapter-pattern" },
        { id: "tts", label: "Reply → Speech (TTS)", sublabel: "TTS adapter", chapterSlug: "adapter-pattern" },
        { id: "encode", label: "Encode audio back", sublabel: "orchestration/audio.ts", chapterSlug: "audio-ts" },
        { id: "end", label: "Call ends", sublabel: "billing + memory + summary", chapterSlug: "minute-rates" },
      ],
      edges: [
        { from: "phone", to: "provider", label: "voice" },
        { from: "provider", to: "upgrade", label: "WebSocket" },
        { from: "upgrade", to: "session" },
        { from: "session", to: "audio", label: "μ-law bytes" },
        { from: "audio", to: "stt", label: "clean PCM" },
        { from: "stt", to: "endpoint", label: "transcript" },
        { from: "endpoint", to: "llm", label: "final turn" },
        { from: "llm", to: "tts", label: "reply text" },
        { from: "tts", to: "encode", label: "speech audio" },
        { from: "encode", to: "provider", label: "μ-law back" },
        { from: "provider", to: "phone", label: "AI voice" },
        { from: "endpoint", to: "end", label: "hang up" },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "The loop is the product",
      body: [
        "Notice that steps 5–8 form a **loop**: listen, decide they're done, think, speak, listen again. That loop runs every single turn of every single call.",
        "Almost everything else in the codebase — billing, scheduling, caller memory, campaigns, the dashboard — is built *around* this loop. Master the loop first and the rest will slot into place.",
      ],
    },
    {
      kind: "concept",
      title: "Why \"bring your own provider\"?",
      body: [
        "You'll see two billing modes everywhere in this codebase: **Managed** and **BYOP** (Bring Your Own Providers).",
        "Because SnapServe doesn't build the STT/LLM/TTS services, it has two ways to charge. In **Managed** mode, SnapServe supplies the provider keys and bills a higher per-minute rate (you pay for the convenience). In **BYOP** mode, you plug in your own OpenAI / Deepgram / ElevenLabs keys, pay those companies directly, and SnapServe only charges a small orchestration fee.",
        "This is decided automatically, per call, based on whether you've added your own keys. Keep it in the back of your mind — it explains a lot of branching logic later.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt:
            "In one sentence, what is SnapServe's actual job during a call?",
          choices: [
            "It runs the speech recognition and the AI model itself.",
            "It coordinates separate specialist services and gets their output to each other fast enough to feel live.",
            "It stores the audio recording and nothing else.",
            "It replaces the telephone network.",
          ],
          correctIndex: 1,
          explanation:
            "SnapServe is the conductor/orchestration layer. The specialists (STT, LLM, TTS, telephony) are external; SnapServe's job is routing and timing.",
        },
        {
          prompt:
            "Which steps form the repeating loop that runs every conversational turn?",
          choices: [
            "The phone ringing and the WebSocket opening.",
            "Listening (STT), deciding the turn is over (endpointing), thinking (LLM), and speaking (TTS).",
            "Billing and caller-memory updates.",
            "Buying a phone number from a provider.",
          ],
          correctIndex: 1,
          explanation:
            "Steps 5–8 — STT → endpointing → LLM → TTS — repeat every turn until the call ends. That loop is the heart of the product.",
        },
        {
          prompt: "What decides whether a call is billed Managed vs BYOP?",
          choices: [
            "The caller's phone carrier.",
            "A random A/B test.",
            "Whether the user has added their own provider API keys.",
            "The time of day.",
          ],
          correctIndex: 2,
          explanation:
            "It's resolved per call: if the user has their own keys for the agent's providers, it's BYOP (lower fee); otherwise it's Managed (higher rate, SnapServe supplies the keys).",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "SnapServe is an orchestration layer — a conductor, not a performer.",
        "One phone call = one session object that holds all the call's state.",
        "The core loop per turn: STT → endpointing → LLM → TTS, then repeat.",
        "Audio enters as compressed μ-law and must be decoded before anything can use it.",
        "Billing is Managed (SnapServe's keys) or BYOP (your keys), decided per call.",
      ],
    },
  ],
};
