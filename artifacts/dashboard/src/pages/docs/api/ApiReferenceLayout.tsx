import { Link } from "wouter";
import { Menu } from "lucide-react";
import { BrandMark } from "@/components/logo";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ApiSidebar } from "./ApiSidebar";

export function ApiReferenceLayout({
  children,
  rightRail,
}: {
  children: React.ReactNode;
  rightRail?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0B0D12] text-foreground font-sans selection:bg-primary/20">
      <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-[#0B0D12]/80 backdrop-blur-xl lg:hidden">
        <div className="flex items-center h-14 px-4 gap-4">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 bg-[#0B0D12] border-white/5 p-0">
              <div className="flex flex-col h-full">
                <div className="p-4 border-b border-white/5">
                  <Link href="/app" className="flex items-center gap-2">
                    <BrandMark iconSize={24} wordmarkHeight={18} />
                  </Link>
                </div>
                <div className="p-4 flex-1 overflow-y-auto">
                  <ApiSidebar />
                </div>
              </div>
            </SheetContent>
          </Sheet>
          <Link href="/app" className="flex items-center gap-2">
            <BrandMark iconSize={24} wordmarkHeight={18} />
          </Link>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 flex">
        <aside className="hidden lg:block w-[300px] shrink-0 pt-10 pb-16 pr-6 sticky top-0 h-screen overflow-y-auto border-r border-white/5">
          <Link href="/app" className="flex items-center gap-2 mb-8 hover:opacity-80 transition-opacity">
            <BrandMark iconSize={28} wordmarkHeight={22} />
          </Link>
          <ApiSidebar />
        </aside>

        <main className="flex-1 min-w-0 py-10 lg:py-16 px-0 lg:px-12">
          <div className="w-full max-w-[760px] mx-auto">{children}</div>
        </main>

        {rightRail ? (
          <aside className="hidden xl:block w-[440px] shrink-0 pt-16 pb-16 pl-6 sticky top-0 h-screen overflow-y-auto border-l border-white/5">
            {rightRail}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
