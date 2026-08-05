/**
 * Channels page removed from product IA.
 * Deep-links redirect to Connections / Meetings / Agents.
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
    const q = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";

    if (channel === "meetings") {
      navigate(`/app/meet${q}`, { replace: true });
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
    if (channel === "booking" || channel === "phone") {
      navigate(agentId ? `/app/agents/${agentId}` : "/app/agents", { replace: true });
      return;
    }
    navigate("/app/connections", { replace: true });
  }, [navigate, search]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}
