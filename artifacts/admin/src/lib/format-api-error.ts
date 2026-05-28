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
 *  4. `err.message` — the HTTP status message built by the fetch client
 *  5. Generic fallback
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
    return err.message;
  }

  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}
