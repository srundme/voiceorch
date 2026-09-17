import type { ElementType } from "react";
import {
  AgentIcon,
  SettingsIcon,
  PartnerIcon,
  OverviewIcon,
  HealthIcon,
  PulseIcon,
  LineGrowthIcon,
  RetentionIcon,
  MoatIcon,
  UnitEconomicsIcon,
  CallAnalyticsIcon,
  UsersIcon,
  RechargesIcon,
  PhoneIcon,
  AuditIcon,
  UsageIcon,
  PlatformIcon,
  GrowthIcon,
  SignupsIcon,
  EmailIcon,
  ManagedKeysIcon,
  ManagedNumbersIcon,
  VoicesIcon,
  PromptIcon,
  TemplatesIcon,
  AmbientIcon,
  SchedulingIcon,
  GCalIcon,
  CallPricingIcon,
  DpdpIcon,
  DeploymentsIcon,
  WorkshopsIcon,
  TrophyIcon,
  WalletIcon,
} from "@workspace/brand-icons";

export type NavItem = {
  href: string;
  label: string;
  icon: ElementType;
  keywords?: string;
};

export type NavGroupId =
  | "command"
  | "analytics"
  | "revenue"
  | "cost"
  | "customers"
  | "voice"
  | "product"
  | "operations"
  | "demos"
  | "programs"
  | "settings";

export type NavGroup = {
  id: NavGroupId;
  label: string;
  defaultOpen: boolean;
  items: NavItem[];
};

