import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useScrollRestoration } from "@/lib/use-scroll-restoration";
import {
  useCreateCampaign, useUpdateCampaign, useDeleteCampaign,
  getListCampaignsQueryKey,
  getListCrmConnectionsQueryKey,
  useListAgents,
  useListPhoneNumbers,
  useListCrmConnections,
  useGetAccount,
  customFetch,
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
  Copy, Check, Phone, Megaphone, ChevronRight, X,
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
import {
  EMPTY_LEAD_TRANSFER,
  LeadTransferSettings,
  leadTransferReady,
  toLeadTransferPayload,
  type LeadTransferForm,
} from "./lead-transfer-settings";

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

const WIZARD_STEPS = ["info", "source", "crm_mode", "agent", "transfer", "settings", "review"] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];

const STEP_LABELS: Record<WizardStep, string> = {
  info: "Details",
  source: "Source",
  crm_mode: "CRM Mode",
  agent: "Agent",
  transfer: "Transfer",
  settings: "Settings",
  review: "Review",
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
    label: "Zoho CRM",
    description: "Import leads from Zoho CRM. Choose instant trigger or scheduled batch import.",
    icon: <BrandLogoBadge brand="zoho" size={18} className="h-9 w-9 rounded-xl" />,
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
  allowedSources,
  initialSource,
}: {
  open: boolean;
  onClose: () => void;
  activeCampaigns: Campaign[];
  /** When set, only these sources can be chosen. */
  allowedSources?: CampaignLeadSource[];
  /** Pre-select a source from the Start campaign cards (skips source step). */
  initialSource?: CampaignLeadSource | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const create = useCreateCampaign();
  const { data: agents } = useListAgents();
  const { data: phoneNumbers } = useListPhoneNumbers();
  const { data: accountInfo } = useGetAccount();

  const lockedSource = initialSource ?? (allowedSources?.length === 1 ? allowedSources[0]! : null);
  const csvOnly = lockedSource === "csv";
  const sourceOptions = allowedSources?.length
    ? SOURCE_OPTIONS.filter(o => allowedSources.includes(o.value))
    : SOURCE_OPTIONS;

  // User's account-level concurrent call ceiling (set by admin; default 10).
  // The campaign slider caps at the lower of the account limit and the hard
  // platform ceiling of 10 — users can never pick more than 10.
  const CAMPAIGN_CONCURRENCY_CEILING = 10;
  const maxConcurrency = Math.min(accountInfo?.concurrentLimit ?? 10, CAMPAIGN_CONCURRENCY_CEILING);

  const [step, setStep] = useState<WizardStep>("info");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [leadSource, setLeadSource] = useState<CampaignLeadSource>(lockedSource ?? "webhook");
  const [triggerMode, setTriggerMode] = useState<CampaignTriggerMode>(
    SOURCE_OPTIONS.find(o => o.value === (lockedSource ?? "webhook"))?.defaultTrigger ?? "instant",
  );

  // Locked source skips the picker. CRM still gets the mode step.
  const activeSteps = (lockedSource
    ? WIZARD_STEPS.filter(s => s !== "source" && (lockedSource === "crm" || s !== "crm_mode"))
    : leadSource === "crm"
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
  const [concurrentCallLimit, setConcurrentCallLimit] = useState<number | null>(null);
  // Resolved value: user-chosen (if within limit) or clamped to limit.
  const effectiveConcurrency = Math.min(concurrentCallLimit ?? maxConcurrency, maxConcurrency);
  /** Optional squad — attached after create so dial can hand off between agents. */
  const [squadId, setSquadId] = useState<number | null>(null);

  // ── DPDP consent basis (audit-only; required when agent has DPDP on) ──
  const [consentBasisType, setConsentBasisType] = useState<ConsentBasisType | "">("");
  const [consentSource, setConsentSource] = useState("");
  const [consentDateRange, setConsentDateRange] = useState("");
  const [consentProofRef, setConsentProofRef] = useState("");
  const [consentNotes, setConsentNotes] = useState("");
  const [leadTransfer, setLeadTransfer] = useState<LeadTransferForm>(EMPTY_LEAD_TRANSFER);

  const liveAgentIds = new Set(
    activeCampaigns.filter(c => c.status === "active").map(c => c.agentId).filter(Boolean)
  );

  const { data: squads } = useQuery({
    queryKey: ["squads-list"],
    queryFn: () => customFetch<Array<{ id: number; name: string; members?: Array<{ agentId: number; name?: string }> }>>("/api/squads"),
    staleTime: 30_000,
    enabled: open,
  });

  const { data: selectedDisp } = useQuery({
    queryKey: ["disposition-config", agentId],
    queryFn: async () => {
      try {
        return await customFetch<{ taxonomy: Record<string, string[]> }>(`/api/disposition/config/${agentId}`);
      } catch {
        return null;
      }
    },
    enabled: open && !!agentId,
    staleTime: 60_000,
  });

  const dispositionLabels = useMemo(() => {
    const tax = selectedDisp?.taxonomy;
    if (!tax) return [] as string[];
    return Object.entries(tax).flatMap(([cat, vals]) =>
      (vals?.length ? vals : [cat]).map((v) => (vals?.length ? `${cat}: ${v}` : cat)),
    );
  }, [selectedDisp]);

  function reset() {
    const src = lockedSource ?? "webhook";
    setStep("info"); setName(""); setDesc("");
    setLeadSource(src);
    setTriggerMode(SOURCE_OPTIONS.find(o => o.value === src)?.defaultTrigger ?? "instant");
    setAgentId(null); setSquadId(null); setConcurrentCallLimit(null);
    setConsentBasisType(""); setConsentSource(""); setConsentDateRange("");
    setConsentProofRef(""); setConsentNotes("");
    setLeadTransfer(EMPTY_LEAD_TRANSFER);
  }
  function close() { reset(); onClose(); }

  const stepIdx = activeSteps.indexOf(step);
  const isLast = step === "review";
  const selectedAgent = agents?.find(a => a.id === agentId);
  /** Caller ID comes from the number assigned to the agent — not collected in the wizard. */
  const agentFromNumber = useMemo(() => {
    if (!agentId || !phoneNumbers?.length) return null;
    const assigned = phoneNumbers.find(pn => pn.agentId === agentId);
    return assigned?.number ?? null;
  }, [agentId, phoneNumbers]);
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
    if (step === "transfer") return leadTransferReady(leadTransfer);
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
      const cfg = (selectedAgent?.agentConfig ?? {}) as {
        callDefaults?: {
          maxAttempts?: number;
          retryDelayMinutes?: number;
          callDelaySeconds?: number;
          concurrentCallLimit?: number;
        };
      };
      const d = cfg.callDefaults ?? {};
      const transferPayload = toLeadTransferPayload(leadTransfer);
      const created = await create.mutateAsync({
        data: {
          name: name.trim(),
          description: desc.trim() || undefined,
          agentId,
          fromNumber: agentFromNumber ?? undefined,
          concurrentCallLimit: effectiveConcurrency ?? d.concurrentCallLimit,
          consentBasis,
          leadSource,
          triggerMode,
          maxAttempts: d.maxAttempts,
          retryDelayMinutes: d.retryDelayMinutes,
          callDelaySeconds: d.callDelaySeconds,
          ...(transferPayload ? { leadTransfer: transferPayload } : {}),
        } as Parameters<typeof create.mutateAsync>[0]["data"],
      });
      if (squadId) {
        try {
          await customFetch(`/api/squads/${squadId}/connect`, {
            method: "POST",
            body: JSON.stringify({ campaignId: created.id }),
          });
        } catch {
          toast({
            title: "Campaign created — squad not attached",
            description: "You can link a squad from the squad settings page.",
            variant: "destructive",
          });
        }
      }
      await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      toast({
        title: "Campaign created",
        description: name.trim(),
      });
      close();
      // Source-specific next step after create
      if (leadSource === "csv") {
        setLocation(`/app/campaigns/${created.id}/batches/new`);
      } else {
        setLocation(`/app/campaigns/${created.id}`);
      }
    } catch (err) {
      const msg = (err instanceof Error ? err.message : null)
        ?? "Failed to create campaign";
      toast({
        title: "Failed to create campaign",
        description: msg,
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-border shrink-0">
          <div className="text-base font-semibold">
            {csvOnly ? "CSV campaign" : lockedSource === "crm" ? "Zoho CRM campaign" : "New campaign"}
          </div>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            {csvOnly
              ? "Name the campaign and pick an agent — next you’ll upload a CSV batch"
              : lockedSource === "crm"
                ? "Name the campaign and pick an agent — then import from Zoho"
                : "Pick a source and agent — caller ID uses the agent’s number"}
          </p>
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
                <h3 className="text-sm font-semibold mb-0.5">List details</h3>
                <p className="text-xs text-muted-foreground/60">Name this people list</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">List name <span className="text-destructive">*</span></Label>
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
                {sourceOptions.map(opt => {
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
                <p className="text-xs text-muted-foreground/60">
                  Entry agent for this campaign. Optionally attach a squad for handoffs.
                </p>
              </div>
              {!agents?.length ? (
                <div className="py-10 text-center text-muted-foreground/40 text-sm">No agents found. Create an agent first.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {agents.map(agent => {
                    const lang = agent.asrLanguage ?? undefined;
                    const ttsProvider = agent.ttsProvider;
                    const isLive = liveAgentIds.has(agent.id);
                    const isSelected = agentId === agent.id;
                    const assignedNum = phoneNumbers?.find(pn => pn.agentId === agent.id)?.number;
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
                          {assignedNum ? (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-mono">
                              <Phone className="h-2.5 w-2.5" />
                              {assignedNum}
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20">No number</span>
                          )}
                        </div>
                        {isSelected && <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Selected</div>}
                      </button>
                    );
                  })}
                </div>
              )}
              {agentId && dispositionLabels.length > 0 && (
                <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-foreground">Dispositions on this agent</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Outcomes captured on calls — filter them later in History.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {dispositionLabels.slice(0, 12).map((d) => (
                      <span key={d} className="text-[10px] px-2 py-0.5 rounded-full bg-card border border-border text-muted-foreground">
                        {d}
                      </span>
                    ))}
                    {dispositionLabels.length > 12 && (
                      <span className="text-[10px] text-muted-foreground/60">+{dispositionLabels.length - 12} more</span>
                    )}
                  </div>
                </div>
              )}
              {!!squads?.length && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Squad (optional)</Label>
                  <Select
                    value={squadId != null ? String(squadId) : "none"}
                    onValueChange={(v) => setSquadId(v === "none" ? null : Number(v))}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="No squad — single agent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-xs">No squad — single agent</SelectItem>
                      {squads.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)} className="text-xs">
                          {s.name}
                          {s.members?.length ? ` · ${s.members.length} agents` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Squad attaches for handoffs. Per-agent call logs: filter by agent in History.
                  </p>
                </div>
              )}
              {agentId && !agentFromNumber && (
                <p className="text-[11px] text-amber-600 leading-relaxed">
                  This agent has no phone number assigned. Assign one on{" "}
                  <a href={`${BASE}/app/phone-numbers`} className="underline underline-offset-2" target="_blank" rel="noreferrer">
                    Phone numbers
                  </a>
                  {" "}(or ask your provider if numbers are partner-managed).
                </p>
              )}
            </div>
          )}

          {step === "transfer" && (
            <LeadTransferSettings
              agentId={agentId}
              value={leadTransfer}
              onChange={setLeadTransfer}
            />
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
                  { label: "List name", value: name, mono: false },
                  { label: "Description",   value: desc || "—", mono: false },
                  { label: "Lead Source",   value: sourceLabel(leadSource), mono: false },
                  { label: "Trigger",       value: triggerMode === "instant" ? "Instant — auto-dial on arrival" : "Batch-wise — manual batch management", mono: false },
                  { label: "Agent",         value: selectedAgent?.name ?? "—", mono: false },
                  {
                    label: "Squad",
                    value: squadId
                      ? (squads?.find((s) => s.id === squadId)?.name ?? `Squad #${squadId}`)
                      : "None",
                    mono: false,
                  },
                  { label: "Caller ID",     value: agentFromNumber ?? "Agent number (not assigned yet)", mono: !!agentFromNumber },
                  { label: "Concurrent Calls", value: String(effectiveConcurrency), mono: true },
                  {
                    label: "Dispositions",
                    value: dispositionLabels.length
                      ? `${dispositionLabels.length} on agent`
                      : "None configured",
                    mono: false,
                  },
                  {
                    label: "Lead transfer",
                    value: leadTransfer.enabled
                      ? `${leadTransfer.rules.length} rule(s), ${
                          leadTransfer.rules.reduce((n, r) => n + r.dispositions.length, 0)
                        } disposition(s)`
                      : "Off",
                    mono: false,
                  },
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
              {create.isPending ? "Creating…" : csvOnly ? "Create list" : "Create campaign"}
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
        toast({ title: "List updated" });
      } else {
        await create.mutateAsync({ data: body });
        toast({ title: "List created" });
      }
      await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      reset();
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to save list", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{editing ? "Edit list" : "New list"}</DialogTitle>
          <DialogDescription className="text-xs">
            {editing ? "Update this list’s settings." : "Create a people list for outreach."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={e => void handleSubmit(e)} className="space-y-4 mt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">List name <span className="text-destructive">*</span></Label>
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
              {create.isPending || update.isPending ? "Saving…" : editing ? "Save Changes" : "Create list"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Table Header ───────────────────────────────────────────────────────────

function TableHeader({ listLabel = "Campaign" }: { listLabel?: string }) {
  return (
    <div
      className="hidden md:grid items-center gap-3 px-4 py-2.5 border-b border-border/60 bg-muted/30"
      style={{ gridTemplateColumns: "2fr 1fr 1fr 80px 70px 100px 56px 80px 100px" }}
    >
      {[
        listLabel, "Status", "Agent / Number",
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
  csv: "CSV", webhook: "Website", meta_ads: "Meta", crm: "Zoho CRM",
};

type StartSourceId = "meta_ads" | "webhook" | "sheets" | "csv" | "crm";

const START_SOURCES: {
  id: StartSourceId;
  title: string;
  description: string;
  cta: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "meta_ads",
    title: "Meta",
    description: "Connect a Lead Ad form, assign an agent, and dial new fills.",
    cta: "Connect Meta",
    icon: <BrandLogoBadge brand="meta" size={22} className="!h-11 !w-11 !rounded-xl" />,
  },
  {
    id: "webhook",
    title: "Website",
    description: "Create a form webhook and embed snippet for your site.",
    cta: "Connect website",
    icon: (
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background">
        <Globe className="h-5 w-5 text-muted-foreground" />
      </div>
    ),
  },
  {
    id: "sheets",
    title: "Google Sheets",
    description: "Connect a sheet, map columns, and auto-dial new rows.",
    cta: "Connect sheet",
    icon: <BrandLogoBadge brand="googleSheets" size={22} className="!h-11 !w-11 !rounded-xl" />,
  },
  {
    id: "csv",
    title: "CSV file",
    description: "Create a campaign, then upload a batch to dial.",
    cta: "Upload CSV",
    icon: (
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background">
        <Upload className="h-5 w-5 text-muted-foreground" />
      </div>
    ),
  },
  {
    id: "crm",
    title: "Zoho CRM",
    description: "Connect Zoho, then import or auto-dial new CRM leads.",
    cta: "Connect Zoho",
    icon: <BrandLogoBadge brand="zoho" size={22} className="!h-11 !w-11 !rounded-xl" />,
  },
];

export default function CampaignsPage() {
  const [, navigate] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [createSource, setCreateSource] = useState<CampaignLeadSource | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const [deleteNameInput, setDeleteNameInput] = useState("");
  const [deletingCamp, setDeletingCamp] = useState(false);
  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState("__all__");
  const [filterStatus, setFilterStatus] = useState("__all__");

  const qc = useQueryClient();
  const { toast } = useToast();
  const deleteMutation = useDeleteCampaign();
  const { data: crmConnections = [] } = useListCrmConnections({
    query: { queryKey: getListCrmConnectionsQueryKey(), staleTime: 30_000 },
  });
  const zohoConnected = crmConnections.some(c => c.provider === "zoho");

  const { data, isLoading, isFetching } = useQuery<DashboardData>({
    queryKey: ["campaigns-dashboard"],
    queryFn: () => apiFetchDash<DashboardData>(`${BASE}/api/campaigns/dashboard`),
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  const stats = data?.stats;
  const campaigns = data?.campaigns ?? [];

  const filtered = useMemo(() => {
    let rows = campaigns;
    if (filterSource !== "__all__") {
      rows = rows.filter(c => (c as unknown as Record<string, string>)["leadSource"] === filterSource);
    }
    if (filterStatus !== "__all__") rows = rows.filter(c => c.status === filterStatus);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(c => c.name.toLowerCase().includes(q) || (c.agentName ?? "").toLowerCase().includes(q));
    }
    return rows;
  }, [campaigns, filterSource, filterStatus, search]);

  const listScrollRef = useScrollRestoration<HTMLDivElement>("campaigns-list", !isLoading);
  const showClear = filterSource !== "__all__" || filterStatus !== "__all__" || !!search;
  const hasCampaigns = campaigns.length > 0;

  function connectZoho() {
    const token = localStorage.getItem("voiceorch:session") ?? "";
    const url = `${BASE}/api/crm/connect/zoho?returnOrigin=${encodeURIComponent(window.location.origin)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
    window.location.href = url;
  }

  /** Each source has its own setup path — only CSV/Zoho use the in-page campaign wizard. */
  function startFrom(id: StartSourceId) {
    switch (id) {
      case "webhook":
        navigate("/app/connections?setup=website&from=campaigns");
        return;
      case "meta_ads":
        navigate("/app/connections?setup=meta&from=campaigns");
        return;
      case "sheets":
        navigate("/app/automatic-calls/new");
        return;
      case "csv":
        setCreateSource("csv");
        setCreateOpen(true);
        return;
      case "crm":
        if (!zohoConnected) {
          toast({
            title: "Connect Zoho CRM first",
            description: "You’ll return here after authorizing Zoho.",
          });
          connectZoho();
          return;
        }
        setCreateSource("crm");
        setCreateOpen(true);
        return;
    }
  }

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
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {/* Start a campaign */}
      <section className="shrink-0 border-b border-border px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Start a campaign
            </p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.03em] sm:text-2xl">
              Where are your leads coming from?
            </h2>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              Each source has its own setup — connect the channel first, then dial.
            </p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {START_SOURCES.map((src) => {
              const zohoNeedsConnect = src.id === "crm" && !zohoConnected;
              return (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => startFrom(src.id)}
                  className="group flex min-h-[120px] flex-col items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/35"
                >
                  <div className="flex w-full items-start justify-between gap-3">
                    {src.icon}
                    <ArrowRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold tracking-[-0.01em]">{src.title}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                      {src.description}
                    </p>
                    <p className="mt-2.5 text-[11px] font-medium text-foreground/80">
                      {zohoNeedsConnect ? "Connect Zoho →" : `${src.cta} →`}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Your campaigns — list scrolls independently */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-3">
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-[15px] font-semibold tracking-[-0.02em]">Your campaigns</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {isLoading
                  ? "Loading…"
                  : hasCampaigns
                    ? `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`
                    : "None yet — start from a source above"}
                {isFetching && !isLoading ? " · refreshing" : ""}
              </p>
            </div>
            {hasCampaigns && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHelpOpen(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                  title="Campaign guide"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1.5 rounded-lg text-xs"
                  onClick={() => {
                    const token = localStorage.getItem("voiceorch:session");
                    const url = `${BASE}/api/campaigns/export.csv${token ? `?token=${encodeURIComponent(token)}` : ""}`;
                    window.open(url, "_blank");
                  }}
                >
                  <FileText className="h-3.5 w-3.5" /> Export
                </Button>
              </div>
            )}
          </div>

          {hasCampaigns && (
            <div className="shrink-0">
              <MetricStrip cols={6}>
                <MetricCard label="Active" value={stats?.activeCampaigns ?? 0} icon={<Megaphone />} loading={isLoading} />
                <MetricCard label="Listening" value={stats?.listeningCampaigns ?? 0} sub="Real-time intake" icon={<Wifi />} loading={isLoading} />
                <MetricCard label="Live calls" value={stats?.liveCalls ?? 0} sub="In progress" icon={<PhoneCall />} loading={isLoading} />
                <MetricCard label="Queued" value={stats?.queuedLeads ?? 0} sub="Pending call" icon={<Timer />} loading={isLoading} />
                <MetricCard label="Leads today" value={stats?.todayLeads ?? 0} icon={<Users />} loading={isLoading} />
                <MetricCard label="Bookings today" value={stats?.todayBookings ?? 0} icon={<BookMarked />} loading={isLoading} />
              </MetricStrip>
            </div>
          )}

          {hasCampaigns && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-border/60 px-4 py-3">
                <div className="relative min-w-[160px] max-w-xs flex-1">
                  <Activity className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
                  <input
                    className="h-8 w-full rounded-lg border border-border/60 bg-muted/40 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Search campaigns…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <Select value={filterSource} onValueChange={setFilterSource}>
                  <SelectTrigger className="h-8 w-[140px] border-border/60 bg-muted/40 text-xs">
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
                  <SelectTrigger className="h-8 w-[140px] border-border/60 bg-muted/40 text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Statuses</SelectItem>
                    {Object.entries(STATUS_CFG).map(([v, cfg]) => (
                      <SelectItem key={v} value={v}>{cfg.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showClear && (
                  <button
                    type="button"
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-border/60 px-2.5 text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
                    onClick={() => {
                      setSearch("");
                      setFilterSource("__all__");
                      setFilterStatus("__all__");
                    }}
                  >
                    <X className="h-3 w-3" /> Clear
                  </button>
                )}
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/30">
                  {filtered.length} campaign{filtered.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto">
                {isLoading ? (
                  <div>
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="flex items-center gap-3 border-b border-border/30 px-4 py-3.5 last:border-0">
                        <Skeleton className="h-3.5 flex-1 rounded" />
                        <Skeleton className="h-3 w-16 rounded" />
                        <Skeleton className="h-3 w-24 rounded" />
                      </div>
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="px-4 py-12 text-center">
                    <p className="text-sm text-muted-foreground/40">No campaigns match your filters.</p>
                    <button
                      type="button"
                      className="mt-2 text-xs text-muted-foreground/50 underline underline-offset-2 hover:text-foreground"
                      onClick={() => {
                        setSearch("");
                        setFilterSource("__all__");
                        setFilterStatus("__all__");
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <>
                    <TableHeader listLabel="Campaign" />
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
          )}

          {!isLoading && !hasCampaigns && (
            <div className="rounded-2xl border border-dashed border-border/70 px-6 py-10 text-center">
              <p className="text-[13px] text-muted-foreground">
                Your campaigns will show up here after you start one.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Campaign guide */}
      <Sheet open={helpOpen} onOpenChange={setHelpOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b border-border/60 pb-4">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4 text-primary/60" />
              Campaign guide
            </SheetTitle>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/60">
              Pick a lead source, attach an agent and number, then activate to dial.
            </p>
          </SheetHeader>
          <div className="space-y-4 py-5">
            {START_SOURCES.map((src) => (
              <button
                key={src.id}
                type="button"
                className="flex w-full gap-3 rounded-xl border border-border/50 bg-card/40 p-3 text-left hover:bg-muted/30"
                onClick={() => { setHelpOpen(false); startFrom(src.id); }}
              >
                <div className="shrink-0">{src.icon}</div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{src.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/60">{src.description}</p>
                </div>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <CampaignWizard
        key={createSource ?? "any"}
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreateSource(null); }}
        activeCampaigns={campaigns as unknown as Campaign[]}
        initialSource={createSource}
        allowedSources={createSource ? [createSource] : ["csv"]}
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
              <Trash2 className="h-4 w-4" /> Delete campaign
            </DialogTitle>
            <DialogDescription className="pt-1 text-left">
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
              className="h-8 gap-1.5 bg-red-600 text-xs text-white hover:bg-red-700"
              disabled={deleteNameInput.trim() !== deleting?.name || deletingCamp}
              onClick={() => void handleDelete()}
            >
              {deletingCamp
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…</>
                : <><Trash2 className="h-3.5 w-3.5" /> Delete campaign</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
