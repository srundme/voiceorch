import { useState } from "react";
import {
  useGrowthFunnelV2,
  useGrowthCohorts,
  useGrowthUserJourneys,
  useGrowthDropoffReasons,
  useGrowthEventStats,
} from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Users, TrendingUp, Phone, Clock, AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { formatCentsToDollars } from "@/lib/api";

/* ── helpers ──────────────────────────────────────────────────────────────── */

function pct(n: number, d: number) {
  if (!d) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

const STAGE_META: Record<string, { label: string; color: string; bg: string }> = {
  signed_up:      { label: "Signed up",         color: "text-muted-foreground", bg: "bg-muted/40" },
  has_agent:      { label: "Created Agent",      color: "text-blue-600",         bg: "bg-blue-50 dark:bg-blue-900/20" },
  has_provider:   { label: "Provider Added",     color: "text-indigo-600",       bg: "bg-indigo-50 dark:bg-indigo-900/20" },
  has_telephony:  { label: "Telephony Set",      color: "text-violet-600",       bg: "bg-violet-50 dark:bg-violet-900/20" },
  made_call:      { label: "Made a Call",        color: "text-amber-600",        bg: "bg-amber-50 dark:bg-amber-900/20" },
  active:         { label: "Active (5+ calls)",  color: "text-emerald-600",      bg: "bg-emerald-50 dark:bg-emerald-900/20" },
  power_user:     { label: "Power User",         color: "text-green-700",        bg: "bg-green-100 dark:bg-green-900/30" },
};

const STAGE_ORDER = ["signed_up","has_agent","has_provider","has_telephony","made_call","active","power_user"];

function StageBadge({ stage }: { stage: string }) {
  const m = STAGE_META[stage] ?? { label: stage, color: "text-foreground", bg: "bg-muted/40" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${m.color} ${m.bg}`}>
      {m.label}
    </span>
  );
}

function StatCard({ icon, label, value, sub, color = "text-foreground" }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
            <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className="text-muted-foreground/50">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function FunnelBar({ label, value, total, sub }: { label: string; value: number; total: number; sub?: string }) {
  const pctNum = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-muted-foreground">{value.toLocaleString()} <span className="text-xs">({pctNum}%)</span></span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-muted/40 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary/70 transition-all duration-500"
          style={{ width: `${pctNum}%` }}
        />
      </div>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */

function FunnelTab() {
  const { data: f, isLoading } = useGrowthFunnelV2();
  const total = Number(f?.total_users ?? 0);

  const stages = [
    { label: "Total Signups",         value: Number(f?.total_users ?? 0),          sub: undefined },
    { label: "Created an Agent",      value: Number(f?.users_with_agent ?? 0),      sub: f?.avg_hours_to_first_agent ? `avg ${f.avg_hours_to_first_agent}h after signup` : undefined },
    { label: "Configured a Provider", value: Number(f?.users_with_provider ?? 0),   sub: undefined },
    { label: "Configured Telephony",  value: Number(f?.users_with_telephony ?? 0),  sub: undefined },
    { label: "Made at Least 1 Call",  value: Number(f?.users_with_call ?? 0),       sub: f?.avg_hours_to_first_call ? `avg ${f.avg_hours_to_first_call}h after signup` : undefined },
    { label: "Active (5+ calls)",     value: Number(f?.users_with_5_calls ?? 0),    sub: undefined },
    { label: "Power Users (20+ calls)", value: Number(f?.users_with_20_calls ?? 0), sub: undefined },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<Users className="h-5 w-5" />} label="New Users (7d)"  value={Number(f?.new_users_7d ?? 0)} />
        <StatCard icon={<Phone className="h-5 w-5" />} label="Active Users (7d)" value={Number(f?.active_users_7d ?? 0)} color="text-emerald-600" />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} label="New Users (30d)" value={Number(f?.new_users_30d ?? 0)} />
        <StatCard icon={<Phone className="h-5 w-5" />} label="Active Users (30d)" value={Number(f?.active_users_30d ?? 0)} color="text-emerald-600" />
      </div>

      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-sm font-medium uppercase tracking-wider">Activation Funnel — {total.toLocaleString()} total users</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          {isLoading ? (
            <div className="animate-pulse h-64 bg-muted/50 rounded" />
          ) : (
            stages.map((s, i) => (
              <FunnelBar key={i} label={s.label} value={s.value} total={total} sub={s.sub} />
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Avg Time → First Agent"
          value={f?.avg_hours_to_first_agent ? `${f.avg_hours_to_first_agent}h` : "—"}
          sub="from signup to first agent created"
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Avg Time → First Call"
          value={f?.avg_hours_to_first_call ? `${f.avg_hours_to_first_call}h` : "—"}
          sub="from signup to first real call"
        />
      </div>
    </div>
  );
}

function CohortsTab() {
  const { data: cohorts = [], isLoading } = useGrowthCohorts();

  const chartData = cohorts.map((c: any) => ({
    week: format(new Date(c.week), "MMM d"),
    Signups: Number(c.signups),
    Activated: Number(c.activated),
    "Rate %": Number(c.activation_rate),
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-sm font-medium uppercase tracking-wider">Weekly Signups vs Activations (13 weeks)</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="animate-pulse h-64 bg-muted/50 rounded" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="gSignups" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gActivated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="Signups"   stroke="hsl(var(--primary))" fill="url(#gSignups)"   strokeWidth={2} />
                <Area type="monotone" dataKey="Activated" stroke="#10b981"              fill="url(#gActivated)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-sm font-medium uppercase tracking-wider">Cohort Table</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week</TableHead>
                <TableHead className="text-right">Signups</TableHead>
                <TableHead className="text-right">Activated</TableHead>
                <TableHead className="text-right">Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8">Loading…</TableCell></TableRow>
              ) : cohorts.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No data</TableCell></TableRow>
              ) : [...cohorts].reverse().map((c: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{format(new Date(c.week), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right font-mono">{Number(c.signups).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-emerald-600">{Number(c.activated).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{c.activation_rate}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function UserJourneysTab() {
  const [stage, setStage] = useState("all");
  const [search, setSearch] = useState("");
  const { data: users = [], isLoading } = useGrowthUserJourneys(stage);

  const filtered = users.filter((u: any) =>
    !search || u.email?.toLowerCase().includes(search.toLowerCase()) || u.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search email or name…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["all", ...STAGE_ORDER].map(s => (
            <button
              key={s}
              onClick={() => setStage(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                stage === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {s === "all" ? "All" : (STAGE_META[s]?.label ?? s)}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-auto max-h-[600px]">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Days Since Signup</TableHead>
                <TableHead className="text-right">Agents</TableHead>
                <TableHead className="text-right">Providers</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Last Call</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No users found</TableCell></TableRow>
              ) : filtered.map((u: any) => (
                <TableRow key={u.clerk_id} className="hover:bg-muted/30">
                  <TableCell>
                    <Link href={`/users/${u.clerk_id}`} className="hover:underline text-primary block max-w-[180px] truncate text-sm">
                      {u.name || u.email || u.clerk_id?.slice(0, 16)}
                    </Link>
                    {u.email && u.name && (
                      <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">{u.email}</p>
                    )}
                  </TableCell>
                  <TableCell><StageBadge stage={u.stage} /></TableCell>
                  <TableCell className="text-right font-mono text-sm">{u.days_since_signup}d</TableCell>
                  <TableCell className="text-right font-mono text-sm">{u.agent_count}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{u.provider_count}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium">{Number(u.call_count).toLocaleString()}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {u.last_call_at ? formatDistanceToNow(new Date(u.last_call_at), { addSuffix: true }) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground font-mono">
                    {formatCentsToDollars(u.wallet_balance_cents ?? 0)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DropoffTab() {
  const { data: d, isLoading } = useGrowthDropoffReasons();
  const total = Number(d?.total ?? 0);

  const cards = [
    {
      label: "Cold Drop-off",
      desc: "Signed up, never opened Vibe Builder or created an agent",
      value: Number(d?.cold_dropoff ?? 0),
      icon: "😶",
      suggestion: "Send onboarding email — nudge them to try Vibe Builder",
      color: "border-l-red-400",
    },
    {
      label: "Vibe Builder Abandoned",
      desc: "Started Vibe Builder but didn't finish creating an agent",
      value: Number(d?.vibe_abandoned ?? 0),
      icon: "🚧",
      suggestion: "Simplify the Vibe Builder first message or add better templates",
      color: "border-l-orange-400",
    },
    {
      label: "No Provider Keys",
      desc: "Created agent but never added any provider API keys",
      value: Number(d?.no_provider ?? 0),
      icon: "🔑",
      suggestion: "Show a 'Add your first provider' prompt right after agent creation",
      color: "border-l-yellow-400",
    },
    {
      label: "No Telephony Set Up",
      desc: "Has agent + provider but no phone number / telephony configured",
      value: Number(d?.no_telephony ?? 0),
      icon: "📵",
      suggestion: "Prompt them to configure Twilio/Plivo or buy a managed number",
      color: "border-l-violet-400",
    },
    {
      label: "Configured but Never Called",
      desc: "Fully configured (agent + provider + telephony) but made 0 calls",
      value: Number(d?.configured_no_call ?? 0),
      icon: "⏸️",
      suggestion: "Send a 'Your agent is ready — make your first call' push / email",
      color: "border-l-blue-400",
    },
    {
      label: "One-and-Done",
      desc: "Made at least 1 call but fewer than 5 — not yet active",
      value: Number(d?.one_and_done ?? 0),
      icon: "☝️",
      suggestion: "Trigger a re-engagement campaign after 3 days of inactivity",
      color: "border-l-indigo-400",
    },
    {
      label: "Active Users",
      desc: "5+ calls — genuinely using the platform",
      value: Number(d?.active_users ?? 0),
      icon: "✅",
      suggestion: "Focus on retention and upsell to BYOP or higher tier",
      color: "border-l-emerald-400",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <AlertTriangle className="h-4 w-4" />
        <span>Based on {total.toLocaleString()} total users — drop-off at each stage explained with action suggestions.</span>
      </div>

      <div className="grid gap-3">
        {cards.map((c, i) => (
          <div key={i} className={`border border-border rounded-xl border-l-4 ${c.color} bg-card px-5 py-4`}>
            {isLoading ? (
              <div className="animate-pulse h-10 bg-muted/50 rounded" />
            ) : (
              <div className="flex items-start gap-4">
                <span className="text-2xl mt-0.5">{c.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-semibold text-sm">{c.label}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-lg font-bold">{c.value.toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground">({pct(c.value, total)})</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.desc}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-primary/60 shrink-0" />
                    <p className="text-xs text-primary/80">{c.suggestion}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EventsTab() {
  const { data: events = [], isLoading } = useGrowthEventStats();

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Real-time event stream from the analytics_events table. Events are fired at key user actions: signup, login, vibe_started, vibe_completed, vibe_refined.</p>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Unique Users</TableHead>
                <TableHead className="text-right">Last 7d</TableHead>
                <TableHead className="text-right">Last 24h</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8">Loading…</TableCell></TableRow>
              ) : events.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No events recorded yet</TableCell></TableRow>
              ) : events.map((e: any, i: number) => (
                <TableRow key={i}>
                  <TableCell>
                    <span className="font-mono text-xs bg-muted/50 px-2 py-0.5 rounded">{e.event_name}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium">{Number(e.total).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{Number(e.unique_users).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{Number(e.last_7d).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{Number(e.last_24h).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function Growth() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Growth & Adoption</h1>
          <p className="text-sm text-muted-foreground mt-1">Full user journey from signup → active caller</p>
        </div>
      </div>

      <Tabs defaultValue="funnel">
        <TabsList className="mb-4">
          <TabsTrigger value="funnel">Funnel</TabsTrigger>
          <TabsTrigger value="cohorts">Weekly Cohorts</TabsTrigger>
          <TabsTrigger value="journeys">User Journeys</TabsTrigger>
          <TabsTrigger value="dropoff">Drop-off Reasons</TabsTrigger>
          <TabsTrigger value="events">Event Tracking</TabsTrigger>
        </TabsList>

        <TabsContent value="funnel"><FunnelTab /></TabsContent>
        <TabsContent value="cohorts"><CohortsTab /></TabsContent>
        <TabsContent value="journeys"><UserJourneysTab /></TabsContent>
        <TabsContent value="dropoff"><DropoffTab /></TabsContent>
        <TabsContent value="events"><EventsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
