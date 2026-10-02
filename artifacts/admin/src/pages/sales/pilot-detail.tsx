import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, Check, Circle, FileText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  DataTable,
  DemoTag,
  ErrorBlock,
  Field,
  FounderOnlyNote,
  LoadingBlock,
  Meter,
  MoneyInput,
  OwnerSelect,
  Pill,
  PilotStatusBadge,
  RateText,
  ReasonDialog,
  SectionCard,
  touch,
  useSalesToast,
} from "@/components/sales/sales-ui";
import { FormDialog } from "@/components/sales/form-dialog";
import { CsvMapper, type CsvField } from "@/components/sales/csv-mapper";
import { useSalesPrefs } from "@/components/sales/sales-context";
import { useAddSnapshot, useExtendPilot, useImportSnapshots, usePilot, usePilotStatus, useSalesSettings, useUpdatePilot } from "@/hooks/use-sales-api";
import { isSalesApiError } from "@/lib/sales-api";
import { cellToIsoDateTime, formatCount, formatDateTimeIST, formatPaise, istLocalToIso, isoToIstLocal, nowIstLocal, rupeesToPaise } from "@/lib/sales-format";
import { NEXT_PILOT_STATUS, type Pilot, type PilotDetail, type PilotStatus, type SnapshotImportResult } from "@/lib/sales-types";

const FINAL: PilotStatus[] = ["Completed", "Cancelled"];

function setupGaps(p: Pilot): string[] {
  const out: string[] = [];
  if (!p.useCase?.trim()) out.push("Use case");
  if (!p.language?.trim()) out.push("Calling language");
  if (!p.qualificationCriteria?.trim()) out.push("Qualification criteria");
  if (!p.approvedScript?.trim()) out.push("Approved script");
  if (!p.leadCount || p.leadCount <= 0) out.push("Lead count");
  if (!p.contactBasisConfirmed) out.push("Contact basis confirmed");
  if (!p.reviewAt) out.push("Booked review time");
  return out;
}

export default function PilotDetailPage({ id }: { id: number }) {
  const q = usePilot(id);
  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.error) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return null;
  return <PilotView data={q.data} />;
}

