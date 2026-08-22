import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { Link } from "wouter";
import {
  useFinanceAuditSummary,
  useFinanceLedger,
  useFinanceDailyClose,
  useFinanceRazorpayGaps,
  useFinanceEconomics,
  useFinanceCohorts,
  useFinanceInvestor,
  downloadFinanceCsv,
} from "@/hooks/use-admin-api";
import { formatCentsToDollars } from "@/lib/api";
import { SectionSubNav } from "@/components/section-subnav";
import { MONEY_TABS } from "@/lib/nav-config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

function defaultFrom() {
  return format(subDays(new Date(), 30), "yyyy-MM-dd");
}
function defaultTo() {
  return format(new Date(), "yyyy-MM-dd");
}

function Kpi({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <Card className={warn ? "border-destructive/50" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold font-mono tabular-nums ${warn ? "text-destructive" : ""}`}>
          {value}
        </div>
        {hint ? <p className="text-[11px] text-muted-foreground mt-1">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function Finance() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [ledgerTab, setLedgerTab] = useState("all");
  const [mainTab, setMainTab] = useState("audit");

  const { data: audit, isLoading: auditLoading } = useFinanceAuditSummary(from, to);
  const { data: ledger, isLoading: ledgerLoading } = useFinanceLedger({
    from,
    to,
    tab: ledgerTab,
    limit: 100,
  });
  const { data: daily } = useFinanceDailyClose(from, to);
  const { data: gaps } = useFinanceRazorpayGaps();
  const { data: economics, isLoading: econLoading } = useFinanceEconomics(from, to);
  const { data: cohorts } = useFinanceCohorts();
  const { data: investor, isLoading: invLoading } = useFinanceInvestor();

  const econChart = useMemo(
    () =>
      (economics?.series ?? []).map((d: any) => ({
        day: d.day.slice(5),
        revenue: d.revenuePaise / 100,
        cogs: d.cogsPaiseApprox / 100,
        cashIn: d.cashInPaise / 100,
        margin: d.marginPaiseApprox / 100,
      })),
    [economics],
  );

  const trailingChart = useMemo(
    () =>
      (investor?.trailingMonths ?? []).map((m: any) => ({
        month: m.month,
        cashIn: m.cashInPaise / 100,
        recognized: m.recognizedPaise / 100,
        payers: m.payingUsers,
      })),
    [investor],
  );

  const exportLedger = async () => {
    await downloadFinanceCsv(
      `/finance/export.csv?kind=ledger&from=${from}&to=${to}`,
      `snapserve-ledger-${from}.csv`,
    );
  };
  const exportDaily = async () => {
    await downloadFinanceCsv(
      `/finance/export.csv?kind=daily-close&from=${from}&to=${to}`,
      `snapserve-daily-close-${from}.csv`,
    );
  };

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={MONEY_TABS} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Finance &amp; Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Audit ledger, unit economics, and investor headline metrics. Amounts are INR.
            Cash-in = rupees received (GST-inclusive topups + card-paid numbers). Wallet-paid DIDs are not new cash.
            Recognized = call usage plus phone / WhatsApp number fees.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-36 text-xs" />
          <span className="text-xs text-muted-foreground">→</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-36 text-xs" />
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={exportLedger}>
            <Download className="h-3.5 w-3.5" /> Ledger CSV
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={exportDaily}>
            <Download className="h-3.5 w-3.5" /> Daily close CSV
          </Button>
        </div>
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList>
          <TabsTrigger value="audit">Audit ledger</TabsTrigger>
          <TabsTrigger value="economics">Unit economics</TabsTrigger>
          <TabsTrigger value="investor">Investor pack</TabsTrigger>
        </TabsList>

        {/* ─── AUDIT ─────────────────────────────────────────────── */}
        <TabsContent value="audit" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi
              label="Cash-in"
              value={auditLoading ? "…" : formatCentsToDollars(audit?.period?.cashCollectedPaise ?? audit?.period?.cashCollectedEstPaise ?? 0)}
              hint={
                auditLoading
                  ? "Topups + GST + card-paid numbers"
                  : `Topups ${formatCentsToDollars(audit?.period?.cashInTopupGrossPaise ?? 0)} · Numbers ${formatCentsToDollars(audit?.period?.cashInCardDidPaise ?? 0)}`
              }
            />
            <Kpi
              label="Wallet credited"
              value={auditLoading ? "…" : formatCentsToDollars(audit?.period?.cashInWalletCreditPaise ?? 0)}
              hint="Successful topups in range (pre-GST)"
            />
            <Kpi
              label="Recognized revenue"
              value={auditLoading ? "…" : formatCentsToDollars(audit?.period?.recognizedRevenuePaise ?? (audit?.period?.recognizedUsagePaise ?? 0) + (audit?.period?.phoneDebitPaise ?? 0))}
              hint={
                auditLoading
                  ? "Calls + phone / WhatsApp numbers"
                  : `Calls ${formatCentsToDollars(audit?.period?.recognizedUsagePaise ?? 0)} · Numbers ${formatCentsToDollars(audit?.period?.phoneDebitPaise ?? 0)}`
              }
            />
            <Kpi
              label="Wallet liability"
              value={auditLoading ? "…" : formatCentsToDollars(audit?.liability?.userWalletSumPaise ?? 0)}
              hint={
                audit?.liability?.balanced
                  ? "Balanced vs ledger rollforward"
                  : `Gap ${formatCentsToDollars(audit?.liability?.gapPaise ?? 0)} vs expected`
              }
              warn={audit && !audit.liability?.balanced}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Kpi
              label="GST est. (period)"
              value={formatCentsToDollars(audit?.period?.gstEstimatedPaise ?? 0)}
              hint="18% GST on successful topup base (not on card-paid numbers)"
            />
            <Kpi
              label="Phone / WhatsApp numbers"
              value={formatCentsToDollars(audit?.period?.phoneDebitPaise ?? 0)}
              hint="Included in recognized revenue"
            />
            <Kpi
              label="Pending / failed topups"
              value={`${audit?.period?.pendingTopups ?? 0} / ${audit?.period?.failedTopups ?? 0}`}
              hint="In selected date range"
            />
          </div>

          {audit ? (
            !audit.liability?.balanced ? (
              <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  Liability gap of {formatCentsToDollars(audit.liability.gapPaise)} between Σ wallets (
                  {formatCentsToDollars(audit.liability.userWalletSumPaise)}) and ledger-implied (
                  {formatCentsToDollars(audit.liability.expectedFromLedgerPaise)}). Investigate
                  orphaned adjustments or FX migration residue.
                </div>
              </div>
            ) : (
              <div className="flex gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                Wallet liability aligns with lifetime ledger rollforward (within ₹1).
              </div>
            )
          ) : null}

          {(gaps?.rows?.length ?? 0) > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Razorpay gaps (&gt;24h unresolved)</CardTitle>
                <CardDescription>
                  Topups not in completed/success older than a day — reconcile with Razorpay dashboard.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Order / Payment</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {gaps.rows.slice(0, 20).map((tx: any) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-xs font-mono">
                          {format(new Date(tx.createdAt), "MMM d HH:mm")}
                        </TableCell>
                        <TableCell>
                          {tx.userClerkId ? (
                            <Link href={`/users/${tx.userClerkId}`} className="text-primary text-xs hover:underline">
                              {tx.userEmail || tx.userClerkId}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="destructive" className="text-[10px]">
                            {tx.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[10px] font-mono text-muted-foreground truncate max-w-[200px]">
                          {tx.razorpayOrderId || "—"} / {tx.razorpayPaymentId || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatCentsToDollars(tx.amountCents)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Ledger</CardTitle>
                <CardDescription>Filter by class · last 100 rows in range</CardDescription>
              </div>
              <div className="flex flex-wrap gap-1">
                {[
                  ["all", "All"],
                  ["cash_in", "Cash-in"],
                  ["recognized", "Revenue"],
                  ["phones", "Numbers"],
                  ["adjustments", "Adjustments"],
                ].map(([id, label]) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={ledgerTab === id ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setLedgerTab(id)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : (ledger?.rows?.length ?? 0) === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No rows
                      </TableCell>
                    </TableRow>
                  ) : (
                    ledger!.rows.map((tx: any) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {format(new Date(tx.createdAt), "MMM d, yyyy HH:mm")}
                        </TableCell>
                        <TableCell>
                          {tx.userClerkId ? (
                            <Link
                              href={`/users/${tx.userClerkId}`}
                              className="text-primary hover:underline text-xs block truncate max-w-[180px]"
                            >
                              {tx.userEmail || tx.userClerkId}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-[10px]">
                            {tx.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              tx.status === "completed" || tx.status === "success"
                                ? "default"
                                : tx.status === "failed"
                                  ? "destructive"
                                  : "secondary"
                            }
                            className="capitalize text-[10px]"
                          >
                            {tx.status || "unknown"}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className="text-xs truncate max-w-[240px]"
                          title={tx.description || undefined}
                        >
                          {tx.description || "—"}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono text-xs tabular-nums ${
                            tx.amountCents > 0
                              ? "text-emerald-400"
                              : tx.amountCents < 0
                                ? "text-destructive"
                                : ""
                          }`}
                        >
                          {tx.amountCents > 0 ? "+" : ""}
                          {formatCentsToDollars(tx.amountCents)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {ledger?.total != null ? (
                <p className="text-[11px] text-muted-foreground px-4 py-2 border-t">
                  Showing {ledger.rows.length} of {ledger.total.toLocaleString()} ·{" "}
                  <Link href="/operations/audit" className="text-primary hover:underline">
                    Admin audit logs
                  </Link>
                </p>
              ) : null}
            </CardContent>
          </Card>

          {(daily?.days?.length ?? 0) > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily close</CardTitle>
                <CardDescription>Day buckets for CA / bookkeeping</CardDescription>
              </CardHeader>
              <CardContent className="p-0 max-h-72 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead className="text-right">Topups</TableHead>
                      <TableHead className="text-right">GST est.</TableHead>
                      <TableHead className="text-right">Card numbers</TableHead>
                      <TableHead className="text-right">Cash-in</TableHead>
                      <TableHead className="text-right">Call debit</TableHead>
                      <TableHead className="text-right">Phone</TableHead>
                      <TableHead className="text-right">Adjust</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...(daily?.days ?? [])].reverse().map((d: any) => (
                      <TableRow key={d.day}>
                        <TableCell className="font-mono text-xs">{d.day}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatCentsToDollars(d.topupsSuccessPaise)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatCentsToDollars(d.gstEstimatedPaise)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatCentsToDollars(d.cardDidCashPaise ?? 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatCentsToDollars(d.cashCollectedPaise ?? (d.topupsSuccessPaise ?? 0) + (d.gstEstimatedPaise ?? 0))}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatCentsToDollars(d.callDebitPaise)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatCentsToDollars(d.phoneDebitPaise)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatCentsToDollars(d.adjustmentsPaise)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {/* ─── ECONOMICS ─────────────────────────────────────────── */}
        <TabsContent value="economics" className="space-y-6 mt-4">
          <div className="flex gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Revenue = call usage + phone / WhatsApp number fees. COGS ≈ provider usage (USD micros → INR @ FX{" "}
            {economics?.usdToInrRate ?? "…"}). Margin is approximate.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Kpi
              label="Cash-in"
              value={econLoading ? "…" : formatCentsToDollars(economics?.totals?.cashInPaise ?? 0)}
              hint="GST-inclusive topups + card-paid numbers"
            />
            <Kpi
              label="Recognized revenue"
              value={econLoading ? "…" : formatCentsToDollars(economics?.totals?.revenuePaise ?? 0)}
            />
            <Kpi
              label="COGS (approx)"
              value={econLoading ? "…" : formatCentsToDollars(economics?.totals?.cogsPaiseApprox ?? 0)}
            />
            <Kpi
              label="Gross margin"
              value={
                econLoading
                  ? "…"
                  : `${formatCentsToDollars(economics?.totals?.marginPaiseApprox ?? 0)} (${
                      economics?.totals?.marginPct ?? "—"
                    }%)`
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily revenue vs COGS</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={econChart}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" name="Revenue ₹" stroke="#34d399" dot={false} />
                  <Line type="monotone" dataKey="cogs" name="COGS ₹" stroke="#f87171" dot={false} />
                  <Line type="monotone" dataKey="cashIn" name="Cash-in ₹" stroke="#60a5fa" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Signup cohorts (monetization)</CardTitle>
              <CardDescription>Last ~16 weeks · paid conversion + D7/D30 call spend</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cohort week</TableHead>
                    <TableHead className="text-right">Signups</TableHead>
                    <TableHead className="text-right">Ever paid</TableHead>
                    <TableHead className="text-right">Conv %</TableHead>
                    <TableHead className="text-right">Avg D7 spend</TableHead>
                    <TableHead className="text-right">Avg D30 spend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(cohorts?.cohorts ?? []).map((c: any) => (
                    <TableRow key={c.cohortWeek}>
                      <TableCell className="font-mono text-xs">{c.cohortWeek}</TableCell>
                      <TableCell className="text-right text-xs">{c.signups}</TableCell>
                      <TableCell className="text-right text-xs">{c.everToppedUp}</TableCell>
                      <TableCell className="text-right text-xs">{c.paidConversionPct}%</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatCentsToDollars(c.avgD7SpendPaise)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatCentsToDollars(c.avgD30SpendPaise)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── INVESTOR ──────────────────────────────────────────── */}
        <TabsContent value="investor" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi
              label="Lifetime cash-in"
              value={invLoading ? "…" : formatCentsToDollars(investor?.headline?.cashCollectedLifetimePaise ?? 0)}
              hint={
                invLoading
                  ? "GST-inclusive topups + card-paid numbers"
                  : `Topups ${formatCentsToDollars((investor?.headline?.cashCollectedLifetimePaise ?? 0) - (investor?.headline?.cashInCardDidPaise ?? 0))} · Numbers ${formatCentsToDollars(investor?.headline?.cashInCardDidPaise ?? 0)}`
              }
            />
            <Kpi
              label="Wallet liability"
              value={invLoading ? "…" : formatCentsToDollars(investor?.headline?.walletLiabilityPaise ?? 0)}
              hint="Deferred prepaid balance"
            />
            <Kpi
              label="Recognized lifetime"
              value={
                invLoading ? "…" : formatCentsToDollars(investor?.headline?.recognizedUsageLifetimePaise ?? 0)
              }
              hint="Calls + phone / WhatsApp number fees"
            />
            <Kpi
              label="30d margin"
              value={
                invLoading
                  ? "…"
                  : `${formatCentsToDollars(investor?.headline?.last30d?.marginPaiseApprox ?? 0)} (${
                      investor?.headline?.last30d?.marginPct ?? "—"
                    }%)`
              }
              hint={`${investor?.headline?.last30d?.minutes ?? 0} min · ${
                investor?.headline?.last30d?.activePayers ?? 0
              } payers`}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Kpi
              label="Active payers (30d)"
              value={String(investor?.headline?.last30d?.activePayers ?? "—")}
              hint={`Prev 30d: ${investor?.headline?.last30d?.prevActivePayers ?? "—"}`}
            />
            <Kpi
              label="Failed payments (30d)"
              value={String(investor?.headline?.last30d?.failedPayments ?? "—")}
            />
            <Kpi
              label="Refunds (30d)"
              value={formatCentsToDollars(investor?.headline?.last30d?.refundPaise ?? 0)}
              hint={`${investor?.headline?.last30d?.refundCount ?? 0} txns`}
            />
          </div>

          {investor?.vobiz ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Telephony float (VoBiz)</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <p>
                  Balance:{" "}
                  <span className="font-mono font-semibold">
                    ₹{Number(investor.vobiz.balanceInr ?? 0).toLocaleString("en-IN")}
                  </span>{" "}
                  · Status: <Badge variant="outline">{investor.vobiz.status ?? "—"}</Badge>
                </p>
                {investor.vobiz.recommendedInr != null ? (
                  <p className="text-xs text-muted-foreground">
                    Recommended ≈ ₹{Number(investor.vobiz.recommendedInr).toLocaleString("en-IN")}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trailing months</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trailingChart}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="₹" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="p" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="₹" type="monotone" dataKey="cashIn" name="Cash-in ₹" stroke="#60a5fa" dot={false} />
                  <Line
                    yAxisId="₹"
                    type="monotone"
                    dataKey="recognized"
                    name="Recognized ₹"
                    stroke="#34d399"
                    dot={false}
                  />
                  <Line yAxisId="p" type="monotone" dataKey="payers" name="Payers" stroke="#fbbf24" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Concentration (90d)</CardTitle>
              <CardDescription>
                Top 10 spend share: {investor?.concentration?.top10SharePct ?? "—"}% of call usage
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Topups</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(investor?.concentration?.topPayers ?? []).map((u: any) => (
                    <TableRow key={u.clerkId}>
                      <TableCell>
                        <Link href={`/users/${u.clerkId}`} className="text-primary text-xs hover:underline">
                          {u.email || u.name || u.clerkId}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatCentsToDollars(u.spend90dPaise)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatCentsToDollars(u.topup90dPaise)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
