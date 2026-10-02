import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  FlaskConical,
  Kanban,
  LogOut,
  MoreHorizontal,
  Plus,
  Settings,
  Shield,
  Sun,
  Users,
  User as UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSalesPrefs } from "@/components/sales/sales-context";
import { QUICK_ACTIONS, useQuickActions } from "@/components/sales/quick-actions";
import { Pill } from "@/components/sales/sales-ui";
import { useSalesLogout, useTaskReminders } from "@/hooks/use-sales-api";
import { formatDateTimeIST } from "@/lib/sales-format";

type NavEntry = { href: string; label: string; icon: typeof Sun };

export const SALES_NAV: NavEntry[] = [
  { href: "/sales", label: "Today", icon: Sun },
  { href: "/sales/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/sales/pilots", label: "Pilots", icon: FlaskConical },
  { href: "/sales/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/sales/customers", label: "Customers", icon: Building2 },
  { href: "/sales/reports", label: "Reports", icon: BarChart3 },
  { href: "/sales/settings", label: "Settings", icon: Settings },
];
const PRIMARY_MOBILE = 5;

function isActive(location: string, href: string) {
  if (href === "/sales") return location === "/sales" || location === "/sales/";
  if (href === "/sales/pipeline") return location.startsWith("/sales/pipeline") || location.startsWith("/sales/companies");
  return location === href || location.startsWith(`${href}/`);
}

function RoleBadge({ role }: { role: string }) {
  return <Pill tone={role === "founder" ? "accent" : "neutral"}>{role === "founder" ? "Founder" : "Teammate"}</Pill>;
}

