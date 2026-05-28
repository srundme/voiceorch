import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Users, Phone, Key, Settings, Menu,
  LayoutDashboard, BarChart3, BookOpen,
  Wallet, LogOut, ChevronDown, AlertCircle, Radio, Webhook,
  Zap, ChevronRight, CalendarDays, TrendingUp, Moon, Sun,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useClerk, useUser } from "@clerk/react";
import { useGetWallet } from "@workspace/api-client-react";
import { SnapServeLogo } from "@/components/logo";

/* ── Nav structure ─────────────────────────────────────────────────────── */
const NAV_SECTIONS = [
  {
    label: "Build",
    items: [
      { name: "Assistants",      href: "/app",                 icon: Users,          exact: true },
      { name: "Knowledge Bases", href: "/app/knowledge-bases", icon: BookOpen },
      { name: "Providers",       href: "/app/providers",       icon: Key },
    ],
  },
  {
    label: "Observe",
    items: [
      { name: "Analytics",    href: "/app/analytics", icon: BarChart3 },
      { name: "Usage",        href: "/app/usage",     icon: TrendingUp },
      { name: "Live Monitor", href: "/app/monitor",   icon: Radio },
      { name: "Logs",         href: "/app/calls",     icon: Phone },
      { name: "Activity",     href: "/app/activity",  icon: LayoutDashboard },
    ],
  },
  {
    label: "Outreach",
    items: [
      { name: "Campaigns",  href: "/app/campaigns",  icon: Zap },
      { name: "Scheduling", href: "/app/scheduling", icon: CalendarDays },
    ],
  },
  {
    label: "Platform",
    items: [
      { name: "Phone Numbers", href: "/app/phone-numbers", icon: Phone },
      { name: "Webhooks",      href: "/app/webhooks",      icon: Webhook },
      { name: "Wallet",        href: "/app/wallet",        icon: Wallet },
      { name: "Settings",      href: "/app/settings",      icon: Settings },
    ],
  },
];

/* ── Nav items ─────────────────────────────────────────────────────────── */
function NavItems({ onClick }: { onClick?: () => void }) {
  const [location] = useLocation();

  return (
    <div className="flex flex-col gap-6">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="px-3 mb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase select-none text-muted-foreground">
            {section.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const isActive = item.exact
                ? location === item.href
                : location.startsWith(item.href) && item.href !== "/app";

              return (
                <Link key={item.name} href={item.href} onClick={onClick}>
                  <div
                    className={
                      "group relative flex items-center gap-2.5 px-3 py-[7px] rounded-xl text-[13px] font-medium transition-colors duration-150 cursor-pointer " +
                      (isActive
                        ? "bg-card text-foreground shadow-sm border border-border"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground")
                    }
                  >
                    <item.icon
                      className={
                        "w-[15px] h-[15px] shrink-0 transition-colors " +
                        (isActive ? "text-primary" : "text-muted-foreground")
                      }
                    />
                    <span className="truncate">{item.name}</span>
                    {isActive && (
                      <ChevronRight className="w-3 h-3 ml-auto shrink-0 text-muted-foreground" />
                    )}
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

/* ── Wallet badge ──────────────────────────────────────────────────────── */
function WalletBadge() {
  const { data: wallet } = useGetWallet();
  const [location] = useLocation();
  const isLow    = wallet && wallet.balanceCents < 100;
  const isActive = location.startsWith("/app/wallet");

  return (
    <Link href="/app/wallet">
      <div
        className={
          "flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors border " +
          (isActive
            ? "bg-card border-border shadow-sm"
            : "bg-muted border-border hover:bg-accent")
        }
      >
        <div
          className={
            "flex h-7 w-7 items-center justify-center rounded-lg shrink-0 border " +
            (isLow
              ? "bg-zinc-500/15 border-zinc-500/40"
              : "bg-muted border-border")
          }
        >
          <Zap className={`w-3.5 h-3.5 ${isLow ? "text-zinc-500" : "text-muted-foreground"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Balance
          </p>
          {wallet ? (
            <p className={`text-[13.5px] font-bold tabular-nums leading-tight ${isLow ? "text-zinc-500" : "text-foreground"}`}>
              ${(wallet.balanceCents / 100).toFixed(2)}
            </p>
          ) : (
            <div className="h-4 w-14 rounded-md animate-pulse mt-0.5 bg-muted" />
          )}
        </div>
        {isLow && <AlertCircle className="w-3.5 h-3.5 text-zinc-500 shrink-0" />}
      </div>
    </Link>
  );
}

/* ── User menu ─────────────────────────────────────────────────────────── */
function UserMenu() {
  const { signOut } = useClerk();
  const { user }    = useUser();
  const [open, setOpen] = useState(false);

  const name     = user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress?.split("@")[0] ?? "Account";
  const email    = user?.emailAddresses?.[0]?.emailAddress ?? "";
  const initials = (user?.firstName?.[0] ?? email[0] ?? "A").toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={
          "flex items-center gap-2.5 px-2.5 py-2 rounded-xl w-full text-left transition-colors " +
          (open ? "bg-muted" : "hover:bg-muted")
        }
      >
        {/* Avatar */}
        <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 bg-primary text-primary-foreground">
          <span className="text-[11px] font-bold">{initials}</span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-semibold truncate leading-none text-foreground">
            {name}
          </p>
          {email && (
            <p className="text-[10px] truncate mt-0.5 leading-none text-muted-foreground">
              {email}
            </p>
          )}
        </div>

        <ChevronDown
          className="w-3 h-3 shrink-0 transition-transform text-muted-foreground"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden z-50 bg-popover border border-border shadow-lg">
            <button
              onClick={() => { signOut(); setOpen(false); }}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] w-full transition-colors text-left text-muted-foreground hover:bg-muted hover:text-foreground"
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

/* ── Theme toggle ──────────────────────────────────────────────────────── */
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="h-5 w-5 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
    </button>
  );
}

/* ── Sidebar content ───────────────────────────────────────────────────── */
function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border">
      {/* Logo — image icon + image wordmark */}
      <div className="flex items-center gap-2 px-4 h-14 shrink-0 border-b border-sidebar-border">
        <Link href="/app" onClick={onNavClick} className="flex items-center">
          <SnapServeLogo size="md" showIcon iconSize={20} className="text-sidebar-foreground" />
        </Link>
        <span
          className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-border bg-muted text-muted-foreground"
        >
          Beta
        </span>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-4 px-3 min-h-0">
        <NavItems onClick={onNavClick} />
      </div>

      {/* Footer */}
      <div className="px-3 pb-3 pt-3 space-y-2 shrink-0 border-t border-sidebar-border">
        <WalletBadge />
        <UserMenu />
        {/* Status dot + theme toggle */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
          <span className="text-[11px] text-muted-foreground flex-1">All systems operational</span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

/* ── Layout ────────────────────────────────────────────────────────────── */
export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:block w-[240px] shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile header + drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <div className="md:hidden flex items-center h-14 px-4 shrink-0 fixed top-0 left-0 right-0 z-30 bg-sidebar border-b border-sidebar-border">
          <SheetTrigger asChild>
            <button className="p-2 rounded-xl text-muted-foreground hover:bg-muted transition-colors">
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <Link href="/app" className="ml-3 flex items-center">
            <SnapServeLogo size="sm" showIcon iconSize={18} className="text-sidebar-foreground" />
          </Link>
        </div>
        <SheetContent side="left" className="p-0 w-[240px]">
          <SidebarContent onNavClick={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Page content */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-background">
        {children}
      </main>
    </div>
  );
}
