/**
 * VoBiz can retry the answer webhook and open a second media WebSocket for the
 * same CallUUID. Two live sessions on one call = two greetings + two TTS
 * senders (chopped / overlapping voice).
 */

export type VobizDuplicateStartReason = "live_session" | "start_in_flight";

export function decideVobizDuplicateStart(opts: {
  callUuid: string | null | undefined;
  hasLiveSession: boolean;
  startInFlight: boolean;
}): { close: false } | { close: true; reason: VobizDuplicateStartReason } {
  if (!opts.callUuid) return { close: false };
  if (opts.hasLiveSession) return { close: true, reason: "live_session" };
  if (opts.startInFlight) return { close: true, reason: "start_in_flight" };
  return { close: false };
}
