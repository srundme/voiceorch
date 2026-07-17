import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useBoardPulse, useBoardSettings, useUpdateBoardSettings, type BoardSettings } from "@/hooks/use-admin-api";
import { formatCentsToDollars } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Clock, TrendingUp, Settings2, Info } from "lucide-react";

function Kpi({
  label,
  value,
  hint,
  accent,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
  warn?: boolean;
}) {
  return (
    <Card className={warn ? "border-destructive/50" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold font-mono tabular-nums ${accent ?? ""} ${warn ? "text-destructive" : ""}`}>
          {value}
        </div>
        {hint ? <p className="text-[11px] text-muted-foreground mt-1">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function growthBadge(pct: number | null | undefined) {
  if (pct == null) return <span className="text-muted-foreground text-xs">no prior period</span>;
  const up = pct >= 0;
  return (
    <span className={`text-xs font-medium ${up ? "text-emerald-500" : "text-destructive"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct)}% MoM
    </span>
  );
}

function BoardInputs() {
  const { data } = useBoardSettings();
  const update = useUpdateBoardSettings();
  const [form, setForm] = useState<BoardSettings | null>(null);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  if (!form) return null;

  const rupeeField = (label: string, key: keyof BoardSettings, hint?: string) => (
    <label className="space-y-1 block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type="number"
        min={0}
        value={Math.round((Number(form[key]) || 0) / 100)}
        onChange={(e) => setForm({ ...form, [key]: Math.max(0, Number(e.target.value)) * 100 })}
        className="h-8 text-sm"
      />
      {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
    </label>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings2 className="h-4 w-4" /> Board inputs (manual)
        </CardTitle>
        <CardDescription>
          Figures with no source data. Enter rupees; used for cash runway, all-in cost/min, CAC and the flagship tracker.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {rupeeField("Cash on hand (₹)", "cashOnHandPaise")}
          {rupeeField("Monthly burn (₹)", "monthlyBurnPaise")}
          {rupeeField("CAC per client (₹)", "cacPaise")}
          {rupeeField("Telephony cost / min (₹)", "telephonyCostPaisePerMin", "Vobiz per-minute cost added to COGS")}
          <label className="space-y-1 block">
            <span className="text-xs text-muted-foreground">Flagship client (clerk id)</span>
            <Input
              value={form.flagshipClerkId ?? ""}
              onChange={(e) => setForm({ ...form, flagshipClerkId: e.target.value || null })}
              placeholder="user_..."
              className="h-8 text-sm font-mono"
            />
          </label>
          <label className="space-y-1 block">
            <span className="text-xs text-muted-foreground">Flagship goal (calls / month)</span>
            <Input
              type="number"
              min={0}
              value={form.flagshipGoal}
              onChange={(e) => setForm({ ...form, flagshipGoal: Math.max(0, Number(e.target.value)) })}
              className="h-8 text-sm"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={update.isPending} onClick={() => update.mutate(form)}>
            {update.isPending ? "Saving…" : "Save inputs"}
          </Button>
          {update.isSuccess ? <span className="text-xs text-emerald-500">Saved</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function BoardPulse() {
  const { data, isLoading } = useBoardPulse();
  const m = data?.margin;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Company Pulse</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The one-screen daily open. Minutes is the north star — everything else is commentary.
        </p>
      </div>

      {/* North star */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Minutes called today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold font-mono tabular-nums text-primary">
              {isLoading ? "…" : Number(data?.minutes?.today ?? 0).toLocaleString("en-IN")}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Real users only</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Minutes this month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold font-mono tabular-nums">
              {isLoading ? "…" : Number(data?.minutes?.month ?? 0).toLocaleString("en-IN")}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Month-to-date</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> MRR (usage run-rate)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">
              {isLoading ? "…" : formatCentsToDollars(data?.mrr?.currentPaise ?? 0)}
            </div>
            <p className="mt-1">{growthBadge(data?.mrr?.growthPct)}</p>
          </CardContent>
        </Card>

        <Kpi
          label="Gross margin / min"
          value={isLoading ? "…" : formatCentsToDollars(m?.grossMarginPerMinPaise ?? 0)}
          hint={
            m
              ? `₹${((m.revenuePerMinPaise ?? 0) / 100).toFixed(2)}/min rev − ₹${((m.costPerMinPaise ?? 0) / 100).toFixed(2)}/min cost · ${m.marginPct ?? "—"}%`
              : undefined
          }
          accent={(m?.grossMarginPerMinPaise ?? 0) >= 0 ? "text-emerald-500" : "text-destructive"}
          warn={(m?.grossMarginPerMinPaise ?? 0) < 0}
        />

        <Kpi
          label="Paying vs POC tenants"
          value={isLoading ? "…" : `${data?.tenants?.paying ?? 0} / ${data?.tenants?.poc ?? 0}`}
          hint={`${data?.tenants?.totalReal ?? 0} real accounts · paying = ever topped up`}
        />

        <Kpi
          label="Cash runway"
          value={
            isLoading
              ? "…"
              : data?.runway?.months != null
                ? `${data.runway.months} mo`
                : "set burn"
          }
          hint={
            data?.runway?.months != null
              ? `${formatCentsToDollars(data.runway.cashOnHandPaise)} ÷ ${formatCentsToDollars(data.runway.monthlyBurnPaise)}/mo`
              : "Enter cash & burn below"
          }
          warn={data?.runway?.months != null && data.runway.months < 6}
        />
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          {data?.note ??
            "COGS is provider usage converted USD→INR; telephony cost/min is admin-entered. Margin is approximate."}{" "}
          Deeper cuts on <Link href="/board/unit-economics" className="text-primary hover:underline">Unit Economics</Link>,{" "}
          <Link href="/board/growth" className="text-primary hover:underline">Growth</Link> and{" "}
          <Link href="/board/retention" className="text-primary hover:underline">Retention</Link>.
        </span>
      </div>

      <BoardInputs />
    </div>
  );
}
