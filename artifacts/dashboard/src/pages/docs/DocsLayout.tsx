import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { BrandMark } from "@/components/logo";
import { DocsSidebar } from "./DocsSidebar";
import { DocsSearch } from "./DocsSearch";
import { TableOfContents } from "./TableOfContents";
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
    <div className="hidden md:flex items-center gap-1 border-b border-white/10">
      {TOP_TABS.map((tab) => {
        const active = tab.match(location);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative px-3 py-2.5 text-sm transition-colors ${
              active ? "text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.label}
            {active ? (
              <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-sky-400" />
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

export function DocsLayout({ children, section }: { children: React.ReactNode; section: string }) {
  useEffect(() => {
    document.title = "Documentation · SnapServe";
  }, []);

  return (
    <div className="min-h-screen bg-[#050506] text-foreground font-sans selection:bg-sky-400/25">
      {/* Desktop top bar */}
      <header className="sticky top-0 z-40 hidden lg:block border-b border-white/10 bg-[#050506]/90 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto px-6 flex items-center h-14 gap-8">
          <Link href="/docs" className="flex items-center gap-2 shrink-0 hover:opacity-90 transition-opacity">
            <BrandMark iconSize={24} wordmarkHeight={18} />
          </Link>
          <TopTabs />
          <div className="ml-auto flex items-center gap-3">
            <a
              href="https://app.snapserve.ai/app"
              className="text-sm text-zinc-400 hover:text-white transition-colors"
            >
              Dashboard
            </a>
            <a
              href="https://app.snapserve.ai/app/api-keys"
              className="rounded-lg bg-sky-500/15 border border-sky-400/30 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/25 transition-colors"
            >
              Get API key
            </a>
          </div>
        </div>
      </header>

      {/* Mobile Header */}
      <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-[#050506]/90 backdrop-blur-xl lg:hidden">
        <div className="flex items-center h-14 px-4 gap-4">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 bg-[#050506] border-white/10 p-0">
              <div className="flex flex-col h-full">
                <div className="p-4 border-b border-white/10">
                  <Link href="/docs" className="flex items-center gap-2">
                    <BrandMark iconSize={24} wordmarkHeight={18} />
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
          </Link>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-6 flex">
        <aside className="hidden lg:block w-[280px] shrink-0 pt-6 pb-16 pr-5 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-white/10">
          <div className="mb-5">
            <DocsSearch />
          </div>
          <DocsSidebar activeSection={section} />
        </aside>

        <main className="flex-1 min-w-0 py-10 lg:py-12 px-0 lg:px-12 flex justify-center relative">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
              maskImage: "linear-gradient(to bottom, black 0%, black 35%, transparent 75%)",
            }}
          />
          <div
            key={section}
            className="relative w-full max-w-[760px] prose prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-white prose-p:text-zinc-400 prose-li:text-zinc-400 prose-strong:text-zinc-100 prose-a:text-sky-300 hover:prose-a:text-sky-200 prose-code:text-sky-300 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-[#0c0c0f] prose-pre:border prose-pre:border-white/10"
          >
            {children}
          </div>
        </main>

        <aside className="hidden xl:block w-[220px] shrink-0 pt-12 pb-16 pl-6 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto">
          <TableOfContents key={section} />
        </aside>
      </div>
    </div>
  );
}
