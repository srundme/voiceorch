import type { Chapter } from "../types";

export const endpointing: Chapter = {
  slug: "endpointing",
  moduleId: "m4",
  number: "5.3",
  title: "Endpointing: Knowing When They're Done",
  summary:
    "How the system detects the end of a caller's turn without interrupting them or leaving dead air.",
  estMinutes: 18,
  fileRef: "artifacts/api-server/src/orchestration/endpointing.ts",
  prerequisites: ["session-and-pipeline"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "The single hardest problem in voice AI isn't understanding words — it's knowing **when the caller has finished talking**. Wait too little and you cut them off mid-sentence ('my policy number is four-seven—' *agent interrupts*). Wait too long and there's an awkward, robotic gap before the agent replies. Humans solve this effortlessly with intuition; software has to do it with a stopwatch.",
        "That stopwatch is `endpointing.ts`. The previous chapter's `scheduleSilenceFlush` asked it one question — 'how many milliseconds of silence mean the turn is over?' — and this file answers it. But it does more than pick a number: it also runs the **safety net** that rescues a call when speech-to-text gets stuck and never returns a final transcript. Two jobs, one small file, shared by both the telephony pipeline and the browser webcall path so they behave identically.",
      ],
    },
    {
      kind: "concept",
      title: "Adaptive endpointing: context beats a constant",
      body: [
        "A naive system waits a fixed amount of silence — say 250 ms — before deciding the caller is done. The problem: that one number can't be right for every situation. After 'Did you mean tomorrow?' a quick 'yes' should flush almost instantly. But after 'What's your sixteen-digit card number?' the caller will pause between digits, and 250 ms will chop their answer to pieces.",
        "So `computeEndpointMs` looks at **context** and returns a tailored wait. It checks four signals in priority order: (1) Is the agent asking for a number? Wait long. (2) Does the streaming partial transcript end mid-thought ('and…', 'so…')? Wait longer. Does it end in punctuation or a clear 'yes/no'? Flush fast. (3) Was the audio burst really short? Probably a one-word answer — flush fast. (4) Otherwise fall back to the agent's configured baseline.",
        "Higher-priority signals win. This turns a single magic number into a decision that feels like a human's sense of timing.",
      ],
    },
    {
      kind: "analogy",
      title: "A good conversational partner reads the room",
      body: [
        "Imagine listening to a friend recite a phone number. You don't jump in after every digit — you can tell they're mid-list because their voice trails 'up'. But when they say 'okay, that's it,' you respond immediately. You're not counting seconds; you're reading **cues**.",
        "`computeEndpointMs` encodes those cues as rules: trailing conjunctions and digit-reading mean 'they're not done — hold on'; terminal punctuation and short affirmations mean 'they're done — go now'.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/endpointing.ts",
      language: "typescript",
      intro:
        "First, the named time constants. Every endpoint decision resolves to one of these — no magic numbers scattered through the logic.",
      code: `/** Snappy flush: "yes", "no", ends in "." / "?" */
export const ENDPOINT_FAST_MS        = 150;
/** Neutral baseline — snappier default endpointing window (was 250ms). */
export const ENDPOINT_DEFAULT_MS     = 150;
/** Mid-thought: ends in conjunction / filler word ("and", "so", "um"). */
export const ENDPOINT_LONG_MS        = 600;
/** Digit-collection: caller is reading a policy/phone/OTP number. */
export const ENDPOINT_DIGIT_MS       = 800;
/** Digit-collection AND partial transcript ends in a digit (still reading). */
export const ENDPOINT_DIGIT_TRAIL_MS = 900;`,
      lines: [
        {
          lines: "1-2",
          label: "ENDPOINT_FAST_MS = 150",
          explanation:
            "The snappy end. A clearly-complete utterance — a 'yes', or a sentence ending in `.`/`?` — only needs 150 ms of silence before we flush. This is what makes quick back-and-forth feel instant.",
        },
        {
          lines: "5-6",
          label: "ENDPOINT_LONG_MS = 600",
          explanation:
            "Mid-thought. If the caller trailed off on 'and…' or 'so…', we wait 600 ms — four times longer — to give them room to continue before assuming they're done.",
        },
        {
          lines: "7-10",
          label: "ENDPOINT_DIGIT_MS / TRAIL_MS",
          explanation:
            "Digit collection. When the agent asked for a number, hold 800 ms; and if the partial transcript currently ends in a digit (they're still reading), stretch to 900 ms so a pause between digits never ends the turn early.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/endpointing.ts",
      language: "typescript",
      intro:
        "Signal #1 is the highest priority: is the agent asking for a number? A keyword scan over the agent's last line decides.",
      code: `const DIGIT_KEYWORDS = [
  "policy number", "phone number", "mobile number", "contact number",
  "date of birth", "dob", "otp", "one-time password", "pin", "passcode",
  "id number", "account number", "card number", "aadhaar", "aadhar",
  // …more…
];

/**
 * Returns true when the agent's last utterance appears to be requesting
 * a number the caller will read digit-by-digit.
 */
export function isDigitCollectionContext(lastAgentText: string): boolean {
  const lower = lastAgentText.toLowerCase();
  for (const kw of DIGIT_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}`,
      lines: [
        {
          lines: "1-6",
          label: "DIGIT_KEYWORDS",
          explanation:
            "A list of phrases that signal a number is coming — 'policy number', 'otp', 'card number', 'aadhaar', and many more (the full list is India-aware: PAN, GSTIN, Aadhaar). If the agent's last line contains any of these, we're in digit-collection mode.",
        },
        {
          lines: "12-13",
          label: "lowercase the agent's text",
          explanation:
            "Case-fold once up front so the keyword match is case-insensitive ('OTP' and 'otp' both hit).",
        },
        {
          lines: "14-16",
          label: "substring scan",
          explanation:
            "A simple `includes` over every keyword. The moment one matches, return `true` — that single fact bumps the wait window to 800 ms+ and outranks every other signal.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/endpointing.ts",
      language: "typescript",
      intro:
        "Now the decision function itself. Read it top-to-bottom — the order IS the priority. Highest-priority match wins and returns early.",
      code: `export function computeEndpointMs(opts: {
  lastAgentText: string;
  partialTranscript: string;
  audioBufferMs: number;
  baseSilenceMs: number;
}): EndpointDecision {
  const { lastAgentText, partialTranscript, audioBufferMs, baseSilenceMs } = opts;

  // ── 1. Digit-collection context (highest priority) ─────────────────────────
  if (isDigitCollectionContext(lastAgentText)) {
    const partial = partialTranscript.trim();
    if (partial.length > 0 && /\\d$/.test(partial)) {
      // Still actively reading digits — extend even further
      return { ms: ENDPOINT_DIGIT_TRAIL_MS, reason: "digit-collection:trailing-digit" };
    }
    return { ms: ENDPOINT_DIGIT_MS, reason: "digit-collection" };
  }

  // ── 2. Partial transcript analysis (streaming STT active) ──────────────────
  const partial = partialTranscript.trim().toLowerCase();
  if (partial.length > 0) {
    // Clearly complete: terminal punctuation added by STT smart_format
    if (/[.?!।]$/.test(partial)) {
      return { ms: ENDPOINT_FAST_MS, reason: "terminal-punctuation" };
    }

    // Single-word affirmation ("yes", "okay", "correct", …)
    if (AFFIRMATIONS.has(partial)) {
      return { ms: ENDPOINT_FAST_MS, reason: "affirmation" };
    }

    // Ends in a dangling/filler word — likely mid-utterance
    const lastWord = partial.split(/\\s+/).pop() ?? "";
    if (DANGLING_WORDS.has(lastWord)) {
      return { ms: ENDPOINT_LONG_MS, reason: \`dangling:\${lastWord}\` };
    }`,
      lines: [
        {
          lines: "1-7",
          label: "the four inputs",
          explanation:
            "Everything the decision needs: the agent's last line, the latest streaming partial transcript (empty on the batch path), the caller's speech duration in ms, and the agent-configured baseline. No hidden globals.",
        },
        {
          lines: "9-17",
          label: "priority 1 — digits",
          explanation:
            "If we're collecting digits, return immediately. `/\\d$/` checks whether the partial currently **ends in a digit** — if so the caller is mid-number, so hold the longest (900 ms); otherwise the standard digit wait (800 ms).",
        },
        {
          lines: "22-24",
          label: "terminal punctuation → fast",
          explanation:
            "Streaming STT often adds smart-format punctuation. A partial ending in `.`/`?`/`!`/`।` (the Devanagari danda) is a complete thought — flush in 150 ms.",
        },
        {
          lines: "27-29",
          label: "affirmation → fast",
          explanation:
            "A bare 'yes', 'okay', 'correct' from the `AFFIRMATIONS` set is unmistakably done. No need to wait — 150 ms and go.",
        },
        {
          lines: "32-35",
          label: "dangling word → long",
          explanation:
            "If the last word is a conjunction or filler ('and', 'so', 'um', 'because'), the caller is mid-sentence. Hold 600 ms. The `reason` even names the word, so the latency logs explain themselves.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/endpointing.ts",
      language: "typescript",
      intro:
        "The tail of the same function: the short-burst proxy for the batch path, then the safe fallback.",
      code: `  // ── 3. Audio duration proxy (batch path — no partial transcript available) ─
  if (partial.length === 0) {
    // Short audio burst: likely a quick single-word answer
    if (audioBufferMs > 0 && audioBufferMs < 600) {
      return { ms: ENDPOINT_FAST_MS, reason: "short-audio" };
    }
  }

  // ── 4. Fallback: agent-configured baseline ─────────────────────────────────
  return { ms: baseSilenceMs, reason: "base" };
}`,
      lines: [
        {
          lines: "2-6",
          label: "priority 3 — short audio",
          explanation:
            "On the batch path there's no partial transcript to read, so we use duration as a proxy: under 600 ms of speech is probably a one-word reply — flush fast. (Only checked when there's no partial, hence `partial.length === 0`.)",
        },
        {
          lines: "9-10",
          label: "priority 4 — base",
          explanation:
            "Nothing special matched, so return the agent's configured `baseSilenceMs` (the per-agent `vadSilenceMs`). Every path returns an `EndpointDecision` with a `reason`, so there's never an unexplained wait.",
        },
      ],
    },
    {
      kind: "concept",
      title: "The safety net: when STT just... stops",
      body: [
        "Adaptive endpointing assumes speech-to-text eventually returns a transcript. But streaming STT can misbehave: it emits interim 'partials' as the caller talks and then — especially on code-mixed Tamil/Hinglish speech — **never delivers a final**. The turn never closes, the agent sits on 'Listening…', and the call dies in silence.",
        "`TurnSafetyNet` guards against this with **two independent timers**. The tight one — FORCE-FINALIZE — says: if partials are arriving but no final shows up, force-close the turn using the best partial we've seen. The loose one — STALL BACKSTOP — says: if no usable transcript arrives at all, speak a recovery reprompt ('Sorry, could you say that again?'), and after a couple of those with continued silence, end the call gracefully instead of hanging.",
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Tunable via env vars",
      body: [
        "The safety-net timings ship with sensible defaults but are environment-overridable (see `replit.md`): `FORCE_FINALIZE_MS` (default 1800) — force-finalize from the best partial after this much silence; `STALL_BACKSTOP_MS` — speak a recovery reprompt when no usable transcript arrives at all; `STALL_MAX_REPROMPTS` (default 2) — give up and end the call after this many reprompts.",
        "`FORCE_FINALIZE_MS` is deliberately set **above** the adaptive ceiling (900 ms) but **below** the carrier's drop timeout — it's a backstop, not a primary path.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/endpointing.ts",
      language: "typescript",
      intro:
        "The env-var plumbing and the constants. `envInt` reads a positive integer from the environment, falling back to a default.",
      code: `function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : def;
}
/** Tight timer: partials arriving but no final → force-close using the best partial. */
export const FORCE_FINALIZE_MS  = envInt("FORCE_FINALIZE_MS", 1800);
/** Loose backstop: no usable transcript at all since we entered "Listening…" →
 *  recovery reprompt (not a hangup). */
export const STALL_BACKSTOP_MS  = envInt("STALL_BACKSTOP_MS", 10000);
/** Max consecutive stall reprompts before ending the call. */
export const STALL_MAX_REPROMPTS = envInt("STALL_MAX_REPROMPTS", 2);`,
      lines: [
        {
          lines: "1-6",
          label: "envInt(name, def)",
          explanation:
            "Read `process.env[name]`. If it's missing or not a finite positive number, return the default. This is the standard 'configurable with a safe fallback' pattern used across the codebase.",
        },
        {
          lines: "8",
          label: "FORCE_FINALIZE_MS",
          explanation:
            "The tight timer's duration. Partials but no final for this long → force the turn closed from the best partial we captured.",
        },
        {
          lines: "11-13",
          label: "STALL_BACKSTOP_MS + MAX_REPROMPTS",
          explanation:
            "The loose backstop and the reprompt budget. After ~10 s of nothing usable, reprompt; after `STALL_MAX_REPROMPTS` reprompts with continued silence, end the call.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/endpointing.ts",
      language: "typescript",
      intro:
        "The heart of the safety net: arming and resetting the two timers as partials flow in.",
      code: `  /** Enter "Listening…" — (re)arm the stall backstop. Idempotent per turn. */
  beginListening(): void {
    this.clearTimers();
    this.bestPartial = "";
    this.stallTimer = setTimeout(() => this.onStallExpire(), this.stallMs);
  }

  /** Non-empty interim arrived — track best partial and (re)arm the tight timer. */
  onPartial(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.bestPartial = t;
    if (this.forceTimer) clearTimeout(this.forceTimer);
    this.forceTimer = setTimeout(() => this.onForceExpire(), this.forceMs);
    // A streaming partial means the caller is ACTIVELY speaking — they are not
    // silent. Push the stall backstop forward and reset the accumulated reprompt
    // count so the give-up path can only ever fire on genuine sustained silence.
    this.repromptCount = 0;
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => this.onStallExpire(), this.stallMs);
  }`,
      lines: [
        {
          lines: "2-6",
          label: "beginListening()",
          explanation:
            "Called when the agent finishes speaking and starts listening. It clears any old timers, wipes the best-partial buffer, and arms the loose stall backstop. Idempotent — safe to call repeatedly per turn.",
        },
        {
          lines: "9-14",
          label: "onPartial — arm the tight timer",
          explanation:
            "Every non-empty interim updates `bestPartial` (the fallback text we'd force-finalize with) and **resets** the tight FORCE-FINALIZE timer. As long as partials keep arriving, the tight timer keeps getting pushed out.",
        },
        {
          lines: "15-20",
          label: "partials mean 'not silent'",
          explanation:
            "A subtle but critical fix: a streaming partial proves the caller is talking, so we reset `repromptCount` and push the stall backstop forward. Without this, a caller whose STT streams partials but is slow to finalize would be wrongly treated as silent — and the safety net would end a live call.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/endpointing.ts",
      language: "typescript",
      intro:
        "And what each timer does when it fires — force-finalize with the best partial, or escalate the stall.",
      code: `  private onForceExpire(): void {
    this.forceTimer = null;
    const best = this.bestPartial.trim();
    if (!best) return;            // empty → let the stall backstop handle it
    this.clearTimers();
    this.bestPartial = "";
    this.repromptCount = 0;
    this.opts.onForceFinalize(best);
  }

  private onStallExpire(): void {
    this.stallTimer = null;
    this.clearTimers();
    this.bestPartial = "";
    if (this.repromptCount >= this.maxReprompts) {
      this.opts.onStallGiveUp();
    } else {
      this.repromptCount++;
      this.opts.onStallReprompt();
    }
  }`,
      lines: [
        {
          lines: "1-9",
          label: "onForceExpire",
          explanation:
            "The tight timer fired. If we have a non-empty best partial, treat it as the final transcript via `onForceFinalize(best)` — the turn proceeds as if STT had delivered it. If the best partial is empty, do nothing and let the stall backstop handle a truly silent caller.",
        },
        {
          lines: "11-21",
          label: "onStallExpire",
          explanation:
            "The loose timer fired with nothing usable. If we've already hit the reprompt limit, call `onStallGiveUp()` (end the call). Otherwise increment the count and `onStallReprompt()` — speak 'sorry, could you repeat that?' and listen again.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Endpointing is a decision helper the pipeline leans on every turn. Click any box to jump to its chapter.",
      nodes: [
        { id: "pipeline", label: "scheduleSilenceFlush()", sublabel: "pipeline.ts", chapterSlug: "session-and-pipeline" },
        { id: "compute", label: "computeEndpointMs()", sublabel: "endpointing.ts — THIS FILE", current: true },
        { id: "safety", label: "TurnSafetyNet", sublabel: "endpointing.ts — THIS FILE", current: true },
        { id: "stt", label: "STT adapter", sublabel: "partials & finals", chapterSlug: "stt-adapters" },
        { id: "webcall", label: "webcall.ts", sublabel: "browser path (shares this)", chapterSlug: "webcall" },
      ],
      edges: [
        { from: "pipeline", to: "compute", label: "context in → ms out" },
        { from: "stt", to: "safety", label: "partials (onPartial)" },
        { from: "safety", to: "pipeline", label: "onForceFinalize / reprompt" },
        { from: "webcall", to: "compute", label: "same decision fn" },
        { from: "webcall", to: "safety", label: "same safety net" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "The agent just asked 'What is your policy number?' and the caller's partial reads '4 7 2 9'. Which window does `computeEndpointMs` return?",
          choices: [
            "ENDPOINT_FAST_MS (150 ms)",
            "ENDPOINT_DIGIT_TRAIL_MS (900 ms)",
            "ENDPOINT_DEFAULT_MS (150 ms)",
            "baseSilenceMs",
          ],
          correctIndex: 1,
          explanation:
            "Digit-collection context is priority 1, and the partial ends in a digit (`/\\d$/`), so the caller is still reading — return the longest window, 900 ms, so a pause between digits doesn't end the turn early.",
        },
        {
          prompt: "What's the difference between the FORCE-FINALIZE timer and the STALL BACKSTOP timer?",
          choices: [
            "They're the same timer with two names.",
            "FORCE-FINALIZE closes the turn using the best partial when partials arrive but no final does; STALL BACKSTOP reprompts (then ends the call) when no usable transcript arrives at all.",
            "FORCE-FINALIZE ends the call; STALL BACKSTOP restarts STT.",
            "FORCE-FINALIZE is for web calls only.",
          ],
          correctIndex: 1,
          explanation:
            "The tight timer salvages a stuck-but-talking turn from its best partial; the loose timer handles genuine silence with a recovery reprompt and, after the budget, a graceful hangup.",
        },
        {
          prompt: "Why does `onPartial` reset `repromptCount` and push the stall timer forward?",
          choices: [
            "To save memory.",
            "Because a partial proves the caller is actively speaking, so the give-up path must only fire on real sustained silence — never on a slow-to-finalize caller.",
            "Because partials are always final.",
            "To make the call end sooner.",
          ],
          correctIndex: 1,
          explanation:
            "Without this, a caller whose STT streams partials but never finalizes would be wrongly treated as silent — reprompts would accumulate and the net would end a live call. A partial means 'not silent', so reset and extend.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Endpointing answers one question: how much silence means the caller's turn is over?",
        "`computeEndpointMs` is adaptive, checking four signals in priority order: digit-collection > partial-transcript cues > short-audio proxy > configured baseline.",
        "Digit-collection keywords in the agent's last line stretch the window to 800–900 ms so callers can read numbers slowly.",
        "Every decision returns a `reason` label, so the turn-latency logs always explain why a given wait was chosen.",
        "`TurnSafetyNet` runs two timers: FORCE-FINALIZE salvages a stuck turn from its best partial; STALL BACKSTOP reprompts then gives up on real silence.",
        "Timings are env-tunable (`FORCE_FINALIZE_MS`, `STALL_BACKSTOP_MS`, `STALL_MAX_REPROMPTS`), and the whole module is shared by both telephony and webcall paths.",
      ],
    },
  ],
};
