import React, { useState } from "react";
import { Link } from "wouter";
import { Search, Plus, Filter, MoreHorizontal, Settings2, PlayCircle, BarChart2, Phone, Users, Pencil, TrendingUp, PhoneCall } from "lucide-react";
import { 
  useListAgents, 
  useToggleAgent,
  useDeleteAgent,
  useInitiateOutboundCall,
  getListAgentsQueryKey,
  getListCallsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function AgentsList() {
  const [search, setSearch] = useState("");
  const [outboundAgent, setOutboundAgent] = useState<{ id: number; name: string } | null>(null);
  const [toNumber, setToNumber] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: agents, isLoading } = useListAgents({
    query: { queryKey: getListAgentsQueryKey() }
  });
  
  const toggleAgent = useToggleAgent();
  const deleteAgent = useDeleteAgent();
  const initiateOutbound = useInitiateOutboundCall();

  const handleOutboundSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!outboundAgent || !toNumber.trim()) return;
    initiateOutbound.mutate(
      { data: { agentId: outboundAgent.id, toNumber: toNumber.trim() } },
      {
        onSuccess: (call) => {
          toast({ title: "Outbound call initiated", description: `Calling ${toNumber} via ${outboundAgent.name}. Call ID: #${call.id}` });
          queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() });
          setOutboundAgent(null);
          setToNumber("");
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "Failed to initiate outbound call.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleToggle = (id: number, currentStatus: string) => {
    toggleAgent.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          toast({
            title: "Agent status updated",
            description: `Agent is now ${currentStatus === 'active' ? 'inactive' : 'active'}.`,
          });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to update agent status.",
            variant: "destructive",
          });
        }
      }
    );
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this agent?")) {
      deleteAgent.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
            toast({
              title: "Agent deleted",
              description: "The agent has been removed.",
            });
          },
          onError: () => {
            toast({
              title: "Error",
              description: "Failed to delete agent.",
              variant: "destructive",
            });
          }
        }
      );
    }
  };

  const filteredAgents = agents?.filter(agent => 
    agent.name.toLowerCase().includes(search.toLowerCase()) || 
    (agent.description && agent.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Agents</h2>
          <p className="text-muted-foreground">
            Manage your AI voice agents and their configurations.
          </p>
        </div>
        <Link href="/agents/new">
          <Button data-testid="button-create-agent">
            <Plus className="mr-2 h-4 w-4" /> Create Agent
          </Button>
        </Link>
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search agents..."
            className="pl-8 bg-white"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-agents"
          />
        </div>
        <Button variant="outline" size="icon" className="bg-white">
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Card key={i} className="overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <Skeleton className="h-6 w-[200px]" />
                      <Skeleton className="h-4 w-[300px]" />
                    </div>
                    <Skeleton className="h-10 w-[100px]" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredAgents && filteredAgents.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredAgents.map((agent) => (
              <Card key={agent.id} className="flex flex-col hover:border-primary/50 transition-colors" data-testid={`card-agent-${agent.id}`}>
                <CardContent className="p-6 flex-1 flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-lg leading-none">{agent.name}</h3>
                        {agent.status === 'active' ? (
                          <span className="flex h-2 w-2 rounded-full bg-green-500" title="Active" />
                        ) : agent.status === 'inactive' ? (
                          <span className="flex h-2 w-2 rounded-full bg-muted-foreground" title="Inactive" />
                        ) : (
                          <span className="flex h-2 w-2 rounded-full bg-yellow-500" title="Draft" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 min-h-[40px]">
                        {agent.description || "No description provided."}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <Link href={`/agents/${agent.id}`}>
                          <DropdownMenuItem className="cursor-pointer">
                            <Settings2 className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                        </Link>
                        <Link href={`/agents/${agent.id}/edit`}>
                          <DropdownMenuItem className="cursor-pointer">
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit Agent
                          </DropdownMenuItem>
                        </Link>
                        <Link href={`/app/analytics/agents/${agent.id}`}>
                          <DropdownMenuItem className="cursor-pointer">
                            <TrendingUp className="mr-2 h-4 w-4" />
                            View Analytics
                          </DropdownMenuItem>
                        </Link>
                        <DropdownMenuItem
                          className="cursor-pointer text-emerald-600 dark:text-gray-700 focus:text-emerald-600 dark:focus:text-gray-700"
                          onClick={() => { setOutboundAgent({ id: agent.id, name: agent.name }); setToNumber(""); }}
                        >
                          <PhoneCall className="mr-2 h-4 w-4" />
                          Make Outbound Call
                        </DropdownMenuItem>
                        <DropdownMenuItem className="cursor-pointer" onClick={() => handleToggle(agent.id, agent.status)}>
                          <PlayCircle className="mr-2 h-4 w-4" />
                          {agent.status === 'active' ? 'Deactivate Agent' : 'Activate Agent'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          className="text-destructive cursor-pointer focus:bg-destructive/10 focus:text-destructive"
                          onClick={() => handleDelete(agent.id)}
                        >
                          Delete Agent
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-muted rounded-md p-2 flex flex-col justify-center items-center text-center">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">ASR + LLM</span>
                      <span className="text-xs font-medium truncate w-full px-1">{agent.asrProvider} + {agent.llmProvider}</span>
                    </div>
                    <div className="bg-muted rounded-md p-2 flex flex-col justify-center items-center text-center">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">TTS + Tel</span>
                      <span className="text-xs font-medium truncate w-full px-1">{agent.ttsProvider} + {agent.telephonyProvider}</span>
                    </div>
                  </div>

                  <div className="mt-auto pt-4 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1" title="Total Calls">
                        <Phone className="h-3 w-3" />
                        <span>{agent.totalCalls || 0}</span>
                      </div>
                      <div className="flex items-center gap-1" title="Success Rate">
                        <BarChart2 className="h-3 w-3 text-primary" />
                        <span>
                          {agent.totalCalls ? Math.round(((agent.successfulCalls || 0) / agent.totalCalls) * 100) : 0}%
                        </span>
                      </div>
                    </div>
                    <span>Created {format(new Date(agent.createdAt), "MMM d")}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-white rounded-lg border border-dashed">
            <Users className="h-12 w-12 text-muted-foreground opacity-20 mb-4" />
            <h3 className="text-lg font-medium mb-2">No agents found</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              {search 
                ? `No agents match your search for "${search}".` 
                : "You haven't created any voice agents yet. Get started by creating your first one."}
            </p>
            {!search && (
              <Link href="/agents/new">
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> Create Your First Agent
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* ── Outbound Call Dialog ── */}
      <Dialog open={!!outboundAgent} onOpenChange={(open) => { if (!open) setOutboundAgent(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-gray-700" />
              Outbound Call
            </DialogTitle>
            <DialogDescription>
              Initiate a call via <span className="font-medium text-foreground">{outboundAgent?.name}</span>. Make sure the agent is active and your wallet has balance.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleOutboundSubmit} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="to-number">Destination Number</Label>
              <Input
                id="to-number"
                placeholder="+1234567890"
                value={toNumber}
                onChange={(e) => setToNumber(e.target.value)}
                pattern="^\+?[0-9\s\-\(\)]{7,20}$"
                required
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">E.164 format recommended (e.g. +14155552671)</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOutboundAgent(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={initiateOutbound.isPending || !toNumber.trim()}
                className="gap-2"
              >
                <PhoneCall className="h-3.5 w-3.5" />
                {initiateOutbound.isPending ? "Calling…" : "Call Now"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
