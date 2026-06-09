import React, { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend
} from "recharts";
import { useStore } from "@/lib/store";

const WEEKLY_DATA = [
  { week: "W1 May", calls: 8420, conversions: 3612 },
  { week: "W2 May", calls: 9100, conversions: 3913 },
  { week: "W3 May", calls: 11200, conversions: 4928 },
  { week: "W4 May", calls: 10600, conversions: 4558 },
  { week: "W1 Jun", calls: 13400, conversions: 5830 },
  { week: "W2 Jun", calls: 14190, conversions: 6410 },
];

export function Analytics() {
  const { agents, isLoaded } = useStore();
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");

  if (!isLoaded) return null;

  const publishedAgents = agents.filter(a => a.totalCalls > 0);
  const totalCalls = agents.reduce((s, a) => s + a.totalCalls, 0);
  const totalConverted = agents.reduce((s, a) => s + Math.round(a.totalCalls * a.conversionRate / 100), 0);
  const avgConversion = publishedAgents.length > 0
    ? publishedAgents.reduce((s, a) => s + a.conversionRate, 0) / publishedAgents.length
    : 0;
  const totalKB = agents.reduce((s, a) => s + a.kbEntries, 0);

  const companyData = [...publishedAgents]
    .sort((a, b) => b.totalCalls - a.totalCalls)
    .map(a => ({ name: a.companyName.split(' ')[0], calls: a.totalCalls, rate: a.conversionRate }));

  const conversionData = [...publishedAgents]
    .sort((a, b) => b.conversionRate - a.conversionRate)
    .map(a => ({ name: a.companyName.split(' ')[0], rate: a.conversionRate }));

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground mt-1">Platform-wide performance metrics across all agents.</p>
        </div>
        <div className="flex gap-2">
          {(["7d", "30d", "90d"] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${period === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total Calls Made" value={totalCalls.toLocaleString()} delta="+18%" positive />
        <MetricCard label="Policies Converted" value={totalConverted.toLocaleString()} delta="+12%" positive />
        <MetricCard label="Avg Conversion Rate" value={`${avgConversion.toFixed(1)}%`} delta="+2.3pp" positive />
        <MetricCard label="Total KB Entries" value={totalKB.toString()} delta={`${agents.length} agents`} positive={false} neutral />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="font-semibold mb-1">Weekly Call Volume vs Conversions</h2>
          <p className="text-xs text-muted-foreground mb-4">Platform-wide trends over 6 weeks</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={WEEKLY_DATA} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217.2 32.6% 17.5%)" />
              <XAxis dataKey="week" tick={{ fill: 'hsl(215 20.2% 65.1%)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'hsl(215 20.2% 65.1%)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: 'hsl(222.2 84% 4.9%)', border: '1px solid hsl(217.2 32.6% 17.5%)', borderRadius: 8, color: 'hsl(210 40% 98%)' }} />
              <Legend wrapperStyle={{ fontSize: 12, color: 'hsl(215 20.2% 65.1%)' }} />
              <Line type="monotone" dataKey="calls" stroke="hsl(217.2 91.2% 59.8%)" strokeWidth={2} dot={false} name="Calls" />
              <Line type="monotone" dataKey="conversions" stroke="#10b981" strokeWidth={2} dot={false} name="Converted" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="font-semibold mb-1">Calls by Company</h2>
          <p className="text-xs text-muted-foreground mb-4">Top performing companies by volume</p>
          {companyData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No published agents with calls yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={companyData} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(217.2 32.6% 17.5%)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'hsl(215 20.2% 65.1%)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={70} tick={{ fill: 'hsl(215 20.2% 65.1%)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'hsl(222.2 84% 4.9%)', border: '1px solid hsl(217.2 32.6% 17.5%)', borderRadius: 8, color: 'hsl(210 40% 98%)' }} />
                <Bar dataKey="calls" fill="hsl(217.2 91.2% 59.8%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="font-semibold mb-1">Conversion Rate by Agent</h2>
        <p className="text-xs text-muted-foreground mb-4">% of calls that resulted in a policy sale or renewal</p>
        {conversionData.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No published agents with calls yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={conversionData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217.2 32.6% 17.5%)" />
              <XAxis dataKey="name" tick={{ fill: 'hsl(215 20.2% 65.1%)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'hsl(215 20.2% 65.1%)', fontSize: 12 }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip
                contentStyle={{ background: 'hsl(222.2 84% 4.9%)', border: '1px solid hsl(217.2 32.6% 17.5%)', borderRadius: 8, color: 'hsl(210 40% 98%)' }}
                formatter={(v: number) => [`${v}%`, 'Conversion']}
              />
              <Bar dataKey="rate" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="font-semibold">Agent Performance Table</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b border-border">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-muted-foreground">Agent</th>
              <th className="px-6 py-3 text-left font-medium text-muted-foreground">Company</th>
              <th className="px-6 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-6 py-3 text-right font-medium text-muted-foreground">Calls</th>
              <th className="px-6 py-3 text-right font-medium text-muted-foreground">Converted</th>
              <th className="px-6 py-3 text-right font-medium text-muted-foreground">Rate</th>
              <th className="px-6 py-3 text-right font-medium text-muted-foreground">KB Entries</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {agents.map(agent => (
              <tr key={agent.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-6 py-3 font-medium">{agent.name}</td>
                <td className="px-6 py-3 text-muted-foreground">{agent.companyName}</td>
                <td className="px-6 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(agent.status)}`}>
                    {agent.status.toUpperCase()}
                  </span>
                </td>
                <td className="px-6 py-3 text-right">{agent.totalCalls.toLocaleString()}</td>
                <td className="px-6 py-3 text-right">{agent.totalCalls > 0 ? Math.round(agent.totalCalls * agent.conversionRate / 100).toLocaleString() : '—'}</td>
                <td className="px-6 py-3 text-right font-medium">
                  {agent.totalCalls > 0 ? (
                    <span className={agent.conversionRate >= 30 ? 'text-green-400' : agent.conversionRate >= 15 ? 'text-yellow-400' : 'text-muted-foreground'}>
                      {agent.conversionRate}%
                    </span>
                  ) : '—'}
                </td>
                <td className="px-6 py-3 text-right">{agent.kbEntries}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({ label, value, delta, positive, neutral }: { label: string; value: string; delta: string; positive: boolean; neutral?: boolean }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold mt-2">{value}</p>
      <p className={`text-xs mt-1 font-medium ${neutral ? 'text-muted-foreground' : positive ? 'text-green-400' : 'text-red-400'}`}>{delta}</p>
    </div>
  );
}

function statusClass(status: string) {
  const m: Record<string, string> = {
    draft: 'bg-gray-500/20 text-gray-400',
    training: 'bg-blue-500/20 text-blue-400',
    testing: 'bg-yellow-500/20 text-yellow-400',
    approved: 'bg-purple-500/20 text-purple-400',
    published: 'bg-green-500/20 text-green-400',
  };
  return m[status] ?? '';
}
