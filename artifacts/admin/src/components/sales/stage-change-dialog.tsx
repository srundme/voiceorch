import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FormDialog } from "@/components/sales/form-dialog";
import { Field, SimpleSelect, StageBadge, touch, useSalesToast } from "@/components/sales/sales-ui";
import { useSalesPrefs } from "@/components/sales/sales-context";
import { useChangeStage } from "@/hooks/use-sales-api";
import { istLocalToIso, isoToIstLocal, nowIstLocal } from "@/lib/sales-format";
import { ALL_STAGES, BYPASSABLE_STAGES, ORDERED_STAGES, type Company, type Contact, type Opportunity, type Stage } from "@/lib/sales-types";

const REQUIREMENTS: Record<Stage, string> = {
  Identified: "No evidence required.",
  Qualified: "Buyer's need, monthly calling volume, budget fit (yes/no) and a decision maker.",
  "Demo booked": "A buyer contact at this company and the demo time.",
  "Demo completed": "A completed demo activity must already be logged (log it with the 'Demo given' flag).",
  "Pilot ready": "Data ready, script ready, calling-readiness confirmed and a booked review time.",
  "Pilot running": "A pilot in Setup, Calling or Review due must exist for this company.",
  "Results reviewed": "Buyer feedback, accepted outcomes and the next decision.",
  Proposal: "A proposal must exist (create it under Proposals).",
  Paid: "Accepted terms on a proposal and a verified first-month payment.",
  Live: "The actual production start (not in the future) and completed onboarding checks on the subscription.",
  Later: "A reason and a future date to revisit.",
  Lost: "A reason.",
};

const idx = (s: Stage | null) => (s ? (ORDERED_STAGES as readonly string[]).indexOf(s) : -1);

