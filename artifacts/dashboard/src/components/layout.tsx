import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Users, Phone, Key, Settings, Mic, Menu,
  LayoutDashboard, TestTube, BarChart3, ChevronRight, BookOpen,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const NAV_SECTIONS = [
  {
    label: "BUILD",
    items: [
      { name: "Assistants",      href: "/",                  icon: Users,    exact: true },
      { name: "Knowledge Bases", href: "/knowledge-bases",   icon: BookOpen },
      { name: "Providers",       href: "/providers",          icon: Key },
    ],
  },
  {
    label: "OBSERVE",
    items: [
      { name: "Analytics",  href: "/analytics", icon: BarChart3 },
      { name: "Logs",       href: "/calls",      icon: Phone },
    ],
  },
  {
    label: "MANAGE",
    items: [
      { name: "Settings",   href: "/settings",   icon: Settings },
    ],
  },
];

function NavItems({ onClick }: { onClick?: () => void }) {
  const [location] = useLocation();

  return (
    <div className="flex flex-col gap-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="px-3 mb-1 text-[10px] font-semibold tracking-widest text-zinc-500 uppercase select-none">
            {section.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const isActive = item.exact
                ? location === item.href
                : location.startsWith(item.href) && item.href !== "/";
              return (
                <Link key={item.name} href={item.href} onClick={onClick}>
                  <div
                    className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
                      isActive
                        ? "bg-white/10 text-white font-medium"
                        : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                    }`}
                  >
                    <item.icon className="w-3.5 h-3.5 shrink-0" />
                    {item.name}
                    {isActive && <ChevronRight className="w-3 h-3 ml-auto text-zinc-500" />}
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

function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  return (
    <div className="flex flex-col h-full bg-[#0e0e0e] border-r border-zinc-800">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-12 border-b border-zinc-800 shrink-0">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/20">
          <Mic className="h-3.5 w-3.5 text-emerald-400" />
        </div>
        <span className="font-semibold text-sm text-white tracking-wide">VoiceOrch</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-2">
        <NavItems onClick={onNavClick} />
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 px-1">
          <div className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-[11px] text-zinc-500">System Online</span>
        </div>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-full bg-[#111111] overflow-hidden">
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
            className="md:hidden fixed top-3 left-3 z-50 h-8 w-8 text-zinc-400"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-48 border-r border-zinc-800">
          <SidebarContent onNavClick={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Page content */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
