import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { BrandMark } from "@/components/logo";
import { DocsSidebar } from "./DocsSidebar";
import { DocsSearch } from "./DocsSearch";
import { TableOfContents } from "./TableOfContents";
import { DocsPager } from "./DocsPager";
import { findDocsPage } from "./docs-nav";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const TOP_TABS = [
  { label: "Documentation", href: "/docs", match: (path: string) => path === "/docs" || (path.startsWith("/docs/") && !path.startsWith("/docs/api-reference")) },
  { label: "API Reference", href: "/docs/api-reference", match: (path: string) => path.startsWith("/docs/api-reference") },
  { label: "Changelog", href: "/docs/changelog", match: (path: string) => path.startsWith("/docs/changelog") },
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

export function DocsLayout({ children, section }: { children: React.ReactNode; section: string }) {
  const page = findDocsPage(section);

  useEffect(() => {
    document.title = page?.title
      ? `${page.title} · SnapServe Docs`
      : "Documentation · SnapServe";
  }, [page?.title]);

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
    <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-slate-900/10">
      <header className="sticky top-0 z-40 hidden lg:block border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto px-6 flex items-center h-14 gap-8">
          <Link href="/docs" className="flex items-center gap-2 shrink-0 hover:opacity-90 transition-opacity">
            <BrandMark iconSize={24} wordmarkHeight={18} />
            <span className="text-[13px] font-medium text-slate-500">Docs</span>
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
                    <span className="text-[13px] font-medium text-slate-500">Docs</span>
                  </Link>
                </div>
                <div className="p-4 flex-1 overflow-y-auto">
                  <div className="mb-6">
                    <DocsSearch />
                  </div>
                  <DocsSidebar activeSection={section} />
                </div>
              </div>
            </SheetContent>
          </Sheet>
          <Link href="/docs" className="flex items-center gap-2">
            <BrandMark iconSize={24} wordmarkHeight={18} />
            <span className="text-[13px] font-medium text-slate-500">Docs</span>
          </Link>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-6 flex">
        <aside className="hidden lg:block w-[280px] shrink-0 pt-6 pb-16 pr-5 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-slate-200">
          <div className="mb-5">
            <DocsSearch />
          </div>
          <DocsSidebar activeSection={section} />
        </aside>

        <main className="flex-1 min-w-0 py-10 lg:py-12 px-0 lg:px-12 flex justify-center relative">
          <div
            key={section}
            className="relative w-full max-w-[760px] prose prose-slate prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-slate-900 prose-p:text-slate-600 prose-li:text-slate-600 prose-strong:text-slate-900 prose-a:text-slate-900 prose-a:underline prose-a:underline-offset-2 hover:prose-a:text-slate-700 prose-code:text-slate-800 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-slate-50 prose-pre:border prose-pre:border-slate-200"
          >
            {children}
            <DocsPager slug={section} />
          </div>
        </main>

        <aside className="hidden xl:block w-[220px] shrink-0 pt-12 pb-16 pl-6 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto">
          <TableOfContents key={section} />
        </aside>
      </div>

      <footer className="border-t border-slate-200 py-8 px-6">
        <div className="max-w-[1600px] mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">SnapServe documentation · app.snapserve.ai</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
            <Link href="/docs/api-reference" className="text-slate-500 hover:text-slate-900">API Reference</Link>
            <Link href="/docs/changelog" className="text-slate-500 hover:text-slate-900">Changelog</Link>
            <a href="https://app.snapserve.ai/app" className="text-slate-500 hover:text-slate-900">Dashboard</a>
            <a href="mailto:support@snapserve.ai" className="text-slate-500 hover:text-slate-900">support@snapserve.ai</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
