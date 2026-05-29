import { ApiError, RequestTimeoutError } from "@workspace/api-client-react";

interface ZodIssue {
  path?: (string | number)[];
  message: string;
}

interface ApiErrorData {
  error?: string;
  issues?: ZodIssue[];
}

/**
 * Extracts a user-readable description from a mutation error.
 *
 * Priority:
 *  1. Timeout / abort — "Request timed out — please try again"
 *  2. First Zod issue from `ApiError.data.issues` — formatted as "field: message"
 *  3. `ApiError.data.error` — server-supplied error string
 *  4. HTTP status normalisation — friendly copy based on 4xx/5xx range
 *  5. `err.message` — message from a plain Error (e.g. network failure)
 *  6. Generic fallback
 */
export function formatApiError(err: unknown): string {
  if (err instanceof RequestTimeoutError) {
    return "Request timed out — please try again";
  }

  if (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  ) {
    return "Request timed out — please try again";
  }

  if (err instanceof ApiError) {
    const data = err.data as ApiErrorData | null;
    const issue = data?.issues?.[0];
    if (issue) {
      const field = issue.path && issue.path.length > 0 ? issue.path.join(".") : null;
      return field ? `${field}: ${issue.message}` : issue.message;
    }
    if (data?.error) return data.error;
    // No structured body — avoid surfacing raw "HTTP 500 …" strings
    if (err.status >= 500) return "Something went wrong on our end — please try again.";
    if (err.status >= 400) return "Something went wrong with your request.";
    return "An unexpected error occurred.";
  }

  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}

/**
 * Returns true when the API responded with a DESTINATION_UNVERIFIED error code (403),
 * indicating the caller must OTP-verify the destination number before calling.
 */
export function isDestinationUnverifiedError(err: unknown): boolean {
  if (err instanceof ApiError) {
    const data = err.data as (ApiErrorData & { code?: string }) | null;
    return data?.code === "DESTINATION_UNVERIFIED";
  }
  return false;
}

/**
 * Returns true when the API responded with a KYC_REQUIRED error code (403),
 * indicating the user must complete identity verification before proceeding.
 */
export function isKycError(err: unknown): boolean {
  if (err instanceof ApiError) {
    const data = err.data as (ApiErrorData & { code?: string }) | null;
    return data?.code === "KYC_REQUIRED";
  }
  return false;
}

/**
 * Maps Zod validation issues from an API error to a flat record of
 * `fieldPath → errorMessage`. Nested paths (e.g. `["tools", 0, "name"]`) are
 * joined with dots so they match react-hook-form field names.
 *
 * Returns an empty object when the error carries no structured issues.
 */
export function mapApiErrors(err: unknown): Record<string, string> {
  if (err instanceof ApiError) {
    const data = err.data as ApiErrorData | null;
    const issues = data?.issues;
    if (issues && issues.length > 0) {
      const map: Record<string, string> = {};
      for (const issue of issues) {
        if (issue.path && issue.path.length > 0) {
          const key = issue.path.join(".");
          if (!map[key]) map[key] = issue.message;
        }
      }
      return map;
    }
  }
  return {};
}
