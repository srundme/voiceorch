/** Product agent type: voice-only. */

export type AgentKind = "voice" | "vision";
export type VisionCaptureMode = "photo" | "live" | "both";

export function resolveAgentKind(cfg?: Record<string, unknown> | null): AgentKind {
  return "voice";
}

export function resolveVisionCaptureMode(cfg?: Record<string, unknown> | null): VisionCaptureMode {
  return "photo";
}

export function visionFlagsForCaptureMode(mode: VisionCaptureMode): {
  visionEnabled: boolean;
  visionLiveEnabled: boolean;
} {
  return { visionEnabled: false, visionLiveEnabled: false };
}
