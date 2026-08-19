/**
 * Voice Memory match bars. Kept separate from the DB store so unit tests
 * can explain near-miss copy without loading Postgres.
 */

/** Hard match for cross-number same-person (stricter). */
export const VOICE_MATCH_THRESHOLD = Number(process.env["VOICE_MEMORY_MATCH_THRESHOLD"] ?? 0.82);
/** Soft mid-call handoff alert (more sensitive). */
export const VOICE_HANDOFF_THRESHOLD = Number(process.env["VOICE_MEMORY_HANDOFF_THRESHOLD"] ?? 0.72);
/**
 * Soft floor for NAME-CORROBORATED cross-number linking. 8kHz telephony audio
 * through a 16kHz-trained embedder drags same-person cross-device scores far
 * below the hard bar (observed 0.42-0.46 for a confirmed same speaker).
 */
export const VOICE_SOFT_MATCH_THRESHOLD = Number(process.env["VOICE_MEMORY_SOFT_MATCH_THRESHOLD"] ?? 0.40);
/**
 * Solo-candidate link: only one other person in the voiceprint base.
 * Telephony same-person scores sit ~0.42–0.46. The old 0.55 bar missed that
 * band on 2-phone tests (calls 11067/11068).
 */
export const VOICE_SOLO_LINK_THRESHOLD = Number(process.env["VOICE_MEMORY_SOLO_LINK_THRESHOLD"] ?? 0.42);
/** Minimum distinct impostor identities before AS-norm is trusted. */
export const VOICE_ASNORM_MIN_COHORT = Number(process.env["VOICE_MEMORY_ASNORM_MIN_COHORT"] ?? 8);
/** Normalized-score acceptance bar, in std-dev units above the impostor mean. */
export const VOICE_ASNORM_THRESHOLD = Number(process.env["VOICE_MEMORY_ASNORM_THRESHOLD"] ?? 4.0);

export interface VoiceNearMiss {
  score: number;
  phoneNumber: string;
  personKey: string;
  margin: number | null;
  normScore: number | null;
  asnormAccept: boolean;
}

/** Human-readable why a near-miss did not link — call-log / dashboard copy. */
export function explainVoiceNearMiss(nearMiss: VoiceNearMiss): string {
  const score = nearMiss.score.toFixed(2);
  const parts = [
    `best ${nearMiss.phoneNumber} scored ${score}`,
    `hard ≥${VOICE_MATCH_THRESHOLD.toFixed(2)}`,
    nearMiss.margin == null
      ? `solo ≥${VOICE_SOLO_LINK_THRESHOLD.toFixed(2)}`
      : `solo n/a (another person at ${(nearMiss.score - nearMiss.margin).toFixed(2)})`,
    `name+voice ≥${VOICE_SOFT_MATCH_THRESHOLD.toFixed(2)}`,
  ];
  if (nearMiss.normScore == null) {
    parts.push(`AS-norm n/a (need ${VOICE_ASNORM_MIN_COHORT} other voices)`);
  } else {
    parts.push(`AS-norm ${nearMiss.normScore.toFixed(1)}σ (need ${VOICE_ASNORM_THRESHOLD.toFixed(1)}σ)`);
  }
  return parts.join("; ");
}
