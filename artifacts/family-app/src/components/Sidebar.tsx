import React from "react";
import { Link, useLocation } from "wouter";

export function Sidebar() {
  const [location] = useLocation();

  const links = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/agents", label: "Agents" },
    { href: "/knowledge-base", label: "Knowledge Base" },
    { href: "/analytics", label: "Analytics" },
  ];

  return (
    <div className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col h-screen">
      <div className="p-6">
        <h1 className="text-xl font-bold tracking-tight text-sidebar-foreground">Family Admin</h1>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Platform Control</p>
      </div>
      <nav className="flex-1 px-4 space-y-2">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={`block px-4 py-2 rounded-md text-sm font-medium transition-colors ${location.startsWith(link.href) ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`}>
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-sidebar-border">
        <div className="text-sm text-sidebar-foreground/70 mb-2">Admin User</div>
        <button className="w-full text-left text-sm text-destructive hover:underline" onClick={() => {
          localStorage.removeItem('family_auth');
          window.location.href = '/login';
        }}>Log out</button>
      </div>
    </div>
  );
}
