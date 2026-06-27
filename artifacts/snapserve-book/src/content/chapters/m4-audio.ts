import type { Chapter } from "../types";

export const audioTs: Chapter = {
  slug: "audio-ts",
  moduleId: "m4",
  number: "4.1",
  title: "audio.ts — How a Phone Call Becomes Numbers",
  summary:
    "The lowest layer of the entire voice engine. Every phone call passes through these functions in its first milliseconds. Master this file and you understand how raw sound enters the system.",
  estMinutes: 22,
  fileRef: "artifacts/api-server/src/orchestration/audio.ts",
  prerequisites: ["buffers-and-binary"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "When someone calls your SnapServe agent over the phone, the telephone network does **not** send normal audio. It sends a compressed 8-bit format called **μ-law** (pronounced 'mew-law'). Before our AI can do anything — run speech recognition, detect speech, record the call — we must **decode** μ-law back into normal audio numbers.",
        "`audio.ts` is the lowest layer of the whole voice engine. Every single phone call that hits SnapServe passes through these functions in the first milliseconds. If you understand this file, you understand how raw sound enters the system — and how the AI's reply leaves it.",
      ],
    },
    {
      kind: "concept",
      title: "What is audio, really?",
      body: [
        "A microphone measures air pressure thousands of times per second. Each measurement is a number called a **sample**. Phone audio uses **8,000 samples per second** (8 kHz) — enough for a human voice.",
        "Each sample is normally a **16-bit integer**: a whole number from −32,768 to +32,767. Bigger magnitude = louder; the sign tells you whether the sound wave is pushing or pulling at that instant. A stream of these numbers, played back 8,000 per second, **is** the sound.",
        "But sending 16 bits per sample over old phone lines was expensive, so the telephone industry invented **μ-law**: a clever way to squeeze each sample into just **8 bits** while keeping voices sounding good. The trick: human ears notice changes in quiet sounds more than in loud sounds, so μ-law stores quiet sounds with more precision and loud sounds with less. Our job in this file is to convert between μ-law (8-bit, what the phone sends) and linear PCM (16-bit, what everything else needs).",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/audio.ts",
      language: "typescript",
      intro: "First, two magic constants that the whole codec relies on.",
      code: `const MULAW_BIAS = 33;
const MULAW_MAX = 0x1fff;`,
      lines: [
        {
          lines: "1",
          label: "MULAW_BIAS = 33",
          explanation:
            "μ-law adds a fixed offset of 33 to every sample before compressing. This avoids a math problem near zero (you can't take the logarithm of 0). We subtract this same 33 back out when decoding. Think: 'everyone gets +33 on the way in, so we remove 33 on the way out.'",
        },
        {
          lines: "2",
          label: "MULAW_MAX = 0x1fff",
          explanation:
            "`0x1fff` is hexadecimal for 8191 — the largest value μ-law can represent. The `0x` prefix means base-16. We use it as a ceiling so values never overflow. Engineers write these in hex because the format is defined bit-by-bit and each hex digit maps cleanly to 4 bits.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/audio.ts",
      language: "typescript",
      intro:
        "Now the heart of the file: decoding ONE μ-law byte into a real 16-bit sample. This runs 8,000 times per second per call, so it has to be fast and exact.",
      code: `export function mulawToLinear(mulaw: number): number {
  mulaw = ~mulaw & 0xff;
  const sign = mulaw & 0x80 ? -1 : 1;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0f;
  const sample = ((mantissa << 1) + 33) << (exponent + 1);
  return sign * (sample - MULAW_BIAS);
}`,
      lines: [
        {
          lines: "1",
          label: "export function mulawToLinear(mulaw: number): number",
          explanation:
            "`export` lets other files import this. One number in (a μ-law byte, 0–255), one number out (a 16-bit sample). Both typed as `number`.",
        },
        {
          lines: "2",
          label: "mulaw = ~mulaw & 0xff",
          explanation:
            "μ-law stores its bits **inverted** (every 0 became 1 and vice-versa) for signal reliability on the wire. The `~` operator flips every bit back. `& 0xff` keeps only the lowest 8 bits, because `~` in JavaScript operates on 32-bit numbers and we need to mask it back to one byte. Result: the byte is un-inverted.",
        },
        {
          lines: "3",
          label: "const sign = mulaw & 0x80 ? -1 : 1",
          explanation:
            "The top bit (`0x80` = `10000000`) marks whether the wave is positive or negative right now. `& 0x80` isolates just that bit. Set → `sign` is −1, otherwise +1. We multiply by this at the very end.",
        },
        {
          lines: "4",
          label: "const exponent = (mulaw >> 4) & 0x07",
          explanation:
            "μ-law packs a small 'exponent' (a scale/zoom factor) into bits 4–6. `>> 4` shifts those bits to the bottom, then `& 0x07` keeps just 3 bits (values 0–7). A bigger exponent means a louder part of the range.",
        },
        {
          lines: "5",
          label: "const mantissa = mulaw & 0x0f",
          explanation:
            "The bottom 4 bits (`0x0f` = `00001111`) hold the 'mantissa' — the fine detail within the chosen scale. Exponent + mantissa together describe the magnitude.",
        },
        {
          lines: "6",
          label: "const sample = ((mantissa << 1) + 33) << (exponent + 1)",
          explanation:
            "Reconstruct the magnitude. `mantissa << 1` doubles it (shift left = ×2), add the 33 bias back, then `<< (exponent + 1)` scales up by the exponent. This is the exact reverse of the compression math.",
        },
        {
          lines: "7",
          label: "return sign * (sample - MULAW_BIAS)",
          explanation:
            "Subtract the 33 bias we added during reconstruction, then apply the sign. Out comes the real 16-bit audio sample.",
        },
      ],
    },
    {
      kind: "analogy",
      title: "μ-law is a zip code for sound",
      body: [
        "The **exponent** is the region (rough loudness), the **mantissa** is the street (fine detail within that region), and the **sign** is north or south.",
        "`mulawToLinear` reads the zip code and hands you back the exact address — the precise 16-bit sample the caller's voice produced at that instant.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/audio.ts",
      language: "typescript",
      intro:
        "The reverse direction: turning a 16-bit sample back into a μ-law byte, so the AI's reply can travel down the phone line. Same math, run backwards.",
      code: `export function linearToMulaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  sample = Math.min(sample, 32767);
  sample += MULAW_BIAS;
  if (sample > MULAW_MAX) sample = MULAW_MAX;

  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}`,
      lines: [
        {
          lines: "2-3",
          label: "extract and drop the sign",
          explanation:
            "Remember if the sample was negative (store that as the `0x80` bit), then work with the absolute value. We'll fold the sign back in at the end.",
        },
        {
          lines: "4-6",
          label: "clamp + bias",
          explanation:
            "Cap the magnitude at 32767 (max for 16-bit), add the 33 bias, and cap again at `MULAW_MAX` so the value fits μ-law's range. Clamping prevents overflow garbage on very loud samples.",
        },
        {
          lines: "8-9",
          label: "find the exponent",
          explanation:
            "This tiny loop finds the highest set bit by sliding a mask (`expMask`) downward until it hits a 1. That position IS the exponent — the 'region' of loudness. Bit tricks like this are how codecs stay fast.",
        },
        {
          lines: "11",
          label: "extract the mantissa",
          explanation:
            "Shift down past the exponent's bits and keep 4 bits of fine detail — the 'street' within the region.",
        },
        {
          lines: "12",
          label: "return ~(...) & 0xff",
          explanation:
            "Pack sign + exponent + mantissa into one byte with bitwise OR, then invert all the bits (`~`) because μ-law is stored inverted, and mask to 8 bits. The result is one μ-law byte ready for the phone network.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/audio.ts",
      language: "typescript",
      intro:
        "A phone call isn't one byte — it's a constant flood. These two functions apply the single-sample codec across a whole Buffer at once. (See the Buffers chapter if `allocUnsafe`/`writeInt16LE` look unfamiliar.)",
      code: `export function decodeMulaw(mulawBytes: Buffer): Buffer {
  const pcm = Buffer.allocUnsafe(mulawBytes.length * 2);
  for (let i = 0; i < mulawBytes.length; i++) {
    const sample = mulawToLinear(mulawBytes[i]!);
    pcm.writeInt16LE(sample, i * 2);
  }
  return pcm;
}

export function encodeMulaw(pcmBuffer: Buffer): Buffer {
  const mulaw = Buffer.allocUnsafe(pcmBuffer.length / 2);
  for (let i = 0; i < mulaw.length; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2);
    mulaw[i] = linearToMulaw(sample);
  }
  return mulaw;
}`,
      lines: [
        {
          lines: "1-8",
          label: "decodeMulaw",
          explanation:
            "Incoming direction. Output is **twice** the input size (1 μ-law byte → 2-byte sample). Loop, decode each byte with `mulawToLinear`, write the 16-bit result at offset `i * 2`.",
        },
        {
          lines: "10-17",
          label: "encodeMulaw",
          explanation:
            "Outgoing direction — the mirror image. Output is **half** the input size (2-byte sample → 1 μ-law byte). Read each 16-bit sample with `readInt16LE`, compress with `linearToMulaw`, store one byte.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Decode in, encode out — the bookends of every call",
      body: [
        "`decodeMulaw` is the **first** thing that touches incoming caller audio. `encodeMulaw` is the **last** thing that touches the AI's outgoing audio. Together they bookend the entire conversation loop you saw in Chapter 0.1.",
        "Web calls (the browser 'Live Test') are the exception: browsers send and receive linear PCM directly, so they **skip** μ-law entirely. Only real phone-network calls go through these two functions.",
      ],
    },
    {
      kind: "concept",
      title: "Resampling: 8 kHz phones vs 16 kHz AI",
      body: [
        "Phone audio is 8 kHz, but many speech-recognition APIs want 16 kHz. So `audio.ts` also includes resamplers.",
        "`upsample8to16` doubles the sample count by inserting an averaged sample between each pair (linear interpolation) — going up in rate. `downsample16to8` halves it by averaging adjacent pairs.",
        "The downsampler does one extra clever thing: instead of naively throwing away every other sample (which folds high frequencies back into the audible band as ugly 'aliasing' artifacts), it averages adjacent pairs first — a tiny anti-alias filter that keeps pitch detection accurate, with zero extra dependencies.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/audio.ts",
      language: "typescript",
      intro:
        "The rest of audio.ts is digital signal processing built on the same Buffer mechanics: noise cancellation and pitch detection. Here's the noise gate's core idea — you don't need every line, just the shape.",
      code: `export class NoiseCanceller {
  private noiseFloor      = 0.0;
  private calibFrameCount = 0;

  process(pcm8k: Buffer): Buffer {
    // Stage 1 — bandpass filter (keep 300–3400 Hz, the phone voice band)
    // Stage 2 — adaptive noise gate, in 20 ms frames:
    //   if a frame's energy < noiseFloor × GATE_RATIO  → it's noise → zero it
    //   else                                           → it's speech → keep it
    // The first ~500 ms calibrates the noise floor to the caller's room.
    // ...
  }
}`,
      lines: [
        {
          lines: "1",
          label: "class NoiseCanceller",
          explanation:
            "It's a **class** (not a plain function) because it's **stateful** — it remembers the running noise-floor estimate between chunks. You create one instance per call session.",
        },
        {
          lines: "6",
          label: "Stage 1 — bandpass",
          explanation:
            "Keep only 300–3400 Hz — the band a phone actually carries. This strips out sub-300 Hz mains hum / HVAC rumble and high-frequency hiss before anything else runs.",
        },
        {
          lines: "7-9",
          label: "Stage 2 — adaptive noise gate",
          explanation:
            "Chop the audio into 20 ms frames. If a frame is quieter than the learned background level times a ratio, it's treated as noise and zeroed; otherwise it's speech and passes through untouched.",
        },
        {
          lines: "10",
          label: "calibration phase",
          explanation:
            "For the first ~500 ms the gate just *listens* and learns how loud this caller's background is, so a noisy café and a silent office are both handled correctly. Only after calibrating does it start gating.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Here's where audio.ts sits in the live call pipeline. Click any box to jump to its chapter.",
      nodes: [
        { id: "provider", label: "Telephony provider", sublabel: "Twilio / Plivo", chapterSlug: "telephony-overview" },
        { id: "pipeline", label: "onAudioIn()", sublabel: "pipeline.ts receives chunks", chapterSlug: "session-and-pipeline" },
        { id: "decode", label: "decodeMulaw()", sublabel: "audio.ts — THIS FILE", current: true },
        { id: "noise", label: "NoiseCanceller", sublabel: "audio.ts — THIS FILE", current: true },
        { id: "stt", label: "STT adapter", sublabel: "speech → text", chapterSlug: "adapter-pattern" },
        { id: "tts", label: "TTS adapter", sublabel: "text → speech", chapterSlug: "adapter-pattern" },
        { id: "encode", label: "encodeMulaw()", sublabel: "audio.ts — THIS FILE", current: true },
      ],
      edges: [
        { from: "provider", to: "pipeline", label: "μ-law bytes" },
        { from: "pipeline", to: "decode", label: "raw chunk" },
        { from: "decode", to: "noise", label: "16-bit PCM" },
        { from: "noise", to: "stt", label: "clean PCM" },
        { from: "tts", to: "encode", label: "reply audio" },
        { from: "encode", to: "provider", label: "μ-law back" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does the output buffer in `decodeMulaw` need to be twice the size of the input?",
          choices: [
            "For safety padding.",
            "Each 8-bit μ-law byte expands into a 16-bit (2-byte) sample.",
            "Half is reserved for a WAV header.",
            "Buffers must be even-length.",
          ],
          correctIndex: 1,
          explanation:
            "1 byte in → 2 bytes out per sample, so the output is `length * 2`. (And `encodeMulaw` does the reverse: output is half the input.)",
        },
        {
          prompt: "What does `~mulaw & 0xff` do, and why is it the first step of decoding?",
          choices: [
            "Converts the byte to a string.",
            "μ-law is stored bit-inverted; `~` flips the bits back and `& 0xff` keeps it to one byte.",
            "Doubles the value.",
            "Checks if the number is negative.",
          ],
          correctIndex: 1,
          explanation:
            "μ-law bytes travel inverted for reliability. You must un-invert (`~`) and mask to 8 bits (`& 0xff`) before any of the sign/exponent/mantissa extraction makes sense.",
        },
        {
          prompt: "A web call from the browser — does it pass through `decodeMulaw`? Why or why not?",
          choices: [
            "Yes, all audio is μ-law.",
            "No — browsers send linear PCM directly, so only phone-network calls need μ-law decoding.",
            "Yes, but only the outgoing direction.",
            "No — web calls have no audio.",
          ],
          correctIndex: 1,
          explanation:
            "Only the telephone network uses μ-law. Browsers send/receive linear PCM, so the webcall path skips both decode and encode.",
        },
        {
          prompt: "Why is `NoiseCanceller` a class instead of a plain function?",
          choices: [
            "Classes are faster than functions.",
            "It needs to remember state (the running noise-floor estimate) between audio chunks.",
            "It's required by TypeScript.",
            "So it can be exported.",
          ],
          correctIndex: 1,
          explanation:
            "Noise cancellation is stateful — it carries the calibrated noise floor across chunks within one call. A class holds that per-session state; you create one instance per call.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Phones send 8-bit μ-law; everything else needs 16-bit linear PCM. audio.ts converts both ways.",
        "`mulawToLinear` / `linearToMulaw` convert one sample; `decodeMulaw` / `encodeMulaw` do whole buffers.",
        "Decode is the first touch on incoming audio; encode is the last touch on outgoing — the bookends of a call.",
        "Web calls skip μ-law entirely (browsers use linear PCM).",
        "audio.ts also resamples (8↔16 kHz) and runs DSP (bandpass + adaptive noise gate) — all on the same Buffer mechanics.",
      ],
    },
  ],
};
