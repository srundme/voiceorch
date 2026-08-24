import { describe, expect, it } from "vitest";
import {
  assertSafeWebhookUrlShape,
  isBlockedWebhookHostname,
  isPrivateIp,
} from "./ssrf.js";

describe("isPrivateIp", () => {
  it("blocks loopback, RFC1918, link-local, CGNAT", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.0.0.5")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("100.64.0.1")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("0.0.0.0")).toBe(true);
  });

  it("allows public v4", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
  });
});

describe("isBlockedWebhookHostname", () => {
  it("blocks localhost and metadata hosts", () => {
    expect(isBlockedWebhookHostname("localhost")).toBe(true);
    expect(isBlockedWebhookHostname("metadata.google.internal")).toBe(true);
    expect(isBlockedWebhookHostname("foo.internal")).toBe(true);
    expect(isBlockedWebhookHostname("127.0.0.1")).toBe(true);
  });

  it("allows public hostnames", () => {
    expect(isBlockedWebhookHostname("hooks.zapier.com")).toBe(false);
    expect(isBlockedWebhookHostname("n8n.example.com")).toBe(false);
  });
});

describe("assertSafeWebhookUrlShape", () => {
  it("rejects file/javascript and credentialed URLs", () => {
    expect(() => assertSafeWebhookUrlShape("file:///etc/passwd")).toThrow(/http/i);
    expect(() => assertSafeWebhookUrlShape("https://user:pass@evil.com")).toThrow(/credentials/i);
    expect(() => assertSafeWebhookUrlShape("https://localhost/x")).toThrow(/not allowed/i);
  });

  it("accepts https webhook hosts", () => {
    expect(assertSafeWebhookUrlShape("https://hooks.zapier.com/hooks/catch/1").hostname).toBe("hooks.zapier.com");
  });
});
