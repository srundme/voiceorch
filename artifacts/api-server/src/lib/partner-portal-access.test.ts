import { describe, expect, it } from "vitest";
import {
  isDirectSnapServeHost,
  managedClientSnapServeDeniedMessage,
  partnerHostCandidates,
} from "./partner-portal-access.js";

describe("partnerHostCandidates", () => {
  it("prefers forwarded host over client body host", () => {
    const req = {
      headers: { "x-forwarded-host": "app.gopikrish.in" },
      hostname: "internal.railway.app",
    } as Parameters<typeof partnerHostCandidates>[0];

    expect(partnerHostCandidates(req, "app.snapserve.ai")).toEqual([
      "app.gopikrish.in",
      "internal.railway.app",
      "app.snapserve.ai",
    ]);
  });

  it("dedupes normalized hosts", () => {
    const req = {
      headers: { "x-forwarded-host": "APP.GOPIKRISH.IN" },
      hostname: "app.gopikrish.in",
    } as Parameters<typeof partnerHostCandidates>[0];

    expect(partnerHostCandidates(req, "app.gopikrish.in")).toEqual(["app.gopikrish.in"]);
  });
});

describe("isDirectSnapServeHost", () => {
  it("recognizes main SnapServe hosts", () => {
    expect(isDirectSnapServeHost("app.snapserve.ai")).toBe(true);
    expect(isDirectSnapServeHost("app.gopikrish.in")).toBe(false);
  });
});

describe("managedClientSnapServeDeniedMessage", () => {
  it("includes partner login URL", () => {
    expect(
      managedClientSnapServeDeniedMessage("Staymante Solutions", "https://app.gopikrish.in"),
    ).toContain("https://app.gopikrish.in/sign-in");
  });
});
