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
    <div className="min-h-screen overflow-x-clip bg-white font-sans text-foreground selection:bg-slate-900/10">
      <header className="sticky top-0 z-40 hidden border-b border-slate-200 bg-white/90 backdrop-blur-xl lg:block">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4 sm:gap-6 sm:px-6 xl:gap-8">
          <Link href="/docs" className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-90">
            <BrandMark iconSize={24} wordmarkHeight={18} />
          </Link>
          <TopTabs />
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <a
              href="https://app.snapserve.ai/app"
              className="text-sm text-slate-500 transition-colors hover:text-slate-900"
            >
              Dashboard
            </a>
            <a
              href="https://app.snapserve.ai/app/api-keys"
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Get API key
            </a>
          </div>
        </div>
      </header>

      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/90 backdrop-blur-xl lg:hidden">
        <div className="flex h-14 items-center gap-4 px-4">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[min(20rem,85vw)] border-slate-200 bg-white p-0">
              <div className="flex h-full flex-col">
                <div className="border-b border-slate-200 p-4">
                  <Link href="/docs" className="flex items-center gap-2">
                    <BrandMark iconSize={24} wordmarkHeight={18} />
                  </Link>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
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

      <div className="mx-auto flex w-full min-w-0 max-w-[1600px] px-4 sm:px-6">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[min(16rem,28vw)] shrink-0 overflow-y-auto border-r border-slate-200 pb-16 pr-4 pt-6 lg:block xl:w-[17.5rem] xl:pr-5 2xl:w-[18.75rem]">
          <ApiSidebar />
        </aside>

        <main className="@container/api relative min-w-0 flex-1 px-0 py-8 sm:py-10 lg:px-6 lg:py-12 xl:px-8">
          <div className="mx-auto w-full min-w-0 max-w-[min(47.5rem,100%)]">{children}</div>
        </main>

        {rightRail ? (
          <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[min(24rem,32vw)] shrink-0 overflow-y-auto border-l border-slate-200 pb-16 pl-4 pt-12 2xl:block 2xl:w-[27.5rem] 2xl:pl-6">
            {rightRail}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
