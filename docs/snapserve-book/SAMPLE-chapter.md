# 📘 SAMPLE CHAPTER — what a real module looks like

> This is a **sample** to show you the teaching format before I build the full
> course. In the web app, everything below renders as an interactive page:
> a chapter sidebar on the left, the lesson in the middle, and **code panels
> with syntax highlighting** that reveal the file *piece by piece* as the
> student scrolls. Nothing here is a mockup — every line of code shown is the
> real SnapServe source.

---

## How each lesson is structured (the repeating pattern)

Every file in the course is taught with the **same 5-part rhythm**, so interns
build a habit:

1. **🎯 What & Why** — what this file does and why it exists in SnapServe
2. **🧠 Concept** — the Node.js / CS concept you need *before* reading the code
3. **🔬 Code, part by part** — the file is sliced into small chunks. Each chunk
   is shown in a highlighted panel, then explained **line by line**
4. **🔗 How it connects** — which other files call this, and what it feeds into
5. **✅ Check yourself** — 2–3 quick questions (the web app makes these clickable)

In the **web app**, part 3 looks like a split screen: the code chunk on one
side highlighted, the explanation scrolling next to it. Clicking a line number
jumps the explanation to that line. Here in markdown I show them stacked.

---

# Chapter 4.1 — `audio.ts`: How a phone call becomes numbers a computer can understand

**File:** `artifacts/api-server/src/orchestration/audio.ts`
**Module:** 4 — The Orchestration Engine
**Prerequisites:** Chapter 1.3 (Buffers & binary data in Node.js)

---

## 🎯 What & Why

When someone calls your SnapServe agent over the phone, the telephone network
does **not** send normal audio. It sends a compressed 8-bit format called
**μ-law** (pronounced "mew-law"). Before our AI can do anything — run speech
recognition, detect speech, record the call — we must **decode** μ-law back
into normal audio numbers.

`audio.ts` is the lowest layer of the whole voice engine. Every single phone
call that hits SnapServe passes through these functions in the first
milliseconds. If you understand this file, you understand how raw sound enters
the system.

---

## 🧠 Concept: What is audio, really?

A microphone measures air pressure thousands of times per second. Each
measurement is a number called a **sample**. Phone audio uses:

- **8,000 samples per second** (8 kHz) — enough for a human voice
- Each sample is normally a **16-bit integer** (a whole number from −32,768 to
  +32,767). Bigger number = louder.

But sending 16 bits per sample over old phone lines was expensive, so the
telephone industry invented **μ-law**: a clever way to squeeze each sample into
just **8 bits** while keeping voices sounding good. The trick is that human ears
notice changes in quiet sounds more than in loud sounds, so μ-law stores quiet
sounds with more precision and loud sounds with less.

Our job in this file: turn each 8-bit μ-law byte **back** into a 16-bit number.

---

## 🔬 Code, part by part

### Chunk 1 — the two magic constants

```typescript
const MULAW_BIAS = 33;
const MULAW_MAX = 0x1fff;
```

**Line by line:**

