import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Users, Phone, Key, Settings, Menu,
  LayoutDashboard, BarChart3, ChevronRight, BookOpen,
  Wallet, LogOut, ChevronDown, AlertCircle, Radio, Webhook,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useClerk, useUser } from "@clerk/react";
import { useGetWallet } from "@workspace/api-client-react";
import { SnapServeLogo, SnapServeIcon } from "@/components/logo";

const NAV_SECTIONS = [
  {
    label: "BUILD",
    items: [
      { name: "Assistants",      href: "/app",                 icon: Users,    exact: true },
      { name: "Knowledge Bases", href: "/app/knowledge-bases", icon: BookOpen },
      { name: "Providers",       href: "/app/providers",       icon: Key },
    ],
  },
  {
    label: "OBSERVE",
    items: [
      { name: "Analytics",    href: "/app/analytics", icon: BarChart3 },
      { name: "Live Monitor", href: "/app/monitor",   icon: Radio },
      { name: "Logs",         href: "/app/calls",     icon: Phone },
      { name: "Activity",     href: "/app/activity",  icon: LayoutDashboard },
    ],
  },
  {
    label: "NUMBERS",
    items: [
      { name: "Phone Numbers", href: "/app/phone-numbers", icon: Phone },
    ],
  },
  {
    label: "MANAGE",
    items: [
      { name: "Webhooks", href: "/app/webhooks", icon: Webhook },
      { name: "Wallet",   href: "/app/wallet",   icon: Wallet },
      { name: "Settings", href: "/app/settings", icon: Settings },
    ],
  },
];

function NavItems({ onClick }: { onClick?: () => void }) {
  const [location] = useLocation();

  return (
    <div className="flex flex-col gap-5">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="px-2 mb-1 text-[10px] font-semibold tracking-widest text-white/25 uppercase select-none">
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
                    className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors cursor-pointer ${
                      isActive
                        ? "bg-white/10 text-white font-medium"
                        : "text-white/45 hover:bg-white/[0.06] hover:text-white/75"
                    }`}
                  >
                    <item.icon className="w-3.5 h-3.5 shrink-0" />
                    {item.name}
                    {isActive && <ChevronRight className="w-3 h-3 ml-auto text-white/20" />}
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

function WalletBadge() {
  const { data: wallet } = useGetWallet();
  const [location] = useLocation();
  const isLow = wallet && wallet.balanceCents < 100;

  return (
    <Link href="/app/wallet">
      <div className={`flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
        location.startsWith("/app/wallet") ? "bg-white/10" : "hover:bg-white/[0.06]"
      }`}>
        <Wallet className="w-3.5 h-3.5 text-white/30 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-white/25 uppercase tracking-widest">Balance</p>
          {wallet ? (
            <p className={`text-sm font-semibold tabular-nums ${isLow ? "text-amber-400" : "text-white/70"}`}>
              ${(wallet.balanceCents / 100).toFixed(2)}
            </p>
          ) : (
            <div className="h-4 w-12 bg-white/10 rounded animate-pulse" />
          )}
        </div>
        {isLow && <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
      </div>
    </Link>
  );
}

function UserMenu() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [open, setOpen] = useState(false);

  const name = user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress ?? "Account";
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.06] transition-colors w-full text-left"
      >
        <div className="h-6 w-6 rounded-full bg-white/10 flex items-center justify-center shrink-0 ring-1 ring-white/10">
          <span className="text-[9px] font-bold text-white/60">{initials}</span>
        </div>
        <span className="text-[13px] text-white/50 truncate flex-1 min-w-0">{name}</span>
        <ChevronDown className="w-3 h-3 text-white/25 shrink-0" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-[#2C2C2E] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
          <button
            onClick={() => { signOut(); setOpen(false); }}
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-white/50 hover:bg-white/[0.06] hover:text-white/75 w-full transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  return (
    <div className="flex flex-col h-full glass-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-12 border-b border-white/[0.06] shrink-0">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/10">
          <SnapServeIcon size={14} className="text-white/70" />
        </div>
        <SnapServeLogo size="sm" className="text-white/75" />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-2">
        <NavItems onClick={onNavClick} />
      </nav>

      {/* Wallet */}
      <div className="px-2 pb-2 border-t border-white/[0.06] pt-2 shrink-0">
        <WalletBadge />
      </div>

      {/* User + status */}
      <div className="px-2 py-2 border-t border-white/[0.06] shrink-0 space-y-2">
        <UserMenu />
        <div className="flex items-center gap-2 px-1">
          <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
          <span className="text-[11px] text-white/25">System Online</span>
        </div>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:block w-48 shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile nav */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden fixed top-3 left-3 z-50 h-8 w-8 text-white/50"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-48 border-r-0">
          <SidebarContent onNavClick={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Page content */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-[#F5F5F7]">
        {children}
      </main>
    </div>
  );
}
