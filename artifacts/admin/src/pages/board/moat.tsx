import { useBoardMoat } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Brain, Languages, PhoneOutgoing, Info } from "lucide-react";

const LANG_LABEL: Record<string, string> = {
  english: "English",
  hindi: "Hindi",
  tamil: "Tamil",
  hinglish: "Hinglish",
  other: "Other",
};
const LANG_COLOR: Record<string, string> = {
  english: "#60a5fa",
  hindi: "#f59e0b",
  tamil: "#34d399",
  hinglish: "#a78bfa",
  other: "#94a3b8",
};

export default function BoardMoat() {
  const { data, isLoading } = useBoardMoat();
  const mem = data?.memory;
  const drop = data?.dropRecovery;
  const buckets = (data?.language?.buckets ?? []).filter((b: any) => b.count > 0);
  const langChart = buckets.map((b: any) => ({ name: LANG_LABEL[b.language] ?? b.language, key: b.language, pct: b.pct, count: b.count }));

  const nonEnglishPct = buckets
    .filter((b: any) => b.language !== "english")
    .reduce((a: number, b: any) => a + b.pct, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Product Moat</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The &quot;why us&quot; numbers — pitch-deck slides that update themselves. Last {data?.windowDays ?? 90} days.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Brain className="h-3.5 w-3.5" /> Cross-call memory fired
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono tabular-nums text-primary">
              {isLoading ? "…" : mem?.firedPct != null ? `${mem.firedPct}%` : "—"}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {mem?.firedCalls ?? 0} of {mem?.trackedCalls ?? 0} calls greeted a returning caller
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Languages className="h-3.5 w-3.5" /> Non-English calls
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono tabular-nums">
              {isLoading ? "…" : `${Math.round(nonEnglishPct * 10) / 10}%`}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Tamil / Hindi / Hinglish / other</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <PhoneOutgoing className="h-3.5 w-3.5" /> Drop-calls auto-recovered
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono tabular-nums">
              {isLoading ? "…" : Number(drop?.recoveredCalls ?? 0).toLocaleString("en-IN")}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              of {drop?.droppedCalls ?? 0} dropped ({drop?.recoveredPct ?? 0}%)
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Language mix</CardTitle>
          <CardDescription>
            Share of calls by primary detected language ({data?.language?.total ?? 0} tracked calls).
          </CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {langChart.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No language data yet — recorded from calls after instrumentation shipped.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={langChart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} unit="%" />
                <Tooltip formatter={(v: any, _n, p: any) => [`${v}% (${p?.payload?.count ?? 0} calls)`, "Share"]} />
                <Bar dataKey="pct" name="Share %" radius={[4, 4, 0, 0]}>
                  {langChart.map((d: any) => (
                    <Cell key={d.key} fill={LANG_COLOR[d.key] ?? "#94a3b8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>{data?.note ?? "Memory-fired % and language mix only count calls recorded after instrumentation shipped."}</span>
      </div>
    </div>
  );
}
