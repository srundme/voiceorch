import { useState, useMemo } from "react";
import { useUsage, type UsageRow } from "@/hooks/use-admin-api";
import { formatCentsToDollars } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Mic, Brain, Volume2, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Link } from "wouter";

type SortKey = keyof UsageRow;
type SortDir = "asc" | "desc";

const DATE_OPTIONS = [
  { label: "Last 7 days", value: 7 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
  { label: "All time", value: 0 },
];

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  return `${ms.toLocaleString()} ms`;
}

function fmtMinutes(secs: number): string {
  const m = Math.round(secs / 60);
  return `${m.toLocaleString()} min`;
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="h-3 w-3 ml-1 opacity-40 inline" />;
  return sortDir === "asc"
    ? <ChevronUp className="h-3 w-3 ml-1 inline" />
    : <ChevronDown className="h-3 w-3 ml-1 inline" />;
}

export default function Usage() {
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("callCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data, isLoading, isError, error } = useUsage(days);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    const q = search.toLowerCase();
    return data.rows.filter(
      (r) =>
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.clerkId ?? "").toLowerCase().includes(q),
    );
  }, [data?.rows, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const totals = data?.totals;

  const summaryCards = [
    {
      title: "Total STT Calls",
      value: totals?.totalSttCalls?.toLocaleString() ?? "0",
      icon: Mic,
      desc: "Speech-to-text calls processed",
    },
    {
      title: "Total LLM Calls",
      value: totals?.totalLlmCalls?.toLocaleString() ?? "0",
      icon: Brain,
      desc: "Language model inferences",
    },
    {
      title: "Total TTS Calls",
      value: totals?.totalTtsCalls?.toLocaleString() ?? "0",
      icon: Volume2,
      desc: "Text-to-speech calls processed",
    },
  ];

  const thClass =
    "cursor-pointer select-none whitespace-nowrap text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground";

  function Th({ col, children }: { col: SortKey; children: React.ReactNode }) {
    return (
      <TableHead className={thClass} onClick={() => handleSort(col)}>
        {children}
        <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
      </TableHead>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Usage Monitor</h1>
        <div className="flex items-center gap-2">
          {DATE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                days === opt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {summaryCards.map((card, i) => (
          <Card key={i} className="border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                {card.title}
              </CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold font-mono">
                {isLoading ? <span className="animate-pulse text-muted-foreground">...</span> : card.value}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{card.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="p-4 border-b border-border bg-muted/20 flex items-center justify-between gap-4 flex-wrap">
          <span className="font-medium">Per-User Breakdown</span>
          <Input
            placeholder="Search by email or Clerk ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs h-8 text-xs"
          />
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <Th col="email">User</Th>
                <Th col="sttCallCount">STT Calls</Th>
                <Th col="avgSttLatencyMs">Avg STT Latency</Th>
                <Th col="llmCallCount">LLM Calls</Th>
                <Th col="avgLlmLatencyMs">Avg LLM Latency</Th>
                <Th col="ttsCallCount">TTS Calls</Th>
                <Th col="avgTtsFirstChunkMs">Avg TTS First Chunk</Th>
                <Th col="totalDurationSeconds">Total Minutes</Th>
                <Th col="totalCostCents">Total Cost</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground animate-pulse">
                    Loading usage data...
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-destructive">
                    Error: {(error as Error).message}
                  </TableCell>
                </TableRow>
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    {search ? "No users match your search." : "No usage data for this period."}
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((row, i) => (
                  <TableRow key={row.clerkId ?? i}>
                    <TableCell className="min-w-[180px]">
                      {row.clerkId ? (
                        <Link
                          href={`/users/${row.clerkId}`}
                          className="text-primary hover:underline block truncate max-w-[220px]"
                        >
                          {row.email || row.clerkId}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Unknown</span>
                      )}
                      {row.email && row.clerkId && (
                        <span className="block text-[10px] text-muted-foreground font-mono truncate max-w-[220px]">
                          {row.clerkId}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.sttCallCount.toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{fmtMs(row.avgSttLatencyMs)}</TableCell>
                    <TableCell className="font-mono text-xs">{row.llmCallCount.toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{fmtMs(row.avgLlmLatencyMs)}</TableCell>
                    <TableCell className="font-mono text-xs">{row.ttsCallCount.toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{fmtMs(row.avgTtsFirstChunkMs)}</TableCell>
                    <TableCell className="font-mono text-xs">{fmtMinutes(row.totalDurationSeconds)}</TableCell>
                    <TableCell className="font-mono text-xs">{formatCentsToDollars(row.totalCostCents)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
