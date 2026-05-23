import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Users, Phone, Key, Settings, Menu,
  LayoutDashboard, BarChart3, BookOpen,
  Wallet, LogOut, ChevronDown, AlertCircle, Radio, Webhook,
  Zap, ChevronRight,
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
    <div className="flex flex-col gap-7">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="px-3 mb-2 text-[10px] font-bold tracking-[0.16em] uppercase select-none"
            style={{ color: "rgba(255,255,255,0.18)" }}>
            {section.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const isActive = item.exact
                ? location === item.href
                : location.startsWith(item.href) && item.href !== "/app";

              return (
                <Link key={item.name} href={item.href} onClick={onClick}>
                  <div className={`group relative flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium transition-all duration-150 cursor-pointer`}
                    style={{
                      background: isActive
                        ? "linear-gradient(135deg, rgba(124,58,237,0.18) 0%, rgba(139,92,246,0.08) 100%)"
                        : undefined,
                      color: isActive ? "rgba(167,139,250,1)" : "rgba(255,255,255,0.38)",
                      boxShadow: isActive ? "inset 0 0 0 1px rgba(124,58,237,0.2)" : undefined,
                    }}
                  >
                    {/* Active indicator bar */}
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                        style={{ background: "linear-gradient(180deg, #7C3AED 0%, #8B5CF6 100%)" }} />
                    )}

                    <item.icon
                      className="w-[15px] h-[15px] shrink-0 transition-colors"
                      style={{ color: isActive ? "rgb(167,139,250)" : "rgba(255,255,255,0.3)" }}
                    />
                    <span className="truncate">{item.name}</span>

                    {isActive && (
                      <ChevronRight className="w-3 h-3 ml-auto shrink-0" style={{ color: "rgba(167,139,250,0.5)" }} />
                    )}

                    {/* Hover bg for inactive items */}
                    {!isActive && (
                      <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-100"
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
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
        isActive ? "" : "hover:bg-white/[0.04]"
      }`}
        style={{
          background: isActive
            ? "linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(139,92,246,0.06) 100%)"
            : undefined,
          border: `1px solid ${isActive ? "rgba(124,58,237,0.25)" : "rgba(255,255,255,0.06)"}`,
        }}>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${isLow ? "" : ""}`}
          style={{ background: isLow ? "rgba(245,158,11,0.15)" : "rgba(124,58,237,0.12)" }}>
          <Zap className={`w-3.5 h-3.5 ${isLow ? "text-amber-400" : "text-violet-400"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.2)" }}>
            Balance
          </p>
          {wallet ? (
            <p className={`text-[14px] font-bold tabular-nums leading-tight ${isLow ? "text-amber-400" : "text-white/80"}`}>
              ${(wallet.balanceCents / 100).toFixed(2)}
            </p>
          ) : (
            <div className="h-4 w-14 rounded-md animate-pulse mt-0.5" style={{ background: "rgba(255,255,255,0.08)" }} />
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

  const name = user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress?.split("@")[0] ?? "Account";
  const email = user?.emailAddresses?.[0]?.emailAddress ?? "";
  const initials = (user?.firstName?.[0] ?? email[0] ?? "A").toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl w-full text-left transition-all"
        style={{ background: open ? "rgba(255,255,255,0.05)" : undefined }}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.background = ""; }}
      >
        {/* Avatar */}
        <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: "linear-gradient(135deg, #7C3AED 0%, #8B5CF6 100%)",
            boxShadow: "0 0 10px rgba(124,58,237,0.3)",
          }}>
          <span className="text-[11px] font-bold text-white">{initials}</span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-semibold truncate leading-none" style={{ color: "rgba(255,255,255,0.72)" }}>
            {name}
          </p>
          {email && (
            <p className="text-[10px] truncate mt-0.5 leading-none" style={{ color: "rgba(255,255,255,0.28)" }}>
              {email}
            </p>
          )}
        </div>

        <ChevronDown className="w-3 h-3 shrink-0 transition-transform"
          style={{
            color: "rgba(255,255,255,0.2)",
            transform: open ? "rotate(180deg)" : undefined,
          }} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden z-50"
            style={{
              background: "#182235",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 -8px 32px rgba(0,0,0,0.6)",
            }}>
            <button
              onClick={() => { signOut(); setOpen(false); }}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] w-full transition-colors"
              style={{ color: "rgba(255,255,255,0.45)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
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
      background: "#0D1322",
      borderRight: "1px solid rgba(255,255,255,0.05)",
    }}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-14 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex h-8 w-8 items-center justify-center rounded-xl shrink-0"
          style={{
            background: "linear-gradient(135deg, #7C3AED 0%, #8B5CF6 100%)",
            boxShadow: "0 0 16px rgba(124,58,237,0.45)",
          }}>
          <SnapServeIcon size={15} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[15px] font-bold tracking-tight" style={{ color: "rgba(255,255,255,0.88)" }}>
            Snap<span className="text-violet-400">Serve</span>
          </span>
        </div>
        <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md shrink-0"
          style={{
            background: "rgba(124,58,237,0.15)",
            color: "rgba(167,139,250,0.65)",
            border: "1px solid rgba(124,58,237,0.2)",
          }}>
          Beta
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-5 px-3">
        <NavItems onClick={onNavClick} />
      </nav>

      {/* Wallet */}
      <div className="px-3 pb-3 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "12px" }}>
        <WalletBadge />
      </div>

      {/* User + status */}
      <div className="px-2 pb-3 pt-2 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <UserMenu />
        <div className="flex items-center gap-2 px-2.5 mt-2">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400"
            style={{ boxShadow: "0 0 6px rgba(52,211,153,0.8)" }} />
          <span className="text-[10.5px] font-medium" style={{ color: "rgba(255,255,255,0.2)" }}>System Online</span>
        </div>
      </div>
    </div>
  );
}

/* ── Layout ────────────────────────────────────────────────────────────── */
export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "#0A0E1A" }}>
      {/* Desktop sidebar */}
      <aside className="hidden md:block w-[240px] shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile nav */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <button
            className="md:hidden fixed top-4 left-4 z-50 flex h-8 w-8 items-center justify-center rounded-xl transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)" }}
          >
            <Menu className="h-4 w-4" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-[240px] border-r-0">
          <SidebarContent onNavClick={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Page content */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden"
        style={{ background: "#0A0E1A" }}>
        {children}
      </main>
    </div>
  );
}
