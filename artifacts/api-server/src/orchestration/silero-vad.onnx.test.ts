import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { SileroVAD, resolveSileroModelPath } from "./silero-vad.js";

describe("SileroVAD onnx feeds", () => {
  it("runs a 512-sample window against the bundled model (state/sr layout)", async () => {
    const model = resolveSileroModelPath();
    expect(existsSync(model)).toBe(true);
    const vad = new SileroVAD(0.5, "onnx-smoke");
    const pcm = Buffer.alloc(512 * 2);
    vad.push(pcm);
    await vad.flush();
    expect(vad.isAvailable()).toBe(true);
    expect(vad.lastProbability()).toBeGreaterThanOrEqual(0);
    expect(vad.lastProbability()).toBeLessThan(0.5);
    vad.destroy();
  });
});
