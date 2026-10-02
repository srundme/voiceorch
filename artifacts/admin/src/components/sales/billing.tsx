import { useState } from "react";
import { Link } from "wouter";
import { Check, Pause, Play, Plus, Rocket, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormDialog } from "@/components/sales/form-dialog";
import {
  CompanyPicker,
  DataTable,
  DemoTag,
  EmptyBlock,
  Field,
  MoneyInput,
  OwnerSelect,
  Pill,
  ReasonDialog,
  SimpleSelect,
  StatusBadge,
  touch,
  useSalesToast,
  useTeamNames,
} from "@/components/sales/sales-ui";
import { useSalesPrefs } from "@/components/sales/sales-context";
import {
  useAcceptProposal,
  useAdjustPayment,
  useCreateProposal,
  useCreateSubscription,
  useDeclineProposal,
  useGoLive,
  useProposals,
  useRecordPayment,
  useRejectPayment,
  useSalesSettings,
  useSendProposal,
  useSubscriptions,
  useSubscriptionStatus,
  useUpdateProposal,
  useUpdateSubscription,
  useVerifyPayment,
} from "@/hooks/use-sales-api";
import { formatCount, formatDateOnly, formatDateTimeIST, formatPaise, humanize, istLocalToIso, nowIstLocal, paiseToRupeesInput, rupeesToPaise, todayIST } from "@/lib/sales-format";
import { PAYMENT_KINDS, type Payment, type Proposal, type Subscription } from "@/lib/sales-types";

/* ── Proposals ───────────────────────────────────────────────────────── */

