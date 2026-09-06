import { useState } from "react";
import { Link } from "wouter";
import { LogOutIcon } from "@workspace/brand-icons";
import { Menu, Search, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertsBell } from "@/components/alerts-bell";
import { NavTree } from "@/components/nav-tree";
import { CommandPalette } from "@/components/command-palette";
import { useTheme } from "@/components/theme-provider";

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
    >
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

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 cursor-pointer"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
    </Button>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem("adminToken");
    window.location.href = `${import.meta.env.BASE_URL}login`;
  };

  return (
    <div className="flex h-screen h-dvh w-full overflow-hidden bg-background text-foreground selection:bg-primary selection:text-primary-foreground font-sans text-sm">
      <aside className="w-64 h-full border-r border-border bg-card flex-col hidden md:flex shrink-0 overflow-hidden">
        <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
          <BrandMark />
        </div>
        <nav className="flex-1 overflow-y-auto min-h-0 p-2" aria-label="Admin">
          <NavTree />
        </nav>
        <div className="p-2 border-t border-border shrink-0">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-muted h-9 px-3 cursor-pointer"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOutIcon className="h-4 w-4 mr-2.5 opacity-70" aria-hidden />
            Sign Out
          </Button>
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0 flex flex-col">
          <SheetHeader className="h-14 px-4 border-b border-border justify-center shrink-0">
            <SheetTitle className="sr-only">Admin navigation</SheetTitle>
            <BrandMark compact />
          </SheetHeader>
          <nav className="flex-1 overflow-y-auto min-h-0 p-2" aria-label="Admin">
            <NavTree onNavigate={() => setMobileOpen(false)} />
          </nav>
          <div className="p-2 border-t border-border shrink-0">
            <Button
              variant="ghost"
              className="w-full justify-start text-muted-foreground h-9 px-3 cursor-pointer"
              onClick={handleLogout}
            >
              <LogOutIcon className="h-4 w-4 mr-2.5 opacity-70" aria-hidden />
              Sign Out
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-background">
        <div className="h-14 border-b border-border flex items-center justify-between gap-3 px-3 md:px-6 bg-card shrink-0 z-20">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 md:hidden cursor-pointer"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" aria-hidden />
            </Button>
            <div className="md:hidden">
              <BrandMark compact />
            </div>
            <Button
              variant="outline"
              className="hidden sm:inline-flex h-9 gap-2 text-muted-foreground font-normal cursor-pointer"
              onClick={() => setCommandOpen(true)}
              aria-label="Search pages"
            >
              <Search className="h-3.5 w-3.5" aria-hidden />
              <span className="text-xs">Jump to page</span>
              <Kbd className="ml-2 hidden lg:inline-flex">⌘K</Kbd>
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 sm:hidden cursor-pointer"
              onClick={() => setCommandOpen(true)}
              aria-label="Search pages"
            >
              <Search className="h-4 w-4" aria-hidden />
            </Button>
            <ThemeToggle />
            <AlertsBell />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6 scroll-pt-16">
          <div className="max-w-7xl mx-auto space-y-6">{children}</div>
        </div>
      </main>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}