- **`MULAW_BIAS = 33`** — μ-law adds a fixed offset of 33 to every sample before
  compressing it. This avoids a mathematical problem when the sample is near
  zero (you can't take the logarithm of 0). We must subtract this same 33 back
  out when decoding. Think of it as "everyone gets +33 on the way in, so we
  remove 33 on the way out."
- **`MULAW_MAX = 0x1fff`** — this is hexadecimal for `8191`. It's the largest
  value μ-law can represent. The `0x` prefix means "this number is written in
  base-16." We'll use it later as a ceiling so values never overflow.

> 💡 **Why hex?** Audio engineers write these in hex because the format is
> defined bit-by-bit, and hex maps cleanly to bits (each hex digit = 4 bits).

---

### Chunk 2 — decoding one μ-law byte

```typescript
export function mulawToLinear(mulaw: number): number {
  mulaw = ~mulaw & 0xff;
  const sign = mulaw & 0x80 ? -1 : 1;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0f;
  const sample = ((mantissa << 1) + 33) << (exponent + 1);
  return sign * (sample - MULAW_BIAS);
}
```

This is the heart of the file. It takes **one** μ-law byte (a number 0–255) and
returns the real 16-bit audio sample. Let's go line by line.

- **`export function mulawToLinear(mulaw: number): number {`**
  `export` means other files can import and use this function. It takes one
  number in, gives one number back. The `: number` parts are TypeScript telling
  us the input and output are both numbers.

- **`mulaw = ~mulaw & 0xff;`**
  μ-law stores its bits **inverted** (every 0 became 1 and vice-versa) — this is
  part of the standard, done to improve signal reliability on the wire. The `~`
  operator flips every bit back. The `& 0xff` then keeps only the lowest 8 bits
  (because `~` in JavaScript works on 32-bit numbers, so we mask it back down to
  one byte). **Result: we've un-inverted the byte.**

- **`const sign = mulaw & 0x80 ? -1 : 1;`**
  The top bit (`0x80` = `10000000` in binary) tells us if the sound wave is
  positive or negative at this instant. `& 0x80` isolates just that bit. If it's
  set, `sign` becomes `-1`, otherwise `1`. We'll multiply by this at the end.

- **`const exponent = (mulaw >> 4) & 0x07;`**
  μ-law packs a small "exponent" (a scale/zoom factor) into bits 4–6. `>> 4`
  shifts those bits down to the bottom, then `& 0x07` keeps only 3 bits (values
  0–7). A bigger exponent means a louder part of the range.

- **`const mantissa = mulaw & 0x0f;`**
  The bottom 4 bits (`0x0f` = `00001111`) hold the "mantissa" — the fine detail
  within the chosen scale. Together, exponent + mantissa = the magnitude.

- **`const sample = ((mantissa << 1) + 33) << (exponent + 1);`**
  This reconstructs the magnitude. `mantissa << 1` doubles it (shift left = ×2),
  we add the 33 bias back, then `<< (exponent + 1)` scales it up by the
  exponent. This is the reverse of the compression math.

- **`return sign * (sample - MULAW_BIAS);`**
  Subtract the 33 bias we added, then apply the sign (+ or −). **Out comes the
  real 16-bit audio sample.**

> 🔍 **Mental model:** μ-law is like a zip code for sound. The exponent is the
> *region* (rough loudness), the mantissa is the *street* (fine detail), and the
> sign is *north or south*. This function reads the zip code and gives you back
> the exact address.

---

### Chunk 3 — decoding a whole stream of audio

```typescript
export function decodeMulaw(mulawBytes: Buffer): Buffer {
  const pcm = Buffer.allocUnsafe(mulawBytes.length * 2);
  for (let i = 0; i < mulawBytes.length; i++) {
    const sample = mulawToLinear(mulawBytes[i]!);
    pcm.writeInt16LE(sample, i * 2);
  }
  return pcm;
}
```

A phone call isn't one byte — it's a constant flood of them. This function
decodes a whole **Buffer** (a chunk of raw bytes) at once.

- **`export function decodeMulaw(mulawBytes: Buffer): Buffer {`**
  Takes a `Buffer` of μ-law bytes (what arrives from the phone network), returns
  a `Buffer` of decoded audio. A `Buffer` is Node.js's container for raw binary
  data — covered in Chapter 1.3.

- **`const pcm = Buffer.allocUnsafe(mulawBytes.length * 2);`**
  We create an output buffer **twice as big** as the input. Why ×2? Each 1-byte
  μ-law sample becomes a 2-byte (16-bit) sample. `allocUnsafe` is a faster way to
  reserve memory that skips zeroing it out first — safe here because we
  immediately overwrite every byte.

- **`for (let i = 0; i < mulawBytes.length; i++) {`**
  Loop over every incoming byte, one at a time.

- **`const sample = mulawToLinear(mulawBytes[i]!);`**
  Decode this byte using the function from Chunk 2. The `!` tells TypeScript
  "trust me, this byte exists" (we know `i` is in range).

- **`pcm.writeInt16LE(sample, i * 2);`**
  Write the decoded 16-bit sample into the output. `Int16` = 16-bit integer,
  `LE` = "little-endian" (the byte order this audio format uses). We write at
  position `i * 2` because each sample takes 2 bytes.

- **`return pcm;`**
  Hand back the fully decoded audio, ready for the next stage.

---

## 🔗 How it connects

This is where the lesson zooms out so interns see the **big picture**:

```
📞 Phone network (Twilio / Plivo)
        │  sends μ-law bytes
        ▼
  onAudioIn(mulawChunk)         ← pipeline.ts, line ~989
        │  calls
        ▼
  decodeMulaw(mulawChunk)       ← THIS FILE  ✅
        │  returns 16-bit PCM
        ▼
  NoiseCanceller.process()      ← also in audio.ts (Chapter 4.2)
        │
        ▼
  Speech-to-Text adapter        ← Module 5
```

> In the **web app**, that diagram is clickable — clicking `pipeline.ts` jumps
> the student straight to the chapter that teaches it.

We *just used this exact code path* in the noise-cancellation fix: the webcall
audio skips `decodeMulaw` (browser sends PCM directly, not μ-law) but phone
calls always go through it. That's the kind of real connection interns will see.

---

## ✅ Check yourself

In the web app these are clickable multiple-choice; reveal-on-click answers.

1. **Why does the output buffer in `decodeMulaw` need to be twice the size of
   the input?**
   *(Answer: each 8-bit μ-law byte expands into a 16-bit / 2-byte sample.)*

2. **What does `~mulaw & 0xff` do, and why is it the first step?**
   *(Answer: μ-law is stored bit-inverted; `~` flips the bits back and `& 0xff`
   keeps it to one byte.)*

3. **A webcall from the browser — does it pass through `decodeMulaw`? Why or
   why not?**
   *(Answer: No. Browsers send linear PCM directly, so only phone-network calls
   need μ-law decoding.)*

---

### 📍 Next chapter: `4.2 — NoiseCanceller` (the noise gate we just fixed)
