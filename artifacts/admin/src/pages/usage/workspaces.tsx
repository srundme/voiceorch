import { useState } from "react";
import { UsageSubNav, UsagePageHeader } from "@/components/usage-layout";
import { useUsageByWorkspace, microsToUsd } from "@/hooks/use-usage-monitor";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";

const RANGE_OPTIONS = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

export default function UsageWorkspacesPage() {
  const [days, setDays] = useState(30);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data, isLoading } = useUsageByWorkspace(days);
  const rows = data?.rows ?? [];
  const toggle = (k: string) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  return (
    <div className="space-y-6">
      <UsagePageHeader
        title="Usage by workspace"
        subtitle="Workspace-level aggregation (anonymous rows = no workspace yet)"
        actions={
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((o) => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />
      <UsageSubNav />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">STT</TableHead>
                <TableHead className="text-right">LLM</TableHead>
                <TableHead className="text-right">TTS</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No data.</TableCell></TableRow>
              ) : (
                rows.flatMap((r) => {
                  const key = r.workspaceId ?? "none";
                  const open = expanded.has(key);
                  return [
                    <TableRow key={key} className="cursor-pointer" data-testid={`workspace-row-${key}`} onClick={() => toggle(key)}>
                      <TableCell>
                        {(r.providers?.length ?? 0) > 0 ? (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.workspaceId ?? "(no workspace)"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{r.eventCount.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{microsToUsd(r.sttCostMicros)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{microsToUsd(r.llmCostMicros)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{microsToUsd(r.ttsCostMicros)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-semibold">{microsToUsd(r.costMicros)}</TableCell>
                    </TableRow>,
                    open ? (
                      <TableRow key={`${key}-detail`} className="bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={6} className="py-2">
                          <div className="space-y-1">
                            {(r.providers ?? []).map((p, i) => (
                              <div key={i} className="flex items-center gap-2 text-[11px]" data-testid={`ws-${key}-provider-${i}`}>
                                <Badge variant="outline" className="uppercase">{p.service}</Badge>
                                <span className="font-medium capitalize">{p.provider}</span>
                                <span className="font-mono text-muted-foreground">{p.model ?? "default"}</span>
                                <span className="ml-auto text-muted-foreground">{p.eventCount.toLocaleString()} events</span>
                                <span className="w-20 text-right font-semibold">{microsToUsd(p.costMicros)}</span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null,
                  ];
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
