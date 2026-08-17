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
  GraduationIcon,
  BuildingIcon,
  ShieldAgentIcon,
  WalletIcon,
} from "@workspace/brand-icons";

export type NavItem = {
  href: string;
  label: string;
  icon: ElementType;
  keywords?: string;
};

export type NavGroupId = "today" | "analytics" | "money" | "customers" | "control" | "labs";

export type NavGroup = {
  id: NavGroupId;
  label: string;
  defaultOpen: boolean;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "today",
    label: "Today",
    defaultOpen: true,
    items: [
      { href: "/", label: "Today", icon: OverviewIcon, keywords: "home overview ops command" },
      { href: "/platform", label: "Live & fails", icon: PlatformIcon, keywords: "active sessions failed calls" },
      { href: "/health", label: "Health", icon: HealthIcon, keywords: "production readiness" },
      { href: "/deployments", label: "Deployments", icon: DeploymentsIcon, keywords: "railway release" },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    defaultOpen: false,
    items: [
      { href: "/analytics", label: "Analytics home", icon: CallAnalyticsIcon, keywords: "hub reports" },
      { href: "/call-analytics", label: "Calls", icon: CallAnalyticsIcon, keywords: "volume completed failed" },
      { href: "/growth", label: "Funnel", icon: GrowthIcon, keywords: "activation dropoff journeys" },
      { href: "/usage", label: "Usage", icon: UsageIcon, keywords: "stt tts llm cost" },
      { href: "/reports/signups", label: "Signups", icon: SignupsIcon, keywords: "new users" },
      { href: "/board/pulse", label: "Company pulse", icon: PulseIcon, keywords: "board investor" },
      { href: "/board/growth", label: "Board growth", icon: LineGrowthIcon },
      { href: "/board/retention", label: "Retention", icon: RetentionIcon },
      { href: "/board/moat", label: "Product moat", icon: MoatIcon },
      { href: "/board/unit-economics", label: "Unit economics", icon: UnitEconomicsIcon },
    ],
  },
  {
    id: "money",
    label: "Money",
    defaultOpen: false,
    items: [
      { href: "/money", label: "Money home", icon: WalletIcon, keywords: "hub cash" },
      { href: "/finance", label: "Finance", icon: WalletIcon, keywords: "ledger investor razorpay" },
      { href: "/recharges", label: "Recharges", icon: RechargesIcon, keywords: "wallet topup users" },
      { href: "/phone-purchases", label: "Phone purchases", icon: PhoneIcon, keywords: "did numbers" },
      { href: "/call-pricing", label: "Call pricing", icon: CallPricingIcon },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    defaultOpen: true,
    items: [
      { href: "/users", label: "Users", icon: UsersIcon, keywords: "accounts clerk impersonate wallet" },
      { href: "/partners", label: "Partners", icon: PartnerIcon },
      { href: "/all-agents", label: "All agents", icon: AgentIcon, keywords: "user agents" },
    ],
  },
  {
    id: "control",
    label: "Control",
    defaultOpen: false,
    items: [
      { href: "/control", label: "Control home", icon: SettingsIcon, keywords: "hub config" },
      { href: "/managed-keys", label: "Managed keys", icon: ManagedKeysIcon },
      { href: "/managed-numbers", label: "Managed numbers", icon: ManagedNumbersIcon },
      { href: "/voices", label: "Voices", icon: VoicesIcon },
      { href: "/prompt-template", label: "Prompt template", icon: PromptIcon },
      { href: "/system-prompt-templates", label: "System prompts", icon: TemplatesIcon },
      { href: "/ambient-sounds", label: "Ambient sounds", icon: AmbientIcon },
      { href: "/scheduling", label: "Scheduling", icon: SchedulingIcon, keywords: "bookings users" },
      { href: "/gcal-connections", label: "GCal connections", icon: GCalIcon, keywords: "calendar users" },
      { href: "/emails", label: "Emails", icon: EmailIcon, keywords: "send users transactional" },
      { href: "/reports/emails", label: "Email reports", icon: EmailIcon },
      { href: "/settings", label: "Settings", icon: SettingsIcon },
      { href: "/dpdp", label: "DPDP erasure", icon: DpdpIcon, keywords: "privacy users delete" },
      { href: "/audit-logs", label: "Audit logs", icon: AuditIcon, keywords: "users actions" },
    ],
  },
  {
    id: "labs",
    label: "Labs",
    defaultOpen: false,
    items: [
      { href: "/events", label: "Workshops", icon: WorkshopsIcon },
      { href: "/voiceathon", label: "Voice-a-thons", icon: TrophyIcon },
      { href: "/book-interns", label: "Book interns", icon: GraduationIcon },
      { href: "/family/companies", label: "Family companies", icon: BuildingIcon },
      { href: "/family/agents", label: "Family agents", icon: ShieldAgentIcon },
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
  { href: "/analytics", label: "Home", exact: true },
  { href: "/call-analytics", label: "Calls" },
  { href: "/growth", label: "Funnel" },
  { href: "/usage", label: "Usage" },
  { href: "/reports/signups", label: "Signups" },
  { href: "/board/pulse", label: "Board", match: "/board" },
];

export const MONEY_TABS = [
  { href: "/money", label: "Home", exact: true },
  { href: "/finance", label: "Finance" },
  { href: "/recharges", label: "Recharges" },
  { href: "/phone-purchases", label: "Numbers" },
  { href: "/call-pricing", label: "Pricing" },
];

export const OPS_TABS = [
  { href: "/", label: "Today", exact: true },
  { href: "/platform", label: "Live" },
  { href: "/health", label: "Health" },
  { href: "/deployments", label: "Deploys" },
];

export const EMAIL_TABS = [
  { href: "/emails", label: "Send & log" },
  { href: "/reports/emails", label: "Reports" },
];

export const PROMPT_TABS = [
  { href: "/prompt-template", label: "Active template" },
  { href: "/system-prompt-templates", label: "Library" },
];
