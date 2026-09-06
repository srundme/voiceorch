import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/api";
import { CostPricingLayout } from "./overview";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type Rate = {
  id: number;
  provider?: string;
  plan?: string;
  segment?: string;
  service: string;
  billingUnit: string;
  rate: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string | null;
  notes: string | null;
};

export function CostHistoryPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "pricing", "provider-costs", "history"],
    queryFn: () => adminFetch<{ history: Rate[] }>("/pricing/provider-costs/history"),
  });

  return (
    <CostPricingLayout title="Cost History" subtitle="All provider cost versions — oldest rows keep their original rates.">
      <HistoryTable rows={data?.history ?? []} isLoading={isLoading} kind="provider" />
    </CostPricingLayout>
  );
}

export function PricingHistoryPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "pricing", "customer-rates", "history"],
    queryFn: () => adminFetch<{ history: Rate[] }>("/pricing/customer-rates/history"),
  });

  return (
    <CostPricingLayout title="Pricing History" subtitle="All customer price versions.">
      <HistoryTable rows={data?.history ?? []} isLoading={isLoading} kind="customer" />
    </CostPricingLayout>
  );
}

function HistoryTable({ rows, isLoading, kind }: { rows: Rate[]; isLoading: boolean; kind: "provider" | "customer" }) {
  return (
    <Card>
      <CardContent className="pt-4 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {kind === "provider" ? <TableHead>Provider</TableHead> : <TableHead>Plan / Segment</TableHead>}
              <TableHead>Service</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">
                  {kind === "provider" ? r.provider : `${r.plan} / ${r.segment}`}
                </TableCell>
                <TableCell>{r.service}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {r.currency} {r.rate}
                </TableCell>
                <TableCell className="text-xs font-mono">{r.effectiveFrom?.slice(0, 10)}</TableCell>
                <TableCell className="text-xs font-mono">{r.effectiveTo?.slice(0, 10) ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.createdBy ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">
                    {r.effectiveTo ? "Closed" : "Active"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && !rows.length && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                  No history yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
