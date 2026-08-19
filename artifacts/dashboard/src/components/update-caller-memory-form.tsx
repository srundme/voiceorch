import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type AgentTarget = { kind: "agent"; agentId: number; phone: string };
type CampaignTarget = { kind: "campaign"; campaignId: number; leadId: number };

export function UpdateCallerMemoryForm({
  target,
  onSaved,
}: {
  target: AgentTarget | CampaignTarget;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [factKey, setFactKey] = useState("");
  const [factValue, setFactValue] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = !!(note.trim() || (factKey.trim() && factValue.trim()));

  async function save() {
    const trimmedNote = note.trim();
    const key = factKey.trim();
    const value = factValue.trim();
    if (!trimmedNote && !(key && value)) return;
    setSaving(true);
    try {
      const body: { note?: string; context?: Record<string, string> } = {};
      if (trimmedNote) body.note = trimmedNote;
      if (key && value) body.context = { [key]: value };

      const url = target.kind === "agent"
        ? `/api/agents/${target.agentId}/caller-memory/${encodeURIComponent(target.phone)}/facts`
        : `/api/campaigns/${target.campaignId}/leads/${target.leadId}/memory`;

      await customFetch(url, { method: "POST", body: JSON.stringify(body) });
      setNote("");
      setFactKey("");
      setFactValue("");
      toast({
        title: "Saved for next call",
        description: "The agent will use this update on the next conversation with this caller.",
      });
      onSaved?.();
    } catch {
      toast({ title: "Could not save update", description: "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <Textarea
        placeholder="Latest update for this request (refund approved, order shipped, appointment moved…)"
        value={note}
        onChange={e => setNote(e.target.value)}
        className="min-h-[72px] text-[13px] resize-none"
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save(); }}
      />
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
        <Input
          placeholder="Field (e.g. order_status)"
          value={factKey}
          onChange={e => setFactKey(e.target.value)}
          className="h-8 text-[13px]"
        />
        <Input
          placeholder="Value (e.g. shipped)"
          value={factValue}
          onChange={e => setFactValue(e.target.value)}
          className="h-8 text-[13px]"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground/70 leading-snug">
          The agent uses this on the next call — inbound, outbound, or campaign.
        </p>
        <Button size="sm" className="h-7 text-xs gap-1.5 shrink-0" disabled={!canSave || saving} onClick={() => void save()}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          {saving ? "Saving…" : "Save for next call"}
        </Button>
      </div>
    </div>
  );
}
