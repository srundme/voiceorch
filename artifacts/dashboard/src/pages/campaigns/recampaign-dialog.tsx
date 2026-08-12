/**
 * Re-campaign dialog — clone filtered leads (dispositions + no-pickup/failed)
 * into a new draft batch for another dial pass.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Layers, Loader2, PhoneMissed, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const NO_PICKUP_STATUSES = ["failed", "no_pickup", "busy", "skipped"] as const;

type DispositionSlice = { label: string; count: number };

export function RecampaignDialog({
  open,
  onOpenChange,
  campaignId,
  campaignName,
  dispositions,
  statusBreakdown,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: number;
  campaignName?: string;
  dispositions: DispositionSlice[];
  statusBreakdown?: Record<string, number>;
}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [batchName, setBatchName] = useState("");
  const [selectedDispositions, setSelectedDispositions] = useState<string[]>([]);
  const [includeNoPickup, setIncludeNoPickup] = useState(false);
  const [busy, setBusy] = useState(false);

  const noPickupCount = useMemo(() => {
    const map = statusBreakdown ?? {};
    return NO_PICKUP_STATUSES.reduce((sum, s) => sum + (map[s] ?? 0), 0);
  }, [statusBreakdown]);

  const estimated = useMemo(() => {
    let total = 0;
    for (const d of dispositions) {
      if (selectedDispositions.includes(d.label)) total += d.count;
    }
    if (includeNoPickup) total += noPickupCount;
    return total;
  }, [dispositions, selectedDispositions, includeNoPickup, noPickupCount]);

  const toggleDisposition = (label: string) => {
    setSelectedDispositions((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label],
    );
  };

  const reset = () => {
    setBatchName("");
    setSelectedDispositions([]);
    setIncludeNoPickup(false);
  };

  const submit = async () => {
    if (selectedDispositions.length === 0 && !includeNoPickup) {
      toast({ title: "Pick at least one slice", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const result = await customFetch<{
        inserted: number;
        batchId: number;
        batchName: string;
        matched: number;
        deduped: number;
      }>(`/api/campaigns/${campaignId}/recampaign`, {
        method: "POST",
        body: JSON.stringify({
          batchName:
            batchName.trim() ||
            `Re-campaign — ${campaignName || "campaign"}`.slice(0, 120),
          dispositions: selectedDispositions,
          callStatuses: includeNoPickup ? [...NO_PICKUP_STATUSES] : [],
        }),
      });
      toast({
        title: "Re-campaign batch created",
        description: `${result.inserted} leads ready in “${result.batchName}”${
          result.deduped > 0 ? ` (${result.deduped} duplicates removed)` : ""
        }.`,
      });
      reset();
      onOpenChange(false);
      setLocation(`/app/campaigns/${campaignId}/batches/${result.batchId}`);
    } catch (err) {
      toast({
        title: "Re-campaign failed",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-primary/70" />
            Re-campaign leads
          </DialogTitle>
          <DialogDescription>
            Create a new draft batch from completed campaign results — e.g. not interested,
            partially interested, or no-pickup / failed calls — then dial them again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Batch name</Label>
            <Input
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder={`Re-campaign — ${campaignName || "leads"}`}
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              By disposition
            </p>
            {dispositions.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                No disposition labels yet on this campaign.
              </p>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-border/60 p-2">
                {dispositions.map((d) => {
                  const on = selectedDispositions.includes(d.label);
                  return (
                    <button
                      key={d.label}
                      type="button"
                      onClick={() => toggleDisposition(d.label)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors",
                        on
                          ? "border-primary/40 bg-primary/5"
                          : "border-transparent hover:bg-muted/40",
                      )}
                    >
                      <span className="text-sm font-medium truncate">{d.label}</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground shrink-0 ml-2">
                        {d.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              By call outcome
            </p>
            <button
              type="button"
              onClick={() => setIncludeNoPickup((v) => !v)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors",
                includeNoPickup
                  ? "border-amber-500/40 bg-amber-500/5"
                  : "border-border/60 hover:bg-muted/30",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <PhoneMissed className="h-3.5 w-3.5 text-amber-600" />
                No pickup / failed / busy / skipped
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {noPickupCount}
              </span>
            </button>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Includes leads that never answered or ended as failed — useful for a second pass.
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
            {estimated > 0 ? (
              <>About <strong className="text-foreground">{estimated}</strong> leads selected (duplicates removed when creating).</>
            ) : (
              <span className="inline-flex items-center gap-1">
                <XCircle className="h-3.5 w-3.5" /> Select at least one slice to continue.
              </span>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => void submit()}
            disabled={busy || estimated === 0}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
            {busy ? "Creating…" : "Create re-campaign batch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
