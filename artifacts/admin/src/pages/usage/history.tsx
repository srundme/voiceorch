import { useState } from "react";
import { UsageSubNav, UsagePageHeader } from "@/components/usage-layout";
import { useUsageHistory, microsToUsd } from "@/hooks/use-usage-monitor";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight } from "lucide-react";

const RANGE_OPTIONS = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "All time", value: 0 },
];
const SERVICES = ["all", "stt", "llm", "tts"];

export default function UsageHistoryPage() {
  const [days, setDays] = useState(30);
  const [service, setService] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const filters = {
    days,
    limit,
    offset: page * limit,
    service: service === "all" ? null : service,
    search: search.trim() || null,
  };
  const { data, isLoading } = useUsageHistory(filters);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <UsagePageHeader title="Usage history" subtitle="Raw stream of usage events" />
      <UsageSubNav />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search provider, model, user…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="max-w-sm"
          data-testid="input-history-search"
        />
        <Select value={service} onValueChange={(v) => { setService(v); setPage(0); }}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SERVICES.map((s) => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(days)} onValueChange={(v) => { setDays(Number(v)); setPage(0); }}>
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
                <TableHead>When</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Provider / Model</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Call</TableHead>
                <TableHead className="text-right">Usage</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No events.</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} data-testid={`history-row-${r.id}`}>
                    <TableCell className="font-mono text-[11px]">{new Date(r.createdAt).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="outline" className="uppercase">{r.service}</Badge></TableCell>
                    <TableCell>
                      <div className="text-xs font-medium capitalize">{r.provider}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{r.model ?? "—"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">{r.email ?? "—"}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{r.userId ?? "anonymous"}</div>
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">{r.workspaceId ?? "—"}</TableCell>
                    <TableCell className="font-mono text-[11px]">{r.callId ?? "—"}</TableCell>
                    <TableCell className="text-right text-[11px] font-mono tabular-nums">
                      {r.service === "stt" && `${r.audioSeconds}s`}
                      {r.service === "tts" && `${r.characters} chars`}
                      {r.service === "llm" && `${r.inputTokens}/${r.outputTokens} tok`}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{microsToUsd(r.estimatedCostMicros)}</TableCell>
                    <TableCell className="text-right">
                      {r.success ? (
                        <Badge variant="outline" className="border-zinc-500/30 bg-zinc-500/10 text-zinc-400">ok</Badge>
                      ) : (
                        <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-400">failed</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Showing {rows.length === 0 ? 0 : page * limit + 1}–{page * limit + rows.length} of {total.toLocaleString()}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="text-xs">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
