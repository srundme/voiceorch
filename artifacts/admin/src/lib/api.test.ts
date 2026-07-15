import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Browser global stubs — adminFetch runs in a Vite/browser context.
// In the Vitest node environment we stub browser primitives manually.
// ---------------------------------------------------------------------------

const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => localStorageStore[k] ?? null,
  removeItem: (k: string) => { delete localStorageStore[k]; },
  setItem: (k: string, v: string) => { localStorageStore[k] = v; },
  clear: () => { Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]); },
};
vi.stubGlobal("localStorage", localStorageMock);

const windowMock = { location: { href: "" } };
vi.stubGlobal("window", windowMock);

// import.meta.env.BASE_URL defaults to "/" in Vitest
vi.stubGlobal("import", { meta: { env: { BASE_URL: "/" } } });

// ---------------------------------------------------------------------------
// Import the module under test AFTER stubs are in place.
// ---------------------------------------------------------------------------
import { adminFetch, formatAdminError, formatCentsToDollars, formatDuration } from "./api";

// ---------------------------------------------------------------------------
// Helpers to build fake Response objects
// ---------------------------------------------------------------------------
function makeResponse(status: number, statusText: string, body: string | null = null): Response {
  return new Response(body, { status, statusText });
}

// ---------------------------------------------------------------------------
// adminFetch — error handling paths
// ---------------------------------------------------------------------------

describe("adminFetch", () => {
  beforeEach(() => {
    localStorageMock.clear();
    windowMock.location.href = "";
  });

  describe("network-level errors", () => {
    it("re-throws a TypeError when fetch itself rejects (offline / no network)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
      await expect(adminFetch("/some-path")).rejects.toThrow("Failed to fetch");
      await expect(adminFetch("/some-path")).rejects.toBeInstanceOf(TypeError);
    });

    it("re-throws any error object the underlying fetch throws", async () => {
      const cause = new Error("ECONNREFUSED");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(cause));
      await expect(adminFetch("/any")).rejects.toThrow("ECONNREFUSED");
    });
  });

  describe("401 / 403 — unauthorised responses", () => {
    it("clears adminToken from localStorage on a 401 response", async () => {
      localStorage.setItem("adminToken", "secret-token");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(401, "Unauthorized")));
      await expect(adminFetch("/protected")).rejects.toThrow("Unauthorized");
      expect(localStorage.getItem("adminToken")).toBeNull();
    });

    it("clears adminToken from localStorage on a 403 response", async () => {
      localStorage.setItem("adminToken", "secret-token");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(403, "Forbidden")));
      await expect(adminFetch("/protected")).rejects.toThrow("Unauthorized");
      expect(localStorage.getItem("adminToken")).toBeNull();
    });

    it("redirects to the login page on a 401 response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(401, "Unauthorized")));
      await expect(adminFetch("/protected")).rejects.toThrow();
      expect(windowMock.location.href).toContain("login");
    });

    it("redirects to the login page on a 403 response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(403, "Forbidden")));
      await expect(adminFetch("/protected")).rejects.toThrow();
      expect(windowMock.location.href).toContain("login");
    });
  });

  describe("non-OK responses (4xx / 5xx)", () => {
    it("throws HTTP error containing the status code for a 500 with no body", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(500, "Internal Server Error")));
      await expect(adminFetch("/fail")).rejects.toThrow(/HTTP 500/);
    });

    it("includes the statusText when the body is empty", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(500, "Internal Server Error")));
      await expect(adminFetch("/fail")).rejects.toThrow(/Internal Server Error/);
    });

    it("falls back to statusText when the body is whitespace-only", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(503, "Service Unavailable", "   ")));
      await expect(adminFetch("/fail")).rejects.toThrow(/Service Unavailable/);
    });

    it("includes the response body text in the thrown message", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(500, "Internal Server Error", "Database connection lost")));
      await expect(adminFetch("/fail")).rejects.toThrow(/Database connection lost/);
    });

    it("throws an HTTP error containing the status code for a 404", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(404, "Not Found", "Route not found")));
      await expect(adminFetch("/missing")).rejects.toThrow(/HTTP 404/);
    });

    it("includes the body text in the thrown message for a 404", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(404, "Not Found", "Route not found")));
      await expect(adminFetch("/missing")).rejects.toThrow(/Route not found/);
    });

    it("throws an HTTP error for a 422 Unprocessable Entity", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(422, "Unprocessable Entity", "Invalid input")));
      await expect(adminFetch("/validate")).rejects.toThrow(/HTTP 422/);
    });
  });

  describe("successful responses", () => {
    it("returns parsed JSON for a 200 response", async () => {
      const payload = { ok: true, count: 42 };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })),
      );
      const result = await adminFetch<typeof payload>("/data");
      expect(result).toEqual(payload);
    });

    it("sends the adminToken from localStorage as the X-Admin-Token header", async () => {
      localStorage.setItem("adminToken", "my-secret-admin-token");
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
      vi.stubGlobal("fetch", mockFetch);
      await adminFetch("/secure");
      const calledHeaders = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
      expect(calledHeaders["X-Admin-Token"]).toBe("my-secret-admin-token");
    });

    it("sends an empty token when no adminToken is stored", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
      vi.stubGlobal("fetch", mockFetch);
      await adminFetch("/public");
      const calledHeaders = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
      expect(calledHeaders["X-Admin-Token"]).toBe("");
    });
  });
});

