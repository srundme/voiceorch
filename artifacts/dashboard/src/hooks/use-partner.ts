import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";

/** Cheap flags for the dashboard shell: partner nav gating + client branding. */
export interface PartnerContext {
  isPartner: boolean;
  branding: { companyName: string; logoUrl: string | null } | null;
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
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({} as Record<string, unknown>));
    throw new Error((err as { error?: string }).error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

export function usePartnerContext() {
  const { getToken } = useAuth();
  return useQuery<PartnerContext>({
    queryKey: ["partner-context"],
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: () => partnerFetch<PartnerContext>(getToken, "/api/partner/context"),
  });
}
