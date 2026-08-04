/**
 * Inbound / outbound phone assignment for an agent.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetAgentQueryKey,
  getListAgentsQueryKey,
  getListPhoneNumbersQueryKey,
  getListProvidersQueryKey,
  useAssignPhoneNumber,
  useListAgents,
  useListPhoneNumbers,
  useListProviders,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import { Loader2, Phone, PhoneForwarded, Plus } from "lucide-react";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API = `${_DASH_BASE}/api`;

export function AgentInboundPanel({
  agentId,
  preferredManagedNumber,
  telephonyProvider,
  className,
}: {
  agentId: number;
  preferredManagedNumber?: string | null;
  telephonyProvider?: string | null;
  className?: string;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: phoneNumbersRaw, isLoading } = useListPhoneNumbers({
    query: { queryKey: getListPhoneNumbersQueryKey(), staleTime: 60_000 },
  });
  const { data: agents } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });
  const { data: managedData } = useQuery({
    queryKey: ["phone-numbers", "managed"],
    queryFn: () => customFetch<{ numbers: string[] }>(`${DASH_API}/phone-numbers/managed`),
    staleTime: 5 * 60 * 1000,
  });
  const { data: quota, refetch: refetchQuota } = useQuery({
    queryKey: ["phone-numbers", "managed-quota"],
    queryFn: () => customFetch<{
      limit: number;
      used: number;
      remaining: number;
      hasOwnNumber: boolean;
      limited: boolean;
      unlimitedTrial?: boolean;
      resetsAt: string;
    }>(`${DASH_API}/phone-numbers/managed-quota`),
    staleTime: 15_000,
  });
  const assign = useAssignPhoneNumber();
  // BYO telephony (Plivo/Twilio): when the agent dials on the user's own
  // carrier account, its saved fromNumber IS the agent's number — show it
  // instead of buy/trial nags.
  const { data: providerKeys } = useListProviders({ query: { queryKey: getListProvidersQueryKey(), staleTime: 60_000 } });
  const byo = (telephonyProvider === "plivo" || telephonyProvider === "twilio")
    ? (providerKeys ?? []).find((p) => p.providerType === "telephony" && p.providerName === telephonyProvider && p.isActive)
    : undefined;
  let byoNumber: string | null = null;
  if (byo) {
    try { byoNumber = (JSON.parse(byo.extraConfig ?? "{}") as Record<string, string>)["fromNumber"] ?? null; } catch { /* ignore */ }
  }
  const phoneNumbers = Array.isArray(phoneNumbersRaw) ? phoneNumbersRaw : [];
  const assigned = phoneNumbers.find(p => p.agentId === agentId);
  const ownedCount = phoneNumbers.length;
  const managedNumbers = managedData?.numbers ?? [];
  const testingFromNumber =
    preferredManagedNumber
    ?? (assigned?.number ?? null)
    ?? managedNumbers[0]
    ?? null;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("none");

  const openDialog = () => {
    setSelectedId(assigned ? String(assigned.id) : "none");
    setDialogOpen(true);
  };

  const configureWebhook = async (numberId: number) => {
    try {
      const token = localStorage.getItem("voiceorch:session");
      await fetch(`/api/phone-numbers/${numberId}/configure-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch {
      // Non-fatal — number is assigned; webhook can be repaired from Phone Numbers.
    }
  };

  const handleSave = async () => {
    const nextId = selectedId === "none" ? null : parseInt(selectedId, 10);
    try {
      // Agent-centric: clear previous number on this agent if switching/unassigning
      if (assigned && assigned.id !== nextId) {
        await assign.mutateAsync({ id: assigned.id, data: { agentId: null } });
      }
      if (nextId != null) {
        await assign.mutateAsync({ id: nextId, data: { agentId } });
        await configureWebhook(nextId);
      }
      queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
      void refetchQuota();
      toast({
        title: nextId ? "Your number is live on this agent" : "Number cleared",
        description: nextId
          ? "Inbound rings this agent. Outbound caller ID uses your number — unlimited calls."
          : "Assign a purchased number to go live.",
      });
      setDialogOpen(false);
    } catch (err) {
      toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
    }
  };

  const trialRemaining = quota?.limited ? quota.remaining : null;
  const trialLimit = quota?.limit ?? 3;
  const trialExhausted = quota?.limited && quota.remaining <= 0;

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border", className)}>
      {/* Own number row */}
      <div className="flex min-h-14 items-center gap-3 border-b border-border/70 px-3.5 py-3">
        <PhoneForwarded className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {isLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : byoNumber ? (
            <>
              <p className="truncate text-[13px] font-medium tabular-nums">{byoNumber}</p>
              <p className="text-[11px] text-muted-foreground">
                Your {telephonyProvider === "plivo" ? "Plivo" : "Twilio"} number · unlimited
              </p>
            </>
          ) : assigned ? (
            <button type="button" onClick={openDialog} className="w-full text-left">
              <p className="truncate text-[13px] font-medium tabular-nums">{assigned.number}</p>
              <p className="text-[11px] text-muted-foreground">Assigned · inbound + outbound</p>
            </button>
          ) : ownedCount === 0 ? (
            <>
              <p className="text-[13px] font-medium">No number assigned</p>
              <p className="text-[11px] text-muted-foreground">Buy a number to go live on this agent</p>
            </>
          ) : (
            <button type="button" onClick={openDialog} className="w-full text-left">
              <p className="text-[13px] font-medium">Assign a purchased number</p>
              <p className="text-[11px] text-muted-foreground">You have a number — attach it here</p>
            </button>
          )}
        </div>
        {isLoading ? null : byoNumber ? null : assigned ? (
          <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={openDialog}>
            Change
          </Button>
        ) : ownedCount === 0 ? (
          <Button type="button" size="sm" className="h-8 shrink-0 gap-1 text-xs" onClick={() => navigate("/app/phone-numbers")}>
            <Plus className="size-3.5" /> Buy
          </Button>
        ) : (
          <Button type="button" size="sm" className="h-8 shrink-0 text-xs" onClick={openDialog}>
            Assign
          </Button>
        )}
      </div>

      {/* Trial row — only when no own number */}
      {!assigned && !byoNumber && (
        <div className="flex min-h-12 items-center gap-3 px-3.5 py-2.5">
          <Phone className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium tabular-nums text-muted-foreground">
              {testingFromNumber ?? "No trial line"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {quota?.unlimitedTrial
                ? "Shared trial · inbound won't ring this agent"
                : trialExhausted
                  ? "Trial used up today"
                  : quota?.limited
                    ? `Shared trial · ${trialRemaining}/${trialLimit} left today`
                    : "Shared trial line"}
            </p>
          </div>
          {trialExhausted && (
            <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={() => navigate("/app/phone-numbers")}>
              Buy number
            </Button>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Attach your phone number</DialogTitle>
            <DialogDescription>
              Your purchased number handles inbound routing and outbound caller ID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {phoneNumbers.length === 0 ? (
              <div className="space-y-2 rounded-lg border border-border px-3 py-4 text-center">
                <p className="text-sm text-muted-foreground">You don’t have a purchased number yet.</p>
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { setDialogOpen(false); navigate("/app/phone-numbers"); }}>
                  <Plus className="h-3.5 w-3.5" /> Buy a number
                </Button>
              </div>
            ) : (
              <>
                <Label className="text-sm">Phone number</Label>
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a number…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Unassigned —</SelectItem>
                    {phoneNumbers.map(n => {
                      const owner = n.agentId && n.agentId !== agentId
                        ? agents?.find(a => a.id === n.agentId)?.name
                        : null;
                      return (
                        <SelectItem key={n.id} value={String(n.id)}>
                          {n.number}{owner ? ` · ${owner}` : n.agentId === agentId ? " · current" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Reassigning a number in use by another agent moves inbound and outbound to this agent.
                </p>
              </>
            )}
          </div>
          {phoneNumbers.length > 0 && (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="button" onClick={handleSave} disabled={assign.isPending}>
                {assign.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
