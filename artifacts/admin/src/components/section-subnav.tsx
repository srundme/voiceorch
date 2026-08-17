import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

export type SectionTab = {
  href: string;
  label: string;
  exact?: boolean;
  match?: string;
};

export function SectionSubNav({ tabs }: { tabs: SectionTab[] }) {
  const [location] = useLocation();

  return (
    <nav
      aria-label="Section"
      className="border-b border-border -mt-2 mb-2"
    >
      <div className="flex items-center gap-1 overflow-x-auto pb-px">
        {tabs.map((t) => {
          const active = t.match
            ? location === t.match || location.startsWith(`${t.match}/`)
            : t.exact
              ? location === t.href || (t.href === "/" && (location === "/" || location === ""))
              : location === t.href || location.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "border-b-2 px-3 py-2 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
