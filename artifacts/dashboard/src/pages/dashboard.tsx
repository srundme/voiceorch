import React, { useMemo } from "react";
import { Link } from "wouter";
import { 
  Users, 
  Phone, 
  CheckCircle2, 
  Clock, 
  ArrowRight,
  Activity,
  AlertCircle
} from "lucide-react";
import { 
  useGetDashboardStats, 
  useGetRecentCalls, 
  useGetCallsByStatus, 
  useGetDailyCallVolume,
  getGetDashboardStatsQueryKey,
  getGetRecentCallsQueryKey,
  getGetCallsByStatusQueryKey,
  getGetDailyCallVolumeQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { format, parseISO } from "date-fns";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey() }
  });
  
  const { data: recentCalls, isLoading: recentCallsLoading } = useGetRecentCalls({
    query: { queryKey: getGetRecentCallsQueryKey() }
  });
  
  const { data: callsByStatus, isLoading: callsByStatusLoading } = useGetCallsByStatus({
    query: { queryKey: getGetCallsByStatusQueryKey() }
  });
  
  const { data: dailyVolume, isLoading: dailyVolumeLoading } = useGetDailyCallVolume({
    query: { queryKey: getGetDailyCallVolumeQueryKey() }
  });

  const chartData = useMemo(() => {
    if (!dailyVolume) return [];
    return dailyVolume.map(d => ({
      ...d,
      formattedDate: format(parseISO(d.date), "MMM d")
    })).reverse();
  }, [dailyVolume]);

  const pieData = useMemo(() => {
    if (!callsByStatus) return [];
    return callsByStatus.filter(s => s.count > 0).map(s => ({
      name: s.status.replace("_", " ").toUpperCase(),
      value: s.count,
      status: s.status
    }));
  }, [callsByStatus]);

  const STATUS_COLORS: Record<string, string> = {
    completed: "hsl(var(--primary))",
    failed: "hsl(var(--destructive))",
    in_progress: "hsl(var(--chart-4))",
    pending: "hsl(var(--muted-foreground))",
    cancelled: "hsl(var(--chart-2))"
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return "0s";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case "completed": return <Badge variant="default" className="bg-primary/20 text-primary hover:bg-primary/30 border-transparent">Completed</Badge>;
      case "failed": return <Badge variant="destructive" className="bg-destructive/20 text-destructive hover:bg-destructive/30 border-transparent">Failed</Badge>;
      case "in_progress": return <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/30 border-transparent">In Progress</Badge>;
      case "pending": return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Overview of your AI voice agents and call volume.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Link href="/agents/new">
            <Button data-testid="button-create-agent">Create Agent</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Agents</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold" data-testid="text-total-agents">{stats?.totalAgents || 0}</div>
                <p className="text-xs text-muted-foreground">
                  <span className="text-primary font-medium">{stats?.activeAgents || 0}</span> active
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Calls Today</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold" data-testid="text-calls-today">{stats?.callsToday || 0}</div>
                <p className="text-xs text-muted-foreground">
                  {stats?.callsThisWeek || 0} this week
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold" data-testid="text-success-rate">
                  {stats?.successRate ? `${stats.successRate.toFixed(1)}%` : "0%"}
                </div>
                <p className="text-xs text-muted-foreground">
                  completed / total
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold" data-testid="text-avg-duration">
                  {formatDuration(stats?.avgDurationSeconds || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  across all successful calls
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Call Volume</CardTitle>
            <CardDescription>
              Daily completed vs failed calls over the last 14 days
            </CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            {dailyVolumeLoading ? (
              <div className="h-[300px] flex items-center justify-center">
                <Skeleton className="h-[250px] w-full" />
              </div>
            ) : chartData.length > 0 ? (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="formattedDate" 
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${value}`}
                    />
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="completed" 
                      stroke="hsl(var(--primary))" 
                      fillOpacity={1} 
                      fill="url(#colorCompleted)" 
                      strokeWidth={2}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="failed" 
                      stroke="hsl(var(--destructive))" 
                      fillOpacity={1} 
                      fill="url(#colorFailed)" 
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground flex-col gap-2">
                <Activity className="h-8 w-8 opacity-20" />
                <span>No call data available</span>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Status Breakdown</CardTitle>
            <CardDescription>
              Distribution of calls by status
            </CardDescription>
          </CardHeader>
          <CardContent>
            {callsByStatusLoading ? (
              <div className="h-[300px] flex items-center justify-center">
                <Skeleton className="h-[200px] w-[200px] rounded-full" />
              </div>
            ) : pieData.length > 0 ? (
              <div className="h-[300px] w-full flex flex-col items-center">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                      stroke="none"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.status as string] || "hsl(var(--muted))"} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-4 mt-2">
                  {pieData.map((entry, index) => (
                    <div key={index} className="flex items-center text-xs">
                      <div 
                        className="w-3 h-3 rounded-full mr-2" 
                        style={{ backgroundColor: STATUS_COLORS[entry.status as string] || "hsl(var(--muted))" }}
                      />
                      <span>{entry.name}: {entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
               <div className="h-[300px] flex items-center justify-center text-muted-foreground flex-col gap-2">
                <AlertCircle className="h-8 w-8 opacity-20" />
                <span>No status data available</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>
              The most recent calls handled by your agents
            </CardDescription>
          </div>
          <Link href="/calls">
            <Button variant="outline" size="sm" className="gap-1">
              View All <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {recentCallsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center space-x-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-[200px]" />
                    <Skeleton className="h-4 w-[150px]" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentCalls && recentCalls.length > 0 ? (
            <div className="space-y-6">
              {recentCalls.map((call) => (
                <div key={call.id} className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="bg-primary/10 p-2 rounded-full">
                      <Phone className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">
                        {call.toNumber} <span className="text-muted-foreground font-normal">via</span> {call.agentName}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(parseISO(call.createdAt), "MMM d, yyyy h:mm a")}
                        {call.durationSeconds ? ` • ${formatDuration(call.durationSeconds)}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {getStatusBadge(call.status)}
                    <Link href={`/calls/${call.id}`}>
                      <Button variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground">
                        Details
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 text-muted-foreground flex flex-col items-center">
              <Phone className="h-10 w-10 opacity-20 mb-4" />
              <p>No recent calls found.</p>
              <p className="text-sm">Initiate a call or wait for inbound calls.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
