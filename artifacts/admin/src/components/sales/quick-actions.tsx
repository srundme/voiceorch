import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FormDialog } from "@/components/sales/form-dialog";
import { CompanyPicker, Field, OwnerSelect, SimpleSelect, touch, useSalesToast } from "@/components/sales/sales-ui";
import { useSalesPrefs } from "@/components/sales/sales-context";
import {
  useChangeStage,
  useCompany,
  useCreateActivity,
  useCreateCompany,
  useCreatePilot,
  useCreateTask,
  useSalesSettings,
} from "@/hooks/use-sales-api";
import { isSalesApiError } from "@/lib/sales-api";
import { istLocalToIso, nowIstLocal } from "@/lib/sales-format";
import { ACTIVITY_TYPES, TASK_KINDS, type ActivityType } from "@/lib/sales-types";

export type QuickActionKind = "company" | "visit" | "conversation" | "demo" | "pilot" | "task";
type Preset = { company?: { id: number; name: string } | null };

type Ctx = { open: (kind: QuickActionKind, preset?: Preset) => void };
const QuickActionsContext = createContext<Ctx | null>(null);

export function useQuickActions(): Ctx {
  const ctx = useContext(QuickActionsContext);
  if (!ctx) throw new Error("useQuickActions must be used inside QuickActionsProvider");
  return ctx;
}

export const QUICK_ACTIONS: Array<{ kind: QuickActionKind; label: string }> = [
  { kind: "company", label: "Add company" },
  { kind: "visit", label: "Log visit" },
  { kind: "conversation", label: "Log conversation" },
  { kind: "demo", label: "Schedule demo" },
  { kind: "pilot", label: "Start pilot" },
  { kind: "task", label: "Add follow-up" },
];

export function QuickActionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ kind: QuickActionKind; preset: Preset; nonce: number } | null>(null);
  const open = useCallback((kind: QuickActionKind, preset: Preset = {}) => setState({ kind, preset, nonce: Date.now() }), []);
  const close = (v: boolean) => {
    if (!v) setState(null);
  };
  const value = useMemo(() => ({ open }), [open]);
  const company = state?.preset.company ?? null;
  return (
    <QuickActionsContext.Provider value={value}>
      {children}
      {state?.kind === "company" && <AddCompanyDialog key={state.nonce} open onOpenChange={close} />}
      {(state?.kind === "visit" || state?.kind === "conversation") && (
        <LogActivityDialog key={state.nonce} open onOpenChange={close} mode={state.kind} initialCompany={company} />
      )}
      {state?.kind === "demo" && <ScheduleDemoDialog key={state.nonce} open onOpenChange={close} initialCompany={company} />}
      {state?.kind === "pilot" && <StartPilotDialog key={state.nonce} open onOpenChange={close} initialCompany={company} />}
      {state?.kind === "task" && <AddTaskDialog key={state.nonce} open onOpenChange={close} initialCompany={company} />}
    </QuickActionsContext.Provider>
  );
}

type DialogProps = { open: boolean; onOpenChange: (v: boolean) => void };
const blank = (s: string) => (s.trim() ? s.trim() : null);

