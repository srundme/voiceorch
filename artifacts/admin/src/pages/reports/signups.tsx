import { useMemo, useState } from "react";
import {
  useSignupReport,
  type UserSegment,
  type LifecycleState,
  type SignupReportRow,
} from "@/hooks/use-admin-api";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { Search, Download, Instagram, Youtube, Search as SearchIcon, Link2, Sparkles, KeyRound, Mail } from "lucide-react";

const SEGMENTS: { id: UserSegment; label: string }[] = [
  { id: "all", label: "All" },
  { id: "real", label: "Real" },
  { id: "test", label: "Test" },
];

type CategoryFilter = "all" | "professional" | "student";
const CATEGORIES: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "professional", label: "Professional" },
  { id: "student", label: "Student" },
];

const LIFECYCLE_META: Record<LifecycleState, { label: string; className: string }> = {
  active:          { label: "Active",          className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" },
  inactive:        { label: "Went inactive",   className: "border-amber-500/40 bg-amber-500/10 text-amber-500" },
  never_activated: { label: "Never activated", className: "border-muted-foreground/30 bg-muted text-muted-foreground" },
  suspended:       { label: "Suspended",       className: "border-orange-500/40 bg-orange-500/10 text-orange-500" },
  closed:          { label: "Closed",          className: "border-red-500/40 bg-red-500/10 text-red-500" },
};

const LIFECYCLE_FILTERS: { id: "all" | LifecycleState; label: string }[] = [
  { id: "all", label: "All states" },
  { id: "active", label: "Active" },
  { id: "inactive", label: "Went inactive" },
  { id: "never_activated", label: "Never activated" },
  { id: "suspended", label: "Suspended" },
  { id: "closed", label: "Closed" },
];

const REFERRAL_ICON: Record<string, React.ElementType> = {
  instagram: Instagram,
  youtube: Youtube,
  google: SearchIcon,
  reference: Link2,
  ai_search: Sparkles,
};

function humanize(v: string | null | undefined) {
  if (!v) return "—";
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmt(ts: string | null) {
  if (!ts) return null;
  const d = new Date(ts);
  return { abs: format(d, "MMM d, yyyy · h:mm a"), rel: formatDistanceToNow(d, { addSuffix: true }) };
}

function TimeCell({ ts, empty = "—" }: { ts: string | null; empty?: string }) {
  const f = fmt(ts);
  if (!f) return <span className="opacity-40">{empty}</span>;
  return (
    <div className="leading-tight">
      <div className="text-xs">{f.abs}</div>
      <div className="text-[10px] text-muted-foreground/70">{f.rel}</div>
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5 shrink-0">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`px-2.5 h-8 text-[11px] font-medium rounded-[5px] transition-colors ${
            value === o.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function toCsv(rows: SignupReportRow[]): string {
  const headers = [
    "email", "name", "clerk_id", "is_test", "role", "referral_source", "auth_method",
    "signed_up_at", "login_count", "first_login_at", "last_login_at",
    "agent_count", "first_agent_at", "call_count", "first_call_at", "last_call_at",
    "total_duration_seconds", "last_seen_at", "lifecycle", "suspended_at", "suspended_reason",
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => esc((r as Record<string, unknown>)[h])).join(","));
  }
  return lines.join("\n");
}

function StatCard({ label, value, active, onClick, className }: {
  label: string; value: number; active?: boolean; onClick?: () => void; className?: string;
}) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card className={`transition-colors ${active ? "ring-1 ring-primary" : "hover:bg-muted/40"}`}>
        <CardContent className="py-3 px-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
          <p className={`text-2xl font-bold font-mono ${className ?? ""}`}>{value}</p>
        </CardContent>
      </Card>
    </button>
  );
}

