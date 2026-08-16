import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { SectionSubNav } from "@/components/section-subnav";
import { ANALYTICS_TABS } from "@/lib/nav-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const LINKS = [
  { href: "/call-analytics", title: "Calls", body: "Completed vs failed volume by week, month, or year." },
  { href: "/growth", title: "Funnel", body: "Signup → agent → telephony → first call → power user." },
  { href: "/usage", title: "Usage", body: "STT / TTS / LLM spend, allocations, and cost alerts." },
  { href: "/reports/signups", title: "Signups", body: "New accounts in range. Does not replace the Users list." },
  { href: "/board/pulse", title: "Company pulse", body: "Investor headline metrics for Friday reviews." },
  { href: "/board/growth", title: "Board growth", body: "Minutes, new tenants, flagship goal." },
  { href: "/board/retention", title: "Retention", body: "Cohort health and returning tenants." },
  { href: "/board/moat", title: "Product moat", body: "What is sticky vs rented infrastructure." },
  { href: "/board/unit-economics", title: "Unit economics", body: "Board cut of contribution margin." },
];

export default function AnalyticsHub() {
  return (
    <div className="space-y-5">
      <SectionSubNav tabs={ANALYTICS_TABS} />
      <PageHeader
        title="Analytics"
        subtitle="Week and month views. Live fire lives on Today. Every report below is still its own page."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {LINKS.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="h-full border-border shadow-none cursor-pointer transition-colors duration-200 hover:border-muted-foreground/40 focus-within:ring-2 focus-within:ring-ring">
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
