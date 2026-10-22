/**
 * A managed client's effective section visibility / edit mode.
 *
 * The partner's `defaultClientPermissions` is the live setting for all of its
 * clients; a client's own `partnerPermissions` overrides it key by key. So a
 * partner who hides "Flows" in Partner Hub → Settings hides it for every client
 * that has not been given its own Flows setting.
 */
export type ClientPermissions = {
  navVisibility?: Record<string, boolean>;
  mode?: "full" | "read_only";
};

function asPermissions(raw: unknown): ClientPermissions | null {
  return raw && typeof raw === "object" ? (raw as ClientPermissions) : null;
}

export function effectiveClientPermissions(
  clientRaw: unknown,
  partnerRaw: unknown,
): ClientPermissions | null {
  const client = asPermissions(clientRaw);
  const partner = asPermissions(partnerRaw);
  if (!client && !partner) return null;
  const navVisibility = { ...(partner?.navVisibility ?? {}), ...(client?.navVisibility ?? {}) };
  const mode = client?.mode ?? partner?.mode;
  return {
    ...(Object.keys(navVisibility).length ? { navVisibility } : {}),
    ...(mode ? { mode } : {}),
  };
}