export function ProposalDialog({
  open,
  onOpenChange,
  companyId,
  opportunityId,
  proposal,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: number;
  opportunityId?: number | null;
  proposal?: Proposal | null;
}) {
  const settings = useSalesSettings();
  const offer = settings.data?.config.offer;
  const create = useCreateProposal();
  const update = useUpdateProposal();
  const toast = useSalesToast();
  const [fee, setFee] = useState(paiseToRupeesInput(proposal?.monthlyFeePaise ?? offer?.monthlyFeePaise ?? 2_500_000));
  const [setup, setSetup] = useState(paiseToRupeesInput(proposal?.setupFeePaise ?? 0));
  const [minutes, setMinutes] = useState(String(proposal?.includedMinutes ?? offer?.includedMinutes ?? 5000));
  const [gst, setGst] = useState(String((proposal?.gstRateBps ?? offer?.gstRateBps ?? 1800) / 100));
  const [scope, setScope] = useState(proposal?.scope ?? "");
  const feePaise = rupeesToPaise(fee);
  const gstBps = Math.round(Number(gst || 0) * 100);
  const mut = proposal ? update : create;

  const submit = () => {
    const body = {
      monthlyFeePaise: feePaise ?? undefined,
      setupFeePaise: rupeesToPaise(setup) ?? 0,
      includedMinutes: Number(minutes || 0),
      gstRateBps: gstBps,
      scope: scope.trim() || null,
    };
    const done = () => {
      toast.success(proposal ? "Proposal updated" : "Proposal created");
      onOpenChange(false);
    };
    if (proposal) update.mutate({ id: proposal.id, ...body }, { onSuccess: done });
    else create.mutate({ companyId, opportunityId: opportunityId ?? null, ...body }, { onSuccess: done });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={proposal ? "Edit proposal" : "New proposal"}
      description="Amounts exclude GST; GST is calculated separately."
      onSubmit={submit}
      pending={mut.isPending}
      error={mut.error}
      disabled={feePaise == null}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Monthly fee (excl. GST)" required>
          <MoneyInput value={fee} onChange={setFee} />
        </Field>
        <Field label="Included minutes / month">
          <Input value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={touch} />
        </Field>
        <Field label="One-time setup fee (excl. GST)">
          <MoneyInput value={setup} onChange={setSetup} />
        </Field>
        <Field label="GST rate (%)">
          <Input value={gst} onChange={(e) => setGst(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className={touch} />
        </Field>
      </div>
      {feePaise != null && (
        <p className="rounded-md bg-muted/60 p-2 text-xs">
          Monthly: {formatPaise(feePaise)} + GST {formatPaise(Math.round((feePaise * gstBps) / 10000))} = <strong>{formatPaise(feePaise + Math.round((feePaise * gstBps) / 10000))}</strong>
        </p>
      )}
      <Field label="Scope">
        <Textarea value={scope} onChange={(e) => setScope(e.target.value)} rows={3} />
      </Field>
    </FormDialog>
  );
}

function ProposalActions({ p }: { p: Proposal }) {
  const send = useSendProposal();
  const accept = useAcceptProposal();
  const decline = useDeclineProposal();
  const toast = useSalesToast();
  const [editing, setEditing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [acceptedBy, setAcceptedBy] = useState("");
  const [acceptedAt, setAcceptedAt] = useState(nowIstLocal());
  const open = p.status === "draft" || p.status === "sent";
  if (!open) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" onClick={() => setEditing(true)}>
        Edit
      </Button>
      {p.status === "draft" && (
        <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={send.isPending} onClick={() => send.mutate(p.id, { onSuccess: () => toast.success("Marked sent"), onError: (e) => toast.error(e) })}>
          <Send className="mr-1 h-3.5 w-3.5" /> Mark sent
        </Button>
      )}
      <Button size="sm" className="min-h-11 md:min-h-8" onClick={() => setAccepting(true)}>
        <Check className="mr-1 h-3.5 w-3.5" /> Accepted
      </Button>
      <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" onClick={() => setDeclining(true)}>
        Declined
      </Button>
      {editing && <ProposalDialog open onOpenChange={setEditing} companyId={p.companyId} proposal={p} />}
      <FormDialog
        open={accepting}
        onOpenChange={setAccepting}
        title="Record accepted terms"
        description="Who accepted the terms on the customer side, and when."
        submitLabel="Mark accepted"
        pending={accept.isPending}
        error={accept.error}
        disabled={!acceptedBy.trim()}
        onSubmit={() =>
          accept.mutate(
            { id: p.id, acceptedBy: acceptedBy.trim(), acceptedAt: istLocalToIso(acceptedAt) ?? undefined },
            {
              onSuccess: () => {
                toast.success("Proposal accepted");
                setAccepting(false);
              },
            },
          )
        }
      >
        <Field label="Accepted by" required>
          <Input value={acceptedBy} onChange={(e) => setAcceptedBy(e.target.value)} placeholder="Name and role" className={touch} />
        </Field>
        <Field label="Accepted at (IST)">
          <Input type="datetime-local" value={acceptedAt} onChange={(e) => setAcceptedAt(e.target.value)} className={touch} />
        </Field>
      </FormDialog>
      <ReasonDialog
        open={declining}
        onOpenChange={setDeclining}
        title="Mark proposal declined"
        required={false}
        destructive
        confirmLabel="Mark declined"
        pending={decline.isPending}
        error={decline.error}
        onConfirm={(reason) => decline.mutate({ id: p.id, reason: reason || null }, { onSuccess: () => setDeclining(false) })}
      />
    </div>
  );
}

export function ProposalList({ proposals, companyId, opportunityId, canCreate = true }: { proposals: Proposal[]; companyId: number; opportunityId?: number | null; canCreate?: boolean }) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-2">
      {proposals.length === 0 && <p className="text-xs text-muted-foreground">No proposals yet. Default offer: ₹25,000/month + GST, 5,000 minutes.</p>}
      {proposals.map((p) => (
        <div key={p.id} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">
                {formatPaise(p.monthlyFeePaise)}/month <span className="font-normal text-muted-foreground">+ GST {formatPaise(p.amounts.monthlyTaxPaise)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {formatCount(p.includedMinutes)} minutes · first invoice {formatPaise(p.amounts.firstInvoiceTotalPaise)} incl. GST
                {p.setupFeePaise ? ` · setup ${formatPaise(p.setupFeePaise)}` : ""}
              </p>
            </div>
            <StatusBadge status={p.status} />
          </div>
          {p.scope && <p className="mt-1 whitespace-pre-wrap text-xs">{p.scope}</p>}
          <p className="mt-1 text-[11px] text-muted-foreground">
            Created {formatDateTimeIST(p.createdAt)}
            {p.sentAt ? ` · sent ${formatDateTimeIST(p.sentAt)}` : ""}
            {p.termsAcceptedAt ? ` · accepted by ${p.termsAcceptedBy ?? "—"} ${formatDateTimeIST(p.termsAcceptedAt)}` : ""}
            {p.declinedAt ? ` · declined ${formatDateTimeIST(p.declinedAt)}${p.declineReason ? ` (${p.declineReason})` : ""}` : ""}
          </p>
          <div className="mt-2">
            <ProposalActions p={p} />
          </div>
        </div>
      ))}
      {canCreate && (
        <Button size="sm" variant="outline" className={touch} onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-4 w-4" /> New proposal
        </Button>
      )}
      {creating && <ProposalDialog open onOpenChange={setCreating} companyId={companyId} opportunityId={opportunityId} />}
    </div>
  );
}

/* ── Payments ────────────────────────────────────────────────────────── */

export function RecordPaymentDialog({ open, onOpenChange, company }: { open: boolean; onOpenChange: (v: boolean) => void; company?: { id: number; name: string } | null }) {
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(company ?? null);
  const companyId = picked?.id ?? null;
  const proposals = useProposals(companyId);
  const subs = useSubscriptions(companyId ? { companyId } : {});
  const settings = useSalesSettings();
  const gstBps = settings.data?.config.offer.gstRateBps ?? 1800;
  const record = useRecordPayment();
  const toast = useSalesToast();
  const [kind, setKind] = useState<(typeof PAYMENT_KINDS)[number]>("first_month");
  const [fee, setFee] = useState("");
  const [tax, setTax] = useState("");
  const [taxTouched, setTaxTouched] = useState(false);
  const [proposalId, setProposalId] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState(nowIstLocal());
  const [notes, setNotes] = useState("");
  const feePaise = rupeesToPaise(fee);
  const autoTax = feePaise != null ? Math.round((feePaise * gstBps) / 10000) : null;
  const companySubs = (subs.data?.subscriptions ?? []).filter((s) => s.companyId === companyId);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record payment"
      description="Record money actually received. Partial payments are fine — record each one. A founder verifies before it counts."
      submitLabel="Record payment"
      pending={record.isPending}
      error={record.error}
      disabled={!companyId || feePaise == null || feePaise < 1}
      onSubmit={() =>
        record.mutate(
          {
            companyId,
            kind,
            feePaise,
            taxPaise: taxTouched ? rupeesToPaise(tax) ?? 0 : autoTax ?? 0,
            proposalId: proposalId ? Number(proposalId) : null,
            subscriptionId: subscriptionId ? Number(subscriptionId) : null,
            reference: reference.trim() || null,
            receivedAt: istLocalToIso(receivedAt),
            notes: notes.trim() || null,
          },
          {
            onSuccess: () => {
              toast.success("Payment recorded", "Awaiting founder verification.");
              onOpenChange(false);
            },
          },
        )
      }
    >
      {!company && (
        <Field label="Company" required>
          <CompanyPicker value={picked} onChange={setPicked} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind" required>
          <SimpleSelect value={kind} onChange={(v) => v && setKind(v)} options={PAYMENT_KINDS} />
        </Field>
        <Field label="Received at (IST)" required>
          <Input type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={touch} />
        </Field>
        <Field label="Fee received (excl. GST)" required>
          <MoneyInput value={fee} onChange={setFee} />
        </Field>
        <Field label="GST received" hint={taxTouched ? undefined : `Auto ${gstBps / 100}% — edit if different`}>
          <MoneyInput
            value={taxTouched ? tax : autoTax != null ? paiseToRupeesInput(autoTax) : ""}
            onChange={(v) => {
              setTaxTouched(true);
              setTax(v);
            }}
          />
        </Field>
        {companyId && (
          <>
            <Field label="Proposal">
              <SimpleSelect
                value={proposalId}
                onChange={setProposalId}
                options={(proposals.data?.proposals ?? []).map((p) => ({ value: String(p.id), label: `#${p.id} · ${formatPaise(p.monthlyFeePaise)} · ${p.status}` }))}
                allowAll
                allLabel="None"
                placeholder="None"
              />
            </Field>
            <Field label="Subscription" hint={kind === "renewal" ? "Required for renewals" : undefined}>
              <SimpleSelect
                value={subscriptionId}
                onChange={setSubscriptionId}
                options={companySubs.map((s) => ({ value: String(s.id), label: `#${s.id} · ${s.status} · ${formatPaise(s.monthlyFeePaise)}` }))}
                allowAll
                allLabel="None"
                placeholder="None"
              />
            </Field>
          </>
        )}
        <Field label="Reference (UTR / cheque no.)">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} className={touch} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
    </FormDialog>
  );
}

function AdjustDialog({ payment, open, onOpenChange }: { payment: Payment; open: boolean; onOpenChange: (v: boolean) => void }) {
  const adjust = useAdjustPayment();
  const toast = useSalesToast();
  const [kind, setKind] = useState<"correction" | "refund">("refund");
  const [fee, setFee] = useState("");
  const [tax, setTax] = useState("");
  const [reason, setReason] = useState("");
  const parse = (v: string) => {
    const neg = v.trim().startsWith("-");
    const p = rupeesToPaise(v.replace("-", ""));
    return p == null ? 0 : neg ? -p : p;
  };
  const feeDelta = kind === "refund" ? -Math.abs(parse(fee)) : parse(fee);
  const taxDelta = kind === "refund" ? -Math.abs(parse(tax)) : parse(tax);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Adjust payment"
      description={`Net now: fee ${formatPaise(payment.netFeePaise)}, GST ${formatPaise(payment.netTaxPaise)}. The original record is kept; adjustments are added on top.`}
      submitLabel="Add adjustment"
      pending={adjust.isPending}
      error={adjust.error}
      disabled={!reason.trim() || (feeDelta === 0 && taxDelta === 0)}
      onSubmit={() =>
        adjust.mutate(
          { id: payment.id, kind, feeDeltaPaise: feeDelta, taxDeltaPaise: taxDelta, reason: reason.trim() },
          {
            onSuccess: () => {
              toast.success("Adjustment recorded");
              onOpenChange(false);
            },
          },
        )
      }
    >
      <Field label="Type">
        <SimpleSelect value={kind} onChange={(v) => v && setKind(v)} options={["refund", "correction"]} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={kind === "refund" ? "Fee refunded" : "Fee change (use - to reduce)"}>
          <Input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" placeholder="0" className={touch} />
        </Field>
        <Field label={kind === "refund" ? "GST refunded" : "GST change (use - to reduce)"}>
          <Input value={tax} onChange={(e) => setTax(e.target.value)} inputMode="decimal" placeholder="0" className={touch} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Change: fee {formatPaise(feeDelta)}, GST {formatPaise(taxDelta)}
      </p>
      <Field label="Reason" required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      </Field>
    </FormDialog>
  );
}

