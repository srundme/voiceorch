import { describe, expect, it } from "vitest";
import {
  resolveAgentKind,
  resolveVisionCaptureMode,
  visionFlagsForCaptureMode,
} from "./agent-kind";

describe("resolveAgentKind", () => {
  it("prefers explicit agentKind", () => {
    expect(resolveAgentKind({ agentKind: "voice", visionEnabled: true })).toBe("voice");
    expect(resolveAgentKind({ agentKind: "vision" })).toBe("vision");
  });

  it("backfills from vision flags when agentKind missing", () => {
    expect(resolveAgentKind({ visionEnabled: true })).toBe("vision");
    expect(resolveAgentKind({ visionLiveEnabled: true })).toBe("vision");
    expect(resolveAgentKind({})).toBe("voice");
    expect(resolveAgentKind(null)).toBe("voice");
  });
});

describe("vision capture mode", () => {
  it("maps flags to mode", () => {
    expect(resolveVisionCaptureMode({ visionEnabled: true, visionLiveEnabled: false })).toBe("photo");
    expect(resolveVisionCaptureMode({ visionEnabled: true, visionLiveEnabled: true })).toBe("both");
    expect(resolveVisionCaptureMode({ visionEnabled: false, visionLiveEnabled: true })).toBe("live");
  });

  it("maps mode to flags", () => {
    expect(visionFlagsForCaptureMode("photo")).toEqual({ visionEnabled: true, visionLiveEnabled: false });
    expect(visionFlagsForCaptureMode("live")).toEqual({ visionEnabled: false, visionLiveEnabled: true });
    expect(visionFlagsForCaptureMode("both")).toEqual({ visionEnabled: true, visionLiveEnabled: true });
  });
});
