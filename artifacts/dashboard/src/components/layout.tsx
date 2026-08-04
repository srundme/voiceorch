import React, { useState, useEffect, Component } from "react";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/components/theme-provider";
import { GlobalSearch, useGlobalSearchTrigger } from "@/components/GlobalSearch";
import {
  Home, Bot, Phone, Hash, Workflow, Radio,
  Settings, Wallet, Mic2, Key,
  Menu, ChevronDown, ChevronLeft, ChevronRight,
  LogOut, Bell, Search, SlidersHorizontal, BookOpen, PlugZap, Sun, Moon, Sparkles,
  Plus, X, Wand2, Wrench, Megaphone, Calendar, Video, MessageCircle,
  Brain, Users, BarChart3,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetWallet, customFetch } from "@workspace/api-client-react";
import { useMinuteRatesMap, useUserProviderNames } from "@/hooks/use-minute-rates";
import { SnapServeIcon, PoweredBySarvam } from "@/components/logo";
import { Handshake } from "lucide-react";
import { usePartnerContext } from "@/hooks/use-partner";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { loadActingAs, stopActingAs } from "@/lib/acting-as";
import { SarvamFamilyAnnouncement } from "@/components/sarvam-family-announcement";

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
 * Full-page Stripe IA (see docs/snapserve-agent-centric-ia.md).
 * Builder = agent runtime only; Automation / Channels are separate Operate surfaces.
 * Every product surface is first-class in the sidebar.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { name: "Home",   href: "/app/home",   icon: Home },
      { name: "Agents", href: "/app/agents", icon: Bot },
    ],
  },
  {
    group: "OPERATE",
    items: [
      { name: "Campaign Studios",    href: "/app/campaigns",     icon: Megaphone },
      { name: "Automation",    href: "/app/automation",    icon: Workflow },
      { name: "Phone Numbers", href: "/app/phone-numbers", icon: Hash },
      { name: "Activity",       href: "/app/calls",         icon: Phone, callbackBadge: true },
    ],
  },
  {
    group: "CONNECT",
    items: [
      { name: "Integrations", href: "/app/connections",  icon: PlugZap },
      { name: "Scheduling",   href: "/app/scheduling",   icon: Calendar },
      { name: "Meet",         href: "/app/meet",         icon: Video },
    ],
  },
  {
    group: "INTELLIGENCE",
    items: [
      { name: "Knowledge",  href: "/app/knowledge-bases", icon: BookOpen },
      { name: "Memory",     href: "/app/memory",          icon: Brain },
      { name: "Squads",     href: "/app/squads",          icon: Users },
      { name: "Analytics",  href: "/app/analytics",       icon: BarChart3 },
    ],
  },
];

/**
 * Managed clients (accounts run by a partner) get a trimmed surface: the
 * partner builds agents and buys numbers on their behalf, so build/outreach
 * sections disappear. Server-side enforcement backs this up — this is UX,
 * not the security boundary.
 */
const MANAGED_CLIENT_NAV: NavGroup[] = [
  {
    items: [
      { name: "Home",   href: "/app/home",   icon: Home },
      { name: "Agents", href: "/app/agents", icon: Bot },
    ],
  },
  {
    group: "OPERATE",
    items: [
      { name: "Activity",      href: "/app/calls",         icon: Phone, callbackBadge: true },
      { name: "Phone Numbers", href: "/app/phone-numbers", icon: Hash },
    ],
  },
];

const MANAGED_CLIENT_SETTINGS_HREFS = ["/app/settings", "/app/wallet"];

const NAV_SETTINGS: NavItem[] = [
  { name: "Workspace",  href: "/app/settings",  icon: Settings },
  { name: "Providers",  href: "/app/providers", icon: Mic2 },
  { name: "Developers", href: "/app/api-keys",  icon: Key },
  { name: "Billing",    href: "/app/wallet",    icon: Wallet },
];

