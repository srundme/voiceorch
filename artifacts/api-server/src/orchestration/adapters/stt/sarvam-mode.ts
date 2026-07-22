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
  // Always use codemix — callers are from all over India and may speak any
  // language regardless of the configured language_code. codemix on saaras:v3
  // handles pure English, pure Hindi/Tamil, and mixed-language speech correctly.
  return "codemix";
}
