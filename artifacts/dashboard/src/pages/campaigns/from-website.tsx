/**
 * /app/campaigns?tab=lead-sources — "From Website" tab
 *
 * Section 1: Website-webhook campaigns (wizard to create, list to manage)
 * Section 2: Instagram / Meta Lead Ads (existing MetaLeadsPage)
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCampaigns, useCreateCampaign, useUpdateCampaign,
  useListAgents, getListCampaignsQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import { Switch }   from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Copy, Globe, Clock, Bot, Plus, ChevronRight, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import MetaLeadsPage from "@/pages/meta-leads";

const ORIGIN = window.location.origin;

/* ─── Timezone list ────────────────────────────────────────────────────── */
const TIMEZONES = [
  { value: "Asia/Kolkata",        label: "IST — India (UTC+5:30)" },
  { value: "Asia/Dubai",          label: "GST — Dubai (UTC+4)" },
  { value: "Asia/Singapore",      label: "SGT — Singapore (UTC+8)" },
  { value: "Asia/Colombo",        label: "SLST — Sri Lanka (UTC+5:30)" },
  { value: "Asia/Dhaka",          label: "BST — Bangladesh (UTC+6)" },
  { value: "Asia/Karachi",        label: "PKT — Pakistan (UTC+5)" },
  { value: "America/New_York",    label: "EST — New York (UTC−5)" },
  { value: "America/Chicago",     label: "CST — Chicago (UTC−6)" },
  { value: "America/Los_Angeles", label: "PST — Los Angeles (UTC−8)" },
  { value: "Europe/London",       label: "GMT — London" },
  { value: "Europe/Paris",        label: "CET — Paris (UTC+1)" },
  { value: "UTC",                 label: "UTC" },
];

