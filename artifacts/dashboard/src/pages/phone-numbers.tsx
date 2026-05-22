import React, { useState } from "react";
import { Phone, Plus, Trash2, Link2, Link2Off, Search, Loader2, Globe, AlertCircle } from "lucide-react";
import {
  useListPhoneNumbers,
  useListAvailablePhoneNumbers,
  usePurchasePhoneNumber,
  useAssignPhoneNumber,
  useReleasePhoneNumber,
  useListAgents,
  getListPhoneNumbersQueryKey,
  getListAvailablePhoneNumbersQueryKey,
  getListAgentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PhoneNumber } from "@workspace/api-client-react";

const COUNTRY_OPTIONS = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "IN", name: "India" },
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "SG", name: "Singapore" },
  { code: "AE", name: "UAE" },
];

function AssignDialog({
  number,
  onClose,
}: {
  number: PhoneNumber;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: agents } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });
  const assign = useAssignPhoneNumber();
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    number.agentId ? String(number.agentId) : "none"
  );

  function handleSave() {
    assign.mutate(
      {
        id: number.id,
        data: { agentId: selectedAgentId === "none" ? null : parseInt(selectedAgentId, 10) },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
          toast({ title: "Assignment updated" });
          onClose();
        },
        onError: () => toast({ title: "Error", variant: "destructive", description: "Failed to update assignment" }),
      }
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Number</DialogTitle>
          <DialogDescription>
            Route inbound calls on <span className="font-mono text-foreground">{number.number}</span> to an agent.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label className="text-sm">Agent</Label>
          <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
            <SelectTrigger>
              <SelectValue placeholder="Select agent…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Unassigned —</SelectItem>
              {agents?.map(a => (
                <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={assign.isPending}>
            {assign.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BuyNumberDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [country, setCountry] = useState("US");
  const [numberType, setNumberType] = useState<"local" | "toll_free" | "mobile">("local");
  const [pattern, setPattern] = useState("");
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const { data: available, isFetching, error: searchError, refetch } = useListAvailablePhoneNumbers(
    { countryCode: country, numberType, pattern: pattern || undefined },
    { query: { enabled: false, queryKey: getListAvailablePhoneNumbersQueryKey({ countryCode: country, numberType }), retry: false } }
  );

  const platformNotConfigured =
    searchError != null &&
    (searchError as any)?.response?.status === 503;

  const purchase = usePurchasePhoneNumber();

  function handleSearch() {
    setSearched(true);
    setSelected(null);
    void refetch();
  }

  function handlePurchase() {
    if (!selected) return;
    const num = available?.find(n => n.number === selected);
    purchase.mutate(
      {
        data: {
          number: selected,
          countryCode: country,
          region: num?.region ?? undefined,
          numberType: num?.numberType ?? numberType,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
          toast({ title: "Phone number purchased!", description: `${selected} is now in your account.` });
          onClose();
        },
        onError: (e: any) => {
          const msg = e?.response?.data?.error ?? e?.message ?? "Purchase failed";
          toast({ title: "Purchase failed", description: msg, variant: "destructive" });
          setConfirming(false);
        },
      }
    );
  }

  if (confirming && selected) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Purchase</DialogTitle>
            <DialogDescription>
              You are about to purchase <span className="font-mono text-foreground font-semibold">{selected}</span>.
              This will deduct <span className="text-black/75 font-semibold">$5.00</span> from your wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-400 text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            This purchase is non-refundable once confirmed.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>Back</Button>
            <Button
              className="bg-black/85 hover:bg-black/90 text-white"
              onClick={handlePurchase}
              disabled={purchase.isPending}
            >
              {purchase.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Confirm — $5.00
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Buy a Phone Number</DialogTitle>
          <DialogDescription>
            Numbers are $5.00 one-time. Inbound calls are routed to the agent you assign.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Country</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map(c => (
                    <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={numberType} onValueChange={v => setNumberType(v as typeof numberType)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="mobile">Mobile</SelectItem>
                  <SelectItem value="toll_free">Toll-Free</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Pattern (optional)</Label>
            <div className="flex gap-2">
              <Input
                className="h-9 font-mono text-sm flex-1"
                placeholder="e.g. 415"
                value={pattern}
                onChange={e => setPattern(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
              />
              <Button size="sm" className="h-9 gap-1.5" onClick={handleSearch} disabled={isFetching}>
                {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Search
              </Button>
            </div>
          </div>

          {searched && (
            <div className="border border-border/60 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
              {isFetching ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : platformNotConfigured ? (
                <div className="flex flex-col gap-2 p-4">
                  <div className="flex items-start gap-2.5 text-amber-400">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">Carrier credentials not set up</p>
                      <p className="text-amber-400/70 mt-0.5 text-xs leading-relaxed">
                        To provision real phone numbers, add <code className="font-mono bg-black/[0.08] px-1 rounded">VOBIZ_AUTH_ID</code> and{" "}
                        <code className="font-mono bg-black/[0.08] px-1 rounded">VOBIZ_AUTH_TOKEN</code> as environment secrets in your Replit project.
                      </p>
                    </div>
                  </div>
                </div>
              ) : !available || available.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-black/35 text-sm">
                  <Globe className="h-8 w-8 mb-2 opacity-30" />
                  No numbers available for this search.
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {available.map(n => (
                    <button
                      key={n.number}
                      onClick={() => setSelected(n.number)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors text-left ${
                        selected === n.number ? "bg-black/[0.04] border-l-2 border-emerald-500" : ""
                      }`}
                    >
                      <span className="font-mono font-medium">{n.number}</span>
                      <div className="flex items-center gap-2 text-xs text-black/35">
                        {n.region && <span>{n.region}</span>}
                        <Badge variant="outline" className="text-[10px] capitalize">{n.numberType.replace("_", " ")}</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-black/85 hover:bg-black/90 text-white gap-1.5"
            disabled={!selected}
            onClick={() => setConfirming(true)}
          >
            <Plus className="h-3.5 w-3.5" /> Purchase — $5.00
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PhoneNumbersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: numbers, isLoading } = useListPhoneNumbers({ query: { queryKey: getListPhoneNumbersQueryKey() } });
  const release = useReleasePhoneNumber();
  const [buyOpen, setBuyOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<PhoneNumber | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<PhoneNumber | null>(null);

  function handleRelease(n: PhoneNumber) {
    release.mutate(
      { id: n.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
          toast({ title: "Number released", description: `${n.number} has been released.` });
          setReleaseTarget(null);
        },
        onError: () => toast({ title: "Error", variant: "destructive", description: "Failed to release number" }),
      }
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-transparent">
      {/* Header */}
      <div className="border-b border-black/[0.06] px-6 py-4 flex items-center gap-3 shrink-0">
        <Phone className="w-5 h-5 text-black/75" />
        <h1 className="font-semibold text-black/85 text-lg">Phone Numbers</h1>
        <span className="text-xs text-black/35 ml-auto">Platform-managed numbers · $5.00 / number</span>
        <Button
          size="sm"
          className="h-8 gap-1.5 bg-black/85 hover:bg-black/90 text-white"
          onClick={() => setBuyOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" /> Buy Number
        </Button>
      </div>

      <div className="p-6 max-w-4xl mx-auto space-y-4">
        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 rounded-xl border border-black/[0.07] bg-white">
          <Globe className="h-5 w-5 text-black/75 mt-0.5 shrink-0" />
          <div className="text-sm text-black/50 space-y-0.5">
            <p className="text-black/75 font-medium">Managed phone numbers</p>
            <p>Purchase numbers from our carrier pool. No carrier account needed — assign a number to an agent and inbound calls are automatically routed to its pipeline. <span className="text-black/35">$5.00 one-time per number.</span></p>
          </div>
        </div>

        {/* Numbers list */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-lg border border-black/[0.07] bg-white">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-28 ml-auto" />
              </div>
            ))}
          </div>
        ) : !numbers || numbers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-black/35">
            <Phone className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-sm mb-3">No phone numbers yet.</p>
            <Button size="sm" className="gap-1.5 bg-black/85 hover:bg-black/90 text-white" onClick={() => setBuyOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Buy your first number
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {numbers.map(n => (
              <div
                key={n.id}
                className="flex items-center gap-4 px-4 py-3 rounded-lg border border-black/[0.07]/60 bg-white hover:bg-white/70 backdrop-blur-lg transition-colors"
              >
                <div className="shrink-0">
                  <p className="font-mono font-semibold text-black/85 text-sm">{n.number}</p>
                  <p className="text-[11px] text-black/35 mt-0.5">{n.countryCode}{n.region ? ` · ${n.region}` : ""}</p>
                </div>

                <Badge variant="outline" className="text-[10px] capitalize shrink-0">
                  {n.numberType.replace("_", " ")}
                </Badge>

                <div className="flex-1 min-w-0">
                  {n.agentName ? (
                    <div className="flex items-center gap-1.5 text-xs text-black/75">
                      <Link2 className="h-3 w-3" />
                      <span className="truncate">{n.agentName}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-black/35">
                      <Link2Off className="h-3 w-3" />
                      Unassigned
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1.5 text-black/50 hover:text-black/85"
                    onClick={() => setAssignTarget(n)}
                  >
                    <Link2 className="h-3 w-3" />
                    {n.agentId ? "Reassign" : "Assign"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={() => setReleaseTarget(n)}
                  >
                    <Trash2 className="h-3 w-3" />
                    Release
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {buyOpen && <BuyNumberDialog onClose={() => setBuyOpen(false)} />}
      {assignTarget && <AssignDialog number={assignTarget} onClose={() => setAssignTarget(null)} />}

      {/* Release confirm dialog */}
      {releaseTarget && (
        <Dialog open onOpenChange={() => setReleaseTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Release Number</DialogTitle>
              <DialogDescription>
                Are you sure you want to release <span className="font-mono text-foreground">{releaseTarget.number}</span>?
                This cannot be undone and the number will be returned to the carrier pool.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReleaseTarget(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => handleRelease(releaseTarget)}
                disabled={release.isPending}
              >
                {release.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                Release Number
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
