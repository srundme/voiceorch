import { describe, expect, it } from "vitest";
import { extractLeadsApiKey, leadsApiKeyMatches, parseLeadsNotifyEmails } from "./landing-leads-auth.js";

describe("parseLeadsNotifyEmails", () => {
  it("splits two addresses", () => {
    expect(parseLeadsNotifyEmails("a@snapserve.ai, b@example.com")).toEqual([
      "a@snapserve.ai",
      "b@example.com",
    ]);
  });
});

describe("leads API key", () => {
  it("accepts x-api-key and Bearer", () => {
    expect(extractLeadsApiKey({ headers: { "x-api-key": "tok" } })).toBe("tok");
    expect(extractLeadsApiKey({ headers: { authorization: "Bearer tok" } })).toBe("tok");
  });

  it("rejects mismatched keys", () => {
    expect(leadsApiKeyMatches("abc", "abc")).toBe(true);
    expect(leadsApiKeyMatches("abc", "abd")).toBe(false);
    expect(leadsApiKeyMatches("", "abc")).toBe(false);
  });
});
