import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useScrollRestoration } from "@/lib/use-scroll-restoration";
import {
  useCreateCampaign, useUpdateCampaign, useDeleteCampaign,
  getListCampaignsQueryKey,
  useListAgents,
  useListPhoneNumbers,
  useGetAccount,
} from "@workspace/api-client-react";
import type { Campaign, ConsentBasisBasisType } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Copy, Check, Phone, Megaphone, ChevronRight, X,
  PhoneCall, Clock, MoreHorizontal,
  Pencil, Trash2, Users, CalendarDays,
  CheckCircle2, PlayCircle, PauseCircle, XCircle,
  Target, Layers, ArrowRight,
  Globe, Zap, Upload, Instagram, Loader2,
  TrendingUp, TrendingDown, Wifi, WifiOff,
  AlertTriangle, ShieldAlert, Timer, BookMarked,
  Activity, ChevronDown,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ConsentBasisType = ConsentBasisBasisType;

const CONSENT_BASIS_OPTIONS: { value: ConsentBasisType; label: string }[] = [
  { value: "existing_customer",       label: "Existing customer relationship" },
  { value: "service_callback",        label: "Service-related callback" },
  { value: "fresh_marketing_consent", label: "Fresh marketing consent" },
  { value: "other",                   label: "Other" },
];

// ── Helpers ───────────────────────────────────────────────────────────────


function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-muted-foreground/30 hover:text-muted-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ── Dashboard types ────────────────────────────────────────────────────────

type DashboardStats = {
  activeCampaigns:    number;
  listeningCampaigns: number;
  liveCalls:          number;
  queuedLeads:        number;
  todayLeads:         number;
  todayBookings:      number;
};

type CampaignHealth = "healthy" | "no_agent" | "no_number" | "validation_error" | "webhook_offline" | "outside_hours";

type DashboardCampaign = Campaign & {
  agentName:      string | null;
  todayLeads:     number;
  yesterdayLeads: number;
  queuedLeads:    number;
  callingLeads:   number;
  completedLeads: number;
  bookedToday:    number;
  campaignHealth: CampaignHealth;
  lastActivity:   { label: string; at: string } | null;
};

type DashboardData = {
  stats:     DashboardStats;
  campaigns: DashboardCampaign[];
};

