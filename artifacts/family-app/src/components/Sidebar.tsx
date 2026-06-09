import React from "react";
import { Link, useLocation } from "wouter";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "⬛" },
  { href: "/agents", label: "Agents", icon: "🤖" },
  { href: "/knowledge-base", label: "Knowledge Base", icon: "📚" },
  { href: "/analytics", label: "Analytics", icon: "📊" },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div className="w-56 bg-sidebar border-r border-sidebar-border flex flex-col h-screen shrink-0">
      <div className="px-5 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">F</div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-sidebar-foreground leading-none">Family Admin</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Mission Control</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_LINKS.map((link) => {
          const active = location === link.href || (link.href !== '/' && location.startsWith(link.href));
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'}`}
            >
              <span className="text-base leading-none">{link.icon}</span>
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-4 border-t border-sidebar-border">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">A</div>
          <div>
            <p className="text-xs font-medium text-sidebar-foreground">Admin User</p>
            <p className="text-[10px] text-muted-foreground">admin@family.ai</p>
          </div>
        </div>
        <button
          className="w-full text-left text-xs text-muted-foreground hover:text-destructive transition-colors"
          onClick={() => {
            localStorage.removeItem('family_auth');
            window.location.href = '/login';
          }}
        >
          Sign out →
        </button>
      </div>
    </div>
  );
}
