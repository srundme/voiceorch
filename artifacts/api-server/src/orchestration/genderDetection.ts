/**
 * Gender detection orchestrator.
 *
 * Routes the detection request to the configured provider.  In practice every
 * provider path currently falls through to the VoiceOrch built-in pitch
 * analyser because none of the mainstream STT vendors expose a stable cold-call
 * gender classification endpoint that works without pre-enrolled speaker
 * profiles.  The provider field is stored so the routing can be upgraded
 * transparently when those APIs mature.
 *
 * Built-in algorithm (all paths):
 *   Autocorrelation pitch estimation on 8 kHz LINEAR16 PCM.
 *   Male:   F0 < 165 Hz
 *   Female: F0 > 180 Hz
 *   Unknown: F0 in overlap zone or insufficient periodicity
 */

import { detectGenderFromPcm, type VoiceGender } from "./audio.js";
import { pcmToWav } from "./audio.js";
import { logger } from "../lib/logger.js";

export interface GenderDetectionConfig {
  provider: string;
  maleSalutation: string;
  femaleSalutation: string;
  neutralSalutation: string;
  providerKeys: Map<string, string>;
  callId: number;
}

/**
 * Analyse the caller audio and return the appropriate salutation string.
 * Never throws — falls back to the neutral salutation on any failure.
 */
export async function detectCallerGender(
  pcm8k: Buffer,
  cfg: GenderDetectionConfig
): Promise<string> {
  let gender: VoiceGender = "unknown";

  try {
    switch (cfg.provider) {
      case "deepgram":
        gender = await detectWithDeepgram(pcm8k, cfg);
        break;
      case "assemblyai":
        gender = await detectWithAssemblyAI(pcm8k, cfg);
        break;
      case "azure":
        gender = await detectWithAzure(pcm8k, cfg);
        break;
      default:
        gender = detectGenderFromPcm(pcm8k);
    }
  } catch (err) {
    logger.warn(
      { callId: cfg.callId, provider: cfg.provider, err },
      "Gender detection failed — falling back to built-in pitch analysis"
    );
    gender = detectGenderFromPcm(pcm8k);
  }

  logger.info(
    { callId: cfg.callId, provider: cfg.provider, gender },
    "Caller gender classified"
  );

  if (gender === "male")   return cfg.maleSalutation   || "sir";
  if (gender === "female") return cfg.femaleSalutation || "ma'am";
  return cfg.neutralSalutation ?? "";
}

// ── Provider implementations ──────────────────────────────────────────────────

/**
 * Deepgram: submit the audio clip to their pre-recorded transcription API.
 * Deepgram's standard response does not include a speaker-gender field in
 * non-enterprise tiers, so we run the built-in pitch analyser on the same
 * audio as a reliable fallback.
 */
async function detectWithDeepgram(
  pcm8k: Buffer,
  cfg: GenderDetectionConfig
): Promise<VoiceGender> {
  const key = cfg.providerKeys.get("deepgram");
  if (!key) {
    logger.debug({ callId: cfg.callId }, "No Deepgram key — using built-in pitch analysis");
    return detectGenderFromPcm(pcm8k);
  }

  const wav = pcmToWav(pcm8k, 8000);
  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&smart_format=true",
    {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "audio/wav" },
      body: wav,
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!res.ok) {
    logger.warn({ callId: cfg.callId, status: res.status }, "Deepgram gender request failed");
    return detectGenderFromPcm(pcm8k);
  }

  // Deepgram doesn't expose a speaker_gender field in standard responses.
  // Use built-in pitch analysis on the audio we already have.
  return detectGenderFromPcm(pcm8k);
}

/**
 * AssemblyAI: their standard API provides speaker diarization but not direct
 * gender classification.  Built-in pitch analysis is used on the captured audio.
 */
async function detectWithAssemblyAI(
  pcm8k: Buffer,
  cfg: GenderDetectionConfig
): Promise<VoiceGender> {
  logger.debug(
    { callId: cfg.callId },
    "AssemblyAI gender: running built-in pitch analysis on captured audio"
  );
  return detectGenderFromPcm(pcm8k);
}

/**
 * Azure Speaker Recognition requires pre-enrolled voice profiles and is not
 * suitable for cold-call gender classification.  Built-in pitch analysis is
 * used instead.
 */
async function detectWithAzure(
  pcm8k: Buffer,
  cfg: GenderDetectionConfig
): Promise<VoiceGender> {
  logger.debug(
    { callId: cfg.callId },
    "Azure gender: running built-in pitch analysis on captured audio"
  );
  return detectGenderFromPcm(pcm8k);
}
