import { describe, it, expect } from "vitest";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { extractSentences, tryEarlyPhraseDispatch } = await import("./pipeline.js");

// Regression test for the Tamil/Indic "duplicated opening clause" bug on the
// telephony (pipeline.ts) path. The pipeline clause-split regex was missing the
// Indic Unicode range (\u0900-\u0D7F) that webcall.ts already had, so Tamil
// mid-sentence boundaries never split during streaming. The end-of-stream flush
// then re-enqueued an already-spoken opening clause, e.g. "வணக்கம். வணக்கம். நான்…".
//
// This drives extractSentences exactly the way pipeline.ts's stream loop +
// end-of-stream flush do (see onToken / final flush), at multiple LLM token
// granularities, and asserts the concatenation of enqueued sentences equals the
// full reply with no duplicated head.

// Mirror of pipeline.ts streaming + flush, using the REAL extractSentences.
function simulatePipelineEnqueue(fullReply: string, tokSize: number): string[] {
  const enqueued: string[] = [];
  let pendingText = "";
  for (let i = 0; i < fullReply.length; i += tokSize) {
    pendingText += fullReply.slice(i, i + tokSize);
    const { sentences, remainder } = extractSentences(pendingText);
    for (const s of sentences) enqueued.push(s);
    pendingText = remainder;
  }
  // End-of-stream flush (verbatim shape of pipeline.ts final flush).
  const cleanResponse = fullReply.trim();
  const { remainder: trueRemainder } = extractSentences(cleanResponse);
  const flushText =
    trueRemainder.trim().length > pendingText.trim().length ? trueRemainder : pendingText;
  if (flushText.trim()) enqueued.push(flushText);
  return enqueued;
}

const norm = (s: string) => s.normalize("NFC").replace(/[\s\p{P}]/gu, "").toLowerCase();
const TOKEN_GRANULARITIES = [1, 3, 8, 9999];

describe("extractSentences (pipeline.ts) — enqueued text equals full reply", () => {
  const cases: Record<string, string> = {
    "Tamil 2-sentence, no terminal punctuation (the duplicated-head repro)":
      "வணக்கம். நான் உங்களுக்கு எப்படி உதவ முடியும்",
    "Tamil 3-sentence ending in period":
      "வணக்கம் நண்பரே. நான் உங்களுக்கு உதவ இங்கே இருக்கிறேன். இன்று நான் எப்படி உதவலாம்.",
    "Tamil 2-sentence ending in question":
      "உங்கள் பெயர் என்ன. இன்று உங்களுக்கு என்ன உதவி வேண்டும்?",
    "Tamil danda-separated": "வணக்கம் நண்பரே। நான் உதவுகிறேன்। நன்றி।",
    "English multi-sentence ending short word": "Sure, I can help. Yes.",
    "English short": "ok",
  };

  for (const [name, full] of Object.entries(cases)) {
    for (const tok of TOKEN_GRANULARITIES) {
      it(`${name} [token=${tok}] enqueues full text, no duplicated head`, () => {
        const enqueued = simulatePipelineEnqueue(full, tok);
        const concat = enqueued.join(" ");
        // No clause is enqueued twice (catches the duplicated-head regression).
        expect(new Set(enqueued).size).toBe(enqueued.length);
        // Concatenation of enqueued sentences equals the full reply (no tail drop).
        expect(norm(concat)).toBe(norm(full));
      });
    }
  }
});

describe("tryEarlyPhraseDispatch — streaming TTS starts before .!?", () => {
  it("dispatches at comma once minChars is met", () => {
    const r = tryEarlyPhraseDispatch("Hello Gopi, I'm Aisha from ILCC", 15);
    expect(r?.clause).toBe("Hello Gopi");
    expect(r?.rest).toMatch(/^I'm Aisha/);
  });

  it("does not word-split without a comma or semicolon", () => {
    const text = "Sure I can help you with that appointment";
    expect(tryEarlyPhraseDispatch(text, 15)).toBeNull();
  });

  it("does not dispatch very short buffers", () => {
    expect(tryEarlyPhraseDispatch("Sure I can", 15)).toBeNull();
  });

  it("does not comma-split a short Tamil clause (call 14345 choppy TTS)", () => {
    const text = "புரியுது, இப்போ உங்களுக்கு time இல்ல. அப்புறமா ஒரு callback schedule பண்ணட்டுமா";
    expect(tryEarlyPhraseDispatch(text, 8)).toBeNull();
  });

  it("does not comma-split either/or questions (call 20094 underrun)", () => {
    const en = tryEarlyPhraseDispatch(
      "Are you already running a travel business, or are you looking to start a new one?",
      15,
    );
    expect(en).toBeNull();
    const hi = tryEarlyPhraseDispatch(
      "क्या आप बी टू बी, बी टू सी या फिर कोई और पोर्टल बनवाना चाहते हैं?",
      8,
    );
    expect(hi).toBeNull();
  });

  it("does not comma-split AM/PM slot lists (call 14390 choppy TTS)", () => {
    const text =
      "நாளைக்கு August 28 காலைல 9:00 AM, 9:15 AM, 9:30 AM, 9:45 AM அல்லது 10:00 AM-ல உங்களுக்கு எந்த time சரி வரும்?";
    expect(tryEarlyPhraseDispatch(text, 8)).toBeNull();
  });
});

describe("extractSentences — ellipsis is a breath, not a clip (call 14276)", () => {
  it("keeps a Tamil trailing ... attached until the real sentence ends", () => {
    const pending = "அதுக்கு முன்னாடி... உங்களுக்கு எந்த timezone-ல இருந்து call பண்ணா வசதியா இருக்கும்னு சொல்ல முடியுமா?";
    const { sentences, remainder } = extractSentences(pending);
    expect(sentences.join(" ")).toContain("அதுக்கு முன்னாடி");
    expect(sentences.some((s) => s === "அதுக்கு முன்னாடி...")).toBe(false);
    expect(norm(sentences.join(" ") + remainder)).toBe(norm(pending));
  });

  it("does not flush Time confirm பண்ணிக்கலாமா... as its own TTS job", () => {
    const pending = "Time confirm பண்ணிக்கலாமா... நீங்க India timezone-ல தான இருக்கீங்க?";
    const { sentences } = extractSentences(pending);
    expect(sentences.some((s) => /^Time confirm/.test(s) && s.endsWith("..."))).toBe(false);
  });
});

describe("extractSentences — early dispatch during simulated stream", () => {
  it("enqueues first clause at comma before period arrives", () => {
    const full = "I can help you schedule that appointment, just tell me your preferred time.";
    let pending = "";
    const enqueued: string[] = [];
    const chunk = "I can help you schedule that appointment, just tell";
    pending += chunk;
    const { sentences, remainder } = extractSentences(pending, 15);
    enqueued.push(...sentences);
    pending = remainder;
    expect(enqueued.length).toBeGreaterThan(0);
    expect(full.startsWith(enqueued.join(" "))).toBe(true);
    expect(pending.length).toBeGreaterThan(0);
  });
});
