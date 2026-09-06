import { describe, expect, it } from "vitest";
import { isMetaTokenExpiredError } from "./meta.js";

describe("isMetaTokenExpiredError", () => {
  it("matches Graph session/token expiry wording", () => {
    expect(isMetaTokenExpiredError("Session has expired")).toBe(true);
    expect(isMetaTokenExpiredError("Error validating access token")).toBe(true);
    expect(isMetaTokenExpiredError("OAuthException: token expired")).toBe(true);
    expect(isMetaTokenExpiredError("HTTP 400 error 190")).toBe(true);
  });

  it("ignores unrelated send failures", () => {
    expect(isMetaTokenExpiredError("Template name does not exist")).toBe(false);
    expect(isMetaTokenExpiredError("(#131026) Message undeliverable")).toBe(false);
  });
});