// ---------------------------------------------------------------------------
// formatAdminError — what the admin user actually sees in toasts/inline alerts
// ---------------------------------------------------------------------------

describe("formatAdminError", () => {
  describe("plain Error objects (network failures, HTTP errors from adminFetch)", () => {
    it("returns the message from a network TypeError (offline)", () => {
      const err = new TypeError("Failed to fetch");
      expect(formatAdminError(err)).toBe("Failed to fetch");
    });

    it("returns the message from a network TypeError (CORS/offline)", () => {
      const err = new TypeError("NetworkError when attempting to fetch resource.");
      expect(formatAdminError(err)).toBe("NetworkError when attempting to fetch resource.");
    });

    it("returns the full HTTP error string from a 500 with no body (statusText fallback)", () => {
      const err = new Error("HTTP 500: Internal Server Error");
      expect(formatAdminError(err)).toBe("HTTP 500: Internal Server Error");
    });

    it("returns the full HTTP error string from a 500 with a body message", () => {
      const err = new Error("HTTP 500: Database connection lost");
      expect(formatAdminError(err)).toBe("HTTP 500: Database connection lost");
    });

    it("returns the HTTP 404 error string", () => {
      const err = new Error("HTTP 404: Not Found");
      expect(formatAdminError(err)).toBe("HTTP 404: Not Found");
    });

    it("returns the message from any generic Error", () => {
      const err = new Error("Something went wrong");
      expect(formatAdminError(err)).toBe("Something went wrong");
    });
  });

  describe("unknown thrown values (guard against non-Error throws)", () => {
    it("returns the generic fallback for null", () => {
      expect(formatAdminError(null)).toBe("An unexpected error occurred.");
    });

    it("returns the generic fallback for undefined", () => {
      expect(formatAdminError(undefined)).toBe("An unexpected error occurred.");
    });

    it("returns the generic fallback for a plain string", () => {
      expect(formatAdminError("something broke")).toBe("An unexpected error occurred.");
    });

    it("returns the generic fallback for a number", () => {
      expect(formatAdminError(42)).toBe("An unexpected error occurred.");
    });

    it("returns the generic fallback for an arbitrary object", () => {
      expect(formatAdminError({ code: "ERR_UNKNOWN" })).toBe("An unexpected error occurred.");
    });
  });
});

// ---------------------------------------------------------------------------
// End-to-end error-display path tests
//
// These tests verify the full path from a failed fetch → the message string
// that appears in the admin UI (inline alert text or toast description).
// They simulate what happens when adminFetch rejects and the caller passes
// the caught error to formatAdminError (or uses error.message directly).
// ---------------------------------------------------------------------------

