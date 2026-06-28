import { Link, useLocation } from "wouter";
import { Search, BookMarked, FileCode2, Map, Moon, Sun, Home, Award, FolderOpen } from "lucide-react";
import { useDarkMode } from "@/hooks/use-dark-mode";

const NAV_ITEMS = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/search", icon: Search, label: "Search" },
  { href: "/glossary", icon: BookMarked, label: "Glossary" },
  { href: "/cheatsheet", icon: FileCode2, label: "Cheat Sheet" },
  { href: "/architecture", icon: Map, label: "Architecture" },
  { href: "/files", icon: FolderOpen, label: "Files" },
  { href: "/certificate", icon: Award, label: "Certificate" },
];

export function GlobalNav() {
  const [location] = useLocation();
  const { isDark, toggle } = useDarkMode();

  const isHome = location === "/";

  if (isHome) return null;

  return (
    <nav className="sticky top-0 z-50 bg-background/90 backdrop-blur-sm border-b border-border">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-12">
        <Link href="/" className="flex items-center gap-2 font-bold text-primary text-sm hover:opacity-80 transition-opacity">
          <span className="text-lg">📖</span>
          <span className="hidden sm:inline">The SnapServe Book</span>
        </Link>

        <div className="flex items-center gap-1">
          {NAV_ITEMS.filter(item => item.href !== "/").map(({ href, icon: Icon, label }) => {
            const active = location === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Icon size={13} />
                <span className="hidden md:inline">{label}</span>
              </Link>
            );
          })}
        </div>

        <button
          onClick={toggle}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </nav>
  );
}
