import { useState } from "react";
import { UsageSubNav, UsagePageHeader } from "@/components/usage-layout";
import { usePricing, useUpsertPricing, useDeletePricing, type PricingRow } from "@/hooks/use-usage-monitor";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";

const SERVICES = [
  { value: "stt", label: "STT" },
  { value: "llm", label: "LLM" },
  { value: "tts", label: "TTS" },
];

export default function PricingPage() {
  const { data, isLoading } = usePricing();
  const upsert = useUpsertPricing();
  const del = useDeletePricing();
  const [editing, setEditing] = useState<PricingRow | null>(null);
  const [open, setOpen] = useState(false);

  const openNew = () => { setEditing(null); setOpen(true); };
  const openEdit = (r: PricingRow) => { setEditing(r); setOpen(true); };

  return (
    <div className="space-y-6">
      <UsagePageHeader
        title="Provider pricing"
        subtitle="Per-(service, provider, model) unit prices used to compute cost on every event"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openNew} data-testid="button-new-pricing">
                <Plus className="mr-1 h-3 w-3" /> Add pricing
              </Button>
            </DialogTrigger>
            <PricingDialog
              editing={editing}
              onSave={async (input) => { await upsert.mutateAsync(input); setOpen(false); }}
              saving={upsert.isPending}
            />
          </Dialog>
        }
      />
      <UsageSubNav />

      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        All values are in <strong>USD micros</strong> (1 USD = 1,000,000). Token prices are per <strong>1M tokens</strong>;
        audio prices are per second; character prices are per character.
      </p>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Input / 1M</TableHead>
                <TableHead className="text-right">Output / 1M</TableHead>
                <TableHead className="text-right">Audio/sec</TableHead>
                <TableHead className="text-right">Char</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : (data ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No pricing configured.</TableCell></TableRow>
              ) : (
                (data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="uppercase">{r.service}</TableCell>
                    <TableCell className="capitalize">{r.provider}</TableCell>
                    <TableCell className="font-mono text-xs">{r.model}</TableCell>
                    <TableCell className="text-right">{r.inputTokenPricePerMillionMicros.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{r.outputTokenPricePerMillionMicros.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{r.audioSecondPriceMicros.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{r.characterPriceMicros.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-400 hover:text-red-300"
                        onClick={() => del.mutate(r.id)}
                      >
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

function PricingDialog({
  editing, onSave, saving,
}: {
  editing: PricingRow | null;
  onSave: (input: Omit<PricingRow, "id" | "updatedAt">) => Promise<void> | void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    service: editing?.service ?? "llm",
    provider: editing?.provider ?? "",
    model: editing?.model ?? "",
    inputTokenPricePerMillionMicros: editing?.inputTokenPricePerMillionMicros ?? 0,
    outputTokenPricePerMillionMicros: editing?.outputTokenPricePerMillionMicros ?? 0,
    audioSecondPriceMicros: editing?.audioSecondPriceMicros ?? 0,
    characterPriceMicros: editing?.characterPriceMicros ?? 0,
  });

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{editing ? "Edit pricing" : "Add pricing"}</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label>Service</Label>
            <Select value={form.service} onValueChange={(v) => setForm({ ...form, service: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SERVICES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Provider</Label>
            <Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
          </div>
          <div>
            <Label>Model</Label>
            <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Input / 1M tokens (micros)</Label>
            <Input type="number" value={form.inputTokenPricePerMillionMicros}
              onChange={(e) => setForm({ ...form, inputTokenPricePerMillionMicros: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Output / 1M tokens (micros)</Label>
            <Input type="number" value={form.outputTokenPricePerMillionMicros}
              onChange={(e) => setForm({ ...form, outputTokenPricePerMillionMicros: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Audio per second (micros)</Label>
            <Input type="number" value={form.audioSecondPriceMicros}
              onChange={(e) => setForm({ ...form, audioSecondPriceMicros: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Per character (micros)</Label>
            <Input type="number" value={form.characterPriceMicros}
              onChange={(e) => setForm({ ...form, characterPriceMicros: Number(e.target.value) })} />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button disabled={saving || !form.provider || !form.model} onClick={() => onSave(form)} data-testid="button-save-pricing">
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
