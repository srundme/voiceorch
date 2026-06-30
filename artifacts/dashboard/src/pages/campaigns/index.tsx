import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useScrollRestoration } from "@/lib/use-scroll-restoration";
import {
  useListCampaigns, useCreateCampaign, useUpdateCampaign, useDeleteCampaign,
  getListCampaignsQueryKey,
  useGetPlatformAnalyticsQueue,
  useListAgents,
  useListPhoneNumbers,
  useGetAccount,
} from "@workspace/api-client-react";
import type { Campaign, ConsentBasisBasisType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
  Globe, Zap, Upload, Instagram,
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

// ── Status badges ─────────────────────────────────────────────────────────

function CallStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    pending:   { label: "Pending",   icon: <PauseCircle className="h-3 w-3" />,   cls: "bg-muted/50 text-muted-foreground border-border" },
    calling:   { label: "Calling",   icon: <PhoneCall className="h-3 w-3" />,     cls: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
    completed: { label: "Completed", icon: <CheckCircle2 className="h-3 w-3" />,  cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
    failed:    { label: "Failed",    icon: <XCircle className="h-3 w-3" />,       cls: "bg-red-500/10 text-red-500 border-red-500/20" },
    skipped:   { label: "Skipped",   icon: <X className="h-3 w-3" />,             cls: "bg-muted/30 text-muted-foreground/60 border-border" },
  };
  const cfg = map[status] ?? { label: status, icon: null, cls: "bg-muted/50 text-muted-foreground border-border" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md border", cfg.cls)}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function CampaignStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; dot: string }> = {
    draft:     { label: "Draft",     dot: "bg-muted-foreground/40" },
    active:    { label: "Active",    dot: "bg-emerald-500" },
    paused:    { label: "Paused",    dot: "bg-amber-500" },
    completed: { label: "Completed", dot: "bg-blue-500" },
    archived:  { label: "Archived",  dot: "bg-muted-foreground/20" },
  };
  const cfg = map[status] ?? { label: status, dot: "bg-muted-foreground/40" };
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground border border-border bg-muted/40 px-2 py-0.5 rounded-full">
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}



// ── Campaign row ──────────────────────────────────────────────────────────

function CampaignRow({
  campaign,
  onEdit,
  onDelete,
}: {
  campaign: Campaign;
  onEdit: (c: Campaign) => void;
  onDelete: (c: Campaign) => void;
}) {
  const [, navigate] = useLocation();
  const calledPct = campaign.totalLeads > 0
    ? Math.round((campaign.calledLeads / campaign.totalLeads) * 100)
    : 0;

  return (
    <div
      className="group flex items-center gap-4 px-5 py-4 hover:bg-muted/20 transition-colors cursor-pointer border-b border-border/40 last:border-0 relative"
      onClick={() => navigate(`${BASE}/app/campaigns/${campaign.id}`)}
    >
      {/* Icon — reflects lead source */}
      {(() => {
        const src = (campaign as unknown as Record<string, unknown>)["leadSource"] as string ?? "csv";
        const iconMap: Record<string, React.ReactNode> = {
          webhook:   <Globe className="h-4 w-4 text-blue-500" />,
          meta_ads:  <Instagram className="h-4 w-4 text-purple-500" />,
          csv:       <Upload className="h-4 w-4 text-muted-foreground/40" />,
          crm:       <Layers className="h-4 w-4 text-amber-500" />,
        };
        return (
          <div className="h-9 w-9 rounded-xl bg-muted border border-border flex items-center justify-center shrink-0">
            {iconMap[src] ?? <Megaphone className="h-4 w-4 text-muted-foreground/40" />}
          </div>
        );
      })()}

      {/* Name + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate">{campaign.name}</span>
          <CampaignStatusBadge status={campaign.status} />
          {(() => {
            const src = (campaign as unknown as Record<string, unknown>)["leadSource"] as string ?? "csv";
            const trig = (campaign as unknown as Record<string, unknown>)["triggerMode"] as string ?? "batch";
            const srcOpt = SOURCE_OPTIONS.find(o => o.value === src);
            return srcOpt ? (
              <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground/60 border border-border/60">
                {srcOpt.label}
                {trig === "instant" && <Zap className="h-2 w-2 text-emerald-500" />}
              </span>
            ) : null;
          })()}
        </div>
        {campaign.description ? (
          <p className="text-xs text-muted-foreground/50 truncate mt-0.5">{campaign.description}</p>
        ) : (
          <p className="text-xs text-muted-foreground/30 mt-0.5">{formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true })}</p>
        )}
      </div>

      {/* Stats */}
      <div className="hidden sm:flex items-center gap-4 shrink-0">
        <div className="text-center min-w-[52px]">
          <p className="text-[9px] text-muted-foreground/30 uppercase tracking-widest">Leads</p>
          <p className="text-sm font-semibold text-foreground mt-0.5 tabular-nums">{campaign.totalLeads.toLocaleString()}</p>
        </div>
        {campaign.totalLeads > 0 && (
          <div className="flex items-center gap-1.5 w-20 shrink-0">
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-foreground/20 rounded-full" style={{ width: `${calledPct}%` }} />
            </div>
            <span className="text-[10px] text-muted-foreground/40 font-mono w-6 text-right">{calledPct}%</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
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
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              onClick={e => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground/50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[130px]">
            <DropdownMenuItem
              className="text-xs"
              onClick={e => { e.stopPropagation(); onEdit(campaign); }}
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground/60" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs text-red-500 focus:text-red-500 focus:bg-red-500/5"
              onClick={e => { e.stopPropagation(); onDelete(campaign); }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ── Campaign Creation Wizard ──────────────────────────────────────────────

const WIZARD_STEPS = ["info", "source", "agent", "phone", "settings", "review"] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];

const STEP_LABELS: Record<WizardStep, string> = {
  info: "Details", source: "Source", agent: "Agent", phone: "Phone", settings: "Settings", review: "Review",
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
    description: "Import leads from your CRM. Calls are organised into batches you manage manually.",
    icon: <Layers className="h-5 w-5" />,
    defaultTrigger: "batch",
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

  // User's account-level concurrent call ceiling (set by admin; default 15).
  // The campaign slider must never allow a value above this limit.
  const maxConcurrency = accountInfo?.concurrentLimit ?? 15;

  const [step, setStep] = useState<WizardStep>("info");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [leadSource, setLeadSource] = useState<CampaignLeadSource>("webhook");
  const [triggerMode, setTriggerMode] = useState<CampaignTriggerMode>("instant");
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

  const stepIdx = WIZARD_STEPS.indexOf(step);
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
    if (step === "agent") return agentId !== null;
    if (step === "phone") return fromNumber !== null;
    return true;
  }

  function next() {
    const i = WIZARD_STEPS.indexOf(step);
    if (i < WIZARD_STEPS.length - 1) setStep(WIZARD_STEPS[i + 1]!);
  }
  function back() {
    const i = WIZARD_STEPS.indexOf(step);
    if (i > 0) setStep(WIZARD_STEPS[i - 1]!);
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
            {WIZARD_STEPS.map((s, i) => (
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
                {i < WIZARD_STEPS.length - 1 && <div className="flex-1 h-px bg-border" />}
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
                      onClick={() => { setLeadSource(opt.value); setTriggerMode(opt.defaultTrigger); }}
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
                        {opt.defaultTrigger === "instant" ? (
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
            {WIZARD_STEPS.map((_, i) => (
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

// ── Page ──────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const deleteMutation = useDeleteCampaign();
  const { data: campaigns, isLoading } = useListCampaigns();

  async function handleDelete() {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync({ id: deleting.id });
      await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      toast({ title: "Campaign deleted" });
    } catch {
      toast({ title: "Error", description: "Failed to delete campaign", variant: "destructive" });
    }
    setDeleting(null);
  }

  const { data: queueData } = useGetPlatformAnalyticsQueue();
  const totalCampaigns = campaigns?.length ?? 0;
  const runningCampaigns = campaigns?.filter(c => c.status === "active").length ?? 0;

  // Restore the list scroll position when returning from a campaign detail.
  const listScrollRef = useScrollRestoration<HTMLDivElement>("campaigns-list", !isLoading);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Target className="h-3.5 w-3.5 text-muted-foreground/40" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/40">
                Voice Campaigns
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground leading-none">
              Campaigns
            </h1>
            <p className="text-xs text-muted-foreground/50 mt-1.5">
              Auto-call leads from Instagram ads, website forms, or CSV uploads
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" /> New Campaign
            </Button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Running Campaigns", value: runningCampaigns, icon: <Megaphone className="h-4 w-4 text-emerald-500" />, accent: runningCampaigns > 0 ? "text-emerald-500" : "" },
            { label: "Active Calls",      value: (queueData as { activeCalls?: number } | undefined)?.activeCalls ?? 0, icon: <PhoneCall className="h-4 w-4 text-blue-500" />, accent: ((queueData as { activeCalls?: number } | undefined)?.activeCalls ?? 0) > 0 ? "text-blue-500" : "" },
            { label: "Bookings Today",    value: (queueData as { bookingsToday?: number } | undefined)?.bookingsToday ?? 0, icon: <CalendarDays className="h-4 w-4 text-purple-500" />, accent: ((queueData as { bookingsToday?: number } | undefined)?.bookingsToday ?? 0) > 0 ? "text-purple-500" : "" },
            { label: "Callbacks Due",     value: (queueData as { callbacksDue?: number } | undefined)?.callbacksDue ?? 0, icon: <Clock className="h-4 w-4 text-amber-500" />, accent: ((queueData as { callbacksDue?: number } | undefined)?.callbacksDue ?? 0) > 0 ? "text-amber-500" : "" },
          ].map(stat => (
            <div key={stat.label} className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3">
              <div className="h-8 w-8 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                {stat.icon}
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground/40 uppercase tracking-widest leading-none mb-1">{stat.label}</p>
                <p className={cn("text-xl font-semibold tabular-nums leading-none", stat.accent || "text-foreground")}>
                  {stat.value}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div ref={listScrollRef} className="flex-1 overflow-auto px-6 py-5">
        {/* Campaigns List */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {/* Section header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Campaigns</h2>
              <p className="text-xs text-muted-foreground/40 mt-0.5">Manage and monitor your campaigns</p>
            </div>
          </div>


          {isLoading ? (
            <div className="divide-y divide-border/40">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <Skeleton className="h-9 w-9 rounded-xl" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-40 rounded" />
                    <Skeleton className="h-2.5 w-24 rounded" />
                  </div>
                  <Skeleton className="hidden sm:block h-3 w-32 rounded" />
                </div>
              ))}
            </div>
          ) : !campaigns?.length ? (
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
            campaigns.map(c => (
              <CampaignRow
                key={c.id}
                campaign={c}
                onEdit={setEditing}
                onDelete={setDeleting}
              />
            ))
          )}
        </div>
      </div>

      {/* Modals */}
      <CampaignWizard
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        activeCampaigns={campaigns ?? []}
      />
      <CampaignFormDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        editing={editing}
        activeCampaigns={campaigns ?? []}
      />

      <AlertDialog open={!!deleting} onOpenChange={v => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleting?.name}</strong> and all its leads. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
