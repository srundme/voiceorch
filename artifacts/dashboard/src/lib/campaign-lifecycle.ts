/**
 * Shared helpers for campaign Pause / Resume / Stop / Activate on list surfaces.
 * Detail page (`campaigns/[id].tsx`) already has the same lifecycle via PATCH status.
 */

export const CONTINUOUS_LEAD_SOURCES = new Set(["webhook", "meta_ads", "crm"]);

export type CampaignLifecycleStatus = "active" | "paused" | "stopped" | "draft";

export function canPauseCampaign(status: string): boolean {
  return status === "active" || status === "listening";
}

export function canResumeCampaign(status: string): boolean {
  return status === "paused";
}

export function canActivateCampaign(status: string): boolean {
  return status === "stopped";
}

export function canStopCampaign(status: string): boolean {
  return status === "active" || status === "paused" || status === "listening";
}
