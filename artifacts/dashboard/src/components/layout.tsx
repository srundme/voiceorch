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
    <div className="flex flex-col gap-6">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="px-3 mb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase select-none"
            style={{ color: "#9CA3AF" }}>
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
                    className="group relative flex items-center gap-2.5 px-3 py-[7px] rounded-xl text-[13px] font-medium transition-all duration-150 cursor-pointer"
                    style={{
                      background: isActive ? "#FFFFFF" : undefined,
                      color:      isActive ? "#111827" : "#6B7280",
                      boxShadow:  isActive
                        ? "0 1px 3px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.05)"
                        : undefined,
                    }}
                    onMouseEnter={e => {
                      if (!isActive) (e.currentTarget as HTMLElement).style.background = "#F3F4F6";
                    }}
                    onMouseLeave={e => {
                      if (!isActive) (e.currentTarget as HTMLElement).style.background = "";
                    }}
                  >
                    <item.icon
                      className="w-[15px] h-[15px] shrink-0 transition-colors"
                      style={{ color: isActive ? "#374151" : "#9CA3AF" }}
                    />
                    <span className="truncate">{item.name}</span>
                    {isActive && (
                      <ChevronRight className="w-3 h-3 ml-auto shrink-0" style={{ color: "#9CA3AF" }} />
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
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
        style={{
          background: isActive ? "#FFFFFF" : "#F3F4F6",
          border:     `1px solid ${isActive ? "#D1D5DB" : "#E5E7EB"}`,
          boxShadow:  isActive ? "0 1px 3px rgba(0,0,0,0.07)" : undefined,
        }}
        onMouseEnter={e => {
          if (!isActive) {
            (e.currentTarget as HTMLElement).style.background = "#EAECEF";
          }
        }}
        onMouseLeave={e => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = "#F3F4F6";
        }}
      >
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg shrink-0"
          style={{ background: isLow ? "#FEF3C7" : "#E5E7EB", border: `1px solid ${isLow ? "#FCD34D" : "#D1D5DB"}` }}
        >
          <Zap className={`w-3.5 h-3.5 ${isLow ? "text-amber-600" : "text-gray-500"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#9CA3AF" }}>
            Balance
          </p>
          {wallet ? (
            <p className={`text-[13.5px] font-bold tabular-nums leading-tight ${isLow ? "text-amber-700" : "text-gray-800"}`}>
              ${(wallet.balanceCents / 100).toFixed(2)}
            </p>
          ) : (
            <div className="h-4 w-14 rounded-md animate-pulse mt-0.5" style={{ background: "#E5E7EB" }} />
          )}
        </div>
        {isLow && <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
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
        className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl w-full text-left transition-all"
        style={{ background: open ? "#F3F4F6" : undefined }}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLElement).style.background = "#F3F4F6"; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.background = ""; }}
      >
        {/* Avatar */}
        <div
          className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "#374151" }}
        >
          <span className="text-[11px] font-bold text-white">{initials}</span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-semibold truncate leading-none" style={{ color: "#111827" }}>
            {name}
          </p>
          {email && (
            <p className="text-[10px] truncate mt-0.5 leading-none" style={{ color: "#9CA3AF" }}>
              {email}
            </p>
          )}
        </div>

        <ChevronDown
          className="w-3 h-3 shrink-0 transition-transform"
          style={{ color: "#9CA3AF", transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden z-50"
            style={{
              background: "#FFFFFF",
              border:     "1px solid #E5E7EB",
              boxShadow:  "0 -4px 16px rgba(0,0,0,0.08), 0 -1px 4px rgba(0,0,0,0.05)",
            }}
          >
            <button
              onClick={() => { signOut(); setOpen(false); }}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] w-full transition-colors text-left"
              style={{ color: "#6B7280" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#F9FAFB"}
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
    <div
      className="flex flex-col h-full"
      style={{
        background:  "#FAFAFA",
        borderRight: "1px solid #E5E7EB",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-14 shrink-0" style={{ borderBottom: "1px solid #F3F4F6" }}>
        <div
          className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "#374151" }}
        >
          <SnapServeIcon className="h-4 w-4 text-white" />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-bold tracking-tight" style={{ color: "#111827" }}>
            SnapServe
          </span>
          <span
            className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
            style={{ background: "#F3F4F6", color: "#9CA3AF", border: "1px solid #E5E7EB" }}
          >
            Beta
          </span>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-4 px-3 min-h-0">
        <NavItems onClick={onNavClick} />
      </div>

      {/* Footer */}
      <div className="px-3 pb-3 space-y-2 shrink-0" style={{ borderTop: "1px solid #F3F4F6", paddingTop: "12px" }}>
        <WalletBadge />
        <UserMenu />
        {/* Status dot */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <div
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "#10B981" }}
          />
          <span className="text-[11px]" style={{ color: "#9CA3AF" }}>All systems operational</span>
        </div>
      </div>
    </div>
  );
}

/* ── Layout ────────────────────────────────────────────────────────────── */
export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "#F5F5F7" }}>
      {/* Desktop sidebar */}
      <aside className="hidden md:block w-[240px] shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile header + drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <div
          className="md:hidden flex items-center h-14 px-4 shrink-0 fixed top-0 left-0 right-0 z-30"
          style={{ background: "#FAFAFA", borderBottom: "1px solid #E5E7EB" }}
        >
          <SheetTrigger asChild>
            <button
              className="p-2 rounded-xl transition-colors"
              style={{ color: "#6B7280" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#F3F4F6"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
            >
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <span className="ml-3 text-[15px] font-bold" style={{ color: "#111827" }}>SnapServe</span>
        </div>
        <SheetContent side="left" className="p-0 w-[240px]">
          <SidebarContent onNavClick={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Page content */}
      <main
        className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden"
        style={{ background: "#F5F5F7" }}
      >
        {children}
      </main>
    </div>
  );
}
