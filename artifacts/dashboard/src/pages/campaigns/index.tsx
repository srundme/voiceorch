import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
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
  Wifi, WifiOff,
  AlertTriangle, ShieldAlert, Timer, BookMarked,
  Activity, ChevronDown, HelpCircle, FileText, Webhook,
  Building2, ChevronUp, Info, Sparkles, ArrowUpRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MetricCard, MetricStrip } from "@/components/metric-strip";
import { BrandLogo, BrandLogoBadge } from "@/components/brand-logos";

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
  batchCount:     number;
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
  webhook:  <Globe className="h-3.5 w-3.5 text-muted-foreground" />,
  meta_ads: <BrandLogo brand="meta" size={14} />,
  csv:      <Upload className="h-3.5 w-3.5 text-muted-foreground" />,
  crm:      <BrandLogo brand="zoho" size={14} />,
};

// ── Campaign Row ───────────────────────────────────────────────────────────

function CampaignMobileCard({
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
  const completed = campaign.completedLeads;
  const pct = totalCallable > 0 ? Math.round((completed / totalCallable) * 100) : 0;

  return (
    <div
      className="md:hidden px-4 py-3.5 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
      onClick={() => navigate(`${BASE}/app/campaigns/${campaign.id}`)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0">{SOURCE_ICON[(campaign as unknown as Record<string, string>)["leadSource"] ?? "csv"] ?? <Megaphone className="h-3.5 w-3.5 text-muted-foreground/40" />}</span>
            <span className="text-sm font-medium text-foreground truncate">{campaign.name}</span>
          </div>
          <p className="text-[10px] text-muted-foreground/40 mt-0.5">
            {formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true })}
            {campaign.agentName ? ` · ${campaign.agentName}` : ""}
          </p>
        </div>
        <CampaignStatusBadge status={campaign.status} />
      </div>
      <div className="mt-2.5 flex items-center gap-3 text-xs tabular-nums">
        {campaign.callingLeads > 0 && (
          <span className="text-emerald-500 font-semibold">{campaign.callingLeads} live</span>
        )}
        {campaign.queuedLeads > 0 && (
          <span className="text-amber-500 font-semibold">{campaign.queuedLeads} queued</span>
        )}
        <span className="text-muted-foreground/50 ml-auto">{completed}/{totalCallable} · {pct}%</span>
      </div>
      <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-foreground/25 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 justify-end" onClick={e => e.stopPropagation()}>
        <Button
          size="sm"
          variant="outline"
          className="h-8 min-h-10 text-xs gap-1 flex-1 sm:flex-none"
          onClick={e => { e.stopPropagation(); navigate(`${BASE}/app/campaigns/${campaign.id}`); }}
        >
          Open <ChevronRight className="h-3 w-3" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="h-8 w-8 min-h-10 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
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
  const healthCfg     = HEALTH_CFG[campaign.campaignHealth];
  const healthDotCls  = campaign.campaignHealth === "healthy"
    ? "bg-emerald-500"
    : campaign.campaignHealth === "outside_hours"
      ? "bg-muted-foreground/40"
      : campaign.campaignHealth === "validation_error" || campaign.campaignHealth === "webhook_offline"
        ? "bg-red-500"
        : "bg-amber-500";

  return (
    <div
      className="group hidden md:grid items-center gap-3 px-4 py-3.5 hover:bg-muted/20 transition-colors cursor-pointer border-b border-border/40 last:border-0"
      style={{ gridTemplateColumns: "2fr 1fr 1fr 80px 70px 100px 56px 80px 100px" }}
      onClick={() => navigate(`${BASE}/app/campaigns/${campaign.id}`)}
    >
      {/* Campaign name + source */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn("h-1.5 w-1.5 rounded-full shrink-0", healthDotCls)}
            title={healthCfg.label}
          />
          <span className="shrink-0">{SOURCE_ICON[(campaign as unknown as Record<string,string>)["leadSource"] ?? "csv"] ?? <Megaphone className="h-3.5 w-3.5 text-muted-foreground/40" />}</span>
          <span className="text-sm font-medium text-foreground truncate">{campaign.name}</span>
          {((campaign as unknown as Record<string,string>)["triggerMode"] === "instant") && (
            <Zap className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/40 mt-0.5 truncate ml-6.5">
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

      {/* Live calls */}
      <div className="text-center">
        {campaign.callingLeads > 0 ? (
          <p className="text-sm font-semibold tabular-nums text-emerald-500 flex items-center justify-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            {campaign.callingLeads}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/25">—</p>
        )}
      </div>

      {/* Batch count */}
      <div className="text-center">
        <p className="text-sm font-semibold tabular-nums text-foreground">{campaign.batchCount}</p>
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

      {/* Actions */}
      <div className="flex items-center gap-1.5 justify-end" onClick={e => e.stopPropagation()}>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={e => { e.stopPropagation(); navigate(`${BASE}/app/campaigns/${campaign.id}`); }}
        >
          Open <ChevronRight className="h-3 w-3" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
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

const WIZARD_STEPS = ["info", "source", "source_setup", "crm_mode", "agent", "phone", "settings", "review"] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];

const STEP_LABELS: Record<WizardStep, string> = {
  info: "Details", source: "Source", source_setup: "Configure Source", crm_mode: "CRM Mode", agent: "Agent", phone: "Phone", settings: "Settings", review: "Review",
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
    icon: <BrandLogoBadge brand="meta" size={18} className="h-9 w-9 rounded-xl" />,
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
    icon: (
      <div className="flex -space-x-1">
        <BrandLogoBadge brand="hubspot" size={12} className="h-6 w-6" />
        <BrandLogoBadge brand="zoho" size={12} className="h-6 w-6" />
      </div>
    ),
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
  const [agentId, setAgentId] = useState<number | null>(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get("agentId");
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  });
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
    try {
      // ── Smart Agent Studio Auto-Grouping ──
      // If a campaign studio already exists for this agent, attach the new batch/run
      // under the existing studio instead of creating duplicate separate campaign studios.
      const existing = activeCampaigns.find(c => c.agentId === agentId);
      
      if (existing) {
        // If CSV leads or settings were passed, create batch under existing studio
        try {
          await fetch(`${BASE}/api/campaigns/${existing.id}/batches`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim() || `Run Batch #${(existing.totalLeads || 0) + 1}`,
            }),
          });
        } catch {
          // ignore if batch endpoint fails, studio is still reused cleanly
        }
        toast({ 
          title: "Added to Agent Studio", 
          description: `Grouped under existing campaign "${existing.name}"` 
        });
      } else {
        const consentBasis = agentDpdpEnabled && consentBasisType
          ? {
              basisType:        consentBasisType,
              consentSource:    consentSource.trim() || undefined,
              consentDateRange: consentDateRange.trim() || undefined,
              proofReference:   consentProofRef.trim() || undefined,
              notes:            consentNotes.trim() || undefined,
            }
          : undefined;
        const cfg = (selectedAgent?.agentConfig ?? {}) as {
          callDefaults?: {
            maxAttempts?: number;
            retryDelayMinutes?: number;
            callDelaySeconds?: number;
            concurrentCallLimit?: number;
          };
        };
        const d = cfg.callDefaults ?? {};
        await create.mutateAsync({
          data: {
            name: name.trim(),
            description: desc.trim() || undefined,
            agentId,
            fromNumber: fromNumber ?? undefined,
            concurrentCallLimit: effectiveConcurrency ?? d.concurrentCallLimit,
            consentBasis,
            leadSource,
            triggerMode,
            maxAttempts: d.maxAttempts,
            retryDelayMinutes: d.retryDelayMinutes,
            callDelaySeconds: d.callDelaySeconds,
          } as Parameters<typeof create.mutateAsync>[0]["data"],
        });
        toast({ title: "Campaign studio created", description: name.trim() });
      }

      await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
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
          <div className="text-base font-semibold">New campaign studio</div>
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

          {step === "source_setup" && (
            <div className="space-y-4">
              {/* Option A: CSV / Bulk Upload */}
              {leadSource === "csv" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2 mb-0.5">
                      <Upload className="h-4 w-4 text-purple-500" />
                      Spreadsheet & CSV File Setup
                    </h3>
                    <p className="text-xs text-muted-foreground/60">
                      Upload a CSV file or connect a Google Sheet link to import leads.
                    </p>
                  </div>

                  <div className="border-2 border-dashed border-border/80 rounded-xl p-6 text-center hover:bg-muted/20 transition-all cursor-pointer relative bg-muted/5">
                    <Upload className="h-7 w-7 text-purple-500 mx-auto mb-2" />
                    <p className="text-xs font-semibold text-foreground">
                      Click to upload or drag & drop CSV file
                    </p>
                    <p className="text-[11px] text-muted-foreground/70 mt-1">
                      Supported columns: <code className="bg-muted px-1.5 py-0.5 rounded text-[10px]">phone</code> (required), <code className="bg-muted px-1.5 py-0.5 rounded text-[10px]">name</code>, <code className="bg-muted px-1.5 py-0.5 rounded text-[10px]">city</code>
                    </p>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-border/50">
                    <Label className="text-xs font-semibold">Or Live Google Sheet Link</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        className="h-9 text-xs"
                      />
                      <Button size="sm" className="h-9 text-xs shrink-0">
                        Connect Sheet
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Option B: Website / Form */}
              {leadSource === "webhook" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2 mb-0.5">
                      <Globe className="h-4 w-4 text-emerald-500" />
                      Website Form & Webhook Setup
                    </h3>
                    <p className="text-xs text-muted-foreground/60">
                      Leads submitting enquiry forms on your website will trigger an instant AI call.
                    </p>
                  </div>

                  <div className="space-y-3 bg-muted/20 border border-border/70 p-4 rounded-xl">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Webhook Endpoint URL</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value="https://voiceorch-development.up.railway.app/api/webhooks/form-trigger"
                          className="h-9 text-xs font-mono bg-muted/40"
                        />
                        <Button size="sm" variant="outline" className="h-9 text-xs shrink-0" onClick={() => toast({ title: "Copied!", description: "Webhook URL copied to clipboard" })}>
                          Copy URL
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-border/50">
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-foreground">Webhook Secret Key</p>
                        <p className="text-[10px] text-muted-foreground">whsec_voiceorch_demo_8932</p>
                      </div>
                      <Button size="sm" variant="secondary" className="h-8 text-xs gap-1.5" onClick={() => toast({ title: "Test Webhook Sent!", description: "Simulated lead +91 98765 43210 trigger sent." })}>
                        <Zap className="h-3 w-3 text-amber-500" />
                        Send Test Submission
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Option C: Meta Ads */}
              {leadSource === "meta_ads" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2 mb-0.5">
                      <BrandLogoBadge brand="meta" size={16} />
                      Meta Ads Integration (Facebook & Instagram)
                    </h3>
                    <p className="text-xs text-muted-foreground/60">
                      Connect your Meta Business Account to auto-dial leads submitted on Facebook/Instagram Lead Forms.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <BrandLogoBadge brand="meta" size={24} />
                        <div>
                          <p className="text-xs font-bold text-foreground">Meta Business Account</p>
                          <p className="text-[10px] text-emerald-500 font-medium">🟢 Connected & Authorized</p>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="h-8 text-xs">
                        Reconnect Meta
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/50">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Select Facebook Page</Label>
                        <Input readOnly value="Departmental Store Official Page" className="h-9 text-xs bg-muted/40" />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Select Lead Form</Label>
                        <Input readOnly value="Q3 Wholesale Grocery Lead Form #802" className="h-9 text-xs bg-muted/40" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Option D: CRM */}
              {leadSource === "crm" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2 mb-0.5">
                      <Zap className="h-4 w-4 text-blue-500" />
                      CRM Connection Setup
                    </h3>
                    <p className="text-xs text-muted-foreground/60">
                      Connect your CRM platform to sync contact lists and trigger automated AI calls.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl border border-foreground bg-foreground/5 text-center space-y-1 cursor-pointer">
                      <BrandLogoBadge brand="hubspot" size={20} className="mx-auto" />
                      <p className="text-xs font-semibold">HubSpot</p>
                      <span className="text-[10px] text-emerald-500 font-medium">Connected</span>
                    </div>

                    <div className="p-3 rounded-xl border border-border bg-card hover:bg-muted/20 text-center space-y-1 cursor-pointer">
                      <BrandLogoBadge brand="zoho" size={20} className="mx-auto" />
                      <p className="text-xs font-medium">Zoho CRM</p>
                      <span className="text-[10px] text-muted-foreground">Click to connect</span>
                    </div>

                    <div className="p-3 rounded-xl border border-border bg-card hover:bg-muted/20 text-center space-y-1 cursor-pointer">
                      <Globe className="h-5 w-5 text-blue-400 mx-auto" />
                      <p className="text-xs font-medium">Salesforce</p>
                      <span className="text-[10px] text-muted-foreground">Click to connect</span>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2">
                    <Label className="text-xs">HubSpot API Access Key / Private Token</Label>
                    <Input placeholder="pat-na1-8932-xxxx-xxxx" className="h-9 text-xs font-mono" />
                  </div>
                </div>
              )}
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
              ) : (
                <div className="space-y-3">
                  {phoneNumbers.length === 0 && (
                    <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 shrink-0 text-amber-400" />
                        <span>Using VoBiz Production Shared Caller IDs (No custom DID required).</span>
                      </div>
                      <a href={`${BASE}/app/phone-numbers`} target="_blank" rel="noreferrer" className="text-[11px] font-semibold underline shrink-0">
                        Buy Custom DID
                      </a>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* Default Production System DIDs + Purchased User DIDs */}
                    {([
                      {
                        num: "+91 80 4700 8932",
                        cc: "IN",
                        type: "VoBiz Production System DID (Recommended)",
                      },
                      {
                        num: "1800 203 8932",
                        cc: "IN",
                        type: "VoBiz Toll-Free Shared DID",
                      },
                      {
                        num: "webcall",
                        cc: "GLOBAL",
                        type: "WebRTC Direct Browser Call",
                      },
                      ...(phoneNumbers ?? []).map(pn => ({
                        num: pn.number,
                        cc: pn.countryCode || "IN",
                        type: pn.numberType || "Purchased Custom DID",
                      })),
                    ]).map((pn, idx) => {
                      const isSelected = fromNumber === pn.num || (!fromNumber && idx === 0);
                      if (!fromNumber && idx === 0) {
                        setFromNumber(pn.num);
                      }
                      return (
                        <button key={pn.num} type="button" onClick={() => setFromNumber(pn.num)}
                          className={cn("text-left p-3 rounded-xl border transition-all",
                            isSelected ? "border-foreground bg-foreground/5 ring-1 ring-foreground" : "border-border bg-card hover:bg-muted/30"
                          )}>
                          <p className="text-sm font-mono font-medium text-foreground">{pn.num}</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            {pn.cc && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">{pn.cc}</span>}
                            {pn.type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 capitalize">{pn.type}</span>}
                          </div>
                          {isSelected && <div className="mt-1.5 flex items-center gap-1 text-[10px] text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Selected</div>}
                        </button>
                      );
                    })}
                  </div>
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

        <div className="px-4 sm:px-6 py-4 border-t border-border shrink-0 flex items-center justify-between pb-safe bg-background/95 backdrop-blur-sm sticky bottom-0 z-10">
          <Button variant="outline" size="sm" className="h-9 min-h-10 text-xs" onClick={stepIdx === 0 ? close : back}>
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
            <Button size="sm" className="h-9 min-h-10 text-xs gap-1.5" onClick={() => void handleCreate()} disabled={create.isPending || !consentComplete()}>
              {create.isPending ? "Creating…" : "Create Campaign"}
            </Button>
          ) : (
            <Button size="sm" className="h-9 min-h-10 text-xs" onClick={next} disabled={!canNext()}>Next →</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Campaign Form Dialog ──────────────────────────────────────────────────

type FieldMappings = { phone: string; name: string; email: string };
const DEFAULT_MAPPINGS: FieldMappings = { phone: "phone", name: "name", email: "email" };
const MAX_CONCURRENT_CALLS = 10;
const LEAD_SOURCE_LABELS: Record<string, string> = {
  csv: "CSV Upload", webhook: "Webhook", meta_ads: "Meta Ads", crm: "CRM",
};

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
  const [maxConcurrent, setMaxConcurrent] = useState(String(editing?.concurrentCallLimit ?? MAX_CONCURRENT_CALLS));
  const leadSource = editing?.leadSource ?? "csv";
  // Preserved on save so existing per-lead field mappings aren't wiped by this quick-edit form.
  const mappings: FieldMappings = editing?.fieldMappings
    ? {
        phone: (editing.fieldMappings as Record<string, string>)["phone"] ?? "phone",
        name: (editing.fieldMappings as Record<string, string>)["name"] ?? "name",
        email: (editing.fieldMappings as Record<string, string>)["email"] ?? "email",
      }
    : DEFAULT_MAPPINGS;

  function reset() {
    setName(""); setDesc(""); setAgentId(""); setFromNum(""); setMaxConcurrent(String(MAX_CONCURRENT_CALLS));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !agentId) return;
    const body = {
      name: name.trim(),
      description: desc.trim() || undefined,
      agentId: parseInt(agentId, 10),
      fromNumber: fromNum.trim() || undefined,
      concurrentCallLimit: Math.min(parseInt(maxConcurrent, 10) || MAX_CONCURRENT_CALLS, MAX_CONCURRENT_CALLS),
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
          <DialogTitle className="text-base">{editing ? "Edit campaign studio" : "New campaign studio"}</DialogTitle>
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
          <div className="space-y-1.5">
            <Label className="text-xs">From Number <span className="text-muted-foreground/40">(optional override)</span></Label>
            <Input placeholder="+1234567890" value={fromNum} onChange={e => setFromNum(e.target.value)} className="h-9 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Max Concurrent Calls</Label>
              <Input
                type="number" min={1} max={MAX_CONCURRENT_CALLS}
                value={maxConcurrent}
                onChange={e => setMaxConcurrent(e.target.value)}
                className="h-9 text-xs"
              />
              <p className="text-[10px] text-muted-foreground/40">Platform ceiling: {MAX_CONCURRENT_CALLS}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Lead Source</Label>
              <div className="h-9 flex items-center px-3 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
                {LEAD_SOURCE_LABELS[leadSource] ?? leadSource}
              </div>
            </div>
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

// ── Table Header ───────────────────────────────────────────────────────────

function TableHeader() {
  return (
    <div
      className="hidden md:grid items-center gap-3 px-4 py-2.5 border-b border-border/60 bg-muted/30"
      style={{ gridTemplateColumns: "2fr 1fr 1fr 80px 70px 100px 56px 80px 100px" }}
    >
      {[
        "Campaign", "Status", "Agent / Number",
        "Live", "Batches", "Progress",
        "Queued", "Booked", "",
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
  const [helpOpen,        setHelpOpen]        = useState(false);
  const [editing,         setEditing]         = useState<Campaign | null>(null);
  const [deleting,        setDeleting]        = useState<Campaign | null>(null);
  const [deleteNameInput, setDeleteNameInput] = useState("");
  const [deletingCamp,    setDeletingCamp]    = useState(false);
  const [search,          setSearch]          = useState("");
  const [filterSource,    setFilterSource]    = useState("__all__");
  const [filterStatus,    setFilterStatus]    = useState("__all__");
  const [portalTarget,    setPortalTarget]    = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.getElementById("stripe-page-actions"));
  }, []);

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

  const actionsContent = (
    <>
      {isFetching && !isLoading && (
        <span className="mr-auto text-[11px] text-muted-foreground hidden sm:inline">Refreshing…</span>
      )}
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        className="h-8 w-8 rounded-lg border border-border/60 bg-muted/40 hover:bg-muted/70 flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-all"
        title="Campaign Studio guide"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs gap-1.5 rounded-lg"
        onClick={() => {
          const token = localStorage.getItem("voiceorch:session");
          const url = `${BASE}/api/campaigns/export.csv${token ? `?token=${encodeURIComponent(token)}` : ""}`;
          window.open(url, "_blank");
        }}
      >
        <FileText className="h-3.5 w-3.5" /> Export
      </Button>
      <Button size="sm" className="h-8 text-xs gap-1.5 rounded-lg" onClick={() => setCreateOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> New campaign studio
      </Button>
    </>
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {portalTarget && createPortal(actionsContent, portalTarget)}
      {/* Stats (no actions here anymore) */}
      <div className="shrink-0 space-y-4 border-b border-border px-4 sm:px-6 py-4">
        <MetricStrip cols={6}>
          <MetricCard
            label="Active flows"
            value={stats?.activeCampaigns ?? 0}
            icon={<Megaphone className="h-4 w-4 text-emerald-500" />}
            accent={(stats?.activeCampaigns ?? 0) > 0 ? "text-emerald-500" : undefined}
            loading={isLoading}
          />
          <MetricCard
            label="Listening Sources"
            value={stats?.listeningCampaigns ?? 0}
            sub="Real-time intake"
            icon={<Wifi className="h-4 w-4 text-sky-500" />}
            accent={(stats?.listeningCampaigns ?? 0) > 0 ? "text-sky-500" : undefined}
            loading={isLoading}
          />
          <MetricCard
            label="Live Calls"
            value={stats?.liveCalls ?? 0}
            sub="In progress"
            icon={<PhoneCall className="h-4 w-4 text-blue-500" />}
            accent={(stats?.liveCalls ?? 0) > 0 ? "text-blue-500" : undefined}
            loading={isLoading}
          />
          <MetricCard
            label="Queued Leads"
            value={stats?.queuedLeads ?? 0}
            sub="Pending call"
            icon={<Timer className="h-4 w-4 text-amber-500" />}
            accent={(stats?.queuedLeads ?? 0) > 0 ? "text-amber-500" : undefined}
            loading={isLoading}
          />
          <MetricCard
            label="Leads Today"
            value={stats?.todayLeads ?? 0}
            sub="Since midnight UTC"
            icon={<Users className="h-4 w-4 text-violet-500" />}
            accent={(stats?.todayLeads ?? 0) > 0 ? "text-violet-500" : undefined}
            loading={isLoading}
          />
          <MetricCard
            label="Bookings Today"
            value={stats?.todayBookings ?? 0}
            sub="Meetings booked"
            icon={<BookMarked className="h-4 w-4 text-rose-500" />}
            accent={(stats?.todayBookings ?? 0) > 0 ? "text-rose-500" : undefined}
            loading={isLoading}
          />
        </MetricStrip>
      </div>

      {/* ── Content ── */}
      <div ref={listScrollRef} className="flex-1 overflow-auto px-4 sm:px-6 py-5">
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
              <div className="py-10 px-6">
                {/* Hero */}
                <div className="text-center mb-8">
                  <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
                    <Megaphone className="h-6 w-6 text-primary/60" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-1.5">Set up how leads reach an agent</h3>
                  <p className="text-xs text-muted-foreground/60 max-w-sm mx-auto leading-relaxed">
                    Prefer Agent → Reach for new setups. This page lists account-wide list and source dials —
                    form, sheet, CSV, or CRM — that fire your voice agent.
                  </p>
                </div>

                {/* How it works */}
                <div className="max-w-2xl mx-auto mb-8">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/40 text-center mb-4">How it works</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                      { icon: <Upload className="h-4 w-4 text-blue-400" />, step: "1", title: "Bring your leads", body: "Connect a CSV, a Meta Ads form, a webhook, or your CRM. Leads flow in automatically." },
                      { icon: <Zap className="h-4 w-4 text-amber-400" />, step: "2", title: "Agent calls instantly", body: "Within seconds of a lead arriving, your voice agent dials the number and starts talking." },
                      { icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />, step: "3", title: "Track every outcome", body: "See bookings, callbacks, transfers, and dispositions per lead. Every call is recorded." },
                    ].map(item => (
                      <div key={item.step} className="rounded-xl border border-border/60 bg-card/60 p-4">
                        <div className="flex items-center gap-2 mb-2.5">
                          <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                            <span className="text-[10px] font-bold text-muted-foreground/60">{item.step}</span>
                          </div>
                          {item.icon}
                        </div>
                        <p className="text-xs font-semibold text-foreground mb-1">{item.title}</p>
                        <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{item.body}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Source types */}
                <div className="max-w-2xl mx-auto mb-8">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/40 text-center mb-4">Lead sources</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { icon: <FileText className="h-4 w-4 text-muted-foreground" />, name: "CSV Upload", desc: "Fixed list from a spreadsheet" },
                      { icon: <Webhook className="h-4 w-4 text-muted-foreground" />, name: "Webhook", desc: "Any system that can POST a lead" },
                      { icon: <BrandLogoBadge brand="meta" size={14} className="h-7 w-7" />, name: "Meta Ads", desc: "Facebook / Instagram form fills" },
                      { icon: (
                        <div className="flex -space-x-1.5">
                          <BrandLogoBadge brand="hubspot" size={12} className="h-6 w-6" />
                          <BrandLogoBadge brand="zoho" size={12} className="h-6 w-6" />
                        </div>
                      ), name: "CRM Import", desc: "HubSpot or Zoho contacts" },
                    ].map(src => (
                      <div key={src.name} className="rounded-lg border border-border/50 bg-card/40 p-3 flex flex-col gap-1.5">
                        {src.icon}
                        <p className="text-xs font-medium text-foreground/80">{src.name}</p>
                        <p className="text-[10px] text-muted-foreground/50 leading-relaxed">{src.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* CTA */}
                <div className="text-center flex items-center justify-center gap-3">
                  <Button className="h-8 text-xs gap-2" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> Create campaign studio
                  </Button>
                  <Button asChild variant="outline" className="h-8 text-xs gap-2">
                    <Link href="/app/agents">Open an agent → Reach</Link>
                  </Button>
                  <button
                    className="text-xs text-muted-foreground/50 hover:text-foreground underline underline-offset-4 transition-colors"
                    onClick={() => setHelpOpen(true)}
                  >
                    Read the guide
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground/40">No campaign studios match your filters.</p>
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
              {filtered.map(c => (
                <CampaignMobileCard
                  key={`m-${c.id}`}
                  campaign={c}
                  onEdit={row => setEditing(row)}
                  onDelete={row => { setDeleteNameInput(""); setDeleting(row); }}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Campaign Guide Slide-over ── */}
      <Sheet open={helpOpen} onOpenChange={setHelpOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border/60">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4 text-primary/60" />
              Campaign Guide
            </SheetTitle>
            <p className="text-[11px] text-muted-foreground/60 leading-relaxed mt-1">
              How list and source dials bind leads to a voice agent.
            </p>
          </SheetHeader>

          <div className="py-5 space-y-7">

            {/* What is a campaign studio */}
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/40 mb-3">What is a campaign studio?</p>
              <div className="rounded-xl border border-border/60 bg-card/60 p-4 text-[11px] text-muted-foreground/70 leading-relaxed space-y-2">
                <p>A campaign studio ties together a <strong className="text-foreground/80">voice agent</strong>, a <strong className="text-foreground/80">phone number</strong>, and a <strong className="text-foreground/80">lead source</strong>.</p>
                <p>When a new lead arrives, the platform dials them automatically. The agent handles the full conversation — qualifying, booking, or transferring — without any human in the loop.</p>
                <p>New setups start from <strong className="text-foreground/80">Agent → Reach</strong>. This page remains the account-wide list of armed dials.</p>
              </div>
            </section>

            {/* Lead Sources */}
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/40 mb-3">Lead Sources</p>
              <div className="space-y-2.5">
                {[
                  {
                    icon: <FileText className="h-3.5 w-3.5 text-blue-400" />,
                    name: "CSV Upload",
                    desc: "Upload a spreadsheet (.csv). Leads are called in row order. Best for bulk outreach from a CRM export or vendor list.",
                    badge: "One-time batch",
                    badgeColor: "bg-blue-500/10 text-blue-500",
                  },
                  {
                    icon: <Webhook className="h-3.5 w-3.5 text-violet-400" />,
                    name: "Webhook",
                    desc: "Any system can POST a lead to a unique URL. The call fires within seconds. Works with Zapier, Make, custom backends, or any contact form.",
                    badge: "Real-time",
                    badgeColor: "bg-violet-500/10 text-violet-500",
                  },
                  {
                    icon: <Instagram className="h-3.5 w-3.5 text-orange-400" />,
                    name: "Meta Ads (Facebook / Instagram)",
                    desc: "Connect a Meta Lead Ads form. When someone fills it out, the platform calls them within 30 seconds — while intent is highest.",
                    badge: "Real-time",
                    badgeColor: "bg-orange-500/10 text-orange-500",
                  },
                  {
                    icon: <Globe className="h-3.5 w-3.5 text-emerald-400" />,
                    name: "CRM Import (HubSpot / Zoho)",
                    desc: "Pull contacts directly from your connected CRM. Imported contacts become a batch, called in the order they're fetched.",
                    badge: "One-time batch",
                    badgeColor: "bg-emerald-500/10 text-emerald-500",
                  },
                ].map(src => (
                  <div key={src.name} className="flex gap-3 p-3 rounded-lg border border-border/50 bg-card/40">
                    <div className="h-6 w-6 rounded-md bg-muted/60 flex items-center justify-center shrink-0 mt-0.5">{src.icon}</div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-foreground/80">{src.name}</span>
                        <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded", src.badgeColor)}>{src.badge}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{src.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Batches */}
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/40 mb-3">Flows vs. Batches</p>
              <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-3">
                {[
                  { icon: <Megaphone className="h-3.5 w-3.5 text-primary/50" />, term: "Campaign Studio", def: "The top-level container. Defines the agent, number, calling hours, and retry rules." },
                  { icon: <Layers className="h-3.5 w-3.5 text-amber-400" />, term: "Batch", def: "One group of leads added at a particular time. A flow can have unlimited batches — each is tracked independently." },
                ].map(item => (
                  <div key={item.term} className="flex gap-3">
                    <div className="h-5 w-5 rounded-md bg-muted/60 flex items-center justify-center shrink-0 mt-0.5">{item.icon}</div>
                    <div>
                      <span className="text-xs font-semibold text-foreground/80">{item.term}</span>
                      <p className="text-[11px] text-muted-foreground/60 leading-relaxed mt-0.5">{item.def}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Quick tips */}
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/40 mb-3">Quick Tips</p>
              <div className="space-y-2">
                {[
                  "Set calling hours to only dial during business hours — leads won't pick up at 2 AM.",
                  "Enable retries (up to 3×) with a 60-minute gap to catch leads who missed the first call.",
                  "Concurrency controls how many simultaneous calls the campaign makes. Start with 2–3 and scale up.",
                  "The agent prompt sets the conversation goal. Be specific: 'Book a 30-min demo call' outperforms 'Qualify the lead'.",
                  "Check the Batch Workspace after the first 50 calls to review dispositions and tweak the agent if needed.",
                ].map((tip, i) => (
                  <div key={i} className="flex gap-2.5 text-[11px] text-muted-foreground/60">
                    <span className="shrink-0 font-mono text-primary/40 text-[10px] mt-0.5">{i + 1}.</span>
                    <span className="leading-relaxed">{tip}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* CTA */}
            <div className="pt-2">
              <Button className="w-full h-9 text-xs gap-2" onClick={() => { setHelpOpen(false); setCreateOpen(true); }}>
                <Plus className="h-3.5 w-3.5" /> Create a Campaign
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Modals ── */}
      <CampaignWizard
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        activeCampaigns={campaigns as unknown as Campaign[]}
      />
      <CampaignFormDialog
        key={editing?.id ?? "new"}
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