export function StageChangeDialog({
  open,
  onOpenChange,
  opportunity,
  company,
  contacts,
  initialTo,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  opportunity: Pick<Opportunity, "id" | "stage"> & Partial<Opportunity>;
  company?: Partial<Company> | null;
  contacts?: Contact[];
  initialTo?: Stage;
}) {
  const { isFounder } = useSalesPrefs();
  const toast = useSalesToast();
  const change = useChangeStage();
  const from = opportunity.stage;
  const nextDefault = (ORDERED_STAGES[idx(from) + 1] as Stage | undefined) ?? "Later";
  const [to, setTo] = useState<Stage>(initialTo ?? nextDefault);
  const q = opportunity.qualification ?? {};
  const r = opportunity.review ?? {};
  const pr = opportunity.pilotReadiness ?? {};
  const [ev, setEv] = useState({
    need: q.need ?? company?.painPoint ?? "",
    callingVolume: String(q.callingVolume ?? company?.callingVolume ?? ""),
    budgetFit: (q.budgetFit ?? (company?.budgetFit !== "unknown" ? company?.budgetFit : "")) || "",
    decisionMakerContactId: q.decisionMakerContactId ?? contacts?.find((c) => c.isDecisionMaker)?.id ?? null,
    decisionMaker: q.decisionMaker ?? company?.decisionMaker ?? "",
    demoBuyerContactId: opportunity.demoBuyerContactId ?? null,
    demoAt: opportunity.demoAt ? isoToIstLocal(opportunity.demoAt) : "",
    dataReady: pr.dataReady ?? false,
    scriptReady: pr.scriptReady ?? false,
    callingReadinessConfirmed: pr.callingReadinessConfirmed ?? false,
    reviewAt: pr.reviewAt ? isoToIstLocal(pr.reviewAt) : "",
    buyerFeedback: r.buyerFeedback ?? "",
    acceptedOutcomes: r.acceptedOutcomes ?? "",
    nextDecision: r.nextDecision ?? "",
    liveAt: nowIstLocal(),
    reason: "",
    actionAt: "",
  });
  const [note, setNote] = useState("");
  const [bypassReason, setBypassReason] = useState("");
  const set = <K extends keyof typeof ev>(k: K, v: (typeof ev)[K]) => setEv((p) => ({ ...p, [k]: v }));

  const side = to === "Later" || to === "Lost";
  const base = from === "Later" ? null : from;
  const backward = !side && base != null && idx(to) <= idx(base);
  const skipped = useMemo(() => (side || backward || base == null ? [] : (ORDERED_STAGES.slice(idx(base) + 1, idx(to)) as Stage[])), [side, backward, base, to]);
  const bypassAllowed = skipped.length > 0 && idx(to) <= idx("Proposal") && skipped.every((s) => BYPASSABLE_STAGES.includes(s));
  const contactOptions = (contacts ?? []).map((c) => ({ value: String(c.id), label: `${c.name || "Unnamed"}${c.role ? ` — ${c.role}` : ""}` }));

  const buildEvidence = () => {
    switch (to) {
      case "Qualified":
        return {
          qualification: {
            need: ev.need.trim() || null,
            callingVolume: ev.callingVolume ? Number(ev.callingVolume) : null,
            budgetFit: ev.budgetFit || null,
            decisionMakerContactId: ev.decisionMakerContactId,
            decisionMaker: ev.decisionMaker.trim() || null,
          },
        };
      case "Demo booked":
        return { ...(ev.demoBuyerContactId ? { demoBuyerContactId: ev.demoBuyerContactId } : {}), ...(ev.demoAt ? { demoAt: istLocalToIso(ev.demoAt) } : {}) };
      case "Pilot ready":
        return {
          pilotReadiness: { dataReady: ev.dataReady, scriptReady: ev.scriptReady, callingReadinessConfirmed: ev.callingReadinessConfirmed, reviewAt: istLocalToIso(ev.reviewAt) },
        };
      case "Results reviewed":
        return { review: { buyerFeedback: ev.buyerFeedback.trim() || null, acceptedOutcomes: ev.acceptedOutcomes.trim() || null, nextDecision: ev.nextDecision.trim() || null } };
      case "Live":
        return ev.liveAt ? { liveAt: istLocalToIso(ev.liveAt) } : {};
      case "Later":
        return { reason: ev.reason.trim() || undefined, ...(ev.actionAt ? { actionAt: istLocalToIso(ev.actionAt) } : {}) };
      case "Lost":
        return { reason: ev.reason.trim() || undefined };
      default:
        return {};
    }
  };

  const submit = () =>
    change.mutate(
      { id: opportunity.id, to, note: note.trim() || null, bypassReason: bypassReason.trim() || null, evidence: buildEvidence() },
      {
        onSuccess: (res) => {
          toast.success(`Moved to ${res.opportunity.stage}`, res.bypass ? `Bypassed: ${res.skipped.join(", ")}` : undefined);
          onOpenChange(false);
        },
      },
    );

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Change stage" onSubmit={submit} pending={change.isPending} error={change.error} submitLabel={`Move to ${to}`} disabled={to === from}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StageBadge stage={from} /> <span className="text-muted-foreground">→</span>
        <SimpleSelect value={to} onChange={(v) => v && setTo(v as Stage)} options={ALL_STAGES.filter((s) => s !== from)} className="w-48" />
      </div>
      <p className="rounded-md bg-muted/60 p-2 text-xs">
        <span className="font-medium">Required: </span>
        {REQUIREMENTS[to]}
      </p>

      {to === "Qualified" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Buyer's need" className="sm:col-span-2" required>
            <Textarea value={ev.need} onChange={(e) => set("need", e.target.value)} rows={2} />
          </Field>
          <Field label="Monthly calling volume" required>
            <Input value={ev.callingVolume} onChange={(e) => set("callingVolume", e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={touch} />
          </Field>
          <Field label="Budget fit" required>
            <SimpleSelect value={ev.budgetFit as "yes" | "no" | ""} onChange={(v) => set("budgetFit", v)} options={["yes", "no"]} placeholder="Choose" />
          </Field>
          <Field label="Decision maker (contact)">
            <SimpleSelect
              value={ev.decisionMakerContactId ? String(ev.decisionMakerContactId) : ""}
              onChange={(v) => set("decisionMakerContactId", v ? Number(v) : null)}
              options={contactOptions}
              placeholder="Choose contact"
              allowAll
              allLabel="None"
            />
          </Field>
          <Field label="…or decision maker name">
            <Input value={ev.decisionMaker} onChange={(e) => set("decisionMaker", e.target.value)} className={touch} />
          </Field>
        </div>
      )}
      {to === "Demo booked" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Buyer contact" required>
            <SimpleSelect value={ev.demoBuyerContactId ? String(ev.demoBuyerContactId) : ""} onChange={(v) => set("demoBuyerContactId", v ? Number(v) : null)} options={contactOptions} placeholder="Choose contact" />
          </Field>
          <Field label="Demo time (IST)" required>
            <Input type="datetime-local" value={ev.demoAt} onChange={(e) => set("demoAt", e.target.value)} className={touch} />
          </Field>
        </div>
      )}
      {to === "Pilot ready" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["dataReady", "Data ready"],
                ["scriptReady", "Script ready"],
                ["callingReadinessConfirmed", "Calling readiness confirmed"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
                <Checkbox checked={ev[k]} onCheckedChange={(v) => set(k, v === true)} /> {label}
              </label>
            ))}
          </div>
          <Field label="Review booked for (IST)" required>
            <Input type="datetime-local" value={ev.reviewAt} onChange={(e) => set("reviewAt", e.target.value)} className={touch} />
          </Field>
        </div>
      )}
      {to === "Results reviewed" && (
        <div className="space-y-3">
          <Field label="Buyer feedback" required>
            <Textarea value={ev.buyerFeedback} onChange={(e) => set("buyerFeedback", e.target.value)} rows={2} />
          </Field>
          <Field label="Accepted outcomes" required>
            <Textarea value={ev.acceptedOutcomes} onChange={(e) => set("acceptedOutcomes", e.target.value)} rows={2} />
          </Field>
          <Field label="Next decision" required>
            <Input value={ev.nextDecision} onChange={(e) => set("nextDecision", e.target.value)} className={touch} />
          </Field>
        </div>
      )}
      {to === "Live" && (
        <Field label="Actual production start (IST)" required hint="Cannot be in the future.">
          <Input type="datetime-local" value={ev.liveAt} onChange={(e) => set("liveAt", e.target.value)} className={touch} />
        </Field>
      )}
      {(to === "Later" || to === "Lost") && (
        <div className="space-y-3">
          <Field label="Reason" required>
            <Textarea value={ev.reason} onChange={(e) => set("reason", e.target.value)} rows={2} />
          </Field>
          {to === "Later" && (
            <Field label="Revisit on (IST)" required hint="Must be in the future; a follow-up task is created.">
              <Input type="datetime-local" value={ev.actionAt} onChange={(e) => set("actionAt", e.target.value)} className={touch} />
            </Field>
          )}
        </div>
      )}

      {skipped.length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p>
            This skips <strong>{skipped.join(", ")}</strong>. Stages normally move one at a time.
          </p>
          {isFounder ? (
            bypassAllowed ? (
              <Field label="Founder bypass reason" hint="Bypass can skip demo and pilot stages, up to Proposal. Recorded in the audit log.">
                <Textarea value={bypassReason} onChange={(e) => setBypassReason(e.target.value)} rows={2} />
              </Field>
            ) : (
              <p>Bypass can only skip demo and pilot stages and reach Proposal at most.</p>
            )
          ) : (
            <p>Only a founder can bypass stages.</p>
          )}
        </div>
      )}
      <Field label={backward ? "Note (required for moving backwards)" : "Note"} required={backward}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
    </FormDialog>
  );
}
