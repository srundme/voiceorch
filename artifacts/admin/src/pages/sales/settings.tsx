import { useState } from "react";
import { Link } from "wouter";
import { Database, Pencil, ShieldAlert, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  CopyField,
  DataTable,
  EmptyBlock,
  ErrorBlock,
  Field,
  FounderOnlyNote,
  LoadingBlock,
  MoneyInput,
  OwnerSelect,
  Pill,
  ReasonDialog,
  SalesPageHeader,
  SectionCard,
  ServerErrors,
  SimpleSelect,
  StatusBadge,
  touch,
  useSalesToast,
} from "@/components/sales/sales-ui";
import { FormDialog } from "@/components/sales/form-dialog";
import { CsvMapper, type CsvField } from "@/components/sales/csv-mapper";
import { useSalesPrefs } from "@/components/sales/sales-context";
import {
  useClearDemo,
  useDemoStatus,
  useInviteUser,
  useLeadImportCommit,
  useLeadImportPreview,
  useGenerateTargets,
  usePatchTarget,
  usePutSettings,
  useRevokeInvite,
  useSalesSettings,
  useSalesUsers,
  useSeedDemo,
  useTargets,
  useUpdateUser,
} from "@/hooks/use-sales-api";
import { adminAppUrl } from "@/lib/sales-api";
import { cellToIsoDateTime, formatDateOnly, formatDateTimeIST, formatRelative, humanize, paiseToRupeesInput, rupeesToPaise } from "@/lib/sales-format";
import type { InviteResult, LeadCommit, LeadPreview, SalesConfig, SalesUserFull, Target } from "@/lib/sales-types";

