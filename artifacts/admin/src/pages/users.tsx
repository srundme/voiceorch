import { useCustomerUsers, useSetUserTestFlag, type UserSegment } from "@/hooks/use-admin-api";
import { formatCentsToDollars } from "@/lib/api";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Search, FlaskConical, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { SectionSubNav } from "@/components/section-subnav";
import { CUSTOMERS_TABS } from "@/lib/nav-config";
import { downloadCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";

const SEGMENTS: { id: UserSegment; label: string }[] = [
  { id: "real", label: "Real" },
  { id: "test", label: "Test" },
  { id: "all", label: "All" },
];

type UserCategory = "all" | "professional" | "student";
const CATEGORIES: { id: UserCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "professional", label: "Professional" },
  { id: "student", label: "Student" },
];

type LifecycleFilter = "all" | "active" | "paying" | "dormant" | "suspended" | "high_usage" | "high_value";
const LIFECYCLES: { id: LifecycleFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "paying", label: "Paying" },
  { id: "dormant", label: "Dormant" },
  { id: "suspended", label: "Suspended" },
  { id: "high_usage", label: "High usage" },
  { id: "high_value", label: "High value" },
];

function normalize(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[._\-+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildHaystack(user: any): string {
  const onboarding = user?.onboardingData ?? {};
  const emailLocalPart = typeof user?.email === "string" ? user.email.split("@")[0] : "";
  return [
    user?.name,
    user?.email,
    emailLocalPart,
    user?.clerkId,
    onboarding.name,
    onboarding.fullName,
    onboarding.company,
    onboarding.companyName,
    onboarding.role,
    onboarding.referralSource,
  ]
    .map(normalize)
    .filter(Boolean)
    .join(" ");
}

function matchesSearch(user: any, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = buildHaystack(user);
  return terms.every((term) => haystack.includes(term));
}

function displayName(user: any): string {
  if (typeof user?.name === "string" && user.name.trim()) return user.name.trim();
  if (typeof user?.email === "string" && user.email.includes("@")) {
    return user.email.split("@")[0]!.replace(/[._\-+]+/g, " ");
  }
  return "Unnamed";
}

function LifecycleBadge({ lifecycle }: { lifecycle?: string }) {
  const l = lifecycle ?? "new";
  const cls =
    l === "paying" ? "bg-emerald-600 text-white border-transparent" :
    l === "active" ? "bg-sky-600/15 text-sky-600 border-sky-600/30" :
    l === "dormant" ? "bg-amber-500/10 text-amber-600 border-amber-500/30" :
    l === "suspended" ? "bg-destructive text-destructive-foreground border-transparent" :
    l === "deleted" ? "text-muted-foreground" :
    "text-muted-foreground";
  return <Badge variant="outline" className={`text-[10px] capitalize ${cls}`}>{l}</Badge>;
}

function TestFlagToggle({ clerkId, isTest }: { clerkId: string; isTest: boolean }) {
  const mutation = useSetUserTestFlag(clerkId);
  return (
    <button
      type="button"
      title={isTest ? "Test/internal account — click to mark as real" : "Real account — click to mark as test/internal"}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); mutation.mutate({ isTest: !isTest }); }}
      disabled={mutation.isPending}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 h-5 text-[10px] font-medium transition-colors disabled:opacity-50 ${
        isTest
          ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
          : "border-border text-muted-foreground/60 hover:text-foreground hover:border-muted-foreground/40"
      }`}
    >
      <FlaskConical className="h-3 w-3" />
      {isTest ? "Test" : "Real"}
    </button>
  );
}

export default function UsersList() {
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>("all");
  const { data, isLoading, isError, error } = useCustomerUsers(lifecycle);
  const users = data?.users;
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<UserSegment>("all");
  const [category, setCategory] = useState<UserCategory>("all");

  const searchTerms = useMemo(
    () => normalize(search).split(" ").filter(Boolean),
    [search],
  );

  const filteredUsers = useMemo(
    () =>
      users?.filter(
        (u) =>
          matchesSearch(u, searchTerms) &&
          (segment === "all" ? true : segment === "test" ? !!u.isTest : !u.isTest) &&
          (category === "all" ? true : u.onboardingData?.role === category),
      ),
    [users, searchTerms, segment, category],
  );

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={CUSTOMERS_TABS} />
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-xs text-muted-foreground">
            Showing {(filteredUsers?.length ?? 0).toLocaleString()} of{" "}
            {(users?.length ?? 0).toLocaleString()} · lifecycle + economics
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8"
            disabled={!filteredUsers?.length}
            onClick={() =>
              downloadCsv(
                `users-${Date.now()}`,
                ["email", "name", "clerkId", "lifecycle", "balance", "revenue", "profit", "calls", "minutes", "agents", "lastActive"],
                (filteredUsers ?? []).map((u: any) => [
                  u.email, u.name, u.clerkId, u.lifecycle, u.walletBalanceCents, u.revenuePaise, u.profitPaise, u.callCount, u.minutes, u.agentCount, u.lastActiveAt,
                ]),
              )
            }
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5 shrink-0 flex-wrap">
            {LIFECYCLES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setLifecycle(s.id)}
                className={`px-2.5 h-8 text-[11px] font-medium rounded-[5px] transition-colors ${
                  lifecycle === s.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5 shrink-0">
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSegment(s.id)}
                className={`px-2.5 h-8 text-[11px] font-medium rounded-[5px] transition-colors ${
                  segment === s.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5 shrink-0">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={`px-2.5 h-8 text-[11px] font-medium rounded-[5px] transition-colors ${
                  category === c.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, email, company, ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10 bg-muted/50 border-border"
            />
          </div>
        </div>
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs">User</TableHead>
              <TableHead className="font-mono text-xs">Lifecycle</TableHead>
              <TableHead className="font-mono text-xs">Type</TableHead>
              <TableHead className="font-mono text-xs text-right">Balance</TableHead>
              <TableHead className="font-mono text-xs text-right">Revenue</TableHead>
              <TableHead className="font-mono text-xs text-right">Profit</TableHead>
              <TableHead className="font-mono text-xs text-right">Calls</TableHead>
              <TableHead className="font-mono text-xs text-right">Minutes</TableHead>
              <TableHead className="font-mono text-xs text-right">Agents</TableHead>
              <TableHead className="font-mono text-xs text-right">Last active</TableHead>
              <TableHead className="font-mono text-xs text-right">Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center h-24 text-muted-foreground animate-pulse">
                  Loading users...
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center h-24 text-destructive">
                  Failed to load users: {(error as Error)?.message}
                </TableCell>
              </TableRow>
            ) : filteredUsers?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center h-24 text-muted-foreground">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers?.map((user) => (
                <TableRow key={user.id} className="group transition-colors">
                  <TableCell>
                    <Link href={`/users/${user.clerkId}`} className="block">
                      <div className="font-medium text-primary hover:underline truncate max-w-[220px] capitalize">
                        {displayName(user)}
                      </div>
                      <div className="text-xs text-muted-foreground truncate max-w-[220px]">{user.email || "No email"}</div>
                      <div className="text-[10px] text-muted-foreground font-mono mt-1 opacity-50 group-hover:opacity-100">{user.clerkId}</div>
                    </Link>
                  </TableCell>
                  <TableCell><LifecycleBadge lifecycle={user.lifecycle} /></TableCell>
                  <TableCell>
                    <TestFlagToggle clerkId={user.clerkId} isTest={!!user.isTest} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <span className={user.walletBalanceCents < 0 ? "text-destructive" : ""}>
                      {formatCentsToDollars(user.walletBalanceCents || 0)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {formatCentsToDollars(user.revenuePaise || 0)}
                  </TableCell>
                  <TableCell className={`text-right font-mono tabular-nums ${(user.profitPaise ?? 0) < 0 ? "text-destructive" : "text-emerald-600"}`}>
                    {formatCentsToDollars(user.profitPaise || 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{user.callCount?.toLocaleString() || 0}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{Math.round(user.minutes ?? 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{user.agentCount?.toLocaleString() || 0}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {user.lastActiveAt
                      ? formatDistanceToNow(new Date(user.lastActiveAt), { addSuffix: true })
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {user.createdAt ? format(new Date(user.createdAt), "MMM d, yyyy") : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