/* ─── Helpers ──────────────────────────────────────────────────────────── */
/** Format total minutes-since-midnight → "9:30 AM" */
function fmtMin(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const dh   = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** HH label for select (e.g. 0 → "12 AM", 13 → "1 PM") */
function fmtHour(h: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  const dh   = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh} ${ampm}`;
}

/* ─── TimePicker ───────────────────────────────────────────────────────── */
function TimePicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const h = Math.floor(value / 60);
  const m = value % 60;
  return (
    <div className="flex items-center gap-1.5">
      <Select value={String(h)} onValueChange={v => onChange(Number(v) * 60 + m)}>
        <SelectTrigger className="h-8 w-[90px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-52">
          {Array.from({ length: 24 }, (_, i) => (
            <SelectItem key={i} value={String(i)} className="text-xs">{fmtHour(i)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground text-xs font-medium">:</span>
      <Select value={String(m)} onValueChange={v => onChange(h * 60 + Number(v))}>
        <SelectTrigger className="h-8 w-[62px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[0, 15, 30, 45].map(min => (
            <SelectItem key={min} value={String(min)} className="text-xs font-mono">
              {String(min).padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/* ─── EmbedSnippet ─────────────────────────────────────────────────────── */
function EmbedSnippet({
  token, phoneField, nameField, emailField,
}: {
  token?: string;
  phoneField: string;
  nameField: string;
  emailField: string;
}) {
  const { toast } = useToast();
  const tok = token ?? "YOUR_TOKEN";

  const scriptTag = `<script src="${ORIGIN}/api/widget/lead-capture.js"\n        data-token="${tok}"></script>`;

  const lines = [
    `SnapServe.submit({`,
    `  "${phoneField || "phone"}": "+919876543210",`,
    nameField  ? `  "${nameField}": "Priya Sharma",`   : null,
    emailField ? `  "${emailField}": "priya@example.com",` : null,
    `})`,
    `.then(() => console.log("Lead sent!"))`,
    `.catch(err => console.error(err.message));`,
  ].filter(Boolean).join("\n");

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="space-y-3 text-[11px]">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground/50">1. Script tag</span>
          <button onClick={() => copy(scriptTag)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <Copy className="w-3 h-3" />Copy
          </button>
        </div>
        <p className="text-muted-foreground/60 mb-1.5">
          Paste once in your website's <code className="text-[10px] bg-muted/60 border border-border/50 rounded px-1 py-0.5">&lt;head&gt;</code> (or just before <code className="text-[10px] bg-muted/60 border border-border/50 rounded px-1 py-0.5">&lt;/body&gt;</code>) — on any page that has your lead form.
        </p>
        <pre className="font-mono bg-muted/40 border border-border/60 rounded-lg px-3 py-2.5 overflow-x-auto leading-relaxed whitespace-pre">{scriptTag}</pre>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground/50">2. On form submit</span>
          <button onClick={() => copy(lines)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <Copy className="w-3 h-3" />Copy
          </button>
        </div>
        <pre className="font-mono bg-muted/40 border border-border/60 rounded-lg px-3 py-2.5 overflow-x-auto leading-relaxed whitespace-pre">{lines}</pre>
      </div>
    </div>
  );
}

/* ─── CampaignCard ─────────────────────────────────────────────────────── */
interface WCampaign {
  id: number;
  name: string;
  agentId?: number | null;
  webhookToken: string;
  fieldMappings: Record<string, string>;
  businessHoursStart?: number | null;
  businessHoursEnd?:   number | null;
  isCallingHoursEnabled?: boolean;
  timezone?: string | null;
  status: string;
  leadSource: string;
}

function CampaignCard({ c, agentsMap }: { c: WCampaign; agentsMap: Map<number, string> }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const webhookUrl = `${ORIGIN}/api/webhooks/lead/${c.webhookToken}`;
  const phoneField  = c.fieldMappings["phone"] ?? "phone";
  const nameField   = c.fieldMappings["name"]  ?? "";
  const emailField  = c.fieldMappings["email"] ?? "";

  const hours = (() => {
    if (c.isCallingHoursEnabled === false) return "24 / 7";
    const s = c.businessHoursStart, e = c.businessHoursEnd;
    if (s == null || e == null) return "24 / 7";
    const sMin = s < 24 ? s * 60 : s;
    const eMin = e < 24 ? e * 60 : e;
    return `${fmtMin(sMin)} – ${fmtMin(eMin)}`;
  })();

  const agentName = c.agentId ? (agentsMap.get(c.agentId) ?? `Agent #${c.agentId}`) : "No agent";

  const statusCls =
    c.status === "active"  ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" :
    c.status === "paused"  ? "text-amber-500 bg-amber-500/10 border-amber-500/20" :
    "text-muted-foreground bg-muted/20 border-border";

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Globe className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
              <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${statusCls}`}>{c.status}</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60 mt-0.5">
              <span className="flex items-center gap-1"><Bot className="w-3 h-3" />{agentName}</span>
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{hours}
                {c.timezone && c.isCallingHoursEnabled !== false && (
                  <span className="text-muted-foreground/40 ml-0.5">· {c.timezone.split("/")[1]?.replace(/_/g, " ")}</span>
                )}
              </span>
            </div>
          </div>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            {expanded ? "Hide" : "Snippet"}
            <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} />
          </button>
        </div>

        {/* Webhook URL */}
        <div className="flex items-center gap-2 mt-3">
          <code className="flex-1 text-[11px] bg-elevated border border-border/50 rounded-lg px-2.5 py-1.5 font-mono truncate text-muted-foreground/70">
            {webhookUrl}
          </code>
          <button
            onClick={() => { navigator.clipboard.writeText(webhookUrl); toast({ title: "Copied" }); }}
            className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg border border-border bg-elevated hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-5 py-4 bg-muted/10">
          <EmbedSnippet token={c.webhookToken} phoneField={phoneField} nameField={nameField} emailField={emailField} />
        </div>
      )}
    </div>
  );
}

/* ─── Wizard ───────────────────────────────────────────────────────────── */
interface WizForm {
  name:         string;
  agentId:      string;
  hoursEnabled: boolean;
  startMin:     number;
  endMin:       number;
  timezone:     string;
  phoneField:   string;
  nameField:    string;
  emailField:   string;
}

const DEFAULTS: WizForm = {
  name:         "Website Leads",
  agentId:      "",
  hoursEnabled: true,
  startMin:     9 * 60,
  endMin:       18 * 60,
  timezone:     "Asia/Kolkata",
  phoneField:   "phone",
  nameField:    "name",
  emailField:   "email",
};

function Wizard({
  open,
  onClose,
  initialAgentId,
}: {
  open: boolean;
  onClose: () => void;
  initialAgentId?: string;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [f, setF] = useState<WizForm>(() => ({
    ...DEFAULTS,
    agentId: initialAgentId && /^\d+$/.test(initialAgentId) ? initialAgentId : "",
  }));
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: agents = [] } = useListAgents() as { data: { id: number; name: string }[] | undefined };
  const createMut = useCreateCampaign();
  const updateMut = useUpdateCampaign();

  const upd = (p: Partial<WizForm>) => setF(prev => ({ ...prev, ...p }));

  const reset = () => { setStep(1); setF(DEFAULTS); };
  const close = () => { reset(); onClose(); };

  const ok1 = f.name.trim().length > 0 && f.agentId !== "";
  const ok2 = !f.hoursEnabled || f.startMin < f.endMin;

  const create = async () => {
    if (!f.agentId) return;
    const fm: Record<string, string> = { phone: f.phoneField.trim() || "phone" };
    if (f.nameField.trim())  fm["name"]  = f.nameField.trim();
    if (f.emailField.trim()) fm["email"] = f.emailField.trim();

    try {
      const agent = (agents ?? []).find(a => String(a.id) === f.agentId) as
        | { id: number; agentConfig?: { callDefaults?: Record<string, number | boolean | string | null> } }
        | undefined;
      const d = agent?.agentConfig?.callDefaults ?? {};
      const campaign = await createMut.mutateAsync({
        data: {
          name:         f.name.trim(),
          agentId:      Number(f.agentId),
          leadSource:   "webhook",
          triggerMode:  "instant",
          fieldMappings: fm,
          maxAttempts: typeof d.maxAttempts === "number" ? d.maxAttempts : undefined,
          retryDelayMinutes: typeof d.retryDelayMinutes === "number" ? d.retryDelayMinutes : undefined,
          callDelaySeconds: typeof d.callDelaySeconds === "number" ? d.callDelaySeconds : undefined,
          concurrentCallLimit: typeof d.concurrentCallLimit === "number" ? d.concurrentCallLimit : undefined,
        },
      });

      await updateMut.mutateAsync({
        id:   campaign.id,
        data: {
          isCallingHoursEnabled: f.hoursEnabled,
          businessHoursStart:    f.hoursEnabled ? Math.floor(f.startMin / 60) : null,
          businessHoursEnd:      f.hoursEnabled ? Math.floor(f.endMin / 60)   : null,
          timezone:              f.hoursEnabled ? f.timezone  : null,
        },
      });

      await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      toast({ title: "Campaign created!", description: "Your website campaign is ready — copy the snippet and paste it on your site." });
      close();
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to create campaign", variant: "destructive" });
    }
  };

  const busy = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-lg">

        {/* Step indicators */}
        <div className="flex items-center gap-1.5 pb-0.5">
          {([1, 2, 3] as const).map(s => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold border transition-colors",
                step > s
                  ? "bg-primary border-primary text-primary-foreground"
                  : step === s
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-muted/30 border-border text-muted-foreground/50",
              )}>
                {step > s ? <Check className="w-3 h-3" /> : s}
              </div>
              {s < 3 && <div className={cn("h-px w-6 transition-colors", step > s ? "bg-primary" : "bg-border")} />}
            </div>
          ))}
          <span className="ml-auto text-[11px] text-muted-foreground/50">Step {step} of 3</span>
        </div>

        <DialogHeader>
          <DialogTitle className="text-base">
            {step === 1 && "Name & agent"}
            {step === 2 && "Calling hours"}
            {step === 3 && "Form field names"}
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Campaign name</Label>
              <Input value={f.name} onChange={e => upd({ name: e.target.value })} placeholder="Website Leads" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Agent <span className="text-destructive">*</span></Label>
              <Select value={f.agentId} onValueChange={v => upd({ agentId: v })}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select an agent…" />
                </SelectTrigger>
                <SelectContent>
                  {(agents ?? []).map(a => (
                    <SelectItem key={a.id} value={String(a.id)} className="text-sm">{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground/50">This agent will answer calls from website leads.</p>
            </div>
          </div>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 px-3.5 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Enable calling hours</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                  Leads outside hours are queued and bulk-dialled at start time
                </p>
              </div>
              <Switch checked={f.hoursEnabled} onCheckedChange={v => upd({ hoursEnabled: v })} />
            </div>

            {f.hoursEnabled && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Start time</Label>
                    <TimePicker value={f.startMin} onChange={v => upd({ startMin: v })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">End time</Label>
                    <TimePicker value={f.endMin} onChange={v => upd({ endMin: v })} />
                  </div>
                </div>

                {f.startMin >= f.endMin && (
                  <p className="text-[11px] text-destructive -mt-1">End time must be after start time.</p>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Timezone</Label>
                  <Select value={f.timezone} onValueChange={v => upd({ timezone: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map(tz => (
                        <SelectItem key={tz.value} value={tz.value} className="text-sm">{tz.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2.5 text-[11px] text-muted-foreground/60 leading-relaxed">
                  Leads arriving after <strong className="text-foreground/70">{fmtMin(f.endMin)}</strong> will be held and dialled automatically at <strong className="text-foreground/70">{fmtMin(f.startMin)}</strong> the next day.
                </div>
              </>
            )}

            {!f.hoursEnabled && (
              <div className="rounded-lg bg-muted/30 border border-border/50 px-3 py-2.5 text-[11px] text-muted-foreground/60">
                24 / 7 — leads will be dialled immediately at any time of day.
              </div>
            )}
          </div>
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-[12.5px] text-muted-foreground -mt-1">
              Enter the <em>exact</em> field names your website form uses. These become the keys in the JavaScript payload.
            </p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Phone field name <span className="text-destructive">*</span></Label>
                <Input
                  value={f.phoneField}
                  onChange={e => upd({ phoneField: e.target.value })}
                  placeholder="phone"
                  className="h-9 text-sm font-mono"
                />
                <p className="text-[11px] text-muted-foreground/50">The field in your form that holds the phone number to dial.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Name field <span className="text-muted-foreground/40 font-normal">(optional)</span></Label>
                <Input value={f.nameField} onChange={e => upd({ nameField: e.target.value })} placeholder="name" className="h-9 text-sm font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Email field <span className="text-muted-foreground/40 font-normal">(optional)</span></Label>
                <Input value={f.emailField} onChange={e => upd({ emailField: e.target.value })} placeholder="email" className="h-9 text-sm font-mono" />
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/50 mb-2.5">Preview — your embed snippet</p>
              <EmbedSnippet phoneField={f.phoneField || "phone"} nameField={f.nameField} emailField={f.emailField} />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && (
            <Button variant="ghost" size="sm" onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)} disabled={busy}>
              Back
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={close} disabled={busy}>Cancel</Button>
          {step < 3 ? (
            <Button size="sm" onClick={() => setStep(s => (s + 1) as 1 | 2 | 3)} disabled={step === 1 ? !ok1 : !ok2}>
              Continue
            </Button>
          ) : (
            <Button size="sm" onClick={create} disabled={!f.phoneField.trim() || busy}>
              {busy ? "Creating…" : "Create campaign"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────── */
export default function FromWebsitePage({ hideMeta = false }: { hideMeta?: boolean } = {}) {
  const initialAgentId = (() => {
    try {
      return new URLSearchParams(window.location.search).get("agentId") ?? "";
    } catch {
      return "";
    }
  })();
  const [wizardOpen, setWizardOpen] = useState(() => Boolean(initialAgentId));

  const { data: campaignsRaw } = useListCampaigns();
  const { data: agentsRaw }    = useListAgents();

  const webhookCampaigns = ((campaignsRaw ?? []) as WCampaign[]).filter(c => c.leadSource === "webhook");
  const agentsMap = new Map<number, string>(
    ((agentsRaw ?? []) as { id: number; name: string }[]).map(a => [a.id, a.name]),
  );

  return (
    <div className="flex flex-col">
      {/* ── Website form ── */}
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/40 mb-1">Website form</p>
            <h2 className="text-xl font-semibold text-foreground leading-tight">
              Connect your website form
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-lg">
              Paste the webhook into your form. New leads become people you can attach to a call plan.
            </p>
          </div>
          <Button size="sm" className="shrink-0 gap-1.5 mt-1" onClick={() => setWizardOpen(true)}>
            <Plus className="w-3.5 h-3.5" />Connect
          </Button>
        </div>

        {webhookCampaigns.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/20 px-6 py-12 text-center space-y-3">
            <Globe className="w-9 h-9 text-muted-foreground/25 mx-auto" />
            <div>
              <p className="text-sm font-medium text-foreground/60">No website form yet</p>
              <p className="text-[12px] text-muted-foreground/40 mt-0.5">
                Create one to get a webhook URL and embed snippet for your site.
              </p>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setWizardOpen(true)}>
              <Plus className="w-3.5 h-3.5" />Connect form
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {webhookCampaigns.map(c => (
              <CampaignCard key={c.id} c={c} agentsMap={agentsMap} />
            ))}
          </div>
        )}
      </div>

      {!hideMeta && (
        <>
          <div className="border-t border-border mx-4 sm:mx-6" />
          <MetaLeadsPage />
        </>
      )}

      <Wizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        initialAgentId={initialAgentId || undefined}
      />
    </div>
  );
}
