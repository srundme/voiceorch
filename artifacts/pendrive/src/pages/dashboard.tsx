import { useGetPendriveStats, getGetPendriveStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Database, AlignLeft, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { data: stats, isLoading } = useGetPendriveStats({}, { query: { queryKey: getGetPendriveStatsQueryKey() } });

  const metrics = [
    {
      title: "Total Callers",
      value: stats?.totalCallers ?? 0,
      icon: Users,
      description: "Unique phone numbers seen",
    },
    {
      title: "Total Facts",
      value: stats?.totalFacts ?? 0,
      icon: Database,
      description: "L0 memory points extracted",
    },
    {
      title: "Total Episodes",
      value: stats?.totalEpisodes ?? 0,
      icon: AlignLeft,
      description: "L1 conversation summaries",
    },
    {
      title: "API Calls This Month",
      value: stats?.apiCallsThisMonth ?? 0,
      icon: Activity,
      description: "Total /v1/context requests",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-2">
          Monitor your agent's memory utilization and recent caller activity.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.title} className="bg-card/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {metric.title}
              </CardTitle>
              <metric.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-[100px] mt-1" />
              ) : (
                <div className="text-2xl font-bold font-mono text-primary">
                  {metric.value.toLocaleString()}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {metric.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-7">
        <Card className="lg:col-span-4 bg-card/50">
          <CardHeader>
            <CardTitle>Top Callers</CardTitle>
            <CardDescription>Callers with the most recorded memory facts.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Phone Number</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Facts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats?.topCallers?.length ? (
                    stats.topCallers.map((caller) => (
                      <TableRow key={caller.phoneNumber}>
                        <TableCell className="font-mono text-xs">{caller.phoneNumber}</TableCell>
                        <TableCell>{caller.name || "Unknown"}</TableCell>
                        <TableCell className="text-right">{caller.callCount}</TableCell>
                        <TableCell className="text-right font-medium text-primary">
                          {caller.factCount}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                        No callers recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3 bg-card/50">
          <CardHeader>
            <CardTitle>Quick Start</CardTitle>
            <CardDescription>Fetch memory context for a caller before routing to the LLM.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-muted p-4">
              <pre className="text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                <span className="text-primary">curl</span> -X GET \{"\n"}
                {"  "}https://api.pendrive.dev/v1/context?phone=+1234567890 \{"\n"}
                {"  "}-H <span className="text-green-400">"Authorization: Bearer pd_test_123"</span>
              </pre>
            </div>
            
            <div className="rounded-md bg-muted p-4">
              <pre className="text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                <span className="text-primary">const</span> response = <span className="text-blue-400">await</span> fetch(<span className="text-green-400">"https://api..."</span>);{"\n"}
                <span className="text-primary">const</span> context = <span className="text-blue-400">await</span> response.json();{"\n"}
                {"\n"}
                <span className="text-gray-500">// Inject this into your LLM system prompt</span>{"\n"}
                <span className="text-primary">const</span> systemPrompt = <span className="text-green-400">{"`Caller Memory:\\n${context.memoryBlock}`"}</span>;
              </pre>
            </div>
            
            <Button variant="outline" className="w-full" onClick={() => window.location.href = '/docs'}>
              View Full Documentation
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
