import { useEffect } from "react";
import { Link } from "wouter";
import { BrandMark } from "@/components/logo";
import { DocsSidebar } from "./DocsSidebar";
import { DocsSearch } from "./DocsSearch";
import { TableOfContents } from "./TableOfContents";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

export function DocsLayout({ children, section }: { children: React.ReactNode; section: string }) {
  useEffect(() => {
    document.title = "Documentation · SnapServe";
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0D12] text-foreground font-sans selection:bg-primary/20">
      {/* Mobile Header */}
      <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-[#0B0D12]/80 backdrop-blur-xl lg:hidden">
        <div className="flex items-center h-14 px-4 gap-4">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-[#0B0D12] border-white/5 p-0">
              <div className="flex flex-col h-full">
                <div className="p-4 border-b border-white/5">
                  <Link href="/app" className="flex items-center gap-2">
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
          <Link href="/app" className="flex items-center gap-2">
            <BrandMark iconSize={24} wordmarkHeight={18} />
          </Link>
        </div>
      </header>

      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 flex">
        {/* Left Sidebar */}
        <aside className="hidden lg:block w-[260px] shrink-0 pt-10 pb-16 pr-8 sticky top-0 h-screen overflow-y-auto border-r border-white/5">
          <Link href="/app" className="flex items-center gap-2 mb-10 hover:opacity-80 transition-opacity">
            <BrandMark iconSize={28} wordmarkHeight={22} />
          </Link>
          <div className="mb-8">
            <DocsSearch />
          </div>
          <DocsSidebar activeSection={section} />
        </aside>

        {/* Center Content */}
        <main className="flex-1 min-w-0 py-10 lg:py-16 px-0 lg:px-12 flex justify-center">
          <div className="w-full max-w-[760px] prose prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-p:text-muted-foreground prose-a:text-primary hover:prose-a:text-primary/80 prose-code:text-primary prose-pre:bg-[#12161F] prose-pre:border prose-pre:border-white/5">
            {children}
          </div>
        </main>

        {/* Right Sidebar (TOC) */}
        <aside className="hidden xl:block w-[220px] shrink-0 pt-16 pb-16 pl-8 sticky top-0 h-screen overflow-y-auto border-l border-white/5">
          <TableOfContents />
        </aside>
      </div>
    </div>
  );
}
