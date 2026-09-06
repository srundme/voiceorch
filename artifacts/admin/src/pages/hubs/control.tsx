import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const LINKS = [
  { href: "/users", title: "Users", body: "Accounts, wallets, impersonation, test flags." },
  { href: "/partners", title: "Partners", body: "Partner orgs and access." },
  { href: "/all-agents", title: "All agents", body: "Every user agent on the platform." },
  { href: "/operations/emails", title: "Emails", body: "Send and inspect transactional mail to users." },
  { href: "/reports/emails", title: "Email reports", body: "Welcome, onboarding, invoice aggregates." },
  { href: "/operations/alerts", title: "Alerts", body: "Rules, channels, and live incidents." },
  { href: "/operations/health", title: "Platform health", body: "API, DB, Redis, providers, keys." },
  { href: "/operations/deployments", title: "Deployments", body: "Railway release history." },
  { href: "/operations/audit", title: "Audit logs", body: "Who changed what on a user." },
  { href: "/scheduling", title: "Scheduling", body: "Booking rules tied to user calendars." },
  { href: "/gcal-connections", title: "GCal connections", body: "Which users connected Google Calendar." },
  { href: "/managed-numbers", title: "Managed numbers", body: "Platform DIDs assigned to workspaces." },
  { href: "/managed-keys", title: "Managed keys", body: "Provider keys we hold for tenants." },
  { href: "/product/voices", title: "Voices", body: "TTS catalogue." },
  { href: "/product/prompt-templates", title: "Prompt template", body: "The live system prompt." },
  { href: "/product/system-prompts", title: "System prompts", body: "Prompt library." },
  { href: "/product/ambient-sounds", title: "Ambient sounds", body: "Hold / office beds." },
  { href: "/product/integrations", title: "Integrations", body: "Calendar, CRM, Sheets, WhatsApp." },
  { href: "/settings", title: "Settings", body: "Spike threshold and platform flags." },
  { href: "/dpdp", title: "DPDP erasure", body: "User deletion and privacy requests." },
];

export default function ControlHub() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Control"
        subtitle="Config and user tools. Nothing here was removed — this is the map. Use ⌘K to jump."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {LINKS.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="h-full border-border shadow-none cursor-pointer transition-colors duration-200 hover:border-muted-foreground/40">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-sm font-medium">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className="text-xs text-muted-foreground">{item.body}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
