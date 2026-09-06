import { useState } from "react";
import { UsageSubNav, UsagePageHeader } from "@/components/usage-layout";
import { useAdminAlerts, useAcknowledgeAlert } from "@/hooks/use-usage-monitor";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Check, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";

const SEVERITY: Record<string, string> = {
  critical: "border-red-500/30 bg-red-500/10 text-red-400",
  high: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
  warning: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
  medium: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
  info: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
  low: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
};

const TYPE_LABEL: Record<string, string> = {
  low_balance: "Low balance",
  threshold_80: "80% of budget",
  threshold_90: "90% of budget",
  threshold_100: "Budget exhausted",
  error_spike: "Error spike",
  usage_spike: "Usage spike",
  provider_down: "Provider down",
  account_deletion: "Account deleted",
};

export default function AlertsPage() {
  const [view, setView] = useState<"open" | "all">("open");
  const { data, isLoading } = useAdminAlerts({ limit: 200, onlyUnacknowledged: view === "open" });
  const ack = useAcknowledgeAlert();
  const { toast } = useToast();
  const alerts = data?.alerts ?? [];

  return (
    <div className="space-y-6">
      <UsagePageHeader
        title="Alerts"
        subtitle={`${data?.unacknowledgedCount ?? 0} unacknowledged · low balance, budget thresholds, spikes, provider down, account deletions`}
        actions={
          <Tabs value={view} onValueChange={(v) => setView(v as "open" | "all")}>
            <TabsList>
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <UsageSubNav />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : alerts.length === 0 ? (
            <div className="py-12 text-center">
              <Check className="mx-auto h-8 w-8 text-zinc-400" />
              <p className="mt-2 text-sm text-muted-foreground">All clear — no alerts.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-start gap-3 px-4 py-3" data-testid={`alert-${a.id}`}>
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={SEVERITY[a.severity] ?? ""}>{a.severity}</Badge>
                      <Badge variant="outline">{TYPE_LABEL[a.type] ?? a.type}</Badge>
                      {a.service && <Badge variant="outline" className="uppercase">{a.service}</Badge>}
                      {a.provider && <Badge variant="outline" className="capitalize">{a.provider}</Badge>}
                      <span className="text-sm font-semibold">{a.title}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{a.message}</p>
                    <p className="mt-1 flex items-center text-[10px] text-muted-foreground/70">
                      <Clock className="mr-1 h-3 w-3" />
                      {new Date(a.createdAt).toLocaleString()}
                      {a.acknowledgedAt && (
                        <span className="ml-3">
                          Acked by {a.acknowledgedBy ?? "admin"} on {new Date(a.acknowledgedAt).toLocaleString()}
                        </span>
                      )}
                    </p>
                  </div>
                  {!a.acknowledgedAt && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => ack.mutate(a.id, {
                        onError: (err) => toast({ title: "Failed to acknowledge", description: formatApiError(err), variant: "destructive" }),
                      })}
                      disabled={ack.isPending}
                    >
                      Acknowledge
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
