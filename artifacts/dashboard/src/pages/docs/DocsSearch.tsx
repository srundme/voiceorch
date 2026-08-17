import { useState, useMemo, useEffect } from "react";
import Fuse from "fuse.js";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DOCS_NAV, hrefForSlug } from "./docs-nav";

const SEARCH_DATA = DOCS_NAV.flatMap((group) =>
  group.items.map((item) => ({
    title: item.title,
    section: group.title,
    slug: item.slug,
    content: `${item.search} ${item.description}`,
  })),
);

export function DocsSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [, setLocation] = useLocation();

  const fuse = useMemo(
    () =>
      new Fuse(SEARCH_DATA, {
        keys: ["title", "content", "section"],
        threshold: 0.3,
        includeMatches: true,
      }),
    [],
  );

  const results = useMemo(() => {
    if (!query) return SEARCH_DATA.slice(0, 8);
    return fuse.search(query).map((r) => r.item);
  }, [query, fuse]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center w-full gap-2 px-3 py-2 text-sm text-slate-500 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors group">
          <Search className="h-4 w-4" aria-hidden />
          <span className="flex-1 text-left">Search docs…</span>
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 font-mono text-[10px] font-medium text-slate-500 group-hover:text-slate-700">
            ⌘K
          </kbd>
        </button>
      </DialogTrigger>
      <DialogContent className="p-0 overflow-hidden max-w-xl border-slate-200 bg-white shadow-2xl">
        <DialogTitle className="sr-only">Search Documentation</DialogTitle>
        <div className="flex items-center px-4 border-b border-slate-200">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            autoFocus
            className="flex h-14 w-full rounded-md bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground text-foreground"
            placeholder="Type to search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No results found for &quot;{query}&quot;
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {results.map((item) => (
                <button
                  key={item.slug}
                  className="flex flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left hover:bg-slate-100 transition-colors"
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                    setLocation(hrefForSlug(item.slug));
                  }}
                >
                  <span className="text-sm font-medium text-foreground">{item.title}</span>
                  <span className="text-xs text-muted-foreground">{item.section}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