function ScopeToggle({ className }: { className?: string }) {
  const { isFounder, scope, setScope } = useSalesPrefs();
  if (!isFounder) return null;
  return (
    <div className={cn("grid grid-cols-2 rounded-md border border-border p-0.5 text-xs", className)} role="group" aria-label="Work scope">
      {(
        [
          ["team", "Team", Users],
          ["mine", "My work", UserIcon],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          onClick={() => setScope(value)}
          aria-pressed={scope === value}
          className={cn(
            "flex min-h-9 items-center justify-center gap-1.5 rounded px-2 font-medium transition-colors",
            scope === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

function DemoToggle() {
  const { demo, setDemo } = useSalesPrefs();
  return (
    <label className="flex min-h-9 items-center justify-between gap-2 rounded-md px-1 text-xs">
      <span className="font-medium">Demo data</span>
      <Switch checked={demo} onCheckedChange={setDemo} aria-label="Show demo data" />
    </label>
  );
}

function useLogout() {
  const logout = useSalesLogout();
  const [, navigate] = useLocation();
  return () => logout.mutate(undefined, { onSettled: () => navigate("/sales/login") });
}

function hasAdminToken() {
  try {
    return Boolean(localStorage.getItem("adminToken"));
  } catch {
    return false;
  }
}

function QuickAddMenu({ align = "end", compact }: { align?: "start" | "end"; compact?: boolean }) {
  const qa = useQuickActions();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={compact ? "icon" : "sm"} className={cn(compact ? "h-10 w-10" : "min-h-9", "bg-[hsl(var(--sales-accent))] text-white hover:bg-[hsl(var(--sales-accent)/0.9)]")} aria-label="Quick add">
          <Plus className="h-4 w-4" />
          {!compact && <span className="ml-1">Quick add</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-52">
        {QUICK_ACTIONS.map((a) => (
          <DropdownMenuItem key={a.kind} className="min-h-11 md:min-h-8" onSelect={() => qa.open(a.kind)}>
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const DUE_SOON_MS = 2 * 60 * 60 * 1000;

/** In-app reminders: the user's overdue tasks and tasks due in the next two hours. */
function RemindersBell() {
  const reminders = useTaskReminders();
  const now = Date.now();
  const items = (reminders.data?.items ?? []).filter((t) => t.dueAt && new Date(t.dueAt).getTime() <= now + DUE_SOON_MS);
  const overdue = items.filter((t) => new Date(t.dueAt!).getTime() < now).length;
  const label = items.length ? `Reminders: ${overdue} overdue, ${items.length - overdue} due soon` : "Reminders: nothing due";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-10 w-10" aria-label={label} title={label}>
          <Bell className="h-4 w-4" aria-hidden="true" />
          {items.length > 0 && (
            <span
              className={cn(
                "absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white",
                overdue ? "bg-red-500" : "bg-amber-500",
              )}
              aria-hidden="true"
            >
              {items.length > 9 ? "9+" : items.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Overdue and due in the next 2 hours</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Nothing due right now.</p>
        ) : (
          items.slice(0, 10).map((t) => {
            const late = new Date(t.dueAt!).getTime() < now;
            return (
              <DropdownMenuItem key={t.id} asChild className="min-h-11 md:min-h-8">
                <Link href={t.companyId ? `/sales/companies/${t.companyId}` : "/sales"} className="flex flex-col items-start gap-0.5">
                  <span className="w-full truncate text-sm">{t.title}</span>
                  <span className={cn("text-[11px]", late ? "text-red-500" : "text-muted-foreground")}>
                    {late ? "Overdue · " : "Due "}
                    {formatDateTimeIST(t.dueAt)}
                    {t.companyName ? ` · ${t.companyName}` : ""}
                  </span>
                </Link>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { user } = useSalesPrefs();
  const logout = useLogout();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-1.5 px-2" aria-label="Account menu">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="space-y-1">
          <div className="truncate text-sm">{user.name || user.email}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
          <RoleBadge role={user.role} />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="space-y-2 p-2">
          <ScopeToggle />
          <DemoToggle />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11 md:min-h-8" onSelect={logout}>
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DemoBanner() {
  const { demo, setDemo } = useSalesPrefs();
  if (!demo) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-xs text-amber-800 dark:text-amber-300" role="status">
      <span>
        <strong>Demo mode</strong> — showing demo data only. Nothing here counts toward real results.
      </span>
      <Button variant="outline" size="sm" className="h-7 shrink-0 border-amber-500/50 bg-transparent" onClick={() => setDemo(false)}>
        Turn off
      </Button>
    </div>
  );
}

export function SalesLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useSalesPrefs();
  const [moreOpen, setMoreOpen] = useState(false);
  const logout = useLogout();
  const primary = SALES_NAV.slice(0, PRIMARY_MOBILE);
  const secondary = SALES_NAV.slice(PRIMARY_MOBILE);
  const moreActive = secondary.some((n) => isActive(location, n.href));

  return (
    <div className="sales-app flex h-dvh w-full overflow-hidden bg-background font-sans text-sm text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <img src={`${import.meta.env.BASE_URL}snapserve-icon-light.png`} alt="" aria-hidden className="h-5 w-5" />
          <span className="text-sm font-semibold">SnapServe Sales</span>
        </div>
        <div className="flex items-center gap-1 px-3 pt-3">
          <QuickAddMenu align="start" />
          <RemindersBell />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Sales">
          {SALES_NAV.map((n) => {
            const active = isActive(location, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-md px-3 text-sm transition-colors",
                  active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <n.icon className={cn("h-4 w-4", active && "text-[hsl(var(--sales-accent))]")} />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-2 border-t border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{user.name || user.email}</div>
              <div className="truncate text-[11px] text-muted-foreground">{user.email}</div>
            </div>
            <RoleBadge role={user.role} />
          </div>
          <ScopeToggle />
          <DemoToggle />
          <div className="flex gap-1">
            {hasAdminToken() && (
              <Button asChild variant="ghost" size="sm" className="flex-1 justify-start text-muted-foreground">
                <Link href="/">
                  <Shield className="mr-1.5 h-3.5 w-3.5" /> Admin
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" className="flex-1 justify-start text-muted-foreground" onClick={logout}>
              <LogOut className="mr-1.5 h-3.5 w-3.5" /> Sign out
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 md:hidden">
          <Link href="/sales" className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}snapserve-icon-light.png`} alt="" aria-hidden className="h-5 w-5" />
            <span className="text-sm font-semibold">Sales</span>
          </Link>
          <div className="flex items-center gap-1">
            <QuickAddMenu compact />
            <RemindersBell />
            <UserMenu />
          </div>
        </header>
        <DemoBanner />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-3 py-4 pb-24 md:px-6 md:py-6 md:pb-8">{children}</div>
        </main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid border-t border-border bg-card/95 backdrop-blur md:hidden"
        style={{ gridTemplateColumns: `repeat(${PRIMARY_MOBILE + 1}, minmax(0, 1fr))`, paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Sales"
      >
        {primary.map((n) => {
          const active = isActive(location, n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px]", active ? "font-semibold text-[hsl(var(--sales-accent))]" : "text-muted-foreground")}
              aria-current={active ? "page" : undefined}
            >
              <n.icon className="h-5 w-5" />
              {n.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px]", moreActive ? "font-semibold text-[hsl(var(--sales-accent))]" : "text-muted-foreground")}
        >
          <MoreHorizontal className="h-5 w-5" />
          More
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" aria-describedby={undefined} className="rounded-t-xl pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <SheetHeader className="text-left">
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="mt-3 space-y-1">
            {secondary.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setMoreOpen(false)} className="flex min-h-12 items-center gap-3 rounded-md px-3 text-sm hover:bg-muted">
                <n.icon className="h-5 w-5 text-muted-foreground" /> {n.label}
              </Link>
            ))}
          </div>
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{user.name || user.email}</div>
                <div className="truncate text-xs text-muted-foreground">{user.email}</div>
              </div>
              <RoleBadge role={user.role} />
            </div>
            <ScopeToggle />
            <DemoToggle />
            <Button variant="outline" className="min-h-11 w-full" onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
