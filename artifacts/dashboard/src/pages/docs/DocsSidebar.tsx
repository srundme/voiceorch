import { Link } from "wouter";

const NAV_GROUPS = [
  {
    title: "Getting Started",
    items: [
      { title: "Introduction", slug: "introduction" },
      { title: "Quick Start", slug: "quick-start" },
      { title: "Authentication", slug: "authentication" }
    ]
  },
  {
    title: "Core Concepts",
    items: [
      { title: "Agents", slug: "agents" },
      { title: "Providers", slug: "providers" },
      { title: "Scheduling", slug: "scheduling" },
      { title: "Campaigns", slug: "campaigns" }
    ]
  },
  {
    title: "Reference",
    items: [
      { title: "API Reference", slug: "api-reference" },
      { title: "Changelog", slug: "changelog" }
    ]
  }
];

export function DocsSidebar({ activeSection }: { activeSection: string }) {
  return (
    <nav className="flex flex-col gap-8">
      {NAV_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
            {group.title}
          </h4>
          <div className="flex flex-col gap-1 border-l border-white/5 ml-1 pl-3">
            {group.items.map((item) => {
              const isActive = activeSection === item.slug;
              const href = item.slug === "introduction" ? "/docs" : `/docs/${item.slug}`;
              return (
                <Link
                  key={item.slug}
                  href={href}
                  className={`text-sm py-1.5 transition-colors relative ${
                    isActive
                      ? "text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {isActive && (
                    <span className="absolute -left-[13px] top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary rounded-full" />
                  )}
                  {item.title}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
