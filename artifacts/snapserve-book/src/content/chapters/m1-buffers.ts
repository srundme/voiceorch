import type { Chapter } from "../types";

export const buffersAndBinary: Chapter = {
  slug: "buffers-and-binary",
  moduleId: "m1",
  number: "1.3",
  title: "Buffers & Binary Data in Node.js",
  summary:
    "Audio, files, network packets — they all arrive as raw bytes. Node's Buffer is how you hold and manipulate those bytes. This is the prerequisite for the entire audio engine.",
  estMinutes: 14,
  fileRef: "artifacts/api-server/src/orchestration/audio.ts",
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Why this chapter exists",
      paragraphs: [
        "You can't understand SnapServe's audio engine without understanding **Buffers**. A phone call is a river of raw bytes, and a Buffer is the bucket Node.js uses to carry them.",
        "Most JavaScript you write deals with strings, numbers, and objects. But the moment you touch the real world — audio from a phone, a PDF upload, bytes off a network socket — you're dealing with **binary data**: raw 1s and 0s with no built-in meaning. That's where Buffer comes in.",
      ],
    },
    {
      kind: "concept",
      title: "Bits, bytes, and what a number really is",
      body: [
        "A **bit** is a single 0 or 1. A **byte** is 8 bits grouped together. One byte can hold 256 different values (0 to 255).",
        "Computers don't store the **idea** of a number — they store a pattern of bits. The byte `01000001` is 65. But that same byte is **also** the letter 'A', **also** part of an audio sample, **also** one pixel's red channel. The bits are identical; the **meaning** comes entirely from how the program decides to interpret them.",
        "This is the single most important idea in low-level programming: **bytes are meaningless until you choose how to read them.** A Buffer is just a row of bytes. The functions you call on it decide whether those bytes are text, or 16-bit audio samples, or something else.",
      ],
    },
    {
      kind: "analogy",
      title: "A Buffer is an egg carton",
      body: [
        "Picture an egg carton with a fixed number of slots, each holding exactly one egg (one byte, value 0–255). The carton itself doesn't know if the eggs are for an omelette or a cake — it just holds them in order.",
        "When you do `Buffer.allocUnsafe(10)` you grab a carton with 10 slots. `buf[0]` is the first slot. `buf.length` is how many slots there are. And crucially, you can ask the carton to *group* slots: 'read slots 0 and 1 together as one 16-bit number.' That grouping is exactly what audio code does all day.",
      ],
    },
    {
      kind: "concept",
      title: "Endianness: which byte comes first",
      body: [
        "A 16-bit number doesn't fit in one byte (which maxes at 255). It needs two bytes. But that raises a question: when you split a number across two slots, which half goes first?",
        "**Little-endian (LE)** puts the *least* significant byte first; **big-endian (BE)** puts the *most* significant byte first. It's like writing the date as day-month vs month-day — same information, different order, and you must agree on the convention or you get garbage.",
        "Audio in SnapServe is **little-endian 16-bit** (you'll see `readInt16LE` and `writeInt16LE` everywhere). The 'LE' is not optional decoration — read with the wrong endianness and a quiet voice turns into static.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/audio.ts",
      language: "typescript",
      intro:
        "Let's read a real function from the audio engine — `decodeMulaw`. Don't worry about what μ-law is yet (that's the next module). Focus only on the **Buffer mechanics**: allocating, looping, and reading/writing bytes.",
      code: `export function decodeMulaw(mulawBytes: Buffer): Buffer {
  const pcm = Buffer.allocUnsafe(mulawBytes.length * 2);
  for (let i = 0; i < mulawBytes.length; i++) {
    const sample = mulawToLinear(mulawBytes[i]!);
    pcm.writeInt16LE(sample, i * 2);
  }
  return pcm;
}`,
      lines: [
        {
          lines: "1",
          label: "function decodeMulaw(mulawBytes: Buffer): Buffer",
          explanation:
            "It takes a `Buffer` in and returns a `Buffer` out. The `: Buffer` annotations are TypeScript stating both are byte containers. This function's whole job is to transform one carton of bytes into another.",
        },
        {
          lines: "2",
          label: "Buffer.allocUnsafe(mulawBytes.length * 2)",
          explanation:
            "Create the output carton, **twice as big** as the input. Why ×2? Each incoming byte is 1 byte of μ-law but becomes a 2-byte (16-bit) sample. `allocUnsafe` skips zeroing the memory first — faster, and safe here because we overwrite every slot immediately.",
        },
        {
          lines: "3",
          label: "for (let i = 0; i < mulawBytes.length; i++)",
          explanation:
            "Walk through the input one byte at a time. `i` is the index of the current input byte.",
        },
        {
          lines: "4",
          label: "mulawToLinear(mulawBytes[i]!)",
          explanation:
            "`mulawBytes[i]` reads the byte at slot `i` (a number 0–255). The `!` is TypeScript's 'trust me, this exists' — we know `i` is in range. `mulawToLinear` does the actual decode math (next module).",
        },
        {
          lines: "5",
          label: "pcm.writeInt16LE(sample, i * 2)",
          explanation:
            "Write the decoded 16-bit `sample` into the output. `Int16` = a 16-bit signed integer, `LE` = little-endian byte order. We write at position `i * 2` because each sample occupies 2 slots, so input byte 0 → output slots 0–1, byte 1 → slots 2–3, and so on.",
        },
        {
          lines: "7",
          label: "return pcm",
          explanation:
            "Hand back the filled output carton — now ready for the next stage of the pipeline.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "allocUnsafe vs alloc",
      body: [
        "`Buffer.alloc(n)` gives you `n` zeroed bytes — safe but slower. `Buffer.allocUnsafe(n)` gives you `n` bytes of *whatever was already in that memory* — faster, but you must overwrite every byte yourself before returning it.",
        "Using `allocUnsafe` and forgetting to fill a slot leaks random old memory into your output. In `decodeMulaw` it's safe because the loop writes every single slot. Use `allocUnsafe` only when you're certain you'll fill it completely.",
      ],
    },
    {
      kind: "concept",
      title: "The cheat sheet you'll reuse all course",
      body: [
        "`buf.length` — how many bytes.",
        "`buf[i]` — read one byte (0–255) at index i.",
        "`buf.readInt16LE(offset)` — read a 16-bit signed number starting at byte `offset`.",
        "`buf.writeInt16LE(value, offset)` — write a 16-bit signed number at byte `offset`.",
        "`Buffer.allocUnsafe(n)` — fast, uninitialized n-byte buffer (you must fill it).",
        "`Buffer.concat([a, b])` — glue buffers together (used to bolt a WAV header onto audio).",
        "A 16-bit sample spans 2 bytes, so sample index `i` lives at byte offset `i * 2`. That `* 2` appears constantly.",
      ],
    },
    {
      kind: "connections",
      title: "Where Buffers flow next",
      intro:
        "Everything that touches real audio in SnapServe is a Buffer transformation. This chapter is the foundation under all of these.",
      nodes: [
        { id: "buffers", label: "Buffers & binary", sublabel: "this chapter", current: true },
        { id: "audio", label: "audio.ts", sublabel: "decode / encode / resample", chapterSlug: "audio-ts" },
        { id: "stt", label: "STT adapters", sublabel: "send audio buffers out", chapterSlug: "adapter-pattern" },
        { id: "tts", label: "TTS adapters", sublabel: "receive audio buffers", chapterSlug: "adapter-pattern" },
      ],
      edges: [
        { from: "buffers", to: "audio", label: "used by" },
        { from: "audio", to: "stt", label: "clean PCM" },
        { from: "audio", to: "tts", label: "encoded audio" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why is the output buffer in `decodeMulaw` allocated at twice the input length?",
          choices: [
            "For safety padding in case of overflow.",
            "Each 1-byte μ-law input expands into a 2-byte (16-bit) sample.",
            "Buffers must always be a power of two.",
            "Half the buffer is reserved for a header.",
          ],
          correctIndex: 1,
          explanation:
            "1 byte in → 2 bytes out per sample, so the output needs `length * 2` bytes.",
        },
        {
          prompt: "What does the `LE` in `writeInt16LE` mean, and why does it matter?",
          choices: [
            "'Low energy' — a compression hint.",
            "'Left edge' — where to start writing.",
            "'Little-endian' — the byte order of the two bytes; reading with the wrong order corrupts the value.",
            "Nothing; it's optional.",
          ],
          correctIndex: 2,
          explanation:
            "LE = little-endian, least-significant byte first. The audio format is little-endian, so reads and writes must match or the audio turns to static.",
        },
        {
          prompt: "A sample at index `i` lives at which byte offset in a 16-bit PCM buffer?",
          choices: ["i", "i * 2", "i + 2", "i / 2"],
          correctIndex: 1,
          explanation:
            "Each 16-bit sample is 2 bytes, so sample `i` starts at byte `i * 2`. That's why `i * 2` shows up all over the audio code.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Bytes have no inherent meaning — your code decides how to interpret them.",
        "A Buffer is Node's container for raw bytes; index it like an array (`buf[i]`).",
        "16-bit values span 2 bytes, so sample index `i` is at byte offset `i * 2`.",
        "Endianness (LE vs BE) is the byte order; SnapServe audio is little-endian (LE).",
        "`allocUnsafe` is fast but uninitialized — only use it when you'll overwrite every byte.",
      ],
    },
  ],
};