/** Admin V2 information architecture — existing routes kept; new routes added beside them. */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "command",
    label: "Command Center",
    defaultOpen: true,
    items: [
      { href: "/", label: "Overview", icon: OverviewIcon, keywords: "home command center ops" },
      { href: "/operations/alerts", label: "Alerts", icon: UsageIcon, keywords: "attention spikes notifications rules" },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    defaultOpen: false,
    items: [
      { href: "/analytics", label: "SaaS Overview", icon: CallAnalyticsIcon, keywords: "hub reports executive" },
      { href: "/analytics/daily-pnl", label: "Daily P&L", icon: WalletIcon, keywords: "profit margin revenue cost" },
      { href: "/analytics/users", label: "Users", icon: UsersIcon, keywords: "growth signups activated paying" },
      { href: "/analytics/activation", label: "Activation", icon: GrowthIcon, keywords: "funnel dropoff" },
      { href: "/analytics/retention", label: "Retention", icon: RetentionIcon, keywords: "cohorts d1 d7 d30" },
      { href: "/call-analytics", label: "Calls", icon: CallAnalyticsIcon, keywords: "volume completed failed" },
      { href: "/analytics/agents", label: "Agents", icon: AgentIcon, keywords: "agent economics" },
      { href: "/analytics/providers", label: "Providers", icon: UsageIcon, keywords: "stt tts llm cost" },
      { href: "/analytics/unit-economics", label: "Unit Economics", icon: UnitEconomicsIcon },
      { href: "/board/unit-economics", label: "Board Unit Economics", icon: UnitEconomicsIcon, keywords: "cac ltv stack" },
      { href: "/growth", label: "Legacy Funnel", icon: GrowthIcon, keywords: "activation dropoff journeys" },
      { href: "/reports/signups", label: "Signups", icon: SignupsIcon, keywords: "new users" },
      { href: "/board/pulse", label: "Company Pulse", icon: PulseIcon, keywords: "board investor" },
      { href: "/board/growth", label: "Board Growth", icon: LineGrowthIcon },
      { href: "/board/moat", label: "Product Moat", icon: MoatIcon },
      { href: "/board/retention", label: "Board Retention", icon: RetentionIcon },
      { href: "/all-agents", label: "All Agents", icon: AgentIcon, keywords: "user agents edit" },
      { href: "/usage", label: "Usage Monitor", icon: UsageIcon, keywords: "stt tts llm" },
      { href: "/analytics/hub", label: "Analytics Directory", icon: CallAnalyticsIcon, keywords: "links hub" },
    ],
  },
  {
    id: "revenue",
    label: "Revenue",
    defaultOpen: false,
    items: [
      { href: "/finance", label: "Revenue", icon: WalletIcon, keywords: "ledger investor razorpay cash wallet liability" },
      { href: "/revenue/wallets", label: "Wallets", icon: WalletIcon, keywords: "balances liability" },
      { href: "/recharges", label: "Recharges", icon: RechargesIcon, keywords: "wallet topup users" },
      { href: "/revenue/phone-numbers", label: "Phone Numbers", icon: PhoneIcon, keywords: "did numbers" },
    ],
  },
  {
    id: "cost",
    label: "Cost & Pricing",
    defaultOpen: false,
    items: [
      { href: "/cost-pricing", label: "Overview", icon: CallPricingIcon, keywords: "cost pricing hub" },
      { href: "/cost-pricing/provider-costs", label: "Provider Costs", icon: CallPricingIcon },
      { href: "/cost-pricing/customer-pricing", label: "Customer Pricing", icon: CallPricingIcon },
      { href: "/cost-pricing/cost-history", label: "Cost History", icon: AuditIcon },
      { href: "/cost-pricing/pricing-history", label: "Pricing History", icon: AuditIcon },
      { href: "/cost-pricing/simulator", label: "Profit Simulator", icon: UnitEconomicsIcon },
      { href: "/call-pricing", label: "Legacy Call Pricing", icon: CallPricingIcon },
      { href: "/usage/pricing", label: "Legacy Usage Pricing", icon: UsageIcon },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    defaultOpen: true,
    items: [
      { href: "/users", label: "Users", icon: UsersIcon, keywords: "accounts clerk impersonate wallet lifecycle" },
      { href: "/customers/workspaces", label: "Workspaces", icon: PlatformIcon, keywords: "accounts owners economics" },
      { href: "/all-agents", label: "Agents", icon: AgentIcon, keywords: "user agents" },
      { href: "/partners", label: "Partners", icon: PartnerIcon },
    ],
  },
  {
    id: "voice",
    label: "Voice Operations",
    defaultOpen: false,
    items: [
      { href: "/voice/live", label: "Live Calls", icon: PlatformIcon, keywords: "active sessions" },
      { href: "/call-analytics", label: "Call Analytics", icon: CallAnalyticsIcon },
      { href: "/voice/call-quality", label: "Call Quality", icon: CallAnalyticsIcon, keywords: "latency completion" },
      { href: "/voice/failures", label: "Failures", icon: PlatformIcon, keywords: "failed calls" },
      { href: "/analytics/providers", label: "Provider Performance", icon: UsageIcon },
    ],
  },
  {
    id: "product",
    label: "Product & Infrastructure",
    defaultOpen: false,
    items: [
      { href: "/product", label: "Overview", icon: OverviewIcon, keywords: "product hub voices prompts" },
      { href: "/managed-keys", label: "Managed Keys", icon: ManagedKeysIcon },
      { href: "/managed-numbers", label: "Managed Numbers", icon: ManagedNumbersIcon },
      { href: "/product/providers", label: "Providers", icon: UsageIcon, keywords: "infrastructure managed" },
      { href: "/product/voices", label: "Voices", icon: VoicesIcon },
      { href: "/product/prompt-templates", label: "Prompt Templates", icon: PromptIcon },
      { href: "/product/system-prompts", label: "System Prompts", icon: TemplatesIcon },
      { href: "/product/ambient-sounds", label: "Ambient Sounds", icon: AmbientIcon },
      { href: "/product/integrations", label: "Integrations", icon: GCalIcon, keywords: "calendar gcal crm sheets whatsapp" },
      { href: "/scheduling", label: "Scheduling", icon: SchedulingIcon, keywords: "bookings users" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    defaultOpen: false,
    items: [
      { href: "/operations/alerts", label: "Alerts", icon: UsageIcon, keywords: "rules thresholds slack email" },
      { href: "/operations/health", label: "Platform Health", icon: HealthIcon, keywords: "production readiness api redis" },
      { href: "/operations/deployments", label: "Deployments", icon: DeploymentsIcon, keywords: "railway release" },
      { href: "/operations/emails", label: "Emails", icon: EmailIcon, keywords: "send users transactional" },
      { href: "/reports/emails", label: "Email Reports", icon: EmailIcon },
      { href: "/operations/audit", label: "Audit Logs", icon: AuditIcon, keywords: "users actions" },
    ],
  },
  {
    id: "demos",
    label: "Demos",
    defaultOpen: true,
    items: [
      {
        href: "/demos/intake-agent",
        label: "Candidate Intake",
        icon: AgentIcon,
        keywords: "recruiter intake form inbound jd bpo hiring demo",
      },
    ],
  },
  {
    id: "programs",
    label: "Programs",
    defaultOpen: false,
    items: [
      { href: "/voiceathon", label: "Voiceathon", icon: TrophyIcon },
      { href: "/events", label: "Events", icon: WorkshopsIcon },
      { href: "/team-guides", label: "Team Guides", icon: WorkshopsIcon, keywords: "webinar voiceathon pdf download help" },
      { href: "/landing-leads", label: "Partner inquiries", icon: PartnerIcon, keywords: "landing form partner with us leads" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    defaultOpen: false,
    items: [
      { href: "/settings", label: "Platform Settings", icon: SettingsIcon },
      { href: "/settings/admin", label: "Admin Settings", icon: SettingsIcon, keywords: "alerts slack email channels" },
      { href: "/dpdp", label: "DPDP Erasure", icon: DpdpIcon, keywords: "privacy users delete" },
      { href: "/control", label: "Control Hub", icon: SettingsIcon, keywords: "hub config" },
      { href: "/money", label: "Money Hub", icon: WalletIcon, keywords: "hub cash" },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function isNavActive(location: string, href: string) {
  if (href === "/") return location === "/" || location === "";
  return location === href || location.startsWith(`${href}/`);
}

export function groupForLocation(location: string): NavGroupId | null {
  for (const group of NAV_GROUPS) {
    if (group.items.some((item) => isNavActive(location, item.href))) {
      return group.id;
    }
  }
  return null;
}

export const ANALYTICS_TABS = [
  { href: "/analytics", label: "Overview", exact: true },
  { href: "/analytics/daily-pnl", label: "Daily P&L" },
  { href: "/analytics/users", label: "Users" },
  { href: "/analytics/activation", label: "Activation" },
  { href: "/analytics/retention", label: "Retention" },
  { href: "/analytics/agents", label: "Agents" },
  { href: "/analytics/providers", label: "Providers" },
  { href: "/analytics/unit-economics", label: "Unit Econ" },
  { href: "/call-analytics", label: "Calls" },
  { href: "/growth", label: "Funnel" },
  { href: "/usage", label: "Usage" },
  { href: "/board/pulse", label: "Board", match: "/board" },
];

export const MONEY_TABS = [
  { href: "/finance", label: "Revenue" },
  { href: "/revenue/wallets", label: "Wallets" },
  { href: "/recharges", label: "Recharges" },
  { href: "/revenue/phone-numbers", label: "Numbers" },
  { href: "/call-pricing", label: "Legacy Pricing" },
  { href: "/cost-pricing", label: "Cost & Pricing" },
];

export const COST_PRICING_TABS = [
  { href: "/cost-pricing", label: "Overview", exact: true },
  { href: "/cost-pricing/provider-costs", label: "Provider Costs" },
  { href: "/cost-pricing/customer-pricing", label: "Customer Pricing" },
  { href: "/cost-pricing/cost-history", label: "Cost History" },
  { href: "/cost-pricing/pricing-history", label: "Pricing History" },
  { href: "/cost-pricing/simulator", label: "Simulator" },
];

export const OPS_TABS = [
  { href: "/", label: "Overview", exact: true },
  { href: "/platform", label: "Live" },
  { href: "/operations/health", label: "Health" },
  { href: "/operations/deployments", label: "Deploys" },
  { href: "/operations/alerts", label: "Alerts" },
];

export const EMAIL_TABS = [
  { href: "/operations/emails", label: "Send & log" },
  { href: "/reports/emails", label: "Reports" },
];

export const PROMPT_TABS = [
  { href: "/product/prompt-templates", label: "Active template" },
  { href: "/product/system-prompts", label: "Library" },
];

export const PRODUCT_TABS = [
  { href: "/product", label: "Home", exact: true },
  { href: "/managed-keys", label: "Managed Keys" },
  { href: "/managed-numbers", label: "Managed Numbers" },
  { href: "/product/providers", label: "Providers" },
  { href: "/product/voices", label: "Voices" },
  { href: "/product/prompt-templates", label: "Prompts" },
  { href: "/product/system-prompts", label: "System prompts" },
  { href: "/product/ambient-sounds", label: "Ambient" },
  { href: "/product/integrations", label: "Integrations" },
  { href: "/operations/health", label: "Health" },
];

export const CUSTOMERS_TABS = [
  { href: "/users", label: "Users", match: "/users" },
  { href: "/customers/workspaces", label: "Workspaces" },
  { href: "/all-agents", label: "Agents" },
  { href: "/partners", label: "Partners" },
];

export const OPERATIONS_TABS = [
  { href: "/operations/alerts", label: "Alerts" },
  { href: "/operations/health", label: "Health" },
  { href: "/operations/deployments", label: "Deployments" },
  { href: "/operations/emails", label: "Emails" },
  { href: "/operations/audit", label: "Audit" },
];

export const VOICE_TABS = [
  { href: "/voice/live", label: "Live" },
  { href: "/call-analytics", label: "Analytics" },
  { href: "/voice/call-quality", label: "Quality" },
  { href: "/voice/failures", label: "Failures" },
  { href: "/analytics/providers", label: "Providers" },
];

export const SETTINGS_TABS = [
  { href: "/settings", label: "Platform", exact: true },
  { href: "/settings/admin", label: "Admin" },
  { href: "/dpdp", label: "DPDP" },
];
