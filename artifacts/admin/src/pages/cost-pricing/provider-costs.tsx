import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/api";
import { CostPricingLayout } from "./overview";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";

type Rate = {
  id: number;
  provider: string;
  service: string;
  billingUnit: string;
  rate: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
};

export default function ProviderCostsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    provider: "",
    service: "telephony",
    billingUnit: "per_minute",
    rate: "",
    currency: "INR",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "pricing", "provider-costs"],
    queryFn: () => adminFetch<{ rates: Rate[] }>("/pricing/provider-costs"),
  });

  const create = useMutation({
    mutationFn: () =>
      adminFetch<{ rate: Rate; message: string }>("/pricing/provider-costs", {
        method: "POST",
        body: JSON.stringify(form),
      }),
    onSuccess: (res) => {
      toast({ title: "Provider cost saved", description: res.message });
      qc.invalidateQueries({ queryKey: ["admin", "pricing"] });
      setOpen(false);
    },
    onError: (err) => toast({ title: "Failed", description: formatApiError(err), variant: "destructive" }),
  });

  return (
    <CostPricingLayout
      title="Provider Costs"
      subtitle="Versioned COGS. Changing a rate closes the previous version — historical P&L stays stable."
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> New rate
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add provider cost version</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              This rate will apply only to usage from the effective date onward. Historical financial calculations will remain unchanged.
            </p>
            <div className="grid gap-3 py-2">
              <div className="grid gap-1.5">
                <Label>Provider</Label>
                <Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="vobiz" />
              </div>
              <div className="grid gap-1.5">
                <Label>Service</Label>
                <Input value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} placeholder="telephony | stt | tts | llm" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label>Billing unit</Label>
                  <Input value={form.billingUnit} onChange={(e) => setForm({ ...form, billingUnit: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Currency</Label>
                  <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label>Rate</Label>
                  <Input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="0.55" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Effective from</Label>
                  <Input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={create.isPending || !form.provider || !form.rate} onClick={() => create.mutate()}>
                {create.isPending ? "Saving…" : "Save version"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Effective from</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rates ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="capitalize">{r.service}</TableCell>
                  <TableCell className="font-mono text-xs">{r.provider}</TableCell>
                  <TableCell className="text-xs">{r.billingUnit}</TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {r.currency} {r.rate}
                  </TableCell>
                  <TableCell className="text-xs font-mono">{r.effectiveFrom?.slice(0, 10)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {r.effectiveTo ? "Closed" : "Active"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && !(data?.rates?.length) && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    No active provider costs yet. Add a version or run migration seed.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </CostPricingLayout>
  );
}