describe("inline alert error-display path (query isError state)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    windowMock.location.href = "";
  });

  it("shows 'HTTP 500: Internal Server Error' when the server returns 500 with no body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(500, "Internal Server Error")));
    const err = await adminFetch("/overview").catch((e: unknown) => e);
    // usage.tsx and overview.tsx render: `Error loading …: {(error as Error).message}`
    expect((err as Error).message).toBe("HTTP 500: Internal Server Error");
  });

  it("shows the server body text when the 500 includes a plain-text message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(500, "Internal Server Error", "DB timeout")));
    const err = await adminFetch("/usage").catch((e: unknown) => e);
    expect((err as Error).message).toBe("HTTP 500: DB timeout");
  });

  it("shows 'Failed to fetch' for a network-level TypeError (offline)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await adminFetch("/usage").catch((e: unknown) => e);
    expect((err as Error).message).toBe("Failed to fetch");
  });

  it("shows 'HTTP 404: Not Found' when the endpoint does not exist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(404, "Not Found")));
    const err = await adminFetch("/missing").catch((e: unknown) => e);
    expect((err as Error).message).toBe("HTTP 404: Not Found");
  });
});

describe("mutation toast error-display path (catch block → formatAdminError)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    windowMock.location.href = "";
  });

  it("toast description is the HTTP error for a 500 with no body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(500, "Internal Server Error")));
    const err = await adminFetch("/settings/spike-threshold").catch((e: unknown) => e);
    // settings.tsx: toast({ title: "Failed to save threshold", description: formatAdminError(err) })
    expect(formatAdminError(err)).toBe("HTTP 500: Internal Server Error");
  });

  it("toast description is the server body text for a 500 with a message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(500, "Internal Server Error", "Write conflict")));
    const err = await adminFetch("/settings/spike-threshold").catch((e: unknown) => e);
    expect(formatAdminError(err)).toBe("HTTP 500: Write conflict");
  });

  it("toast description is 'Failed to fetch' for a network TypeError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await adminFetch("/alerts/spikes/user-123/dismiss").catch((e: unknown) => e);
    // overview.tsx: toast({ title: "Failed to dismiss", description: formatAdminError(err) })
    expect(formatAdminError(err)).toBe("Failed to fetch");
  });

  it("toast description falls back to generic message for a null thrown value", () => {
    // Guard against unexpected non-Error throws from third-party code
    expect(formatAdminError(null)).toBe("An unexpected error occurred.");
  });
});

// ---------------------------------------------------------------------------
// formatCentsToDollars
// ---------------------------------------------------------------------------

describe("formatCentsToDollars", () => {
  it("formats zero paise as INR 0.00", () => {
    expect(formatCentsToDollars(0)).toMatch(/0\.00/);
  });

  it("formats 100 paise as ₹1.00", () => {
    expect(formatCentsToDollars(100)).toMatch(/1\.00/);
  });

  it("formats 999 paise as ₹9.99", () => {
    expect(formatCentsToDollars(999)).toMatch(/9\.99/);
  });

  it("formats large values with thousands separators", () => {
    const result = formatCentsToDollars(100000);
    expect(result).toMatch(/1[,.]?000\.00/);
  });

  it("formats negative paise correctly (refunds)", () => {
    const result = formatCentsToDollars(-500);
    expect(result).toContain("5.00");
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("returns seconds-only for durations under a minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(59)).toBe("59s");
  });

  it("returns minutes + seconds for durations of exactly one minute", () => {
    expect(formatDuration(60)).toBe("1m 0s");
  });

  it("returns minutes + seconds for mixed durations", () => {
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(125)).toBe("2m 5s");
  });

  it("truncates fractional seconds (floor)", () => {
    expect(formatDuration(61.9)).toBe("1m 1s");
  });

  it("returns minutes with 0s when duration is a whole-minute boundary", () => {
    expect(formatDuration(120)).toBe("2m 0s");
  });
});
