import React, { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useScrollRestoration } from "@/lib/use-scroll-restoration";
import { Search, Plus, Filter, MoreHorizontal, Settings2, PlayCircle, BarChart2, Phone, Users, Pencil, TrendingUp, PhoneCall, DollarSign } from "lucide-react";
import { 
  useListAgents, 
  useToggleAgent,
  useDeleteAgent,
  useInitiateOutboundCall,
  getListAgentsQueryKey,
  getListCallsQueryKey,
} from "@workspace/api-client-react";
import { useMinuteRatesMap, useUserProviderNames, computeAgentRateCents } from "@/hooks/use-minute-rates";
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
import { formatApiError, isKycError, isDestinationUnverifiedError } from "@/lib/format-api-error";
import { getIrdaiBlock, getIrdaiBlockedError } from "@/lib/irdai-block";
import { DestinationOtpDialog } from "@/components/destination-otp-dialog";
import { RecentNumbersList } from "@/components/recent-numbers-list";
import { useRecentNumbers } from "@/hooks/use-recent-numbers";

export default function AgentsList() {
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [search, setSearch] = useState(() => initialParams.get("q") ?? "");
  const [outboundAgent, setOutboundAgent] = useState<{ id: number; name: string } | null>(null);
  const [toNumber, setToNumber] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [otpDialogOpen, setOtpDialogOpen]       = useState(false);
  const [pendingCallNumber, setPendingCallNumber] = useState("");
  const { recentNumbers, recordNumber, removeNumber } = useRecentNumbers();

  // Mirror the search into the URL so returning to this list restores it.
  useEffect(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search);
    const qs = params.toString();
    const next = qs ? `/app/agents?${qs}` : "/app/agents";
    const current = `/app/agents${window.location.search}`;
    if (next !== current) navigate(next, { replace: true });
  }, [search, navigate]);

  const { data: agents, isLoading } = useListAgents({
    query: { queryKey: getListAgentsQueryKey() }
  });

  // Restore the list scroll position when returning.
  const listScrollRef = useScrollRestoration<HTMLDivElement>("agents-list", !isLoading);
  const rateMap = useMinuteRatesMap();
  const userProviderNames = useUserProviderNames();
  
  const toggleAgent = useToggleAgent();
  const deleteAgent = useDeleteAgent();
  const initiateOutbound = useInitiateOutboundCall();

  const outboundIrdaiBlock = getIrdaiBlock(
    outboundAgent ? (agents ?? []).find((a) => a.id === outboundAgent.id) : null,
  );

  const handleOutboundSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!outboundAgent || !toNumber.trim()) return;
    recordNumber(toNumber);
    initiateOutbound.mutate(
      { data: { agentId: outboundAgent.id, toNumber: toNumber.trim() } },
      {
        onSuccess: (call) => {
          toast({ title: "Outbound call initiated", description: `Calling ${toNumber} via ${outboundAgent.name}. Call ID: #${call.id}` });
          queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() });
          setOutboundAgent(null);
          setToNumber("");
        },
        onError: (err: unknown) => {
          const irdai = getIrdaiBlockedError(err);
          if (irdai) {
            toast({ title: "Call blocked", description: irdai.message, variant: "destructive" });
          } else if (isKycError(err)) {
            toast({ title: "Verification required", description: "Complete identity verification before making telephony calls.", variant: "destructive" });
            navigate("/app/kyc");
          } else if (isDestinationUnverifiedError(err)) {
            setPendingCallNumber(toNumber.trim());
            setOtpDialogOpen(true);
          } else {
            toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
          }
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
        onError: (err: unknown) => {
          toast({
            title: "Error",
            description: formatApiError(err),
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
          onError: (err: unknown) => {
            toast({
              title: "Error",
              description: formatApiError(err),
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
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 h-full flex flex-col max-w-7xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Agents</h2>
          <p className="text-muted-foreground">
            Manage your AI voice agents and their configurations.
          </p>
        </div>
        <Button data-testid="button-create-agent" onClick={() => navigate("/app/vibe")}>
          <Plus className="mr-2 h-4 w-4" /> Create Agent
        </Button>
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search agents..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-agents"
          />
        </div>
        <Button variant="outline" size="icon">
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      <div ref={listScrollRef} className="flex-1 overflow-auto">
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
                          <span className="flex h-2 w-2 rounded-full bg-zinc-500" title="Active" />
                        ) : agent.status === 'inactive' ? (
                          <span className="flex h-2 w-2 rounded-full bg-muted-foreground" title="Inactive" />
                        ) : (
                          <span className="flex h-2 w-2 rounded-full bg-zinc-500" title="Draft" />
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
                        <Link href={`/app/agents/${agent.id}`}>
                          <DropdownMenuItem className="cursor-pointer">
                            <Settings2 className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                        </Link>
                        <Link href={`/app/agents/${agent.id}`}>
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
                          className="cursor-pointer text-foreground dark:text-foreground focus:text-foreground dark:focus:text-foreground"
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

                  {/* Per-minute cost badge */}
                  {(() => {
                    const costCents = computeAgentRateCents(rateMap, agent as any, userProviderNames);
                    if (costCents <= 0) return null;
                    return (
                      <div className="flex items-center gap-1.5 mb-3 px-2 py-1.5 rounded-md border border-border bg-muted/30 w-fit text-xs">
                        <DollarSign className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="font-semibold text-foreground">
                          {(costCents / 100).toFixed(3)}
                        </span>
                        <span className="text-muted-foreground">/ min</span>
                      </div>
                    );
                  })()}

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
          <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-card rounded-lg border border-dashed border-border">
            <Users className="h-12 w-12 text-muted-foreground opacity-20 mb-4" />
            <h3 className="text-lg font-medium mb-2">No agents found</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              {search 
                ? `No agents match your search for "${search}".` 
                : "You haven't created any voice agents yet. Get started by creating your first one."}
            </p>
            {!search && (
              <Button onClick={() => navigate("/app/vibe")}>
                <Plus className="mr-2 h-4 w-4" /> Create Your First Agent
              </Button>
            )}
          </div>
        )}
      </div>

      <DestinationOtpDialog
        open={otpDialogOpen}
        phoneNumber={pendingCallNumber}
        onClose={() => setOtpDialogOpen(false)}
        onVerified={() => {
          setOtpDialogOpen(false);
          if (!outboundAgent) return;
          recordNumber(pendingCallNumber);
          initiateOutbound.mutate(
            { data: { agentId: outboundAgent.id, toNumber: pendingCallNumber } },
            {
              onSuccess: (call) => {
                toast({ title: "Call initiated", description: `Calling ${pendingCallNumber} via ${outboundAgent.name}. Call ID: #${call.id}` });
                queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() });
                setOutboundAgent(null);
                setToNumber("");
              },
              onError: (err) => {
                const irdai = getIrdaiBlockedError(err);
                toast({ title: irdai ? "Call blocked" : "Error", description: irdai ? irdai.message : formatApiError(err), variant: "destructive" });
              },
            },
          );
        }}
      />

      {/* ── Outbound Call Dialog ── */}
      <Dialog open={!!outboundAgent} onOpenChange={(open) => { if (!open) setOutboundAgent(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-foreground" />
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
            <RecentNumbersList numbers={recentNumbers} onSelect={setToNumber} onRemove={removeNumber} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOutboundAgent(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={initiateOutbound.isPending || !toNumber.trim() || outboundIrdaiBlock.blocked}
                title={outboundIrdaiBlock.blocked ? "Blocked by IRDAI compliance" : undefined}
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
