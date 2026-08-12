import { useParams, Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentAnalyticsPanel } from "@/pages/agents/agent-analytics-panel";

export default function AgentAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const agentId = parseInt(params.id ?? "0", 10);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 sm:px-6 py-4 border-b border-border shrink-0">
        <Link href="/app/analytics">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-base font-semibold text-foreground">Agent analytics</h1>
          <p className="text-xs text-muted-foreground">Also available in Agent Builder → Analytics</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 md:px-8">
          <AgentAnalyticsPanel agentId={agentId} />
        </div>
      </div>
    </div>
  );
}
