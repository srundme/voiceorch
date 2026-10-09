import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { loadActingAs } from "@/lib/acting-as";
import { useListAgents } from "@workspace/api-client-react";

export interface NavVisibility {
  agents?: boolean;
  knowledge?: boolean;
  squads?: boolean;
  phoneNumbers?: boolean;
  campaigns?: boolean;
  flows?: boolean;
  connections?: boolean;
  bookings?: boolean;
  callLogs?: boolean;
  analytics?: boolean;
  developers?: boolean;
  settings?: boolean;
  billing?: boolean;
}

export interface PartnerPermissions {
  navVisibility?: NavVisibility;
  mode?: "full" | "read_only";
}

/** Cheap flags for the dashboard shell: partner nav gating + client branding. */
export interface PartnerContext {
  isPartner: boolean;
  branding: {
    companyName: string;
    logoUrl: string | null;
    supportEmail?: string | null;
    supportUrl?: string | null;
    docsUrl?: string | null;
    termsUrl?: string | null;
    privacyUrl?: string | null;
  } | null;
  /**
   * True when this account is linked to an ACTIVE partner. Clients get a full
   * workspace; partner owns ₹/min rate, wallet funding, and phone numbers.
   *
   * Note: `/partner/context` always reflects the signed-in auth user — not the
   * acting-as client. Use `usePartnerManagedWorkspace` for billing/number gates.
   */
  isManagedClient?: boolean;
  /** Always true for managed clients (full agent edit). Kept for API compat. */
  canEditAgents?: boolean;
  /** Granular feature & action permissions set by partner for this client. */
  partnerPermissions?: PartnerPermissions | null;
  agentLimit?: number | null;
  agentCount?: number;
  clientLimit?: number | null;
  partnerSupportEmail?: string | null;
  agentUpgradePriceInr?: number;
}

/**
 * Authenticated JSON fetch for the partner endpoints (mirrors the team page
 * pattern — these routes are not part of the generated OpenAPI client).
 */
export async function partnerFetch<T = unknown>(
  getToken: () => Promise<string | null>,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  // Only attach Bearer when a JWT is actually present. `Bearer null` would
  // shadow the HttpOnly session cookie and 401 every partner call.
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({} as Record<string, unknown>));
    const errorObj = new Error((err as { error?: string }).error || `Request failed (${res.status})`);
    Object.assign(errorObj, err);
    throw errorObj;
  }
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

export function usePartnerContext() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  return useQuery<PartnerContext>({
    queryKey: ["partner-context"],
    staleTime: 5 * 60 * 1000,
    retry: 1,
    enabled: isLoaded && isSignedIn,
    queryFn: () => partnerFetch<PartnerContext>(getToken, "/api/partner/context"),
  });
}

/**
 * Workspace mode for buy / top-up / KYC / release gates.
 * True for managed clients AND when a partner is acting-as a client (partner
 * context still says isPartner — acting-as must hide owner CTAs in the client UI).
 */
export function usePartnerManagedWorkspace() {
  const { data: partnerCtx, ...rest } = usePartnerContext();
  const actingAs = loadActingAs();
  const isManagedWorkspace =
    partnerCtx?.isManagedClient === true || !!actingAs;
  return {
    ...rest,
    partnerCtx,
    isManagedWorkspace,
    /** Provider label for client-facing copy. Acting-as partners fund via Partner Hub. */
    partnerName:
      partnerCtx?.branding?.companyName
      ?? (actingAs ? "Partner Hub" : "your partner"),
    actingAs,
  };
}

/**
 * True when the active user is a managed client whose partner set permissions mode to "read_only".
 * When a partner is acting-as this client, actingAs is non-null so this returns false (allowing partner edits).
 */
export function useIsPartnerReadOnly(): boolean {
  const { data: partnerCtx } = usePartnerContext();
  const actingAs = loadActingAs();
  if (actingAs) return false;
  return partnerCtx?.isManagedClient === true && partnerCtx?.partnerPermissions?.mode === "read_only";
}

/**
 * Real-time agent limit check hook.
 * Computes whether the current workspace has reached its partner agent limit.
 */
export function useAgentLimit() {
  const { data: partnerCtx } = usePartnerContext();
  const { data: agents } = useListAgents();

  const agentLimit = partnerCtx?.agentLimit ?? null;
  const currentCount = agents ? agents.filter((a: any) => !a.isTestPersona).length : (partnerCtx?.agentCount ?? 0);
  const isLimitReached = agentLimit !== null && currentCount >= agentLimit;

  return {
    agentLimit,
    currentCount,
    isLimitReached,
    agentUpgradePriceInr: partnerCtx?.agentUpgradePriceInr ?? 899,
    partnerSupportEmail: partnerCtx?.partnerSupportEmail ?? partnerCtx?.branding?.supportEmail ?? null,
  };
}
