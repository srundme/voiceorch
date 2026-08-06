/**
 * Legacy /app/channels deep-links → Agent Builder Tools (or Connections).
 */

import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Loader2 } from "lucide-react";

export default function ChannelsRedirectPage() {
  const [, navigate] = useLocation();
  const search = useSearch();

  useEffect(() => {
    const params = new URLSearchParams(search);
    const channel = params.get("channel");
    const agentId = params.get("agentId");

    if (agentId && Number(agentId) > 0) {
      navigate(`/app/agents/${agentId}?section=tools`, { replace: true });
      return;
    }

    if (channel === "meetings") {
      navigate("/app/meet", { replace: true });
      return;
    }
    if (channel === "whatsapp") {
      navigate("/app/connections?setup=whatsapp", { replace: true });
      return;
    }
    if (channel === "email") {
      navigate("/app/connections?setup=email", { replace: true });
      return;
    }
    if (channel === "booking") {
      navigate("/app/connections?setup=calendar", { replace: true });
      return;
    }
    navigate("/app/agents", { replace: true });
  }, [navigate, search]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}
