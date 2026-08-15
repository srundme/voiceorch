import { describe, expect, it } from "vitest";
import {
  normalizeDomain,
  normalizeSlug,
  subdomainHostForSlug,
  validateDomain,
  validateSlug,
} from "./partner-domains-normalize.js";

describe("partner-domains helpers", () => {
  it("normalizes and validates slugs", () => {
    expect(normalizeSlug(" Acme Co ")).toBe("acme-co");
    expect(validateSlug("acme")).toBeNull();
    expect(validateSlug("www")).toBeTruthy();
    expect(validateSlug("a")).toBeTruthy();
    expect(validateSlug("Bad_Slug")).toBeTruthy();
  });

  it("builds subdomain host from root", () => {
    process.env["PARTNER_SUBDOMAIN_ROOT"] = "snapserve.ai";
    expect(subdomainHostForSlug("acme")).toBe("acme.snapserve.ai");
  });

  it("rejects snapserve domains as custom domains", () => {
    process.env["PARTNER_SUBDOMAIN_ROOT"] = "snapserve.ai";
    expect(normalizeDomain("https://App.Acme.com/path")).toBe("app.acme.com");
    expect(validateDomain("app.acme.com")).toBeNull();
    expect(validateDomain("acme.snapserve.ai")).toBeTruthy();
    expect(validateDomain("not a domain")).toBeTruthy();
  });
});
