import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ChevronRight, Search } from "lucide-react";
import { getTagGroups, tagLabel, type IndexedOperation } from "../openapi/spec";
import { MethodBadge } from "./MethodBadge";

const INTRO_LINKS = [
  { label: "Introduction", hash: "introduction" },
  { label: "Authentication", hash: "authentication" },
  { label: "Pagination", hash: "pagination" },
  { label: "Rate Limiting", hash: "rate-limiting" },
  { label: "Errors", hash: "errors" },
];

function matchesQuery(op: IndexedOperation, q: string): boolean {
  if (!q) return true;
  const hay = `${op.method} ${op.path} ${op.summary} ${op.id} ${op.tag}`.toLowerCase();
  return hay.includes(q);
}

function TagSection({
  tag,
  description,
  operations,
  activeId,
  forceOpen,
}: {
  tag: string;
  description?: string;
  operations: IndexedOperation[];
  activeId?: string;
  forceOpen: boolean;
}) {
  const containsActive = operations.some((o) => o.id === activeId);
  const [open, setOpen] = useState(containsActive);
  const isOpen = forceOpen || open || containsActive;

  return (
    <div className="flex flex-col">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground transition-colors"
        title={description}
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
        {tagLabel(tag)}
        <span className="ml-auto text-[10px] font-normal text-muted-foreground/40">
          {operations.length}
        </span>
      </button>
      {isOpen ? (
        <div className="flex flex-col gap-0.5 border-l border-slate-200 ml-1.5 pl-2 mb-2">
          {operations.map((op) => {
            const isActive = op.id === activeId;
            return (
              <Link
                key={op.id}
                href={`/docs/api-reference/${op.id}`}
                className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                  isActive
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}
              >
                <MethodBadge method={op.method} />
                <span className="truncate">{op.summary}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ApiSidebar() {
  const [location] = useLocation();
  const activeId = location.startsWith("/docs/api-reference/")
    ? decodeURIComponent(location.slice("/docs/api-reference/".length).split(/[?#]/)[0])
    : undefined;

  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => getTagGroups(), []);

  const filtered = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, operations: g.operations.filter((o) => matchesQuery(o, q)) }))
      .filter((g) => g.operations.length > 0);
  }, [groups, q]);

  return (
    <nav className="flex flex-col gap-4">
      <Link
        href="/docs"
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        ← Documentation
      </Link>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search endpoints"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      </div>

      {!q ? (
        <div className="flex flex-col gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
            Get Started
          </h4>
          <div className="flex flex-col gap-0.5 border-l border-slate-200 ml-1.5 pl-2">
            {INTRO_LINKS.map((l) => (
              <a
                key={l.hash}
                href={`/docs/api-reference#${l.hash}`}
                className="rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-slate-100 transition-colors"
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1">
          Public endpoints
        </h4>
        <p className="text-[11px] text-slate-500 px-2 mb-2 leading-snug">
          Builder APIs only — campaigns &amp; admin hidden.
        </p>
        {filtered.map((g) => (
          <TagSection
            key={g.tag}
            tag={g.tag}
            description={g.description}
            operations={g.operations}
            activeId={activeId}
            forceOpen={Boolean(q)}
          />
        ))}
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground/60 px-2 py-4">No endpoints match.</p>
        ) : null}
      </div>
    </nav>
  );
}
