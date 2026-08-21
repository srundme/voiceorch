import { useState } from "react";
import { Link } from "wouter";
import { SectionSubNav } from "@/components/section-subnav";
import { OPERATIONS_TABS } from "@/lib/nav-config";
import { useAlertRules, usePatchAlertRule } from "@/hooks/use-admin-api";
import { useAdminAlerts, useAcknowledgeAlert } from "@/hooks/use-usage-monitor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Check, Clock, Mail, MessageSquare, Monitor } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";

const SEVERITY: Record<string, string> = {
  critical: "border-red-500/30 bg-red-500/10 text-red-500",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  high: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  info: "border-border text-muted-foreground",
  low: "border-border text-muted-foreground",
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

export default function OperationsAlertsPage() {
  const [view, setView] = useState<"open" | "all">("open");
  const { data: rulesData, isLoading: rulesLoading } = useAlertRules();
  const patchRule = usePatchAlertRule();
  const { data, isLoading } = useAdminAlerts({ limit: 200, onlyUnacknowledged: view === "open" });
  const ack = useAcknowledgeAlert();
  const { toast } = useToast();
  const alerts = data?.alerts ?? [];
  const channels = rulesData?.channels;

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={OPERATIONS_TABS} />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rules, channels, and live incidents · {rulesData?.openAlerts ?? data?.unacknowledgedCount ?? 0} open
          </p>
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as "open" | "all")}>
          <TabsList>
            <TabsTrigger value="open">Open feed</TabsTrigger>
            <TabsTrigger value="all">All feed</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase flex items-center gap-1.5"><Monitor className="h-3.5 w-3.5" /> Admin UI</CardTitle></CardHeader>
          <CardContent className="text-sm">{channels?.adminUi ? "Enabled" : "Disabled"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email</CardTitle></CardHeader>
          <CardContent className="text-sm truncate">
            {channels?.emailAddress ? channels.emailAddress : "Not configured"}
            <div className="mt-1"><Link href="/settings" className="text-xs text-primary hover:underline">Configure in Settings</Link></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> Slack</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {channels?.slackConfigured ? "Webhook configured" : "Not configured"}
            <div className="mt-1"><Link href="/settings" className="text-xs text-primary hover:underline">Configure in Settings</Link></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alert rules</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-mono text-xs">Metric</TableHead>
                <TableHead className="font-mono text-xs">Condition</TableHead>
                <TableHead className="font-mono text-xs">Threshold</TableHead>
                <TableHead className="font-mono text-xs">Severity</TableHead>
                <TableHead className="font-mono text-xs">Monitor</TableHead>
                <TableHead className="font-mono text-xs text-right">7d triggers</TableHead>
                <TableHead className="font-mono text-xs text-right">Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rulesLoading ? (
                <TableRow><TableCell colSpan={7} className="h-20 text-center text-muted-foreground animate-pulse">Loading rules…</TableCell></TableRow>
              ) : (rulesData?.rules ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{r.metric}</div>
                    <div className="text-[11px] text-muted-foreground max-w-[280px]">{r.description}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.condition}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Input
                        className="h-8 w-20 font-mono text-xs"
                        type="number"
                        defaultValue={r.threshold}
                        onBlur={(e) => {
                          const threshold = Number(e.target.value);
                          if (!Number.isFinite(threshold) || threshold === r.threshold) return;
                          patchRule.mutate(
                            { id: r.id, threshold },
                            { onError: (err) => toast({ title: "Failed", description: formatApiError(err), variant: "destructive" }) },
                          );
                        }}
                      />
                      <span className="text-xs text-muted-foreground">{r.unit}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] capitalize ${SEVERITY[r.severity] ?? ""}`}>{r.severity}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.monitor === "active" ? "default" : "outline"} className="text-[10px] capitalize">
                      {r.monitor}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{r.triggers7d ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={!!r.enabled}
                      disabled={patchRule.isPending}
                      onCheckedChange={(enabled) =>
                        patchRule.mutate(
                          { id: r.id, enabled },
                          { onError: (err) => toast({ title: "Failed", description: formatApiError(err), variant: "destructive" }) },
                        )
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Live feed</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : alerts.length === 0 ? (
            <div className="py-12 text-center">
              <Check className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">All clear — no alerts.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {alerts.map((a: any) => (
                <div key={a.id} className="flex items-start gap-3 px-4 py-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={SEVERITY[a.severity] ?? ""}>{a.severity}</Badge>
                      <Badge variant="outline">{TYPE_LABEL[a.type] ?? a.type}</Badge>
                      <span className="text-sm font-semibold">{a.title}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{a.message}</p>
                    <p className="mt-1 flex items-center text-[10px] text-muted-foreground/70">
                      <Clock className="mr-1 h-3 w-3" />
                      {new Date(a.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {!a.acknowledgedAt && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        ack.mutate(a.id, {
                          onError: (err) => toast({ title: "Failed to acknowledge", description: formatApiError(err), variant: "destructive" }),
                        })
                      }
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
