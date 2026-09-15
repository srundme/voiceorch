import { describe, expect, it } from "vitest";
import { resolveSarvamEndpointingMs } from "./endpointing-settings.js";
describe("Sarvam endpointing ownership", () => {
  it("preserves omission so the provider/env default can apply", () => {
    expect(resolveSarvamEndpointingMs({})).toBeNull();
  });
  it("honors an explicit generic UI setting", () => {
    expect(resolveSarvamEndpointingMs({ asrEndpointingSilenceMs: 500 })).toBe(500);
  });
  it("prefers the provider override over the generic UI setting", () => {
    expect(resolveSarvamEndpointingMs({ asrEndpointingSilenceMs: 300, sarvamEndOfSpeechSilenceMs: 900 })).toBe(900);
  });
  it("ignores invalid overrides and clamps to the adapter range", () => {
    expect(resolveSarvamEndpointingMs({ sarvamEndOfSpeechSilenceMs: NaN, asrEndpointingSilenceMs: 300 })).toBe(400);
    expect(resolveSarvamEndpointingMs({ asrEndpointingSilenceMs: 50 })).toBe(400);
    expect(resolveSarvamEndpointingMs({ asrEndpointingSilenceMs: 9000 })).toBe(2000);
  });
});
