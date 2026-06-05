import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { IncomingCallNotification } from "@/components/incoming-call-notification";
import { GlobalSearch, useGlobalSearchTrigger } from "@/components/GlobalSearch";
import {
  Users, Phone, Key, Settings, Menu,
  LayoutDashboard, BarChart3, Brain,
  Wallet, LogOut, ChevronDown, AlertCircle, Webhook,
  Zap, TrendingUp, ShieldCheck,
  Mic2, FlaskConical,
  Monitor, Search, CalendarDays,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { useGetWallet } from "@workspace/api-client-react";
import { SnapServeIcon } from "@/components/logo";

/* ── Nav structure ──────────────────────────────────────────────────────── */
const NAV_SECTIONS = [
  {
    label: "Operations",
    items: [
      { name: "Command Center", href: "/app/command-center", icon: Monitor },
      { name: "Campaigns",      href: "/app/campaigns",      icon: Zap },
      { name: "Scheduling",     href: "/app/scheduling",     icon: CalendarDays },
    ],
  },
  {
    label: "Build",
    items: [
      { name: "Assistants",   href: "/app/agents",           icon: Users },
      { name: "AI Knowledge", href: "/app/knowledge-bases", icon: Brain },
      { name: "Providers",    href: "/app/providers",       icon: Key },
      { name: "Voices",       href: "/app/voices",          icon: Mic2 },
    ],
  },
  {
    label: "Observe",
    items: [
      { name: "Usage",          href: "/app/usage",          icon: TrendingUp },
      { name: "Call Log",       href: "/app/calls",          icon: Phone },
      { name: "Activity",       href: "/app/activity",       icon: LayoutDashboard },
      { name: "Test Simulator", href: "/app/test-simulator", icon: FlaskConical },
    ],
  },
  {
    label: "Platform",
    items: [
      { name: "Phone Numbers", href: "/app/phone-numbers", icon: Phone },
      { name: "Verification",  href: "/app/kyc",           icon: ShieldCheck },
      { name: "API Keys",      href: "/app/api-keys",      icon: Key },
      { name: "Webhooks",      href: "/app/webhooks",      icon: Webhook },
      { name: "Wallet",        href: "/app/wallet",        icon: Wallet },
      { name: "Settings",      href: "/app/settings",      icon: Settings },
    ],
  },
];

/* ── Nav items ──────────────────────────────────────────────────────────── */
function NavItems({ onClick }: { onClick?: () => void }) {
  const [location] = useLocation();

  return (
    <div className="flex flex-col gap-5">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="px-2.5 mb-1 text-[9px] font-semibold tracking-[0.12em] uppercase select-none text-muted-foreground/50 opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300 whitespace-nowrap overflow-hidden">
            {section.label}
          </p>
          <div className="flex flex-col gap-px">
            {section.items.map((item) => {
              const isActive = location.startsWith(item.href) && item.href !== "/app";

              return (
                <Link key={item.name} href={item.href} onClick={onClick}>
                  <div
                    className={
                      "flex items-center justify-center group-hover:justify-start gap-0 group-hover:gap-2.5 px-2.5 py-[6.5px] rounded-lg text-[13px] transition-all duration-100 cursor-pointer select-none overflow-hidden " +
                      (isActive
                        ? "bg-accent text-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground font-normal")
                    }
                  >
                    <item.icon
                      className={
                        "w-[14px] h-[14px] shrink-0 " +
                        (isActive ? "text-foreground/70" : "text-muted-foreground/50 group-hover:text-muted-foreground")
                      }
                    />
                    <span className="truncate opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300 whitespace-nowrap">{item.name}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Wallet badge ───────────────────────────────────────────────────────── */
function WalletBadge() {
  const { data: wallet } = useGetWallet();
  const [location] = useLocation();
  const isLow    = wallet && wallet.balanceCents < 100;
  const isActive = location.startsWith("/app/wallet");

  return (
    <Link href="/app/wallet">
      <div
        className={
          "flex items-center justify-center group-hover:justify-start gap-0 group-hover:gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors overflow-hidden " +
          (isActive ? "bg-accent" : "hover:bg-accent/50")
        }
      >
        <div className="h-6 w-6 rounded-md flex items-center justify-center shrink-0 bg-elevated border border-border">
          <Zap className="w-3 h-3 text-muted-foreground/60" />
        </div>
        <div className="flex-1 min-w-0 opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300 whitespace-nowrap overflow-hidden">
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">
            Balance
          </p>
          {wallet ? (
            <p className={`text-[12.5px] font-semibold tabular-nums leading-tight ${isLow ? "text-muted-foreground" : "text-foreground"}`}>
              ${(wallet.balanceCents / 100).toFixed(2)}
            </p>
          ) : (
            <div className="h-3.5 w-12 rounded animate-pulse mt-0.5 bg-elevated" />
          )}
        </div>
        <div className="opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300 whitespace-nowrap overflow-hidden">
          {isLow && <AlertCircle className="w-3 h-3 text-muted-foreground/40 shrink-0" />}
        </div>
      </div>
    </Link>
  );
}

/* ── User menu ──────────────────────────────────────────────────────────── */
function UserMenu() {
  const { signOut, user } = useAuth();
  const [open, setOpen] = useState(false);

  const email    = user?.email ?? "";
  const name     = user?.name ?? (email ? email.split("@")[0] : "Account");
  const initials = (name?.[0] ?? email[0] ?? "A").toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={
          "flex items-center justify-center group-hover:justify-start gap-0 group-hover:gap-2.5 px-2.5 py-2 rounded-lg w-full text-left transition-colors overflow-hidden " +
          (open ? "bg-accent" : "hover:bg-accent/50")
        }
      >
        <div className="h-6 w-6 rounded-md flex items-center justify-center shrink-0 bg-elevated border border-border">
          <span className="text-[10px] font-semibold text-foreground/70">{initials}</span>
        </div>

        <div className="flex-1 min-w-0 opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300 whitespace-nowrap overflow-hidden">
          <p className="text-[12.5px] font-medium truncate leading-none text-foreground">
            {name}
          </p>
          {email && (
            <p className="text-[10px] truncate mt-0.5 leading-none text-muted-foreground/60">
              {email}
            </p>
          )}
        </div>

        <ChevronDown
          className="w-3 h-3 shrink-0 text-muted-foreground/40 transition-transform opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 mb-1.5 rounded-xl overflow-hidden z-50 bg-popover border border-border shadow-lg">
            <button
              onClick={() => { void signOut(); setOpen(false); }}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] w-full transition-colors text-left text-muted-foreground hover:bg-accent hover:text-foreground"
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

/* ── Sidebar content ────────────────────────────────────────────────────── */
function SidebarContent({ onNavClick, onSearchOpen }: { onNavClick?: () => void; onSearchOpen?: () => void }) {
  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 h-13 shrink-0 border-b border-sidebar-border">
        <Link href="/app" onClick={onNavClick} className="flex items-center gap-2">
          <SnapServeIcon size={26} className="text-foreground shrink-0" />
          <span className="leading-none select-none text-[15px] text-foreground opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300 whitespace-nowrap overflow-hidden" style={{ fontFamily: "'Tex Gyre Heros', Helvetica, Arial, sans-serif", letterSpacing: "-0.01em" }}>
            <span style={{ fontWeight: 700 }}>Snap</span><span style={{ fontWeight: 400 }}>Serve</span>
          </span>
        </Link>
        <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-border bg-elevated text-muted-foreground/50 ml-1 opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300 whitespace-nowrap overflow-hidden">
          Beta
        </span>
      </div>

      {/* Search trigger */}
      <div className="px-2.5 pt-3 pb-1 shrink-0">
        <button
          onClick={onSearchOpen}
          className="flex items-center justify-center group-hover:justify-start gap-0 group-hover:gap-2.5 px-2.5 py-[6.5px] rounded-lg text-[13px] transition-all duration-100 cursor-pointer select-none overflow-hidden w-full text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <Search className="w-[14px] h-[14px] shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" />
          <span className="truncate opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300 whitespace-nowrap flex-1 text-left">
            Search…
          </span>
          <span className="opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300 whitespace-nowrap overflow-hidden">
            <kbd className="text-[9px] font-medium px-1 py-0.5 rounded border border-border bg-elevated text-muted-foreground/50">⌘K</kbd>
          </span>
        </button>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-3 px-2.5 min-h-0">
        <NavItems onClick={onNavClick} />
      </div>

      {/* Footer */}
      <div className="px-2.5 pb-3 pt-3 space-y-px shrink-0 border-t border-sidebar-border">
        <WalletBadge />
        <UserMenu />
        {/* System status */}
        <div className="flex items-center justify-center group-hover:justify-start gap-0 group-hover:gap-2 px-2.5 py-1.5 overflow-hidden">
          <div className="h-1.5 w-1.5 rounded-full bg-foreground/20 shrink-0" />
          <span className="text-[10.5px] text-muted-foreground/50 flex-1 truncate opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300 whitespace-nowrap">All systems operational</span>
        </div>
        {/* Legal links */}
        <div className="flex items-center justify-center group-hover:justify-start gap-0 group-hover:gap-2 px-2.5 py-1 overflow-hidden">
          <Link href="/privacy" className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 whitespace-nowrap">
            Privacy
          </Link>
          <span className="text-muted-foreground/20 opacity-0 w-0 group-hover:w-auto group-hover:opacity-100">|</span>
          <Link href="/terms" className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors opacity-0 w-0 group-hover:w-auto group-hover:opacity-100 whitespace-nowrap">
            Terms
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ── Layout ─────────────────────────────────────────────────────────────── */
export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { open: searchOpen, setOpen: setSearchOpen } = useGlobalSearchTrigger();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:block w-16 hover:w-[228px] group shrink-0 transition-all duration-300 ease-in-out overflow-hidden">
        <SidebarContent onSearchOpen={() => setSearchOpen(true)} />
      </aside>

      {/* Mobile header + drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <div className="md:hidden flex items-center h-12 px-4 shrink-0 fixed top-0 left-0 right-0 z-30 bg-sidebar border-b border-sidebar-border">
          <SheetTrigger asChild>
            <button className="p-2 rounded-lg text-muted-foreground hover:bg-accent transition-colors">
              <Menu className="h-4 w-4" />
            </button>
          </SheetTrigger>
          <Link href="/app" className="ml-3 flex items-center gap-1.5">
            <SnapServeIcon size={20} className="text-foreground shrink-0" />
            <span className="leading-none select-none text-[13px] text-foreground" style={{ fontFamily: "'Tex Gyre Heros', Helvetica, Arial, sans-serif", letterSpacing: "-0.01em" }}>
              <span style={{ fontWeight: 700 }}>Snap</span><span style={{ fontWeight: 400 }}>Serve</span>
            </span>
          </Link>
          {/* Mobile search button */}
          <button
            onClick={() => setSearchOpen(true)}
            className="ml-auto p-2 rounded-lg text-muted-foreground hover:bg-accent transition-colors"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
        <SheetContent side="left" className="p-0 w-[228px]">
          <SidebarContent
            onNavClick={() => setMobileOpen(false)}
            onSearchOpen={() => { setMobileOpen(false); setSearchOpen(true); }}
          />
        </SheetContent>
      </Sheet>

      {/* Page content — pt-12 offsets the fixed mobile header on small screens */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto bg-background pt-12 md:pt-0">
        {children}
      </main>

      {/* Incoming webcall callback notification — renders globally over all pages */}
      <IncomingCallNotification />

      {/* Global search palette */}
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
