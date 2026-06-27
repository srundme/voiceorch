import type { Chapter } from "../types";

export const bargeInAndEcho: Chapter = {
  slug: "barge-in-and-echo",
  moduleId: "m4",
  number: "5.5",
  title: "Barge-In & the Self-Echo Gate",
  summary:
    "Two opposite problems on one audio stream: let the caller interrupt the agent instantly, but never let the agent interrupt itself when its own voice echoes back down the line.",
  fileRef: "artifacts/api-server/src/orchestration/pipeline.ts",
  estMinutes: 16,
  prerequisites: ["session-and-pipeline", "silero-vad"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The interruption tightrope",
      paragraphs: [
        "Real conversations have interruptions. You start explaining something, the other person already gets it and cuts in with \"yeah, yeah, got it\" — and you **stop talking**. An agent that ploughs on through your interruption feels robotic and rude. So the agent must detect when the caller starts speaking over it and immediately stop its own audio. This is called **barge-in**.",
        "But here's the cruel twist. When the agent speaks, its own voice travels down the phone line, and on many carriers a faint copy of that audio **echoes back** into the inbound stream. To the agent's ears, that echo looks exactly like the caller talking. If we're not careful, the agent hears itself, thinks 'the caller is interrupting!', and stops talking — interrupting itself into silence. So we need the opposite reflex too: ignore our own echo.",
        "These two requirements pull in opposite directions: be **eager** to stop for the caller, be **deaf** to yourself. The real code in `pipeline.ts` walks this tightrope. We won't reproduce all of it — read the full thing on GitHub at `srundme/voiceorch` → `artifacts/api-server/src/orchestration/pipeline.ts`. Here we'll explain the trickiest gates.",
      ],
    },
    {
      kind: "concept",
      title: "Two layers of defence against your own echo",
      body: [
        "The pipeline uses two separate echo guards, because one alone isn't enough.",
        "**Time-window guard:** for a short grace period right after the agent starts (or finishes) speaking, treat any inbound speech as suspect echo. Cheap and catches the common case.",
        "**Content guard:** the carrier sometimes echoes our words back *after* the time window has expired. So there's a second check — does this transcript closely *match the words the agent just spoke*? If so, it's our own audio returning, no matter when it arrived. Token overlap, tolerant of STT noise.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "First, the tuning constants. Notice barge-in uses a much higher energy bar than ordinary voice detection — it must be an intentional interruption, not a cough.",
      code: `const BARGE_IN_ENERGY_THRESHOLD = 1200; // Much higher than normal VAD (300) — only intentional
const BARGE_IN_ECHO_GRACE_MS  = 600;    // Suppress barge-in for 600 ms after playback starts
const BARGE_IN_MIN_FRAMES     = 3;      // Absolute floor on barge-in frames (~60 ms)

const SELF_ECHO_TAIL_MS       = 2000;   // how long after a line ends its carrier echo may linger
const SELF_ECHO_MIN_OVERLAP   = 0.6;    // fraction of spoken tokens that must appear to call it echo`,
      lines: [
        {
          lines: "1",
          label: "BARGE_IN_ENERGY_THRESHOLD = 1200",
          explanation:
            "Normal voice-activity detection triggers at ~300. Barge-in demands ~1200 — four times louder. A genuine interruption is forceful; this avoids stopping for background noise or a quiet 'mm-hm'.",
        },
        {
          lines: "2",
          label: "BARGE_IN_ECHO_GRACE_MS = 600",
          explanation:
            "For 600 ms after the agent's audio starts, barge-in is suppressed — that's the window when our own fresh audio is most likely echoing back. The caller can still interrupt after it.",
        },
        {
          lines: "5-6",
          label: "the content-guard knobs",
          explanation:
            "An echo can return up to 2 s after a line ends. If at least 60% of the transcript's tokens match what we just said, it's classified as our own echo — even outside the time window.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The content-based self-echo guard. Crucially, semantic interrupts like 'stop' and 'wait' are exempt — the agent never says those to itself, so they must always be allowed through.",
      code: `if (!isSemanticInterrupt(transcript) && this.isSelfEcho(transcript)) {
  this.streamingBargeInWordCount = 0;
  logger.info({ callId, transcript }, "discarding self-echo transcript (content match)");
  // When not playing we're in a listening turn: re-arm the stall backstop.
  if (!this.isPlaying) this.safetyNet.beginListening();
  return;
}`,
      lines: [
        {
          lines: "1",
          label: "the two-part condition",
          explanation:
            "Discard only if it's NOT a semantic interrupt AND it looks like our own speech. The `!isSemanticInterrupt` half is the escape hatch — 'stop'/'wait' can never be mistaken for echo, so they bypass this guard entirely.",
        },
        {
          lines: "5",
          label: "re-arm the safety net",
          explanation:
            "Discarding the echo would otherwise leave the turn in limbo. If the agent isn't currently speaking, we re-enter clean 'Listening…' so the turn-safety-net timers restart. (See the next chapter.)",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Semantic interrupts must always win",
      body: [
        "The single most important rule here: words like \"stop\", \"wait\", \"hold on\" bypass **both** the echo grace **and** the word-count threshold. Why? Because the agent's own audio never contains those words — so if they appear in the inbound stream, it's unambiguously the caller. Treating them as possible echo would mean ignoring the one phrase a frustrated caller most needs to work.",
        "This is a recurring pattern in good voice code: a general safety rule (suppress echo) plus a carefully reasoned exception (except the words that prove it's a human).",
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Where the echo grace is re-armed matters enormously",
      body: [
        "A subtle bug magnet: the 600 ms echo grace must be re-armed at the **start of each sentence** and at the **tail end of playback** — but never per audio chunk or per frame, and never for the full duration of a long sentence. Get this wrong and you create a window where the caller simply *cannot* interrupt a long reply, because the grace keeps resetting.",
        "The fix the codebase settled on uses the *sentence-start* timestamp for the streaming path, so once the initial 600 ms passes the caller can cut in mid-sentence — while a separate, longer hold protects the multi-second opening greeting (whose carrier echo outlasts 600 ms).",
      ],
    },
    {
      kind: "connections",
      title: "How barge-in fits the pipeline",
      intro: "The echo gates sit on the inbound transcript path, just before barge-in is allowed to fire.",
      nodes: [
        { id: "stt", label: "Streaming STT", sublabel: "inbound transcript", chapterSlug: "stt-adapters" },
        { id: "echo", label: "Echo gates", sublabel: "THIS CHAPTER", current: true },
        { id: "barge", label: "Barge-in", sublabel: "stop playback" },
        { id: "net", label: "Turn safety net", sublabel: "re-listen", chapterSlug: "turn-safety-net" },
        { id: "pipe", label: "The pipeline", sublabel: "the conductor", chapterSlug: "session-and-pipeline" },
      ],
      edges: [
        { from: "stt", to: "echo", label: "transcript" },
        { from: "echo", to: "barge", label: "if real caller" },
        { from: "echo", to: "net", label: "if discarded as echo" },
        { from: "barge", to: "pipe", label: "interrupt TTS" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does the agent need a 'self-echo' guard at all?",
          choices: [
            "To save bandwidth.",
            "Because the carrier echoes the agent's own voice back into the inbound stream, which can look like the caller interrupting.",
            "To detect background music.",
            "To improve transcription accuracy.",
          ],
          correctIndex: 1,
          explanation:
            "On many phone carriers the agent's own TTS audio loops back. Without a guard the agent would mistake its own voice for a caller barge-in and silence itself.",
        },
        {
          prompt: "Why are semantic interrupts ('stop', 'wait') exempt from the echo guards?",
          choices: [
            "They're louder.",
            "The agent never speaks those words itself, so their presence is unambiguous proof the caller is talking.",
            "They're shorter to process.",
            "They're in a different language.",
          ],
          correctIndex: 1,
          explanation:
            "Since the agent's own audio can never contain 'stop'/'wait', these phrases bypass both the echo grace and the word-count gate so a caller can always interrupt.",
        },
        {
          prompt: "Why is barge-in's energy threshold (1200) set far higher than normal voice detection (300)?",
          choices: [
            "To save CPU.",
            "So only an intentional, forceful interruption stops the agent — not a cough, background noise, or a quiet 'mm-hm'.",
            "Because phone audio is quiet.",
            "It's an arbitrary number.",
          ],
          correctIndex: 1,
          explanation:
            "Barge-in is disruptive (it stops the agent mid-sentence), so it demands a clearly intentional interruption rather than any small sound.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Barge-in lets the caller interrupt the agent; the agent must stop speaking instantly.",
        "Self-echo is the opposite hazard: the carrier loops the agent's own voice back, which can look like an interruption.",
        "Two guards defend against echo — a time window and a content match (token overlap with what was just said).",
        "Semantic interrupts ('stop'/'wait') bypass every guard because the agent never says them to itself.",
        "Where the echo grace is re-armed is critical: per-sentence, not per-frame, or callers can't interrupt long replies.",
      ],
    },
  ],
};
