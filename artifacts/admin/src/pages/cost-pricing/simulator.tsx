import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { adminFetch } from "@/lib/api";
import { CostPricingLayout } from "./overview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatApiError } from "@/lib/format-api-error";
import { useToast } from "@/hooks/use-toast";

type SimOut = {
  outputs: {
    costPerMin: number;
    profitPerMin: number;
    marginPct: number;
    totalMinutes: number;
    revenue: number;
    cost: number;
    grossProfit: number;
    projectedMonthlyProfit: number;
  };
};

export default function ProfitSimulatorPage() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    customerPricePerMin: "3.50",
    telephonyCostPerMin: "0.55",
    sttCostPerMin: "0.60",
    ttsCostPerMin: "0.40",
    llmCostPerMin: "0.20",
    otherCostPerMin: "0",
    averageMinutes: "100",
    numberOfUsers: "50",
  });
  const [result, setResult] = useState<SimOut["outputs"] | null>(null);

  const run = useMutation({
    mutationFn: () =>
      adminFetch<SimOut>("/pricing/simulator", {
        method: "POST",
        body: JSON.stringify({
          customerPricePerMin: Number(form.customerPricePerMin),
          telephonyCostPerMin: Number(form.telephonyCostPerMin),
          sttCostPerMin: Number(form.sttCostPerMin),
          ttsCostPerMin: Number(form.ttsCostPerMin),
          llmCostPerMin: Number(form.llmCostPerMin),
          otherCostPerMin: Number(form.otherCostPerMin),
          averageMinutes: Number(form.averageMinutes),
          numberOfUsers: Number(form.numberOfUsers),
        }),
      }),
    onSuccess: (res) => setResult(res.outputs),
    onError: (err) => toast({ title: "Simulator failed", description: formatApiError(err), variant: "destructive" }),
  });

  const fields: { key: keyof typeof form; label: string }[] = [
    { key: "customerPricePerMin", label: "Customer price / min" },
    { key: "telephonyCostPerMin", label: "Telephony cost / min" },
    { key: "sttCostPerMin", label: "STT cost / min" },
    { key: "ttsCostPerMin", label: "TTS cost / min" },
    { key: "llmCostPerMin", label: "LLM cost / min" },
    { key: "otherCostPerMin", label: "Other cost / min" },
    { key: "averageMinutes", label: "Avg minutes / user" },
    { key: "numberOfUsers", label: "Number of users" },
  ];

  return (
    <CostPricingLayout
      title="Profit Simulator"
      subtitle="Test economics without changing production pricing. Does not write to the database."
    >
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inputs</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className="grid gap-1.5">
                <Label className="text-xs">{f.label}</Label>
                <Input
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="font-mono"
                />
              </div>
            ))}
            <div className="col-span-2">
              <Button onClick={() => run.mutate()} disabled={run.isPending}>
                {run.isPending ? "Calculating…" : "Run simulation"}
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Outputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 font-mono text-sm tabular-nums">
            {!result && <p className="text-muted-foreground text-sm font-sans">Run a simulation to see results.</p>}
            {result && (
              <>
                <Row label="Total cost / min" value={result.costPerMin} />
                <Row label="Profit / min" value={result.profitPerMin} />
                <Row label="Gross margin %" value={result.marginPct} />
                <Row label="Total minutes" value={result.totalMinutes} />
                <Row label="Revenue" value={result.revenue} />
                <Row label="Cost" value={result.cost} />
                <Row label="Gross profit" value={result.grossProfit} />
                <Row label="Projected monthly profit" value={result.projectedMonthlyProfit} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </CostPricingLayout>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between border-b border-border/50 py-1.5">
      <span className="font-sans text-muted-foreground text-xs">{label}</span>
      <span>{Number.isInteger(value) ? value : value.toFixed(2)}</span>
    </div>
  );
}
