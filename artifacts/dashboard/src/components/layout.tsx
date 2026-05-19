import React from "react";
import { Link, useLocation } from "wouter";
import { Activity, Phone, Users, Key, Settings, Mic, Menu, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Agents", href: "/agents", icon: Users },
    { name: "Calls Log", href: "/calls", icon: Phone },
    { name: "Providers", href: "/providers", icon: Key },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  const NavItems = () => (
    <>
      {navigation.map((item) => {
        const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
        return (
          <Link key={item.name} href={item.href}>
            <div
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              data-testid={`nav-${item.name.toLowerCase().replace(" ", "-")}`}
            >
              <item.icon className="w-4 h-4" />
              {item.name}
            </div>
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="flex min-h-screen w-full bg-background overflow-hidden">
      {/* Sidebar for desktop */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card">
        <div className="flex h-14 items-center px-4 border-b border-border">
          <Link href="/">
            <div className="flex items-center gap-2 font-semibold text-lg cursor-pointer">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Mic className="h-4 w-4" />
              </div>
              <span>VoiceOrch</span>
            </div>
          </Link>
        </div>
        <nav className="flex-1 overflow-auto py-4 px-3 flex flex-col gap-1">
          <NavItems />
        </nav>
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="h-3 w-3 text-green-500" />
            <span>System Status: Online</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex h-14 items-center px-4 border-b border-border md:hidden bg-card">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="mr-2">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle Navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <div className="flex h-14 items-center px-4 border-b border-border">
                <Link href="/">
                  <div className="flex items-center gap-2 font-semibold text-lg">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                      <Mic className="h-4 w-4" />
                    </div>
                    <span>VoiceOrch</span>
                  </div>
                </Link>
              </div>
              <nav className="p-4 flex flex-col gap-1">
                <NavItems />
              </nav>
            </SheetContent>
          </Sheet>
          <div className="font-semibold">VoiceOrch</div>
        </header>

        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
