import type { Chapter } from "../types";

export const turnSafetyNet: Chapter = {
  slug: "turn-safety-net",
  moduleId: "m4",
  number: "5.6",
  title: "The Turn Safety Net",
  summary:
    "What happens when STT streams half a transcript and then goes quiet forever? The two-timer safety net that rescues a turn from hanging on 'Listening…' — without ever cutting off a slow caller.",
  fileRef: "artifacts/api-server/src/orchestration/endpointing.ts",
  estMinutes: 15,
  prerequisites: ["endpointing", "session-and-pipeline"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The hang nobody plans for",
      paragraphs: [
        "The happy path of a turn is clean: the caller speaks, STT emits partials, then a **final**, and the agent replies. But the real world isn't clean. Sometimes STT streams a few partials and then — because of a network hiccup, an accent it can't resolve, or a provider quirk — **never sends a final**. Sometimes nothing usable arrives at all. The agent sits there, stuck in the 'Listening…' state, waiting for an event that will never come. The caller hears dead air. The call is effectively dead while still connected.",
        "The fix is a **safety net**: a small, self-contained class that watches the turn and forces progress if the normal signals fail. It lives in `endpointing.ts` and is shared by both the telephony pipeline and the browser webcall path so they behave identically. Read it in full on GitHub at `srundme/voiceorch` → `artifacts/api-server/src/orchestration/endpointing.ts`.",
      ],
    },
    {
      kind: "concept",
      title: "Two independent timers, two different failures",
      body: [
        "The genius of the design is recognising there are **two distinct failure modes**, each needing its own timer.",
        "**Force-finalize (tight, ~1.8 s):** STT **is** giving us partials but won't commit a final. We have usable text — we just need to stop waiting. This timer is armed on the first partial and reset on each new one. If it expires, we treat the best partial we've seen as if it were the final, and the turn proceeds.",
        "**Stall backstop (loose, ~10 s):** nothing usable is arriving at all — total silence from STT. Here we have no text to work with, so instead of finalizing we speak a gentle recovery reprompt (\"Sorry, are you still there?\") and listen again. After a couple of failed reprompts, we give up and end the call gracefully.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/endpointing.ts",
      language: "typescript",
      intro: "The defaults, all overridable by environment variable so they can be tuned in production without a redeploy.",
      code: `export const FORCE_FINALIZE_MS   = envInt("FORCE_FINALIZE_MS", 1800);
export const STALL_BACKSTOP_MS   = envInt("STALL_BACKSTOP_MS", 10000);
export const STALL_MAX_REPROMPTS = envInt("STALL_MAX_REPROMPTS", 2);`,
      lines: [
        {
          lines: "1",
          label: "FORCE_FINALIZE_MS = 1800",
          explanation:
            "If partials are flowing but no final lands within 1.8 s, force-close the turn from the best partial. Tight, because we already have text and the caller is waiting.",
        },
        {
          lines: "2-3",
          label: "the stall knobs",
          explanation:
            "If nothing usable arrives in 10 s, reprompt. After 2 reprompts with continued silence, end the call rather than leave it hanging forever.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/endpointing.ts",
      language: "typescript",
      intro:
        "The cleverest method is onPartial. A streaming partial is proof the caller is ACTIVELY talking — so it both arms the tight timer and pushes the stall backstop forward, resetting the reprompt count.",
      code: `onPartial(text: string): void {
  const t = text.trim();
  if (!t) return;
  this.bestPartial = t;
  if (this.forceTimer) clearTimeout(this.forceTimer);
  this.forceTimer = setTimeout(() => this.onForceExpire(), this.forceMs);
  // A partial means the caller is NOT silent. Reset the reprompt count and
  // push the stall backstop forward so the give-up path can only ever fire
  // on genuine sustained silence — never while a slow caller is still talking.
  this.repromptCount = 0;
  if (this.stallTimer) clearTimeout(this.stallTimer);
  this.stallTimer = setTimeout(() => this.onStallExpire(), this.stallMs);
}`,
      lines: [
        {
          lines: "4-6",
          label: "track best, re-arm the tight timer",
          explanation:
            "Every non-empty partial is remembered as `bestPartial` (our fallback text) and resets the 1.8 s force timer — so it only fires once partials actually STOP arriving.",
        },
        {
          lines: "10-12",
          label: "the subtle bug this prevents",
          explanation:
            "Without resetting repromptCount and the stall timer here, a caller whose STT streams partials but is slow to finalize would be wrongly treated as silent — reprompts would accumulate and the net would END a live call mid-sentence. A partial proves they're talking.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/endpointing.ts",
      language: "typescript",
      intro: "When the stall timer expires, the choice is reprompt-or-give-up, governed by the reprompt count.",
      code: `private onStallExpire(): void {
  this.stallTimer = null;
  this.clearTimers();
  this.bestPartial = "";
  if (this.repromptCount >= this.maxReprompts) {
    this.opts.onStallGiveUp();      // end the call gracefully
  } else {
    this.repromptCount++;
    this.opts.onStallReprompt();    // "are you still there?" + re-listen
  }
}`,
      lines: [
        {
          lines: "5-6",
          label: "give up after max reprompts",
          explanation:
            "Only after repeated reprompts with continued silence do we end the call — and via the existing inactivity path, not an abrupt drop, so it's logged cleanly.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "An empty best-partial is a no-op",
      body: [
        "When the force-finalize timer expires, it checks the best partial first. If that text is empty — partials fired but were all blank — it does **nothing** and lets the stall backstop handle the situation instead. Forcing a turn on empty text would send garbage to the LLM. The two timers are designed to hand off cleanly: force-finalize owns 'have text', stall owns 'have nothing'.",
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Why give-up is a reprompt, not a hangup",
      body: [
        "On an outbound sales or reminder call, a hangup is a lost lead. So the stall path doesn't immediately end the call on silence — it first tries to recover the human with a reprompt, in their own language. Only sustained silence across multiple reprompts ends the call. This is a product decision encoded into infrastructure: be persistent, but not infinitely so.",
      ],
    },
    {
      kind: "connections",
      title: "Where the safety net sits",
      intro: "The net wraps the listening phase, sitting alongside endpointing and feeding back into the pipeline.",
      nodes: [
        { id: "end", label: "Endpointing", sublabel: "normal turn-end", chapterSlug: "endpointing" },
        { id: "net", label: "Turn safety net", sublabel: "THIS CHAPTER", current: true },
        { id: "echo", label: "Echo gates", sublabel: "re-arm on discard", chapterSlug: "barge-in-and-echo" },
        { id: "pipe", label: "The pipeline", sublabel: "telephony + webcall", chapterSlug: "session-and-pipeline" },
      ],
      edges: [
        { from: "end", to: "net", label: "no final?" },
        { from: "net", to: "pipe", label: "force-finalize / reprompt / end" },
        { from: "echo", to: "net", label: "beginListening()" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What problem does the turn safety net solve?",
          choices: [
            "Callers talking too fast.",
            "A turn hanging forever because STT streamed partials but never sent a final, or sent nothing usable at all.",
            "The LLM hallucinating.",
            "Audio being too loud.",
          ],
          correctIndex: 1,
          explanation:
            "Without the net, a missing final (or total STT silence) leaves the agent stuck in 'Listening…' with the caller hearing dead air. The net forces progress.",
        },
        {
          prompt: "Why does the force-finalize timer use a short (~1.8 s) window while the stall backstop uses a long (~10 s) one?",
          choices: [
            "They're random values.",
            "Force-finalize already has usable text and the caller is waiting (act fast); the stall backstop has nothing and must avoid cutting off a slow caller (wait longer).",
            "Force-finalize handles silence, stall handles speech.",
            "The longer one saves money.",
          ],
          correctIndex: 1,
          explanation:
            "Different failure modes: 'have text, won't commit' needs a quick nudge; 'have nothing' must be patient so a genuinely slow caller isn't ended prematurely.",
        },
        {
          prompt: "Why does onPartial() reset the reprompt count and push the stall timer forward?",
          choices: [
            "To save memory.",
            "A partial proves the caller is actively speaking, so the give-up path must not fire — otherwise a slow-to-finalize caller would be wrongly treated as silent and the call ended.",
            "To make transcription more accurate.",
            "Because partials are errors.",
          ],
          correctIndex: 1,
          explanation:
            "Streaming partials mean a human is talking. Resetting the reprompt count guarantees the net only ends a call on genuine sustained silence.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "The safety net rescues turns where STT never emits a final or goes silent — preventing the 'Listening…' hang.",
        "Two independent timers: force-finalize (tight, have text) and stall backstop (loose, have nothing).",
        "A streaming partial proves the caller is talking, so it resets the reprompt count — never end a call on a slow caller.",
        "An empty best-partial makes force-finalize a no-op; the stall path takes over instead.",
        "Give-up is a graceful reprompt-then-end, not an instant hangup — a lost call is a lost lead.",
        "The class is shared by telephony and webcall so both paths behave identically.",
      ],
    },
  ],
};
