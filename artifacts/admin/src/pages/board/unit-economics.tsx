import { useMemo } from "react";
import { Link } from "wouter";
import { useBoardUnitEconomics } from "@/hooks/use-admin-api";
import { formatCentsToDollars } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Info } from "lucide-react";

function rupeesPerMin(paise: number) {
  return `₹${((paise ?? 0) / 100).toFixed(2)}`;
}

export default function BoardUnitEconomics() {
  const { data, isLoading } = useBoardUnitEconomics();

  // Stack provider cost/min by provider, split into service series.
  const stack = useMemo(() => {
    const providers = data?.providers ?? [];
    const byProvider = new Map<string, any>();
    for (const p of providers) {
      const row = byProvider.get(p.provider) ?? { provider: p.provider };
      row[p.service] = (row[p.service] ?? 0) + p.costPerMinPaise / 100;
      byProvider.set(p.provider, row);
    }
    return [...byProvider.values()];
  }, [data]);

  const services = useMemo(() => {
    const set = new Set<string>();
    for (const p of data?.providers ?? []) set.add(p.service);
    return [...set];
  }, [data]);

  const serviceColor: Record<string, string> = {
    stt: "#60a5fa",
    llm: "#a78bfa",
    tts: "#34d399",
    telephony: "#f59e0b",
  };

  const cac = data?.cacLtv;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Unit Economics Deep-Dive</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monthly review — who&apos;s eating your margin, who&apos;s unprofitable, and CAC vs LTV.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              All-in cost / min (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">
              {isLoading ? "…" : rupeesPerMin(data?.totalCostPerMinPaise ?? 0)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{data?.minutes30 ?? 0} min · sum of provider stack</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">LTV per paying client</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">
              {isLoading ? "…" : formatCentsToDollars(cac?.ltvPaise ?? 0)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Avg lifetime usage · {cac?.payers ?? 0} payers</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">LTV : CAC</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">
              {isLoading ? "…" : cac?.ratio != null ? `${cac.ratio}×` : "set CAC"}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {cac?.cacPaise ? `CAC ${formatCentsToDollars(cac.cacPaise)}` : "Enter CAC in Board inputs (Pulse)"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost / min by provider (30d)</CardTitle>
          <CardDescription>Stacked by service. Telephony is the admin-entered line.</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {stack.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No provider usage in range.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stack}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="provider" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit="₹" />
                <Tooltip formatter={(v: any) => `₹${Number(v).toFixed(3)}/min`} />
                <Legend />
                {services.map((s) => (
                  <Bar key={s} dataKey={s} stackId="cost" name={s.toUpperCase()} fill={serviceColor[s] ?? "#94a3b8"} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Margin by tenant (90d)</CardTitle>
          <CardDescription>Worst-first. Red rows are unprofitable at current pricing.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">COGS</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : (data?.marginByTenant ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No tenant usage in range.
                  </TableCell>
                </TableRow>
              ) : (
                (data?.marginByTenant ?? []).map((t: any) => (
                  <TableRow key={t.clerkId} className={t.unprofitable ? "bg-destructive/10" : undefined}>
                    <TableCell>
                      <Link href={`/users/${t.clerkId}`} className="text-primary text-xs hover:underline">
                        {t.name || t.email || t.clerkId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatCentsToDollars(t.revenuePaise)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatCentsToDollars(t.cogsPaise)}</TableCell>
                    <TableCell
                      className={`text-right font-mono text-xs ${t.marginPaise < 0 ? "text-destructive" : "text-emerald-500"}`}
                    >
                      {formatCentsToDollars(t.marginPaise)}
                    </TableCell>
                    <TableCell className="text-right">
                      {t.unprofitable ? (
                        <Badge variant="destructive" className="text-[10px]">
                          {t.marginPct ?? "—"}%
                        </Badge>
                      ) : (
                        <span className="font-mono text-xs">{t.marginPct ?? "—"}%</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>{data?.note ?? "Cost/min from usage_events (USD→INR @ FX); telephony admin-entered. LTV = avg lifetime recognized per paying user."}</span>
      </div>
    </div>
  );
}
