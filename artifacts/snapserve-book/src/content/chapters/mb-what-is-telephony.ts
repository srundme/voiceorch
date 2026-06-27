import type { Chapter } from "../types";

export const whatIsTelephony: Chapter = {
  slug: "what-is-telephony",
  moduleId: "mb",
  number: "0.5",
  title: "What Is Telephony?",
  summary:
    "The phone line itself: how code connects to the real phone network, how audio actually travels, and why phone audio is so low-fi.",
  estMinutes: 11,
  prerequisites: ["what-is-a-voice-agent"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The plumbing nobody sees",
      paragraphs: [
        "**Telephony** is the technology of phone calls — the actual network that carries your voice when you dial a number. The global phone system is sometimes called the **PSTN** (Public Switched Telephone Network). It's a century-old, planet-spanning machine, and our shiny AI agent is useless unless it can plug into it.",
        "Here's the catch: a normal computer program can't just 'pick up the phone'. It needs a bridge between the internet (where our code lives) and the phone network (where the caller lives). That bridge is provided by telephony companies. SnapServe supports several: **Twilio**, **Plivo**, and **VoBiz**.",
      ],
    },
    {
      kind: "analogy",
      title: "A delivery service for audio",
      body: [
        "Think of a telephony provider like a courier company sitting between two worlds. On one side is the phone network with its phone numbers and carriers; on the other side is our server with its code. The provider's job is to pick up packets of audio from the caller, deliver them to our server, and carry our agent's reply back — continuously, in both directions, for the whole call.",
        "We don't have to know anything about the phone network's ancient internals. We just have to speak the courier's language: receive their audio packets, and hand back ours.",
      ],
    },
    {
      kind: "concept",
      title: "The media stream — audio in tiny frames",
      body: [
        "Once a call connects, the telephony provider opens a live, two-way connection to our server (usually a **WebSocket** — a persistent internet connection that stays open and lets both sides send messages whenever they like). Down this pipe flows the **media stream**: the caller's voice, chopped into a rapid sequence of tiny audio **frames**, typically one every 20 milliseconds.",
        "Our agent sends its reply the same way — small audio frames, streamed back continuously. The whole conversation is really just two streams of little audio packets crossing in opposite directions. The pipeline you'll study in Module 5 is, at its core, a machine for consuming the inbound frames and producing the outbound ones.",
      ],
    },
    {
      kind: "concept",
      title: "Codecs and why phone audio sounds bad",
      body: [
        "Phone audio is deliberately low quality. To save bandwidth, the network samples sound only **8,000 times a second** (8 kHz) — music streaming uses ~44,000. And it compresses each sample using an old scheme, most commonly **μ-law** (pronounced 'mew-law'). A **codec** is just the agreed format for how that audio is encoded.",
        "This matters to us in two ways. First, the very first thing our code does with incoming audio is **decode** μ-law into normal numbers the AI can process, and the last thing it does is **encode** back to μ-law to send out. Second, that thin 8 kHz audio is part of why STT on phone calls is harder than on a good microphone — there's simply less signal to work with.",
      ],
    },
    {
      kind: "concept",
      title: "Webhooks, and inbound vs outbound",
      body: [
        "Telephony providers talk to our server using **webhooks** — when something happens (a call comes in, a call is answered, a call ends), the provider sends an HTTP request to a URL we gave them, in real time. Our server has routes waiting to handle each event. Webhooks are how the outside world **pushes** events to us instead of us constantly asking 'anything new?'.",
        "Calls come in two directions. **Inbound**: someone dials the agent's number and the provider rings our server. **Outbound**: our code tells the provider 'please call this number', used for things like appointment reminders and campaigns. The audio plumbing is the same once connected; only who-started-it differs.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Every provider is a little bit different",
      body: [
        "Although Twilio, Plivo, and VoBiz all do the same job, they each speak a slightly different dialect: different webhook formats, different ways of framing audio, even different audio encodings (some send μ-law, some send raw PCM). One provider will even **drop the call** if you don't send it some audio within the first couple of seconds.",
        "SnapServe hides all of this behind a common interface so the rest of the system doesn't care which provider is on the line. Taming these per-provider quirks is the entire subject of Module 7 — and a great example of why real-world code is messier than the textbook diagram.",
      ],
    },
    {
      kind: "connections",
      title: "Where the phone line sits",
      intro:
        "Telephony is the outermost ring — it wraps the whole STT → LLM → TTS loop. Here's where to read the real code.",
      nodes: [
        { id: "tel", label: "Telephony", sublabel: "THIS CHAPTER", current: true },
        { id: "stt", label: "Ears: STT", sublabel: "gets caller audio", chapterSlug: "what-is-stt" },
        { id: "tts", label: "Mouth: TTS", sublabel: "sends reply audio", chapterSlug: "what-is-tts" },
        { id: "ov", label: "Telephony overview", sublabel: "real code, Module 7", chapterSlug: "telephony-overview" },
        { id: "tw", label: "Twilio deep dive", sublabel: "Module 7", chapterSlug: "twilio-deep-dive" },
      ],
      edges: [
        { from: "tel", to: "stt", label: "inbound frames (μ-law)" },
        { from: "tts", to: "tel", label: "outbound frames" },
        { from: "tel", to: "ov", label: "how it's wired up" },
        { from: "tel", to: "tw", label: "one provider in depth" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What is the role of a telephony provider like Twilio, Plivo, or VoBiz?",
          choices: [
            "It generates the agent's replies.",
            "It bridges the phone network (PSTN) and our server, carrying audio both ways during a call.",
            "It transcribes speech to text.",
            "It stores caller memory.",
          ],
          correctIndex: 1,
          explanation:
            "Telephony providers connect the century-old phone network to our internet code, streaming the caller's audio in and the agent's audio out.",
        },
        {
          prompt: "Why does our code have to decode μ-law audio the moment it arrives?",
          choices: [
            "Because μ-law is encrypted.",
            "Because phone audio is compressed (μ-law) at 8 kHz, and the AI needs it decoded into plain numbers to process it.",
            "Because it's illegal to keep μ-law audio.",
            "It doesn't — μ-law is used directly by the LLM.",
          ],
          correctIndex: 1,
          explanation:
            "Phone audio arrives as compressed 8 kHz μ-law. We decode it to plain PCM samples for the AI on the way in, and encode back to μ-law on the way out.",
        },
        {
          prompt: "What is a 'webhook' in this context?",
          choices: [
            "A type of phone cable.",
            "An HTTP request the provider sends to our server in real time when an event happens (call received, answered, ended).",
            "The agent's system prompt.",
            "A way to clone a voice.",
          ],
          correctIndex: 1,
          explanation:
            "Webhooks let the provider push events to us as they happen, hitting URLs our server exposes — instead of us polling for updates.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Telephony connects our code to the real phone network (the PSTN); providers are Twilio, Plivo, VoBiz.",
        "Once connected, audio flows as a media stream of tiny frames (≈ every 20 ms) over a WebSocket, both directions.",
        "Phone audio is low-fi: 8 kHz, compressed with a codec like μ-law — decoded on the way in, encoded on the way out.",
        "Webhooks push call events to our server; calls are inbound (caller dials us) or outbound (we dial out).",
        "Each provider has quirks (formats, encodings, cold-start rules); SnapServe hides them behind one common interface.",
      ],
    },
  ],
};
