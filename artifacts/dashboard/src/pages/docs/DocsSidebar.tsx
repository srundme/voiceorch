import { Link } from "wouter";

const NAV_GROUPS = [
  {
    title: "Getting Started",
    items: [
      { title: "Introduction", slug: "introduction" },
      { title: "Platform Concepts", slug: "platform-concepts" },
      { title: "Quick Start", slug: "quick-start" },
      { title: "Authentication", slug: "authentication" },
    ],
  },
  {
    title: "Building Agents",
    items: [
      { title: "Agent Overview", slug: "agents" },
      { title: "Agent Builder", slug: "agent-builder" },
      { title: "Prompting Guide", slug: "prompting-guide" },
      { title: "Tools & Functions", slug: "tools" },
      { title: "Knowledge Base", slug: "knowledge-base" },
    ],
  },
  {
    title: "Providers",
    items: [
      { title: "Overview", slug: "providers" },
      { title: "ASR / Speech-to-Text", slug: "asr-providers" },
      { title: "LLM Providers", slug: "llm-providers" },
      { title: "TTS / Text-to-Speech", slug: "tts-providers" },
      { title: "Telephony", slug: "telephony-providers" },
    ],
  },
  {
    title: "Campaigns",
    items: [
      { title: "Overview", slug: "campaigns" },
      { title: "Managing Leads", slug: "managing-leads" },
    ],
  },
  {
    title: "Scheduling",
    items: [
      { title: "Overview", slug: "scheduling" },
      { title: "Google Calendar", slug: "google-calendar" },
    ],
  },
  {
    title: "Reference",
    items: [
      { title: "Webhooks", slug: "webhooks" },
      { title: "API Reference", slug: "api-reference" },
      { title: "SDKs & Claude Skill", slug: "sdks" },
      { title: "Pricing & Usage", slug: "pricing" },
      { title: "Changelog", slug: "changelog" },
    ],
  },
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
