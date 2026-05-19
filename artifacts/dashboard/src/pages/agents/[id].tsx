import React, { useState } from "react";
import { Link, useParams } from "wouter";
import { format, parseISO } from "date-fns";
import { 
  ArrowLeft, 
  Settings2, 
  Activity, 
  Phone,
  BarChart2,
  Clock
} from "lucide-react";
import { 
  useGetAgent, 
  getGetAgentQueryKey,
  useListCalls,
  getListCallsQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function AgentDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  
  const [activeTab, setActiveTab] = useState("overview");

  const { data: agent, isLoading: agentLoading } = useGetAgent(id, {
    query: { 
      enabled: !!id,
      queryKey: getGetAgentQueryKey(id) 
    }
  });

  const { data: calls, isLoading: callsLoading } = useListCalls({ agentId: id }, {
    query: {
      enabled: !!id && activeTab === "calls",
      queryKey: getListCallsQueryKey({ agentId: id })
    }
  });

  const formatDuration = (seconds?: number | null) => {
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
      case "cancelled": return <Badge variant="outline" className="bg-muted text-muted-foreground border-transparent">Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (agentLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-[200px]" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Agent not found.
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 h-full flex flex-col">
      <div className="flex items-center gap-4">
        <Link href="/agents">
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <h2 className="text-3xl font-bold tracking-tight">{agent.name}</h2>
          {agent.status === 'active' ? (
            <Badge className="bg-green-500 hover:bg-green-600">Active</Badge>
          ) : agent.status === 'inactive' ? (
            <Badge variant="secondary">Inactive</Badge>
          ) : (
            <Badge variant="outline" className="text-yellow-500 border-yellow-500">Draft</Badge>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
          <TabsTrigger value="overview" className="relative h-10 rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none">
            Overview
          </TabsTrigger>
          <TabsTrigger value="configuration" className="relative h-10 rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none">
            Configuration
          </TabsTrigger>
          <TabsTrigger value="calls" className="relative h-10 rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none">
            Call History
          </TabsTrigger>
        </TabsList>
        
        <div className="mt-6 flex-1 overflow-auto">
          <TabsContent value="overview" className="m-0 h-full">
             <div className="grid gap-4 md:grid-cols-3 mb-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
                    <Phone className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{agent.totalCalls || 0}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                    <BarChart2 className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {agent.totalCalls ? Math.round(((agent.successfulCalls || 0) / agent.totalCalls) * 100) : 0}%
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatDuration(agent.avgDurationSeconds)}</div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Pipeline Map</CardTitle>
                  <CardDescription>Current orchestration configuration for this agent</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col md:flex-row items-center justify-between gap-4 py-8">
                     <div className="flex flex-col items-center gap-2 p-4 border rounded-lg bg-card w-full text-center">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Telephony In</span>
                        <span className="font-medium text-primary">{agent.telephonyProvider}</span>
                     </div>
                     <ArrowLeft className="rotate-90 md:rotate-0 text-muted-foreground" />
                     <div className="flex flex-col items-center gap-2 p-4 border rounded-lg bg-card w-full text-center">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">ASR</span>
                        <span className="font-medium">{agent.asrProvider}</span>
                        <span className="text-xs text-muted-foreground">{agent.asrModel || "default"}</span>
                     </div>
                     <ArrowLeft className="rotate-90 md:rotate-180 text-muted-foreground" />
                     <div className="flex flex-col items-center gap-2 p-4 border rounded-lg bg-primary/10 border-primary/30 w-full text-center">
                        <span className="text-xs text-primary uppercase tracking-wider font-semibold">LLM Core</span>
                        <span className="font-medium">{agent.llmProvider}</span>
                        <span className="text-xs text-muted-foreground">{agent.llmModel || "default"}</span>
                     </div>
                     <ArrowLeft className="rotate-90 md:rotate-0 text-muted-foreground" />
                     <div className="flex flex-col items-center gap-2 p-4 border rounded-lg bg-card w-full text-center">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">TTS</span>
                        <span className="font-medium">{agent.ttsProvider}</span>
                        <span className="text-xs text-muted-foreground">{agent.ttsVoice || "default"}</span>
                     </div>
                  </div>
                </CardContent>
              </Card>
          </TabsContent>

          <TabsContent value="configuration" className="m-0">
             <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings2 className="h-5 w-5 text-primary" />
                  System Prompt
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/50 p-4 rounded-md border border-border/50 font-mono text-sm whitespace-pre-wrap">
                  {agent.systemPrompt}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="calls" className="m-0 h-full flex flex-col">
            <Card className="flex-1 flex flex-col overflow-hidden">
              <CardContent className="p-0 flex-1 overflow-auto">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-10">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>To / From</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {callsLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                          <TableCell className="text-right"><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    ) : calls && calls.length > 0 ? (
                      calls.map((call) => (
                        <TableRow key={call.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                          <TableCell className="whitespace-nowrap">
                            {format(parseISO(call.createdAt), "MMM d, HH:mm")}
                          </TableCell>
                          <TableCell>
                            {getStatusBadge(call.status)}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm font-medium">{call.toNumber}</div>
                            <div className="text-xs text-muted-foreground">{call.fromNumber}</div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {formatDuration(call.durationSeconds)}
                          </TableCell>
                          <TableCell className="text-right">
                             <Link href={`/calls/${call.id}`}>
                              <Button variant="ghost" size="sm" className="h-8 text-xs">Details</Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                          No calls found for this agent.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
