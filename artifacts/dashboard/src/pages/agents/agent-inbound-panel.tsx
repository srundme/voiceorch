/**
 * Inbound / outbound phone assignment for an agent.
 * Card style matches the old Studio builder phone card people liked.
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
import { ChevronRight, Loader2, Phone, PhoneForwarded, Plus } from "lucide-react";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API = `${_DASH_BASE}/api`;

export function AgentInboundPanel({
  agentId,
  preferredManagedNumber,
  telephonyProvider,
  className,
  compact = false,
}: {
  agentId: number;
  preferredManagedNumber?: string | null;
  telephonyProvider?: string | null;
  className?: string;
  /** Single-row chip for tight toolbars; default is the full phone card. */
  compact?: boolean;
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
  const { data: providerKeys } = useListProviders({
    query: { queryKey: getListProvidersQueryKey(), staleTime: 60_000 },
  });
  const byo = (telephonyProvider === "plivo" || telephonyProvider === "twilio")
    ? (providerKeys ?? []).find((p) => p.providerType === "telephony" && p.providerName === telephonyProvider && p.isActive)
    : undefined;
  let byoNumber: string | null = null;
  if (byo) {
    try { byoNumber = (JSON.parse(byo.extraConfig ?? "{}") as Record<string, string>)["fromNumber"] ?? null; } catch { /* ignore */ }
  }
  const phoneNumbers = Array.isArray(phoneNumbersRaw) ? phoneNumbersRaw : [];
  const assigned = phoneNumbers.find((p) => p.agentId === agentId);
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
      // Non-fatal
    }
  };

  const handleSave = async () => {
    const nextId = selectedId === "none" ? null : parseInt(selectedId, 10);
    try {
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
  const live = Boolean(assigned || byoNumber);

  const assignDialog = (
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
                  {phoneNumbers.map((n) => {
                    const owner = n.agentId && n.agentId !== agentId
                      ? agents?.find((a) => a.id === n.agentId)?.name
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
  );

  if (compact) {
    const label = isLoading
      ? "…"
      : byoNumber
        ? byoNumber
        : assigned
          ? assigned.number
          : ownedCount > 0
            ? "Assign number"
            : "Add number";

    return (
      <div className={cn("flex min-w-0 items-center", className)}>
        <button
          type="button"
          onClick={() => {
            if (byoNumber) { navigate("/app/phone-numbers"); return; }
            if (assigned || ownedCount > 0) openDialog();
            else navigate("/app/phone-numbers");
          }}
          className={cn(
            "inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors",
            live
              ? "border-border/70 bg-muted/25 text-foreground hover:bg-muted/40"
              : "border-amber-500/35 bg-amber-500/10 text-foreground hover:bg-amber-500/15",
          )}
          title={live ? "Phone number" : "Add a phone number to go live"}
        >
          <PhoneForwarded className={cn("size-3.5 shrink-0", live ? "text-muted-foreground" : "text-amber-500")} />
          <span className="truncate tabular-nums">{label}</span>
          {!live && ownedCount === 0 ? <Plus className="size-3 shrink-0 text-amber-600" /> : null}
        </button>
        {assignDialog}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className={cn(
        "rounded-xl border p-3 space-y-2.5",
        live ? "border-emerald-500/25 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5",
      )}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <PhoneForwarded className={cn("h-3.5 w-3.5 shrink-0", live ? "text-emerald-500" : "text-amber-500")} />
            <span className={cn(
              "text-[10px] font-semibold uppercase tracking-wider",
              live ? "text-emerald-600/90 dark:text-emerald-400/90" : "text-amber-600/90 dark:text-amber-400/90",
            )}>
              Your phone number
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate("/app/phone-numbers")}
            className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {ownedCount === 0 ? "Buy →" : "Numbers →"}
          </button>
        </div>

        {isLoading ? (
          <Skeleton className="h-9 w-full rounded-lg" />
        ) : byoNumber ? (
          <div className="w-full flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/50 px-2.5 py-2">
            <div className="min-w-0">
              <p className="text-[12px] font-medium truncate tabular-nums text-foreground">{byoNumber}</p>
              <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
                Your own {telephonyProvider === "plivo" ? "Plivo" : "Twilio"} number — outbound caller ID · unlimited calls
              </p>
            </div>
          </div>
        ) : assigned ? (
          <button
            type="button"
            onClick={openDialog}
            className="w-full flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/50 px-2.5 py-2 text-left hover:border-border hover:bg-background/70 transition-colors"
          >
            <div className="min-w-0">
              <p className="text-[12px] font-medium truncate tabular-nums text-foreground">{assigned.number}</p>
              <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
                Live — inbound + outbound caller ID · unlimited tests
              </p>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </button>
        ) : ownedCount === 0 ? (
          <div className="space-y-2">
            <p className="text-[12px] font-medium text-foreground">Required to go live</p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Buy your own number for inbound calls, your caller ID on outbound, and unlimited testing. The platform number below is only a short trial.
            </p>
            <Button
              type="button"
              size="sm"
              className="h-8 w-full text-xs gap-1.5"
              onClick={() => navigate("/app/phone-numbers")}
            >
              <Plus className="h-3.5 w-3.5" /> Buy a phone number
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openDialog}
            className="w-full flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-background/50 px-2.5 py-2 text-left hover:border-amber-500/50 transition-colors"
          >
            <div className="min-w-0">
              <p className="text-[12px] font-medium truncate text-foreground">Number purchased — assign it</p>
              <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
                Click to attach your number for inbound + outbound
              </p>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </button>
        )}
      </div>

      {!assigned && !byoNumber && (
        <div className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5 flex items-start gap-2">
          <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium tabular-nums text-muted-foreground">
              {testingFromNumber ?? "No trial line"}
            </p>
            <p className="text-[10px] text-muted-foreground/80 leading-relaxed mt-0.5">
              {quota?.unlimitedTrial
                ? "Shared platform trial line — unlimited for your account (admin grant). Still not your number; inbound will not ring this agent. Buy a number to go live."
                : trialExhausted
                  ? "Free trial calls are used up for today. Buy a number to keep testing and to receive inbound calls."
                  : quota?.limited
                    ? `Shared platform line for a quick listen — ${trialRemaining}/${trialLimit} outbound tests/day. Not your number; inbound will not ring this agent.`
                    : "Shared platform trial line — inbound will not ring this agent."}
            </p>
          </div>
          {trialExhausted && (
            <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-[10px]" onClick={() => navigate("/app/phone-numbers")}>
              Buy
            </Button>
          )}
        </div>
      )}

      {assignDialog}
    </div>
  );
}
