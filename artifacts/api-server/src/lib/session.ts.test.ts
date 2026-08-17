import { describe, expect, it } from "vitest";
import { parseCookieHeader, SESSION_COOKIE_NAME } from "./session-cookie.js";
import { extractRequestToken } from "./session.js";
import type { Request } from "express";

function fakeReq(opts: {
  authorization?: string;
  cookie?: string;
  tokenQuery?: string;
  cookies?: Record<string, string>;
}): Request {
  return {
    headers: {
      ...(opts.authorization ? { authorization: opts.authorization } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    query: opts.tokenQuery ? { token: opts.tokenQuery } : {},
    cookies: opts.cookies,
  } as unknown as Request;
}

describe("parseCookieHeader", () => {
  it("reads the named cookie", () => {
    expect(parseCookieHeader("a=1; vo_session=abc.def.ghi; b=2", SESSION_COOKIE_NAME)).toBe("abc.def.ghi");
  });

  it("returns null when missing", () => {
    expect(parseCookieHeader("a=1", SESSION_COOKIE_NAME)).toBeNull();
    expect(parseCookieHeader(undefined, SESSION_COOKIE_NAME)).toBeNull();
  });
});

describe("extractRequestToken", () => {
  it("prefers Authorization Bearer over the session cookie", () => {
    const token = extractRequestToken(fakeReq({
      authorization: "Bearer header-jwt",
      cookies: { [SESSION_COOKIE_NAME]: "cookie-jwt" },
    }));
    expect(token).toBe("header-jwt");
  });

  it("reads the HttpOnly session cookie", () => {
    const token = extractRequestToken(fakeReq({
      cookies: { [SESSION_COOKIE_NAME]: "cookie-jwt" },
    }));
    expect(token).toBe("cookie-jwt");
  });

  it("falls back to the Cookie header when cookie-parser is absent (WS upgrade)", () => {
    const token = extractRequestToken(fakeReq({
      cookie: `${SESSION_COOKIE_NAME}=ws-jwt`,
    }));
    expect(token).toBe("ws-jwt");
  });

  it("still accepts ?token= for EventSource / export URLs", () => {
    const token = extractRequestToken(fakeReq({ tokenQuery: "query-jwt" }));
    expect(token).toBe("query-jwt");
  });
});
