import { useOverview } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, PhoneCall, Activity, DollarSign, Clock, AlertCircle } from "lucide-react";
import { formatCentsToDollars } from "@/lib/api";

export default function Overview() {
  const { data: overview, isLoading, isError, error } = useOverview();

  if (isLoading) {
    return <div className="p-8 text-muted-foreground animate-pulse">Loading platform metrics...</div>;
  }

  if (isError) {
    return <div className="p-8 text-destructive">Error loading overview: {(error as Error).message}</div>;
  }

  const metrics = [
    {
      title: "Total Users",
      value: overview?.totalUsers?.toLocaleString() || "0",
      icon: Users,
      description: "Registered accounts",
    },
    {
      title: "Total Revenue",
      value: formatCentsToDollars(overview?.totalRevenueCents || 0),
      icon: DollarSign,
      description: "Lifetime",
    },
    {
      title: "Total Calls",
      value: overview?.totalCalls?.toLocaleString() || "0",
      icon: PhoneCall,
      description: "All time",
    },
    {
      title: "Active Calls",
      value: overview?.activeCalls?.toLocaleString() || "0",
      icon: Activity,
      description: "Right now",
    },
    {
      title: "Calls (24h)",
      value: overview?.recentCalls?.toLocaleString() || "0",
      icon: Clock,
      description: "Last 24 hours",
    },
    {
      title: "Pending Callbacks",
      value: overview?.pendingCallbacks?.toLocaleString() || "0",
      icon: AlertCircle,
      description: "Awaiting execution",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Platform Overview</h1>
        <div className="text-xs text-muted-foreground">Auto-refreshing every 30s</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {metrics.map((metric, i) => (
          <Card key={i} className="border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                {metric.title}
              </CardTitle>
              <metric.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{metric.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{metric.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