function PaymentActions({ p }: { p: Payment }) {
  const { isFounder } = useSalesPrefs();
  const verify = useVerifyPayment();
  const reject = useRejectPayment();
  const toast = useSalesToast();
  const [rejecting, setRejecting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  if (!isFounder) return p.status === "recorded" ? <span className="text-[11px] text-muted-foreground">Awaiting founder</span> : null;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {p.status === "recorded" && (
        <Button size="sm" className="min-h-11 md:min-h-8" disabled={verify.isPending} onClick={() => verify.mutate(p.id, { onSuccess: () => toast.success("Payment verified"), onError: (e) => toast.error(e) })}>
          Verify
        </Button>
      )}
      {p.status !== "rejected" && (
        <>
          <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" onClick={() => setAdjusting(true)}>
            Adjust
          </Button>
          {!(p.status === "verified" && p.kind === "renewal") && (
            <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" onClick={() => setRejecting(true)}>
              Reject
            </Button>
          )}
        </>
      )}
      {adjusting && <AdjustDialog payment={p} open onOpenChange={setAdjusting} />}
      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title="Reject payment"
        description="Rejected payments don't count towards cash or paid status."
        destructive
        confirmLabel="Reject"
        pending={reject.isPending}
        error={reject.error}
        onConfirm={(reason) => reject.mutate({ id: p.id, reason }, { onSuccess: () => setRejecting(false) })}
      />
    </div>
  );
}

