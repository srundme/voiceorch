/**
 * /app/campaigns — legacy Dial flows URL.
 * Phase 4 product home is /app/people (same engines).
 */
import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";

export default function CampaignsTabPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  useEffect(() => {
    const sp = new URLSearchParams(search);
    const tab = sp.get("tab");
    navigate(tab ? `/app/people?tab=${encodeURIComponent(tab)}` : "/app/people", { replace: true });
  }, [navigate, search]);
  return null;
}