function PilotView({ data }: { data: PilotDetail }) {
  const p = data.pilot;
  const final = FINAL.includes(p.status);
  return (
    <div className="space-y-4">
      <Link href="/sales/pilots" className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-foreground md:min-h-0">
        <ArrowLeft className="h-3.5 w-3.5" /> Pilots
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">Pilot #{p.id}</h1>
            <PilotStatusBadge status={p.status} />
            {p.isDemo && <DemoTag />}
          </div>
          <Link href={`/sales/companies/${p.companyId}`} className="text-sm hover:underline">
            {p.companyName ?? `Company #${p.companyId}`}
          </Link>
          <p className="text-xs text-muted-foreground">
            Review {formatDateTimeIST(p.reviewAt)} · window {formatDateTimeIST(p.windowStart)} → {formatDateTimeIST(p.windowEnd)}
          </p>
          {p.capacityOverrideReason && <p className="text-xs text-amber-600 dark:text-amber-400">Started over capacity: {p.capacityOverrideReason}</p>}
          {p.cancelledReason && <p className="text-xs text-muted-foreground">Cancelled: {p.cancelledReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className={touch}>
            <Link href={`/sales/pilots/${p.id}/report`}>
              <FileText className="mr-1.5 h-4 w-4" /> Customer report
            </Link>
          </Button>
          {!final && <StatusControls pilot={p} />}
        </div>
      </div>

      <MetricsCard data={data} />

      <Tabs defaultValue={p.status === "Draft" ? "setup" : "data"}>
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="setup">Setup</TabsTrigger>
            <TabsTrigger value="data">Snapshots</TabsTrigger>
            <TabsTrigger value="quality">Quality & review</TabsTrigger>
            <TabsTrigger value="allowance">Allowance</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="setup" className="space-y-4">
          <SetupForm pilot={p} locked={final} />
          <ReadinessCard pilot={p} locked={final} />
        </TabsContent>
        <TabsContent value="data" className="space-y-4">
          <SnapshotsCard data={data} locked={final} />
        </TabsContent>
        <TabsContent value="quality" className="space-y-4">
          <QualityCard pilot={p} />
          <ReviewForm pilot={p} />
        </TabsContent>
        <TabsContent value="allowance">
          <AllowanceCard pilot={p} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusControls({ pilot: p }: { pilot: Pilot }) {
  const { isFounder } = useSalesPrefs();
  const status = usePilotStatus();
  const toast = useSalesToast();
  const next = NEXT_PILOT_STATUS[p.status];
  const [override, setOverride] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const gaps = next === "Setup" ? setupGaps(p) : [];

  const move = (to: PilotStatus, overrideReason?: string) =>
    status.mutate(
      { id: p.id, to, overrideReason: overrideReason ?? null },
      {
        onSuccess: () => {
          toast.success(`Pilot moved to ${to}`);
          setOverride(null);
        },
        onError: (e) => {
          if (isSalesApiError(e) && e.status === 409 && e.body?.code === "capacity" && isFounder && !overrideReason) setOverride(e.message);
          else if (!overrideReason) toast.error(e, `Could not move to ${to}`);
        },
      },
    );

  return (
    <>
      {next && (
        <Button size="sm" className={touch} disabled={status.isPending || gaps.length > 0} onClick={() => move(next)} title={gaps.length ? `Missing: ${gaps.join(", ")}` : undefined}>
          Move to {next}
        </Button>
      )}
      <Button size="sm" variant="ghost" className={touch} onClick={() => setCancelling(true)}>
        Cancel pilot
      </Button>
      {gaps.length > 0 && <p className="w-full text-xs text-amber-600 dark:text-amber-400">Before Setup: {gaps.join(", ")}.</p>}
      <ReasonDialog
        open={override != null}
        onOpenChange={(v) => !v && setOverride(null)}
        title="Active pilot capacity is full"
        description={`${override ?? ""} As a founder you can start anyway — the reason is recorded.`}
        label="Override reason"
        confirmLabel="Start Setup anyway"
        pending={status.isPending}
        error={override != null ? status.error : null}
        onConfirm={(reason) => move("Setup", reason)}
      />
      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel pilot"
        destructive
        confirmLabel="Cancel pilot"
        pending={status.isPending}
        error={cancelling ? status.error : null}
        onConfirm={(reason) => status.mutate({ id: p.id, to: "Cancelled", reason }, { onSuccess: () => setCancelling(false) })}
      />
    </>
  );
}

function MetricsCard({ data }: { data: PilotDetail }) {
  const p = data.pilot;
  const s = p.latestSnapshot;
  const a = p.allowance;
  const rateRows: Array<[string, keyof Pilot["rates"]]> = [
    ["Answer rate", "answerRate"],
    ["Meaningful conversations", "meaningfulRate"],
    ["Qualified people", "qualifiedRate"],
    ["Accepted outcomes", "acceptedRate"],
    ["Callback requests", "callbackRate"],
    ["Confirmed appointments", "appointmentRate"],
  ];
  return (
    <SectionCard title="Results" description={s ? `Data as of ${formatDateTimeIST(s.asOf)} (${s.source})` : "No snapshot yet — add one manually or import a CSV."}>
      {a.overAllowance && (
        <p className="mb-3 flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="h-4 w-4" /> Attempts are over the allowance by {formatCount(a.overBy)}. {a.note}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {rateRows.map(([label, key]) => (
          <div key={key}>
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <RateText rate={p.rates[key]} className="text-sm" />
            <p className="text-[10px] text-muted-foreground">{p.rates[key]?.label}</p>
          </div>
        ))}
      </div>
      {s && (
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <span>Attempts: {formatCount(s.attempts)}</span>
          <span>Distinct records: {formatCount(s.distinctRecords)}</span>
          <span>Connected minutes: {formatCount(s.connectedMinutes)}</span>
          <span>Cost: {formatPaise(s.costPaise)}</span>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">{data.newPilotRule}</p>
    </SectionCard>
  );
}

function SetupForm({ pilot: p, locked }: { pilot: Pilot; locked: boolean }) {
  const { isFounder } = useSalesPrefs();
  const update = useUpdatePilot();
  const toast = useSalesToast();
  const [f, setF] = useState({
    useCase: p.useCase ?? "",
    language: p.language ?? "",
    qualificationCriteria: p.qualificationCriteria ?? "",
    approvedScript: p.approvedScript ?? "",
    leadCount: p.leadCount == null ? "" : String(p.leadCount),
    contactBasisConfirmed: p.contactBasisConfirmed,
    campaignRef: p.campaignRef ?? "",
    windowStart: isoToIstLocal(p.windowStart),
    windowEnd: isoToIstLocal(p.windowEnd),
    reviewAt: isoToIstLocal(p.reviewAt),
    ownerId: p.ownerId,
    followupOwnerId: p.followupOwnerId,
    attemptAllowance: String(p.attemptAllowance),
  });
  const t = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () =>
    update.mutate(
      {
        id: p.id,
        useCase: f.useCase.trim() || null,
        language: f.language.trim() || null,
        qualificationCriteria: f.qualificationCriteria.trim() || null,
        approvedScript: f.approvedScript.trim() || null,
        leadCount: f.leadCount ? Number(f.leadCount) : null,
        contactBasisConfirmed: f.contactBasisConfirmed,
        campaignRef: f.campaignRef.trim() || null,
        windowStart: istLocalToIso(f.windowStart),
        windowEnd: istLocalToIso(f.windowEnd),
        reviewAt: istLocalToIso(f.reviewAt),
        ownerId: f.ownerId,
        followupOwnerId: f.followupOwnerId,
        ...(isFounder && Number(f.attemptAllowance) !== p.attemptAllowance ? { attemptAllowance: Number(f.attemptAllowance) } : {}),
      },
      { onSuccess: () => toast.success("Pilot saved") },
    );

  return (
    <SectionCard title="Required inputs" description={locked ? "This pilot is closed; setup fields are read-only." : "Everything here is required before Setup."}>
      <fieldset disabled={locked} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Use case" required>
            <Input value={f.useCase} onChange={t("useCase")} className={touch} />
          </Field>
          <Field label="Calling language" required>
            <Input value={f.language} onChange={t("language")} placeholder="e.g. Tamil + English" className={touch} />
          </Field>
          <Field label="Qualification criteria" required className="sm:col-span-2">
            <Textarea value={f.qualificationCriteria} onChange={t("qualificationCriteria")} rows={2} />
          </Field>
          <Field label="Approved script" required className="sm:col-span-2">
            <Textarea value={f.approvedScript} onChange={t("approvedScript")} rows={5} />
          </Field>
          <Field label="Lead count" required>
            <Input value={f.leadCount} onChange={(e) => setF({ ...f, leadCount: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={touch} />
          </Field>
          <Field label="Review booked for (IST)" required>
            <Input type="datetime-local" value={f.reviewAt} onChange={t("reviewAt")} className={touch} />
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
            <Checkbox checked={f.contactBasisConfirmed} onCheckedChange={(v) => setF({ ...f, contactBasisConfirmed: v === true })} />
            The customer confirmed a lawful contact basis for these leads <span className="text-red-500">*</span>
          </label>
          <Field label="Calling window start (IST)">
            <Input type="datetime-local" value={f.windowStart} onChange={t("windowStart")} className={touch} />
          </Field>
          <Field label="Calling window end (IST)">
            <Input type="datetime-local" value={f.windowEnd} onChange={t("windowEnd")} className={touch} />
          </Field>
          <Field label="Campaign reference">
            <Input value={f.campaignRef} onChange={t("campaignRef")} className={touch} />
          </Field>
          <Field label="Attempt allowance" hint={isFounder ? undefined : <FounderOnlyNote>Only founders change the allowance</FounderOnlyNote>}>
            <Input value={f.attemptAllowance} onChange={(e) => setF({ ...f, attemptAllowance: e.target.value.replace(/\D/g, "") })} disabled={!isFounder} inputMode="numeric" className={touch} />
          </Field>
          <Field label="Pilot owner">
            <OwnerSelect value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} />
          </Field>
          <Field label="Follow-up owner">
            <OwnerSelect value={f.followupOwnerId} onChange={(v) => setF({ ...f, followupOwnerId: v })} />
          </Field>
        </div>
        {update.error && <p className="text-sm text-red-500">{(isSalesApiError(update.error) ? update.error.messages : [update.error.message]).join("; ")}</p>}
        {!locked && (
          <Button className={touch} onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save setup"}
          </Button>
        )}
      </fieldset>
    </SectionCard>
  );
}

function Checklist({ items, values, onToggle, disabled }: { items: Array<[string, string]>; values: Record<string, unknown>; onToggle: (key: string, v: boolean) => void; disabled?: boolean }) {
  const done = items.filter(([k]) => values[k] === true).length;
  return (
    <div className="space-y-1">
      <Meter value={items.length ? done / items.length : null} tone={done === items.length ? "success" : "accent"} />
      <p className="text-[11px] text-muted-foreground">
        {done}/{items.length} done
      </p>
      {items.map(([k, label]) => (
        <label key={k} className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
          <Checkbox checked={values[k] === true} disabled={disabled} onCheckedChange={(v) => onToggle(k, v === true)} />
          {label}
        </label>
      ))}
    </div>
  );
}

function ReadinessCard({ pilot: p, locked }: { pilot: Pilot; locked: boolean }) {
  const update = useUpdatePilot();
  const toast = useSalesToast();
  return (
    <SectionCard title="Readiness checklist" description="Confirm before calling starts.">
      <Checklist
        items={[
          ["dataReady", "Lead data received and cleaned"],
          ["scriptApproved", "Script approved by the customer"],
          ["callerIdReady", "Caller ID / number ready"],
          ["testCallDone", "Test call done"],
          ["contactBasisConfirmed", "Contact basis confirmed"],
        ]}
        values={(p.readiness ?? {}) as Record<string, unknown>}
        disabled={locked || update.isPending}
        onToggle={(k, v) => update.mutate({ id: p.id, readiness: { [k]: v } }, { onError: (e) => toast.error(e) })}
      />
    </SectionCard>
  );
}

function QualityCard({ pilot: p }: { pilot: Pilot }) {
  const update = useUpdatePilot();
  const toast = useSalesToast();
  const [issues, setIssues] = useState(p.qualityReview?.issues ?? "");
  return (
    <SectionCard title="Quality check — first 5 answered calls" description="Listen to the first five answered calls before scaling up.">
      <Checklist
        items={[
          ["firstFiveAnsweredReviewed", "First 5 answered calls reviewed"],
          ["scriptAdherenceOk", "Agent followed the approved script"],
          ["outcomesTaggedCorrectly", "Outcomes tagged correctly"],
        ]}
        values={(p.qualityReview ?? {}) as Record<string, unknown>}
        disabled={update.isPending}
        onToggle={(k, v) => update.mutate({ id: p.id, qualityReview: { [k]: v } }, { onError: (e) => toast.error(e) })}
      />
      <Field label="Issues found" className="mt-3">
        <Textarea value={issues} onChange={(e) => setIssues(e.target.value)} rows={2} />
      </Field>
      <Button
        size="sm"
        variant="outline"
        className={cn(touch, "mt-2")}
        disabled={issues === (p.qualityReview?.issues ?? "") || update.isPending}
        onClick={() => update.mutate({ id: p.id, qualityReview: { issues: issues.trim() || null } }, { onSuccess: () => toast.success("Saved"), onError: (e) => toast.error(e) })}
      >
        Save issues
      </Button>
    </SectionCard>
  );
}

function ReviewForm({ pilot: p }: { pilot: Pilot }) {
  const update = useUpdatePilot();
  const toast = useSalesToast();
  const [f, setF] = useState({
    buyerFeedback: p.buyerFeedback ?? "",
    acceptedOutcomesNote: p.acceptedOutcomesNote ?? "",
    proposedNextStep: p.proposedNextStep ?? "",
    customerReportNotes: p.customerReportNotes ?? "",
    internalNotes: p.internalNotes ?? "",
    reportLink: p.reportLink ?? "",
  });
  const [links, setLinks] = useState(p.recordingLinks ?? []);
  const [newLink, setNewLink] = useState("");
  const t = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const n = (v: string) => v.trim() || null;
  return (
    <SectionCard title="Review & report" description="Customer-facing fields appear on the printable report. Internal notes never do.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Buyer feedback">
          <Textarea value={f.buyerFeedback} onChange={t("buyerFeedback")} rows={3} />
        </Field>
        <Field label="Accepted outcomes">
          <Textarea value={f.acceptedOutcomesNote} onChange={t("acceptedOutcomesNote")} rows={3} />
        </Field>
        <Field label="Proposed next step">
          <Textarea value={f.proposedNextStep} onChange={t("proposedNextStep")} rows={2} />
        </Field>
        <Field label="Notes for the customer report">
          <Textarea value={f.customerReportNotes} onChange={t("customerReportNotes")} rows={2} />
        </Field>
        <Field label="Internal notes (team only)" className="sm:col-span-2">
          <Textarea value={f.internalNotes} onChange={t("internalNotes")} rows={2} className="border-dashed" />
        </Field>
        <Field label="External report link" className="sm:col-span-2">
          <Input value={f.reportLink} onChange={t("reportLink")} className={touch} />
        </Field>
      </div>
      <div className="mt-3 space-y-2">
        <p className="text-sm font-medium">Recording links</p>
        <p className="text-[11px] text-muted-foreground">Only links marked "customer authorised" appear on the customer report.</p>
        {links.map((l, i) => (
          <div key={`${l.url}-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate hover:underline">
              {l.label || l.url}
            </a>
            <label className="flex min-h-11 items-center gap-1 md:min-h-0">
              <Checkbox checked={l.authorized} onCheckedChange={(v) => setLinks(links.map((x, j) => (j === i ? { ...x, authorized: v === true } : x)))} /> Customer authorised
            </label>
            <Button size="icon" variant="ghost" className="h-11 w-11 md:h-8 md:w-8" aria-label="Remove link" onClick={() => setLinks(links.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Input value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder="https://…" className={touch} />
          <Button
            variant="outline"
            className={touch}
            disabled={!/^https?:\/\//i.test(newLink.trim())}
            onClick={() => {
              setLinks([...links, { url: newLink.trim(), label: null, authorized: false }]);
              setNewLink("");
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {update.error && <p className="mt-2 text-sm text-red-500">{isSalesApiError(update.error) ? update.error.messages.join("; ") : update.error.message}</p>}
      <Button
        className={cn(touch, "mt-3")}
        disabled={update.isPending}
        onClick={() =>
          update.mutate(
            {
              id: p.id,
              buyerFeedback: n(f.buyerFeedback),
              acceptedOutcomesNote: n(f.acceptedOutcomesNote),
              proposedNextStep: n(f.proposedNextStep),
              customerReportNotes: n(f.customerReportNotes),
              internalNotes: n(f.internalNotes),
              reportLink: n(f.reportLink),
              recordingLinks: links.map((l) => ({ url: l.url, label: l.label ?? null, authorized: l.authorized })),
            },
            { onSuccess: () => toast.success("Review saved") },
          )
        }
      >
        {update.isPending ? "Saving…" : "Save review"}
      </Button>
    </SectionCard>
  );
}

function AllowanceCard({ pilot: p }: { pilot: Pilot }) {
  const { isFounder } = useSalesPrefs();
  const settings = useSalesSettings();
  const cfg = settings.data?.config.pilot;
  const extend = useExtendPilot();
  const toast = useSalesToast();
  const a = p.allowance;
  const [open, setOpen] = useState(false);
  const [attempts, setAttempts] = useState(String(cfg?.extensionMin ?? 100));
  const [reason, setReason] = useState("");
  const [cost, setCost] = useState("");
  const [reviewAt, setReviewAt] = useState(nowIstLocal(3 * 24 * 60));
  const min = cfg?.extensionMin ?? 100;
  const max = cfg?.extensionMax ?? 200;
  const n = Number(attempts);
  const active = p.status === "Setup" || p.status === "Calling" || p.status === "Review due";
  const costPaise = rupeesToPaise(cost);

  return (
    <SectionCard title="Attempt allowance">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-[11px] text-muted-foreground">Base allowance</dt>
          <dd className="tabular-nums">{formatCount(a.baseAllowance)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Extension</dt>
          <dd className="tabular-nums">{a.extensionAttempts ? `+${formatCount(a.extensionAttempts)}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Used</dt>
          <dd className="tabular-nums">{a.attemptsUsed == null ? "No data" : formatCount(a.attemptsUsed)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Remaining</dt>
          <dd className={cn("tabular-nums", a.overAllowance && "text-red-500")}>{a.overAllowance ? `Over by ${formatCount(a.overBy)}` : formatCount(a.remaining)}</dd>
        </div>
      </dl>
      <Meter className="mt-3" value={a.revisedAllowance ? Math.min(1, (a.attemptsUsed ?? 0) / a.revisedAllowance) : null} tone={a.overAllowance ? "danger" : "accent"} />
      <p className="mt-1 text-[11px] text-muted-foreground">{a.note}</p>

      {p.extensionAttempts != null ? (
        <div className="mt-4 rounded-md border border-border p-3 text-xs">
          <p className="font-medium">Extension approved (one per pilot)</p>
          <p>
            +{formatCount(p.extensionAttempts)} attempts · cost limit {formatPaise(p.extensionCostLimitPaise)} · review {formatDateTimeIST(p.extensionReviewAt)}
          </p>
          {p.extensionReason && <p className="text-muted-foreground">Reason: {p.extensionReason}</p>}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isFounder ? (
            <Button size="sm" variant="outline" className={touch} disabled={!active} onClick={() => setOpen(true)} title={active ? undefined : "Only active pilots can be extended"}>
              Approve extension
            </Button>
          ) : (
            <FounderOnlyNote>Extensions are approved by a founder</FounderOnlyNote>
          )}
          <span className="text-[11px] text-muted-foreground">
            One extension per pilot, {min}–{max} attempts, with a reason, cost limit and review date.
          </span>
        </div>
      )}

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Approve pilot extension"
        description={`This pilot can be extended once. Attempts must be between ${min} and ${max}.`}
        submitLabel="Approve extension"
        pending={extend.isPending}
        error={extend.error}
        disabled={!(n >= min && n <= max) || !reason.trim() || costPaise == null || !reviewAt}
        onSubmit={() =>
          extend.mutate(
            { id: p.id, attempts: n, reason: reason.trim(), costLimitPaise: costPaise ?? 0, reviewAt: istLocalToIso(reviewAt)! },
            {
              onSuccess: () => {
                toast.success("Extension approved");
                setOpen(false);
              },
            },
          )
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Extra attempts (${min}–${max})`} required>
            <Input value={attempts} onChange={(e) => setAttempts(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={touch} />
          </Field>
          <Field label="Cost limit" required>
            <MoneyInput value={cost} onChange={setCost} />
          </Field>
          <Field label="Extension review (IST)" required className="sm:col-span-2">
            <Input type="datetime-local" value={reviewAt} onChange={(e) => setReviewAt(e.target.value)} className={touch} />
          </Field>
        </div>
        <Field label="Reason" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </Field>
      </FormDialog>
    </SectionCard>
  );
}

const METRIC_FIELDS: Array<[string, string]> = [
  ["attempts", "Attempts"],
  ["distinctRecords", "Distinct records"],
  ["answered", "Answered"],
  ["meaningful", "Meaningful conversations"],
  ["qualifiedPeople", "Qualified people"],
  ["acceptedOutcomes", "Accepted outcomes"],
  ["callbackRequests", "Callback requests"],
  ["confirmedAppointments", "Confirmed appointments"],
];

const SNAPSHOT_CSV_FIELDS: CsvField[] = [
  { key: "asOf", label: "As of (date/time)", required: true, aliases: ["date", "as_of", "asof", "timestamp", "datetime", "snapshot date"] },
  { key: "snapshotKey", label: "Snapshot key", aliases: ["key", "id", "snapshot", "snapshot_id"] },
  { key: "attempts", label: "Attempts", required: true, aliases: ["calls", "dials", "total calls", "attempted"] },
  { key: "distinctRecords", label: "Distinct records", required: true, aliases: ["records", "unique records", "leads dialled", "distinct"] },
  { key: "answered", label: "Answered", required: true, aliases: ["connected", "answered calls"] },
  { key: "meaningful", label: "Meaningful", required: true, aliases: ["meaningful conversations", "conversations"] },
  { key: "qualifiedPeople", label: "Qualified people", required: true, aliases: ["qualified", "qualified leads"] },
  { key: "acceptedOutcomes", label: "Accepted outcomes", required: true, aliases: ["accepted", "outcomes"] },
  { key: "callbackRequests", label: "Callback requests", required: true, aliases: ["callbacks", "callback"] },
  { key: "confirmedAppointments", label: "Confirmed appointments", required: true, aliases: ["appointments", "booked"] },
  { key: "connectedMinutes", label: "Connected minutes", aliases: ["minutes", "talk minutes", "duration minutes"] },
  { key: "costRupees", label: "Cost (₹)", aliases: ["cost", "cost inr", "spend", "amount"] },
];

function SnapshotsCard({ data, locked }: { data: PilotDetail; locked: boolean }) {
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  return (
    <SectionCard
      title="Snapshot history"
      description="Cumulative numbers from the calling system. Re-sending the same snapshot key corrects it instead of duplicating."
      actions={
        !locked && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className={touch} onClick={() => setImporting(true)}>
              Import CSV
            </Button>
            <Button size="sm" className={touch} onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add snapshot
            </Button>
          </div>
        )
      }
    >
      {data.snapshots.length === 0 ? (
        <p className="text-xs text-muted-foreground">Insufficient data — no snapshots recorded yet.</p>
      ) : (
        <DataTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>As of</TableHead>
                <TableHead>Source</TableHead>
                {METRIC_FIELDS.map(([, label]) => (
                  <TableHead key={label} className="text-right">
                    {label}
                  </TableHead>
                ))}
                <TableHead className="text-right">Minutes</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...data.snapshots]
                .sort((a, b) => b.asOf.localeCompare(a.asOf))
                .map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDateTimeIST(s.asOf)}
                      {s.updatedAt !== s.createdAt && <Pill tone="muted" className="ml-1">corrected</Pill>}
                    </TableCell>
                    <TableCell className="text-xs">{s.source}</TableCell>
                    {METRIC_FIELDS.map(([k]) => (
                      <TableCell key={k} className="text-right text-xs tabular-nums">
                        {formatCount((s as unknown as Record<string, number>)[k])}
                      </TableCell>
                    ))}
                    <TableCell className="text-right text-xs tabular-nums">{formatCount(s.connectedMinutes)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatPaise(s.costPaise)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </DataTable>
      )}
      {adding && <SnapshotDialog pilotId={data.pilot.id} onClose={() => setAdding(false)} />}
      {importing && <SnapshotImportDialog pilotId={data.pilot.id} onClose={() => setImporting(false)} />}
    </SectionCard>
  );
}

function SnapshotDialog({ pilotId, onClose }: { pilotId: number; onClose: () => void }) {
  const add = useAddSnapshot();
  const toast = useSalesToast();
  const [asOf, setAsOf] = useState(nowIstLocal());
  const [vals, setVals] = useState<Record<string, string>>({});
  const [minutes, setMinutes] = useState("");
  const [cost, setCost] = useState("");
  const num = (v: string | undefined) => Number(v || 0);
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Add snapshot"
      description="Enter cumulative totals as of this moment."
      wide
      pending={add.isPending}
      error={add.error}
      onSubmit={() =>
        add.mutate(
          {
            id: pilotId,
            asOf: istLocalToIso(asOf),
            ...Object.fromEntries(METRIC_FIELDS.map(([k]) => [k, num(vals[k])])),
            connectedMinutes: num(minutes),
            costPaise: rupeesToPaise(cost) ?? 0,
          },
          {
            onSuccess: (res) => {
              toast.success(res.result === "created" ? "Snapshot added" : res.result === "corrected" ? "Snapshot corrected" : "No change");
              onClose();
            },
          },
        )
      }
    >
      <Field label="As of (IST)" required>
        <Input type="datetime-local" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={touch} />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {METRIC_FIELDS.map(([k, label]) => (
          <Field key={k} label={label}>
            <Input value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="0" className={touch} />
          </Field>
        ))}
        <Field label="Connected minutes">
          <Input value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="0" className={touch} />
        </Field>
        <Field label="Cost">
          <MoneyInput value={cost} onChange={setCost} placeholder="0" />
        </Field>
      </div>
    </FormDialog>
  );
}

function SnapshotImportDialog({ pilotId, onClose }: { pilotId: number; onClose: () => void }) {
  const imp = useImportSnapshots();
  const [result, setResult] = useState<SnapshotImportResult | null>(null);
  const [clientErrors, setClientErrors] = useState<string[]>([]);
  return (
    <FormDialog open onOpenChange={(v) => !v && onClose()} title="Import snapshots from CSV" wide onSubmit={onClose} submitLabel="Close" error={imp.error}>
      {result ? (
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <Check className="h-4 w-4 text-emerald-500" /> Imported {result.rows} rows
          </p>
          <p className="text-xs">
            {result.created} created · {result.corrected} corrected · {result.unchanged} unchanged · {result.rejected.length} rejected
          </p>
          {result.rejected.length > 0 && (
            <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs text-red-500">
              {result.rejected.map((r) => (
                <li key={r.row}>
                  Row {r.row}: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Dates without a timezone are read as IST (YYYY-MM-DD HH:mm or DD/MM/YYYY). Cost is in rupees. Numbers are cumulative totals.
          </p>
          <CsvMapper
            fields={SNAPSHOT_CSV_FIELDS}
            pending={imp.isPending}
            readyLabel="Import rows"
            onReady={({ filename, rows }) => {
              const errors: string[] = [];
              const out = rows.map((r, i) => {
                const asOf = cellToIsoDateTime(r.asOf);
                if (!asOf) errors.push(`Row ${i + 1}: can't read date "${r.asOf ?? ""}"`);
                const { asOf: _raw, costRupees, ...rest } = r;
                return { ...rest, asOf: asOf ?? r.asOf, ...(costRupees ? { costRupees } : {}) };
              });
              setClientErrors(errors.slice(0, 20));
              if (errors.length) return;
              imp.mutate({ id: pilotId, filename, rows: out }, { onSuccess: setResult });
            }}
          />
          {clientErrors.length > 0 && (
            <ul className="space-y-0.5 text-xs text-red-500">
              {clientErrors.map((e) => (
                <li key={e} className="flex items-center gap-1">
                  <Circle className="h-1.5 w-1.5 fill-current" /> {e}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </FormDialog>
  );
}
