/** Provider-specific override > explicitly configured generic setting > provider default.
 * Do not pass a materialized UI default here: omission must remain omission. */
export function resolveSarvamEndpointingMs(config: Record<string, unknown>): number | null {
  for (const key of ["sarvamEndOfSpeechSilenceMs", "asrEndpointingSilenceMs"]) {
    const value = config[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      // Floor 350 ms — 400 was too aggressive for Indian PSTN mid-sentence pauses.
      return Math.max(350, Math.min(2000, Math.round(value)));
    }
  }
  return null;
}
