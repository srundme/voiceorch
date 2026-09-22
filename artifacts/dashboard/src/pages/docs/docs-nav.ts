import {
  Brain,
  BookOpen,
  Bot,
  Calendar,
  CircleHelp,
  Code2,
  CreditCard,
  Database,
  KeyRound,
  LayoutDashboard,
  MessageCircle,
  MessageSquare,
  Phone,
  PhoneCall,
  Plug,
  Rocket,
  Scale,
  ScrollText,
  Shield,
  Sparkles,
  Users,
  Variable,
  Wallet,
  Webhook,
  Video,
  type LucideIcon,
} from "lucide-react";

export type DocsNavLink = {
  title: string;
  slug: string;
  icon?: LucideIcon;
  search: string;
  description: string;
};

export type DocsNavGroup = {
  title: string;
  icon: LucideIcon;
  items: DocsNavLink[];
};

export const DOCS_NAV: DocsNavGroup[] = [
  {
    title: "Get started",
    icon: BookOpen,
    items: [
      {
        title: "Introduction",
        slug: "introduction",
        icon: LayoutDashboard,
        search: "SnapServe AI voice agents platform documentation base URL API dashboard",
        description: "What SnapServe is and how to use these docs.",
      },
      {
        title: "What you can build",
        slug: "what-you-can-build",
        icon: Sparkles,
        search: "inbound outbound booking campaigns WhatsApp meetings vibe dialer apps API",
        description: "Inbound, outbound, WhatsApp, meetings, and apps on the API.",
      },
      {
        title: "Platform concepts",
        slug: "platform-concepts",
        icon: BookOpen,
        search: "agent call wallet phone webhooks variables tools knowledge campaign connections squad",
        description: "Agents, campaigns, connections, outcomes, and calls.",
      },
      {
        title: "Jarvis",
        slug: "jarvis",
        icon: Bot,
        search: "Jarvis support voice assistant recommend jobs publish campaign assign phone",
        description: "Jarvis overlay removed. New assistant plan incoming.",
      },
      {
        title: "Quick Start (API)",
        slug: "quick-start",
        icon: Rocket,
        search: "sk_live list agents POST outbound curl node python wallet 402 get call",
        description: "Authenticate and place your first outbound call.",
      },
      {
        title: "Authentication",
        slug: "authentication",
        icon: KeyRound,
        search: "API keys Bearer sk_live Authorization session cookie",
        description: "API keys for servers; dashboard uses a session cookie.",
      },
      {
        title: "Claude skill & MCP",
        slug: "claude-skill",
        icon: MessageSquare,
        search: "Claude Desktop Claude Code MCP snapserve skill agents campaigns website webhook sk_live",
        description: "Operate SnapServe from Claude Desktop or Claude Code.",
      },
    ],
  },
  {
    title: "Build agents",
    icon: Bot,
    items: [
      {
        title: "Vibe builder",
        slug: "vibe",
        icon: Sparkles,
        search: "vibe studio chat agent connect test gemma sarvam 105b create agent prompt",
        description: "Chat, configure, connect, and test an agent on one page.",
      },
      {
        title: "Agents & builder",
        slug: "agents",
        icon: Bot,
        search: "dashboard builder prompt voice tools publish save agent outcomes analytics",
        description: "Prompt, voice, tools, outcomes, and publish.",
      },
      {
        title: "Variables",
        slug: "variables",
        icon: Variable,
        search: "mustache customer_name agent variables registry outbound questions patient",
        description: "Per-call placeholders in prompts and tools.",
      },
      {
        title: "Contextual Knowledge",
        slug: "knowledge-base",
        icon: Database,
        search: "contextual knowledge documents attach agent upload FAQ website packs follow-up",
        description: "Ground answers on your files, FAQs, and sites — at the right moment on a call.",
      },
      {
        title: "Caller memory",
        slug: "caller-memory",
        icon: Brain,
        search: "caller memory facts operator CRM update campaign lead follow-up context note order_status",
        description: "Push request-status updates so the agent answers follow-ups.",
      },
      {
        title: "Test an agent",
        slug: "testing",
        icon: PhoneCall,
        search: "webcall test simulator outbound tool test vibe test pane browser call",
        description: "Webcall, outbound test, and tool simulator.",
      },
    ],
  },
  {
    title: "Connect & channels",
    icon: Plug,
    items: [
      {
        title: "Connections",
        slug: "connections",
        icon: Plug,
        search: "connections hub WhatsApp email Brevo sheets website form Meta lead ads calendar",
        description: "WhatsApp, email, Sheets, forms, ads, and calendar.",
      },
      {
        title: "WhatsApp",
        slug: "whatsapp",
        icon: MessageCircle,
        search: "WhatsApp chatbot calling WABA Vobiz template 24 hour Meta BSP brochure",
        description: "Text chatbot, templates, and WhatsApp calling.",
      },
      {
        title: "Bookings calendar",
        slug: "calendar",
        icon: Calendar,
        search: "Google Calendar bookings event types availability slots Connections",
        description: "Google Calendar and SnapServe scheduling.",
      },
      {
        title: "Meeting agents",
        slug: "meetings",
        icon: Video,
        search: "Meet Zoom Teams meeting bots join paste link calendar",
        description: "Join Google Meet, Zoom, or Teams as a bot.",
      },
      {
        title: "Website webcall embed",
        slug: "website-embed",
        icon: Code2,
        search: "embed widget website webcall iframe script data-share agent snippet join link",
        description: "Put an agent’s voice widget on your own website.",
      },
      {
        title: "Phone numbers",
        slug: "phone-numbers",
        icon: Phone,
        search: "KYC purchase assign INR GST DID Vobiz inbound outbound",
        description: "Buy, assign, and use India DIDs.",
      },
    ],
  },
  {
    title: "Calls & campaigns",
    icon: PhoneCall,
    items: [
      {
        title: "Calls & history",
        slug: "outbound-calls",
        icon: PhoneCall,
        search: "transcript summary disposition recording outbound inbound history",
        description: "Transcripts, summaries, dispositions, recordings.",
      },
      {
        title: "Campaigns",
        slug: "campaigns",
        icon: PhoneCall,
        search: "batch dial CSV leads dashboard Sheets Meta website retries DNC concurrent AMD transfer",
        description: "Batch outbound from CSV, Sheets, forms, and ads.",
      },
      {
        title: "Event subscriptions",
        slug: "webhooks",
        icon: Webhook,
        search: "HMAC signature call.completed event subscriptions post-call notify payload template JSON custom form intake lead transfer",
        description: "Push call events to your backend.",
      },
      {
        title: "Wallet & billing",
        slug: "wallet",
        icon: Wallet,
        search: "balance paise INR top-up card Razorpay",
        description: "Prepaid wallet, top-ups, and usage.",
      },
    ],
  },
  {
    title: "Account & compliance",
    icon: Shield,
    items: [
      {
        title: "Team workspace",
        slug: "team",
        icon: Users,
        search: "invite teammate share agents workspace partner white-label",
        description: "Invites share agents; partners stay white-label.",
      },
      {
        title: "Compliance",
        slug: "compliance",
        icon: Scale,
        search: "TRAI DND IRDAI DPDP opt-out STOP disclosure India outbound",
        description: "TRAI, DND, IRDAI, DPDP, and WhatsApp rules.",
      },
    ],
  },
  {
    title: "Reference",
    icon: Code2,
    items: [
      {
        title: "API Reference",
        slug: "api-reference",
        icon: ScrollText,
        search: "OpenAPI agents calls webhooks scheduling REST",
        description: "Public REST surface with schemas and cURL.",
      },
      {
        title: "API Wrappers & SDKs",
        slug: "sdks",
        icon: Code2,
        search: "TypeScript Node Python Go client REST wrapper fetch urllib",
        description: "Thin wrappers around the public API.",
      },
      {
        title: "Errors",
        slug: "errors",
        icon: CircleHelp,
        search: "401 402 429 wallet insufficient",
        description: "HTTP status codes and how to recover.",
      },
      {
        title: "Pricing",
        slug: "pricing",
        icon: CreditCard,
        search: "₹5 minute welcome credit phone GST wallet WhatsApp template freeform calling paise",
        description: "Per-minute voice, numbers, and WhatsApp.",
      },
      {
        title: "FAQ",
        slug: "faq",
        icon: CircleHelp,
        search: "common questions calendar variables transcript WhatsApp vibe",
        description: "Short answers to common builder issues.",
      },
      {
        title: "Changelog",
        slug: "changelog",
        icon: ScrollText,
        search: "docs rebuild API key auth vibe whatsapp",
        description: "Documentation and API-consumer changes.",
      },
    ],
  },
];

export function hrefForSlug(slug: string): string {
  if (slug === "introduction") return "/docs";
  if (slug === "api-reference") return "/docs/api-reference";
  return `/docs/${slug}`;
}

export function flattenDocsNav(): DocsNavLink[] {
  return DOCS_NAV.flatMap((g) => g.items);
}

export function findDocsPage(slug: string): DocsNavLink | undefined {
  return flattenDocsNav().find((item) => item.slug === slug);
}

export function adjacentDocsPages(slug: string): {
  prev: DocsNavLink | null;
  next: DocsNavLink | null;
} {
  const items = flattenDocsNav();
  const i = items.findIndex((item) => item.slug === slug);
  if (i < 0) return { prev: null, next: null };
  return {
    prev: i > 0 ? items[i - 1]! : null,
    next: i < items.length - 1 ? items[i + 1]! : null,
  };
}
