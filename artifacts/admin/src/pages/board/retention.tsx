import { Link } from "wouter";
import { useBoardRetention } from "@/hooks/use-admin-api";
import { formatCentsToDollars } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Info } from "lucide-react";

function Kpi({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <Card className={warn ? "border-destructive/50" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold font-mono tabular-nums ${warn ? "text-destructive" : ""}`}>{value}</div>
        {hint ? <p className="text-[11px] text-muted-foreground mt-1">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function BoardRetention() {
  const { data, isLoading } = useBoardRetention();
  const tenants = data?.tenants ?? [];
  const churn = data?.churn;
  const nrr = data?.nrr;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Retention &amp; Health</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Churn early-warning. Any client whose minutes dropped &gt;30% week-over-week glows red — that&apos;s a call you
          make personally.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="At-risk clients"
          value={isLoading ? "…" : String(data?.atRiskCount ?? 0)}
          hint=">30% minutes drop WoW"
          warn={(data?.atRiskCount ?? 0) > 0}
        />
        <Kpi
          label="Logo churn (MoM)"
          value={isLoading ? "…" : `${churn?.logoChurnPct ?? 0}%`}
          hint={`${churn?.churnedLogos ?? 0} of ${churn?.activePrevMonth ?? 0} lost`}
        />
        <Kpi
          label="Revenue churned"
          value={isLoading ? "…" : formatCentsToDollars(churn?.revenueChurnedPaise ?? 0)}
          hint="From logos lost this month"
        />
        <Kpi
          label="Net revenue retention"
          value={isLoading ? "…" : nrr?.nrrPct != null ? `${nrr.nrrPct}%` : "—"}
          hint="Retained clients' usage vs last month"
          warn={nrr?.nrrPct != null && nrr.nrrPct < 100}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Per-tenant usage trend (week over week)
          </CardTitle>
          <CardDescription>Sorted worst-first. Red rows dropped more than 30% in minutes.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">This week (min)</TableHead>
                <TableHead className="text-right">Last week (min)</TableHead>
                <TableHead className="text-right">WoW</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : tenants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No tenant call activity in the last two weeks.
                  </TableCell>
                </TableRow>
              ) : (
                tenants.map((t: any) => (
                  <TableRow key={t.clerkId} className={t.atRisk ? "bg-destructive/10" : undefined}>
                    <TableCell>
                      <Link href={`/users/${t.clerkId}`} className="text-primary text-xs hover:underline">
                        {t.name || t.email || t.clerkId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{t.minutesThisWeek}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{t.minutesPrevWeek}</TableCell>
                    <TableCell
                      className={`text-right font-mono text-xs ${
                        t.wowPct < 0 ? "text-destructive" : t.wowPct > 0 ? "text-emerald-500" : ""
                      }`}
                    >
                      {t.wowPct > 0 ? "+" : ""}
                      {t.wowPct}%
                    </TableCell>
                    <TableCell className="text-right">
                      {t.atRisk ? (
                        <Badge variant="destructive" className="text-[10px]">
                          at risk
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          ok
                        </Badge>
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
        <span>{data?.note ?? "Churn/NRR use recognized usage as the monthly revenue proxy."}</span>
      </div>
    </div>
  );
}
