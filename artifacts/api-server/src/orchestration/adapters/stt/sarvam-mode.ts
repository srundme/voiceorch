/**
 * Sarvam saaras:v3 STT mode resolution.
 *
 * `codemix` is used for ALL languages including en-IN. Callers from across
 * India speak Tamil, Hindi, Telugu, English, or any mix — the multilingual
 * toggle defaults to en-IN but the caller's actual language is unpredictable.
 * `transcribe` mode force-fits non-English audio into English phonemes,
 * producing garbled output (Hindi → Bengali script, dropped words).
 * `codemix` handles all Indian languages + English mixing natively on saaras:v3
 * and works well for pure English too.
 */

export type SarvamSttMode = "transcribe" | "codemix" | "verbatim" | "translit";

const VALID_MODES = new Set<string>(["transcribe", "codemix", "verbatim", "translit"]);

export function resolveSarvamSttMode(
  languageCode: string | null | undefined,
  explicitMode?: string | null,
): SarvamSttMode {
  if (explicitMode && VALID_MODES.has(explicitMode)) {
    return explicitMode as SarvamSttMode;
  }
  const lang = (languageCode ?? "en-IN").toLowerCase();
  // Indic languages (ta-IN, hi-IN, te-IN etc) use `transcribe` mode (matching Bolna)
  // to yield clean native script transcripts (e.g. ஃபீச்சர்ஸ் for "features")
  // without phonetic English mangling (Futures-ல). en-IN / multilingual uses codemix.
  if (lang.startsWith("ta") || lang.startsWith("hi") || lang.startsWith("te") || lang.startsWith("kn") || lang.startsWith("ml") || lang.startsWith("mr") || lang.startsWith("bn") || lang.startsWith("gu")) {
    return "transcribe";
  }
  return "codemix";
}
