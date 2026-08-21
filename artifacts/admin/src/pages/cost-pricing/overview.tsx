import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { adminFetch, formatCentsToDollars } from "@/lib/api";
import { SectionSubNav } from "@/components/section-subnav";
import { COST_PRICING_TABS } from "@/lib/nav-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUnitEconomics } from "@/hooks/use-admin-api";
import { useDateRange } from "@/hooks/use-date-range";
import { DateRangeBar } from "@/components/date-range-bar";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { useMemo } from "react";

export function CostPricingLayout({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <SectionSubNav tabs={COST_PRICING_TABS} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export default function CostPricingOverviewPage() {
  const range = useDateRange({ preset: "last30", compare: "none" });
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "pricing", "overview"],
    queryFn: () =>
      adminFetch<{
        activeProviderCosts: number;
        activeCustomerRates: number;
        providerCostVersions: number;
        customerRateVersions: number;
      }>("/pricing/overview"),
  });
  const economics = useUnitEconomics(range.fromParam, range.toParam);
  const k = economics.data?.kpis;

  const costBars = useMemo(
    () =>
      (economics.data?.costBreakdown ?? []).map((r) => ({
        service: r.service.toUpperCase(),
        cost: r.costPaise / 100,
      })),
    [economics.data],
  );

  const dailyCost = useMemo(
    () =>
      (economics.data?.series ?? []).map((d) => ({
        date: d.date.slice(5),
        costPerMin: d.costPerMinPaise / 100,
      })),
    [economics.data],
  );

  const cards = [
    { label: "Active provider costs", value: data?.activeProviderCosts, href: "/cost-pricing/provider-costs" },
    { label: "Active customer rates", value: data?.activeCustomerRates, href: "/cost-pricing/customer-pricing" },
    { label: "Provider cost versions", value: data?.providerCostVersions, href: "/cost-pricing/cost-history" },
    { label: "Customer rate versions", value: data?.customerRateVersions, href: "/cost-pricing/pricing-history" },
  ];

  return (
    <CostPricingLayout
      title="Cost & Pricing"
      subtitle="Source of truth for provider costs and customer prices. New rates are versioned with effective dates — history never rewrites."
    >
      <DateRangeBar range={range} showCompare={false} updatedAt={economics.dataUpdatedAt ? new Date(economics.dataUpdatedAt) : null} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Link key={c.label} href={c.href}>
            <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {c.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono tabular-nums">
                  {isLoading ? "…" : (c.value ?? 0)}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total cost</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">
              {economics.isLoading ? "…" : formatCentsToDollars(k?.variableCostPaise ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cost / min</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">
              {economics.isLoading ? "…" : formatCentsToDollars(k?.costPerMinPaise ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Billable minutes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">
              {economics.isLoading ? "…" : String(k?.billableMinutes ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Gross margin</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">
              {economics.isLoading ? "…" : `${(k?.grossMarginPct ?? 0).toFixed(1)}%`}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily cost / min</CardTitle>
          </CardHeader>
          <CardContent className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyCost}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="costPerMin" name="Cost/min ₹" stroke="#f87171" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost composition</CardTitle>
          </CardHeader>
          <CardContent className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costBars}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="service" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="cost" name="Cost ₹" fill="#f87171" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick links</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/cost-pricing/provider-costs">Set provider cost</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/cost-pricing/customer-pricing">Set customer price</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/cost-pricing/simulator">Profit simulator</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/analytics/unit-economics">Unit economics</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/call-pricing">Legacy call pricing</Link>
          </Button>
        </CardContent>
      </Card>
    </CostPricingLayout>
  );
}
