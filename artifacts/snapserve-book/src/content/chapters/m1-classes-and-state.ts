import type { Chapter } from "../types";

export const classesAndState: Chapter = {
  slug: "classes-and-state",
  moduleId: "m1",
  number: "1.5",
  title: "Classes & Holding State",
  summary:
    "When to reach for a class instead of a function, using a real stateful component from the audio engine.",
  estMinutes: 12,
  prerequisites: ["typescript-types"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Most of the functions you've met so far are **stateless**: you give them inputs, they return an output, and they forget everything. `decodeMulaw(bytes)` doesn't care what you decoded a second ago. That's perfect for pure transformations.",
        "But a phone call is a *stream over time*. Some parts of the engine need to **remember** what happened across many tiny audio frames — was a touch-tone key already pressed? how long has this track been silent? You can't answer those with a forgetful function. You need something that holds **state** between calls to it. That something is a **class**.",
        "This chapter uses a real, compact class from SnapServe's orchestration engine — the DTMF (touch-tone) detector — to show exactly when and why you reach for a class instead of a plain function.",
      ],
    },
    {
      kind: "concept",
      title: "What a class actually gives you",
      body: [
        "A **class** is a blueprint for an object that bundles two things: **data** (fields) and **behavior** (methods that act on that data). When you write `new DtmfDetector()`, you create one **instance** — its own private bag of fields that persists for as long as you keep the object around.",
        "The key word is **persists**. A plain function's local variables vanish the moment it returns. A class instance's fields stay alive between method calls. So `detector.feed(chunk)` can remember that the previous two chunks already contained the digit '5' — because that count lives in a field, not a local variable.",
        "Each call gets its **own** instance, so state never leaks between calls. Call A's detector and call B's detector are separate objects with separate fields. That isolation is exactly why classes fit per-call, stateful components so well.",
      ],
    },
    {
      kind: "analogy",
      title: "A function is a calculator; a class is a scoreboard",
      body: [
        "A pocket calculator is a function: punch in `2 + 2`, get `4`, and it forgets. Each calculation stands alone.",
        "A scoreboard is a class. It *remembers* the score across the whole game. Every time a team scores, you call a method (`addPoint`) and the board updates its internal number. The running total only makes sense because the board holds onto it between plays.",
        "The DTMF detector is a scoreboard for tones: it keeps a running tally of how many frames in a row carried the same key, so it can tell a real, deliberate key-press from a half-millisecond blip.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/dtmf.ts",
      language: "typescript",
      intro:
        "Here's the real class declaration and its fields — the 'scoreboard' part. These fields are the state that survives between every `feed()` call.",
      code: `export class DtmfDetector {
  private readonly rowCoeffs = ROW_FREQS.map(makeCoeff);
  private readonly colCoeffs = COL_FREQS.map(makeCoeff);

  private hitFrames  = 0;
  private lastDigit: string | null = null;
  private gapFrames  = 0;`,
      lines: [
        {
          lines: "1",
          label: "export class DtmfDetector",
          explanation:
            "Declares (and exports) the blueprint. Other code creates an instance with `new DtmfDetector()` — one per call that needs to listen for touch-tones.",
        },
        {
          lines: "2-3",
          label: "private readonly rowCoeffs / colCoeffs",
          explanation:
            "Precomputed math constants for the tone-detection algorithm. `private` means only code inside the class can touch them; `readonly` means they're set once and never reassigned — computed up front so `feed()` stays fast.",
        },
        {
          lines: "5",
          label: "private hitFrames = 0",
          explanation:
            "The core piece of state: how many consecutive frames have carried the current tone. A function couldn't keep this between calls — a field can. It starts at 0 for each new instance.",
        },
        {
          lines: "6",
          label: "private lastDigit: string | null = null",
          explanation:
            "Remembers the last digit already reported, so the same held-down key isn't counted twice. The `string | null` union (from the types chapter) says 'a digit, or nothing yet.'",
        },
        {
          lines: "7",
          label: "private gapFrames = 0",
          explanation:
            "Counts frames of silence since the last tone — used to enforce a gap before accepting the same key again. Three fields together form this detector's memory.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Why `private` matters",
      body: [
        "Every field here is `private`. That's not bureaucracy — it's protection. Outside code can call `feed()` and `reset()`, but it can't reach in and scramble `hitFrames` mid-count.",
        "This is **encapsulation**: the class owns its state and exposes only a small, safe surface. You can trust that `hitFrames` only changes through the class's own logic, which makes the whole thing far easier to reason about.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/dtmf.ts",
      language: "typescript",
      intro:
        "The `feed()` method is the 'behavior' part — it's called once per 20 ms audio frame and reads and updates the fields each time. This is where holding state across a call pays off.",
      code: `  feed(pcm8k: Buffer): string | null {
    if (pcm8k.length < BLOCK_SAMPLES * 2) return null;

    // … run the Goertzel tone detection on this frame …

    // Both tones must exceed threshold
    if (rowPow < POWER_THRESH || colPow < POWER_THRESH || digit === null) {
      this.hitFrames = 0;
      // Count inter-digit gap frames
      if (this.gapFrames < GAP_FRAMES) this.gapFrames++;
      return null;
    }

    this.hitFrames++;

    if (this.hitFrames >= MIN_HIT_FRAMES) {
      // Same digit still held — do not re-report until key released and gap elapsed
      if (digit === this.lastDigit && this.gapFrames < GAP_FRAMES) return null;

      this.lastDigit = digit;
      this.gapFrames = 0;
      return digit;
    }

    return null;
  }`,
      lines: [
        {
          lines: "1",
          label: "feed(pcm8k: Buffer): string | null",
          explanation:
            "A **method** — a function that belongs to the class. It takes one audio frame and returns either a detected digit (`string`) or `null` if nothing fired. It's called many times per second during a call.",
        },
        {
          lines: "7-12",
          label: "this.hitFrames = 0 on a miss",
          explanation:
            "`this` refers to *this particular instance*. When no valid tone is present, the run is broken, so `hitFrames` resets to 0 and the silence counter ticks up. The state remembers there's currently no key held.",
        },
        {
          lines: "14",
          label: "this.hitFrames++",
          explanation:
            "A valid tone this frame — increment the running count. Because the field persists between calls, this `++` accumulates across consecutive frames. A plain local variable would reset to 0 every call and never get here.",
        },
        {
          lines: "16-22",
          label: "the debounce decision",
          explanation:
            "Only once the tone has persisted for `MIN_HIT_FRAMES` (≈40 ms) is it accepted — and only if it isn't the same key still being held. This 'don't count one press twice' logic is *only possible* because `lastDigit` and `gapFrames` survive between frames.",
        },
        {
          lines: "19-20",
          label: "update the memory, then report",
          explanation:
            "When a fresh digit is accepted, record it as `lastDigit` and zero the gap counter, then return the digit. The next `feed()` call will read these updated fields — state flowing forward through the call.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/dtmf.ts",
      language: "typescript",
      intro:
        "A second method, `reset()`, deliberately clears the state — useful between conversational turns. It shows that a class controls *when* its memory is wiped.",
      code: `  reset(): void {
    this.hitFrames = 0;
    this.lastDigit = null;
    this.gapFrames = GAP_FRAMES; // allow first detection immediately
  }`,
      lines: [
        {
          lines: "1",
          label: "reset(): void",
          explanation:
            "Returns `void` (nothing) — it exists purely for its side effect: scrubbing the detector's memory back to a clean slate.",
        },
        {
          lines: "2-3",
          label: "clear the counters",
          explanation:
            "Zero `hitFrames` and forget `lastDigit`, so the next tone starts a fresh count. The instance lives on; only its state is reset.",
        },
        {
          lines: "4",
          label: "gapFrames = GAP_FRAMES",
          explanation:
            "A neat touch: pre-fill the gap counter so the very first key after a reset is accepted immediately instead of waiting out a gap. The comment explains the intent — small details like this are why the logic lives in a class it can fully control.",
        },
      ],
    },
    {
      kind: "concept",
      title: "When to reach for a class (and when not to)",
      body: [
        "Use a **function** when the work is a pure transformation: same input, same output, no memory needed. `decodeMulaw`, `encodeStereoPcmWav`, a math helper — these are rightly plain functions.",
        "Reach for a **class** when you need to **hold state over time** and bundle the methods that manage it. The DTMF detector qualifies because the answer to 'is this a real key-press?' depends on the recent past. So does the `RecordingBuffer`, which accumulates caller and agent audio chunks across an entire call before encoding a WAV at the end.",
        "A good test: if you find yourself passing the same 'so far' values into a function over and over and getting updated ones back, that's state begging to live inside a class instance.",
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Other stateful classes you'll meet",
      body: [
        "The audio engine is full of these. `RecordingBuffer` holds two growing arrays of audio chunks (caller + agent) plus a shared timeline anchor, all accumulated frame-by-frame until `finalize()` writes the recording.",
        "Spotting the pattern is the skill: a constructor that sets up empty fields, methods that nudge those fields with each new bit of data, and a final method that produces a result from everything gathered. Once you see it once, you'll see it everywhere in the orchestration layer.",
      ],
    },
    {
      kind: "connections",
      title: "Where stateful classes live in the engine",
      intro:
        "Per-call state objects are the backbone of the real-time audio engine. This chapter's detector is one small, clear example of the pattern.",
      nodes: [
        { id: "classes", label: "Classes & state", sublabel: "this chapter (DtmfDetector)", current: true },
        { id: "types", label: "TypeScript types", sublabel: "fields are typed", chapterSlug: "typescript-types" },
        { id: "audio", label: "audio.ts", sublabel: "stateless transforms", chapterSlug: "audio-ts" },
        { id: "session", label: "Session & pipeline", sublabel: "one state object per call", chapterSlug: "session-and-pipeline" },
        { id: "endpoint", label: "Endpointing", sublabel: "tracks turn state", chapterSlug: "endpointing" },
      ],
      edges: [
        { from: "types", to: "classes", label: "typed fields" },
        { from: "classes", to: "session", label: "held per call" },
        { from: "audio", to: "classes", label: "feeds frames" },
        { from: "classes", to: "endpoint", label: "same pattern" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why is `DtmfDetector` a class instead of a plain function?",
          choices: [
            "Classes are always faster than functions.",
            "It must remember state (frame counts, last digit) across many calls to `feed()` during one phone call.",
            "Functions can't take a Buffer argument.",
            "TypeScript requires classes for audio code.",
          ],
          correctIndex: 1,
          explanation:
            "Detecting a real key-press depends on the recent past. Fields like `hitFrames` and `lastDigit` persist between `feed()` calls — a plain function's locals would reset every time.",
        },
        {
          prompt: "What does `this.hitFrames++` rely on that a local variable couldn't provide?",
          choices: [
            "Faster arithmetic.",
            "The field persists on the instance between method calls, so the count accumulates across frames.",
            "Access to the database.",
            "A global variable shared by all calls.",
          ],
          correctIndex: 1,
          explanation:
            "`this.hitFrames` is instance state that survives between `feed()` calls, so the increment builds up across consecutive frames. A local would re-initialise to 0 each call.",
        },
        {
          prompt: "Why are the detector's fields marked `private`?",
          choices: [
            "To make them run faster.",
            "Encapsulation — outside code can't scramble the internal state; it must go through `feed()` / `reset()`.",
            "Because TypeScript forbids public fields.",
            "So they can be shared between all calls.",
          ],
          correctIndex: 1,
          explanation:
            "`private` enforces encapsulation: the class owns its state and exposes only safe methods, so you can trust the fields only change through the class's own logic.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "A class bundles data (fields) with behavior (methods); `new` creates an instance with its own persistent fields.",
        "Use a class when you must hold state over time; use a plain function for pure, forgetful transformations.",
        "Instance fields survive between method calls — that's why `hitFrames` can accumulate across audio frames.",
        "`this` refers to the specific instance, so each call gets isolated state with no leakage between calls.",
        "`private` fields enforce encapsulation: state changes only through the class's own methods.",
        "The same pattern (constructor sets fields → methods update them → a final method produces a result) recurs all over the audio engine, e.g. `RecordingBuffer`.",
      ],
    },
  ],
};
