/**
 * Partner-managed client workspaces: keep the product they use daily,
 * hide SnapServe-platform pages (docs, BYOP, vibe, etc.).
 * API keys + event webhooks are allowed so clients can integrate.
 */

const BLOCKED_PREFIXES = [
  "/docs",
  "/app/memory",
  "/app/squads",
  "/app/providers",
  "/app/voices",
  "/app/vibe",
  "/app/test-simulator",
  "/app/meet",
  "/app/usage",
  "/app/activity",
  "/app/kyc",
  "/app/partner",
];

export function isBlockedForManagedClient(path: string): boolean {
  const p = path.split(/[?#]/)[0] ?? path;
  return BLOCKED_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}