async function apiFetchDash<T>(url: string): Promise<T> {
  const token = localStorage.getItem("voiceorch:session");
  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

// ── Status helpers ─────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; dot: string; cls: string }> = {
  draft:     { label: "Draft",           dot: "bg-muted-foreground/40",  cls: "bg-muted/40 text-muted-foreground border-border" },
  active:    { label: "Active",          dot: "bg-emerald-500 animate-pulse", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  paused:    { label: "Paused",          dot: "bg-amber-500",             cls: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  completed: { label: "Completed",       dot: "bg-blue-500",              cls: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  stopped:   { label: "Stopped",         dot: "bg-red-500",               cls: "bg-red-500/10 text-red-500 border-red-500/20" },
  listening: { label: "Listening",       dot: "bg-sky-500 animate-pulse", cls: "bg-sky-500/10 text-sky-500 border-sky-500/20" },
  archived:  { label: "Archived",        dot: "bg-muted-foreground/20",   cls: "bg-muted/30 text-muted-foreground/50 border-border" },
};

function CampaignStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, dot: "bg-muted-foreground/40", cls: "bg-muted/40 text-muted-foreground border-border" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-md border", cfg.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

const HEALTH_CFG: Record<CampaignHealth, { label: string; icon: React.ReactNode; cls: string }> = {
  healthy:         { label: "Healthy",               icon: <CheckCircle2 className="h-3 w-3" />,   cls: "text-emerald-500" },
  no_agent:        { label: "No Agent",              icon: <AlertTriangle className="h-3 w-3" />,  cls: "text-amber-500" },
  no_number:       { label: "No Phone Number",       icon: <AlertTriangle className="h-3 w-3" />,  cls: "text-amber-500" },
  validation_error:{ label: "Validation Error",      icon: <ShieldAlert className="h-3 w-3" />,    cls: "text-red-500" },
  webhook_offline: { label: "Webhook Offline",       icon: <WifiOff className="h-3 w-3" />,        cls: "text-red-500" },
  outside_hours:   { label: "Outside Hours",         icon: <Clock className="h-3 w-3" />,          cls: "text-muted-foreground/50" },
};

function HealthBadge({ health }: { health: CampaignHealth }) {
  const cfg = HEALTH_CFG[health];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium", cfg.cls)}>
      {cfg.icon}
      <span className="hidden lg:inline">{cfg.label}</span>
    </span>
  );
}

const SOURCE_ICON: Record<string, React.ReactNode> = {
  webhook:  <Globe className="h-3.5 w-3.5 text-blue-500" />,
  meta_ads: <Instagram className="h-3.5 w-3.5 text-purple-500" />,
  csv:      <Upload className="h-3.5 w-3.5 text-muted-foreground/40" />,
  crm:      <Layers className="h-3.5 w-3.5 text-amber-500" />,
};

// ── Campaign Row ───────────────────────────────────────────────────────────

function CampaignRow({
  campaign,
  onEdit,
  onDelete,
}: {
  campaign: DashboardCampaign;
  onEdit: (c: Campaign) => void;
  onDelete: (c: Campaign) => void;
}) {
  const [, navigate] = useLocation();
  const totalCallable = campaign.totalLeads;
  const completed     = campaign.completedLeads;
  const pct           = totalCallable > 0 ? Math.round((completed / totalCallable) * 100) : 0;
  const trend         = campaign.yesterdayLeads > 0
    ? Math.round(((campaign.todayLeads - campaign.yesterdayLeads) / campaign.yesterdayLeads) * 100)
    : null;

  return (
    <div
      className="group grid items-center gap-3 px-4 py-3.5 hover:bg-muted/20 transition-colors cursor-pointer border-b border-border/40 last:border-0"
      style={{ gridTemplateColumns: "2fr 1fr 1fr 80px 80px 100px 56px 80px 1fr 100px" }}
      onClick={() => navigate(`${BASE}/app/campaigns/${campaign.id}`)}
    >
      {/* Campaign name + source */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">{SOURCE_ICON[(campaign as unknown as Record<string,string>)["leadSource"] ?? "csv"] ?? <Megaphone className="h-3.5 w-3.5 text-muted-foreground/40" />}</span>
          <span className="text-sm font-medium text-foreground truncate">{campaign.name}</span>
          {((campaign as unknown as Record<string,string>)["triggerMode"] === "instant") && (
            <Zap className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/40 mt-0.5 truncate ml-5.5">
          {formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true })}
        </p>
      </div>

      {/* Status */}
      <div><CampaignStatusBadge status={campaign.status} /></div>

      {/* Agent + number */}
      <div className="min-w-0">
        {campaign.agentName ? (
          <>
            <p className="text-xs font-medium text-foreground truncate">{campaign.agentName}</p>
            {campaign.fromNumber && (
              <p className="text-[10px] text-muted-foreground/40 font-mono truncate">{campaign.fromNumber}</p>
            )}
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground/30 italic">None</span>
        )}
      </div>

      {/* Today's leads */}
      <div className="text-center">
        <p className="text-sm font-semibold tabular-nums text-foreground">{campaign.todayLeads}</p>
        {trend !== null && (
          <p className={cn("text-[9px] font-medium flex items-center justify-center gap-0.5", trend >= 0 ? "text-emerald-500" : "text-red-500")}>
            {trend >= 0 ? <TrendingUp className="h-2 w-2" /> : <TrendingDown className="h-2 w-2" />}
            {Math.abs(trend)}%
          </p>
        )}
      </div>

      {/* Total leads */}
      <div className="text-center">
        <p className="text-sm font-semibold tabular-nums text-foreground">{campaign.totalLeads.toLocaleString()}</p>
      </div>

      {/* Call progress */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground/50 tabular-nums">{completed}/{totalCallable}</span>
          <span className="text-[10px] font-mono text-muted-foreground/40">{pct}%</span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-foreground/25 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Queued */}
      <div className="text-center">
        {campaign.queuedLeads > 0 ? (
          <>
            <p className="text-sm font-semibold tabular-nums text-amber-500">{campaign.queuedLeads}</p>
            <p className="text-[9px] text-muted-foreground/40">Queued</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground/25">—</p>
        )}
      </div>

      {/* Booked today */}
      <div className="text-center">
        {campaign.bookedToday > 0 ? (
          <p className="text-sm font-semibold tabular-nums text-violet-500">{campaign.bookedToday}</p>
        ) : (
          <p className="text-xs text-muted-foreground/25">—</p>
        )}
      </div>

      {/* Health */}
      <div><HealthBadge health={campaign.campaignHealth} /></div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 justify-end" onClick={e => e.stopPropagation()}>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={e => { e.stopPropagation(); navigate(`${BASE}/app/campaigns/${campaign.id}`); }}
        >
          Open <ChevronRight className="h-3 w-3" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              onClick={e => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground/50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[130px]">
            <DropdownMenuItem className="text-xs" onClick={e => { e.stopPropagation(); onEdit(campaign as unknown as Campaign); }}>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground/60" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem className="text-xs text-red-500 focus:text-red-500 focus:bg-red-500/5"
              onClick={e => { e.stopPropagation(); onDelete(campaign as unknown as Campaign); }}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ── Campaign Creation Wizard ──────────────────────────────────────────────

const WIZARD_STEPS = ["info", "source", "crm_mode", "agent", "phone", "settings", "review"] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];

const STEP_LABELS: Record<WizardStep, string> = {
  info: "Details", source: "Source", crm_mode: "CRM Mode", agent: "Agent", phone: "Phone", settings: "Settings", review: "Review",
};

type CampaignLeadSource = "csv" | "webhook" | "meta_ads" | "crm";
type CampaignTriggerMode = "instant" | "batch";

const SOURCE_OPTIONS: {
  value: CampaignLeadSource;
  label: string;
  description: string;
  icon: React.ReactNode;
  defaultTrigger: CampaignTriggerMode;
}[] = [
  {
    value: "webhook",
    label: "Website / Form",
    description: "Leads from your website enquiry forms. Each submission triggers an immediate call.",
    icon: <Globe className="h-5 w-5" />,
    defaultTrigger: "instant",
  },
  {
    value: "meta_ads",
    label: "Meta Ads",
    description: "Instagram and Facebook Lead Ads. New leads are called automatically as they arrive.",
    icon: <Instagram className="h-5 w-5" />,
    defaultTrigger: "instant",
  },
  {
    value: "csv",
    label: "CSV / Bulk Upload",
    description: "Upload a spreadsheet of leads. Calls are organised into batches you manage manually.",
    icon: <Upload className="h-5 w-5" />,
    defaultTrigger: "batch",
  },
  {
    value: "crm",
    label: "CRM",
    description: "Import leads from your CRM. Choose instant trigger or scheduled batch import.",
    icon: <Layers className="h-5 w-5" />,
    defaultTrigger: "instant",
  },
];

function sourceLabel(s: CampaignLeadSource): string {
  return SOURCE_OPTIONS.find(o => o.value === s)?.label ?? s;
}

function CampaignWizard({
  open,
  onClose,
  activeCampaigns,
}: {
  open: boolean;
  onClose: () => void;
  activeCampaigns: Campaign[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateCampaign();
  const { data: agents } = useListAgents();
  const { data: phoneNumbers } = useListPhoneNumbers();
  const { data: accountInfo } = useGetAccount();

  // User's account-level concurrent call ceiling (set by admin; default 10).
  // The campaign slider caps at the lower of the account limit and the hard
  // platform ceiling of 10 — users can never pick more than 10.
  const CAMPAIGN_CONCURRENCY_CEILING = 10;
  const maxConcurrency = Math.min(accountInfo?.concurrentLimit ?? 10, CAMPAIGN_CONCURRENCY_CEILING);

  const [step, setStep] = useState<WizardStep>("info");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [leadSource, setLeadSource] = useState<CampaignLeadSource>("webhook");
  const [triggerMode, setTriggerMode] = useState<CampaignTriggerMode>("instant");

  // CRM campaigns get an extra "CRM Mode" step; all others skip it
  const activeSteps = (leadSource === "crm"
    ? WIZARD_STEPS
    : WIZARD_STEPS.filter(s => s !== "crm_mode")) as readonly WizardStep[];
  const [agentId, setAgentId] = useState<number | null>(null);
  const [fromNumber, setFromNumber] = useState<string | null>(null);
  const [concurrentCallLimit, setConcurrentCallLimit] = useState<number | null>(null);
  // Resolved value: user-chosen (if within limit) or clamped to limit.
  const effectiveConcurrency = Math.min(concurrentCallLimit ?? maxConcurrency, maxConcurrency);

  // ── DPDP consent basis (audit-only; required when agent has DPDP on) ──
  const [consentBasisType, setConsentBasisType] = useState<ConsentBasisType | "">("");
  const [consentSource, setConsentSource] = useState("");
  const [consentDateRange, setConsentDateRange] = useState("");
  const [consentProofRef, setConsentProofRef] = useState("");
  const [consentNotes, setConsentNotes] = useState("");

  const liveAgentIds = new Set(
    activeCampaigns.filter(c => c.status === "active").map(c => c.agentId).filter(Boolean)
  );

  function reset() {
    setStep("info"); setName(""); setDesc("");
    setLeadSource("webhook"); setTriggerMode("instant");
    setAgentId(null); setFromNumber(null); setConcurrentCallLimit(null);
    setConsentBasisType(""); setConsentSource(""); setConsentDateRange("");
    setConsentProofRef(""); setConsentNotes("");
  }
  function close() { reset(); onClose(); }

  const stepIdx = activeSteps.indexOf(step);
  const isLast = step === "review";
  const selectedAgent = agents?.find(a => a.id === agentId);
  const agentDpdpEnabled = !!(
    (selectedAgent?.agentConfig as { compliance?: { dpdp?: boolean } } | undefined)?.compliance?.dpdp
  );

  function consentComplete(): boolean {
    if (!agentDpdpEnabled) return true;
    if (!consentBasisType) return false;
    if (consentBasisType === "fresh_marketing_consent") {
      return consentSource.trim().length > 0 && consentDateRange.trim().length > 0;
    }
    if (consentBasisType === "other") return consentNotes.trim().length > 0;
    return true;
  }

  function canNext(): boolean {
    if (step === "info") return name.trim().length > 0;
    if (step === "source") return !!leadSource;
    if (step === "crm_mode") return true;
    if (step === "agent") return agentId !== null;
    if (step === "phone") return fromNumber !== null;
    return true;
  }

  function next() {
    const i = activeSteps.indexOf(step);
    if (i < activeSteps.length - 1) setStep(activeSteps[i + 1]!);
  }
  function back() {
    const i = activeSteps.indexOf(step);
    if (i > 0) setStep(activeSteps[i - 1]!);
  }

  async function handleCreate() {
    if (!name.trim() || !agentId) return;
    if (!consentComplete()) return;
    const consentBasis = agentDpdpEnabled && consentBasisType
      ? {
          basisType:        consentBasisType,
          consentSource:    consentSource.trim() || undefined,
          consentDateRange: consentDateRange.trim() || undefined,
          proofReference:   consentProofRef.trim() || undefined,
          notes:            consentNotes.trim() || undefined,
        }
      : undefined;
    try {
      await create.mutateAsync({
        data: { name: name.trim(), description: desc.trim() || undefined, agentId, fromNumber: fromNumber ?? undefined, concurrentCallLimit: effectiveConcurrency, consentBasis, leadSource, triggerMode } as Parameters<typeof create.mutateAsync>[0]["data"],
      });
      await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      toast({ title: "Campaign created", description: name.trim() });
      close();
    } catch (err) {
      const msg = (err instanceof Error ? err.message : null)
        ?? "Failed to create campaign";
      toast({ title: "Failed to create campaign", description: msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-border shrink-0">
          <div className="text-base font-semibold">New Campaign</div>
          <p className="text-xs text-muted-foreground/60 mt-0.5">Set up an AI voice calling campaign in a few steps</p>
          {/* Step indicator */}
          <div className="flex items-center gap-1.5 mt-4">
            {activeSteps.map((s, i) => (
              <div key={s} className="flex items-center gap-1.5 flex-1">
                <div className={cn(
                  "flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap transition-all",
                  i < stepIdx ? "bg-foreground/10 text-muted-foreground" :
                  i === stepIdx ? "bg-foreground text-background" :
                  "text-muted-foreground/30"
                )}>
                  <span className="tabular-nums">{i + 1}</span>
                  <span className="hidden sm:inline">{STEP_LABELS[s]}</span>
                </div>
                {i < activeSteps.length - 1 && <div className="flex-1 h-px bg-border" />}
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-5 flex-1 overflow-y-auto min-h-0">
          {step === "info" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-0.5">Campaign Details</h3>
                <p className="text-xs text-muted-foreground/60">Give your campaign a name and an optional description</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Campaign Name <span className="text-destructive">*</span></Label>
                <Input placeholder="e.g. Q3 Summer Leads" value={name} onChange={e => setName(e.target.value)}
                  className="h-9 text-sm" autoFocus onKeyDown={e => e.key === "Enter" && canNext() && next()} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description <span className="text-muted-foreground/40">(optional)</span></Label>
                <Input placeholder="Short description of this campaign…" value={desc} onChange={e => setDesc(e.target.value)} className="h-9 text-xs" />
              </div>
            </div>
          )}

          {step === "source" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-0.5">Lead Source</h3>
                <p className="text-xs text-muted-foreground/60">Where will leads come from? This determines how calls are triggered.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SOURCE_OPTIONS.map(opt => {
                  const isSelected = leadSource === opt.value;
                  return (
                    <button key={opt.value} type="button"
                      onClick={() => { setLeadSource(opt.value); if (opt.value !== "crm") setTriggerMode(opt.defaultTrigger); }}
                      className={cn(
                        "text-left p-4 rounded-xl border transition-all",
                        isSelected ? "border-foreground bg-foreground/5 ring-1 ring-foreground" :
                        "border-border bg-card hover:bg-muted/30 hover:border-foreground/20"
                      )}
                    >
                      <div className="flex items-start gap-3 mb-2">
                        <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                          isSelected ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                        )}>
                          {opt.icon}
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <p className="text-sm font-medium text-foreground">{opt.label}</p>
                          <p className="text-xs text-muted-foreground/60 mt-0.5 leading-relaxed">{opt.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        {opt.value === "crm" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20">
                            <Zap className="h-2.5 w-2.5" /> Instant or Batch
                          </span>
                        ) : opt.defaultTrigger === "instant" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                            <Zap className="h-2.5 w-2.5" /> Instant dial
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                            <Layers className="h-2.5 w-2.5" /> Batch-wise
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-600">
                          <CheckCircle2 className="h-3 w-3" /> Selected
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === "crm_mode" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-0.5">Dialing Mode</h3>
                <p className="text-xs text-muted-foreground/60">How should this campaign handle incoming CRM leads?</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  {
                    mode: "instant" as CampaignTriggerMode,
                    label: "Instant Trigger",
                    description: "Auto-dial new CRM leads the moment they arrive via webhook.",
                    icon: <Zap className="h-5 w-5" />,
                    badge: { text: "Instant dial", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
                  },
                  {
                    mode: "batch" as CampaignTriggerMode,
                    label: "Import & Batch",
                    description: "Pull contacts from your CRM into a new batch and manage calls manually.",
                    icon: <Layers className="h-5 w-5" />,
                    badge: { text: "Batch-wise", className: "bg-muted text-muted-foreground border-border" },
                  },
                ] as const).map(opt => {
                  const isSelected = triggerMode === opt.mode;
                  return (
                    <button key={opt.mode} type="button" onClick={() => setTriggerMode(opt.mode)}
                      className={cn(
                        "text-left p-4 rounded-xl border transition-all",
                        isSelected ? "border-foreground bg-foreground/5 ring-1 ring-foreground"
                          : "border-border bg-card hover:bg-muted/30 hover:border-foreground/20"
                      )}
                    >
                      <div className="flex items-start gap-3 mb-2">
                        <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                          isSelected ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                        )}>
                          {opt.icon}
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <p className="text-sm font-medium text-foreground">{opt.label}</p>
                          <p className="text-xs text-muted-foreground/60 mt-0.5 leading-relaxed">{opt.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border", opt.badge.className)}>
                          {opt.mode === "instant" ? <Zap className="h-2.5 w-2.5" /> : <Layers className="h-2.5 w-2.5" />}
                          {opt.badge.text}
                        </span>
                      </div>
                      {isSelected && (
                        <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-600">
                          <CheckCircle2 className="h-3 w-3" /> Selected
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === "agent" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-0.5">Select Voice Agent</h3>
                <p className="text-xs text-muted-foreground/60">Choose the AI agent that will handle calls in this campaign</p>
              </div>
              {!agents?.length ? (
                <div className="py-10 text-center text-muted-foreground/40 text-sm">No agents found. Create an agent first.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {agents.map(agent => {
                    const lang = agent.asrLanguage ?? undefined;
                    const ttsProvider = agent.ttsProvider;
                    const dispositions: string[] = [];
                    const isLive = liveAgentIds.has(agent.id);
                    const isSelected = agentId === agent.id;
                    return (
                      <button key={agent.id} type="button" onClick={() => setAgentId(agent.id)}
                        className={cn(
                          "text-left p-4 rounded-xl border transition-all",
                          isSelected ? "border-foreground bg-foreground/5 ring-1 ring-foreground" :
                          "border-border bg-card hover:bg-muted/30 hover:border-foreground/20"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="text-sm font-medium text-foreground truncate flex-1">{agent.name}</p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isLive && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 border border-emerald-500/20">LIVE</span>}
                            <span className={cn("h-2 w-2 rounded-full shrink-0",
                              agent.status === "active" ? "bg-emerald-500" : agent.status === "draft" ? "bg-muted-foreground/40" : "bg-amber-500"
                            )} />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {lang && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20">{lang}</span>}
                          {ttsProvider && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">{ttsProvider}</span>}
                          {dispositions.length > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">{dispositions.length} dispositions</span>}
                        </div>
                        {isSelected && <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Selected</div>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === "phone" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-0.5">Caller ID Number</h3>
                <p className="text-xs text-muted-foreground/60">Select one of your phone numbers to use as the caller ID for this campaign.</p>
              </div>
              {!phoneNumbers ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[1, 2].map(i => <div key={i} className="h-20 rounded-xl bg-muted/30 animate-pulse border border-border" />)}
                </div>
              ) : phoneNumbers.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 border border-dashed border-border rounded-xl bg-muted/20">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    <Phone className="h-5 w-5 text-muted-foreground/40" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">No phone numbers yet</p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">You need at least one number to run a campaign.</p>
                  </div>
                  <a
                    href={`${BASE}/app/phone-numbers`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    Go to Phone Numbers <ArrowRight className="h-3 w-3" />
                  </a>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {phoneNumbers.map(pn => {
                    const num = pn.number;
                    const cc = pn.countryCode;
                    const type = pn.numberType;
                    const isSelected = fromNumber === num;
                    return (
                      <button key={pn.id} type="button" onClick={() => setFromNumber(num)}
                        className={cn("text-left p-3 rounded-xl border transition-all",
                          isSelected ? "border-foreground bg-foreground/5 ring-1 ring-foreground" : "border-border bg-card hover:bg-muted/30"
                        )}>
                        <p className="text-sm font-mono font-medium text-foreground">{num}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          {cc && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">{cc}</span>}
                          {type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border capitalize">{type}</span>}
                        </div>
                        {isSelected && <div className="mt-1.5 flex items-center gap-1 text-[10px] text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Selected</div>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === "settings" && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold mb-0.5">Concurrency Settings</h3>
                <p className="text-xs text-muted-foreground/60">
                  Set the max simultaneous calls. Batch-level settings (delays, retries, business hours) are set when you create each batch.
                </p>
              </div>
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs">Max Concurrent Calls</Label>
                  <span className="text-xl font-mono font-bold text-foreground">{effectiveConcurrency}</span>
                </div>
                <input type="range" min={1} max={maxConcurrency} step={1} value={effectiveConcurrency}
                  onChange={e => setConcurrentCallLimit(Number(e.target.value))}
                  className="w-full h-1.5 accent-foreground cursor-pointer" />
                <div className="flex justify-between mt-1 text-[10px] text-muted-foreground/40">
                  <span>1 (serial)</span><span>{maxConcurrency} (your limit)</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {["Call Delay", "Max Attempts", "Business Hours"].map(lbl => (
                  <div key={lbl} className="bg-muted/30 rounded-lg p-3 text-center border border-border">
                    <p className="text-[9px] text-muted-foreground/40 uppercase tracking-widest mb-1">{lbl}</p>
                    <p className="text-xs font-medium text-muted-foreground/60">Per batch</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-0.5">Review &amp; Create</h3>
                <p className="text-xs text-muted-foreground/60">Confirm your campaign configuration before creating.</p>
              </div>
              <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
                {[
                  { label: "Campaign Name", value: name, mono: false },
                  { label: "Description",   value: desc || "—", mono: false },
                  { label: "Lead Source",   value: sourceLabel(leadSource), mono: false },
                  { label: "Trigger",       value: triggerMode === "instant" ? "Instant — auto-dial on arrival" : "Batch-wise — manual batch management", mono: false },
                  { label: "Agent",         value: selectedAgent?.name ?? "—", mono: false },
                  { label: "From Number",   value: fromNumber ?? "—", mono: true },
                  { label: "Concurrent Calls", value: String(effectiveConcurrency), mono: true },
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-xs text-muted-foreground">{r.label}</span>
                    <span className={cn("text-sm font-medium text-foreground", r.mono && "font-mono")}>{r.value}</span>
                  </div>
                ))}
              </div>
              {agentDpdpEnabled && (
                <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                  <div>
                    <h4 className="text-sm font-semibold flex items-center gap-1.5">
                      <Target className="h-3.5 w-3.5 text-amber-500" />
                      DPDP Consent Basis <span className="text-destructive">*</span>
                    </h4>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      This agent has DPDP compliance enabled. Record the documented basis for contacting these
                      recipients (audit-only — it does not block or delay calls).
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Basis</Label>
                    <Select
                      value={consentBasisType || undefined}
                      onValueChange={v => setConsentBasisType(v as ConsentBasisType)}
                    >
                      <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select a consent basis" /></SelectTrigger>
                      <SelectContent>
                        {CONSENT_BASIS_OPTIONS.map(o => (
                          <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {consentBasisType === "fresh_marketing_consent" && (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Consent Source <span className="text-destructive">*</span></Label>
                        <Input
                          className="h-9 text-xs"
                          placeholder="e.g. Website opt-in form, event sign-up"
                          value={consentSource}
                          onChange={e => setConsentSource(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Consent Date Range <span className="text-destructive">*</span></Label>
                        <Input
                          className="h-9 text-xs"
                          placeholder="e.g. Jan 2026 – Mar 2026"
                          value={consentDateRange}
                          onChange={e => setConsentDateRange(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Proof Reference <span className="text-muted-foreground/40">(optional)</span></Label>
                        <Input
                          className="h-9 text-xs"
                          placeholder="e.g. Link or ID of stored consent record"
                          value={consentProofRef}
                          onChange={e => setConsentProofRef(e.target.value)}
                        />
                      </div>
                    </>
                  )}
                  {consentBasisType === "other" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Notes <span className="text-destructive">*</span></Label>
                      <Input
                        className="h-9 text-xs"
                        placeholder="Describe the lawful basis for contacting these recipients"
                        value={consentNotes}
                        onChange={e => setConsentNotes(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground/40 text-center">
                You can add batches, set call delays, retries, and business hours from the campaign detail page.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={stepIdx === 0 ? close : back}>
            {stepIdx === 0 ? "Cancel" : "← Back"}
          </Button>
          <div className="flex items-center gap-1">
            {activeSteps.map((_, i) => (
              <div key={i} className={cn("h-1.5 rounded-full transition-all",
                i === stepIdx ? "w-4 bg-foreground" : i < stepIdx ? "w-1.5 bg-foreground/40" : "w-1.5 bg-border"
              )} />
            ))}
          </div>
          {isLast ? (
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => void handleCreate()} disabled={create.isPending || !consentComplete()}>
              {create.isPending ? "Creating…" : "Create Campaign"}
            </Button>
          ) : (
            <Button size="sm" className="h-8 text-xs" onClick={next} disabled={!canNext()}>Next →</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Campaign Form Dialog ──────────────────────────────────────────────────

type FieldMappings = { phone: string; name: string; email: string };
const DEFAULT_MAPPINGS: FieldMappings = { phone: "phone", name: "name", email: "email" };

function CampaignFormDialog({
  open,
  onClose,
  editing,
  activeCampaigns,
}: {
  open: boolean;
  onClose: () => void;
  editing: Campaign | null;
  activeCampaigns: Campaign[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateCampaign();
  const update = useUpdateCampaign();
  const { data: agents } = useListAgents();

  const liveAgentIds = new Set(
    activeCampaigns.filter(c => c.status === "active").map(c => c.agentId).filter(Boolean)
  );

  const [name, setName] = useState(editing?.name ?? "");
  const [desc, setDesc] = useState(editing?.description ?? "");
  const [agentId, setAgentId] = useState(editing?.agentId ? String(editing.agentId) : "");
  const [fromNum, setFromNum] = useState(editing?.fromNumber ?? "");
  const [delay, setDelay] = useState(String(editing?.callDelaySeconds ?? 5));
  const [maxAtt, setMaxAtt] = useState(String(editing?.maxAttempts ?? 1));
  const [mappings, setMappings] = useState<FieldMappings>(
    editing?.fieldMappings
      ? {
          phone: (editing.fieldMappings as Record<string, string>)["phone"] ?? "phone",
          name: (editing.fieldMappings as Record<string, string>)["name"] ?? "name",
          email: (editing.fieldMappings as Record<string, string>)["email"] ?? "email",
        }
      : DEFAULT_MAPPINGS
  );

  function reset() {
    setName(""); setDesc(""); setAgentId(""); setFromNum(""); setDelay("5"); setMaxAtt("1");
    setMappings(DEFAULT_MAPPINGS);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !agentId) return;
    const body = {
      name: name.trim(),
      description: desc.trim() || undefined,
      agentId: parseInt(agentId, 10),
      fromNumber: fromNum.trim() || undefined,
      callDelaySeconds: parseInt(delay, 10),
      maxAttempts: parseInt(maxAtt, 10),
      fieldMappings: { phone: mappings.phone, name: mappings.name, email: mappings.email },
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, data: body });
        toast({ title: "Campaign updated" });
      } else {
        await create.mutateAsync({ data: body });
        toast({ title: "Campaign created" });
      }
      await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      reset();
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to save campaign", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{editing ? "Edit Campaign" : "New Campaign"}</DialogTitle>
          <DialogDescription className="text-xs">
            {editing ? "Update campaign settings." : "Set up a new outbound calling campaign."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={e => void handleSubmit(e)} className="space-y-4 mt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Campaign Name <span className="text-destructive">*</span></Label>
            <Input placeholder="e.g. Summer Leads Q3" value={name} onChange={e => setName(e.target.value)} className="h-9 text-xs" required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description <span className="text-muted-foreground/40">(optional)</span></Label>
            <Input placeholder="Short description…" value={desc} onChange={e => setDesc(e.target.value)} className="h-9 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Agent <span className="text-destructive">*</span></Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select an agent…" />
              </SelectTrigger>
              <SelectContent>
                {(agents ?? []).map(a => (
                  <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                    <span className="flex items-center gap-2">
                      {a.name}
                      <span className={cn(
                        "text-[10px] font-medium px-1.5 py-0.5 rounded",
                        liveAgentIds.has(a.id) ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"
                      )}>
                        {liveAgentIds.has(a.id) ? "LIVE" : "—"}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Field Mappings <span className="text-[10px] text-muted-foreground/40">(CSV column → role)</span></Label>
            <div className="grid grid-cols-3 gap-2">
              {(["phone", "name", "email"] as const).map(role => (
                <div key={role}>
                  <p className="text-[10px] text-muted-foreground/40 uppercase mb-1">{role}</p>
                  <Input
                    placeholder={role}
                    value={mappings[role]}
                    onChange={e => setMappings(m => ({ ...m, [role]: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Call Delay (seconds)</Label>
              <Input type="number" min={0} value={delay} onChange={e => setDelay(e.target.value)} className="h-9 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Max Attempts</Label>
              <Input type="number" min={1} value={maxAtt} onChange={e => setMaxAtt(e.target.value)} className="h-9 text-xs" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">From Number <span className="text-muted-foreground/40">(optional override)</span></Label>
            <Input placeholder="+1234567890" value={fromNum} onChange={e => setFromNum(e.target.value)} className="h-9 text-xs" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="h-8 text-xs" disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending ? "Saving…" : editing ? "Save Changes" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon, accent, loading,
}: {
  label: string; value: number; sub?: string; icon: React.ReactNode;
  accent?: string; loading?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3.5 flex items-center gap-3">
      <div className="h-8 w-8 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground/40 leading-none mb-1.5 truncate">{label}</p>
        {loading
          ? <Skeleton className="h-5 w-8 rounded" />
          : <p className={cn("text-xl font-semibold tabular-nums leading-none", accent ?? "text-foreground")}>{value}</p>
        }
        {sub && !loading && <p className="text-[9px] text-muted-foreground/30 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Table Header ───────────────────────────────────────────────────────────

function TableHeader() {
  return (
    <div
      className="grid items-center gap-3 px-4 py-2.5 border-b border-border/60 bg-muted/30"
      style={{ gridTemplateColumns: "2fr 1fr 1fr 80px 80px 100px 56px 80px 1fr 100px" }}
    >
      {[
        "Campaign", "Status", "Agent / Number",
        "Today", "Total", "Progress",
        "Queued", "Booked", "Health", "",
      ].map((h, i) => (
        <span key={i} className={cn("text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/40", i >= 3 && i <= 7 ? "text-center" : "")}>
          {h}
        </span>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  csv: "CSV / Bulk", webhook: "Website / Form", meta_ads: "Meta Ads", crm: "CRM",
};

export default function CampaignsPage() {
  const [createOpen,      setCreateOpen]      = useState(false);
  const [editing,         setEditing]         = useState<Campaign | null>(null);
  const [deleting,        setDeleting]        = useState<Campaign | null>(null);
  const [deleteNameInput, setDeleteNameInput] = useState("");
  const [deletingCamp,    setDeletingCamp]    = useState(false);
  const [search,          setSearch]          = useState("");
  const [filterSource,    setFilterSource]    = useState("__all__");
  const [filterStatus,    setFilterStatus]    = useState("__all__");

  const qc      = useQueryClient();
  const { toast } = useToast();
  const deleteMutation = useDeleteCampaign();

  const { data, isLoading, isFetching } = useQuery<DashboardData>({
    queryKey: ["campaigns-dashboard"],
    queryFn:  () => apiFetchDash<DashboardData>(`${BASE}/api/campaigns/dashboard`),
    refetchInterval: 10_000,
    staleTime:        8_000,
  });

  const stats     = data?.stats;
  const campaigns = data?.campaigns ?? [];

  const filtered = useMemo(() => {
    let rows = campaigns;
    if (filterSource !== "__all__") rows = rows.filter(c => (c as unknown as Record<string,string>)["leadSource"] === filterSource);
    if (filterStatus !== "__all__") rows = rows.filter(c => c.status === filterStatus);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(c => c.name.toLowerCase().includes(q) || (c.agentName ?? "").toLowerCase().includes(q));
    }
    return rows;
  }, [campaigns, filterSource, filterStatus, search]);

  const listScrollRef = useScrollRestoration<HTMLDivElement>("campaigns-list", !isLoading);

  async function handleDelete() {
    if (!deleting || deleteNameInput.trim() !== deleting.name) return;
    setDeletingCamp(true);
    try {
      await deleteMutation.mutateAsync({ id: deleting.id });
      await qc.invalidateQueries({ queryKey: ["campaigns-dashboard"] });
      await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      toast({ title: "Campaign deleted" });
    } catch {
      toast({ title: "Failed to delete campaign", variant: "destructive" });
    } finally {
      setDeletingCamp(false);
      setDeleting(null);
      setDeleteNameInput("");
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Target className="h-3.5 w-3.5 text-muted-foreground/40" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/40">
                Campaign Operations
              </span>
              {isFetching && !isLoading && (
                <span className="h-1 w-1 rounded-full bg-muted-foreground/20 animate-pulse" />
              )}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground leading-none">
              Campaigns
            </h1>
            <p className="text-xs text-muted-foreground/50 mt-1.5">
              Live overview · auto-refreshes every 10 seconds
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New Campaign
            </Button>
          </div>
        </div>

        {/* ── Stats Row ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <StatCard
            label="Active Campaigns"
            value={stats?.activeCampaigns ?? 0}
            icon={<Megaphone className="h-4 w-4 text-emerald-500" />}
            accent={(stats?.activeCampaigns ?? 0) > 0 ? "text-emerald-500" : undefined}
            loading={isLoading}
          />
          <StatCard
            label="Listening Sources"
            value={stats?.listeningCampaigns ?? 0}
            sub="Real-time intake"
            icon={<Wifi className="h-4 w-4 text-sky-500" />}
            accent={(stats?.listeningCampaigns ?? 0) > 0 ? "text-sky-500" : undefined}
            loading={isLoading}
          />
          <StatCard
            label="Live Calls"
            value={stats?.liveCalls ?? 0}
            sub="In progress"
            icon={<PhoneCall className="h-4 w-4 text-blue-500" />}
            accent={(stats?.liveCalls ?? 0) > 0 ? "text-blue-500" : undefined}
            loading={isLoading}
          />
          <StatCard
            label="Queued Leads"
            value={stats?.queuedLeads ?? 0}
            sub="Pending call"
            icon={<Timer className="h-4 w-4 text-amber-500" />}
            accent={(stats?.queuedLeads ?? 0) > 0 ? "text-amber-500" : undefined}
            loading={isLoading}
          />
          <StatCard
            label="Leads Today"
            value={stats?.todayLeads ?? 0}
            sub="Since midnight UTC"
            icon={<Users className="h-4 w-4 text-violet-500" />}
            accent={(stats?.todayLeads ?? 0) > 0 ? "text-violet-500" : undefined}
            loading={isLoading}
          />
          <StatCard
            label="Bookings Today"
            value={stats?.todayBookings ?? 0}
            sub="Meetings booked"
            icon={<BookMarked className="h-4 w-4 text-rose-500" />}
            accent={(stats?.todayBookings ?? 0) > 0 ? "text-rose-500" : undefined}
            loading={isLoading}
          />
        </div>
      </div>

      {/* ── Content ── */}
      <div ref={listScrollRef} className="flex-1 overflow-auto px-6 py-5">
        <div className="bg-card border border-border rounded-2xl overflow-hidden">

          {/* Filter bar */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/60 flex-wrap">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Activity className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 pointer-events-none" />
              <input
                className="w-full h-8 bg-muted/40 border border-border/60 rounded-lg pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Search campaigns…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <Select value={filterSource} onValueChange={setFilterSource}>
              <SelectTrigger className="h-8 w-[140px] text-xs border-border/60 bg-muted/40">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Sources</SelectItem>
                {Object.entries(SOURCE_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 w-[140px] text-xs border-border/60 bg-muted/40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Statuses</SelectItem>
                {Object.entries(STATUS_CFG).map(([v, cfg]) => (
                  <SelectItem key={v} value={v}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(filterSource !== "__all__" || filterStatus !== "__all__" || search) && (
              <button
                className="h-8 px-2.5 text-xs text-muted-foreground/50 hover:text-foreground border border-border/60 rounded-lg flex items-center gap-1.5 transition-colors"
                onClick={() => { setSearch(""); setFilterSource("__all__"); setFilterStatus("__all__"); }}
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}

            <span className="ml-auto text-[10px] text-muted-foreground/30 tabular-nums">
              {filtered.length} campaign{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Table */}
          {isLoading ? (
            <div>
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-b border-border/30 last:border-0">
                  <Skeleton className="h-3.5 flex-1 rounded" />
                  <Skeleton className="h-3 w-16 rounded" />
                  <Skeleton className="h-3 w-24 rounded" />
                  <Skeleton className="h-3 w-10 rounded" />
                  <Skeleton className="h-3 w-10 rounded" />
                  <Skeleton className="h-3 w-20 rounded" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            campaigns.length === 0 ? (
              <div className="py-20 text-center">
                <div className="h-12 w-12 rounded-2xl bg-muted border border-border flex items-center justify-center mx-auto mb-4">
                  <Megaphone className="h-5 w-5 text-muted-foreground/20" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1">No campaigns yet</h3>
                <p className="text-xs text-muted-foreground/40 max-w-xs mx-auto mb-5">
                  Create a campaign to auto-call leads from Instagram ads, website forms, or CSV uploads.
                </p>
                <Button className="h-8 text-xs gap-2" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Create first campaign
                </Button>
              </div>
            ) : (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground/40">No campaigns match your filters.</p>
                <button className="text-xs text-muted-foreground/50 hover:text-foreground mt-2 underline underline-offset-2"
                  onClick={() => { setSearch(""); setFilterSource("__all__"); setFilterStatus("__all__"); }}>
                  Clear filters
                </button>
              </div>
            )
          ) : (
            <>
              <TableHeader />
              {filtered.map(c => (
                <CampaignRow
                  key={c.id}
                  campaign={c}
                  onEdit={row => setEditing(row)}
                  onDelete={row => { setDeleteNameInput(""); setDeleting(row); }}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      <CampaignWizard
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        activeCampaigns={campaigns as unknown as Campaign[]}
      />
      <CampaignFormDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        editing={editing}
        activeCampaigns={campaigns as unknown as Campaign[]}
      />

      <Dialog open={!!deleting} onOpenChange={v => { if (!v) { setDeleting(null); setDeleteNameInput(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Trash2 className="h-4 w-4" /> Delete Campaign
            </DialogTitle>
            <DialogDescription className="text-left pt-1">
              This will permanently delete <strong className="text-foreground">{deleting?.name}</strong> along
              with all its batches, leads, call records, and configuration.
              This action <strong className="text-foreground">cannot be undone</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2.5 text-xs text-red-600">
              All leads, call history, batches, and settings for this campaign will be erased.
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Type <span className="font-mono font-semibold text-foreground">{deleting?.name}</span> to confirm
              </Label>
              <Input
                className="h-9 text-sm"
                placeholder={deleting?.name}
                value={deleteNameInput}
                onChange={e => setDeleteNameInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && deleteNameInput.trim() === deleting?.name) void handleDelete();
                }}
                autoFocus
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" className="h-8 text-xs"
              onClick={() => { setDeleting(null); setDeleteNameInput(""); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-red-600 hover:bg-red-700 text-white"
              disabled={deleteNameInput.trim() !== deleting?.name || deletingCamp}
              onClick={() => void handleDelete()}
            >
              {deletingCamp
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…</>
                : <><Trash2 className="h-3.5 w-3.5" /> Delete Campaign</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
