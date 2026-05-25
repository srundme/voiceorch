import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { 
  Activity, 
  BarChart3,
  BarChart2,
  Users, 
  Wallet, 
  Cpu, 
  LogOut, 
  Terminal,
  KeyRound,
  Mic2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isDark, setIsDark] = useState(true);

  // Force dark mode on mount since it's the default
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("adminToken");
    window.location.href = `${import.meta.env.BASE_URL}login`;
  };

  const navItems = [
    { href: "/", label: "Overview", icon: Activity },
    { href: "/users", label: "Users", icon: Users },
    { href: "/finance", label: "Finance", icon: Wallet },
    { href: "/usage", label: "Usage", icon: BarChart2 },
    { href: "/platform", label: "Platform", icon: Cpu },
    { href: "/growth", label: "Growth", icon: BarChart3 },
    { href: "/managed-keys", label: "Managed Keys", icon: KeyRound },
    { href: "/voices",       label: "Voices",       icon: Mic2 },
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground selection:bg-primary selection:text-primary-foreground font-mono text-sm">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col hidden md:flex shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Terminal className="h-5 w-5 mr-3 text-primary" />
          <span className="font-bold tracking-tight text-base">VOICEORCH_OPS</span>
        </div>
        
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const Icon = item.icon;
            
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center px-3 py-2.5 rounded-sm text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <Icon className={cn("h-4 w-4 mr-3", isActive ? "opacity-100" : "opacity-70")} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        
        <div className="p-4 border-t border-border">
          <Button 
            variant="ghost" 
            className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-muted h-9 px-3"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4 mr-3 opacity-70" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="md:hidden h-14 border-b flex items-center px-4 bg-card">
          <Terminal className="h-5 w-5 mr-3 text-primary" />
          <span className="font-bold tracking-tight">VOICEORCH_OPS</span>
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
