import { ApiError } from "@workspace/api-client-react";

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
 *  1. First Zod issue from `ApiError.data.issues` — formatted as "field: message"
 *  2. `ApiError.data.error` — server-supplied error string
 *  3. `err.message` — the HTTP status message built by the fetch client
 *  4. Generic fallback
 */
export function formatApiError(err: unknown): string {
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
