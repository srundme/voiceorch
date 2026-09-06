/**
 * Public hosts users should copy into curl / SDKs.
 * On partner white-label hosts, use the current origin so clients never see SnapServe URLs.
 * Direct SnapServe keeps the canonical app.snapserve.ai hosts.
 */
import { isDirectSnapServeHost } from "@/lib/white-label";

export const SNAPSERVE_APP_ORIGIN = "https://app.snapserve.ai";
export const SNAPSERVE_API_BASE = "https://app.snapserve.ai/api";
export const SNAPSERVE_DOCS_URL = "https://app.snapserve.ai/docs";

/** App origin for the current host (partner portal → partner URL). */
export function publicAppOrigin(): string {
  if (typeof window !== "undefined" && !isDirectSnapServeHost()) {
    return window.location.origin.replace(/\/$/, "");
  }
  return SNAPSERVE_APP_ORIGIN;
}

/** REST API base for curl examples and developer copy. */
export function publicApiBase(): string {
  return `${publicAppOrigin()}/api`;
}

/** Docs home — partners often set their own docsUrl; fall back to in-app /docs only on SnapServe. */
export function publicDocsUrl(): string {
  if (typeof window !== "undefined" && !isDirectSnapServeHost()) {
    return `${publicAppOrigin()}/docs`;
  }
  return SNAPSERVE_DOCS_URL;
}
