import { useState, useMemo, useEffect } from "react";
import Fuse from "fuse.js";
import { Link, useLocation } from "wouter";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const SEARCH_DATA = [
  { title: "Introduction", section: "Getting Started", slug: "introduction", content: "SnapServe is the orchestration layer for AI voice agents. You bring your API keys for any combination of ASR, LLM, TTS, and telephony provider — SnapServe handles real-time audio routing, session management, tool calling, and analytics." },
  { title: "Quick Start", section: "Getting Started", slug: "quick-start", content: "Get an agent live in 5 minutes. Add a provider key, create an agent, configure the voice, test with WebCall, go live." },
  { title: "Authentication", section: "Getting Started", slug: "authentication", content: "SnapServe uses Google OAuth for authentication. There are no passwords. All API requests require the session token in the Authorization header." },
  { title: "Agents", section: "Core Concepts", slug: "agents", content: "An agent is the core unit in SnapServe. It defines the full voice pipeline: how speech is transcribed, how the language model reasons, and how responses are spoken." },
  { title: "Providers", section: "Core Concepts", slug: "providers", content: "Providers are your API keys for third-party AI and telephony services. SnapServe uses them at runtime to route audio and LLM requests." },
  { title: "Scheduling", section: "Core Concepts", slug: "scheduling", content: "SnapServe includes a full multi-tenant scheduling engine. Your agents can book appointments, reschedule, and cancel — all via voice, mid-call." },
  { title: "Campaigns", section: "Core Concepts", slug: "campaigns", content: "Campaigns let you run outbound voice calling at scale — upload a lead list, configure your dial logic, and SnapServe handles the rest." },
  { title: "API Reference", section: "Reference", slug: "api-reference", content: "The SnapServe REST API is available at https://app.snapserve.ai/api. All endpoints require Authorization: Bearer <token>." },
  { title: "Changelog", section: "Reference", slug: "changelog", content: "Changelog fetches the live changelog from the SnapServe GitHub repository." }
];

export function DocsSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [, setLocation] = useLocation();

  const fuse = useMemo(() => new Fuse(SEARCH_DATA, {
    keys: ["title", "content", "section"],
    threshold: 0.3,
    includeMatches: true
  }), []);

  const results = useMemo(() => {
    if (!query) return SEARCH_DATA.slice(0, 5);
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
        <button className="flex items-center w-full gap-2 px-3 py-2 text-sm text-muted-foreground bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors group">
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Search documentation...</span>
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
            <span className="text-xs">⌘</span>K
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
                    setLocation(`/docs${item.slug === "introduction" ? "" : `/${item.slug}`}`);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex flex-col text-left px-3 py-2 rounded-md hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm font-medium text-foreground">{item.title}</span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.section}</span>
                  </div>
                  <span className="text-xs text-muted-foreground line-clamp-1 mt-1">{item.content}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
