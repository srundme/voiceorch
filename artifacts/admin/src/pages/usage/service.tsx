import { useState } from "react";
import { UsageSubNav, UsagePageHeader } from "@/components/usage-layout";
import { useUsageByService, microsToUsd, type ServiceKey } from "@/hooks/use-usage-monitor";
import { useChartTheme } from "@/hooks/use-chart-theme";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mic, Brain, Volume2, Activity, AlertTriangle } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const RANGE_OPTIONS = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

const META: Record<ServiceKey, { label: string; description: string; icon: React.ElementType }> = {
  stt: { label: "STT", description: "Speech to Text provider & model breakdown", icon: Mic },
  llm: { label: "LLM", description: "Language model usage by provider & model", icon: Brain },
  tts: { label: "TTS", description: "Text to Speech voices & providers", icon: Volume2 },
};

export default function ServicePage({ service }: { service: ServiceKey }) {
  const [days, setDays] = useState(30);
  const [providerFilter, setProviderFilter] = useState<string>("");
  const [modelFilter, setModelFilter] = useState<string>("");
  const [userIdFilter, setUserIdFilter] = useState<string>("");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("");
  const { data, isLoading } = useUsageByService(service, {
    days,
    provider: providerFilter || null,
    model: modelFilter || null,
    userId: userIdFilter || null,
    workspaceId: workspaceFilter || null,
  });
  const ct = useChartTheme();
  const meta = META[service];
  const Icon = meta.icon;
  const serviceColor = ct.serviceColors[service];
  const allProviders = Array.from(new Set((data?.providers ?? []).map((p) => p.provider)));
  const allModels = Array.from(
    new Set(
      (data?.providers ?? []).flatMap((p) =>
        p.models.map((m) => m.model).filter((m) => m && m !== "default"),
      ),
    ),
  );

  const tooltipStyle = {
    backgroundColor: ct.tooltipBg,
    border: `1px solid ${ct.tooltipBorder}`,
    borderRadius: 6,
    color: ct.tooltipText,
    boxShadow: ct.tooltipShadow,
    fontSize: 12,
  };

  return (
    <div className="space-y-6">
      <UsagePageHeader
        title={`${meta.label} usage`}
        subtitle={meta.description}
        actions={
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[140px]" data-testid="select-range"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <UsageSubNav />

      <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3">
        <FilterField label="Provider">
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-xs"
            data-testid="filter-provider"
          >
            <option value="">All</option>
            {allProviders.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </FilterField>
        <FilterField label="Model">
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-xs"
            data-testid="filter-model"
          >
            <option value="">All</option>
            {allModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </FilterField>
        <FilterField label="User ID">
          <input
            type="text"
            placeholder="user_…"
            value={userIdFilter}
            onChange={(e) => setUserIdFilter(e.target.value)}
            className="h-9 w-40 rounded-md border border-input bg-background px-2 text-xs"
            data-testid="filter-userid"
          />
        </FilterField>
        <FilterField label="Workspace">
          <input
            type="text"
            placeholder="workspace…"
            value={workspaceFilter}
            onChange={(e) => setWorkspaceFilter(e.target.value)}
            className="h-9 w-40 rounded-md border border-input bg-background px-2 text-xs"
            data-testid="filter-workspace"
          />
        </FilterField>
        {(providerFilter || modelFilter || userIdFilter || workspaceFilter) && (
          <button
            onClick={() => { setProviderFilter(""); setModelFilter(""); setUserIdFilter(""); setWorkspaceFilter(""); }}
            className="ml-auto h-9 rounded-md border border-input bg-background px-3 text-xs hover:bg-muted"
            data-testid="filter-reset"
          >
            Reset
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label="Spend" value={microsToUsd(data?.kpis.usedMicros ?? 0)} icon={Icon} accent={serviceColor} />
        <Kpi label="Allocated" value={microsToUsd(data?.kpis.allocatedMicros ?? 0)} icon={Activity} />
        <Kpi label="Events" value={(data?.kpis.eventCount ?? 0).toLocaleString()} icon={Activity} />
        <Kpi
          label="Failed"
          value={(data?.kpis.failedCount ?? 0).toLocaleString()}
          icon={AlertTriangle}
          warning={!!data && data.kpis.failedCount > 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Provider share</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {(data?.providers ?? []).length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={(data?.providers ?? []).map((p) => ({ name: p.provider, value: p.usedMicros / 1_000_000 }))}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {(data?.providers ?? []).map((_, i) => (
                      <Cell key={i} fill={ct.pieColors[i % ct.pieColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => `$${v.toFixed(4)}`} contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Model share</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {(() => {
              const models = (data?.providers ?? []).flatMap((p) =>
                p.models.map((m) => ({ name: `${p.provider}/${m.model}`, value: m.costMicros / 1_000_000 })),
              );
              if (models.length === 0) return <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</p>;
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={models} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                      {models.map((_, i) => <Cell key={i} fill={ct.pieColors[i % ct.pieColors.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `$${v.toFixed(4)}`} contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Trend (cost in USD)</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="day">
            <TabsList>
              <TabsTrigger value="day">Daily</TabsTrigger>
              <TabsTrigger value="week">Weekly</TabsTrigger>
              <TabsTrigger value="month">Monthly</TabsTrigger>
            </TabsList>
            {(["day", "week", "month"] as const).map((k) => {
              const points =
                k === "day" ? data?.dailyTrend : k === "week" ? data?.weeklyTrend : data?.monthlyTrend;
              return (
                <TabsContent key={k} value={k} className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={(points ?? []).map((p) => ({ ...p, cost: p.costMicros / 1_000_000 }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                      <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: ct.tickColor }} />
                      <YAxis tick={{ fontSize: 11, fill: ct.tickColor }} />
                      <Tooltip formatter={(v: number) => `$${v.toFixed(4)}`} contentStyle={tooltipStyle} />
                      <Bar dataKey="cost" fill={serviceColor} />
                    </BarChart>
                  </ResponsiveContainer>
                </TabsContent>
              );
            })}
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Providers & models</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (data?.providers ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No usage in this window.</p>
          ) : (
            <div className="space-y-6">
              {data!.providers.map((p) => {
                const pct = p.allocatedMicros > 0 ? Math.min(100, (p.usedMicros / p.allocatedMicros) * 100) : 0;
                return (
                  <div key={p.provider} data-testid={`provider-${p.provider}`} className="space-y-3 rounded-md border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold capitalize">{p.provider}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.eventCount.toLocaleString()} events ·{" "}
                          <span className={p.failedCount > 0 ? "text-red-400" : ""}>{p.failedCount} failed</span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{microsToUsd(p.usedMicros)}</p>
                        <p className="text-xs text-muted-foreground">
                          of {microsToUsd(p.allocatedMicros)} allocated
                        </p>
                      </div>
                    </div>
                    {p.allocatedMicros > 0 ? (
                      <div>
                        <Progress value={pct} className="h-1.5" />
                        <p className="mt-1 text-[10px] text-muted-foreground">{pct.toFixed(1)}% used</p>
                      </div>
                    ) : null}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Model</TableHead>
                          <TableHead className="text-right">Events</TableHead>
                          {service === "llm" && <TableHead className="text-right">Input tok</TableHead>}
                          {service === "llm" && <TableHead className="text-right">Output tok</TableHead>}
                          {service === "stt" && <TableHead className="text-right">Audio sec</TableHead>}
                          {service === "tts" && <TableHead className="text-right">Characters</TableHead>}
                          <TableHead className="text-right">Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {p.models.map((m) => (
                          <TableRow key={m.model}>
                            <TableCell className="font-mono text-xs">{m.model}</TableCell>
                            <TableCell className="text-right">{m.eventCount.toLocaleString()}</TableCell>
                            {service === "llm" && <TableCell className="text-right">{m.inputTokens.toLocaleString()}</TableCell>}
                            {service === "llm" && <TableCell className="text-right">{m.outputTokens.toLocaleString()}</TableCell>}
                            {service === "stt" && <TableCell className="text-right">{m.audioSeconds.toLocaleString()}</TableCell>}
                            {service === "tts" && <TableCell className="text-right">{m.characters.toLocaleString()}</TableCell>}
                            <TableCell className="text-right">{microsToUsd(m.costMicros)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Kpi({
  label, value, icon: Icon, accent, warning,
}: { label: string; value: string; icon: React.ElementType; accent?: string; warning?: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
      </CardHeader>
      <CardContent>
        <p className={`text-xl font-bold ${warning ? "text-red-400" : ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
