import React, { useState, useEffect, Component } from "react";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/components/theme-provider";
import { GlobalSearch, useGlobalSearchTrigger } from "@/components/GlobalSearch";
import {
  Home, Users, Zap, CalendarDays, Brain, Phone,
  Settings, Key, Webhook, Wallet, TrendingUp, ShieldCheck,
  Mic2, Menu, ChevronDown, ChevronLeft, ChevronRight,
  LogOut, Bell, Search, SlidersHorizontal, BookOpen, PhoneMissed, PlugZap, Sun, Moon, Sparkles,
  ArrowRightLeft, Instagram, FileSpreadsheet, MessageCircle,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { useGetWallet } from "@workspace/api-client-react";
import { useMinuteRatesMap, useUserProviderNames } from "@/hooks/use-minute-rates";
import { SnapServeIcon } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

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
const LS_COLLAPSED    = "snapserve:sidebar-collapsed";
const LS_SETTINGS     = "snapserve:settings-open";

const NAV_PRIMARY = [
  { name: "Home",            href: "/app/home",            icon: Home },
  { name: "Agents",          href: "/app/agents",          icon: Users },
  { name: "Vibe Build",      href: "/app/vibe",            icon: Sparkles },
  { name: "Agent Knowledge", href: "/app/knowledge-bases", icon: BookOpen },
  { name: "Campaigns",       href: "/app/campaigns",       icon: Zap },
  { name: "Automatic Calls", href: "/app/automatic-calls", icon: FileSpreadsheet },
  { name: "Meta Leads",      href: "/app/meta-leads",      icon: Instagram },
  { name: "Connections",     href: "/app/connections",     icon: PlugZap },
  { name: "WhatsApp",        href: "/app/whatsapp",        icon: MessageCircle },
  { name: "Scheduling",      href: "/app/scheduling",      icon: CalendarDays },
  { name: "Memory / CRM",    href: "/app/memory",          icon: Brain },
  { name: "Call Logs",       href: "/app/calls",           icon: Phone },
  { name: "Callbacks",       href: "/app/callbacks",       icon: PhoneMissed },
  { name: "Transfers",       href: "/app/transfers",       icon: ArrowRightLeft },
];

const NAV_SETTINGS = [
  { name: "Overview",      href: "/app/settings",      icon: Settings },
  { name: "Providers",     href: "/app/providers",     icon: Key },
  { name: "Voices",        href: "/app/voices",        icon: Mic2 },
  { name: "Phone Numbers", href: "/app/phone-numbers", icon: Phone },
  { name: "Verification",  href: "/app/kyc",           icon: ShieldCheck },
  { name: "API Keys",      href: "/app/api-keys",      icon: Key },
  { name: "Call webhooks", href: "/app/webhooks",      icon: Webhook },
  { name: "Wallet",        href: "/app/wallet",        icon: Wallet },
  { name: "Usage",         href: "/app/usage",         icon: TrendingUp },
];

const ROUTE_TITLES: [string, string][] = [
  ["/app/home",            "Home"],
  ["/app/command-center",  "Home"],
  ["/app/vibe",            "Vibe Build"],
  ["/app/agents",          "Agents"],
  ["/app/knowledge-bases", "Agent Knowledge"],
  ["/app/campaigns",       "Campaigns"],
  ["/app/automatic-calls", "Automatic Calls"],
  ["/app/connections",     "Connections"],
  ["/app/whatsapp",        "WhatsApp"],
  ["/app/scheduling",      "Scheduling"],
  ["/app/memory",          "Memory / CRM"],
  ["/app/calls",           "Call Logs"],
  ["/app/callbacks",       "Callbacks"],
  ["/app/providers",       "Providers"],
  ["/app/voices",          "Voices"],
  ["/app/phone-numbers",   "Phone Numbers"],
  ["/app/kyc",             "Verification"],
  ["/app/api-keys",        "API Keys"],
  ["/app/webhooks",        "Call webhooks"],
  ["/app/wallet",          "Wallet"],
  ["/app/usage",           "Usage"],
  ["/app/settings",        "Settings"],
  ["/app/test-simulator",  "Test Simulator"],
  ["/app/meta-leads",      "Meta Leads"],
  ["/app/transfers",       "Transfers"],
  ["/app/analytics",       "Analytics"],
];

function getPageTitle(location: string): string {
  const match = ROUTE_TITLES.find(([prefix]) => location.startsWith(prefix));
  return match?.[1] ?? "SnapServe";
}

/* ─── Wallet chip ────────────────────────────────────────────────────────── */
function WalletChip() {
  const { data: wallet } = useGetWallet();
  const cents = wallet?.balanceCents ?? null;
  const rateMap = useMinuteRatesMap();
  const userProviders = useUserProviderNames();

  // balanceCents is INR paise; rate is paise/min (₹5 = 500)
  const rateCentsPerMin = rateMap.get(userProviders.size > 0 ? "byop" : "managed") ?? 500;

  const availMins = cents !== null ? Math.floor(cents / rateCentsPerMin) : null;

  const { ring, text, bar } =
    cents === null
      ? { ring: "border-border",          text: "text-muted-foreground", bar: "bg-border" }
      : cents >= 50_000 // ≥ ₹500
      ? { ring: "border-emerald-500/30",  text: "text-emerald-400",      bar: "bg-emerald-500" }
      : cents >= 10_000 // ≥ ₹100
      ? { ring: "border-amber-500/30",    text: "text-amber-400",        bar: "bg-amber-500" }
      : { ring: "border-red-500/30",      text: "text-red-400",          bar: "bg-red-500" };

  // Progress fills toward ₹1,000 (100_000 paise)
  const pct = cents === null ? 0 : Math.min(100, (cents / 100_000) * 100);

  return (
    <Link href="/app/wallet">
      <div className={`flex items-center gap-1.5 px-2.5 py-[7px] rounded-lg border ${ring} bg-elevated/40 cursor-pointer hover:bg-elevated transition-colors`}>
        <Wallet className={`w-3 h-3 shrink-0 ${text}`} />
        <div className="flex flex-col gap-[3px]">
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
      </div>
    </Link>
  );
}

/* ─── Notification bell ──────────────────────────────────────────────────── */
function BellButton() {
  return (
    <button className="p-2 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors relative">
      <Bell className="w-[15px] h-[15px]" />
    </button>
  );
}

/* ─── Topbar user menu ───────────────────────────────────────────────────── */
function TopbarUser() {
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
        <span className="hidden sm:block text-[12.5px] font-medium text-foreground max-w-[110px] truncate">{name}</span>
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
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3.5 py-2.5 w-full text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
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

/* ─── Topbar ─────────────────────────────────────────────────────────────── */
function Topbar({ location }: { location: string }) {
  return (
    <div className="shrink-0 h-[50px] flex items-center justify-between px-5 border-b border-border bg-background gap-4">
      <span className="text-[13px] font-semibold text-foreground/70 truncate">{getPageTitle(location)}</span>

      <div className="flex items-center gap-1">
        <WalletChip />
        <ThemeToggle />
        <BellButton />
        <TopbarUser />
      </div>
    </div>
  );
}

/* ─── Single nav item ────────────────────────────────────────────────────── */
function NavItem({
  item, collapsed, indent = false, onClick,
}: {
  item: { name: string; href: string; icon: React.ElementType };
  collapsed: boolean;
  indent?: boolean;
  onClick?: () => void;
}) {
  const [location] = useLocation();
  const isActive = location.startsWith(item.href) && item.href !== "/app";

  return (
    <Link href={item.href} onClick={onClick}>
      <div
        className={[
          "flex items-center gap-2.5 rounded-lg text-[13px] transition-colors duration-100 cursor-pointer select-none",
          indent ? "px-2.5 py-[5.5px]" : "px-2.5 py-[6.5px]",
          isActive
            ? "bg-accent text-foreground font-medium"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        ].join(" ")}
      >
        <item.icon
          className={`w-[14px] h-[14px] shrink-0 ${isActive ? "text-foreground/70" : "text-muted-foreground/70"}`}
        />
        {!collapsed && <span className="truncate">{item.name}</span>}
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
}: {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onNavClick?: () => void;
  onSearchOpen?: () => void;
}) {
  const [location] = useLocation();
  const isInSettings =
    location.startsWith("/app/settings") ||
    NAV_SETTINGS.some(s => location.startsWith(s.href));

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

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border">
      {/* Logo row */}
      <div className="flex items-center h-[50px] px-3 shrink-0 border-b border-sidebar-border gap-1.5">
        <Link href="/app" onClick={onNavClick} className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
          <SnapServeIcon size={24} className="text-foreground shrink-0" />
          {!collapsed && (
            <span
              className="leading-none text-[14px] text-foreground whitespace-nowrap"
              style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "-0.02em" }}
            >
              <span style={{ fontWeight: 700 }}>Snap</span>
              <span style={{ fontWeight: 400, opacity: 0.5 }}>Serve</span>
            </span>
          )}
        </Link>

        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded-md text-muted-foreground/55 hover:text-muted-foreground hover:bg-accent/50 transition-colors shrink-0"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed
              ? <ChevronRight className="w-3.5 h-3.5" />
              : <ChevronLeft  className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-2 pt-2.5 pb-1 shrink-0">
        <button
          onClick={onSearchOpen}
          className="flex items-center gap-2.5 px-2.5 py-[6.5px] rounded-lg text-[13px] text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors w-full"
        >
          <Search className="w-[14px] h-[14px] shrink-0 text-muted-foreground/70" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search…</span>
              <kbd className="text-[9px] font-medium px-1.5 py-0.5 rounded border border-border bg-elevated text-muted-foreground/40">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      {/* Primary nav */}
      <div className="flex-1 overflow-y-auto px-2 py-1 min-h-0">
        {!collapsed && (
          <p className="px-2.5 mb-1.5 mt-1 text-[9.5px] font-semibold tracking-[0.1em] uppercase text-muted-foreground/55 select-none">
            Navigation
          </p>
        )}
        <div className="flex flex-col gap-px">
          {NAV_PRIMARY.map(item => (
            <NavItem key={item.href} item={item} collapsed={collapsed} onClick={onNavClick} />
          ))}
        </div>

        {/* Settings divider */}
        <div className="my-2.5 border-t border-sidebar-border mx-1" />

        {/* Settings toggle */}
        <button
          onClick={toggleSettings}
          className={[
            "flex items-center gap-2.5 px-2.5 py-[6.5px] rounded-lg text-[13px] transition-colors duration-100 cursor-pointer select-none w-full",
            isInSettings
              ? "text-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          ].join(" ")}
        >
          <SlidersHorizontal className={`w-[14px] h-[14px] shrink-0 ${isInSettings ? "text-foreground/70" : "text-muted-foreground/70"}`} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Settings</span>
              <ChevronDown
                className={`w-3 h-3 text-muted-foreground/55 transition-transform duration-150 ${settingsOpen ? "rotate-180" : ""}`}
              />
            </>
          )}
        </button>

        {/* Settings items */}
        {settingsOpen && !collapsed && (
          <div className="mt-0.5 ml-2.5 pl-3 border-l border-sidebar-border flex flex-col gap-px">
            {NAV_SETTINGS.map(item => (
              <NavItem key={item.href} item={item} collapsed={false} indent onClick={onNavClick} />
            ))}
          </div>
        )}
        {settingsOpen && collapsed && (
          <div className="flex flex-col gap-px mt-0.5">
            {NAV_SETTINGS.map(item => (
              <NavItem key={item.href} item={item} collapsed onClick={onNavClick} />
            ))}
          </div>
        )}
      </div>

      {/* Docs shortcut */}
      <div className="px-2 pb-1.5 shrink-0">
        <Link
          href="/docs"
          onClick={onNavClick}
          className="flex items-center gap-2.5 px-2.5 py-[6.5px] rounded-lg text-[13px] text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors duration-100 w-full"
        >
          <BookOpen className="w-[14px] h-[14px] shrink-0 text-muted-foreground/70" />
          {!collapsed && <span>Documentation</span>}
        </Link>
      </div>

      {/* Footer */}
      <div className="px-2 pb-2.5 pt-2 shrink-0 border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500/50 shrink-0" />
          {!collapsed && (
            <span className="text-[10.5px] text-muted-foreground/55">All systems operational</span>
          )}
        </div>
        {!collapsed && (
          <div className="flex items-center gap-2 px-2.5 py-0.5">
            <Link href="/privacy" className="text-[10px] text-muted-foreground/30 hover:text-muted-foreground/50 transition-colors">Privacy</Link>
            <span className="text-muted-foreground/20">·</span>
            <Link href="/terms"   className="text-[10px] text-muted-foreground/30 hover:text-muted-foreground/50 transition-colors">Terms</Link>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Mobile bottom nav ──────────────────────────────────────────────────── */
const MOBILE_BOTTOM_NAV = [
  { name: "Home",    href: "/app/home", icon: Home },
  { name: "Vibe",    href: "/app/vibe",           icon: Sparkles },
  { name: "Agents",  href: "/app/agents",         icon: Users },
  { name: "Calls",   href: "/app/calls",          icon: Phone },
  { name: "Wallet",  href: "/app/wallet",         icon: Wallet },
] as const;

function MobileBottomNav() {
  const [location] = useLocation();
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-sidebar/95 backdrop-blur-md pb-safe"
      aria-label="Primary"
    >
      <div className="grid grid-cols-5 h-14">
        {MOBILE_BOTTOM_NAV.map((item) => {
          const active =
            item.href === "/app/agents"
              ? location.startsWith("/app/agents")
              : location.startsWith(item.href);
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

/* ─── Layout ─────────────────────────────────────────────────────────────── */
export function Layout({ children }: { children: React.ReactNode }) {
  const [location]  = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
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

  const sidebarW = collapsed ? "w-[52px]" : "w-[220px]";

  return (
    <div className="flex h-dvh h-screen w-full overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col shrink-0 transition-all duration-200 ease-in-out overflow-hidden ${sidebarW}`}
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onSearchOpen={() => setSearchOpen(true)}
        />
      </aside>

      {/* Mobile header + drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <div className="md:hidden flex items-center h-[50px] px-3 shrink-0 fixed top-0 left-0 right-0 z-30 bg-sidebar/95 backdrop-blur-md border-b border-sidebar-border" style={{ paddingTop: "env(safe-area-inset-top, 0px)", height: "calc(50px + env(safe-area-inset-top, 0px))" }}>
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
            <SnapServeIcon size={20} className="text-foreground shrink-0" />
            <span className="leading-none text-[13px] text-foreground truncate" style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "-0.02em" }}>
              <span style={{ fontWeight: 700 }}>Snap</span>
              <span style={{ fontWeight: 400, opacity: 0.55 }}>Serve</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-0.5">
            <WalletChip />
            <ThemeToggle />
            <TopbarUser />
          </div>
        </div>

        <SheetContent side="left" className="p-0 w-[min(100vw,280px)]">
          <SidebarContent
            collapsed={false}
            onNavClick={() => setMobileOpen(false)}
            onSearchOpen={() => { setMobileOpen(false); setSearchOpen(true); }}
          />
        </SheetContent>
      </Sheet>

      {/* Main */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-background pt-[calc(50px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:pb-0">
        {/* Topbar — desktop only */}
        <div className="hidden md:block">
          <Topbar location={location} />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0 overscroll-y-contain">
          <ErrorBoundary location={location}>
            {children}
          </ErrorBoundary>
        </div>
      </main>

      <MobileBottomNav />

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
