import type { Chapter } from "../types";

export const sileroVad: Chapter = {
  slug: "silero-vad",
  moduleId: "m4",
  number: "5.4",
  title: "Voice Activity Detection with Silero",
  summary:
    "The neural net that decides 'is this speech or silence?' in real time.",
  estMinutes: 14,
  fileRef: "artifacts/api-server/src/orchestration/silero-vad.ts",
  prerequisites: ["audio-ts"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Everything in the orchestration engine depends on one yes/no question asked thousands of times a second: **is the caller speaking right now, or is that just noise?** Get it wrong and the agent either talks over a quiet caller or sits frozen while a noisy café tricks it into thinking someone's talking.",
        "The simplest answer is **energy-based VAD**: measure how loud the audio is and call anything above a threshold 'speech'. It's fast and dependency-free — and it's what most of the codebase falls back to. But loudness ≠ speech. A slammed door, a barking dog, or a TV in the background are all 'loud'. `silero-vad.ts` brings in a smarter judge: a tiny **neural network** trained specifically to tell human speech from everything else. It runs on the CPU in a few milliseconds per window — small enough to use live, accurate enough to trust.",
      ],
    },
    {
      kind: "concept",
      title: "What is ONNX, and why a neural net for VAD?",
      body: [
        "Silero VAD is a trained machine-learning model — a few megabytes of learned weights. To run it in Node without dragging in Python or a giant framework, it's exported to **ONNX** (Open Neural Network Exchange), a portable format for neural nets. The `onnxruntime-node` package loads the `.onnx` file and runs **inference**: feed it audio, get back a probability.",
        "That probability — a single number between 0 and 1 — is 'how confident the model is that this chunk is speech'. Compare it to a threshold (0.5) and you have your yes/no. Because the model was trained on real speech vs. real noise, it shrugs off the door slams and dog barks that fool an energy meter.",
        "One more wrinkle: Silero is a **recurrent** model — it has memory. It carries an LSTM hidden state (the `h` and `c` tensors) from one window to the next, so its judgement of 'is this speech?' is informed by what came just before. That memory is per-call, which shapes how this file is organized.",
      ],
    },
    {
      kind: "analogy",
      title: "Bouncer vs. sound meter",
      body: [
        "Energy-based VAD is a sound meter on the door: anything over X decibels gets in. Loud enough? You're 'speech'. It can't tell a shouting drunk from a singer.",
        "Silero is a trained **bouncer**. It has heard thousands of real voices and thousands of non-voices, so it recognizes the *texture* of human speech, not just its volume. It still works fast — a glance per person — but it lets in the right ones. And if the bouncer calls in sick (the native library fails to load), the venue falls back to the sound meter so the door never closes entirely.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/silero-vad.ts",
      language: "typescript",
      intro:
        "The model is shared process-wide, but its memory is per-call. These constants and the file's own doc spell out the contract.",
      code: `const MODEL_PATH  = join(__dirname, "orchestration", "silero_vad.onnx");
const SAMPLE_RATE = 16000;
const CHUNK_SIZE  = 512;   // samples — optimal window for Silero VAD v5 at 16 kHz (32 ms)`,
      lines: [
        {
          lines: "1",
          label: "MODEL_PATH",
          explanation:
            "Where the 2.3 MB `silero_vad.onnx` file lives. The build step copies it next to the compiled code so `join(__dirname, …)` resolves at runtime inside the bundle.",
        },
        {
          lines: "2",
          label: "SAMPLE_RATE = 16000",
          explanation:
            "Silero expects 16 kHz audio — the same rate the pipeline upsamples phone audio to. (Remember from the audio chapter: phones are 8 kHz, the AI stack wants 16 kHz.)",
        },
        {
          lines: "3",
          label: "CHUNK_SIZE = 512",
          explanation:
            "The model's native window is exactly 512 samples — 32 ms at 16 kHz. Incoming audio rarely arrives in neat 512-sample pieces, so the class buffers and slices to this size before every inference.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/silero-vad.ts",
      language: "typescript",
      intro:
        "Resilience first. The native runtime is loaded with a LAZY dynamic import so a missing system library degrades gracefully instead of crashing the whole server at boot.",
      code: `let _ortPromise: Promise<typeof OrtNS> | null = null;

async function loadOrt(): Promise<typeof OrtNS | null> {
  if (!_ortPromise) {
    _ortPromise = import("onnxruntime-node").catch((err) => {
      _ortPromise = null;
      logger.warn({ err }, "SileroVAD: onnxruntime-node failed to load — falling back to energy-based VAD");
      return null as unknown as typeof OrtNS;
    });
  }
  return _ortPromise;
}`,
      lines: [
        {
          lines: "1",
          label: "_ortPromise cache",
          explanation:
            "A module-level cache of the in-flight (or resolved) import. Once we've started loading the runtime, every caller reuses the same promise — we never import twice.",
        },
        {
          lines: "5",
          label: "await import(\"onnxruntime-node\")",
          explanation:
            "A **dynamic** import, not a top-level `import`. This is the whole point: `onnxruntime-node` is a native module that needs system libs (like `libgomp.so.1`). A static import would crash the process at load time if they're missing — before the HTTP server can even bind its port.",
        },
        {
          lines: "5-9",
          label: ".catch(...) → fall back",
          explanation:
            "If the import fails, log a warning, reset the cache so a later retry is possible, and return `null`. The pipeline reads that as 'Silero unavailable' and uses energy-based VAD instead. The call still works — just with the dumber detector.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "why",
      title: "Why lazy-load a dependency?",
      body: [
        "Native modules are the most fragile part of any deployment — they depend on system libraries that may be absent from a slim Docker image. By importing `onnxruntime-node` lazily and catching the failure, a missing native lib downgrades VAD quality instead of taking the entire server down. **Graceful degradation over hard crash** is a recurring theme across SnapServe's infrastructure code.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/silero-vad.ts",
      language: "typescript",
      intro:
        "The ONNX InferenceSession is expensive to create, so it's built once and shared across every call — lazily, on first use.",
      code: `let _sessionPromise: Promise<OrtNS.InferenceSession | null> | null = null;

async function getSession(): Promise<OrtNS.InferenceSession | null> {
  if (!_sessionPromise) {
    _sessionPromise = (async () => {
      const ort = await loadOrt();
      if (!ort) return null;
      return ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ["cpu"],
        logSeverityLevel: 3, // suppress ONNX verbose/info logs
      });
    })().catch((err) => {
      _sessionPromise = null; // allow retry on next call
      logger.warn({ err }, "SileroVAD: failed to create InferenceSession");
      return null;
    });
  }
  return _sessionPromise;
}`,
      lines: [
        {
          lines: "1",
          label: "_sessionPromise (process-global)",
          explanation:
            "One InferenceSession for the whole process. The model's weights are read-only, so all calls can safely share a single loaded session — no need to pay the 2.3 MB load cost per call.",
        },
        {
          lines: "8-11",
          label: "InferenceSession.create(MODEL_PATH, …)",
          explanation:
            "Load the model and prepare it to run. `executionProviders: [\"cpu\"]` keeps it on the CPU (no GPU needed — it's tiny), and `logSeverityLevel: 3` silences ONNX's chatty info logs.",
        },
        {
          lines: "12-16",
          label: ".catch → null + reset",
          explanation:
            "If session creation fails, log it, null the cache so the next call can retry, and return `null` (→ energy fallback). Same graceful-degradation pattern as `loadOrt`.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Warm it at startup",
      body: [
        "The file also exports `warmSileroVAD()`, which the server calls during bootstrap to trigger `getSession()` early. That way the **first** real call doesn't pay the model-load latency mid-conversation — the session is already hot and ready.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/silero-vad.ts",
      language: "typescript",
      intro:
        "Now the per-call instance. The shared session is global, but each SileroVAD owns its own LSTM memory and its own buffering state.",
      code: `export class SileroVAD {
  private h: Float32Array = new Float32Array(2 * 1 * 64); // LSTM hidden state [2,1,64]
  private c: Float32Array = new Float32Array(2 * 1 * 64); // LSTM cell state   [2,1,64]

  private _isSpeech  = false;
  private _available = false;  // false until first inference succeeds
  private _buf       = new Float32Array(0);  // sub-chunk accumulation buffer
  private _queue: Promise<void> = Promise.resolve(); // sequential inference chain

  constructor(
    private readonly threshold = 0.5,
    private readonly callId?: string | number,
  ) {}`,
      lines: [
        {
          lines: "2-3",
          label: "h and c — the LSTM memory",
          explanation:
            "The recurrent model's hidden and cell states. They start as zeros and get updated after every inference, carrying context forward. Each call needs its own copy — that's why this is per-instance state, not global.",
        },
        {
          lines: "5-6",
          label: "_isSpeech + _available",
          explanation:
            "`_isSpeech` caches the latest verdict so `isSpeech()` can return synchronously. `_available` stays `false` until the first inference succeeds — until then the caller stays on the energy fallback.",
        },
        {
          lines: "7",
          label: "_buf — accumulation buffer",
          explanation:
            "Audio arrives in arbitrary-sized chunks; the model wants exactly 512 samples. `_buf` holds the leftover samples between pushes until a full window is available.",
        },
        {
          lines: "8",
          label: "_queue — sequential inference chain",
          explanation:
            "A promise chain that serializes inferences. Because the LSTM state must be updated in order, windows are run one-after-another, never concurrently — chaining `.then()` onto `_queue` guarantees that.",
        },
        {
          lines: "10-13",
          label: "constructor(threshold, callId)",
          explanation:
            "`threshold` (default 0.5) is the speech-probability cutoff; `callId` is just for log correlation. Notice the inference session isn't passed in — it's fetched from the shared global on demand.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/silero-vad.ts",
      language: "typescript",
      intro:
        "push() is the public entry point: it's called synchronously from the audio frame handler. It converts PCM to floats, accumulates, and queues full windows for inference — returning immediately.",
      code: `  push(pcm16: Buffer): void {
    const count = pcm16.length >> 1; // 2 bytes / sample
    const f32   = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      f32[i] = pcm16.readInt16LE(i * 2) / 32768.0;
    }

    // Append to accumulation buffer
    const merged = new Float32Array(this._buf.length + count);
    merged.set(this._buf);
    merged.set(f32, this._buf.length);
    this._buf = merged;

    // Drain complete 512-sample windows, queue them sequentially
    while (this._buf.length >= CHUNK_SIZE) {
      const chunk = this._buf.slice(0, CHUNK_SIZE);
      this._buf   = this._buf.slice(CHUNK_SIZE);
      this._queue = this._queue.then(() => this._infer(chunk));
    }
  }`,
      lines: [
        {
          lines: "2",
          label: "pcm16.length >> 1",
          explanation:
            "Each sample is 2 bytes (16-bit), so the number of samples is the byte length divided by 2. `>> 1` is a fast bit-shift way to write that (shifting right by 1 halves the number).",
        },
        {
          lines: "3-6",
          label: "Int16 → normalized Float32",
          explanation:
            "Read each 16-bit sample and divide by 32768 to scale it into the −1.0…+1.0 range neural nets expect. The model thinks in floats, not raw integers.",
        },
        {
          lines: "8-12",
          label: "append to _buf",
          explanation:
            "Concatenate the new floats onto whatever was left over. `Float32Array` is fixed-length, so 'appending' means allocating a bigger array and `set`-ing both pieces into it.",
        },
        {
          lines: "14-19",
          label: "drain 512-sample windows",
          explanation:
            "While there's at least a full window buffered, slice off exactly 512 samples, keep the remainder, and chain the inference onto `_queue`. This is fire-and-forget: `push` returns instantly while the actual model run happens asynchronously, in order.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/silero-vad.ts",
      language: "typescript",
      intro:
        "And the inference itself — where the audio meets the neural net. Build the input tensors, run the model, read the probability, and carry the LSTM state forward.",
      code: `  private async _infer(samples: Float32Array): Promise<void> {
    const session = await getSession();
    if (!session) return; // ONNX not available — stay on energy-based fallback

    const ort = await loadOrt();
    if (!ort) return;

    try {
      const inputT = new ort.Tensor("float32", samples, [1, CHUNK_SIZE]);
      const srT    = new ort.Tensor("int64",   BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
      const hT     = new ort.Tensor("float32", this.h, [2, 1, 64]);
      const cT     = new ort.Tensor("float32", this.c, [2, 1, 64]);

      const result = await session.run({ input: inputT, sr: srT, h: hT, c: cT });

      const prob = (result["output"]?.data as Float32Array)?.[0] ?? 0;
      this._isSpeech  = prob >= this.threshold;
      this._available = true;

      // onnxruntime-node returns TypedArrays from .data; copy to detach from session memory
      if (result["hn"]?.data) this.h = Float32Array.from(result["hn"].data as Float32Array);
      if (result["cn"]?.data) this.c = Float32Array.from(result["cn"].data as Float32Array);
    } catch (err) {
      logger.warn({ err, callId: this.callId }, "SileroVAD: inference error");
      this._isSpeech = false;
    }
  }`,
      lines: [
        {
          lines: "2-6",
          label: "fetch session + runtime",
          explanation:
            "Grab the shared session and the runtime. If either is unavailable, bail silently — `_available` stays false and the caller keeps using energy VAD.",
        },
        {
          lines: "9-12",
          label: "build the input tensors",
          explanation:
            "The model's four inputs: the 512 audio samples (`input`), the sample rate as a 64-bit int (`sr`), and the current LSTM states (`h`, `c`). The arrays like `[2, 1, 64]` are the tensor **shapes** the model expects.",
        },
        {
          lines: "14",
          label: "session.run({ input, sr, h, c })",
          explanation:
            "The actual inference. This is the ~2–5 ms CPU step that turns audio into a verdict. It returns a map of named output tensors.",
        },
        {
          lines: "16-18",
          label: "read the probability",
          explanation:
            "Pull the single speech-probability out of `output`, default to 0 if missing, and set `_isSpeech = prob >= threshold`. Mark the detector `_available` now that a real inference has succeeded.",
        },
        {
          lines: "20-22",
          label: "carry the LSTM state forward",
          explanation:
            "The model returns updated states `hn`/`cn`. We copy them (with `Float32Array.from`) into `this.h`/`this.c` so the **next** window's inference has this window's context. The copy detaches them from the session's internal memory, which gets reused on the next run.",
        },
        {
          lines: "23-26",
          label: "catch → conservative false",
          explanation:
            "If anything throws, log it and set `_isSpeech = false`. When unsure, assume silence — better to occasionally miss a word than to hallucinate speech from an error.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Sync read, async compute",
      body: [
        "Notice the split: `push()` and `isSpeech()` are **synchronous** (the audio handler can't await), but the actual model run is **async**, queued in the background. So `isSpeech()` returns the verdict from the *most recently completed* inference — at most one 40 ms chunk stale. That tiny, imperceptible lag is the price of keeping the hot audio path non-blocking. Don't expect `isSpeech()` to reflect the very latest `push()` instantly.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Silero is an optional upgrade to the pipeline's speech detection. Click any box to jump to its chapter.",
      nodes: [
        { id: "audio", label: "upsample8to16", sublabel: "audio.ts → 16 kHz PCM", chapterSlug: "audio-ts" },
        { id: "pipeline", label: "OrchestrationPipeline", sublabel: "feeds frames, reads verdict", chapterSlug: "session-and-pipeline" },
        { id: "silero", label: "SileroVAD", sublabel: "silero-vad.ts — THIS FILE", current: true },
        { id: "onnx", label: "onnxruntime-node", sublabel: "runs silero_vad.onnx" },
        { id: "energy", label: "energy-based VAD", sublabel: "hasSpeechEnergy — fallback", chapterSlug: "audio-ts" },
      ],
      edges: [
        { from: "audio", to: "pipeline", label: "16 kHz PCM" },
        { from: "pipeline", to: "silero", label: "push(pcm16)" },
        { from: "silero", to: "onnx", label: "512-sample window" },
        { from: "onnx", to: "silero", label: "speech probability" },
        { from: "silero", to: "pipeline", label: "isSpeech()" },
        { from: "silero", to: "energy", label: "fallback if unavailable" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why is `onnxruntime-node` loaded with a dynamic `await import(...)` inside a try/catch instead of a normal top-level import?",
          choices: [
            "Dynamic imports are faster.",
            "It's a native module with system-lib dependencies; a failed top-level import would crash the whole server at boot, so lazy-loading lets VAD degrade to the energy fallback instead.",
            "TypeScript forbids importing .onnx files.",
            "To avoid circular imports.",
          ],
          correctIndex: 1,
          explanation:
            "Native modules can fail to load on slim images (missing libgomp, etc.). Catching that failure downgrades to energy-based VAD rather than taking the entire process down before it can serve traffic.",
        },
        {
          prompt: "Why does the InferenceSession live in a process-global (`_sessionPromise`) while `h`/`c` live on each SileroVAD instance?",
          choices: [
            "Random design choice.",
            "The model weights are read-only and shareable, but the LSTM state is per-call memory that must not bleed between callers.",
            "Globals are always faster.",
            "Because instances can't hold arrays.",
          ],
          correctIndex: 1,
          explanation:
            "One loaded model serves everyone (no per-call load cost), but each call has its own conversational context in the recurrent state — so `h`/`c` are instance fields, updated after every inference.",
        },
        {
          prompt: "What does `isSpeech()` actually return?",
          choices: [
            "The result of running the model on the audio passed to the most recent push() call, synchronously.",
            "The verdict from the most recently COMPLETED inference — possibly one ~40 ms chunk behind the latest push.",
            "A promise you must await.",
            "Always the energy-based result.",
          ],
          correctIndex: 1,
          explanation:
            "push() queues async inference and returns immediately; isSpeech() is a synchronous read of the last completed run, lagging at most one chunk — imperceptible, and it keeps the audio path non-blocking.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Silero VAD is a small neural net (shipped as an ONNX file) that distinguishes human speech from noise far better than a loudness threshold.",
        "`onnxruntime-node` is lazy-loaded and the session lazily created — any failure degrades gracefully to energy-based VAD instead of crashing the server.",
        "The InferenceSession is process-global (shared weights); the LSTM `h`/`c` state is per-call instance memory carried forward across windows.",
        "`push()` converts PCM to normalized floats, buffers to exact 512-sample (32 ms) windows, and queues inferences sequentially.",
        "`_infer()` builds the input tensors, runs the model in ~2–5 ms, reads a speech probability, and updates the recurrent state for the next window.",
        "`isSpeech()` is a fast, synchronous read of the latest completed verdict — at most one chunk stale, keeping the hot audio path non-blocking.",
      ],
    },
  ],
};
