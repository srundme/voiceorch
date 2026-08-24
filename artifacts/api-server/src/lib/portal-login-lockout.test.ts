import { describe, expect, it } from "vitest";
import {
  PORTAL_LOGIN_MAX_ATTEMPTS,
  isPortalLoginLocked,
  portalLoginLockedMessage,
  portalWrongPasswordMessage,
} from "./portal-login-lockout-host.js";

describe("portal login lockout helpers", () => {
  it("defaults to 3 attempts", () => {
    expect(PORTAL_LOGIN_MAX_ATTEMPTS).toBe(3);
  });

  it("detects locked state", () => {
    expect(isPortalLoginLocked({ portalLoginLockedAt: null })).toBe(false);
    expect(isPortalLoginLocked({ portalLoginLockedAt: new Date() })).toBe(true);
  });

  it("names the partner in the locked message", () => {
    expect(portalLoginLockedMessage("RS foundation")).toContain("RS foundation");
  });

  it("explains wrong password with attempts remaining", () => {
    expect(portalWrongPasswordMessage(2)).toContain("Wrong password");
    expect(portalWrongPasswordMessage(2)).toContain("2 attempts");
    expect(portalWrongPasswordMessage(1)).toContain("One more failed attempt");
  });
});
