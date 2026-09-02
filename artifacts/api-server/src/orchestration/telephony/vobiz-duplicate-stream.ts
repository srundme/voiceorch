/**
 * VoBiz can retry the answer webhook and open a second media WebSocket.
 * Two live sessions on one dial = two greetings + two TTS senders
 * (chopped / overlapping voice). CallUUID alone is not enough: two answer
 * webhooks often mint two CallUUIDs for the same campaign lead (07:41:12).
 */

export type VobizDuplicateStartReason =
  | "live_session"
  | "start_in_flight"
  | "live_leg"
  | "leg_in_flight";

export function vobizDuplicateLegKey(opts: {
  campaignLeadId?: number | null;
  corrToken?: string | null;
}): string | null {
  if (opts.campaignLeadId != null && Number.isFinite(opts.campaignLeadId)) {
    return `lead:${opts.campaignLeadId}`;
  }
  const corr = opts.corrToken?.trim();
  if (corr) return `corr:${corr}`;
  return null;
}

export function decideVobizDuplicateStart(opts: {
  callUuid: string | null | undefined;
  hasLiveSession: boolean;
  startInFlight: boolean;
  legKey?: string | null;
  hasLiveLeg?: boolean;
  legStartInFlight?: boolean;
}): { close: false } | { close: true; reason: VobizDuplicateStartReason } {
  if (opts.legKey) {
    if (opts.hasLiveLeg) return { close: true, reason: "live_leg" };
    if (opts.legStartInFlight) return { close: true, reason: "leg_in_flight" };
  }
  if (!opts.callUuid) return { close: false };
  if (opts.hasLiveSession) return { close: true, reason: "live_session" };
  if (opts.startInFlight) return { close: true, reason: "start_in_flight" };
  return { close: false };
}
