import { useState, useMemo, useEffect } from "react";
import Fuse from "fuse.js";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const SEARCH_DATA = [
  { title: "Introduction", section: "Getting Started", slug: "introduction", content: "SnapServe developer platform. Build apps on the voice orchestration API. Base URL https://app.snapserve.ai/api." },
  { title: "Authentication", section: "Getting Started", slug: "authentication", content: "Use sk_live_ API keys with Authorization Bearer. Create keys in Settings. Never put keys in frontend apps." },
  { title: "Quick Start", section: "Getting Started", slug: "quick-start", content: "List agents and POST /calls/outbound with curl Node Python SDK." },
  { title: "Agents", section: "API Guides", slug: "agents", content: "Create list update toggle delete agents via the REST API." },
  { title: "Outbound Calls", section: "API Guides", slug: "outbound-calls", content: "Place outbound calls, get status, end call, disposition, transfer." },
  { title: "Webhooks", section: "API Guides", slug: "webhooks", content: "Register webhook endpoints, verify X-SnapServe-Signature HMAC, call.completed events." },
  { title: "Phone Numbers", section: "API Guides", slug: "phone-numbers", content: "List assign release numbers. Purchase ₹800 plus GST by card. KYC for India." },
  { title: "Wallet", section: "API Guides", slug: "wallet", content: "GET wallet balance in INR paise. ₹5 per minute. Card top-ups with GST." },
  { title: "SDKs", section: "Reference", slug: "sdks", content: "Official Node @snapserve/sdk and Python snapserve packages." },
  { title: "Errors", section: "Reference", slug: "errors", content: "401 402 404 429 error codes and rate limits." },
  { title: "API Reference", section: "Reference", slug: "api-reference", content: "OpenAPI explorer for the SnapServe REST API." },
  { title: "Pricing", section: "Reference", slug: "pricing", content: "Prepaid INR. ₹500 welcome credit. ₹5 per minute. Phone ₹800 plus GST. Card only." },
  { title: "Changelog", section: "Reference", slug: "changelog", content: "Developer docs rebuild API key auth INR billing." },
];

export function DocsSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [, setLocation] = useLocation();

  const fuse = useMemo(() => new Fuse(SEARCH_DATA, {
    keys: ["title", "content", "section"],
    threshold: 0.3,
    includeMatches: true,
  }), []);

  const results = useMemo(() => {
    if (!query) return SEARCH_DATA.slice(0, 6);
    return fuse.search(query).map(r => r.item);
  }, [query, fuse]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center w-full gap-2 px-3 py-2 text-sm text-zinc-400 bg-[#111114] hover:bg-[#16161a] border border-white/10 rounded-xl transition-colors group">
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/40 px-1.5 font-mono text-[10px] font-medium text-zinc-500 group-hover:text-zinc-300">
            ⌘K
          </kbd>
        </button>
      </DialogTrigger>
      <DialogContent className="p-0 overflow-hidden max-w-xl border-border bg-[#12161F] shadow-2xl">
        <DialogTitle className="sr-only">Search Documentation</DialogTitle>
        <div className="flex items-center px-4 border-b border-white/5">
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
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                    setLocation(item.slug === "introduction" ? "/docs" : `/docs/${item.slug}`);
                  }}
                  className="flex flex-col items-start gap-1 rounded-md px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
                >
                  <span className="text-sm font-medium text-foreground">{item.title}</span>
                  <span className="text-[11px] text-muted-foreground">{item.section}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