export function PaymentsTable({ payments, companyName }: { payments: Payment[]; companyName?: (id: number) => string | undefined }) {
  const names = useTeamNames();
  if (payments.length === 0) return <EmptyBlock title="No payments" description="Record payments as they arrive; founders verify them." />;
  return (
    <DataTable>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Received</TableHead>
            {companyName && <TableHead>Company</TableHead>}
            <TableHead>Kind</TableHead>
            <TableHead className="text-right">Fee</TableHead>
            <TableHead className="text-right">GST</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="whitespace-nowrap text-xs">
                {formatDateTimeIST(p.receivedAt)}
                {p.reference && <div className="text-[11px] text-muted-foreground">Ref {p.reference}</div>}
              </TableCell>
              {companyName && (
                <TableCell className="text-xs">
                  <Link href={`/sales/companies/${p.companyId}`} className="hover:underline">
                    {companyName(p.companyId) ?? `Company #${p.companyId}`}
                  </Link>
                  {p.isDemo && <DemoTag />}
                </TableCell>
              )}
              <TableCell className="text-xs">{humanize(p.kind)}</TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {formatPaise(p.netFeePaise)}
                {p.netFeePaise !== p.feePaise && <div className="text-[11px] text-muted-foreground line-through">{formatPaise(p.feePaise)}</div>}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">{formatPaise(p.netTaxPaise)}</TableCell>
              <TableCell>
                <StatusBadge status={p.status} />
                {p.status === "verified" && p.verifiedBy != null && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    by {names(p.verifiedBy)}
                    {p.verifiedAt ? ` · ${formatDateTimeIST(p.verifiedAt)}` : ""}
                  </div>
                )}
                {p.adjustments.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                    {p.adjustments.map((a) => (
                      <li key={a.id}>
                        {humanize(a.kind)} {formatPaise(a.feeDeltaPaise)} / GST {formatPaise(a.taxDeltaPaise)} — {a.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </TableCell>
              <TableCell className="text-right">
                <PaymentActions p={p} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTable>
  );
}

/* ── Subscriptions ───────────────────────────────────────────────────── */

export const DEFAULT_ONBOARDING_CHECKS = ["numberConnected", "scriptLive", "reportingShared"];

export function CreateSubscriptionDialog({ open, onOpenChange, company }: { open: boolean; onOpenChange: (v: boolean) => void; company?: { id: number; name: string } | null }) {
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(company ?? null);
  const proposals = useProposals(picked?.id);
  const create = useCreateSubscription();
  const toast = useSalesToast();
  const accepted = (proposals.data?.proposals ?? []).find((p) => p.status === "accepted");
  const [startDate, setStartDate] = useState("");
  const [ownerId, setOwnerId] = useState<number | null>(null);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create subscription"
      description="Fee and minutes come from the accepted proposal (or the default offer). The renewal date is one month after the start date."
      submitLabel="Create"
      pending={create.isPending}
      error={create.error}
      disabled={!picked}
      onSubmit={() =>
        create.mutate(
          {
            companyId: picked!.id,
            proposalId: accepted?.id ?? null,
            startDate: startDate || null,
            customerOwnerId: ownerId,
            onboardingChecks: Object.fromEntries(DEFAULT_ONBOARDING_CHECKS.map((k) => [k, false])),
          },
          {
            onSuccess: () => {
              toast.success("Subscription created");
              onOpenChange(false);
            },
          },
        )
      }
    >
      {!company && (
        <Field label="Company" required>
          <CompanyPicker value={picked} onChange={setPicked} />
        </Field>
      )}
      {picked && (
        <p className="rounded-md bg-muted/60 p-2 text-xs">
          {accepted ? `Uses accepted proposal #${accepted.id}: ${formatPaise(accepted.monthlyFeePaise)}/month + GST, ${formatCount(accepted.includedMinutes)} minutes.` : "No accepted proposal — the default offer will be used."}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Planned start date">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={touch} />
        </Field>
        <Field label="Customer owner" hint="Defaults to the company owner">
          <OwnerSelect value={ownerId} onChange={setOwnerId} placeholder="Company owner" />
        </Field>
      </div>
    </FormDialog>
  );
}

export function SubscriptionPanel({ sub, companyName }: { sub: Subscription; companyName?: string }) {
  const names = useTeamNames();
  const update = useUpdateSubscription();
  const live = useGoLive();
  const status = useSubscriptionStatus();
  const toast = useSalesToast();
  const [cancelling, setCancelling] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const [liveAt, setLiveAt] = useState(nowIstLocal());
  const [startDate, setStartDate] = useState(sub.startDate ?? todayIST());
  const [newCheck, setNewCheck] = useState("");
  const checks = { ...Object.fromEntries(DEFAULT_ONBOARDING_CHECKS.map((k) => [k, false])), ...(sub.onboardingChecks ?? {}) };
  const editable = sub.status !== "cancelled";
  const allDone = Object.values(checks).every(Boolean);

  const setCheck = (key: string, value: boolean) =>
    update.mutate({ id: sub.id, onboardingChecks: { [key]: value } }, { onError: (e) => toast.error(e, "Could not update check") });

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {companyName && (
            <Link href={`/sales/companies/${sub.companyId}`} className="text-sm font-medium hover:underline">
              {companyName}
            </Link>
          )}
          <p className="text-sm">
            {formatPaise(sub.monthlyFeePaise)}/month <span className="text-muted-foreground">· {formatCount(sub.includedMinutes)} min</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Start {formatDateOnly(sub.startDate)} · renews {formatDateOnly(sub.renewalDate)} · owner {names(sub.customerOwnerId)}
          </p>
          {sub.liveAt && <p className="text-xs text-muted-foreground">Live since {formatDateTimeIST(sub.liveAt)}</p>}
          {sub.cancelReason && <p className="text-xs text-muted-foreground">Cancelled: {sub.cancelReason}</p>}
        </div>
        <div className="flex items-center gap-1">
          {sub.isDemo && <DemoTag />}
          {sub.liveAt && sub.status === "active" ? <Pill tone="success">Live</Pill> : <StatusBadge status={sub.status} />}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium">Onboarding checks</p>
        <div className="grid gap-1 sm:grid-cols-2">
          {Object.entries(checks).map(([k, v]) => (
            <label key={k} className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
              <Checkbox checked={v} disabled={!editable || update.isPending} onCheckedChange={(c) => setCheck(k, c === true)} /> {humanize(k)}
            </label>
          ))}
        </div>
        {editable && (
          <form
            className="mt-1 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const key = newCheck.trim().replace(/\s+(\w)/g, (_, c: string) => c.toUpperCase());
              if (key) setCheck(key, false);
              setNewCheck("");
            }}
          >
            <Input value={newCheck} onChange={(e) => setNewCheck(e.target.value)} placeholder="Add a check" className="h-11 md:h-8" />
            <Button type="submit" size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={!newCheck.trim()}>
              Add
            </Button>
          </form>
        )}
      </div>

      {editable && (
        <div className="flex flex-wrap gap-1.5">
          {!sub.liveAt && sub.status === "active" && (
            <Button size="sm" className="min-h-11 md:min-h-8" onClick={() => setGoingLive(true)} disabled={!allDone} title={allDone ? undefined : "Complete onboarding checks first"}>
              <Rocket className="mr-1 h-3.5 w-3.5" /> Mark live
            </Button>
          )}
          {sub.status === "active" && (
            <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={status.isPending} onClick={() => status.mutate({ id: sub.id, action: "pause" }, { onError: (e) => toast.error(e) })}>
              <Pause className="mr-1 h-3.5 w-3.5" /> Pause
            </Button>
          )}
          {sub.status === "paused" && (
            <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={status.isPending} onClick={() => status.mutate({ id: sub.id, action: "resume" }, { onError: (e) => toast.error(e) })}>
              <Play className="mr-1 h-3.5 w-3.5" /> Resume
            </Button>
          )}
          <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" onClick={() => setCancelling(true)}>
            <X className="mr-1 h-3.5 w-3.5" /> Cancel
          </Button>
          <OwnerSelect
            value={sub.customerOwnerId}
            onChange={(id) => update.mutate({ id: sub.id, customerOwnerId: id }, { onSuccess: () => toast.success("Customer owner updated"), onError: (e) => toast.error(e) })}
            allowUnassigned={false}
            className="h-11 w-44 md:h-8"
          />
        </div>
      )}

      <FormDialog
        open={goingLive}
        onOpenChange={setGoingLive}
        title="Mark subscription live"
        description="Record when production actually started. It cannot be in the future."
        submitLabel="Mark live"
        pending={live.isPending}
        error={live.error}
        onSubmit={() =>
          live.mutate(
            { id: sub.id, startDate: sub.startDate ? undefined : startDate, liveAt: istLocalToIso(liveAt) ?? undefined },
            {
              onSuccess: () => {
                toast.success("Subscription is live");
                setGoingLive(false);
              },
            },
          )
        }
      >
        {!sub.startDate && (
          <Field label="Production start date" required>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={touch} />
          </Field>
        )}
        <Field label="Live at (IST)" required>
          <Input type="datetime-local" value={liveAt} onChange={(e) => setLiveAt(e.target.value)} className={touch} />
        </Field>
      </FormDialog>
      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel subscription"
        description="Open onboarding and renewal tasks for this subscription are cancelled too."
        destructive
        confirmLabel="Cancel subscription"
        pending={status.isPending}
        error={status.error}
        onConfirm={(reason) => status.mutate({ id: sub.id, action: "cancel", reason }, { onSuccess: () => setCancelling(false) })}
      />
    </div>
  );
}
