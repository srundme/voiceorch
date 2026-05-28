import { useState } from "react";
import { UsageSubNav, UsagePageHeader } from "@/components/usage-layout";
import {
  useAllocations, useUpsertAllocation, useDeleteAllocation, microsToUsd, type AllocationRow,
} from "@/hooks/use-usage-monitor";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";

const SERVICES = [{ value: "stt", label: "STT" }, { value: "llm", label: "LLM" }, { value: "tts", label: "TTS" }];

export default function AllocationsPage() {
  const { data, isLoading } = useAllocations();
  const upsert = useUpsertAllocation();
  const del = useDeleteAllocation();
  const [editing, setEditing] = useState<AllocationRow | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-6">
      <UsagePageHeader
        title="Provider allocations"
        subtitle="Budget caps per (service, provider). Used to drive thresholds, low-balance and progress bars."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }} data-testid="button-new-allocation">
                <Plus className="mr-1 h-3 w-3" /> Add allocation
              </Button>
            </DialogTrigger>
            <AllocationDialog
              editing={editing}
              onSave={async (input) => { await upsert.mutateAsync(input); setOpen(false); }}
              saving={upsert.isPending}
            />
          </Dialog>
        }
      />
      <UsageSubNav />

      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Values in <strong>USD micros</strong>. Low balance threshold triggers a <code>low_balance</code> alert when remaining
        drops below it.
      </p>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead className="text-right">Allocated</TableHead>
                <TableHead className="text-right">Low balance ≤</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : (data ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No allocations defined.</TableCell></TableRow>
              ) : (
                (data ?? []).map((r) => (
                  <TableRow key={r.id} data-testid={`alloc-row-${r.id}`}>
                    <TableCell className="uppercase">{r.service}</TableCell>
                    <TableCell className="capitalize">{r.provider}</TableCell>
                    <TableCell className="font-mono text-[11px]">{r.workspaceId ?? "(global)"}</TableCell>
                    <TableCell className="text-right">{microsToUsd(r.allocatedCostMicros)}</TableCell>
                    <TableCell className="text-right">{microsToUsd(r.lowBalanceThresholdMicros)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.notes ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => { setEditing(r); setOpen(true); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300"
                        onClick={() => del.mutate(r.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AllocationDialog({
  editing, onSave, saving,
}: {
  editing: AllocationRow | null;
  onSave: (input: Omit<AllocationRow, "id" | "updatedAt">) => Promise<void> | void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    service: editing?.service ?? "llm",
    provider: editing?.provider ?? "",
    workspaceId: editing?.workspaceId ?? null,
    allocatedCostMicros: editing?.allocatedCostMicros ?? 0,
    lowBalanceThresholdMicros: editing?.lowBalanceThresholdMicros ?? 0,
    notes: editing?.notes ?? null,
  });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{editing ? "Edit allocation" : "Add allocation"}</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label>Service</Label>
            <Select value={form.service} onValueChange={(v) => setForm({ ...form, service: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SERVICES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Provider</Label>
            <Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
          </div>
          <div>
            <Label>Workspace (optional)</Label>
            <Input value={form.workspaceId ?? ""} placeholder="(global)"
              onChange={(e) => setForm({ ...form, workspaceId: e.target.value || null })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Allocated (USD micros)</Label>
            <Input type="number" value={form.allocatedCostMicros}
              onChange={(e) => setForm({ ...form, allocatedCostMicros: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Low balance threshold (micros)</Label>
            <Input type="number" value={form.lowBalanceThresholdMicros}
              onChange={(e) => setForm({ ...form, lowBalanceThresholdMicros: Number(e.target.value) })} />
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value || null })} />
        </div>
      </div>
      <DialogFooter>
        <Button disabled={saving || !form.provider} onClick={() => onSave(form)} data-testid="button-save-allocation">
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
