/** Product agent type: voice-only vs voice + vision. */

export type AgentKind = "voice" | "vision";

/** How a vision agent captures visuals. */
export type VisionCaptureMode = "photo" | "live" | "both";

export function resolveAgentKind(cfg: {
  agentKind?: string | null;
  visionEnabled?: boolean | null;
  visionLiveEnabled?: boolean | null;
} | null | undefined): AgentKind {
  if (cfg?.agentKind === "vision" || cfg?.agentKind === "voice") return cfg.agentKind;
  // Backfill: older agents with vision flags but no agentKind.
  if (cfg?.visionEnabled || cfg?.visionLiveEnabled) return "vision";
  return "voice";
}

export function resolveVisionCaptureMode(cfg: {
  visionEnabled?: boolean | null;
  visionLiveEnabled?: boolean | null;
} | null | undefined): VisionCaptureMode {
  const photo = !!cfg?.visionEnabled;
  const live = !!cfg?.visionLiveEnabled;
  if (live && photo) return "both";
  if (live) return "live";
  return "photo";
}

export function visionFlagsForCaptureMode(mode: VisionCaptureMode): {
  visionEnabled: boolean;
  visionLiveEnabled: boolean;
} {
  switch (mode) {
    case "live":
      // Live stream only — stills/WhatsApp analyze_image off unless "both".
      return { visionEnabled: false, visionLiveEnabled: true };
    case "both":
      return { visionEnabled: true, visionLiveEnabled: true };
    case "photo":
    default:
      return { visionEnabled: true, visionLiveEnabled: false };
  }
}