export default function SettingsPage() {
  const { isFounder } = useSalesPrefs();
  return (
    <div className="space-y-4">
      <SalesPageHeader title="Settings" subtitle={isFounder ? "Team, configuration, targets, imports and demo data." : "Configuration and targets are read-only for teammates."} />
      <Tabs defaultValue={isFounder ? "team" : "config"}>
        <div className="overflow-x-auto">
          <TabsList>
            {isFounder && <TabsTrigger value="team">Team</TabsTrigger>}
            <TabsTrigger value="config">Configuration</TabsTrigger>
            <TabsTrigger value="targets">Targets</TabsTrigger>
            <TabsTrigger value="import">Lead import</TabsTrigger>
            {isFounder && <TabsTrigger value="demo">Demo data</TabsTrigger>}
            <TabsTrigger value="webhook">Webhook</TabsTrigger>
          </TabsList>
        </div>
        {isFounder && (
          <TabsContent value="team">
            <TeamTab />
          </TabsContent>
        )}
        <TabsContent value="config">
          <ConfigTab />
        </TabsContent>
        <TabsContent value="targets">
          <TargetsTab />
        </TabsContent>
        <TabsContent value="import">
          <LeadImportTab />
        </TabsContent>
        {isFounder && (
          <TabsContent value="demo">
            <DemoTab />
          </TabsContent>
        )}
        <TabsContent value="webhook">
          <WebhookTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Team ────────────────────────────────────────────────────────────── */

function TeamTab() {
  const { user } = useSalesPrefs();
  const users = useSalesUsers();
  const invite = useInviteUser();
  const update = useUpdateUser();
  const revoke = useRevokeInvite();
  const toast = useSalesToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"teammate" | "founder">("teammate");
  const [result, setResult] = useState<InviteResult | null>(null);
  const [deactivating, setDeactivating] = useState<SalesUserFull | null>(null);

  return (
    <div className="mt-3 space-y-4">
      <SectionCard title="Invite someone" description="Invites expire. Share the link privately — it lets the person set their password.">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate(
              { email: email.trim(), role },
              {
                onSuccess: (res) => {
                  setResult(res);
                  setEmail("");
                },
              },
            );
          }}
        >
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" required className={touch} />
          <SimpleSelect value={role} onChange={(v) => v && setRole(v)} options={["teammate", "founder"]} />
          <Button type="submit" className={touch} disabled={invite.isPending || !email.trim()}>
            <UserPlus className="mr-1.5 h-4 w-4" /> {invite.isPending ? "Inviting…" : "Create invite"}
          </Button>
        </form>
        <ServerErrors error={invite.error} className="mt-2" />
        {result && (
          <div className="mt-3 space-y-1 rounded-md border border-[hsl(var(--sales-accent)/0.4)] bg-[hsl(var(--sales-accent)/0.06)] p-3">
            <p className="text-sm">
              Invite for <strong>{result.invite.email}</strong> ({result.invite.role}) — expires {formatDateTimeIST(result.invite.expiresAt)}
            </p>
            <CopyField value={adminAppUrl(result.inviteUrlPath)} label="Copy link" />
            <p className="text-[11px] text-muted-foreground">This link is shown once. Create a new invite if it's lost.</p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Users">
        {users.isLoading && <LoadingBlock rows={3} />}
        {users.error && <ErrorBlock error={users.error} onRetry={() => users.refetch()} />}
        {users.data && (
          <DataTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.users.map((u) => {
                  const self = u.id === user.id;
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <p className="text-sm font-medium">
                          {u.name}
                          {self && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </TableCell>
                      <TableCell>
                        <SimpleSelect
                          value={u.role}
                          disabled={self || update.isPending}
                          onChange={(v) => v && v !== u.role && update.mutate({ id: u.id, role: v }, { onSuccess: () => toast.success("Role updated"), onError: (e) => toast.error(e) })}
                          options={["founder", "teammate"]}
                          className="h-11 w-32 md:h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={u.status} />
                      </TableCell>
                      <TableCell className="text-xs">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : "Never"}</TableCell>
                      <TableCell className="text-right">
                        {!self &&
                          (u.status === "active" ? (
                            <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" onClick={() => setDeactivating(u)}>
                              Deactivate
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-11 md:min-h-8"
                              disabled={update.isPending}
                              onClick={() => update.mutate({ id: u.id, status: "active" }, { onSuccess: () => toast.success("Reactivated"), onError: (e) => toast.error(e) })}
                            >
                              Reactivate
                            </Button>
                          ))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTable>
        )}
      </SectionCard>

      <SectionCard title="Pending invites">
        {users.data && users.data.invites.length === 0 && <p className="text-xs text-muted-foreground">No pending invites.</p>}
        <ul className="divide-y divide-border">
          {users.data?.invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className="text-sm">
                  {i.email} <Pill tone="muted">{i.role}</Pill>
                </p>
                <p className="text-xs text-muted-foreground">Expires {formatDateTimeIST(i.expiresAt)}</p>
              </div>
              <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" disabled={revoke.isPending} onClick={() => revoke.mutate(i.id, { onSuccess: () => toast.success("Invite revoked"), onError: (e) => toast.error(e) })}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Revoke
              </Button>
            </li>
          ))}
        </ul>
      </SectionCard>

      <FormDialog
        open={deactivating != null}
        onOpenChange={(v) => !v && setDeactivating(null)}
        title={`Deactivate ${deactivating?.name ?? ""}?`}
        description="They are signed out immediately and can't sign in until reactivated. Their companies keep them as owner until reassigned."
        submitLabel="Deactivate"
        pending={update.isPending}
        error={update.error}
        onSubmit={() => deactivating && update.mutate({ id: deactivating.id, status: "deactivated" }, { onSuccess: () => setDeactivating(null) })}
      >
        <p className="text-xs text-muted-foreground">You can reactivate them later.</p>
      </FormDialog>
    </div>
  );
}

/* ── Configuration ──────────────────────────────────────────────────── */

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const int = (s: string) => (s.trim() === "" ? NaN : Math.round(Number(s)));

function ConfigTab() {
  const settings = useSalesSettings();
  if (settings.isLoading) return <LoadingBlock rows={6} className="mt-3" />;
  if (settings.error) return <ErrorBlock error={settings.error} onRetry={() => settings.refetch()} className="mt-3" />;
  if (!settings.data) return null;
  return <ConfigForm key={settings.data.updatedAt ?? "default"} config={settings.data.config} updatedAt={settings.data.updatedAt} />;
}

function ConfigForm({ config: c, updatedAt }: { config: SalesConfig; updatedAt: string | null }) {
  const { isFounder } = useSalesPrefs();
  const put = usePutSettings();
  const toast = useSalesToast();
  const [confirming, setConfirming] = useState(false);
  const [f, setF] = useState({
    sprintStart: c.sprint.start,
    sprintEnd: c.sprint.end,
    operatingNewPaid: String(c.goals.operatingNewPaid),
    stretchNewPaid: String(c.goals.stretchNewPaid),
    stretchMrr: paiseToRupeesInput(c.goals.stretchMrrPaise),
    fieldCities: c.cities.field.join(", "),
    remoteCities: c.cities.remote.join(", "),
    sectors: c.sectors.join(", "),
    sources: c.sources.join(", "),
    monthlyFee: paiseToRupeesInput(c.offer.monthlyFeePaise),
    includedMinutes: String(c.offer.includedMinutes),
    gstPercent: String(c.offer.gstRateBps / 100),
    attemptAllowance: String(c.pilot.attemptAllowance),
    durationDays: String(c.pilot.durationDays),
    extensionMin: String(c.pilot.extensionMin),
    extensionMax: String(c.pilot.extensionMax),
    activeCapacity: String(c.pilot.activeCapacity),
    visits: String(c.dailyTargets.visits),
    deliveryDayVisits: String(c.dailyTargets.deliveryDayVisits),
    conversationsMin: String(c.dailyTargets.conversationsMin),
    conversationsMax: String(c.dailyTargets.conversationsMax),
    demosMin: String(c.dailyTargets.demosMin),
    demosMax: String(c.dailyTargets.demosMax),
    pilots: String(c.dailyTargets.pilots),
    sundayIsReview: c.sundayIsReview,
    responseTargetMinutes: String(c.responseTargetMinutes),
    defaultInboundOwnerId: c.defaultInboundOwnerId,
    hoursStart: c.businessHours.start,
    hoursEnd: c.businessHours.end,
    hoursDays: c.businessHours.days,
    assumptions: c.forecast.assumptions.map((a) => ({ ...a, pct: String(Math.round(a.value * 1000) / 10) })),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const tx = (k: keyof typeof f) => (e: { target: { value: string } }) => set(k, e.target.value as never);

  const build = (): SalesConfig => ({
    ...c,
    sprint: { start: f.sprintStart, end: f.sprintEnd },
    goals: { operatingNewPaid: int(f.operatingNewPaid), stretchNewPaid: int(f.stretchNewPaid), stretchMrrPaise: rupeesToPaise(f.stretchMrr) ?? NaN },
    cities: { field: list(f.fieldCities), remote: list(f.remoteCities) },
    sectors: list(f.sectors),
    sources: list(f.sources),
    offer: { monthlyFeePaise: rupeesToPaise(f.monthlyFee) ?? NaN, includedMinutes: int(f.includedMinutes), gstRateBps: Math.round(Number(f.gstPercent) * 100) },
    pilot: {
      attemptAllowance: int(f.attemptAllowance),
      durationDays: int(f.durationDays),
      extensionMin: int(f.extensionMin),
      extensionMax: int(f.extensionMax),
      activeCapacity: int(f.activeCapacity),
    },
    dailyTargets: {
      visits: int(f.visits),
      deliveryDayVisits: int(f.deliveryDayVisits),
      conversationsMin: int(f.conversationsMin),
      conversationsMax: int(f.conversationsMax),
      demosMin: int(f.demosMin),
      demosMax: int(f.demosMax),
      pilots: int(f.pilots),
    },
    sundayIsReview: f.sundayIsReview,
    responseTargetMinutes: int(f.responseTargetMinutes),
    defaultInboundOwnerId: f.defaultInboundOwnerId,
    businessHours: { start: f.hoursStart, end: f.hoursEnd, days: [...f.hoursDays].sort() },
    forecast: { assumptions: f.assumptions.map(({ key, label, pct }) => ({ key, label, value: Number(pct) / 100 })) },
  });

  const num = (k: keyof typeof f, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input value={f[k] as string} onChange={tx(k)} inputMode="numeric" className={touch} />
    </Field>
  );

  return (
    <div className="mt-3 space-y-4">
      {!isFounder && (
        <p className="text-xs text-muted-foreground">
          <FounderOnlyNote>Only founders can change configuration</FounderOnlyNote>
        </p>
      )}
      {updatedAt && <p className="text-xs text-muted-foreground">Last changed {formatDateTimeIST(updatedAt)}</p>}
      <fieldset disabled={!isFounder} className="space-y-4">
        <SectionCard title="Sprint & goals">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Sprint start">
              <Input type="date" value={f.sprintStart} onChange={tx("sprintStart")} className={touch} />
            </Field>
            <Field label="Sprint end">
              <Input type="date" value={f.sprintEnd} onChange={tx("sprintEnd")} className={touch} />
            </Field>
            {num("operatingNewPaid", "Operating goal (new paying)")}
            {num("stretchNewPaid", "Stretch goal (new paying)")}
            <Field label="Stretch MRR">
              <MoneyInput value={f.stretchMrr} onChange={(v) => set("stretchMrr", v)} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Offer">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Monthly fee (excl. GST)">
              <MoneyInput value={f.monthlyFee} onChange={(v) => set("monthlyFee", v)} />
            </Field>
            {num("includedMinutes", "Included minutes")}
            {num("gstPercent", "GST %")}
          </div>
        </SectionCard>

        <SectionCard title="Pilots">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {num("attemptAllowance", "Attempt allowance")}
            {num("durationDays", "Duration (days)")}
            {num("extensionMin", "Extension min")}
            {num("extensionMax", "Extension max")}
            {num("activeCapacity", "Active capacity")}
          </div>
        </SectionCard>

        <SectionCard title="Daily targets (defaults)">
          <div className="grid gap-3 sm:grid-cols-4">
            {num("visits", "Visits (selling day)")}
            {num("deliveryDayVisits", "Visits (delivery day)")}
            {num("conversationsMin", "Conversations min")}
            {num("conversationsMax", "Conversations max")}
            {num("demosMin", "Demos min")}
            {num("demosMax", "Demos max")}
            {num("pilots", "Pilots")}
            <label className="flex min-h-11 items-center gap-2 self-end text-sm">
              <Switch checked={f.sundayIsReview} onCheckedChange={(v) => set("sundayIsReview", v)} /> Sunday is review day
            </label>
          </div>
        </SectionCard>

        <SectionCard title="Inbound leads">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {num("responseTargetMinutes", "First response target (business minutes)")}
            <Field label="Default inbound owner">
              <OwnerSelect value={f.defaultInboundOwnerId} onChange={(v) => set("defaultInboundOwnerId", v)} disabled={!isFounder} />
            </Field>
            <Field label="Business hours start">
              <Input type="time" value={f.hoursStart} onChange={tx("hoursStart")} className={touch} />
            </Field>
            <Field label="Business hours end">
              <Input type="time" value={f.hoursEnd} onChange={tx("hoursEnd")} className={touch} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => {
              const day = i + 1;
              const on = f.hoursDays.includes(day);
              return (
                <Button key={d} type="button" size="sm" variant={on ? "default" : "outline"} className="min-h-11 w-14 md:min-h-8" onClick={() => set("hoursDays", on ? f.hoursDays.filter((x) => x !== day) : [...f.hoursDays, day])}>
                  {d}
                </Button>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="Lists" description="Comma-separated.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Field cities">
              <Input value={f.fieldCities} onChange={tx("fieldCities")} className={touch} />
            </Field>
            <Field label="Remote cities">
              <Input value={f.remoteCities} onChange={tx("remoteCities")} className={touch} />
            </Field>
            <Field label="Sectors">
              <Textarea value={f.sectors} onChange={tx("sectors")} rows={2} />
            </Field>
            <Field label="Lead sources" hint="field_visit is the only non-inbound source.">
              <Textarea value={f.sources} onChange={tx("sources")} rows={2} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Forecast assumptions" description="Conversion rates used only for forecasts — never mixed with actuals.">
          <div className="grid gap-3 sm:grid-cols-2">
            {f.assumptions.map((a, i) => (
              <Field key={a.key} label={`${a.label} (%)`}>
                <Input
                  value={a.pct}
                  inputMode="decimal"
                  onChange={(e) => set("assumptions", f.assumptions.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
                  className={touch}
                />
              </Field>
            ))}
          </div>
        </SectionCard>
      </fieldset>

      {isFounder && (
        <Button className={touch} onClick={() => setConfirming(true)}>
          Save configuration
        </Button>
      )}
      <ReasonDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Save configuration"
        description="Changes apply immediately and are recorded in the audit log."
        label="Reason for change"
        required={false}
        confirmLabel="Save"
        pending={put.isPending}
        error={put.error}
        onConfirm={(reason) =>
          put.mutate(
            { config: build(), reason: reason || null },
            {
              onSuccess: () => {
                toast.success("Configuration saved");
                setConfirming(false);
              },
            },
          )
        }
      />
    </div>
  );
}

/* ── Targets ─────────────────────────────────────────────────────────── */

function TargetDialog({ target, onClose }: { target: Target; onClose: () => void }) {
  const patch = usePatchTarget();
  const toast = useSalesToast();
  const cumulative = target.kind === "cumulative_paid";
  const [f, setF] = useState({
    dayType: target.dayType,
    visits: String(target.visits),
    conversations: String(target.conversations),
    demos: String(target.demos),
    pilots: String(target.pilots),
    operatingPaid: String(target.operatingPaid),
    stretchPaid: String(target.stretchPaid),
    note: target.note ?? "",
    reason: "",
  });
  const dt = useSalesSettings().data?.config.dailyTargets;
  const prefillForDayType = (current: typeof f, dayType: Target["dayType"]): typeof f => {
    if (!dt || dayType === current.dayType) return { ...current, dayType };
    if (dayType === "review") return { ...current, dayType, visits: "0", conversations: "0", demos: "0", pilots: "0" };
    const visits = dayType === "delivery" ? dt.deliveryDayVisits : dt.visits;
    return { ...current, dayType, visits: String(visits), conversations: String(dt.conversationsMin), demos: String(dt.demosMin), pilots: String(dt.pilots) };
  };
  const n = (k: keyof typeof f) => (
    <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={touch} />
  );
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`${cumulative ? "Milestone" : "Targets"} — ${formatDateOnly(target.date)}`}
      pending={patch.isPending}
      error={patch.error}
      onSubmit={() =>
        patch.mutate(
          cumulative
            ? { id: target.id, operatingPaid: int(f.operatingPaid), stretchPaid: int(f.stretchPaid), note: f.note.trim() || null, reason: f.reason.trim() || null }
            : {
                id: target.id,
                dayType: f.dayType,
                visits: int(f.visits),
                conversations: int(f.conversations),
                demos: int(f.demos),
                pilots: int(f.pilots),
                note: f.note.trim() || null,
                reason: f.reason.trim() || null,
              },
          {
            onSuccess: () => {
              toast.success("Target updated");
              onClose();
            },
          },
        )
      }
    >
      {cumulative ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Operating (cumulative new paying)">{n("operatingPaid")}</Field>
          <Field label="Stretch (cumulative new paying)">{n("stretchPaid")}</Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Day type" hint={dt ? "Changing the day type pre-fills visits from Configuration; adjust before saving." : undefined}>
            <SimpleSelect value={f.dayType} onChange={(v) => v && setF(prefillForDayType(f, v))} options={["selling", "delivery", "review"]} />
          </Field>
          <Field label="Visits">{n("visits")}</Field>
          <Field label="Buyer conversations">{n("conversations")}</Field>
          <Field label="Demos">{n("demos")}</Field>
          <Field label="Pilots">{n("pilots")}</Field>
        </div>
      )}
      <Field label="Note">
        <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={touch} />
      </Field>
      <Field label="Reason for change">
        <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className={touch} />
      </Field>
    </FormDialog>
  );
}

function TargetsTab() {
  const { isFounder } = useSalesPrefs();
  const settings = useSalesSettings();
  const sprint = settings.data?.config.sprint;
  const daily = useTargets({ kind: "daily", from: sprint?.start, to: sprint?.end });
  const milestones = useTargets({ kind: "cumulative_paid" });
  const [editing, setEditing] = useState<Target | null>(null);
  const generate = useGenerateTargets();
  const toast = useSalesToast();
  const generateButton = isFounder && sprint && (
    <Button
      size="sm"
      variant="outline"
      className={touch}
      disabled={generate.isPending}
      onClick={() =>
        generate.mutate(
          { from: sprint.start, to: sprint.end },
          {
            onSuccess: (r) =>
              toast.success(
                r.created.daily || r.created.milestones ? "Targets generated" : "Nothing to add",
                `${r.created.daily} daily row(s) and ${r.created.milestones} milestone(s) added; ${r.skippedExisting} existing day(s) left unchanged.`,
              ),
            onError: (e) => toast.error(e),
          },
        )
      }
    >
      Fill missing days from Configuration
    </Button>
  );

  return (
    <div className="mt-3 space-y-4">
      <SectionCard title="Cumulative milestones" description="New paying clients by date — operating / stretch.">
        {milestones.isLoading && <LoadingBlock rows={2} />}
        {milestones.error && <ErrorBlock error={milestones.error} />}
        {milestones.data && milestones.data.targets.length === 0 && <p className="text-xs text-muted-foreground">No milestones stored.</p>}
        <div className="grid gap-2 sm:grid-cols-4">
          {milestones.data?.targets.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={!isFounder}
              onClick={() => setEditing(t)}
              className="rounded-md border border-border p-3 text-left enabled:hover:bg-muted disabled:cursor-default"
            >
              <p className="text-xs text-muted-foreground">{formatDateOnly(t.date)}</p>
              <p className="text-lg font-semibold tabular-nums">
                {t.operatingPaid} <span className="text-sm font-normal text-muted-foreground">/ {t.stretchPaid}</span>
              </p>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Daily targets" description={sprint ? `${formatDateOnly(sprint.start)} – ${formatDateOnly(sprint.end)}` : undefined} actions={isFounder ? generateButton : <FounderOnlyNote>Founders edit targets</FounderOnlyNote>}>
        {daily.isLoading && <LoadingBlock rows={6} />}
        {daily.error && <ErrorBlock error={daily.error} onRetry={() => daily.refetch()} />}
        {daily.data && daily.data.targets.length === 0 && <EmptyBlock title="No daily targets stored" />}
        {daily.data && daily.data.targets.length > 0 && (
          <DataTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Day type</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">Conversations</TableHead>
                  <TableHead className="text-right">Demos</TableHead>
                  <TableHead className="text-right">Pilots</TableHead>
                  <TableHead>Note</TableHead>
                  {isFounder && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {daily.data.targets.map((t) => (
                  <TableRow key={t.id} className={cn(t.dayType === "review" && "bg-amber-500/5")}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDateOnly(t.date)}</TableCell>
                    <TableCell className="text-xs">{humanize(t.dayType)}</TableCell>
                    {[t.visits, t.conversations, t.demos, t.pilots].map((v, i) => (
                      <TableCell key={i} className="text-right text-xs tabular-nums">
                        {v}
                      </TableCell>
                    ))}
                    <TableCell className="max-w-48 truncate text-xs text-muted-foreground">{t.note ?? ""}</TableCell>
                    {isFounder && (
                      <TableCell>
                        <Button size="icon" variant="ghost" className="h-11 w-11 md:h-8 md:w-8" aria-label="Edit target" onClick={() => setEditing(t)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        )}
      </SectionCard>
      {editing && <TargetDialog target={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ── Lead import ─────────────────────────────────────────────────────── */

const LEAD_FIELDS: CsvField[] = [
  { key: "name", label: "Company name", required: true, aliases: ["company", "company name", "business", "business name", "organisation", "organization"] },
  { key: "website", label: "Website", aliases: ["url", "site", "domain"] },
  { key: "city", label: "City", aliases: ["location", "town"] },
  { key: "sector", label: "Sector", aliases: ["industry", "category", "vertical"] },
  { key: "source", label: "Source", aliases: ["lead source", "channel"] },
  { key: "campaign", label: "Campaign", aliases: ["campaign name", "utm campaign", "ad"] },
  { key: "contactName", label: "Contact name", aliases: ["contact", "name", "full name", "person"] },
  { key: "phone", label: "Phone", aliases: ["mobile", "phone number", "contact number", "whatsapp"] },
  { key: "email", label: "Email", aliases: ["email address", "e-mail", "mail"] },
  { key: "enquiredAt", label: "Enquired at", aliases: ["date", "created", "created at", "submitted", "submitted at", "timestamp", "enquiry date"] },
];

const DECISION_TONE: Record<string, "success" | "accent" | "muted" | "warning" | "danger"> = {
  create: "success",
  update: "accent",
  skip: "muted",
  review: "warning",
  reject: "danger",
};

function LeadImportTab() {
  const preview = useLeadImportPreview();
  const commit = useLeadImportCommit();
  const toast = useSalesToast();
  const [payload, setPayload] = useState<{ filename: string; rows: Array<Record<string, unknown>> } | null>(null);
  const [plan, setPlan] = useState<LeadPreview | null>(null);
  const [reviewRows, setReviewRows] = useState<Set<number>>(new Set());
  const [decisions, setDecisions] = useState<Record<string, "create" | "skip">>({});
  const [done, setDone] = useState<LeadCommit | null>(null);

  const reset = () => {
    setPayload(null);
    setPlan(null);
    setDecisions({});
    setReviewRows(new Set());
    setDone(null);
    preview.reset();
    commit.reset();
  };

  const runPreview = (p: { filename: string; rows: Array<Record<string, unknown>> }, d: Record<string, "create" | "skip">) =>
    preview.mutate(
      { ...p, decisions: d },
      {
        onSuccess: (res) => {
          setPlan(res);
          setReviewRows((prev) => new Set([...prev, ...res.rows.filter((r) => r.decision === "review").map((r) => r.row)]));
        },
      },
    );

  const unresolved = plan ? plan.rows.filter((r) => r.decision === "review" && !decisions[String(r.row)]).length : 0;

  if (done) {
    return (
      <SectionCard title="Import complete" className="mt-3">
        <div className="flex flex-wrap gap-2">
          {Object.entries(done.counts).map(([k, v]) => (
            <Pill key={k} tone={DECISION_TONE[k]}>
              {humanize(k)}: {v}
            </Pill>
          ))}
        </div>
        <DataTable className="mt-3 max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {done.results.map((r) => (
                <TableRow key={r.row}>
                  <TableCell className="text-xs">{r.row}</TableCell>
                  <TableCell>
                    <Pill tone={DECISION_TONE[r.decision]}>{r.decision}</Pill>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.reason}
                    {r.companyId && (
                      <Link href={`/sales/companies/${r.companyId}`} className="ml-1 underline">
                        open
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTable>
        <Button className={cn(touch, "mt-3")} variant="outline" onClick={reset}>
          Import another file
        </Button>
      </SectionCard>
    );
  }

  return (
    <div className="mt-3 space-y-4">
      <SectionCard
        title="1. Upload and map"
        description="CSV with one company per row. Each row needs a phone, email or website so duplicates can be detected. Dates without a timezone are read as IST."
      >
        <CsvMapper
          fields={LEAD_FIELDS}
          readyLabel="Preview import"
          pending={preview.isPending}
          onReady={({ filename, rows }) => {
            const converted = rows.map((r) => ({ ...r, enquiredAt: r.enquiredAt ? cellToIsoDateTime(r.enquiredAt) ?? r.enquiredAt : "" }));
            const p = { filename, rows: converted };
            setPayload(p);
            setDecisions({});
            setReviewRows(new Set());
            runPreview(p, {});
          }}
        />
        <ServerErrors error={preview.error} className="mt-2" />
      </SectionCard>

      {plan && payload && (
        <SectionCard title="2. Review the plan" description="Nothing is saved until you commit. Similar-name matches need a decision.">
          <div className="flex flex-wrap gap-2">
            {Object.entries(plan.counts).map(([k, v]) => (
              <Pill key={k} tone={DECISION_TONE[k]}>
                {humanize(k)}: {v}
              </Pill>
            ))}
          </div>
          <DataTable className="mt-3 max-h-[28rem] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.rows.map((r) => {
                  const needsChoice = reviewRows.has(r.row);
                  return (
                    <TableRow key={r.row}>
                      <TableCell className="text-xs">{r.row}</TableCell>
                      <TableCell className="text-xs">{r.name ?? "—"}</TableCell>
                      <TableCell>
                        {needsChoice ? (
                          <SimpleSelect
                            value={decisions[String(r.row)] ?? ""}
                            onChange={(v) => {
                              const next = { ...decisions };
                              if (v) next[String(r.row)] = v;
                              else delete next[String(r.row)];
                              setDecisions(next);
                            }}
                            options={[
                              { value: "create", label: "Create separately" },
                              { value: "skip", label: "Skip" },
                            ]}
                            placeholder="Choose…"
                            className="h-11 w-44 md:h-8"
                          />
                        ) : (
                          <Pill tone={DECISION_TONE[r.decision]}>{r.decision}</Pill>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.reason}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTable>
          <ServerErrors error={commit.error} className="mt-2" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              className={touch}
              disabled={commit.isPending || unresolved > 0}
              onClick={() =>
                commit.mutate(
                  { ...payload, decisions },
                  {
                    onSuccess: (res) => {
                      setDone(res);
                      toast.success("Leads imported");
                    },
                  },
                )
              }
            >
              {commit.isPending ? "Importing…" : "Commit import"}
            </Button>
            <Button variant="outline" className={touch} disabled={preview.isPending} onClick={() => runPreview(payload, decisions)}>
              Refresh preview
            </Button>
            <Button variant="ghost" className={touch} onClick={reset}>
              Start over
            </Button>
            {unresolved > 0 && <span className="text-xs text-amber-600 dark:text-amber-400">{unresolved} row(s) need a decision.</span>}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/* ── Demo data ───────────────────────────────────────────────────────── */

function DemoTab() {
  const { demo, setDemo } = useSalesPrefs();
  const status = useDemoStatus(true);
  const seed = useSeedDemo();
  const clear = useClearDemo();
  const toast = useSalesToast();
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <SectionCard title="Demo data" description="Demo records are kept apart from real data and never count in real reports. Turn on demo mode to view them." className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <Database className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm">{status.isLoading ? "Checking…" : status.data ? `${status.data.demoCompanies} demo companies` : "—"}</span>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Switch checked={demo} onCheckedChange={setDemo} /> Demo mode
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          className={touch}
          disabled={seed.isPending}
          onClick={() =>
            seed.mutate(undefined, {
              onSuccess: (r) => {
                toast.success(r.seeded ? "Demo data created" : "Demo data already exists", "Turn on demo mode to view it.");
              },
              onError: (e) => toast.error(e),
            })
          }
        >
          {seed.isPending ? "Seeding…" : "Seed demo data"}
        </Button>
        <Button variant="outline" className={touch} disabled={clear.isPending} onClick={() => setConfirmClear(true)}>
          Clear demo data
        </Button>
      </div>
      <FormDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear all demo data?"
        description="Removes every demo company with its contacts, activities, pilots, payments and tasks, plus demo expenses. Real data is untouched."
        submitLabel="Clear demo data"
        pending={clear.isPending}
        error={clear.error}
        onSubmit={() =>
          clear.mutate(undefined, {
            onSuccess: (r) => {
              toast.success("Demo data cleared", `${r.removed.companies} companies, ${r.removed.tasks} tasks, ${r.removed.expenses} expenses removed.`);
              setConfirmClear(false);
            },
          })
        }
      >
        <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <ShieldAlert className="h-4 w-4" /> This can't be undone.
        </p>
      </FormDialog>
    </SectionCard>
  );
}

/* ── Webhook ─────────────────────────────────────────────────────────── */

function WebhookTab() {
  const settings = useSalesSettings();
  const sources = settings.data?.config.sources ?? [];
  const endpoint = typeof window !== "undefined" ? `${window.location.origin}/api/sales/webhooks/leads` : "/api/sales/webhooks/leads";
  const example = JSON.stringify(
    {
      eventId: "form-12345",
      source: sources.find((s) => s !== "field_visit") ?? "website_form",
      campaign: "oct-sprint",
      enquiredAt: "2026-10-05T10:15:00+05:30",
      company: { name: "Acme HR Services", website: "acmehr.in", city: "Chennai", sector: "HR consultancy" },
      contact: { name: "Priya", phone: "+919800000000", email: "priya@acmehr.in" },
      consent: { text: "I agree to be contacted by SnapServe", capturedAt: "2026-10-05T10:15:00+05:30", method: "website_form_checkbox" },
    },
    null,
    2,
  );
  return (
    <div className="mt-3 space-y-4">
      <SectionCard title="Inbound lead webhook" description="Website forms and ad platforms can push leads here. New leads appear as unassigned inbound with the first-response clock running.">
        <Field label="Endpoint (POST)">
          <CopyField value={endpoint} />
        </Field>
        <div className="mt-4 space-y-2 text-sm">
          <p className="font-medium">Required headers</p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li>
              <code>Content-Type: application/json</code>
            </li>
            <li>
              <code>X-SnapServe-Signature: sha256=&lt;hex&gt;</code> — HMAC-SHA256 of the exact raw request body, keyed with the server's webhook secret.
            </li>
            <li>
              <code>X-Event-Id: &lt;unique id&gt;</code> (required, max 200 characters) — repeat deliveries with the same id are ignored. If the body also has <code>eventId</code>, it must match.
            </li>
          </ul>
          <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            The signing secret is configured on the server (<code>SALES_WEBHOOK_SECRET</code>) and is never shown in this app. Ask whoever manages the server to share it with your form provider through a secure channel.
          </p>
        </div>
        <div className="mt-4 space-y-1">
          <p className="text-sm font-medium">Body</p>
          <p className="text-xs text-muted-foreground">
            <code>source</code> must be one of: {sources.join(", ") || "—"}. <code>enquiredAt</code> must be ISO 8601 with a timezone. A phone, email or website is needed for duplicate detection.
          </p>
          <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed">{example}</pre>
        </div>
      </SectionCard>
    </div>
  );
}
