import { describe, it, expect } from "vitest";
import { ApiError, RequestTimeoutError } from "@workspace/api-client-react";
import { formatApiError } from "./format-api-error";

function makeResponse(status = 400, statusText = "Bad Request"): Response {
  return new Response(null, { status, statusText });
}

function makeApiError(data: unknown, status = 400, statusText = "Bad Request"): ApiError {
  const response = makeResponse(status, statusText);
  return new ApiError(response, data, { method: "POST", url: "/api/admin/test" });
}

describe("formatApiError (admin)", () => {
  describe("timeout and abort errors", () => {
    it("returns the timeout message for RequestTimeoutError", () => {
      const err = new RequestTimeoutError(30_000);
      expect(formatApiError(err)).toBe("Request timed out — please try again");
    });

    it("returns the timeout message for an AbortError (browser DOMException)", () => {
      const err = new DOMException("The user aborted a request.", "AbortError");
      expect(err.name).toBe("AbortError");
      expect(formatApiError(err)).toBe("Request timed out — please try again");
    });

    it("returns the timeout message for a generic Error with name TimeoutError", () => {
      const err = Object.assign(new Error("timed out"), { name: "TimeoutError" });
      expect(formatApiError(err)).toBe("Request timed out — please try again");
    });
  });

  describe("ApiError with Zod issues", () => {
    it("returns 'field: message' when the first issue has a path", () => {
      const err = makeApiError({
        issues: [{ path: ["name"], message: "Name is required" }],
      });
      expect(formatApiError(err)).toBe("name: Name is required");
    });

    it("returns just the message when the issue path is empty", () => {
      const err = makeApiError({
        issues: [{ path: [], message: "At least one field is required" }],
      });
      expect(formatApiError(err)).toBe("At least one field is required");
    });
  });

  describe("ApiError with only an error string", () => {
    it("returns the server-supplied error string", () => {
      const err = makeApiError({ error: "Forbidden" });
      expect(formatApiError(err)).toBe("Forbidden");
    });
  });

  describe("ApiError with no structured body", () => {
    it("falls back to err.message when data is null", () => {
      const err = makeApiError(null, 500, "Internal Server Error");
      expect(formatApiError(err)).toContain("500");
    });
  });

  describe("plain Error (network failures)", () => {
    it("returns the message from a generic Error", () => {
      const err = new Error("Network unavailable");
      expect(formatApiError(err)).toBe("Network unavailable");
    });
  });

  describe("unknown thrown values", () => {
    it("returns the generic fallback for null", () => {
      expect(formatApiError(null)).toBe("An unexpected error occurred.");
    });

    it("returns the generic fallback for a plain string", () => {
      expect(formatApiError("something broke")).toBe("An unexpected error occurred.");
    });
  });
});
