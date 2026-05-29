import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  Activity, 
  BarChart3,
  BarChart2,
  Users, 
  Wallet, 
  Cpu, 
  LogOut, 
  KeyRound,
  Mic2,
  Settings,
  FileText,
  Bot,
  Calendar,
  Phone,
  PhoneCall,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AlertsBell } from "@/components/alerts-bell";

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2 group">
      <img
        src={`${import.meta.env.BASE_URL}snapserve-icon-light.png`}
        alt=""
        aria-hidden
        className={cn("shrink-0 select-none", compact ? "h-5 w-5" : "h-6 w-6")}
      />
      <img
        src={`${import.meta.env.BASE_URL}snapserve-wordmark-light.png`}
        alt="SnapServe"
        className={cn("select-none", compact ? "h-3.5" : "h-4")}
      />
      <span
        className="text-[9px] font-semibold uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-sm border"
        style={{
          color: "hsl(var(--muted-foreground))",
          borderColor: "hsl(var(--border))",
          background: "hsl(var(--muted) / 0.4)",
        }}
      >
        Admin
      </span>
    </Link>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const handleLogout = () => {
    localStorage.removeItem("adminToken");
    window.location.href = `${import.meta.env.BASE_URL}login`;
  };

  const navItems = [
    { href: "/", label: "Overview", icon: Activity },
    { href: "/users", label: "Users", icon: Users },
    { href: "/finance", label: "Finance", icon: Wallet },
    { href: "/usage", label: "Usage Monitoring", icon: BarChart2 },
    { href: "/platform", label: "Platform", icon: Cpu },
    { href: "/growth", label: "Growth", icon: BarChart3 },
    { href: "/managed-keys", label: "Managed Keys", icon: KeyRound },
    { href: "/managed-numbers", label: "Managed Numbers", icon: Phone },
    { href: "/voices",       label: "Voices",       icon: Mic2 },
    { href: "/prompt-template", label: "Prompt Template", icon: FileText },
    { href: "/all-agents",   label: "All Agents",   icon: Bot },
    { href: "/scheduling",   label: "Scheduling",   icon: Calendar },
    { href: "/call-pricing", label: "Call Pricing",  icon: PhoneCall },
    { href: "/settings",     label: "Settings",     icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground selection:bg-primary selection:text-primary-foreground font-sans text-sm">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col hidden md:flex shrink-0">
        <div className="h-16 flex items-center px-5 border-b border-border">
          <BrandMark />
        </div>
        
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const Icon = item.icon;
            
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center px-3 py-2 rounded-md text-[13px] font-medium transition-colors",
                  isActive 
                    ? "bg-muted text-foreground" 
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <Icon className={cn("h-4 w-4 mr-2.5", isActive ? "opacity-100 text-primary" : "opacity-70")} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        
        <div className="p-3 border-t border-border">
          <Button 
            variant="ghost" 
            className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-muted h-9 px-3"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4 mr-2.5 opacity-70" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="h-14 border-b border-border flex items-center justify-between px-4 md:px-8 bg-card">
          <div className="flex items-center md:hidden">
            <BrandMark compact />
          </div>
          <div className="hidden md:block" />
          <div className="flex items-center gap-2">
            <AlertsBell />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6 md:p-8">
          <div className="max-w-7xl mx-auto space-y-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
