import { Link } from "wouter";
import {
  BookOpen,
  Bot,
  Code2,
  CreditCard,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Phone,
  PhoneCall,
  Rocket,
  ScrollText,
  Wallet,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { MethodBadge } from "./api/MethodBadge";
import type { HttpMethod } from "./openapi/types";
import { ExternalFooterLink } from "./DocsUi";

type NavLink = {
  title: string;
  slug: string;
  icon?: LucideIcon;
};

type ApiEndpoint = {
  title: string;
  method: HttpMethod;
  opId: string;
};

type NavGroup = {
  title: string;
  icon: LucideIcon;
  items: NavLink[];
  endpoints?: ApiEndpoint[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    icon: BookOpen,
    items: [
      { title: "Introduction", slug: "introduction", icon: LayoutDashboard },
      { title: "Authentication", slug: "authentication", icon: KeyRound },
      { title: "Quick Start", slug: "quick-start", icon: Rocket },
    ],
  },
  {
    title: "Agents",
    icon: Bot,
    items: [{ title: "Overview", slug: "agents" }],
    endpoints: [
      { title: "List agents", method: "get", opId: "listAgents" },
      { title: "Create agent", method: "post", opId: "createAgent" },
      { title: "Get agent", method: "get", opId: "getAgent" },
      { title: "Update agent", method: "patch", opId: "updateAgent" },
      { title: "Toggle agent", method: "patch", opId: "toggleAgent" },
      { title: "Delete agent", method: "delete", opId: "deleteAgent" },
    ],
  },
  {
    title: "Calls",
    icon: PhoneCall,
    items: [{ title: "Overview", slug: "outbound-calls" }],
    endpoints: [
      { title: "Make outbound call", method: "post", opId: "initiateOutboundCall" },
      { title: "List calls", method: "get", opId: "listCalls" },
      { title: "Get call", method: "get", opId: "getCall" },
      { title: "End call", method: "patch", opId: "endCall" },
      { title: "Set disposition", method: "patch", opId: "updateCallDisposition" },
      { title: "Transfer call", method: "post", opId: "transferCall" },
    ],
  },
  {
    title: "Webhooks",
    icon: Webhook,
    items: [{ title: "Overview", slug: "webhooks" }],
    endpoints: [
      { title: "List endpoints", method: "get", opId: "listWebhookEndpoints" },
      { title: "Create endpoint", method: "post", opId: "createWebhookEndpoint" },
      { title: "Update endpoint", method: "patch", opId: "updateWebhookEndpoint" },
      { title: "Delete endpoint", method: "delete", opId: "deleteWebhookEndpoint" },
    ],
  },
  {
    title: "Phone & Wallet",
    icon: Phone,
    items: [
      { title: "Phone Numbers", slug: "phone-numbers", icon: Phone },
      { title: "Wallet", slug: "wallet", icon: Wallet },
      { title: "Pricing", slug: "pricing", icon: CreditCard },
    ],
  },
  {
    title: "Reference",
    icon: Code2,
    items: [
      { title: "SDKs", slug: "sdks", icon: Code2 },
      { title: "Errors", slug: "errors", icon: Gauge },
      { title: "API Reference", slug: "api-reference", icon: ScrollText },
      { title: "Changelog", slug: "changelog", icon: ScrollText },
    ],
  },
];

function hrefForSlug(slug: string) {
  return slug === "introduction" ? "/docs" : `/docs/${slug}`;
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
                const isActive = activeSection === item.slug;
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
              {group.endpoints?.map((ep) => (
                <Link
                  key={ep.opId}
                  href={`/docs/api-reference/${ep.opId}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors"
                >
                  <MethodBadge method={ep.method} />
                  <span className="truncate">{ep.title}</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })}

      <div className="mt-2 border-t border-white/10 pt-4 px-1 flex flex-col gap-0.5">
        <ExternalFooterLink href="https://app.snapserve.ai/app" icon={<LayoutDashboard className="h-3.5 w-3.5" />}>
          Platform
        </ExternalFooterLink>
        <ExternalFooterLink href="https://app.snapserve.ai/app/api-keys" icon={<KeyRound className="h-3.5 w-3.5" />}>
          API Keys
        </ExternalFooterLink>
      </div>
    </nav>
  );
}
