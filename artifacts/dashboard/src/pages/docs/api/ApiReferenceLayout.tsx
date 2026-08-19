import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu } from "lucide-react";
import { BrandMark } from "@/components/logo";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ApiSidebar } from "./ApiSidebar";

const TOP_TABS = [
  {
    label: "Documentation",
    href: "/docs",
    match: (path: string) =>
      path === "/docs" || (path.startsWith("/docs/") && !path.startsWith("/docs/api-reference")),
  },
  {
    label: "API Reference",
    href: "/docs/api-reference",
    match: (path: string) => path.startsWith("/docs/api-reference"),
  },
  {
    label: "Changelog",
    href: "/docs/changelog",
    match: (path: string) => path.startsWith("/docs/changelog"),
  },
];

function TopTabs() {
  const [location] = useLocation();
  return (
    <div className="hidden md:flex items-center gap-1 border-b border-slate-200">
      {TOP_TABS.map((tab) => {
        const active = tab.match(location);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative px-3 py-2.5 text-sm transition-colors ${
              active ? "text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
            {active ? (
              <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-slate-900" />
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

export function ApiReferenceLayout({
  children,
  rightRail,
}: {
  children: React.ReactNode;
  rightRail?: React.ReactNode;
}) {
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.remove("dark");
    root.classList.add("light");
    return () => {
      root.classList.remove("light");
      if (hadDark) root.classList.add("dark");
    };
  }, []);

  return (
    <div className="min-h-screen bg-white text-foreground font-sans selection:bg-slate-900/10">
      <header className="sticky top-0 z-40 hidden lg:block border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto px-6 flex items-center h-14 gap-8">
          <Link href="/docs" className="flex items-center gap-2 shrink-0 hover:opacity-90 transition-opacity">
            <BrandMark iconSize={24} wordmarkHeight={18} />
          </Link>
          <TopTabs />
          <div className="ml-auto flex items-center gap-3">
            <a
              href="https://app.snapserve.ai/app"
              className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
            >
              Dashboard
            </a>
            <a
              href="https://app.snapserve.ai/app/api-keys"
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
            >
              Get API key
            </a>
          </div>
        </div>
      </header>

      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/90 backdrop-blur-xl lg:hidden">
        <div className="flex items-center h-14 px-4 gap-4">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 bg-white border-slate-200 p-0">
              <div className="flex flex-col h-full">
                <div className="p-4 border-b border-slate-200">
                  <Link href="/docs" className="flex items-center gap-2">
                    <BrandMark iconSize={24} wordmarkHeight={18} />
                  </Link>
                </div>
                <div className="p-4 flex-1 overflow-y-auto">
                  <ApiSidebar />
                </div>
              </div>
            </SheetContent>
          </Sheet>
          <Link href="/docs" className="flex items-center gap-2">
            <BrandMark iconSize={24} wordmarkHeight={18} />
          </Link>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-6 flex">
        <aside className="hidden lg:block w-[300px] shrink-0 pt-6 pb-16 pr-5 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-slate-200">
          <ApiSidebar />
        </aside>

        <main className="flex-1 min-w-0 py-10 lg:py-12 px-0 lg:px-12">
          <div className="w-full max-w-[760px] mx-auto">{children}</div>
        </main>

        {rightRail ? (
          <aside className="hidden xl:block w-[440px] shrink-0 pt-12 pb-16 pl-6 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-l border-slate-200">
            {rightRail}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
