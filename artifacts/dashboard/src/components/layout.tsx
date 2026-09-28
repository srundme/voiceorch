import React, { useState, useEffect, Component } from "react";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/components/theme-provider";
import { GlobalSearch, useGlobalSearchTrigger } from "@/components/GlobalSearch";
import {
  Menu, ChevronDown, ChevronLeft, ChevronRight,
  LogOut, Bell, Search, Sun, Moon,
  Plus, X, Wand2, Wrench,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetWallet, customFetch } from "@workspace/api-client-react";
import { useMinuteRatesMap, useUserProviderNames } from "@/hooks/use-minute-rates";
import { SnapServeIcon } from "@/components/logo";
import {
  HomeIcon,
  CampaignsIcon,
  AgentIcon,
  PhoneIcon,
  ConnectionsIcon,
  HistoryIcon,
  AnalyticsIcon,
  KnowledgeIcon,
  MemoryIcon,
  SquadsIcon,
  BookingsIcon,
  WorkspaceIcon,
  ProvidersIcon,
  DevelopersIcon,
  BillingIcon,
  PartnerIcon,
  CreateIcon,
  WalletIcon,
  SettingsIcon,
} from "@workspace/brand-icons";
import { usePartnerContext, usePartnerManagedWorkspace } from "@/hooks/use-partner";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadActingAs, stopActingAs } from "@/lib/acting-as";

/* ─── Error boundary ─────────────────────────────────────────────────────── */
interface ErrorBoundaryState { hasError: boolean; error: unknown }
class ErrorBoundary extends Component<
  { location: string; children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { location: string; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: { location: string }) {
    if (prevProps.location !== this.props.location && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const message =
        this.state.error instanceof Error
          ? this.state.error.message
          : this.state.error != null
            ? String(this.state.error)
            : null;
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
          <p className="text-sm text-muted-foreground">Something went wrong on this page.</p>
          {message && (
            <pre className="max-w-xl max-h-32 overflow-auto text-left text-[11px] font-mono text-destructive/90 bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2 whitespace-pre-wrap">
              {message}
            </pre>
          )}
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ─── Constants ─────────────────────────────────────────────────────────── */
const LS_COLLAPSED = "snapserve:sidebar-collapsed";
const LS_SETTINGS  = "snapserve:settings-open";

/* ─── Navigation structure ───────────────────────────────────────────────── */
interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  /** Set true on the item that should show the pending-callbacks badge */
  callbackBadge?: boolean;
}

interface NavGroup {
  /** Uppercase group label, e.g. "BUILD". Omit for ungrouped items. */
  group?: string;
  items: NavItem[];
}

/**
 * Primary IA: Build → Deploy → Monitor (Sarvam-inspired lifecycle).
 * Developers lives in settings footer (promoted mentally; still one click).
 */
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { name: "Home", href: "/app/home", icon: HomeIcon },
    ],
  },
  {
    group: "BUILD",
    items: [
      { name: "Agents", href: "/app/agents", icon: AgentIcon },
      { name: "Knowledge", href: "/app/knowledge-bases", icon: KnowledgeIcon },
      { name: "Memory", href: "/app/memory", icon: MemoryIcon },
      { name: "Squads", href: "/app/squads", icon: SquadsIcon },
    ],
  },
  {
    group: "DEPLOY",
    items: [
      { name: "Phone numbers", href: "/app/phone-numbers", icon: PhoneIcon },
      { name: "Campaigns", href: "/app/campaigns", icon: CampaignsIcon },
      { name: "Connections", href: "/app/connections", icon: ConnectionsIcon },
      { name: "Bookings", href: "/app/scheduling", icon: BookingsIcon },
    ],
  },
  {
    group: "MONITOR",
    items: [
      { name: "Call logs", href: "/app/history", icon: HistoryIcon, callbackBadge: true },
      { name: "Analytics", href: "/app/analytics", icon: AnalyticsIcon },
    ],
  },
];

const NAV_SETTINGS: NavItem[] = [
  { name: "Developers", href: "/app/api-keys", icon: DevelopersIcon },
  { name: "Workspace", href: "/app/settings", icon: WorkspaceIcon },
  { name: "Providers", href: "/app/providers?tab=provider-keys", icon: ProvidersIcon },
  { name: "Billing", href: "/app/wallet", icon: BillingIcon },
];

