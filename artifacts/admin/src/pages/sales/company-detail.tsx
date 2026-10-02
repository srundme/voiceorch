import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, ArrowRightLeft, CalendarPlus, ExternalLink, FlaskConical, ListTodo, MapPin, MessageSquare, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  ContactActions,
  DemoTag,
  EmptyBlock,
  ErrorBlock,
  Field,
  FounderOnlyNote,
  LoadingBlock,
  MapsAction,
  OwnerSelect,
  Pill,
  PilotStatusBadge,
  PriorityBadge,
  ReasonDialog,
  SectionCard,
  SimpleSelect,
  StageBadge,
  StatusBadge,
  touch,
  useSalesToast,
  useTeamNames,
} from "@/components/sales/sales-ui";
import { FormDialog } from "@/components/sales/form-dialog";
import { StageChangeDialog } from "@/components/sales/stage-change-dialog";
import { TaskActions } from "@/components/sales/task-actions";
import { useQuickActions } from "@/components/sales/quick-actions";
import { useSalesPrefs } from "@/components/sales/sales-context";
import { CreateSubscriptionDialog, PaymentsTable, ProposalList, RecordPaymentDialog, SubscriptionPanel } from "@/components/sales/billing";
import {
  useAddContact,
  useAssignOwner,
  useCancelActivity,
  useCompany,
  useCreateOpportunity,
  useDedupeReview,
  useDeleteContact,
  useSalesSettings,
  useUpdateActivity,
  useUpdateCompany,
  useUpdateContact,
} from "@/hooks/use-sales-api";
import { formatDateTimeIST, formatMinutes, formatRelative, humanize, istLocalToIso, isoToIstLocal, nowIstLocal } from "@/lib/sales-format";
import type { Activity, Company, CompanyDetail, Contact, StageHistory } from "@/lib/sales-types";

export default function CompanyDetailPage({ id }: { id: number }) {
  const detail = useCompany(id);
  if (detail.isLoading) return <LoadingBlock rows={8} />;
  if (detail.error) return <ErrorBlock error={detail.error} onRetry={() => detail.refetch()} />;
  if (!detail.data) return null;
  return <CompanyView data={detail.data} />;
}

