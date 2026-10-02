import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DemoTag,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  Meter,
  PilotStatusBadge,
  RateText,
  SalesPageHeader,
  SectionCard,
  SimpleSelect,
  touch,
  useSalesToast,
  useTeamNames,
} from "@/components/sales/sales-ui";
import { useQuickActions } from "@/components/sales/quick-actions";
import { useSalesPrefs } from "@/components/sales/sales-context";
import { usePilots, useSalesSettings } from "@/hooks/use-sales-api";
import { salesDownload } from "@/lib/sales-api";
import { formatCount, formatDateTimeIST } from "@/lib/sales-format";
import { ACTIVE_PILOT_STATUSES, PILOT_STATUSES, type Pilot } from "@/lib/sales-types";

export default function PilotsPage() {
  const [status, setStatus] = useState("");
  const pilots = usePilots({ status: status || undefined });
  const all = usePilots({});
  const settings = useSalesSettings();
  const qa = useQuickActions();
  const toast = useSalesToast();
  const { demo } = useSalesPrefs();
  const capacity = settings.data?.config.pilot.activeCapacity ?? 6;
  const active = (all.data?.pilots ?? []).filter((p) => ACTIVE_PILOT_STATUSES.includes(p.status)).length;

  return (
    <div className="space-y-4">
      <SalesPageHeader
        title="Pilots"
        subtitle="Draft → Setup → Calling → Review due → Completed. Setup counts against active capacity."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className={touch}
              onClick={() => salesDownload("/exports/pilots.csv", `sales-pilots${demo ? "-demo" : ""}.csv`, { demo }).catch((e) => toast.error(e, "Export failed"))}
            >
              <Download className="mr-1.5 h-4 w-4" /> CSV
            </Button>
            <Button size="sm" className={touch} onClick={() => qa.open("pilot")}>
              <Plus className="mr-1.5 h-4 w-4" /> New pilot
            </Button>
          </>
        }
      />

      <SectionCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Active pilots (Setup, Calling, Review due){demo ? " — demo data" : ""}</p>
            <p className="text-2xl font-semibold tabular-nums">
              {active} <span className="text-base font-normal text-muted-foreground">/ {capacity}</span>
            </p>
          </div>
          <div className="w-full max-w-xs flex-1">
            <Meter value={capacity ? active / capacity : null} tone={active >= capacity ? "danger" : active >= capacity - 1 ? "warning" : "accent"} />
            <p className="mt-1 text-[11px] text-muted-foreground">{active >= capacity ? "At capacity — starting Setup needs a founder override with a reason." : `${capacity - active} slot${capacity - active === 1 ? "" : "s"} free`}</p>
          </div>
        </div>
      </SectionCard>

      <div className="flex items-center gap-2">
        <SimpleSelect value={status} onChange={setStatus} options={PILOT_STATUSES} allowAll allLabel="All statuses" className="w-48" />
      </div>

      {pilots.isLoading && <LoadingBlock rows={5} />}
      {pilots.error && <ErrorBlock error={pilots.error} onRetry={() => pilots.refetch()} />}
      {pilots.data && pilots.data.pilots.length === 0 && (
        <EmptyBlock
          title="No pilots"
          description="Start a pilot from a company once the buyer agrees."
          action={
            <Button size="sm" className={touch} onClick={() => qa.open("pilot")}>
              New pilot
            </Button>
          }
        />
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {pilots.data?.pilots.map((p) => <PilotCard key={p.id} p={p} />)}
      </div>
    </div>
  );
}

function PilotCard({ p }: { p: Pilot }) {
  const names = useTeamNames();
  const a = p.allowance;
  const used = a.attemptsUsed ?? 0;
  return (
    <Link href={`/sales/pilots/${p.id}`} className="block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{p.companyName ?? `Company #${p.companyId}`}</p>
          <p className="truncate text-xs text-muted-foreground">
            Pilot #{p.id}
            {p.useCase ? ` · ${p.useCase}` : ""} · {names(p.ownerId)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {p.isDemo && <DemoTag />}
          <PilotStatusBadge status={p.status} />
        </div>
      </div>
      <div className="mt-3 space-y-1">
        <div className="flex justify-between text-xs">
          <span>Attempts</span>
          <span className="tabular-nums">
            {a.attemptsUsed == null ? "No data" : formatCount(used)} / {formatCount(a.revisedAllowance)}
            {a.extensionAttempts ? ` (incl. +${a.extensionAttempts})` : ""}
          </span>
        </div>
        <Meter value={a.revisedAllowance ? Math.min(1, used / a.revisedAllowance) : null} tone={a.overAllowance ? "danger" : "accent"} />
        {a.overAllowance && (
          <p className={cn("flex items-center gap-1 text-[11px] text-red-500")}>
            <AlertTriangle className="h-3 w-3" /> Over allowance by {formatCount(a.overBy)}
          </p>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-muted-foreground">Answer rate</p>
          <RateText rate={p.rates.answerRate} />
        </div>
        <div>
          <p className="text-muted-foreground">Accepted outcomes</p>
          <RateText rate={p.rates.acceptedRate} />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Review {formatDateTimeIST(p.reviewAt)} · {p.latestSnapshot ? `data as of ${formatDateTimeIST(p.latestSnapshot.asOf)}` : "no snapshot yet"}
      </p>
    </Link>
  );
}