/** Partner clients: product + developers; no BYOP/docs/platform pages. */
const MANAGED_NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { name: "Home", href: "/app/home", icon: HomeIcon },
    ],
  },
  {
    group: "BUILD",
    items: [
      { name: "Agents", href: "/app/agents", icon: AgentIcon },
      { name: "Knowledge", href: "/app/knowledge-bases", icon: KnowledgeIcon },
    ],
  },
  {
    group: "DEPLOY",
    items: [
      { name: "Phone numbers", href: "/app/phone-numbers", icon: PhoneIcon },
      { name: "Campaigns", href: "/app/campaigns", icon: CampaignsIcon },
      { name: "Connections", href: "/app/connections", icon: ConnectionsIcon },
      { name: "Bookings", href: "/app/scheduling", icon: BookingsIcon },
    ],
  },
  {
    group: "MONITOR",
    items: [
      { name: "Call logs", href: "/app/history", icon: HistoryIcon, callbackBadge: true },
      { name: "Analytics", href: "/app/analytics", icon: AnalyticsIcon },
    ],
  },
];

const MANAGED_NAV_SETTINGS: NavItem[] = [
  { name: "Developers", href: "/app/api-keys", icon: DevelopersIcon },
  { name: "Workspace", href: "/app/settings", icon: WorkspaceIcon },
  { name: "Billing", href: "/app/wallet", icon: BillingIcon },
];

const SETTINGS_HREFS = NAV_SETTINGS.map(s => s.href.split("?")[0]);

/* ─── Pending callbacks count (for sidebar badge) ────────────────────────── */
const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

