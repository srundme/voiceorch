import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/usage", label: "Overview", exact: true },
  { href: "/usage/stt", label: "STT" },
  { href: "/usage/tts", label: "TTS" },
  { href: "/usage/llm", label: "LLM" },
  { href: "/usage/users", label: "Users" },
  { href: "/usage/workspaces", label: "Workspaces" },
  { href: "/usage/history", label: "History" },
  { href: "/usage/pricing", label: "Pricing" },
  { href: "/usage/allocations", label: "Allocations" },
  { href: "/usage/alerts", label: "Alerts" },
];

export function UsageSubNav() {
  const [location] = useLocation();
  return (
    <div className="border-b border-border">
      <nav className="flex items-center gap-1 overflow-x-auto pb-px">
        {TABS.map((t) => {
          const active = t.exact ? location === t.href : location === t.href || location.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "border-b-2 px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              data-testid={`usagenav-${t.label.toLowerCase()}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function UsagePageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
