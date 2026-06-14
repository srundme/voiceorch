import { Link, useLocation } from "wouter";
import { 
  Activity, 
  Users, 
  Key, 
  FileText,
  Menu
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/callers", label: "Caller Memory", icon: Users },
  { href: "/api-keys", label: "API Keys", icon: Key },
  { href: "/docs", label: "Documentation", icon: FileText },
];

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const SidebarContent = () => (
    <div className="flex h-full flex-col bg-card border-r border-border">
      <div className="flex h-14 items-center px-4 border-b border-border">
        <div className="flex items-center gap-2 font-semibold text-lg text-primary tracking-tight">
          <span className="font-mono bg-primary text-primary-foreground px-1.5 py-0.5 rounded-md text-sm">PD</span>
          Pendrive
        </div>
      </div>
      <div className="flex-1 py-4">
        <nav className="grid gap-1 px-2">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex w-full dark">
      <div className="hidden md:flex md:w-64 md:flex-col">
        <SidebarContent />
      </div>
      
      <div className="flex flex-col flex-1">
        <header className="flex h-14 items-center gap-4 border-b bg-card px-4 lg:px-6 md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 dark">
              <SidebarContent />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 font-semibold text-lg text-primary tracking-tight">
            <span className="font-mono bg-primary text-primary-foreground px-1.5 py-0.5 rounded-md text-sm">PD</span>
            Pendrive
          </div>
        </header>
        <main className="flex-1 overflow-auto bg-background p-4 lg:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