function usePendingCallbackCount(): number {
  const { data } = useQuery<number>({
    queryKey: ["callbacks", "pending-count"],
    queryFn: async () => {
      try {
        const res = await customFetch(`${BASE_URL}/api/callbacks?status=pending`);
        if (Array.isArray(res)) return res.length;
        const r = res as Record<string, unknown>;
        if (typeof r.total === "number") return r.total;
        if (Array.isArray(r.items)) return r.items.length;
        if (Array.isArray(r.data)) return (r.data as unknown[]).length;
        return 0;
      } catch {
        return 0;
      }
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  return data ?? 0;
}

/* ─── Wallet chip (sidebar footer) ──────────────────────────────────────── */
function WalletChip({ compact = false }: { compact?: boolean }) {
  const { data: wallet } = useGetWallet();
  const cents = wallet?.balanceCents ?? null;
  const rateMap = useMinuteRatesMap();
  const userProviders = useUserProviderNames();

  // Prefer the account's effective rate (partner base rate / partner-set
  // client rate) over the generic flat rate for the minutes estimate.
  const rateCentsPerMin = wallet?.effectiveRateCentsPerMin
    ?? rateMap.get(userProviders.size > 0 ? "byop" : "managed") ?? 500;
  const availMins = cents !== null ? Math.floor(cents / rateCentsPerMin) : null;

  const { ring, text, bar } =
    cents === null
      ? { ring: "border-border", text: "text-muted-foreground", bar: "bg-border" }
      : cents >= 50_000
      ? { ring: "border-emerald-500/35", text: "text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-500" }
      : cents >= 10_000
      ? { ring: "border-amber-500/35", text: "text-amber-700 dark:text-amber-400", bar: "bg-amber-500" }
      : { ring: "border-red-500/35", text: "text-red-700 dark:text-red-400", bar: "bg-red-500" };

  const pct = cents === null ? 0 : Math.min(100, (cents / 100_000) * 100);

  return (
    <Link href="/app/wallet" title={compact ? (cents !== null ? `₹${(cents / 100).toFixed(2)}` : "Wallet") : undefined}>
      <div className={cn(
        "flex items-center rounded-lg border bg-elevated/40 cursor-pointer hover:bg-elevated transition-colors w-full",
        compact ? "h-9 justify-center px-0 py-0" : "gap-1.5 px-2.5 py-[7px]",
        ring,
      )}>
        <WalletIcon className={`size-4 shrink-0 ${text}`} />
        {!compact && (
          <div className="flex flex-col gap-[3px] flex-1 min-w-0">
            {cents !== null ? (
              <div className="flex items-baseline gap-1.5">
                <span className={`text-[13px] font-semibold tabular-nums leading-none ${text}`}>
                  ₹{(cents / 100).toFixed(2)}
                </span>
                {availMins !== null && (
                  <span className={`text-[11px] leading-none tabular-nums ${text} opacity-70`}>
                    ~{availMins}m
                  </span>
                )}
              </div>
            ) : (
              <div className="h-2.5 w-10 rounded animate-pulse bg-elevated" />
            )}
            <div className="h-[2px] w-full rounded-full bg-border/40 overflow-hidden">
              <div className={`h-full rounded-full ${bar} transition-all duration-700`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}

/* ─── Notification bell ──────────────────────────────────────────────────── */
function BellButton() {
  return (
    <button className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors relative">
      <Bell className="size-4" />
    </button>
  );
}

/* ─── Sidebar user profile (footer) ─────────────────────────────────────── */
function SidebarUser({ collapsed }: { collapsed: boolean }) {
  const { signOut, user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const email    = user?.email ?? "";
  const name     = user?.name ?? (email ? email.split("@")[0]! : "Account");
  const initials = (name?.[0] ?? email[0] ?? "A").toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title={collapsed ? name : undefined}
        className={cn(
          "flex items-center rounded-lg hover:bg-accent transition-colors w-full",
          collapsed ? "h-9 justify-center px-0 py-0" : "gap-2 px-2.5 py-2",
        )}
      >
        <div className="size-7 rounded-md bg-elevated border border-border flex items-center justify-center shrink-0">
          <span className="text-[11px] font-semibold text-foreground">{initials}</span>
        </div>
        {!collapsed && (
          <>
            <span className="flex-1 text-left text-[13px] font-medium text-foreground max-w-[110px] truncate">{name}</span>
            <ChevronDown className={`size-3.5 text-muted-foreground transition-transform duration-150 shrink-0 ${open ? "rotate-180" : ""}`} />
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-full mb-1.5 w-[200px] rounded-xl border border-border bg-popover shadow-xl overflow-hidden z-50">
            <div className="px-3.5 py-2.5 border-b border-border">
              <p className="text-[12.5px] font-semibold text-foreground truncate">{name}</p>
              {email && <p className="text-[10.5px] text-muted-foreground/60 truncate mt-0.5">{email}</p>}
            </div>
            <Link href="/app/settings">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3.5 py-2.5 w-full text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <SettingsIcon className="w-3.5 h-3.5" />
                Settings
              </button>
            </Link>
            <button
              type="button"
              onClick={() => {
                setTheme(theme === "dark" ? "light" : "dark");
                setOpen(false);
              }}
              className="flex items-center gap-2.5 px-3.5 py-2.5 w-full text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              {theme === "dark" ? "Light appearance" : "Dark appearance"}
            </button>
            <button
              onClick={() => { void signOut(); setOpen(false); }}
              className="flex items-center gap-2.5 px-3.5 py-2.5 w-full text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Utility strip (desktop) — no page title; pages own their h1 via StripePage */
function UtilityStrip() {
  return (
    <div className="flex h-10 shrink-0 items-center justify-end gap-1 border-b border-border/70 bg-background px-4">
      <ThemeToggle />
      <BellButton />
    </div>
  );
}

/* ─── Single nav item ────────────────────────────────────────────────────── */
function navItemIsActive(location: string, href: string): boolean {
  const path = href.split("?")[0];
  if (path === "/app") return false;
  if (location.startsWith(path)) return true;
  // Phase 4 aliases — old URLs still work; highlight the new home.
  if (path === "/app/history" && (location.startsWith("/app/calls") || location.startsWith("/app/history"))) return true;
  if (
    path === "/app/campaigns"
    && (location.startsWith("/app/campaigns") || location.startsWith("/app/automatic-calls"))
  ) return true;
  if (
    path === "/app/connections"
    && (
      location.startsWith("/app/connections")
      || location.startsWith("/app/whatsapp")
      || location.startsWith("/app/meta-leads")
      || location.startsWith("/app/automatic-calls")
    )
  ) return true;
  return false;
}

function NavItemEl({
  item, collapsed, indent = false, onClick, badge = 0,
}: {
  item: NavItem;
  collapsed: boolean;
  indent?: boolean;
  onClick?: () => void;
  badge?: number;
}) {
  const [location] = useLocation();
  const isActive = navItemIsActive(location, item.href);

  return (
    <Link
      href={item.href}
      onClick={onClick}
      title={collapsed ? item.name : undefined}
      aria-current={isActive ? "page" : undefined}
      className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div
        className={cn(
          "relative flex h-9 items-center rounded-md text-[13px] transition-colors duration-200 cursor-pointer select-none",
          collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
          indent && !collapsed ? "pl-2" : "",
          isActive
            ? "bg-foreground/[0.08] text-foreground font-medium"
            : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
        )}
      >
        <item.icon
          className={cn(
            "size-4 shrink-0",
            isActive ? "text-foreground" : "text-muted-foreground",
          )}
        />
        {!collapsed && (
          <>
            <span className="truncate flex-1">{item.name}</span>
            {badge > 0 && (
              <span className="inline-flex min-w-4 items-center justify-center rounded px-1 text-[9px] font-medium leading-4 text-amber-600">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </>
        )}
        {collapsed && badge > 0 && (
          <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-amber-500" />
        )}
      </div>
    </Link>
  );
}

/* ─── Sidebar content ────────────────────────────────────────────────────── */
function SidebarContent({
  collapsed,
  onToggleCollapse,
  onNavClick,
  onSearchOpen,
  onNewAgent,
}: {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onNavClick?: () => void;
  onSearchOpen?: () => void;
  onNewAgent?: () => void;
}) {
  const [location] = useLocation();
  const pendingCallbacks = usePendingCallbackCount();

  const isInSettings = SETTINGS_HREFS.some(href => location.startsWith(href));

  const [settingsOpen, setSettingsOpen] = useState(() => {
    try { return localStorage.getItem(LS_SETTINGS) === "true"; } catch { return false; }
  });

  useEffect(() => {
    if (isInSettings && !settingsOpen) setSettingsOpen(true);
  }, [isInSettings, settingsOpen]);

  const toggleSettings = () => {
    setSettingsOpen(v => {
      const next = !v;
      try { localStorage.setItem(LS_SETTINGS, String(next)); } catch {}
      return next;
    });
  };

  // Partner hub nav (gated) + white-label branding for partner-managed clients.
  const { data: partnerCtx } = usePartnerContext();
  const actingAsClient = loadActingAs();
  const clientSurface = partnerCtx?.isManagedClient === true || !!actingAsClient;
  const navGroups: NavGroup[] = clientSurface
    ? MANAGED_NAV_GROUPS
    : partnerCtx?.isPartner
      ? [
          ...NAV_GROUPS,
          { group: "PARTNER", items: [{ name: "Partner Hub", href: "/app/partner", icon: PartnerIcon }] },
        ]
      : NAV_GROUPS;
  const settingsItems: NavItem[] = clientSurface ? MANAGED_NAV_SETTINGS : NAV_SETTINGS;

  return (
    <div className="flex h-full flex-col border-r border-sidebar-border bg-sidebar">
      {/* Workspace identity */}
      <div className={cn(
        "flex h-12 shrink-0 items-center border-b border-sidebar-border",
        collapsed ? "justify-center px-1" : "justify-between gap-1.5 px-2.5",
      )}>
        {collapsed ? (
          <button
            onClick={onToggleCollapse}
            className="flex size-9 items-center justify-center rounded-lg text-foreground/85 hover:bg-foreground/[0.06] hover:text-foreground transition-colors group relative"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <SnapServeIcon size={22} className="shrink-0" />
            <span className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-background border border-border shadow-xs opacity-0 group-hover:opacity-100 transition-opacity">
              <ChevronRight className="size-2.5 text-muted-foreground" />
            </span>
          </button>
        ) : (
          <>
            <Link href="/app" onClick={onNavClick} className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
              {partnerCtx?.branding ? (
                <>
                  {partnerCtx.branding.logoUrl ? (
                    <img
                      src={partnerCtx.branding.logoUrl}
                      alt={partnerCtx.branding.companyName}
                      className="size-6 shrink-0 rounded-md bg-elevated object-contain"
                    />
                  ) : (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-background text-[11px] font-semibold">
                      {partnerCtx.branding.companyName.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span
                    className="truncate text-[13px] font-semibold leading-none text-foreground"
                    style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "-0.02em" }}
                  >
                    {partnerCtx.branding.companyName}
                  </span>
                </>
              ) : (
                <>
                  <SnapServeIcon size={24} className="shrink-0 self-center text-foreground" />
                  <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
                    <span
                      className="whitespace-nowrap text-[15px] leading-none text-foreground"
                      style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "-0.02em" }}
                      aria-label="SnapServe"
                    >
                      <span style={{ fontWeight: 700 }}>Snap</span>
                      <span style={{ fontWeight: 400, opacity: 0.72 }}>Serve</span>
                    </span>
                  </span>
                  {partnerCtx?.isPartner && (
                    <span className="shrink-0 self-center rounded border border-emerald-500/25 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider leading-none text-emerald-600">
                      Partner
                    </span>
                  )}
                </>
              )}
            </Link>
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="shrink-0 rounded-md p-1 text-muted-foreground/55 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                title="Collapse sidebar"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Search */}
      <div className="shrink-0 px-2 pt-2 pb-1">
        <button
          onClick={onSearchOpen}
          title={collapsed ? "Search (⌘K)" : undefined}
          className={cn(
            "flex h-9 w-full items-center rounded-md text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground",
            collapsed ? "justify-center px-0" : "gap-2.5 px-2.5"
          )}
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search…</span>
              <kbd className="rounded border border-border bg-background px-1 py-0.5 text-[10px] font-medium text-muted-foreground">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      {/* + New agent CTA */}
      <div className="shrink-0 px-2 pb-2">
        <button
          type="button"
          onClick={() => { onNavClick?.(); onNewAgent?.(); }}
          title={collapsed ? "New agent" : undefined}
          className={cn(
            "flex h-9 w-full cursor-pointer select-none items-center rounded-md bg-primary text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90",
            collapsed ? "justify-center px-0" : "gap-2.5 px-2.5"
          )}
        >
          <Plus className="size-4 shrink-0" />
          {!collapsed && <span>New agent</span>}
        </button>
      </div>

      {/* Primary nav — scrollbar hidden for sleek collapsed icons */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1 scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {navGroups.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <div className={collapsed ? "h-1.5" : "h-3"} />}

            {/* Group label */}
            {group.group && !collapsed && (
              <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground select-none">
                {group.group}
              </p>
            )}

            <div className="flex flex-col gap-px">
              {group.items.map(item => (
                <NavItemEl
                  key={item.href}
                  item={item}
                  collapsed={collapsed}
                  onClick={onNavClick}
                  badge={item.callbackBadge ? pendingCallbacks : 0}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Settings divider */}
        <div className={collapsed ? "h-1.5" : "h-3"} />

        {/* Settings toggle */}
        <button
          onClick={toggleSettings}
          title={collapsed ? "Settings" : undefined}
          className={cn(
            "flex h-9 w-full cursor-pointer select-none items-center rounded-md text-[13px] transition-colors duration-100",
            collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
            isInSettings
              ? "bg-foreground/[0.08] text-foreground font-medium"
              : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
          )}
        >
          <SettingsIcon className={`size-4 shrink-0 ${isInSettings ? "text-foreground" : "text-muted-foreground"}`} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Settings</span>
              <ChevronDown className={`size-3.5 text-muted-foreground transition-transform duration-150 ${settingsOpen ? "rotate-180" : ""}`} />
            </>
          )}
        </button>

        {/* Settings items */}
        {settingsOpen && !collapsed && (
          <div className="ml-2.5 mt-0.5 flex flex-col gap-px border-l border-sidebar-border pl-2.5">
            {settingsItems.map(item => (
              <NavItemEl key={item.href} item={item} collapsed={false} indent onClick={onNavClick} />
            ))}
          </div>
        )}
        {settingsOpen && collapsed && (
          <div className="flex flex-col gap-px mt-0.5">
            {settingsItems.map(item => (
              <NavItemEl key={item.href} item={item} collapsed onClick={onNavClick} />
            ))}
          </div>
        )}
      </div>

      {/* Quiet account footer */}
      <div className="shrink-0 border-t border-sidebar-border px-2 pt-1">
        {/* Partner white-label */}
        {partnerCtx?.branding && (
          <div className="pt-1.5 flex items-center gap-2 px-2.5">
            {partnerCtx.branding.logoUrl && (
              <img src={partnerCtx.branding.logoUrl} alt="" className="h-4 w-4 rounded object-contain shrink-0" />
            )}
            {!collapsed && (
              <span className="text-[10px] text-muted-foreground/55 truncate">
                Powered by {partnerCtx.branding.companyName}
              </span>
            )}
          </div>
        )}
        <div className="pb-0.5">
          {!clientSurface && (
            <Link
              href="/docs"
              onClick={onNavClick}
              title={collapsed ? "Documentation" : undefined}
              className={cn(
                "flex h-9 w-full items-center rounded-md text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground",
                collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
              )}
            >
              <KnowledgeIcon className="size-4 shrink-0 text-muted-foreground" />
              {!collapsed && <span>Documentation</span>}
            </Link>
          )}
        </div>

        {/* Wallet chip */}
        <div className="pb-1 px-0">
          <WalletChip compact={collapsed} />
        </div>

        {/* User profile */}
        <div className="pb-1.5">
          <SidebarUser collapsed={collapsed} />
        </div>
      </div>
    </div>
  );
}

/* ─── Mobile bottom nav ──────────────────────────────────────────────────── */
const MOBILE_BOTTOM_NAV_ITEMS = [
  { name: "Home",      href: "/app/home",       icon: HomeIcon },
  { name: "Campaigns", href: "/app/campaigns",  icon: CampaignsIcon },
  { name: "Create",    href: null,              icon: CreateIcon }, // opens modal
  { name: "Agents",    href: "/app/agents",     icon: AgentIcon },
  { name: "Call logs", href: "/app/history",    icon: HistoryIcon },
] as const;

function MobileBottomNav({ onNewAgent }: { onNewAgent?: () => void }) {
  const [location] = useLocation();
  const items = [...MOBILE_BOTTOM_NAV_ITEMS];
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-sidebar/95 backdrop-blur-md pb-safe"
      aria-label="Primary"
    >
      <div className={cn("grid h-14", items.length === 4 ? "grid-cols-4" : "grid-cols-5")}>
        {items.map((item) => {
          if (item.href === null) {
            return (
              <button
                key={item.name}
                type="button"
                onClick={() => onNewAgent?.()}
                className="flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-muted-foreground/70"
              >
                <item.icon className="h-5 w-5" />
                <span className="text-[10px] font-medium leading-none">{item.name}</span>
              </button>
            );
          }
          const active = location.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className="flex flex-col items-center justify-center gap-0.5 min-h-[44px]">
              <item.icon className={cn("h-5 w-5", active ? "text-foreground" : "text-muted-foreground/70")} />
              <span className={cn("text-[10px] font-medium leading-none", active ? "text-foreground" : "text-muted-foreground/70")}>
                {item.name}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ─── New-agent choice modal ─────────────────────────────────────────────── */
function NewAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const { isManagedWorkspace } = usePartnerManagedWorkspace();

  const goManual = () => { onClose(); navigate("/app/agents?create=1"); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Create a new agent</DialogTitle>
        </DialogHeader>
        {isManagedWorkspace ? (
          <>
            <p className="text-[13px] text-muted-foreground -mt-1">
              Open the builder to configure your agent.
            </p>
            <Button className="w-full mt-1" onClick={goManual}>
              <Wrench className="w-4 h-4 mr-2" /> Open builder
            </Button>
          </>
        ) : (
        <>
        <p className="text-[13px] text-muted-foreground -mt-1">
          Choose how you'd like to build your agent.
        </p>
        <div className="grid grid-cols-2 gap-3 pt-1">
          {/* Vibe Build */}
          <button
            type="button"
            onClick={() => { onClose(); navigate("/app/vibe"); }}
            className="flex flex-col items-start gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-primary/5 transition-colors text-left group"
          >
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <Wand2 className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-foreground">Vibe Build</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">AI builds it for you in minutes</p>
            </div>
          </button>
          {/* Manual Build */}
          <button
            type="button"
            onClick={goManual}
            className="flex flex-col items-start gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-primary/5 transition-colors text-left group"
          >
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center group-hover:bg-muted/80 transition-colors">
              <Wrench className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-foreground">Manual Build</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">Configure every detail yourself</p>
            </div>
          </button>
        </div>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── Voice-a-thon Top Notification Banner ───────────────────────────────── */
function VoiceathonTopBanner() {
  const { data: partnerCtx } = usePartnerContext();
  const actingAs = loadActingAs();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("voiceathon_banner_dismissed") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    // Hide SnapServe promo on white-label / partner-client / acting-as workspaces.
    if (partnerCtx?.branding || partnerCtx?.isManagedClient || actingAs) return;
    const scriptId = "luma-checkout";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://embed.lu.ma/checkout-button.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, [partnerCtx?.branding, partnerCtx?.isManagedClient, actingAs?.clientId]);

  // Hide SnapServe promo on white-label / partner-client / acting-as workspaces.
  if (partnerCtx?.branding || partnerCtx?.isManagedClient || actingAs || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem("voiceathon_banner_dismissed", "true"); } catch {}
  };

  return (
    <div className="relative z-40 bg-gradient-to-r from-amber-500/20 via-purple-600/20 to-blue-600/20 border-b border-amber-500/30 px-3 py-2 text-xs md:text-sm text-foreground flex items-center justify-between gap-3 backdrop-blur-md shadow-sm shrink-0">
      <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold text-[11px] uppercase tracking-wider shrink-0 border border-amber-500/30">
          🎙️ Live Event
        </span>
        <span className="truncate font-medium text-foreground/90">
          India's biggest Voice-a-thon powered by <strong className="text-amber-400 font-semibold">VoBiz</strong> & organized by <strong className="text-purple-400 font-semibold">SnapServe</strong> — Please register now!
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <a
          href="https://luma.com/event/evt-rA5tJIW6SmKBcGQ"
          className="luma-checkout--button inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs transition-colors shadow-sm cursor-pointer"
          data-luma-action="checkout"
          data-luma-event-id="evt-rA5tJIW6SmKBcGQ"
        >
          Register for Event
        </a>
        <button
          onClick={handleDismiss}
          className="p-1 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          title="Dismiss notification"
          aria-label="Dismiss notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/* ─── Mobile topbar user (only for mobile header) ────────────────────────── */
function MobileTopbarUser() {
  const { signOut, user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const email    = user?.email ?? "";
  const name     = user?.name ?? (email ? email.split("@")[0]! : "Account");
  const initials = (name?.[0] ?? email[0] ?? "A").toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent transition-colors"
      >
        <div className="w-6 h-6 rounded-md bg-elevated border border-border flex items-center justify-center shrink-0">
          <span className="text-[10px] font-semibold text-foreground/70">{initials}</span>
        </div>
        <ChevronDown className={`w-3 h-3 text-muted-foreground/40 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 w-[200px] rounded-xl border border-border bg-popover shadow-xl overflow-hidden z-50">
            <div className="px-3.5 py-2.5 border-b border-border">
              <p className="text-[12.5px] font-semibold text-foreground truncate">{name}</p>
              {email && <p className="text-[10.5px] text-muted-foreground/60 truncate mt-0.5">{email}</p>}
            </div>
            <Link href="/app/settings">
              <button type="button" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3.5 py-2.5 w-full text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <SettingsIcon className="w-3.5 h-3.5" />Settings
              </button>
            </Link>
            <button type="button" onClick={() => { setTheme(theme === "dark" ? "light" : "dark"); setOpen(false); }} className="flex items-center gap-2.5 px-3.5 py-2.5 w-full text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              {theme === "dark" ? "Light appearance" : "Dark appearance"}
            </button>
            <button onClick={() => { void signOut(); setOpen(false); }} className="flex items-center gap-2.5 px-3.5 py-2.5 w-full text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              <LogOut className="w-3.5 h-3.5" />Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Layout ─────────────────────────────────────────────────────────────── */
export function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const { data: partnerCtx } = usePartnerContext();
  const queryClient = useQueryClient();

  // Partner acting-as-client mode (sessionStorage-backed; survives reloads
  // and the builder's /app/agents/:id navigation).
  const [actingAs, setActingAs] = useState(loadActingAs);
  useEffect(() => { setActingAs(loadActingAs()); }, [location]);
  // Safety: only partners may act as a client (e.g. stale sessionStorage).
  useEffect(() => {
    if (actingAs && partnerCtx && !partnerCtx.isPartner) {
      stopActingAs();
      setActingAs(null);
      queryClient.clear();
    }
  }, [actingAs, partnerCtx, queryClient]);
  const exitActingAs = () => {
    stopActingAs();
    setActingAs(null);
    queryClient.clear();
    navigate("/app/partner");
  };

  const { open: searchOpen, setOpen: setSearchOpen } = useGlobalSearchTrigger();

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(LS_COLLAPSED) === "true"; } catch { return false; }
  });

  const toggleCollapse = () => {
    setCollapsed(v => {
      const next = !v;
      try { localStorage.setItem(LS_COLLAPSED, String(next)); } catch {}
      return next;
    });
  };

  const sidebarW = collapsed ? "w-[58px]" : "w-[216px]";
  const openNewAgent = () => setNewAgentOpen(true);

  return (
    <div className="flex h-dvh h-screen w-full overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex flex-col shrink-0 transition-all duration-200 ease-in-out overflow-hidden ${sidebarW}`}>
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onSearchOpen={() => setSearchOpen(true)}
          onNewAgent={openNewAgent}
        />
      </aside>

      {/* Mobile header + drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <div
          className="md:hidden flex items-center h-[50px] px-3 shrink-0 fixed top-0 left-0 right-0 z-30 bg-sidebar/95 backdrop-blur-md border-b border-sidebar-border"
          style={{ paddingTop: "env(safe-area-inset-top, 0px)", height: "calc(50px + env(safe-area-inset-top, 0px))" }}
        >
          <SheetTrigger asChild>
            <button
              type="button"
              className="touch-target flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <Link href="/app" className="ml-1 flex items-center gap-1.5 min-w-0">
            {partnerCtx?.branding ? (
              <span className="leading-none text-[13px] text-foreground truncate font-semibold">
                {partnerCtx.branding.companyName}
              </span>
            ) : (
              <>
                <SnapServeIcon size={22} className="text-foreground shrink-0" />
                <span className="flex flex-col min-w-0 leading-none gap-0.5">
                  <span className="text-[13px] text-foreground truncate" style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "-0.02em" }}>
                    <span style={{ fontWeight: 700 }}>Snap</span>
                    <span style={{ fontWeight: 400, opacity: 0.55 }}>Serve</span>
                  </span>
                </span>
              </>
            )}
          </Link>
          <div className="ml-auto flex items-center gap-0.5">
            <ThemeToggle />
            <MobileTopbarUser />
          </div>
        </div>

        <SheetContent side="left" className="p-0 w-[min(100vw,280px)]">
          <SidebarContent
            collapsed={false}
            onNavClick={() => setMobileOpen(false)}
            onSearchOpen={() => { setMobileOpen(false); setSearchOpen(true); }}
            onNewAgent={() => { setMobileOpen(false); openNewAgent(); }}
          />
        </SheetContent>
      </Sheet>

      {/* Main */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-background pt-[calc(50px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:pb-0">
        {/* Partner acting-as-client banner */}
        {actingAs && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30">
            <PartnerIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-[12.5px] text-foreground truncate">
              Viewing{" "}
              <span className="font-semibold">{actingAs.clientName}</span>
              {" "}— edit agents & campaigns here. Fund wallet and assign new numbers from Partner Hub.
            </p>
            <button
              type="button"
              onClick={exitActingAs}
              className="ml-auto shrink-0 text-[12px] font-medium px-2.5 py-1 rounded-md border border-border bg-card hover:bg-accent transition-colors cursor-pointer"
            >
              Exit to Partner Hub
            </button>
          </div>
        )}

        {/* Voice-a-thon top notification */}
        <VoiceathonTopBanner />

        {/* Utility strip — desktop only; hide on full-bleed vibe surface */}
        {!location.startsWith("/app/vibe") && (
          <div className="hidden md:block">
            <UtilityStrip />
          </div>
        )}

        {/* Scrollable content — flex so h-full / lockScroll pages can fill; overflow so long pages scroll */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
          <ErrorBoundary location={location}>
            {children}
          </ErrorBoundary>
        </div>
      </main>

      <MobileBottomNav onNewAgent={openNewAgent} />

      <NewAgentModal open={newAgentOpen} onClose={() => setNewAgentOpen(false)} />

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