const SETTINGS_HREFS = NAV_SETTINGS.map(s => s.href);

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
      ? { ring: "border-border",         text: "text-muted-foreground", bar: "bg-border" }
      : cents >= 50_000
      ? { ring: "border-emerald-500/30", text: "text-emerald-400",      bar: "bg-emerald-500" }
      : cents >= 10_000
      ? { ring: "border-amber-500/30",   text: "text-amber-400",        bar: "bg-amber-500" }
      : { ring: "border-red-500/30",     text: "text-red-400",          bar: "bg-red-500" };

  const pct = cents === null ? 0 : Math.min(100, (cents / 100_000) * 100);

  return (
    <Link href="/app/wallet">
      <div className={`flex items-center gap-1.5 px-2.5 py-[7px] rounded-lg border ${ring} bg-elevated/40 cursor-pointer hover:bg-elevated transition-colors w-full`}>
        <Wallet className={`w-3 h-3 shrink-0 ${text}`} />
        {!compact && (
          <div className="flex flex-col gap-[3px] flex-1 min-w-0">
            {cents !== null ? (
              <div className="flex items-baseline gap-1.5">
                <span className={`text-[11px] font-semibold tabular-nums leading-none ${text}`}>
                  ₹{(cents / 100).toFixed(2)}
                </span>
                {availMins !== null && (
                  <span className={`text-[9px] leading-none tabular-nums ${text} opacity-60`}>
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

/* ─ Notification bell ───────────────────────────────────────────────────────── */
function BellButton() {
  return (
    <button className="p-2 rounded-xl text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors relative">
      <Bell className="w-4 h-4" />
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
        className="flex items-center gap-2.5 w-full p-2 rounded-xl hover:bg-accent transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <span className="text-[11px] font-bold text-primary">{initials}</span>
        </div>
        {!collapsed && (
          <>
            <span className="flex-1 text-left text-[13px] font-semibold text-foreground truncate">{name}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-full mb-2 w-[220px] rounded-2xl border border-border bg-popover shadow-xl p-1 z-50">
            <div className="px-3 py-2 border-b border-border mb-1">
              <p className="text-[13px] font-bold text-foreground truncate">{name}</p>
              {email && <p className="text-[11px] text-muted-foreground truncate">{email}</p>}
            </div>
            <Link href="/app/settings">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-3 py-2 w-full text-left text-[13px] text-muted-foreground rounded-lg hover:bg-accent hover:text-foreground transition-colors"
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
            </Link>
            <button
              type="button"
              onClick={() => {
                setTheme(theme === "dark" ? "light" : "dark");
                setOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2 w-full text-left text-[13px] text-muted-foreground rounded-lg hover:bg-accent hover:text-foreground transition-colors"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {theme === "dark" ? "Light appearance" : "Dark appearance"}
            </button>
            <button
              onClick={() => { void signOut(); setOpen(false); }}
              className="flex items-center gap-3 px-3 py-2 w-full text-left text-[13px] text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
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
    <div className="flex h-14 shrink-0 items-center justify-end gap-2 border-b border-border/50 bg-background/80 backdrop-blur-md px-6">
      <ThemeToggle />
      <BellButton />
    </div>
  );
}

/* ─ Single nav item ────────────────────────────────────────────────────────────────── */
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
  const isActive = location.startsWith(item.href) && item.href !== "/app";

  return (
    <Link href={item.href} onClick={onClick}>
      <div
        className={cn(
          "relative flex h-9 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-all duration-100 cursor-pointer select-none group",
          indent ? "pl-3" : "",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
        )}
      >
        {/* Active indicator */}
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary" />
        )}
        <item.icon
          className={cn(
            "size-4 shrink-0 transition-colors",
            isActive ? "text-primary" : "text-muted-foreground/60 group-hover:text-foreground"
          )}
        />
        {!collapsed && (
          <>
            <span className="truncate flex-1">{item.name}</span>
            {badge > 0 && (
              <span className="inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none text-white bg-amber-500 shadow-sm">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </>
        )}
        {collapsed && badge > 0 && (
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500 border border-sidebar" />
        )}
      </div>
    </Link>
  );
}

/* ─ Sidebar content ────────────────────────────────────────────────────────────────── */
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

  const { data: partnerCtx } = usePartnerContext();
  const isManagedClient = partnerCtx?.isManagedClient === true;
  const navGroups: NavGroup[] = isManagedClient
    ? MANAGED_CLIENT_NAV
    : partnerCtx?.isPartner
      ? [
          ...NAV_GROUPS,
          { group: "PARTNER", items: [{ name: "Partner Hub", href: "/app/partner", icon: Handshake }] },
        ]
      : NAV_GROUPS;
  const settingsItems: NavItem[] = isManagedClient
    ? NAV_SETTINGS.filter((s) => MANAGED_CLIENT_SETTINGS_HREFS.includes(s.href))
    : NAV_SETTINGS;

  return (
    <div className="flex h-full flex-col border-r border-sidebar-border bg-sidebar">
      {/* ── Brand / Workspace identity ── */}
      <div className={cn(
        "flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-3",
        collapsed && "justify-center px-2",
      )}>
        <Link href="/app" onClick={onNavClick} className="flex items-center gap-2.5 flex-1 min-w-0 overflow-hidden">
          {partnerCtx?.branding ? (
            <>
              {partnerCtx.branding.logoUrl ? (
                <img
                  src={partnerCtx.branding.logoUrl}
                  alt={partnerCtx.branding.companyName}
                  className="size-7 shrink-0 rounded-xl bg-elevated object-contain"
                />
              ) : (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-xl border border-sidebar-border bg-background text-[12px] font-bold">
                  {partnerCtx.branding.companyName.charAt(0).toUpperCase()}
                </span>
              )}
              {!collapsed && (
                <span className="truncate text-[14px] font-bold leading-none text-foreground tracking-tight">
                  {partnerCtx.branding.companyName}
                </span>
              )}
            </>
          ) : (
            <>
              <SnapServeIcon size={22} className="shrink-0 self-center text-foreground" />
              {!collapsed && (
                <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
                  <span
                    className="whitespace-nowrap text-[14px] leading-none text-foreground"
                    style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "-0.03em" }}
                    aria-label="SnapServe"
                  >
                    <span style={{ fontWeight: 800 }}>Snap</span>
                    <span style={{ fontWeight: 400, opacity: 0.5 }}>Serve</span>
                  </span>
                  <PoweredBySarvam variant="inline" className="justify-start" />
                </span>
              )}
              {!collapsed && partnerCtx?.isPartner && (
                <span className="shrink-0 self-center rounded-md border border-emerald-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider leading-none text-emerald-600 bg-emerald-500/10">
                  Partner
                </span>
              )}
            </>
          )}
        </Link>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* ── Search ── */}
      <div className="shrink-0 px-2.5 pt-3 pb-1">
        <button
          onClick={onSearchOpen}
          className={cn(
            "flex h-9 w-full items-center gap-2.5 rounded-xl border border-border/60 bg-muted/30 px-3 text-[12.5px] text-muted-foreground/60 transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground",
            collapsed ? "justify-center px-0" : ""
          )}
        >
          <Search className="w-3.5 h-3.5 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search…</span>
              <kbd className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground/50">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      {/* ── New agent CTA ── */}
      {!isManagedClient && (
        <div className="shrink-0 px-2.5 pb-3">
          <button
            type="button"
            onClick={() => { onNavClick?.(); onNewAgent?.(); }}
            className={cn(
              "flex h-9 w-full cursor-pointer select-none items-center gap-2.5 rounded-xl bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-all hover:bg-primary/90 shadow-sm shadow-primary/20",
              collapsed ? "justify-center" : ""
            )}
          >
            <Plus className="size-4 shrink-0" />
            {!collapsed && <span>New Agent</span>}
          </button>
        </div>
      )}

      {/* ── Primary nav ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-0.5 space-y-0.5">
        {navGroups.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <div className="h-4" />}

            {/* Group label */}
            {group.group && !collapsed && (
              <p className="mb-1.5 px-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/40 select-none">
                {group.group}
              </p>
            )}

            <div className="flex flex-col gap-0.5">
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
        <div className="h-4" />

        {/* Settings toggle */}
        <button
          onClick={toggleSettings}
          className={cn(
            "flex h-9 w-full cursor-pointer select-none items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-colors duration-100",
            isInSettings
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
          )}
        >
          <SlidersHorizontal className={cn("size-4 shrink-0", isInSettings ? "text-primary" : "text-muted-foreground/60")} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Settings</span>
              <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground/40 transition-transform duration-200", settingsOpen ? "rotate-180" : "")} />
            </>
          )}
        </button>

        {/* Settings sub-items */}
        {settingsOpen && !collapsed && (
          <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l-2 border-border/60 pl-3">
            {settingsItems.map(item => (
              <NavItemEl key={item.href} item={item} collapsed={false} indent onClick={onNavClick} />
            ))}
          </div>
        )}
        {settingsOpen && collapsed && (
          <div className="flex flex-col gap-0.5 mt-0.5">
            {settingsItems.map(item => (
              <NavItemEl key={item.href} item={item} collapsed onClick={onNavClick} />
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-sidebar-border px-2.5 py-2 space-y-1">
        {/* Partner branding */}
        {partnerCtx?.branding && (
          <div className="flex items-center gap-2 px-2.5 py-1">
            {partnerCtx.branding.logoUrl && (
              <img src={partnerCtx.branding.logoUrl} alt="" className="h-4 w-4 rounded object-contain shrink-0" />
            )}
            {!collapsed && (
              <span className="text-[10px] text-muted-foreground/50 truncate">
                Powered by {partnerCtx.branding.companyName}
              </span>
            )}
          </div>
        )}

        {/* Docs */}
        <Link
          href="/docs"
          onClick={onNavClick}
          className={cn(
            "flex h-9 w-full items-center gap-3 rounded-xl px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground",
            collapsed ? "justify-center" : ""
          )}
        >
          <BookOpen className="w-4 h-4 shrink-0 text-muted-foreground/60" />
          {!collapsed && <span>Documentation</span>}
        </Link>

        {/* Wallet chip */}
        <WalletChip compact={collapsed} />

        {/* User profile */}
        <SidebarUser collapsed={collapsed} />
      </div>
    </div>
  );
}

/* ─ Mobile bottom nav ──────────────────────────────────────────────────────────────── */
const MOBILE_BOTTOM_NAV_ITEMS = [
  { name: "Home",     href: "/app/home",   icon: Home },
  { name: "Create",   href: null,          icon: Sparkles },
  { name: "Agents",   href: "/app/agents", icon: Bot },
  { name: "Activity", href: "/app/calls",  icon: Phone },
  { name: "Wallet",   href: "/app/wallet", icon: Wallet },
] as const;

function MobileBottomNav({ onNewAgent }: { onNewAgent?: () => void }) {
  const [location] = useLocation();
  const { data: partnerCtx } = usePartnerContext();
  const items = partnerCtx?.isManagedClient === true
    ? MOBILE_BOTTOM_NAV_ITEMS.filter((i) => i.href !== null)
    : [...MOBILE_BOTTOM_NAV_ITEMS];
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-sidebar/98 backdrop-blur-xl pb-safe"
      aria-label="Primary"
    >
      <div className={cn("grid h-16", items.length === 4 ? "grid-cols-4" : "grid-cols-5")}>
        {items.map((item) => {
          if (item.href === null) {
            return (
              <button
                key={item.name}
                type="button"
                onClick={() => onNewAgent?.()}
                className="flex flex-col items-center justify-center gap-1 min-h-[44px] text-muted-foreground/70"
              >
                <div className="h-8 w-8 rounded-xl bg-primary flex items-center justify-center shadow-sm shadow-primary/30">
                  <item.icon className="h-4 w-4 text-primary-foreground" />
                </div>
                <span className="text-[9px] font-semibold leading-none text-primary">{item.name}</span>
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
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Create a new agent</DialogTitle>
        </DialogHeader>
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
            onClick={() => { onClose(); navigate("/app/agents?create=1"); }}
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
      </DialogContent>
    </Dialog>
  );
}

/* ─── Voice-a-thon Top Notification Banner ───────────────────────────────── */
function VoiceathonTopBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("voiceathon_banner_dismissed") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const scriptId = "luma-checkout";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://embed.lu.ma/checkout-button.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  if (dismissed) return null;

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
                <Settings className="w-3.5 h-3.5" />Settings
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

  // Managed clients: restricted surface — bounce hidden sections to Home.
  // (UX only; the API rejects managed-client writes server-side.)
  const isManagedClient = partnerCtx?.isManagedClient === true;
  useEffect(() => {
    if (!isManagedClient) return;
    const allowed = ["/app/home", "/app/agents", "/app/calls", "/app/phone-numbers", "/app/wallet", "/app/settings"];
    if (location === "/app" || allowed.some((p) => location === p || location.startsWith(p + "/"))) return;
    navigate("/app/home", { replace: true });
  }, [isManagedClient, location, navigate]);
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

  const sidebarW = collapsed ? "w-[56px]" : "w-[236px]";
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
                <SnapServeIcon size={20} className="text-foreground shrink-0" />
                <span className="flex flex-col min-w-0 leading-none gap-0.5">
                  <span className="text-[13px] text-foreground truncate" style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "-0.02em" }}>
                    <span style={{ fontWeight: 700 }}>Snap</span>
                    <span style={{ fontWeight: 400, opacity: 0.55 }}>Serve</span>
                  </span>
                  <PoweredBySarvam variant="inline" className="justify-start" />
                </span>
              </>
            )}
          </Link>
          <div className="ml-auto flex items-center gap-0.5">
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
            <Handshake className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-[12.5px] text-foreground truncate">
              Managing <span className="font-semibold">{actingAs.clientName}</span>'s workspace — agents, numbers and calls here belong to their account.
            </p>
            <button
              type="button"
              onClick={exitActingAs}
              className="ml-auto shrink-0 text-[12px] font-medium px-2.5 py-1 rounded-md border border-border bg-card hover:bg-accent transition-colors cursor-pointer"
            >
              Exit
            </button>
          </div>
        )}

        {/* Voice-a-thon top notification */}
        <VoiceathonTopBanner />

        {/* Utility strip removed as per user request */}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0 overscroll-y-contain">
          <ErrorBoundary location={location}>
            {children}
          </ErrorBoundary>
        </div>
      </main>

      <MobileBottomNav onNewAgent={openNewAgent} />

      <NewAgentModal open={newAgentOpen} onClose={() => setNewAgentOpen(false)} />

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      <SarvamFamilyAnnouncement />
    </div>
  );
}
