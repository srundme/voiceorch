import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesApiError, salesErrorMessages, salesFetch, salesQueryString, salesRequestHeaders } from "./sales-api";

const dispatched: string[] = [];
vi.stubGlobal("window", {
  location: { origin: "http://localhost" },
  dispatchEvent: (e: Event) => {
    dispatched.push(e.type);
    return true;
  },
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  dispatched.length = 0;
  vi.unstubAllGlobals();
  vi.stubGlobal("window", {
    location: { origin: "http://localhost" },
    dispatchEvent: (e: Event) => {
      dispatched.push(e.type);
      return true;
    },
  });
});

describe("salesRequestHeaders", () => {
  it("adds the CSRF header to every non-GET method", () => {
    for (const m of ["POST", "PATCH", "PUT", "DELETE", "post"]) {
      expect(salesRequestHeaders(m, false).get("X-Sales-Request")).toBe("1");
    }
  });

  it("omits the CSRF header for safe methods", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) {
      expect(salesRequestHeaders(m, false).has("X-Sales-Request")).toBe(false);
    }
  });

  it("sets Content-Type only when there is a body", () => {
    expect(salesRequestHeaders("POST", true).get("Content-Type")).toBe("application/json");
    expect(salesRequestHeaders("DELETE", false).has("Content-Type")).toBe(false);
  });

  it("keeps caller-provided headers", () => {
    expect(salesRequestHeaders("GET", false, { Accept: "text/csv" }).get("Accept")).toBe("text/csv");
  });
});

describe("salesQueryString", () => {
  it("drops empty values, encodes true as 1 and skips false", () => {
    expect(salesQueryString({ q: "acme hr", page: 2, demo: true, unassigned: false, city: "", ownerId: undefined, stage: null })).toBe("?q=acme+hr&page=2&demo=1");
  });

  it("returns an empty string when nothing is left", () => {
    expect(salesQueryString({ demo: false })).toBe("");
    expect(salesQueryString()).toBe("");
  });
});

describe("salesFetch", () => {
  it("sends the cookie, JSON body and CSRF header on writes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await salesFetch("/companies", { method: "POST", body: { name: "Acme" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/sales/companies");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe(JSON.stringify({ name: "Acme" }));
    const headers = init.headers as Headers;
    expect(headers.get("X-Sales-Request")).toBe("1");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("defaults to GET without the CSRF header and appends the query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await salesFetch("/companies", { query: { stage: "Qualified", demo: true } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/sales/companies?stage=Qualified&demo=1");
    expect(init.method).toBe("GET");
    expect((init.headers as Headers).has("X-Sales-Request")).toBe(false);
  });

  it("surfaces every server validation message verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { error: "Qualified requires the buyer's need; …", errors: ["Qualified requires the buyer's need", "Qualified requires a decision maker"] })),
    );
    const err = await salesFetch("/opportunities/1/stage", { method: "POST", body: { to: "Qualified" } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SalesApiError);
    expect((err as SalesApiError).status).toBe(400);
    expect(salesErrorMessages(err)).toEqual(["Qualified requires the buyer's need", "Qualified requires a decision maker"]);
  });

  it("flattens zod details and keeps error codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { error: "Active pilot capacity (6) is full", code: "capacity", details: { formErrors: [], fieldErrors: { reason: ["Required"] } } })),
    );
    const err = (await salesFetch("/pilots/1/status", { method: "POST", body: {} }).catch((e: unknown) => e)) as SalesApiError;
    expect(err.body?.code).toBe("capacity");
    expect(err.messages).toEqual(["Active pilot capacity (6) is full", "reason: Required"]);
  });

  it("announces 401s so the app can return to the login screen", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Not signed in" })));
    await expect(salesFetch("/today")).rejects.toBeInstanceOf(SalesApiError);
    expect(dispatched).toEqual(["sales:unauthorized"]);
  });

  it("does not announce 401s from the login call itself", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Invalid email or password" })));
    const err = await salesFetch("/auth/login", { method: "POST", body: {} }).catch((e: unknown) => e);
    expect(salesErrorMessages(err)).toEqual(["Invalid email or password"]);
    expect(dispatched).toEqual([]);
  });

  it("falls back to the HTTP status when the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 502, statusText: "Bad Gateway" })));
    const err = await salesFetch("/today").catch((e: unknown) => e);
    expect(salesErrorMessages(err)).toEqual(["HTTP 502: Bad Gateway"]);
  });
});
