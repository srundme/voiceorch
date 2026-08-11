import { useState, useMemo, useEffect } from "react";
import Fuse from "fuse.js";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const SEARCH_DATA = [
  { title: "Introduction", section: "Get started", slug: "introduction", content: "SnapServe AI voice agents platform documentation base URL API" },
  { title: "What you can build", section: "Get started", slug: "what-you-can-build", content: "inbound outbound booking campaigns dialer apps API" },
  { title: "Platform concepts", section: "Get started", slug: "platform-concepts", content: "agent call wallet phone webhooks variables tools knowledge" },
  { title: "Quick Start", section: "Get started", slug: "quick-start", content: "sk_live list agents POST outbound curl node python" },
  { title: "Authentication", section: "Get started", slug: "authentication", content: "API keys Bearer sk_live Authorization" },
  { title: "Claude skill & MCP", section: "Get started", slug: "claude-skill", content: "Claude Desktop Claude Code MCP snapserve skill agents campaigns website webhook sk_live" },
  { title: "Agents & builder", section: "Product", slug: "agents", content: "dashboard builder prompt voice tools publish save agent" },
  { title: "Variables", section: "Product", slug: "variables", content: "mustache customer_name agent variables registry" },
  { title: "Knowledge base", section: "Product", slug: "knowledge-base", content: "RAG documents attach agent upload" },
  { title: "Bookings calendar", section: "Product", slug: "calendar", content: "Google Calendar bookings event types availability slots Connections" },
  { title: "Meeting agents", section: "Product", slug: "meetings", content: "Meet Zoom Teams meeting bots join paste link calendar" },
  { title: "Phone numbers", section: "Product", slug: "phone-numbers", content: "KYC purchase assign INR GST" },
  { title: "Calls & history", section: "Product", slug: "outbound-calls", content: "transcript summary disposition recording outbound" },
  { title: "Campaigns", section: "Product", slug: "campaigns", content: "batch dial CSV leads dashboard" },
  { title: "Event subscriptions", section: "Product", slug: "webhooks", content: "HMAC signature call.completed event subscriptions post-call notify form intake lead transfer" },
  { title: "Wallet", section: "Product", slug: "wallet", content: "balance paise INR top-up card" },
  { title: "API Reference", section: "Reference", slug: "api-reference", content: "OpenAPI agents calls webhooks scheduling" },
  { title: "API Wrappers & SDKs", section: "Reference", slug: "sdks", content: "TypeScript Node Python Go client REST wrapper fetch urllib" },
  { title: "Errors", section: "Reference", slug: "errors", content: "401 402 429" },
  { title: "Pricing", section: "Reference", slug: "pricing", content: "₹5 minute welcome credit phone GST" },
  { title: "FAQ", section: "Reference", slug: "faq", content: "common questions calendar variables transcript" },
  { title: "Changelog", section: "Reference", slug: "changelog", content: "docs rebuild API key auth" },
];

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
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Search...</span>
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
                    setLocation(
                      item.slug === "introduction"
                        ? "/docs"
                        : item.slug === "api-reference"
                          ? "/docs/api-reference"
                          : `/docs/${item.slug}`,
                    );
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