function CompanyView({ data }: { data: CompanyDetail }) {
  const { company: c, opportunity: opp } = data;
  const { user, isFounder } = useSalesPrefs();
  const qa = useQuickActions();
  const toast = useSalesToast();
  const assign = useAssignOwner();
  const createOpp = useCreateOpportunity();
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const preset = { company: { id: c.id, name: c.name } };
  const overdue = c.nextActionDueAt != null && new Date(c.nextActionDueAt).getTime() < Date.now();
  const canMove = opp && opp.stage !== "Lost" && opp.stage !== "Live";
  const openTasks = data.tasks.filter((t) => t.status === "open");

  return (
    <div className="space-y-4">
      <Link href="/sales/pipeline" className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-foreground md:min-h-0">
        <ArrowLeft className="h-3.5 w-3.5" /> Pipeline
      </Link>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{c.name}</h1>
              <StageBadge stage={opp?.stage ?? null} />
              <PriorityBadge priority={c.priority} />
              {c.isDemo && <DemoTag />}
              {c.needsDedupeReview && <Pill tone="warning">Dedupe review</Pill>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {[c.sector, c.area, c.city].filter(Boolean).join(" · ") || "No location"}
              {c.website && (
                <>
                  {" · "}
                  <a href={/^https?:/i.test(c.website) ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:underline">
                    {c.website} <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Source: {c.source ?? "—"}
              {c.sourceCampaign ? ` (${c.sourceCampaign})` : ""}
              {c.originalSource && (c.originalSource !== c.source || c.originalSourceCampaign !== c.sourceCampaign) && ` · original: ${c.originalSource}${c.originalSourceCampaign ? ` (${c.originalSourceCampaign})` : ""}`}
              {c.originalEnquiryAt && ` · enquired ${formatDateTimeIST(c.originalEnquiryAt)}`}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Last activity: {c.lastActivityAt ? `${formatDateTimeIST(c.lastActivityAt)} (${formatRelative(c.lastActivityAt)})` : "none yet"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className={touch} onClick={() => setEditing(true)}>
              <Pencil className="mr-1.5 h-4 w-4" /> Edit
            </Button>
            {canMove ? (
              <Button size="sm" className={touch} onClick={() => setMoving(true)}>
                <ArrowRightLeft className="mr-1.5 h-4 w-4" /> Change stage
              </Button>
            ) : (
              !opp && (
                <Button size="sm" className={touch} disabled={createOpp.isPending} onClick={() => createOpp.mutate(c.id, { onSuccess: () => toast.success("Opportunity opened"), onError: (e) => toast.error(e) })}>
                  <Plus className="mr-1.5 h-4 w-4" /> Open opportunity
                </Button>
              )
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Owner">
            <OwnerSelect
              value={c.ownerId}
              onChange={(ownerId) => assign.mutate({ id: c.id, ownerId }, { onSuccess: () => toast.success("Owner updated"), onError: (e) => toast.error(e, "Could not reassign") })}
              disabled={assign.isPending || (!isFounder && c.ownerId != null && c.ownerId !== user.id)}
            />
          </Field>
          <div className={cn("rounded-md border p-2.5 text-sm sm:col-span-1 lg:col-span-2", overdue ? "border-red-500/40 bg-red-500/5" : "border-border")}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Next action</p>
            {c.nextAction ? (
              <>
                <p>{c.nextAction}</p>
                <p className={cn("text-xs", overdue ? "font-medium text-red-500" : "text-muted-foreground")}>
                  {overdue ? "Overdue · " : ""}
                  {c.nextActionDueAt ? `${formatDateTimeIST(c.nextActionDueAt)} (${formatRelative(c.nextActionDueAt)})` : "No due date"}
                </p>
              </>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">No next action set — add one so this company doesn't go cold.</p>
            )}
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          <Button size="sm" variant="secondary" className={cn(touch, "shrink-0")} onClick={() => qa.open("visit", preset)}>
            <MapPin className="mr-1.5 h-4 w-4" /> Log visit
          </Button>
          <Button size="sm" variant="secondary" className={cn(touch, "shrink-0")} onClick={() => qa.open("conversation", preset)}>
            <MessageSquare className="mr-1.5 h-4 w-4" /> Log conversation
          </Button>
          <Button size="sm" variant="secondary" className={cn(touch, "shrink-0")} onClick={() => qa.open("demo", preset)}>
            <CalendarPlus className="mr-1.5 h-4 w-4" /> Schedule demo
          </Button>
          <Button size="sm" variant="secondary" className={cn(touch, "shrink-0")} onClick={() => qa.open("task", preset)}>
            <ListTodo className="mr-1.5 h-4 w-4" /> Add task
          </Button>
          <Button size="sm" variant="secondary" className={cn(touch, "shrink-0")} onClick={() => qa.open("pilot", preset)}>
            <FlaskConical className="mr-1.5 h-4 w-4" /> Start pilot
          </Button>
          <MapsAction company={c} />
        </div>
      </div>

      {c.needsDedupeReview && <DedupeBanner data={data} />}
      {data.firstResponse && <FirstResponseCard fr={data.firstResponse} />}

      <Tabs defaultValue="overview">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity ({data.activities.length})</TabsTrigger>
            <TabsTrigger value="tasks">Tasks ({openTasks.length})</TabsTrigger>
            <TabsTrigger value="stages">Stage history</TabsTrigger>
            <TabsTrigger value="pilots">Pilots ({data.pilots.length})</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview" className="space-y-4">
          <ContactsCard company={c} contacts={data.contacts} />
          <QualificationCard data={data} />
          <DemosCard data={data} />
          <TouchpointsCard data={data} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivitiesCard activities={data.activities} contacts={data.contacts} />
        </TabsContent>
        <TabsContent value="tasks">
          <TasksCard data={data} />
        </TabsContent>
        <TabsContent value="stages">
          <StageHistoryCard data={data} />
        </TabsContent>
        <TabsContent value="pilots">
          <SectionCard
            title="Pilots"
            actions={
              <Button size="sm" variant="outline" className={touch} onClick={() => qa.open("pilot", preset)}>
                <Plus className="mr-1 h-4 w-4" /> Start pilot
              </Button>
            }
          >
            {data.pilots.length === 0 ? (
              <p className="text-xs text-muted-foreground">No pilots yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.pilots.map((p) => (
                  <li key={p.id}>
                    <Link href={`/sales/pilots/${p.id}`} className="flex min-h-11 items-center justify-between gap-2 py-2 hover:bg-muted/50">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">Pilot #{p.id}{p.useCase ? ` — ${p.useCase}` : ""}</span>
                        <span className="text-xs text-muted-foreground">
                          {p.allowance.attemptsUsed ?? 0}/{p.allowance.revisedAllowance} attempts · review {formatDateTimeIST(p.reviewAt)}
                        </span>
                      </span>
                      <PilotStatusBadge status={p.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>
        <TabsContent value="billing">
          <BillingTab data={data} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesCard company={c} />
        </TabsContent>
      </Tabs>

      {editing && <EditCompanyDialog company={c} onClose={() => setEditing(false)} />}
      {moving && opp && <StageChangeDialog open onOpenChange={setMoving} opportunity={opp} company={c} contacts={data.contacts} />}
    </div>
  );
}

function DedupeBanner({ data }: { data: CompanyDetail }) {
  const { company: c, duplicateOf } = data;
  const { user, isFounder } = useSalesPrefs();
  const toast = useSalesToast();
  const review = useDedupeReview();
  const [, navigate] = useLocation();
  const [merging, setMerging] = useState(false);
  const canKeep = isFounder || c.ownerId === user.id;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">
      <div className="min-w-0">
        <p className="font-medium">Possible duplicate</p>
        <p className="text-xs text-muted-foreground">
          The name is similar to{" "}
          {duplicateOf ? (
            <Link href={`/sales/companies/${duplicateOf.id}`} className="underline">
              {duplicateOf.name}
            </Link>
          ) : (
            "another company"
          )}{" "}
          but no phone, email or website matched. Keep both, or merge this lead into the other company.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className={touch}
          disabled={!canKeep || review.isPending}
          onClick={() => review.mutate({ id: c.id, action: "keep_separate" }, { onSuccess: () => toast.success("Kept as a separate company"), onError: (e) => toast.error(e) })}
        >
          Keep separate
        </Button>
        {isFounder ? (
          <Button size="sm" className={touch} disabled={!duplicateOf || review.isPending} onClick={() => setMerging(true)}>
            Merge into {duplicateOf?.name ?? "other company"}
          </Button>
        ) : (
          <FounderOnlyNote>Merging is founder only</FounderOnlyNote>
        )}
      </div>
      <ReasonDialog
        open={merging}
        onOpenChange={setMerging}
        title={`Merge ${c.name}?`}
        description={`Contacts, activities, tasks and touchpoints move to ${duplicateOf?.name ?? "the other company"} and this company is deleted. Leads with pilots, proposals, payments or a stage past Identified cannot be merged.`}
        required={false}
        confirmLabel="Merge"
        destructive
        pending={review.isPending}
        error={review.error}
        onConfirm={(reason) =>
          review.mutate(
            { id: c.id, action: "merge", targetCompanyId: duplicateOf?.id, reason: reason || null },
            {
              onSuccess: (res) => {
                toast.success("Companies merged");
                setMerging(false);
                navigate(`/sales/companies/${res.companyId}`);
              },
            },
          )
        }
      />
    </div>
  );
}

function DemosCard({ data }: { data: CompanyDetail }) {
  const names = useTeamNames();
  const demos = data.activities.filter((a) => a.type === "demo" || a.flagDemo);
  const buyer = (id: number | null) => data.contacts.find((ct) => ct.id === id)?.name ?? null;
  return (
    <SectionCard title={`Demos (${demos.length})`} description="Scheduled and completed demos, including those booked through the Demo booked stage.">
      {demos.length === 0 ? (
        <p className="text-xs text-muted-foreground">No demos yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {demos.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 text-sm">
                {formatDateTimeIST(a.scheduledAt ?? a.occurredAt)}
                <span className="text-xs text-muted-foreground">
                  {buyer(a.contactId) ? ` · with ${buyer(a.contactId)}` : ""} · {names(a.ownerId)}
                  {a.outcome ? ` · ${a.outcome}` : ""}
                </span>
              </span>
              <StatusBadge status={a.status} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

const TOUCHPOINT_LABELS: Record<string, string> = { original: "First enquiry", webhook: "Repeat enquiry (web form)", import: "Repeat enquiry (import)", manual: "Merged lead" };

function TouchpointsCard({ data }: { data: CompanyDetail }) {
  const items = data.touchpoints ?? [];
  return (
    <SectionCard title={`Touchpoints (${items.length})`} description="Every enquiry for this company. The first enquiry stays the original source.">
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No touchpoints recorded.</p>
      ) : (
        <ol className="space-y-2">
          {items.map((t) => (
            <li key={t.id} className="rounded-md border border-border p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{TOUCHPOINT_LABELS[t.kind] ?? humanize(t.kind)}</span>
                <span className="text-xs text-muted-foreground">{formatDateTimeIST(t.occurredAt)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {[t.source, t.campaign].filter(Boolean).join(" · ") || "No source"}
                {t.permissionEvidence ? ` · consent: ${t.permissionEvidence}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

function FirstResponseCard({ fr }: { fr: NonNullable<CompanyDetail["firstResponse"]> }) {
  const tone = fr.respondedAt ? (fr.withinTarget ? "success" : "warning") : fr.overdue ? "danger" : "accent";
  return (
    <SectionCard title="First response" description={fr.rule}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span>
          <span className="text-xs text-muted-foreground">Enquired </span>
          {formatDateTimeIST(fr.enquiredAt)}
        </span>
        <span>
          <span className="text-xs text-muted-foreground">Due </span>
          {formatDateTimeIST(fr.dueAt)}
        </span>
        {fr.respondedAt ? (
          <span>
            <span className="text-xs text-muted-foreground">Responded </span>
            {formatDateTimeIST(fr.respondedAt)} via {humanize(fr.responseType)} · {formatMinutes(fr.businessMinutes)} business time
          </span>
        ) : (
          <span>
            <span className="text-xs text-muted-foreground">Waiting </span>
            {formatMinutes(fr.elapsedBusinessMinutes)} business time
          </span>
        )}
        <Pill tone={tone}>{fr.respondedAt ? (fr.withinTarget ? `Within ${fr.targetMinutes} min` : "Missed target") : fr.overdue ? "Overdue" : "Awaiting response"}</Pill>
      </div>
    </SectionCard>
  );
}

function ContactDialog({ companyId, contact, onClose }: { companyId: number; contact?: Contact; onClose: () => void }) {
  const add = useAddContact();
  const update = useUpdateContact();
  const toast = useSalesToast();
  const [f, setF] = useState({
    name: contact?.name ?? "",
    role: contact?.role ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
    preferredChannel: (contact?.preferredChannel ?? "") as "" | "call" | "whatsapp" | "email" | "linkedin",
    isDecisionMaker: contact?.isDecisionMaker ?? false,
  });
  const mut = contact ? update : add;
  const body = {
    name: f.name.trim(),
    role: f.role.trim() || null,
    phone: f.phone.trim() || null,
    email: f.email.trim() || null,
    preferredChannel: f.preferredChannel || null,
    isDecisionMaker: f.isDecisionMaker,
  };
  const done = () => {
    toast.success(contact ? "Contact updated" : "Contact added");
    onClose();
  };
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={contact ? "Edit contact" : "Add contact"}
      pending={mut.isPending}
      error={mut.error}
      onSubmit={() => (contact ? update.mutate({ id: contact.id, ...body }, { onSuccess: done }) : add.mutate({ companyId, ...body }, { onSuccess: done }))}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={touch} />
        </Field>
        <Field label="Role">
          <Input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} className={touch} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" className={touch} />
        </Field>
        <Field label="Email">
          <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} inputMode="email" className={touch} />
        </Field>
        <Field label="Preferred channel">
          <SimpleSelect value={f.preferredChannel} onChange={(v) => setF({ ...f, preferredChannel: v })} options={["call", "whatsapp", "email", "linkedin"]} allowAll allLabel="No preference" />
        </Field>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm">
          <Checkbox checked={f.isDecisionMaker} onCheckedChange={(v) => setF({ ...f, isDecisionMaker: v === true })} /> Decision maker
        </label>
      </div>
    </FormDialog>
  );
}

function ContactsCard({ company, contacts }: { company: Company; contacts: Contact[] }) {
  const { user } = useSalesPrefs();
  const del = useDeleteContact();
  const toast = useSalesToast();
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  return (
    <SectionCard
      title="Contacts"
      actions={
        <Button size="sm" variant="outline" className={touch} onClick={() => setEditing("new")}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      }
    >
      {contacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No contacts yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {contacts.map((ct) => (
            <li key={ct.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                  {ct.name || "Unnamed"}
                  {ct.isDecisionMaker && <Pill tone="accent">Decision maker</Pill>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[ct.role, ct.phone, ct.email].filter(Boolean).join(" · ") || "No details"}
                  {ct.preferredChannel ? ` · prefers ${ct.preferredChannel}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <ContactActions phone={ct.phone} email={ct.email} contactName={ct.name} senderName={user.name} compact />
                <Button size="icon" variant="ghost" className="h-11 w-11 md:h-9 md:w-9" aria-label="Edit contact" onClick={() => setEditing(ct)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-11 w-11 md:h-9 md:w-9" aria-label="Delete contact" onClick={() => setDeleting(ct)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <ContactDialog companyId={company.id} contact={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <FormDialog
          open
          onOpenChange={(v) => !v && setDeleting(null)}
          title="Delete contact?"
          description={`${deleting.name || "This contact"} will be removed from ${company.name}.`}
          submitLabel="Delete"
          pending={del.isPending}
          error={del.error}
          onSubmit={() =>
            del.mutate(deleting.id, {
              onSuccess: () => {
                toast.success("Contact deleted");
                setDeleting(null);
              },
            })
          }
        >
          <p className="text-xs text-muted-foreground">Past activities keep their history.</p>
        </FormDialog>
      )}
    </SectionCard>
  );
}

function QualificationCard({ data }: { data: CompanyDetail }) {
  const c = data.company;
  const q = data.opportunity?.qualification;
  const dm = q?.decisionMakerContactId ? data.contacts.find((x) => x.id === q.decisionMakerContactId)?.name : null;
  const rows: Array<[string, string | number | null | undefined]> = [
    ["Need / pain point", q?.need ?? c.painPoint],
    ["Monthly calling volume", q?.callingVolume ?? c.callingVolume],
    ["Current calling team", c.currentCallingTeam],
    ["Budget fit", q?.budgetFit ?? c.budgetFit],
    ["Decision maker", dm ?? q?.decisionMaker ?? c.decisionMaker],
    ["Contact permission", c.contactPermissionEvidence],
    ["Address", c.address],
  ];
  return (
    <SectionCard title="Qualification">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</dt>
            <dd className="whitespace-pre-wrap">{v == null || v === "" ? "—" : String(v)}</dd>
          </div>
        ))}
        {data.opportunity?.laterReason && (
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Later</dt>
            <dd>
              {data.opportunity.laterReason} · revisit {formatDateTimeIST(data.opportunity.laterActionAt)}
            </dd>
          </div>
        )}
        {data.opportunity?.lostReason && (
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Lost reason</dt>
            <dd>{data.opportunity.lostReason}</dd>
          </div>
        )}
      </dl>
    </SectionCard>
  );
}

function ActivityFlags({ a }: { a: Activity }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {a.flagVisit && <Pill tone={a.flagFirstVisit ? "accent" : "neutral"}>{a.flagFirstVisit ? "First visit" : "Revisit"}</Pill>}
      {a.flagBuyerConversation && <Pill tone="neutral">Buyer conversation</Pill>}
      {a.flagDemo && <Pill tone="success">Demo given</Pill>}
      {a.flagPilotStarted && <Pill tone="success">Pilot started</Pill>}
    </span>
  );
}

function ActivitiesCard({ activities, contacts }: { activities: Activity[]; contacts: Contact[] }) {
  const names = useTeamNames();
  const update = useUpdateActivity();
  const cancel = useCancelActivity();
  const toast = useSalesToast();
  const [cancelling, setCancelling] = useState<Activity | null>(null);
  const contactName = (id: number | null) => (id ? contacts.find((c) => c.id === id)?.name : null);
  const markDone = (a: Activity) =>
    update.mutate(
      {
        id: a.id,
        status: "completed",
        occurredAt: new Date().toISOString(),
        flags: { visit: a.type === "visit", demo: a.type === "demo", buyerConversation: a.type === "demo" || a.type === "meeting" || a.flagBuyerConversation },
      },
      { onSuccess: () => toast.success("Marked done"), onError: (e) => toast.error(e) },
    );

  return (
    <SectionCard title="Activity log" description="Newest first. Scheduled items can be completed, marked no-show or cancelled.">
      {activities.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing logged yet.</p>
      ) : (
        <ol className="space-y-3">
          {activities.map((a) => (
            <li key={a.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {humanize(a.type)}
                    {contactName(a.contactId) && <span className="font-normal text-muted-foreground"> with {contactName(a.contactId)}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTimeIST(a.status === "scheduled" ? a.scheduledAt : a.occurredAt ?? a.scheduledAt)} · {names(a.ownerId)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <ActivityFlags a={a} />
                  <StatusBadge status={a.status} />
                </div>
              </div>
              {a.outcome && <p className="mt-1 text-sm">{a.outcome}</p>}
              {a.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{a.notes}</p>}
              {a.nextAction && (
                <p className="mt-1 text-xs">
                  Next: {a.nextAction}
                  {a.nextActionDueAt ? ` · ${formatDateTimeIST(a.nextActionDueAt)}` : ""}
                </p>
              )}
              {a.status === "scheduled" && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="sm" className="min-h-11 md:min-h-8" disabled={update.isPending} onClick={() => markDone(a)}>
                    Mark done
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 md:min-h-8"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ id: a.id, status: "no_show" }, { onSuccess: () => toast.success("Marked no-show"), onError: (e) => toast.error(e) })}
                  >
                    No-show
                  </Button>
                  <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" onClick={() => setCancelling(a)}>
                    Cancel {a.type === "demo" ? "demo" : ""}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      <ReasonDialog
        open={cancelling != null}
        onOpenChange={(v) => !v && setCancelling(null)}
        title={cancelling?.type === "demo" ? "Cancel demo" : "Cancel activity"}
        required={false}
        destructive
        confirmLabel="Cancel it"
        pending={cancel.isPending}
        error={cancel.error}
        onConfirm={(reason) => cancelling && cancel.mutate({ id: cancelling.id, reason: reason || null }, { onSuccess: () => setCancelling(null) })}
      />
    </SectionCard>
  );
}

function TasksCard({ data }: { data: CompanyDetail }) {
  const names = useTeamNames();
  const qa = useQuickActions();
  const open = data.tasks.filter((t) => t.status === "open");
  const closed = data.tasks.filter((t) => t.status !== "open");
  return (
    <SectionCard
      title="Tasks"
      actions={
        <Button size="sm" variant="outline" className={touch} onClick={() => qa.open("task", { company: { id: data.company.id, name: data.company.name } })}>
          <Plus className="mr-1 h-4 w-4" /> Add task
        </Button>
      }
    >
      {open.length === 0 && <p className="text-xs text-muted-foreground">No open tasks.</p>}
      <ul className="divide-y divide-border">
        {open.map((t) => {
          const overdue = t.dueAt != null && new Date(t.dueAt).getTime() < Date.now();
          return (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="text-sm">{t.title}</p>
                <p className={cn("text-xs", overdue ? "font-medium text-red-500" : "text-muted-foreground")}>
                  {humanize(t.kind)} · {t.dueAt ? formatDateTimeIST(t.dueAt) : "No due date"}
                  {overdue ? " · overdue" : ""} · {names(t.ownerId)}
                </p>
              </div>
              <TaskActions task={t} />
            </li>
          );
        })}
      </ul>
      {closed.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground">{closed.length} closed tasks</summary>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {closed.map((t) => (
              <li key={t.id}>
                <StatusBadge status={t.status} /> {t.title}
                {t.outcome ? ` — ${t.outcome}` : ""} · {formatDateTimeIST(t.completedAt)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </SectionCard>
  );
}

function evidenceSummary(h: StageHistory): string[] {
  const out: string[] = [];
  const ev = h.evidence ?? {};
  for (const [k, v] of Object.entries(ev)) {
    if (v == null || v === "") continue;
    if (typeof v === "object") {
      const inner = Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x != null && x !== "")
        .map(([ik, x]) => `${humanize(ik)}: ${typeof x === "string" && /^\d{4}-\d{2}-\d{2}T/.test(x) ? formatDateTimeIST(x) : String(x)}`);
      if (inner.length) out.push(`${humanize(k)} — ${inner.join(", ")}`);
    } else {
      out.push(`${humanize(k)}: ${typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? formatDateTimeIST(v) : String(v)}`);
    }
  }
  return out;
}

function StageHistoryCard({ data }: { data: CompanyDetail }) {
  const names = useTeamNames();
  const history = [...data.stageHistory].sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  const older = data.opportunities.filter((o) => o.id !== data.opportunity?.id);
  return (
    <SectionCard title="Stage history" description={data.opportunity ? `In ${data.opportunity.stage} since ${formatDateTimeIST(data.opportunity.stageChangedAt)}` : undefined}>
      {history.length === 0 ? (
        <p className="text-xs text-muted-foreground">No stage changes yet.</p>
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-4">
          {history.map((h) => (
            <li key={h.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-[hsl(var(--sales-accent))]" />
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                {h.fromStage && (
                  <>
                    <StageBadge stage={h.fromStage} /> →
                  </>
                )}
                <StageBadge stage={h.toStage} />
                {h.bypass && <Pill tone="warning">Founder bypass</Pill>}
              </div>
              <p className="text-xs text-muted-foreground">
                {formatDateTimeIST(h.changedAt)} · {names(h.changedBy)}
              </p>
              {h.note && <p className="mt-0.5 text-xs">Note: {h.note}</p>}
              {evidenceSummary(h).map((line) => (
                <p key={line} className="text-xs text-muted-foreground">
                  {line}
                </p>
              ))}
            </li>
          ))}
        </ol>
      )}
      {older.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Earlier opportunities: {older.map((o) => `#${o.id} (${o.stage}${o.closedAt ? `, closed ${formatDateTimeIST(o.closedAt)}` : ""})`).join(", ")}
        </p>
      )}
    </SectionCard>
  );
}

function BillingTab({ data }: { data: CompanyDetail }) {
  const c = data.company;
  const [paying, setPaying] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const { isFounder } = useSalesPrefs();
  return (
    <div className="space-y-4">
      <SectionCard title="Proposals">
        <ProposalList proposals={data.proposals} companyId={c.id} opportunityId={data.opportunity?.id} />
      </SectionCard>
      <SectionCard
        title="Payments"
        description={isFounder ? "Verify recorded payments once money is confirmed in the bank." : <FounderOnlyNote>Founders verify, reject and adjust payments</FounderOnlyNote>}
        actions={
          <Button size="sm" variant="outline" className={touch} onClick={() => setPaying(true)}>
            <Plus className="mr-1 h-4 w-4" /> Record payment
          </Button>
        }
      >
        <PaymentsTable payments={data.payments} />
      </SectionCard>
      <SectionCard
        title="Subscription"
        actions={
          !data.subscription && (
            <Button size="sm" variant="outline" className={touch} onClick={() => setSubscribing(true)}>
              <Plus className="mr-1 h-4 w-4" /> Create subscription
            </Button>
          )
        }
      >
        {data.subscription ? <SubscriptionPanel sub={data.subscription} /> : <p className="text-xs text-muted-foreground">No open subscription.</p>}
        {data.subscriptions.filter((s) => s.id !== data.subscription?.id).length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">Previous subscriptions</summary>
            <div className="mt-2 space-y-2">
              {data.subscriptions
                .filter((s) => s.id !== data.subscription?.id)
                .map((s) => (
                  <SubscriptionPanel key={s.id} sub={s} />
                ))}
            </div>
          </details>
        )}
      </SectionCard>
      {paying && <RecordPaymentDialog open onOpenChange={setPaying} company={{ id: c.id, name: c.name }} />}
      {subscribing && <CreateSubscriptionDialog open onOpenChange={setSubscribing} company={{ id: c.id, name: c.name }} />}
    </div>
  );
}

function NoteEditor({ label, description, value, onSave, pending }: { label: string; description: string; value: string | null; onSave: (v: string | null) => void; pending: boolean }) {
  const [draft, setDraft] = useState(value ?? "");
  const dirty = draft !== (value ?? "");
  return (
    <SectionCard title={label} description={description}>
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} />
      <div className="mt-2 flex justify-end">
        <Button size="sm" className={touch} disabled={!dirty || pending} onClick={() => onSave(draft.trim() || null)}>
          Save
        </Button>
      </div>
    </SectionCard>
  );
}

function NotesCard({ company }: { company: Company }) {
  const update = useUpdateCompany();
  const toast = useSalesToast();
  const save = (field: "internalNotes" | "customerNotes") => (v: string | null) =>
    update.mutate({ id: company.id, [field]: v }, { onSuccess: () => toast.success("Notes saved"), onError: (e) => toast.error(e) });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <NoteEditor label="Internal notes" description="Team only. Never shown on customer reports." value={company.internalNotes} onSave={save("internalNotes")} pending={update.isPending} />
      <NoteEditor label="Customer-facing notes" description="Safe to share with the customer." value={company.customerNotes} onSave={save("customerNotes")} pending={update.isPending} />
    </div>
  );
}

function EditCompanyDialog({ company: c, onClose }: { company: Company; onClose: () => void }) {
  const update = useUpdateCompany();
  const settings = useSalesSettings();
  const cfg = settings.data?.config;
  const toast = useSalesToast();
  const [f, setF] = useState({
    name: c.name,
    website: c.website ?? "",
    sector: c.sector ?? "",
    city: c.city ?? "",
    area: c.area ?? "",
    address: c.address ?? "",
    mapLink: c.mapLink ?? "",
    source: c.source ?? "",
    sourceCampaign: c.sourceCampaign ?? "",
    priority: c.priority,
    callingVolume: c.callingVolume == null ? "" : String(c.callingVolume),
    currentCallingTeam: c.currentCallingTeam ?? "",
    painPoint: c.painPoint ?? "",
    budgetFit: c.budgetFit,
    decisionMaker: c.decisionMaker ?? "",
    contactPermissionEvidence: c.contactPermissionEvidence ?? "",
    nextAction: c.nextAction ?? "",
    nextActionDueAt: c.nextActionDueAt ? isoToIstLocal(c.nextActionDueAt) : "",
  });
  const t = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const n = (v: string) => v.trim() || null;
  const cities = [...(cfg?.cities.field ?? []), ...(cfg?.cities.remote ?? [])];
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Edit company"
      wide
      pending={update.isPending}
      error={update.error}
      disabled={!f.name.trim()}
      onSubmit={() =>
        update.mutate(
          {
            id: c.id,
            name: f.name.trim(),
            website: n(f.website),
            sector: n(f.sector),
            city: n(f.city),
            area: n(f.area),
            address: n(f.address),
            mapLink: n(f.mapLink),
            source: n(f.source),
            sourceCampaign: n(f.sourceCampaign),
            priority: f.priority,
            callingVolume: f.callingVolume ? Number(f.callingVolume) : null,
            currentCallingTeam: n(f.currentCallingTeam),
            painPoint: n(f.painPoint),
            budgetFit: f.budgetFit,
            decisionMaker: n(f.decisionMaker),
            contactPermissionEvidence: n(f.contactPermissionEvidence),
            nextAction: n(f.nextAction),
            nextActionDueAt: f.nextActionDueAt ? istLocalToIso(f.nextActionDueAt) : null,
          },
          {
            onSuccess: () => {
              toast.success("Company updated");
              onClose();
            },
          },
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2">
          <Input value={f.name} onChange={t("name")} className={touch} />
        </Field>
        <Field label="Sector">
          <SimpleSelect value={f.sector} onChange={(v) => setF({ ...f, sector: v })} options={Array.from(new Set([...(cfg?.sectors ?? []), ...(f.sector ? [f.sector] : [])]))} allowAll allLabel="None" />
        </Field>
        <Field label="City">
          <SimpleSelect value={f.city} onChange={(v) => setF({ ...f, city: v })} options={Array.from(new Set([...cities, ...(f.city ? [f.city] : [])]))} allowAll allLabel="None" />
        </Field>
        <Field label="Area">
          <Input value={f.area} onChange={t("area")} className={touch} />
        </Field>
        <Field label="Website">
          <Input value={f.website} onChange={t("website")} className={touch} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input value={f.address} onChange={t("address")} className={touch} />
        </Field>
        <Field label="Google Maps link" className="sm:col-span-2">
          <Input value={f.mapLink} onChange={t("mapLink")} className={touch} />
        </Field>
        <Field label="Source">
          <SimpleSelect value={f.source} onChange={(v) => setF({ ...f, source: v })} options={Array.from(new Set([...(cfg?.sources ?? []), ...(f.source ? [f.source] : [])]))} allowAll allLabel="None" />
        </Field>
        <Field label="Campaign">
          <Input value={f.sourceCampaign} onChange={t("sourceCampaign")} className={touch} />
        </Field>
        <Field label="Priority">
          <SimpleSelect value={f.priority} onChange={(v) => v && setF({ ...f, priority: v })} options={["high", "medium", "low"]} />
        </Field>
        <Field label="Budget fit">
          <SimpleSelect value={f.budgetFit} onChange={(v) => v && setF({ ...f, budgetFit: v })} options={["yes", "no", "unknown"]} />
        </Field>
        <Field label="Monthly calling volume">
          <Input value={f.callingVolume} onChange={(e) => setF({ ...f, callingVolume: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={touch} />
        </Field>
        <Field label="Current calling team">
          <Input value={f.currentCallingTeam} onChange={t("currentCallingTeam")} className={touch} />
        </Field>
        <Field label="Decision maker">
          <Input value={f.decisionMaker} onChange={t("decisionMaker")} className={touch} />
        </Field>
        <Field label="Pain point" className="sm:col-span-2">
          <Textarea value={f.painPoint} onChange={t("painPoint")} rows={2} />
        </Field>
        <Field label="Contact permission evidence" className="sm:col-span-2">
          <Textarea value={f.contactPermissionEvidence} onChange={t("contactPermissionEvidence")} rows={2} />
        </Field>
        <Field label="Next action">
          <Input value={f.nextAction} onChange={t("nextAction")} className={touch} />
        </Field>
        <Field label="Due (IST)">
          <div className="flex gap-1">
            <Input type="datetime-local" value={f.nextActionDueAt} onChange={t("nextActionDueAt")} className={touch} />
            {!f.nextActionDueAt && (
              <Button type="button" variant="outline" className={touch} onClick={() => setF({ ...f, nextActionDueAt: nowIstLocal(24 * 60) })}>
                +1d
              </Button>
            )}
          </div>
        </Field>
      </div>
    </FormDialog>
  );
}
