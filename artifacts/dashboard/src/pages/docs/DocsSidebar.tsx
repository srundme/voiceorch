import { Link } from "wouter";
import {
  BookOpen,
  Bot,
  Calendar,
  CircleHelp,
  Code2,
  CreditCard,
  Database,
  KeyRound,
  LayoutDashboard,
  Phone,
  PhoneCall,
  Rocket,
  ScrollText,
  Sparkles,
  Variable,
  Wallet,
  Webhook,
  MessageSquare,
  Video,
  type LucideIcon,
} from "lucide-react";
import { ExternalFooterLink } from "./DocsUi";

type NavLink = {
  title: string;
  slug: string;
  icon?: LucideIcon;
};

type NavGroup = {
  title: string;
  icon: LucideIcon;
  items: NavLink[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Get started",
    icon: BookOpen,
    items: [
      { title: "Introduction", slug: "introduction", icon: LayoutDashboard },
      { title: "What you can build", slug: "what-you-can-build", icon: Sparkles },
      { title: "Platform concepts", slug: "platform-concepts", icon: BookOpen },
      { title: "Quick Start (API)", slug: "quick-start", icon: Rocket },
      { title: "Authentication", slug: "authentication", icon: KeyRound },
      { title: "Claude skill & MCP", slug: "claude-skill", icon: MessageSquare },
    ],
  },
  {
    title: "Product guides",
    icon: Bot,
    items: [
      { title: "Agents & builder", slug: "agents", icon: Bot },
      { title: "Variables", slug: "variables", icon: Variable },
      { title: "Knowledge base", slug: "knowledge-base", icon: Database },
      { title: "Bookings calendar", slug: "calendar", icon: Calendar },
      { title: "Meeting agents", slug: "meetings", icon: Video },
      { title: "Phone numbers", slug: "phone-numbers", icon: Phone },
      { title: "Calls & history", slug: "outbound-calls", icon: PhoneCall },
      { title: "Campaigns", slug: "campaigns", icon: PhoneCall },
      { title: "Event subscriptions", slug: "webhooks", icon: Webhook },
      { title: "Wallet & pricing", slug: "wallet", icon: Wallet },
    ],
  },
  {
    title: "Reference",
    icon: Code2,
    items: [
      { title: "API Reference", slug: "api-reference", icon: ScrollText },
      { title: "API Wrappers & SDKs", slug: "sdks", icon: Code2 },
      { title: "Errors", slug: "errors", icon: CircleHelp },
      { title: "Pricing", slug: "pricing", icon: CreditCard },
      { title: "FAQ", slug: "faq", icon: CircleHelp },
      { title: "Changelog", slug: "changelog", icon: ScrollText },
    ],
  },
];

function hrefForSlug(slug: string) {
  if (slug === "introduction") return "/docs";
  if (slug === "api-reference") return "/docs/api-reference";
  return `/docs/${slug}`;
}

export function DocsSidebar({ activeSection }: { activeSection: string }) {
  return (
    <nav className="flex flex-col gap-7 pb-8">
      {NAV_GROUPS.map((group) => {
        const GroupIcon = group.icon;
        return (
          <div key={group.title} className="flex flex-col">
            <div className="flex items-center gap-2 px-2 mb-2">
              <GroupIcon className="h-3.5 w-3.5 text-zinc-400" />
              <h4 className="text-[13px] font-semibold text-zinc-200">{group.title}</h4>
            </div>
            <div className="relative ml-3.5 flex flex-col gap-0.5 border-l border-white/10 pl-3">
              {group.items.map((item) => {
                const isActive =
                  activeSection === item.slug ||
                  (item.slug === "api-reference" && activeSection.startsWith("api-reference"));
                const ItemIcon = item.icon;
                return (
                  <Link
                    key={item.slug}
                    href={hrefForSlug(item.slug)}
                    className={`relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                      isActive
                        ? "text-sky-300 bg-sky-400/10"
                        : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04]"
                    }`}
                  >
                    {isActive ? (
                      <span className="absolute -left-[13px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-sky-400" />
                    ) : null}
                    {ItemIcon ? <ItemIcon className="h-3.5 w-3.5 shrink-0 opacity-70" /> : null}
                    <span className="truncate">{item.title}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="mt-2 border-t border-white/10 pt-4 px-1 flex flex-col gap-0.5">
        <ExternalFooterLink href="https://app.snapserve.ai/app" icon={<LayoutDashboard className="h-3.5 w-3.5" />}>
          Open dashboard
        </ExternalFooterLink>
        <ExternalFooterLink href="https://app.snapserve.ai/app/api-keys" icon={<KeyRound className="h-3.5 w-3.5" />}>
          API Keys
        </ExternalFooterLink>
      </div>
    </nav>
  );
}