function AddCompanyDialog({ open, onOpenChange }: DialogProps) {
  const { user, isFounder, demo } = useSalesPrefs();
  const settings = useSalesSettings();
  const config = settings.data?.config;
  const create = useCreateCompany();
  const toast = useSalesToast();
  const [, navigate] = useLocation();
  const [f, setF] = useState({
    name: "",
    sector: "",
    city: "",
    area: "",
    address: "",
    mapLink: "",
    website: "",
    source: "field_visit",
    sourceCampaign: "",
    priority: "medium",
    contactName: "",
    contactRole: "",
    phone: "",
    email: "",
    isDecisionMaker: false,
    nextAction: "",
    nextActionDueAt: "",
    enquiredAt: "",
    contactPermissionEvidence: "",
    internalNotes: "",
  });
  const [ownerId, setOwnerId] = useState<number | null | undefined>(undefined);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const inbound = f.source !== "" && f.source !== "field_visit";
  const cities = [...(config?.cities.field ?? []), ...(config?.cities.remote ?? [])];
  const dup = isSalesApiError(create.error) && create.error.status === 409 ? Number(create.error.body?.["existingCompanyId"]) || null : null;

  const submit = () => {
    const hasContact = f.contactName || f.phone || f.email;
    create.mutate(
      {
        name: f.name.trim(),
        sector: blank(f.sector),
        city: blank(f.city),
        area: blank(f.area),
        address: blank(f.address),
        mapLink: blank(f.mapLink),
        website: blank(f.website),
        source: blank(f.source),
        sourceCampaign: blank(f.sourceCampaign),
        priority: f.priority,
        nextAction: blank(f.nextAction),
        nextActionDueAt: istLocalToIso(f.nextActionDueAt),
        contactPermissionEvidence: blank(f.contactPermissionEvidence),
        internalNotes: blank(f.internalNotes),
        ...(inbound && f.enquiredAt ? { originalEnquiryAt: istLocalToIso(f.enquiredAt) } : {}),
        ...(ownerId !== undefined ? { ownerId } : {}),
        ...(demo ? { isDemo: true } : {}),
        contacts: hasContact
          ? [{ name: f.contactName.trim(), role: blank(f.contactRole), phone: blank(f.phone), email: blank(f.email), isDecisionMaker: f.isDecisionMaker }]
          : [],
      },
      {
        onSuccess: (res) => {
          toast.success(
            `${res.company.name} added`,
            res.dedupe.needsReview ? `Similar name to company #${res.dedupe.duplicateOfCompanyId} — flagged for dedupe review.` : undefined,
          );
          onOpenChange(false);
          navigate(`/sales/companies/${res.company.id}`);
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add company"
      description={demo ? "Demo mode is on — this company will be saved as demo data." : "Exact duplicates (website, phone, email) are blocked; similar names are flagged for review."}
      onSubmit={submit}
      pending={create.isPending}
      error={create.error}
      disabled={!f.name.trim()}
      submitLabel="Add company"
      wide
    >
      {dup && (
        <p className="text-sm">
          <Link href={`/sales/companies/${dup}`} className="font-medium text-[hsl(var(--sales-accent))] underline" onClick={() => onOpenChange(false)}>
            Open the existing company #{dup}
          </Link>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company name" required className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} className={touch} autoFocus />
        </Field>
        <Field label="Sector">
          <SimpleSelect value={f.sector} onChange={(v) => set("sector", v)} options={config?.sectors ?? []} placeholder="Choose sector" allowAll allLabel="—" />
        </Field>
        <Field label="Priority">
          <SimpleSelect value={f.priority} onChange={(v) => set("priority", v || "medium")} options={["high", "medium", "low"]} />
        </Field>
        <Field label="City">
          <SimpleSelect value={f.city} onChange={(v) => set("city", v)} options={cities} placeholder="Choose city" allowAll allLabel="—" />
        </Field>
        <Field label="Area / locality">
          <Input value={f.area} onChange={(e) => set("area", e.target.value)} className={touch} placeholder="e.g. Koramangala" />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input value={f.address} onChange={(e) => set("address", e.target.value)} className={touch} />
        </Field>
        <Field label="Source">
          <SimpleSelect value={f.source} onChange={(v) => set("source", v)} options={config?.sources ?? ["field_visit"]} />
        </Field>
        <Field label="Campaign">
          <Input value={f.sourceCampaign} onChange={(e) => set("sourceCampaign", e.target.value)} className={touch} />
        </Field>
        {inbound && (
          <>
            <Field label="Enquiry received (IST)" hint="Defaults to now. Drives the first-response timer.">
              <Input type="datetime-local" value={f.enquiredAt} onChange={(e) => set("enquiredAt", e.target.value)} className={touch} />
            </Field>
            <Field label="Contact permission evidence" hint="How they agreed to be contacted (form consent, etc.)">
              <Input value={f.contactPermissionEvidence} onChange={(e) => set("contactPermissionEvidence", e.target.value)} className={touch} />
            </Field>
          </>
        )}
        <Field label="Owner" hint={inbound ? "Leave unchanged to use the inbound owner rule." : "Defaults to you."}>
          {isFounder ? (
            <OwnerSelect value={ownerId === undefined ? (inbound ? null : user.id) : ownerId} onChange={setOwnerId} />
          ) : (
            <SimpleSelect
              value={ownerId === null ? "none" : ownerId === undefined ? "" : "me"}
              onChange={(v) => setOwnerId(v === "none" ? null : v === "me" ? user.id : undefined)}
              options={[
                { value: "me", label: "Me" },
                { value: "none", label: "Unassigned" },
              ]}
              placeholder="Default"
            />
          )}
        </Field>
        <Field label="Website">
          <Input value={f.website} onChange={(e) => set("website", e.target.value)} className={touch} inputMode="url" />
        </Field>
      </div>
      <fieldset className="space-y-3 rounded-md border border-border p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">First contact (optional)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={f.contactName} onChange={(e) => set("contactName", e.target.value)} className={touch} />
          </Field>
          <Field label="Role">
            <Input value={f.contactRole} onChange={(e) => set("contactRole", e.target.value)} className={touch} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={(e) => set("phone", e.target.value)} className={touch} inputMode="tel" />
          </Field>
          <Field label="Email">
            <Input value={f.email} onChange={(e) => set("email", e.target.value)} className={touch} inputMode="email" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={f.isDecisionMaker} onCheckedChange={(v) => set("isDecisionMaker", v === true)} /> Decision maker
        </label>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Next action">
          <Input value={f.nextAction} onChange={(e) => set("nextAction", e.target.value)} className={touch} placeholder="e.g. Revisit with demo" />
        </Field>
        <Field label="Next action due (IST)">
          <Input type="datetime-local" value={f.nextActionDueAt} onChange={(e) => set("nextActionDueAt", e.target.value)} className={touch} />
        </Field>
        <Field label="Internal notes" className="sm:col-span-2" hint="Internal only — never shown to the customer.">
          <Textarea value={f.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} rows={2} />
        </Field>
      </div>
    </FormDialog>
  );
}

function ContactSelect({ companyId, value, onChange, required }: { companyId: number | null; value: number | null; onChange: (id: number | null) => void; required?: boolean }) {
  const detail = useCompany(companyId);
  const contacts = detail.data?.contacts ?? [];
  if (!companyId) return <p className="text-xs text-muted-foreground">Choose a company first.</p>;
  if (detail.isLoading) return <p className="text-xs text-muted-foreground">Loading contacts…</p>;
  if (!contacts.length) return <p className="text-xs text-muted-foreground">No contacts yet — add one on the company page{required ? " (required)" : ""}.</p>;
  return (
    <SimpleSelect
      value={value == null ? "" : String(value)}
      onChange={(v) => onChange(v ? Number(v) : null)}
      options={contacts.map((c) => ({ value: String(c.id), label: `${c.name || "Unnamed"}${c.role ? ` — ${c.role}` : ""}${c.isDecisionMaker ? " (DM)" : ""}` }))}
      placeholder="Choose contact"
      allowAll={!required}
      allLabel="No specific contact"
    />
  );
}

function LogActivityDialog({ open, onOpenChange, mode, initialCompany }: DialogProps & { mode: "visit" | "conversation"; initialCompany: Preset["company"] }) {
  const create = useCreateActivity();
  const toast = useSalesToast();
  const [company, setCompany] = useState(initialCompany ?? null);
  const [contactId, setContactId] = useState<number | null>(null);
  const [type, setType] = useState<ActivityType>(mode === "visit" ? "visit" : "call");
  const [occurredAt, setOccurredAt] = useState(nowIstLocal());
  const [flags, setFlags] = useState({ visit: mode === "visit", buyerConversation: mode === "conversation", demo: false });
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextDue, setNextDue] = useState("");

  useEffect(() => setFlags((p) => ({ ...p, visit: type === "visit" ? true : p.visit, demo: type === "demo" ? true : p.demo })), [type]);

  const submit = () => {
    if (!company) return;
    create.mutate(
      {
        companyId: company.id,
        contactId,
        type,
        status: "completed",
        occurredAt: istLocalToIso(occurredAt) ?? undefined,
        flags,
        outcome: blank(outcome),
        notes: blank(notes),
        nextAction: blank(nextAction),
        nextActionDueAt: istLocalToIso(nextDue),
      },
      {
        onSuccess: (res) => {
          toast.success(
            mode === "visit" ? "Visit logged" : "Conversation logged",
            res.activity.flagVisit ? (res.activity.flagFirstVisit ? "Counted as a first visit." : "Counted as a revisit.") : undefined,
          );
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "visit" ? "Log visit" : "Log conversation"}
      description="Completed activity. Flags decide what counts toward today's targets."
      onSubmit={submit}
      pending={create.isPending}
      error={create.error}
      disabled={!company}
      submitLabel="Log"
    >
      <Field label="Company" required>
        <CompanyPicker value={company} onChange={(c) => { setCompany(c); setContactId(null); }} autoFocus={!company} />
      </Field>
      <Field label="Contact">
        <ContactSelect companyId={company?.id ?? null} value={contactId} onChange={setContactId} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <SimpleSelect value={type} onChange={(v) => setType((v || "visit") as ActivityType)} options={ACTIVITY_TYPES} />
        </Field>
        <Field label="When (IST)">
          <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className={touch} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4 rounded-md border border-border p-3">
        {(
          [
            ["visit", "In-person visit"],
            ["buyerConversation", "Buyer conversation"],
            ["demo", "Demo given"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
            <Checkbox checked={flags[k]} onCheckedChange={(v) => setFlags((p) => ({ ...p, [k]: v === true }))} /> {label}
          </label>
        ))}
      </div>
      <Field label="Outcome">
        <Input value={outcome} onChange={(e) => setOutcome(e.target.value)} className={touch} placeholder="e.g. Met owner, interested in pilot" />
      </Field>
      <Field label="Notes (internal)">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Next action">
          <Input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className={touch} />
        </Field>
        <Field label="Next action due (IST)">
          <Input type="datetime-local" value={nextDue} onChange={(e) => setNextDue(e.target.value)} className={touch} />
        </Field>
      </div>
    </FormDialog>
  );
}

function ScheduleDemoDialog({ open, onOpenChange, initialCompany }: DialogProps & { initialCompany: Preset["company"] }) {
  const create = useCreateActivity();
  const stage = useChangeStage();
  const toast = useSalesToast();
  const [company, setCompany] = useState(initialCompany ?? null);
  const detail = useCompany(company?.id);
  const [contactId, setContactId] = useState<number | null>(null);
  const [at, setAt] = useState(nowIstLocal(24 * 60));
  const [notes, setNotes] = useState("");
  const [moveStage, setMoveStage] = useState(true);
  const opp = detail.data?.opportunity;
  const canMove = opp?.stage === "Qualified";

  const submit = () => {
    if (!company || !contactId) return;
    const scheduledAt = istLocalToIso(at);
    create.mutate(
      { companyId: company.id, contactId, type: "demo", status: "scheduled", scheduledAt, notes: blank(notes) },
      {
        onSuccess: () => {
          if (canMove && moveStage && opp && scheduledAt) {
            stage.mutate(
              { id: opp.id, to: "Demo booked", evidence: { demoBuyerContactId: contactId, demoAt: scheduledAt } },
              {
                onSuccess: () => {
                  toast.success("Demo scheduled", "Opportunity moved to Demo booked.");
                  onOpenChange(false);
                },
                onError: (err) => {
                  toast.error(err, "Demo scheduled, but the stage did not change");
                  onOpenChange(false);
                },
              },
            );
          } else {
            toast.success("Demo scheduled");
            onOpenChange(false);
          }
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Schedule demo"
      onSubmit={submit}
      pending={create.isPending || stage.isPending}
      error={create.error}
      disabled={!company || !contactId || !at}
      submitLabel="Schedule"
    >
      <Field label="Company" required>
        <CompanyPicker value={company} onChange={(c) => { setCompany(c); setContactId(null); }} autoFocus={!company} />
      </Field>
      <Field label="Buyer contact" required hint="Demo booked requires a buyer contact at this company.">
        <ContactSelect companyId={company?.id ?? null} value={contactId} onChange={setContactId} required />
      </Field>
      <Field label="Demo time (IST)" required>
        <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={touch} />
      </Field>
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      {canMove && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={moveStage} onCheckedChange={(v) => setMoveStage(v === true)} /> Also move the opportunity from Qualified to Demo booked
        </label>
      )}
    </FormDialog>
  );
}

function StartPilotDialog({ open, onOpenChange, initialCompany }: DialogProps & { initialCompany: Preset["company"] }) {
  const create = useCreatePilot();
  const settings = useSalesSettings();
  const toast = useSalesToast();
  const [, navigate] = useLocation();
  const [company, setCompany] = useState(initialCompany ?? null);
  const [f, setF] = useState({ useCase: "", language: "", leadCount: "", qualificationCriteria: "", reviewAt: "", contactBasisConfirmed: false });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const allowance = settings.data?.config.pilot.attemptAllowance;

  const submit = () => {
    if (!company) return;
    create.mutate(
      {
        companyId: company.id,
        useCase: blank(f.useCase),
        language: blank(f.language),
        qualificationCriteria: blank(f.qualificationCriteria),
        leadCount: f.leadCount ? Number(f.leadCount) : null,
        reviewAt: istLocalToIso(f.reviewAt),
        contactBasisConfirmed: f.contactBasisConfirmed,
      },
      {
        onSuccess: (res) => {
          toast.success("Pilot created as Draft", "Complete the setup inputs, then move it to Setup.");
          onOpenChange(false);
          navigate(`/sales/pilots/${res.pilot.id}`);
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Start pilot"
      description={allowance ? `Creates a Draft pilot with the standard ${allowance}-attempt allowance.` : undefined}
      onSubmit={submit}
      pending={create.isPending}
      error={create.error}
      disabled={!company}
      submitLabel="Create pilot"
    >
      <Field label="Company" required>
        <CompanyPicker value={company} onChange={setCompany} autoFocus={!company} />
      </Field>
      <Field label="Use case">
        <Textarea value={f.useCase} onChange={(e) => set("useCase", e.target.value)} rows={2} placeholder="e.g. Re-engage dormant loan enquiries" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Calling language">
          <Input value={f.language} onChange={(e) => set("language", e.target.value)} className={touch} placeholder="e.g. Kannada + English" />
        </Field>
        <Field label="Lead count">
          <Input value={f.leadCount} onChange={(e) => set("leadCount", e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={touch} />
        </Field>
      </div>
      <Field label="Qualification criteria">
        <Textarea value={f.qualificationCriteria} onChange={(e) => set("qualificationCriteria", e.target.value)} rows={2} />
      </Field>
      <Field label="Review booked for (IST)">
        <Input type="datetime-local" value={f.reviewAt} onChange={(e) => set("reviewAt", e.target.value)} className={touch} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={f.contactBasisConfirmed} onCheckedChange={(v) => set("contactBasisConfirmed", v === true)} /> Contact basis for the leads confirmed
      </label>
    </FormDialog>
  );
}

function AddTaskDialog({ open, onOpenChange, initialCompany }: DialogProps & { initialCompany: Preset["company"] }) {
  const { user, isFounder } = useSalesPrefs();
  const create = useCreateTask();
  const toast = useSalesToast();
  const [company, setCompany] = useState(initialCompany ?? null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("follow_up");
  const [due, setDue] = useState(nowIstLocal(24 * 60));
  const [ownerId, setOwnerId] = useState<number | null>(user.id);

  const submit = () =>
    create.mutate(
      { title: title.trim(), kind, dueAt: istLocalToIso(due), companyId: company?.id ?? null, ownerId: isFounder ? ownerId : user.id },
      {
        onSuccess: () => {
          toast.success("Follow-up added");
          onOpenChange(false);
        },
      },
    );

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Add follow-up" onSubmit={submit} pending={create.isPending} error={create.error} disabled={!title.trim()} submitLabel="Add">
      <Field label="What needs to happen" required>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} className={touch} autoFocus />
      </Field>
      <Field label="Company">
        <CompanyPicker value={company} onChange={setCompany} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">
          <SimpleSelect value={kind} onChange={(v) => setKind(v || "follow_up")} options={TASK_KINDS} />
        </Field>
        <Field label="Due (IST)">
          <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={touch} />
        </Field>
      </div>
      {isFounder && (
        <Field label="Owner">
          <OwnerSelect value={ownerId} onChange={setOwnerId} />
        </Field>
      )}
    </FormDialog>
  );
}