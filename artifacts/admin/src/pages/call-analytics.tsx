import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { CallVolumeChart } from "@/components/call-volume-chart";
import { SectionSubNav } from "@/components/section-subnav";
import { ANALYTICS_TABS } from "@/lib/nav-config";
import { useVoiceCallSearch } from "@/hooks/use-admin-api";
import { useDebounce } from "@/hooks/use-debounce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, X } from "lucide-react";

function fmtDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtCost(cents: number | null): string {
  if (cents == null) return "—";
  return `₹${(cents / 100).toFixed(2)}`;
}

function CallLookupCard() {
  const [input, setInput] = useState("");
  const query = useDebounce(input, 400);
  const trimmed = query.trim();
  const { data, isLoading, isError } = useVoiceCallSearch(trimmed);
  const calls = data?.calls ?? [];
  const searching = trimmed.length >= 3;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xs text-muted-foreground uppercase flex items-center gap-2">
          <Search className="h-3.5 w-3.5" /> Find a call by execution ID
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 pr-8 font-mono text-xs"
            placeholder="exec_1a2b3c4d or call id"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          {input && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
              onClick={() => setInput("")}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Paste what the customer sent — the full execution ID, just the part after
          <span className="font-mono"> exec_</span>, or the numeric call ID.
        </p>

        {searching && (
          <div className="border border-border rounded-lg overflow-hidden overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono text-xs">Execution ID</TableHead>
                  <TableHead className="font-mono text-xs">Date</TableHead>
                  <TableHead className="font-mono text-xs">User</TableHead>
                  <TableHead className="font-mono text-xs">Agent</TableHead>
                  <TableHead className="font-mono text-xs">Status</TableHead>
                  <TableHead className="font-mono text-xs text-right">Duration</TableHead>
                  <TableHead className="font-mono text-xs text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="h-16 text-center text-muted-foreground animate-pulse">Searching…</TableCell></TableRow>
                ) : isError ? (
                  <TableRow><TableCell colSpan={7} className="h-16 text-center text-destructive">Search failed</TableCell></TableRow>
                ) : calls.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="h-16 text-center text-muted-foreground">No call matches that ID</TableCell></TableRow>
                ) : (
                  calls.map((call) => (
                    <TableRow key={call.id}>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/voice/calls/${call.id}`} className="text-primary hover:underline">
                          {call.executionId ?? `#${call.id}`}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {call.createdAt ? format(new Date(call.createdAt), "MMM d HH:mm") : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {call.userId ? (
                          <Link href={`/users/${call.userId}`} className="text-primary hover:underline">
                            {call.userEmail || call.userName || call.userId}
                          </Link>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{call.agentName ?? call.agentId ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={call.status === "completed" ? "default" : call.status === "failed" ? "destructive" : "secondary"}
                          className="text-[10px] uppercase"
                        >
                          {call.status ?? "unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtDuration(call.durationSeconds)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtCost(call.costCents)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CallAnalyticsPage() {
  return (
    <div className="space-y-6">
      <SectionSubNav tabs={ANALYTICS_TABS} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Call Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Platform-wide SnapServe call counts by week, month, or year — completed vs failed.
        </p>
      </div>
      <CallLookupCard />
      <CallVolumeChart defaultPreset="month" />
    </div>
  );
}
