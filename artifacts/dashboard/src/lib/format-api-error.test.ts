import { describe, it, expect } from "vitest";
import { ApiError, RequestTimeoutError } from "@workspace/api-client-react";
import { formatApiError } from "./format-api-error";

function makeResponse(status = 400, statusText = "Bad Request"): Response {
  return new Response(null, { status, statusText });
}

function makeApiError(data: unknown, status = 400, statusText = "Bad Request"): ApiError {
  const response = makeResponse(status, statusText);
  return new ApiError(response, data, { method: "POST", url: "/api/test" });
}

describe("formatApiError", () => {
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

    it("joins nested paths with a dot", () => {
      const err = makeApiError({
        issues: [{ path: ["config", "asr", "provider"], message: "Invalid provider" }],
      });
      expect(formatApiError(err)).toBe("config.asr.provider: Invalid provider");
    });

    it("uses the first issue when multiple issues are present", () => {
      const err = makeApiError({
        issues: [
          { path: ["email"], message: "Invalid email" },
          { path: ["name"], message: "Name is required" },
        ],
      });
      expect(formatApiError(err)).toBe("email: Invalid email");
    });
  });

  describe("ApiError with only an error string", () => {
    it("returns the server-supplied error string", () => {
      const err = makeApiError({ error: "Agent not found" });
      expect(formatApiError(err)).toBe("Agent not found");
    });

    it("prefers issues over the error string when both are present", () => {
      const err = makeApiError({
        error: "Validation failed",
        issues: [{ path: ["slug"], message: "Slug is taken" }],
      });
      expect(formatApiError(err)).toBe("slug: Slug is taken");
    });
  });

  describe("ApiError with no structured body", () => {
    it("falls back to err.message when data is null", () => {
      const err = makeApiError(null, 500, "Internal Server Error");
      expect(formatApiError(err)).toBe("HTTP 500 Internal Server Error");
    });

    it("falls back to err.message when data has no error or issues", () => {
      const err = makeApiError({}, 404, "Not Found");
      expect(formatApiError(err)).toBe("HTTP 404 Not Found");
    });

    it("falls back to err.message for a 500 with no body", () => {
      const err = makeApiError(null, 500, "Internal Server Error");
      expect(formatApiError(err)).toContain("500");
    });
  });

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

  describe("plain Error (network failures)", () => {
    it("returns the message from a generic Error", () => {
      const err = new Error("Something went wrong");
      expect(formatApiError(err)).toBe("Something went wrong");
    });

    it("returns the message from a network TypeError (fetch throws)", () => {
      const err = new TypeError("Failed to fetch");
      expect(formatApiError(err)).toBe("Failed to fetch");
    });

    it("returns the message from a network TypeError (CORS/offline)", () => {
      const err = new TypeError("NetworkError when attempting to fetch resource.");
      expect(formatApiError(err)).toBe("NetworkError when attempting to fetch resource.");
    });
  });

  describe("unknown thrown values", () => {
    it("returns the generic fallback for null", () => {
      expect(formatApiError(null)).toBe("An unexpected error occurred.");
    });

    it("returns the generic fallback for undefined", () => {
      expect(formatApiError(undefined)).toBe("An unexpected error occurred.");
    });

    it("returns the generic fallback for a plain string", () => {
      expect(formatApiError("something broke")).toBe("An unexpected error occurred.");
    });

    it("returns the generic fallback for a number", () => {
      expect(formatApiError(42)).toBe("An unexpected error occurred.");
    });

    it("returns the generic fallback for an arbitrary object", () => {
      expect(formatApiError({ code: "ERR_UNKNOWN" })).toBe("An unexpected error occurred.");
    });
  });
});
