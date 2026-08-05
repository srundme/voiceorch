/**
 * Legacy /app/people → Campaigns (core campaign manager).
 */
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function PeoplePage() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/app/campaigns", { replace: true });
  }, [navigate]);
  return null;
}
