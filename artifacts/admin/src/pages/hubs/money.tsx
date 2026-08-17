import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { SectionSubNav } from "@/components/section-subnav";
import { MONEY_TABS } from "@/lib/nav-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const LINKS = [
  { href: "/finance", title: "Finance", body: "Audit ledger, unit economics, investor pack. Cash-in vs recognized." },
  { href: "/recharges", title: "Recharges", body: "User wallet top-ups. Keep this to debug a specific customer." },
  { href: "/phone-purchases", title: "Phone purchases", body: "DIDs bought for workspaces." },
  { href: "/call-pricing", title: "Call pricing", body: "Per-minute rates charged to users." },
  { href: "/usage/pricing", title: "Usage pricing", body: "STT / TTS / LLM provider rates and allocations." },
];

export default function MoneyHub() {
  return (
    <div className="space-y-5">
      <SectionSubNav tabs={MONEY_TABS} />
      <PageHeader
        title="Money"
        subtitle="Cash, wallets, and rates. User recharges and number buys stay one click away."
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
