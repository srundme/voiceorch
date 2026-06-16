import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { IncomingCallNotification } from "@/components/incoming-call-notification";
import { GlobalSearch, useGlobalSearchTrigger } from "@/components/GlobalSearch";
import {
  Monitor, Users, Zap, CalendarDays, Brain, Phone,
  Settings, Key, Webhook, Wallet, TrendingUp, ShieldCheck,
  Mic2, Menu, ChevronDown, ChevronLeft, ChevronRight,
  LogOut, Bell, Search, SlidersHorizontal, BookOpen,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { useGetWallet } from "@workspace/api-client-react";
import { SnapServeIcon } from "@/components/logo";

/* ─── Constants ─────────────────────────────────────────────────────────── */
const LS_COLLAPSED    = "snapserve:sidebar-collapsed";
const LS_SETTINGS     = "snapserve:settings-open";

const NAV_PRIMARY = [
  { name: "Command Center",  href: "/app/command-center",  icon: Monitor },
  { name: "Agents",          href: "/app/agents",          icon: Users },
  { name: "Agent Knowledge", href: "/app/knowledge-bases", icon: BookOpen },
  { name: "Campaigns",       href: "/app/campaigns",       icon: Zap },
  { name: "Scheduling",      href: "/app/scheduling",      icon: CalendarDays },
  { name: "Memory / CRM",    href: "/app/memory",          icon: Brain },
  { name: "Call Logs",       href: "/app/calls",           icon: Phone },
];

const NAV_SETTINGS = [
  { name: "Providers",     href: "/app/providers",     icon: Key },
  { name: "Voices",        href: "/app/voices",        icon: Mic2 },
  { name: "Phone Numbers", href: "/app/phone-numbers", icon: Phone },
  { name: "Verification",  href: "/app/kyc",           icon: ShieldCheck },
  { name: "API Keys",      href: "/app/api-keys",      icon: Key },
  { name: "Webhooks",      href: "/app/webhooks",      icon: Webhook },
  { name: "Wallet",        href: "/app/wallet",        icon: Wallet },
  { name: "Usage",         href: "/app/usage",         icon: TrendingUp },
  { name: "General",       href: "/app/settings",      icon: Settings },
];

const ROUTE_TITLES: [string, string][] = [
  ["/app/command-center",  "Command Center"],
  ["/app/agents",          "Agents"],
  ["/app/knowledge-bases", "Agent Knowledge"],
  ["/app/campaigns",       "Campaigns"],
  ["/app/scheduling",      "Scheduling"],
  ["/app/memory",          "Memory / CRM"],
  ["/app/calls",           "Call Logs"],
  ["/app/providers",       "Providers"],
  ["/app/voices",          "Voices"],
  ["/app/phone-numbers",   "Phone Numbers"],
  ["/app/kyc",             "Verification"],
  ["/app/api-keys",        "API Keys"],
  ["/app/webhooks",        "Webhooks"],
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

  const { ring, text, bar } =
    cents === null
      ? { ring: "border-border",          text: "text-muted-foreground", bar: "bg-border" }
      : cents >= 500
      ? { ring: "border-emerald-500/30",  text: "text-emerald-400",      bar: "bg-emerald-500" }
      : cents >= 100
      ? { ring: "border-amber-500/30",    text: "text-amber-400",        bar: "bg-amber-500" }
      : { ring: "border-red-500/30",      text: "text-red-400",          bar: "bg-red-500" };

  const pct = cents === null ? 0 : Math.min(100, (cents / 1000) * 100);

  return (
    <Link href="/app/wallet">
      <div className={`flex items-center gap-1.5 px-2.5 py-[7px] rounded-lg border ${ring} bg-elevated/40 cursor-pointer hover:bg-elevated transition-colors`}>
        <Wallet className={`w-3 h-3 shrink-0 ${text}`} />
        <div className="flex flex-col gap-[3px] min-w-[44px]">
          {cents !== null ? (
            <span className={`text-[11px] font-semibold tabular-nums leading-none ${text}`}>
              ${(cents / 100).toFixed(2)}
            </span>
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
function Topbar({ location, onSearchOpen }: { location: string; onSearchOpen: () => void }) {
  return (
    <div className="shrink-0 h-[50px] flex items-center justify-between px-5 border-b border-border bg-background gap-4">
      <span className="text-[13px] font-semibold text-foreground/70 truncate">{getPageTitle(location)}</span>

      <div className="flex items-center gap-1">
        {/* Search */}
        <button
          onClick={onSearchOpen}
          className="hidden sm:flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-lg text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border border-transparent hover:border-border mr-1"
        >
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span>Search</span>
          <kbd className="ml-1 text-[9px] font-medium px-1.5 py-0.5 rounded border border-border bg-elevated text-muted-foreground/50">⌘K</kbd>
        </button>
        <button
          onClick={onSearchOpen}
          className="sm:hidden p-2 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
        >
          <Search className="w-[15px] h-[15px]" />
        </button>

        <WalletChip />
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
          className={`w-[14px] h-[14px] shrink-0 ${isActive ? "text-foreground/70" : "text-muted-foreground/45"}`}
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
  const isInSettings = NAV_SETTINGS.some(s => location.startsWith(s.href));

  const [settingsOpen, setSettingsOpen] = useState(() => {
    try { return localStorage.getItem(LS_SETTINGS) === "true"; } catch { return false; }
  });

  useEffect(() => {
    if (isInSettings && !settingsOpen) setSettingsOpen(true);
  }, [isInSettings]);

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
          {!collapsed && (
            <span className="text-[8.5px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded border border-border bg-elevated text-muted-foreground/40 whitespace-nowrap ml-0.5">
              Beta
            </span>
          )}
        </Link>

        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded-md text-muted-foreground/35 hover:text-muted-foreground hover:bg-accent/50 transition-colors shrink-0"
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
          <Search className="w-[14px] h-[14px] shrink-0 text-muted-foreground/45" />
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
          <p className="px-2.5 mb-1.5 mt-1 text-[9.5px] font-semibold tracking-[0.1em] uppercase text-muted-foreground/35 select-none">
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
          <SlidersHorizontal className={`w-[14px] h-[14px] shrink-0 ${isInSettings ? "text-foreground/70" : "text-muted-foreground/45"}`} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Settings</span>
              <ChevronDown
                className={`w-3 h-3 text-muted-foreground/35 transition-transform duration-150 ${settingsOpen ? "rotate-180" : ""}`}
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

      {/* Footer */}
      <div className="px-2 pb-2.5 pt-2 shrink-0 border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500/50 shrink-0" />
          {!collapsed && (
            <span className="text-[10.5px] text-muted-foreground/35">All systems operational</span>
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
    <div className="flex h-screen w-full overflow-hidden bg-background">
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
        <div className="md:hidden flex items-center h-[50px] px-4 shrink-0 fixed top-0 left-0 right-0 z-30 bg-sidebar border-b border-sidebar-border">
          <SheetTrigger asChild>
            <button className="p-2 rounded-lg text-muted-foreground hover:bg-accent transition-colors">
              <Menu className="h-4 w-4" />
            </button>
          </SheetTrigger>
          <Link href="/app" className="ml-2 flex items-center gap-1.5">
            <SnapServeIcon size={20} className="text-foreground shrink-0" />
            <span className="leading-none text-[13px] text-foreground" style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "-0.02em" }}>
              <span style={{ fontWeight: 700 }}>Snap</span>
              <span style={{ fontWeight: 400, opacity: 0.55 }}>Serve</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <WalletChip />
            <TopbarUser />
          </div>
        </div>

        <SheetContent side="left" className="p-0 w-[220px]">
          <SidebarContent
            collapsed={false}
            onNavClick={() => setMobileOpen(false)}
            onSearchOpen={() => { setMobileOpen(false); setSearchOpen(true); }}
          />
        </SheetContent>
      </Sheet>

      {/* Main */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-background pt-[50px] md:pt-0">
        {/* Topbar — desktop only */}
        <div className="hidden md:block">
          <Topbar location={location} onSearchOpen={() => setSearchOpen(true)} />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {children}
        </div>
      </main>

      <IncomingCallNotification />
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
