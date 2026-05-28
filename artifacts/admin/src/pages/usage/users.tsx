import { useState, useMemo } from "react";
import { UsageSubNav, UsagePageHeader } from "@/components/usage-layout";
import { useUsageByUser, microsToUsd } from "@/hooks/use-usage-monitor";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";

const RANGE_OPTIONS = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

export default function UsageUsersPage() {
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data, isLoading } = useUsageByUser(days);
  const toggle = (k: string) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = data?.rows ?? [];
    if (!q) return all;
    return all.filter(
      (r) => (r.email ?? "").toLowerCase().includes(q) || (r.userId ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  return (
    <div className="space-y-6">
      <UsagePageHeader title="Usage by user" subtitle="Per-user cost across STT, LLM, and TTS" />
      <UsageSubNav />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          placeholder="Search by email or user id"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
          data-testid="input-user-search"
        />
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((o) => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>User</TableHead>
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
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No usage yet.</TableCell></TableRow>
              ) : (
                rows.flatMap((r) => {
                  const key = r.userId ?? "anonymous";
                  const open = expanded.has(key);
                  return [
                    <TableRow key={key} data-testid={`user-row-${key}`} className="cursor-pointer" onClick={() => toggle(key)}>
                      <TableCell>
                        {(r.providers?.length ?? 0) > 0 ? (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : null}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{r.email ?? "—"}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{r.userId ?? "anonymous"}</div>
                      </TableCell>
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
                              <div key={i} className="flex items-center gap-2 text-[11px]" data-testid={`user-${key}-provider-${i}`}>
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
