import { CallVolumeChart } from "@/components/call-volume-chart";
import { SectionSubNav } from "@/components/section-subnav";
import { ANALYTICS_TABS } from "@/lib/nav-config";

export default function CallAnalyticsPage() {
  return (
    <div className="space-y-6">
      <SectionSubNav tabs={ANALYTICS_TABS} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Call Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Platform-wide SnapServe call counts by week, month, or year — completed vs failed.
        </p>
      </div>
      <CallVolumeChart defaultPreset="month" />
    </div>
  );
}
