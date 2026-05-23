import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Users, Phone, Key, Settings, Menu,
  LayoutDashboard, BarChart3, BookOpen,
  Wallet, LogOut, ChevronDown, AlertCircle, Radio, Webhook,
  Zap,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useClerk, useUser } from "@clerk/react";
import { useGetWallet } from "@workspace/api-client-react";
import { SnapServeIcon } from "@/components/logo";

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
      { name: "Live Monitor", href: "/app/monitor",   icon: Radio },
      { name: "Logs",         href: "/app/calls",     icon: Phone },
      { name: "Activity",     href: "/app/activity",  icon: LayoutDashboard },
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
          <p className="px-3 mb-1.5 text-[10px] font-bold tracking-[0.18em] uppercase select-none"
            style={{ color: "rgba(255,255,255,0.2)" }}>
            {section.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const isActive = item.exact
                ? location === item.href
                : location.startsWith(item.href) && item.href !== "/app";

              return (
                <Link key={item.name} href={item.href} onClick={onClick}>
                  <div className={`group relative flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150 cursor-pointer ${
                    isActive
                      ? "text-violet-300"
                      : "hover:text-white/75"
                  }`}
                    style={{
                      background: isActive ? "rgba(139,92,246,0.12)" : undefined,
                      color: isActive ? undefined : "rgba(255,255,255,0.42)",
                    }}
                  >
                    {/* Active indicator */}
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full bg-violet-400" />
                    )}
                    <item.icon
                      className="w-3.5 h-3.5 shrink-0 transition-colors"
                      style={{ color: isActive ? "rgb(167,139,250)" : "rgba(255,255,255,0.35)" }}
                    />
                    <span>{item.name}</span>

                    {/* Hover bg */}
                    {!isActive && (
                      <div className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: "rgba(255,255,255,0.04)" }} />
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
  const isLow = wallet && wallet.balanceCents < 100;
  const isActive = location.startsWith("/app/wallet");

  return (
    <Link href="/app/wallet">
      <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
        isActive
          ? "border-violet-500/30 bg-violet-500/8"
          : "border-white/[0.07] bg-card/[0.03] hover:bg-card/[0.05] hover:border-white/[0.10]"
      }`}>
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg shrink-0 ${isLow ? "bg-amber-500/15" : "bg-card/[0.06]"}`}>
          <Zap className={`w-3.5 h-3.5 ${isLow ? "text-amber-400" : "text-white/40"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.22)" }}>
            Balance
          </p>
          {wallet ? (
            <p className={`text-[13px] font-bold tabular-nums leading-tight ${isLow ? "text-amber-400" : "text-white/75"}`}>
              ${(wallet.balanceCents / 100).toFixed(2)}
            </p>
          ) : (
            <div className="h-3.5 w-12 rounded animate-pulse mt-0.5" style={{ background: "rgba(255,255,255,0.08)" }} />
          )}
        </div>
        {isLow && <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
      </div>
    </Link>
  );
}

/* ── User menu ─────────────────────────────────────────────────────────── */
function UserMenu() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [open, setOpen] = useState(false);

  const name = user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress ?? "Account";
  const email = user?.emailAddresses?.[0]?.emailAddress ?? "";
  const initials = (user?.firstName?.[0] ?? email[0] ?? "A").toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 px-2 py-2 rounded-xl w-full text-left transition-all hover:bg-card/[0.04]"
      >
        <div className="h-7 w-7 rounded-lg bg-violet-600/60 flex items-center justify-center shrink-0 ring-1 ring-violet-500/30">
          <span className="text-[11px] font-bold text-white">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-white/70 truncate leading-none">{name}</p>
          {email && name !== email && (
            <p className="text-[10px] text-white/30 truncate mt-0.5 leading-none">{email}</p>
          )}
        </div>
        <ChevronDown className="w-3 h-3 shrink-0" style={{ color: "rgba(255,255,255,0.22)" }} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 mb-1.5 rounded-xl border border-white/[0.08] overflow-hidden z-50"
            style={{ background: "rgba(16,16,24,0.98)", backdropFilter: "blur(16px)", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
            <button
              onClick={() => { signOut(); setOpen(false); }}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] w-full transition-colors hover:bg-card/[0.05]"
              style={{ color: "rgba(255,255,255,0.5)" }}
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

/* ── Sidebar content ───────────────────────────────────────────────────── */
function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  return (
    <div className="flex flex-col h-full" style={{
      background: "#08080E",
      borderRight: "1px solid rgba(255,255,255,0.055)",
    }}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-12 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-600 shadow-[0_0_12px_rgba(139,92,246,0.4)]">
          <SnapServeIcon size={13} className="text-white" />
        </div>
        <span className="text-[14px] font-bold tracking-tight" style={{ color: "rgba(255,255,255,0.82)" }}>
          Snap<span className="text-violet-400">Serve</span>
        </span>
        <div className="ml-auto">
          <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md"
            style={{ background: "rgba(139,92,246,0.15)", color: "rgba(167,139,250,0.7)", border: "1px solid rgba(139,92,246,0.2)" }}>
            Beta
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-5 px-2">
        <NavItems onClick={onNavClick} />
      </nav>

      {/* Wallet */}
      <div className="px-3 pb-2 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "12px" }}>
        <WalletBadge />
      </div>

      {/* Status + User */}
      <div className="px-2 pb-3 pt-2 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <UserMenu />
        <div className="flex items-center gap-2 px-2 mt-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
          <span className="text-[10px] font-medium" style={{ color: "rgba(255,255,255,0.22)" }}>System Online</span>
        </div>
      </div>
    </div>
  );
}

/* ── Layout ────────────────────────────────────────────────────────────── */
export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "hsl(234 18% 8%)" }}>
      {/* Desktop sidebar */}
      <aside className="hidden md:block w-[212px] shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile nav */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <button
            className="md:hidden fixed top-3 left-3 z-50 flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)" }}
          >
            <Menu className="h-4 w-4" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-[212px] border-r-0">
          <SidebarContent onNavClick={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Page content */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden"
        style={{ background: "hsl(234 18% 8%)" }}>
        {children}
      </main>
    </div>
  );
}
