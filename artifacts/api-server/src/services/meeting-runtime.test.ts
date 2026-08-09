import { describe, expect, it } from "vitest";
import {
  parseMeetingsConfig,
  resolveMeetBotDisplayName,
} from "./meeting-runtime.js";

describe("meeting-runtime controls", () => {
  it("parses botDisplayName and muteWhenIdle defaults", () => {
    const empty = parseMeetingsConfig({});
    expect(empty.botDisplayName).toBe("");
    expect(empty.muteWhenIdle).toBe(true);

    const custom = parseMeetingsConfig({
      meetings: { botDisplayName: "  Praveen  ", muteWhenIdle: false },
    });
    expect(custom.botDisplayName).toBe("Praveen");
    expect(custom.muteWhenIdle).toBe(false);
  });

  it("resolveMeetBotDisplayName prefers custom name", () => {
    const cfg = parseMeetingsConfig({ meetings: { botDisplayName: "SnapServe Pitch" } });
    expect(resolveMeetBotDisplayName(cfg, "Agent Alpha")).toBe("SnapServe Pitch");
    expect(resolveMeetBotDisplayName(parseMeetingsConfig({}), "Agent Alpha")).toBe("Agent Alpha");
  });
});
