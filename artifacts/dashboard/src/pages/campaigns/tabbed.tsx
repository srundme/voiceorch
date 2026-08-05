/**
 * /app/campaigns — legacy URL → People lists.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function CampaignsTabPage() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/app/people", { replace: true });
  }, [navigate]);
  return null;
}
