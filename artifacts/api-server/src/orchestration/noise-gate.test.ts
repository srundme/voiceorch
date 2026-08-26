import { describe, expect, it } from "vitest";
import { envForceVobizSoftwareNc, resolveSoftwareNoiseGate } from "./noise-gate.js";

describe("resolveSoftwareNoiseGate — agent toggle off wins everywhere", () => {
  it("never enables the gate when the agent toggle is off", () => {
    for (const provider of ["vobiz", "twilio", "plivo", "webcall", null, undefined]) {
      expect(resolveSoftwareNoiseGate({ telephonyProvider: provider, agentEnabled: false })).toEqual({
        enabled: false,
        reason: "agent-toggle-off",
      });
    }
  });

  it("is not re-enabled by an override when the toggle is off", () => {
    expect(
      resolveSoftwareNoiseGate({
        telephonyProvider: "vobiz",
        agentEnabled: false,
        agentOverride: true,
        envForceVobiz: true,
      }),
    ).toEqual({ enabled: false, reason: "agent-toggle-off" });
  });
});

describe("resolveSoftwareNoiseGate — VoBiz default is still carrier bypass", () => {
  it("bypasses the software gate on VoBiz with no override (unchanged behaviour)", () => {
    expect(resolveSoftwareNoiseGate({ telephonyProvider: "vobiz", agentEnabled: true })).toEqual({
      enabled: false,
      reason: "vobiz-carrier",
    });
  });

  it("honours the per-agent override ahead of the carrier bypass", () => {
    expect(
      resolveSoftwareNoiseGate({ telephonyProvider: "vobiz", agentEnabled: true, agentOverride: true }),
    ).toEqual({ enabled: true, reason: "agent-override" });
  });

  it("honours the fleet-wide env override", () => {
    expect(
      resolveSoftwareNoiseGate({ telephonyProvider: "vobiz", agentEnabled: true, envForceVobiz: true }),
    ).toEqual({ enabled: true, reason: "env-override" });
  });

  it("prefers the per-agent override over the env override in the reason", () => {
    expect(
      resolveSoftwareNoiseGate({
        telephonyProvider: "vobiz",
        agentEnabled: true,
        agentOverride: true,
        envForceVobiz: true,
      }),
    ).toEqual({ enabled: true, reason: "agent-override" });
  });

  it("treats non-true override values as unset (no accidental opt-in from stale JSON)", () => {
    for (const override of ["true", 1, {}, [], null, undefined, false]) {
      expect(
        resolveSoftwareNoiseGate({ telephonyProvider: "vobiz", agentEnabled: true, agentOverride: override }),
      ).toEqual({ enabled: false, reason: "vobiz-carrier" });
    }
  });

  it("matches the provider case-insensitively", () => {
    expect(resolveSoftwareNoiseGate({ telephonyProvider: "VoBiz", agentEnabled: true })).toEqual({
      enabled: false,
      reason: "vobiz-carrier",
    });
  });
});

describe("resolveSoftwareNoiseGate — other transports", () => {
  it("bypasses the gate on webcall (browser already ran AEC/NS)", () => {
    expect(resolveSoftwareNoiseGate({ telephonyProvider: "webcall", agentEnabled: true })).toEqual({
      enabled: false,
      reason: "browser-aec",
    });
  });

  it("ignores the VoBiz overrides on webcall", () => {
    expect(
      resolveSoftwareNoiseGate({
        telephonyProvider: "webcall",
        agentEnabled: true,
        agentOverride: true,
        envForceVobiz: true,
      }),
    ).toEqual({ enabled: false, reason: "browser-aec" });
  });

  it("runs the gate on carriers that do no cleanup", () => {
    for (const provider of ["twilio", "plivo"]) {
      expect(resolveSoftwareNoiseGate({ telephonyProvider: provider, agentEnabled: true })).toEqual({
        enabled: true,
        reason: "software-gate",
      });
    }
  });

  it("runs the gate when the provider is unknown (fail toward denoising)", () => {
    expect(resolveSoftwareNoiseGate({ telephonyProvider: null, agentEnabled: true })).toEqual({
      enabled: true,
      reason: "software-gate",
    });
  });
});

describe("envForceVobizSoftwareNc", () => {
  it("only accepts the exact string \"1\"", () => {
    expect(envForceVobizSoftwareNc({ VOBIZ_FORCE_SOFTWARE_NC: "1" })).toBe(true);
    expect(envForceVobizSoftwareNc({ VOBIZ_FORCE_SOFTWARE_NC: "true" })).toBe(false);
    expect(envForceVobizSoftwareNc({ VOBIZ_FORCE_SOFTWARE_NC: "0" })).toBe(false);
    expect(envForceVobizSoftwareNc({})).toBe(false);
  });
});
