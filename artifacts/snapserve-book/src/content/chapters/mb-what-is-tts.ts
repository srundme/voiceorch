import type { Chapter } from "../types";

export const whatIsTts: Chapter = {
  slug: "what-is-tts",
  moduleId: "mb",
  number: "0.4",
  title: "What Is Text-to-Speech (TTS)?",
  summary:
    "The agent's mouth: turning the brain's written reply into a natural human voice — and why it has to start speaking before the sentence is finished.",
  estMinutes: 10,
  prerequisites: ["what-is-a-voice-agent"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Giving the agent a voice",
      paragraphs: [
        "**TTS** stands for **Text-to-Speech**. It's the mirror image of STT: where STT turned sound into words, TTS turns words back into sound. It's the agent's mouth — the last step before the caller actually hears a reply.",
        "Old TTS sounded robotic and flat (\"please. hold. for. the. next. available. agent.\"). Modern TTS is shockingly good — warm, expressive, with natural pauses and intonation. Many callers genuinely can't tell it isn't a person. SnapServe plugs into the leaders here: **ElevenLabs**, **Cartesia**, **OpenAI**, **Azure**, and **Sarvam** for Indian voices.",
      ],
    },
    {
      kind: "analogy",
      title: "A voice actor who reads instantly",
      body: [
        "Think of a brilliant voice actor in a booth. You hand them a line of script and, with no rehearsal, they read it aloud perfectly — right tone, right rhythm, right emotion. Now imagine they can do it in any voice you ask for, in dozens of languages, in a fraction of a second. That's TTS.",
        "And just like a good actor reading a long speech, they don't wait until they've silently read the entire monologue before opening their mouth. They start speaking the first line while their eyes are still scanning ahead. That habit is the key to making the agent feel fast.",
      ],
    },
    {
      kind: "concept",
      title: "Voices, and voice cloning",
      body: [
        "Each TTS provider offers a catalogue of **voices** — different ages, genders, accents, and moods. A SnapServe user picks the voice that fits their brand. Each voice is identified by a code the provider understands.",
        "Many providers also support **voice cloning**: feed in a short sample of a real person's speech and the model can generate new sentences in that person's voice. Powerful — and exactly why this technology comes with consent and compliance concerns we'll touch on later.",
      ],
    },
    {
      kind: "concept",
      title: "Streaming audio — speak before the text is finished",
      body: [
        "Remember how the LLM streams its reply token by token? TTS is built to take advantage of that. Instead of waiting for the whole reply, the pipeline grabs the **first complete sentence** the moment it's ready, sends it to TTS, and starts playing the resulting audio — all while the LLM is still writing the rest.",
        "Good TTS providers also stream their **audio** back in small chunks, so playback can begin the instant the first chunk arrives rather than after the whole sentence is synthesized. Stack those two tricks together — stream the text in, stream the audio out — and the gap between 'caller finishes' and 'caller hears a reply' shrinks dramatically. This is the producer/consumer dance you'll see in the real pipeline code later.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "The hard parts: pronunciation, numbers, and tails",
      body: [
        "TTS has its own quirks. It can mispronounce unusual names or brand words. It has to decide how to read \"$1,500\" or \"4/5\" or a phone number out loud, and it doesn't always guess right. On multilingual calls it has to switch languages mid-sentence without sounding jarring.",
        "And there's a sneaky technical one: **tail clipping**. If the audio connection is torn down a hair too early, the last word or two of the agent's sentence gets cut off — so the caller hears \"your appointment is confir—\". SnapServe has specific code to drain the final audio so endings aren't chopped. Little details like this are the difference between 'fine' and 'feels human'.",
      ],
    },
    {
      kind: "connections",
      title: "Where the mouth sits",
      intro:
        "TTS is the final block in a turn. Here's what feeds it and where the real code lives later.",
      nodes: [
        { id: "llm", label: "Brain: LLM", sublabel: "reply text", chapterSlug: "what-is-an-llm" },
        { id: "tts", label: "Mouth: TTS", sublabel: "THIS CHAPTER", current: true },
        { id: "tel", label: "Phone line", sublabel: "plays to caller", chapterSlug: "what-is-telephony" },
        { id: "code", label: "The TTS adapters", sublabel: "real code, Module 6", chapterSlug: "tts-adapters" },
      ],
      edges: [
        { from: "llm", to: "tts", label: "sentences (streamed)" },
        { from: "tts", to: "tel", label: "audio chunks" },
        { from: "tts", to: "code", label: "how it's wired up" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What does TTS do?",
          choices: [
            "Turns the caller's voice into text.",
            "Turns the agent's reply text into natural-sounding speech audio.",
            "Decides what the agent should say.",
            "Stores the call recording.",
          ],
          correctIndex: 1,
          explanation:
            "Text-to-Speech is the mirror of STT: it converts the brain's written reply into audio — the agent's mouth, the last step before the caller hears anything.",
        },
        {
          prompt: "Why doesn't the agent wait for the LLM's full reply before starting TTS?",
          choices: [
            "Because the LLM never finishes.",
            "To cut latency: it synthesizes and plays the first sentence while later sentences are still being generated.",
            "Because TTS can only handle one sentence ever.",
            "To save money on tokens.",
          ],
          correctIndex: 1,
          explanation:
            "Streaming the text in sentence-by-sentence and streaming the audio out chunk-by-chunk shrinks the delay before the caller hears a reply — the core latency trick.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "TTS is the agent's mouth: reply text → natural speech audio. It runs last in a turn.",
        "Modern TTS is highly natural; providers offer many voices and often voice cloning.",
        "It streams: the agent speaks the first sentence while the LLM is still writing the rest.",
        "Pronunciation of names/numbers and mid-sentence language switching are real challenges.",
        "Tail clipping (cutting off the last word) is a known pitfall SnapServe specifically guards against.",
      ],
    },
  ],
};
