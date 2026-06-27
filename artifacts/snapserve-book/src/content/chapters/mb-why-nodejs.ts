import type { Chapter } from "../types";

export const whyNodejs: Chapter = {
  slug: "why-nodejs-not-python",
  moduleId: "mb",
  number: "0.6",
  title: "Why Node.js & TypeScript (Not Python)?",
  summary:
    "Python is the AI world's first language — so why does SnapServe run on Node.js + TypeScript? A plain-English answer, no prior experience needed.",
  estMinutes: 13,
  prerequisites: ["what-is-a-voice-agent"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The obvious question",
      paragraphs: [
        "If you've touched any AI or machine-learning code before, you've almost certainly touched Python. Every major AI library — PyTorch, Hugging Face, LangChain — is Python first. So when a new AI project starts up, Python is usually the default answer.",
        "SnapServe runs on **Node.js** (the JavaScript runtime) and **TypeScript** (JavaScript with types). That's an unusual choice for an AI platform, and it deserves an honest explanation — not just 'we like JavaScript'. There are real technical reasons, real trade-offs, and a couple of places where Python genuinely would have been the better call.",
      ],
    },
    {
      kind: "prose",
      heading: "What SnapServe actually does — a lot of waiting",
      paragraphs: [
        "Before we can explain the choice, you need to see what the server actually does during a live call. An agent is on the line. Here is its job, frame by frame:",
        "1. **Wait** for a packet of caller audio to arrive from the telephony provider over a WebSocket.",
        "2. **Send** that audio to Sarvam or Deepgram (the speech-to-text service) over HTTPS and **wait** for the transcript.",
        "3. **Send** the transcript to the LLM over HTTPS and **wait** for streamed tokens to arrive.",
        "4. **Send** each sentence of the reply to Cartesia or ElevenLabs (TTS) and **wait** for audio chunks.",
        "5. **Write** those audio chunks back over the WebSocket to the caller.",
        "6. Repeat, every turn, for the entire call.",
        "The word that appears most often in that list is **wait**. The server is not doing heavy computation — it is juggling dozens of open network connections simultaneously, spending most of its time blocked on external services.",
      ],
    },
    {
      kind: "analogy",
      title: "A switchboard, not a calculator",
      body: [
        "Imagine a telephone switchboard operator in an old film: she plugs and unplugs cables connecting callers to lines, all day long. She's not doing maths — she's managing connections and waiting for something to happen on each one. That is exactly what SnapServe's server is: a high-speed switchboard operator, not a number cruncher.",
        "A CPU-bound task (like training a neural net) is a calculator job — one person doing intensive arithmetic for a long time. A network-bound task (like running live calls) is a switchboard job — one person keeping dozens of lines alive simultaneously. The two jobs need very different tools.",
      ],
    },
    {
      kind: "concept",
      title: "Node.js is built for the switchboard job",
      body: [
        "Node.js runs JavaScript on a single thread with an **event loop** — a loop that constantly checks 'did any of my network connections get new data?' and immediately handles it. While it waits on one connection, it can serve a hundred others. This is called **non-blocking I/O**.",
        "This design was invented specifically for servers that hold many long-lived connections open at once — exactly the pattern a real-time call platform runs. When 50 calls are live simultaneously, Node handles all 50 in the same single thread, context-switching between them in microseconds whenever a new audio packet arrives.",
        "Node.js is not special because it's fast at computation. It's special because it's *efficient* at waiting. Thousands of concurrent connections cost almost nothing in memory or CPU, because none of them are 'sitting' in their own OS thread — they're just entries in an event queue.",
      ],
    },
    {
      kind: "concept",
      title: "Python's honest concurrency problem",
      body: [
        "Python is excellent for computation-heavy tasks. For I/O-heavy servers, it has a genuine architectural constraint: the **Global Interpreter Lock** (GIL). The GIL means only one Python thread can execute at a time — even on a multi-core machine. For CPU work this can be worked around with multiprocessing, but for I/O-heavy servers it adds overhead.",
        "Python does have `asyncio` — an async/await system similar to Node's event loop — but it was added to a language not originally built around it. The ecosystem is split: many popular libraries are blocking (they don't use asyncio), so mixing them requires careful management. In practice, a Python voice-call server tends to need a process-per-worker model (e.g. Gunicorn + multiple workers) to handle concurrent calls, which uses significantly more memory.",
        "Node.js `async/await` is not an add-on — the entire runtime was built around non-blocking I/O from day one. Every standard library function that touches the network is async by default. There is no GIL.",
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Concrete numbers from real deployments",
      body: [
        "A Node.js server handling 50 concurrent calls typically uses around 200–400 MB of RAM. An equivalent Python server using Gunicorn workers usually needs 800 MB–2 GB (each worker is a full Python process). At scale — hundreds of simultaneous calls on a single Railway instance — this difference is significant. SnapServe runs on a single container; keeping memory tight directly reduces hosting cost.",
      ],
    },
    {
      kind: "concept",
      title: "TypeScript: the safety net that pays for itself",
      body: [
        "Node.js runs plain JavaScript, which has no type checking. You can pass a string where a number is expected and the error only surfaces at runtime — possibly during a live call. SnapServe chose **TypeScript**, which adds a type layer on top of JavaScript. Before any code runs, the compiler checks that every function is called with the right shape of data.",
        "For a codebase where one wrong type can corrupt a caller's memory, misroute a billing event, or crash mid-conversation, compile-time checking is not optional — it's the difference between bugs you catch in CI and bugs a real caller experiences. The entire OpenAPI contract (the agreement between frontend and backend) is expressed as TypeScript types and auto-generated from the spec, so a field rename in the spec immediately breaks the build rather than silently breaking the UI at 2 am.",
        "Python's type hints (`mypy`) offer something similar, but they are opt-in and not enforced by the runtime. TypeScript's checks run on every `pnpm run typecheck` — mandatory, not advisory.",
      ],
    },
    {
      kind: "concept",
      title: "The one place Python wins: ML inference",
      body: [
        "There is one part of SnapServe that *is* Python: the **Gender Detection microservice** (`artifacts/gender-service/`). It runs a Facebook wav2vec2 transformer — a real neural network that needs PyTorch, librosa, and ONNX, all Python-native. No JavaScript equivalent exists for this workload.",
        "The solution is a clean split: the Node.js server handles all the real-time call orchestration (the switchboard job), and calls out to the Python microservice only when it needs ML inference (the calculator job). Each language does what it's genuinely best at. The microservice pattern means the GIL and the ML dependency hell are fully isolated in one small container — they can't affect call latency on the main server.",
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "The same pattern most serious voice AI platforms use",
      body: [
        "Twilio, LiveKit, and Daily.co — the big voice infrastructure companies — all run their media servers in Go, Rust, or Node. Python is used inside them for ML models, but never for the real-time media plane itself. SnapServe follows the same architectural instinct: keep the fast, concurrent, low-latency path in a language designed for it; let Python do ML work behind a service boundary.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Node isn't magic — it has its own weaknesses",
      body: [
        "Single-threaded means one bug that blocks the event loop (a heavy synchronous computation, a tight infinite loop) stalls *every* call. SnapServe works around this by running CPU work — audio decoding, noise cancellation, VAD — in a **worker thread pool** (Node.js `worker_threads`). Never put blocking code on the main thread. You'll see this pattern repeatedly when you read the audio pipeline code.",
      ],
    },
    {
      kind: "connections",
      title: "Where these decisions show up in real code",
      intro:
        "The language choice isn't just philosophy — it shapes specific files you'll read.",
      nodes: [
        { id: "ws", label: "WebSocket audio streams", sublabel: "event-loop at work", chapterSlug: "what-is-telephony" },
        { id: "pool", label: "HTTP keep-alive pool", sublabel: "Module 6", chapterSlug: "http-keepalive-pool" },
        { id: "async", label: "async/await patterns", sublabel: "Module 2", chapterSlug: "async-await-promises" },
        { id: "ts", label: "TypeScript types", sublabel: "Module 2", chapterSlug: "typescript-types" },
        { id: "gender", label: "Gender service (Python)", sublabel: "the ML carve-out", chapterSlug: "what-is-a-voice-agent" },
      ],
      edges: [
        { from: "ws", to: "async", label: "async/await handles each frame" },
        { from: "ws", to: "pool", label: "kept-alive HTTP to providers" },
        { from: "ts", to: "pool", label: "types catch bad payloads at compile time" },
        { from: "gender", to: "ws", label: "Python inference, Node orchestration" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What is the primary reason Node.js was chosen over Python for SnapServe's server?",
          choices: [
            "Node.js has better AI libraries.",
            "Node.js is faster at mathematical computation.",
            "Node.js is built for non-blocking I/O — it handles many concurrent waiting connections efficiently in a single thread.",
            "Python does not support WebSockets.",
          ],
          correctIndex: 2,
          explanation:
            "SnapServe spends most of its time waiting on external services (STT, LLM, TTS). Node's event-loop architecture handles thousands of concurrent waiting connections cheaply — the switchboard job it was designed for.",
        },
        {
          prompt: "What is the GIL and why is it relevant here?",
          choices: [
            "A Python security module that blocks unauthorized HTTP calls.",
            "The Global Interpreter Lock — it means only one Python thread executes at a time, which adds overhead in I/O-heavy concurrent servers.",
            "A Node.js garbage-collection mechanism.",
            "A TypeScript compiler flag.",
          ],
          correctIndex: 1,
          explanation:
            "Python's GIL prevents true thread-level parallelism. For I/O-heavy servers with many concurrent connections, it pushes teams toward multi-process models that use more memory.",
        },
        {
          prompt: "Why is there still a Python service in SnapServe?",
          choices: [
            "Python is required by the telephony providers.",
            "The team prefers Python for all services.",
            "ML inference (wav2vec2 gender detection) needs PyTorch and NumPy, which have no JavaScript equivalent — so it runs in an isolated Python microservice.",
            "Node.js cannot call external APIs.",
          ],
          correctIndex: 2,
          explanation:
            "ML inference is a 'calculator job' — CPU-intensive, Python-native library work. It's isolated in a separate microservice so it never touches the real-time call path.",
        },
        {
          prompt: "What does TypeScript add that plain JavaScript doesn't have?",
          choices: [
            "Faster execution speed.",
            "Access to Python libraries.",
            "Compile-time type checking — mismatched types break the build before any code runs.",
            "Automatic database migrations.",
          ],
          correctIndex: 2,
          explanation:
            "TypeScript's type checker catches wrong-shaped data at compile time. In a live call platform, this means data bugs surface in CI rather than mid-conversation for a real caller.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "SnapServe is I/O-bound, not CPU-bound — it spends most of its time waiting on network services, which is exactly what Node.js's event loop was designed for.",
        "Node.js handles hundreds of concurrent calls in a single thread with non-blocking I/O; equivalent Python servers typically need one process per worker, costing 4–5× more memory.",
        "Python's GIL is not a dealbreaker, but it does push Python servers toward heavier multi-process architectures for concurrent I/O.",
        "TypeScript's compile-time type checking catches data bugs before they affect real callers — the entire API contract is expressed as types generated from the OpenAPI spec.",
        "Python still earns its place for ML inference (wav2vec2 gender detection). The architecture isolates it in a microservice — each language does the job it's best at.",
        "Node.js's one real weakness is event-loop blocking; CPU work (audio decoding, VAD) is offloaded to worker threads to keep the main thread free for all concurrent calls.",
      ],
    },
  ],
};