export default function SignupsReport() {
  const [segment, setSegment] = useState<UserSegment>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [lifecycle, setLifecycle] = useState<"all" | LifecycleState>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error } = useSignupReport(segment);
  const summary = data?.summary ?? {};
  const rows = data?.rows ?? [];

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        (q === "" ||
          r.email?.toLowerCase().includes(q) ||
          r.name?.toLowerCase().includes(q) ||
          r.clerk_id?.toLowerCase().includes(q)) &&
        (category === "all" ? true : r.role === category) &&
        (lifecycle === "all" ? true : r.lifecycle === lifecycle),
    );
  }, [rows, search, category, lifecycle]);

  const handleExport = () => {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `signups-report-${segment}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Signups Report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every signup — acquisition channel, login history, activation and when they ghosted or closed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented options={SEGMENTS} value={segment} onChange={setSegment} />
          <Segmented options={CATEGORIES} value={category} onChange={setCategory} />
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={handleExport} disabled={filtered.length === 0}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </div>

      {/* Lifecycle summary — click to filter */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total" value={summary.total ?? 0} active={lifecycle === "all"} onClick={() => setLifecycle("all")} />
        <StatCard label="Active" value={summary.active ?? 0} className="text-emerald-500" active={lifecycle === "active"} onClick={() => setLifecycle("active")} />
        <StatCard label="Went inactive" value={summary.inactive ?? 0} className="text-amber-500" active={lifecycle === "inactive"} onClick={() => setLifecycle("inactive")} />
        <StatCard label="Never activated" value={summary.never_activated ?? 0} className="text-muted-foreground" active={lifecycle === "never_activated"} onClick={() => setLifecycle("never_activated")} />
        <StatCard label="Suspended" value={summary.suspended ?? 0} className="text-orange-500" active={lifecycle === "suspended"} onClick={() => setLifecycle("suspended")} />
        <StatCard label="Closed" value={summary.closed ?? 0} className="text-red-500" active={lifecycle === "closed"} onClick={() => setLifecycle("closed")} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented options={LIFECYCLE_FILTERS} value={lifecycle} onChange={setLifecycle} />
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search email, name, ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 bg-muted/50 border-border"
          />
        </div>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} users</span>
      </div>

      <div className="border border-border rounded-lg bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs">User</TableHead>
              <TableHead className="font-mono text-xs">Channel</TableHead>
              <TableHead className="font-mono text-xs">Signed up</TableHead>
              <TableHead className="font-mono text-xs">Logins</TableHead>
              <TableHead className="font-mono text-xs">Activated</TableHead>
              <TableHead className="font-mono text-xs">Last seen</TableHead>
              <TableHead className="font-mono text-xs">Lifecycle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-24 text-muted-foreground animate-pulse">
                  Loading report...
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-24 text-destructive">
                  Failed to load: {(error as Error)?.message}
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                  No users match these filters
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const RefIcon = r.referral_source ? REFERRAL_ICON[r.referral_source] : undefined;
                const AuthIcon = r.auth_method === "password" ? KeyRound : Mail;
                const meta = LIFECYCLE_META[r.lifecycle];
                const activated = r.agent_count > 0 || r.call_count > 0;
                return (
                  <TableRow key={r.clerk_id} className="group align-top">
                    <TableCell>
                      <Link href={`/users/${r.clerk_id}`} className="block">
                        <div className="font-medium text-primary hover:underline">{r.email || "Unnamed"}</div>
                        {r.name && <div className="text-xs text-muted-foreground truncate max-w-[180px]">{r.name}</div>}
                        <div className="flex items-center gap-1.5 mt-1">
                          {r.role && (
                            <span className="text-[10px] px-1 rounded border border-border capitalize text-muted-foreground">{r.role}</span>
                          )}
                          {r.is_test && (
                            <span className="text-[10px] px-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-500">Test</span>
                          )}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs">
                        {RefIcon && <RefIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span>{humanize(r.referral_source)}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground/70">
                        <AuthIcon className="h-3 w-3" />
                        {r.auth_method === "password" ? "Password" : "Google"}
                      </div>
                    </TableCell>
                    <TableCell><TimeCell ts={r.signed_up_at} /></TableCell>
                    <TableCell>
                      <div className="text-sm font-mono tabular-nums">{r.login_count}</div>
                      {r.last_login_at && (
                        <div className="text-[10px] text-muted-foreground/70">
                          last {formatDistanceToNow(new Date(r.last_login_at), { addSuffix: true })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {activated ? (
                        <div className="leading-tight">
                          <div className="text-xs">{r.agent_count} agent{r.agent_count === 1 ? "" : "s"} · {r.call_count} call{r.call_count === 1 ? "" : "s"}</div>
                          <div className="text-[10px] text-muted-foreground/70">
                            {r.first_agent_at
                              ? `1st agent ${formatDistanceToNow(new Date(r.first_agent_at), { addSuffix: true })}`
                              : r.first_call_at
                                ? `1st call ${formatDistanceToNow(new Date(r.first_call_at), { addSuffix: true })}`
                                : ""}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/60">Never activated</span>
                      )}
                    </TableCell>
                    <TableCell><TimeCell ts={r.last_seen_at} /></TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-md border px-1.5 h-5 text-[10px] font-medium ${meta.className}`}>
                        {meta.label}
                      </span>
                      {(r.lifecycle === "suspended" || r.lifecycle === "closed") && r.suspended_at && (
                        <div className="text-[10px] text-muted-foreground/70 mt-1 max-w-[160px]">
                          {format(new Date(r.suspended_at), "MMM d, yyyy")}
                          {r.suspended_reason ? ` · ${r.suspended_reason}` : ""}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
