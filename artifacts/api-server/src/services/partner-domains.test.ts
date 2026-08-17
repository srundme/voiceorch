import { describe, expect, it } from "vitest";
import {
  customDomainDnsGuide,
  normalizeDomain,
  normalizeSlug,
  splitDnsHostZone,
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

  it("splits DNS Host vs zone the way registrars expect", () => {
    expect(splitDnsHostZone("app.gopikrish.in")).toEqual({ host: "app", zone: "gopikrish.in" });
    expect(splitDnsHostZone("gopikrish.in")).toEqual({ host: "@", zone: "gopikrish.in" });
    expect(splitDnsHostZone("login.app.brand.com")).toEqual({ host: "login.app", zone: "brand.com" });
  });

  it("builds copy-paste CNAME + TXT rows for a subdomain", () => {
    const guide = customDomainDnsGuide({
      domain: "app.gopikrish.in",
      cnameTarget: "partners.snapserve.ai",
      verifyToken: "abc123",
    });
    expect(guide.zone).toBe("gopikrish.in");
    expect(guide.isApex).toBe(false);
    expect(guide.records).toEqual([
      {
        type: "CNAME",
        host: "app",
        value: "partners.snapserve.ai",
        required: true,
        purpose: "Sends visitors on this hostname to your branded login",
      },
      {
        type: "TXT",
        host: "_snapserve-verify.app",
        value: "snapserve-verify=abc123",
        required: false,
        purpose: "Optional if the CNAME is already live — used to verify ownership",
      },
    ]);
  });
});
