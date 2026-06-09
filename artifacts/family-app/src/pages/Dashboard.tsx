import React from "react";
import { Link } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from "recharts";
import { useStore } from "@/lib/store";

const STATUS_COLORS: Record<string, string> = {
  draft: "#6b7280",
  training: "#3b82f6",
  testing: "#f59e0b",
  approved: "#8b5cf6",
  published: "#10b981",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  training: "Training",
  testing: "Testing",
  approved: "Approved",
  published: "Published",
};

const CALL_DATA = [
  { day: "Mon", calls: 1820 },
  { day: "Tue", calls: 2340 },
  { day: "Wed", calls: 1980 },
  { day: "Thu", calls: 2750 },
  { day: "Fri", calls: 3100 },
  { day: "Sat", calls: 1420 },
  { day: "Sun", calls: 980 },
];

export function Dashboard() {
  const { agents, companies, isLoaded } = useStore();

  if (!isLoaded) return null;

  const publishedCount = agents.filter(a => a.status === 'published').length;
  const totalCalls = agents.reduce((s, a) => s + a.totalCalls, 0);
  const avgConversion = agents.filter(a => a.totalCalls > 0).reduce((s, a, _, arr) =>
    s + a.conversionRate / arr.length, 0);

  const statusCounts = ['draft', 'training', 'testing', 'approved', 'published'].map(s => ({
    status: STATUS_LABELS[s],
    count: agents.filter(a => a.status === s).length,
    color: STATUS_COLORS[s],
  }));

  const recentAgents = [...agents].sort(
    (a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
  ).slice(0, 5);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Platform Overview</h1>
        <p className="text-muted-foreground mt-1">Real-time status of all insurance AI agents.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Insurance Companies" value={companies.length.toString()} sub="onboarded" color="text-foreground" />
        <StatCard label="Total Agents" value={agents.length.toString()} sub={`${publishedCount} live`} color="text-green-400" />
        <StatCard label="Total Calls" value={totalCalls.toLocaleString()} sub="all time" color="text-primary" />
        <StatCard label="Avg Conversion" value={`${avgConversion.toFixed(1)}%`} sub="published agents" color="text-yellow-400" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="font-semibold mb-4">Weekly Call Volume</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={CALL_DATA} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217.2 32.6% 17.5%)" />
              <XAxis dataKey="day" tick={{ fill: 'hsl(215 20.2% 65.1%)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'hsl(215 20.2% 65.1%)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(222.2 84% 4.9%)', border: '1px solid hsl(217.2 32.6% 17.5%)', borderRadius: 8, color: 'hsl(210 40% 98%)' }}
                cursor={{ fill: 'hsl(217.2 32.6% 17.5% / 0.5)' }}
              />
              <Bar dataKey="calls" fill="hsl(217.2 91.2% 59.8%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="font-semibold mb-4">Agents by Status</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={statusCounts} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217.2 32.6% 17.5%)" />
              <XAxis dataKey="status" tick={{ fill: 'hsl(215 20.2% 65.1%)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: 'hsl(215 20.2% 65.1%)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(222.2 84% 4.9%)', border: '1px solid hsl(217.2 32.6% 17.5%)', borderRadius: 8, color: 'hsl(210 40% 98%)' }}
                cursor={{ fill: 'hsl(217.2 32.6% 17.5% / 0.5)' }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {statusCounts.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h2 className="font-semibold">Recent Agent Activity</h2>
          <Link href="/agents" className="text-sm text-primary hover:underline">View all →</Link>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b border-border">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-muted-foreground">Company</th>
              <th className="px-6 py-3 text-left font-medium text-muted-foreground">Agent</th>
              <th className="px-6 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-6 py-3 text-right font-medium text-muted-foreground">Calls</th>
              <th className="px-6 py-3 text-right font-medium text-muted-foreground">Conversion</th>
              <th className="px-6 py-3 text-right font-medium text-muted-foreground">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {recentAgents.map(agent => (
              <tr key={agent.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-6 py-3 font-medium">{agent.companyName}</td>
                <td className="px-6 py-3">
                  <Link href={`/agents/${agent.id}`} className="hover:text-primary hover:underline">
                    {agent.name}
                  </Link>
                </td>
                <td className="px-6 py-3">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: STATUS_COLORS[agent.status] + '22', color: STATUS_COLORS[agent.status], border: `1px solid ${STATUS_COLORS[agent.status]}44` }}>
                    {agent.status.toUpperCase()}
                  </span>
                </td>
                <td className="px-6 py-3 text-right">{agent.totalCalls.toLocaleString()}</td>
                <td className="px-6 py-3 text-right">{agent.totalCalls > 0 ? `${agent.conversionRate}%` : '—'}</td>
                <td className="px-6 py-3 text-right text-muted-foreground text-xs">
                  {timeAgo(agent.lastUpdated)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-2 ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return "just now";
}
