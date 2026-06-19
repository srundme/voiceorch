import { describe, it, expect } from "vitest";
import { extractSentences } from "./pipeline.js";

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
