import { useState, useEffect, useMemo, useCallback } from "react";
import { useRoute, useLocation, useSearch, Link } from "wouter";
import {
  useGetCampaign, useListCampaignBatches,
  useDeleteCampaign, useGetCampaignAnalytics, useUpdateCampaign,
  getListCampaignBatchesQueryKey, getGetCampaignQueryKey, getGetCampaignAnalyticsQueryKey,
  getGetBatchAnalyticsQueryOptions,
  useListCrmConnections, useUpdateCrmConnection, getListCrmConnectionsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import type { CrmConnection } from "@workspace/api-client-react";
import { CrmImportDialog } from "../connections";
import { useQueryClient, useQueries, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DetailNav } from "@/components/detail-nav";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getIrdaiBlockedError } from "@/lib/irdai-block";
import {
  ArrowLeft, Copy, Check, Megaphone, Upload, FileText, Layers,
  ChevronRight, ChevronDown, Calendar, Trash2, Users, Clock, AlertCircle,
  CheckCircle2, X, BarChart3, PhoneCall, ArrowRight, Hash,
  Activity, PlayCircle, PauseCircle, XCircle, Settings,
  Phone, Globe, Building2, Zap, ListFilter, Plus,
  PhoneIncoming, ArrowRightLeft, Radio, Ban,
  MoreVertical, MoreHorizontal, RotateCcw, Eye,
  KeyRound, Link2, Link2Off, Loader2, Instagram,
  Download,
  Table2,
  ExternalLink,
} from "lucide-react";
import { CallDetailDrawer } from "@/components/call-detail-drawer";
import { TablePagination } from "@/components/table-pagination";
import { RecampaignDialog } from "./recampaign-dialog";
import { format, formatDistanceToNow } from "date-fns";
import { BATCH_STATUS_MAP, CAMPAIGN_STATUS_MAP } from "@/lib/campaign-status";
import CampaignAnalyticsTab from "./campaign-analytics-tab";
import { CampaignFunnel } from "@/components/campaign-ops/funnel";
import { CampaignLeadsWorkspace } from "@/components/campaign-ops/leads-workspace";
import { CampaignExecutionStrip } from "@/components/campaign-ops/campaign-header";
import {
  isLegacyCampaignTab,
  resolveCampaignTab,
  type CampaignReportingPayload,
  type PrimaryCampaignTab,
} from "@/lib/campaign-lead-reporting";
import {
  EMPTY_LEAD_TRANSFER,
  LeadTransferSettings,
  leadTransferReady,
  readLeadTransfer,
  toLeadTransferPayload,
  type LeadTransferForm,
} from "./lead-transfer-settings";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Tabs ───────────────────────────────────────────────────────────────────────

type CampaignTab = PrimaryCampaignTab;

const CAMPAIGN_TABS: { id: CampaignTab; label: string }[] = [
  { id: "overview", label: "Leads" },
  { id: "analytics", label: "Analytics" },
  { id: "settings", label: "Settings" },
];

// ── Business hours helpers ────────────────────────────────────────────────────

function formatHour(h: number): string {
  if (h === 0)  return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

const COMMON_TZ = [
  { value: "Asia/Kolkata",     label: "IST — India (UTC+5:30)" },
  { value: "Asia/Dubai",       label: "GST — Dubai (UTC+4)" },
  { value: "Asia/Singapore",   label: "SGT — Singapore (UTC+8)" },
  { value: "Asia/Colombo",     label: "SLST — Sri Lanka (UTC+5:30)" },
  { value: "Asia/Dhaka",       label: "BST — Bangladesh (UTC+6)" },
  { value: "Asia/Karachi",     label: "PKT — Pakistan (UTC+5)" },
  { value: "America/New_York", label: "ET — Eastern US (UTC−5/4)" },
  { value: "America/Chicago",  label: "CT — Central US (UTC−6/5)" },
  { value: "America/Denver",   label: "MT — Mountain US (UTC−7/6)" },
  { value: "America/Los_Angeles", label: "PT — Pacific US (UTC−8/7)" },
  { value: "Europe/London",    label: "GMT/BST — London (UTC+0/1)" },
  { value: "Europe/Berlin",    label: "CET — Europe Central (UTC+1/2)" },
  { value: "UTC",              label: "UTC" },
];

// ── CSV parser ───────────────────────────────────────────────────────────────


// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    draft:     <PauseCircle className="h-3 w-3" />,
    running:   <PlayCircle  className="h-3 w-3" />,
    paused:    <PauseCircle className="h-3 w-3" />,
    completed: <CheckCircle2 className="h-3 w-3" />,
    stopped:   <XCircle     className="h-3 w-3" />,
    active:    <PlayCircle  className="h-3 w-3" />,
  };
  const cfg = BATCH_STATUS_MAP[status] ?? CAMPAIGN_STATUS_MAP[status] ?? { label: status, cls: "bg-muted/50 text-muted-foreground border-border" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md border", cfg.cls)}>
      {iconMap[status] ?? <Activity className="h-3 w-3" />}{cfg.label}
    </span>
  );
}

function CampaignStatusBadge({ status }: { status: string }) {
  const cfg = CAMPAIGN_STATUS_MAP[status] ?? { label: status, cls: "bg-muted/50 text-muted-foreground border-border" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md border", cfg.cls)}>
      {cfg.label}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ── CRM Import Button (Overview tab) ──────────────────────────────────────────

function CrmImportButton({ campaignId }: { campaignId: number }) {
  const { data: crmConns = [] } = useListCrmConnections();
  const [importConn, setImportConn] = useState<CrmConnection | null>(null);
  if (crmConns.length === 0) return null;
  return (
    <>
      <div className="flex gap-2 flex-wrap items-center">
        {crmConns.map(conn => (
          <Button key={conn.id} size="sm" variant="outline" className="h-7 text-xs gap-1.5"
            onClick={() => setImportConn(conn)}>
            <Building2 className="h-3 w-3" />
            Import from {conn.accountName ?? conn.provider}
          </Button>
        ))}
      </div>
      {importConn && (
        <CrmImportDialog
          connection={importConn}
          open={true}
          onClose={() => setImportConn(null)}
          defaultCampaignId={campaignId}
        />
      )}
    </>
  );
}

// ── CRM Integration Card ──────────────────────────────────────────────────────

function CrmIntegrationCard({ campaignId, triggerMode, webhookToken }: { campaignId: number; triggerMode?: string; webhookToken?: string }) {
  const { toast } = useToast();
  const { data: crmConns = [] } = useListCrmConnections();
  const updateMut = useUpdateCrmConnection();

  const [importConn, setImportConn] = useState<CrmConnection | null>(null);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [regenSaving, setRegenSaving] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  if (crmConns.length === 0) return null;

  // Each campaign has its own unique webhook URL (connection ID + campaign token).
  // This means multiple campaigns can safely share the same CRM connection —
  // each campaign's URL routes only to that campaign, no overwriting.
  const webhookUrlFor = (conn: CrmConnection) =>
    `${window.location.origin}${BASE}/api/crm/webhook/${conn.provider}/${conn.id}/${webhookToken ?? ""}`;


  const handleRegenSecret = async (conn: CrmConnection) => {
    setRegenSaving(true);
    try {
      const result = await updateMut.mutateAsync({ id: conn.id, data: { regenerateSecret: true } });
      const secret = (result as typeof result & { webhookSecret?: string }).webhookSecret;
      if (secret) setFreshSecret(secret);
      toast({ title: "New webhook secret generated — copy it now" });
    } catch {
      toast({ title: "Failed to regenerate secret", variant: "destructive" });
    } finally {
      setRegenSaving(false);
    }
  };

  return (
    <>
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-muted-foreground/50" />
        <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">CRM Integration</p>
      </div>

      {/* Instant Trigger — only shown for instant-trigger CRM campaigns */}
      {triggerMode === "instant" && (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Activity className="w-3 h-3 text-blue-400 shrink-0" />
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Instant Trigger</p>
          <span className="text-[10px] text-muted-foreground/60">— new leads arriving in your CRM are dialled automatically</span>
        </div>

        {crmConns.map(conn => (
          <div key={conn.id} className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Building2 className="w-3 h-3 text-muted-foreground" />
                {conn.accountName ?? conn.provider} <span className="text-muted-foreground font-normal">({conn.provider})</span>
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-muted-foreground">Webhook URL — paste into your CRM automation</p>
              <div className="flex items-center gap-2 bg-background rounded border border-border px-2 py-1.5">
                <code className="text-[11px] font-mono text-foreground flex-1 truncate">{webhookUrlFor(conn)}</code>
                <CopyButton text={webhookUrlFor(conn)} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium text-muted-foreground">
                Webhook Secret{conn.hasWebhookSecret && <span className="ml-1 text-emerald-400 inline-flex items-center gap-0.5"><CheckCircle2 className="h-3 w-3 shrink-0" />configured</span>}
              </p>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground"
                disabled={regenSaving} onClick={() => void handleRegenSecret(conn)}>
                <KeyRound className="w-3 h-3 mr-1" />
                {conn.hasWebhookSecret ? "Regenerate" : "Generate Secret"}
              </Button>
            </div>
            {freshSecret && (
              <>
                <div className="flex items-center gap-2 bg-background rounded border border-border px-2 py-1.5">
                  <code className="text-[11px] font-mono text-foreground flex-1 truncate">{freshSecret}</code>
                  <CopyButton text={freshSecret} />
                </div>
                <p className="text-[10px] text-amber-400">Copy this secret now — it won&apos;t be shown again</p>
              </>
            )}

            {/* Zoho setup guide */}
            {conn.provider === "zoho" && conn.hasWebhookSecret && (
              <div className="border-t border-border/40 pt-2 mt-1">
                <button
                  type="button"
                  className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                  onClick={() => setShowGuide(g => !g)}
                >
                  {showGuide ? <ChevronDown className="h-3 w-3 inline" /> : <ChevronRight className="h-3 w-3 inline" />} How to set this up in Zoho CRM
                </button>
                {showGuide && (
                  <div className="mt-2 space-y-2 text-[11px] text-muted-foreground leading-relaxed">
                    <p className="font-semibold text-foreground/80">Zoho CRM → Workflow Rule setup</p>
                    <ol className="space-y-1.5 list-none">
                      {[
                        <>In Zoho CRM, click the <strong className="text-foreground"><Settings className="h-3 w-3 inline mr-0.5" />Setup</strong> icon (top-right) → <strong className="text-foreground">Automation → Workflow Rules</strong></>,
                        <>Click <strong className="text-foreground">Create Rule</strong>. Module: <strong className="text-foreground">Leads</strong>. Give it a name like &quot;SnapServe Auto-Call&quot;</>,
                        <>Trigger: <strong className="text-foreground">A record action is performed</strong> → tick <strong className="text-foreground">Create</strong> (fires when a new lead is added)</>,
                        <>Under <strong className="text-foreground">Actions</strong>, click <strong className="text-foreground">+</strong> → choose <strong className="text-foreground">Webhook</strong> → Create new</>,
                        <>Set <strong className="text-foreground">Method: POST</strong>, <strong className="text-foreground">URL Type: JSON</strong><br />
                          <span>Paste this URL:</span>
                          <div className="mt-1 flex items-center gap-2 bg-background rounded border border-border px-2 py-1 font-mono text-[10px] text-foreground">
                            <span className="flex-1 truncate">{webhookUrlFor(conn)}</span>
                            <CopyButton text={webhookUrlFor(conn)} />
                          </div>
                        </>,
                        <>Add a <strong className="text-foreground">Custom Header</strong>:<br />
                          Name: <code className="text-foreground bg-muted px-1 rounded">X-Zoho-Webhook-Secret</code>&nbsp;&nbsp;
                          Value: <em>your secret (generated above)</em>
                        </>,
                        <>Under <strong className="text-foreground">Body</strong>, choose <strong className="text-foreground">User Defined</strong> and paste:
                          <div className="mt-1 bg-background rounded border border-border p-2 font-mono text-[10px] text-foreground whitespace-pre overflow-x-auto">{`{\n  "leads": [{\n    "id": "\${Leads.Lead ID}",\n    "First_Name": "\${Leads.First Name}",\n    "Last_Name": "\${Leads.Last Name}",\n    "Mobile": "\${Leads.Mobile}",\n    "Phone": "\${Leads.Phone}",\n    "Email": "\${Leads.Email}",\n    "Company": "\${Leads.Company}"\n  }]\n}`}</div>
                          <button type="button" className="mt-0.5 text-blue-400 hover:text-blue-300 text-[10px]"
                            onClick={() => void navigator.clipboard.writeText(`{\n  "leads": [{\n    "id": "\${Leads.Lead ID}",\n    "First_Name": "\${Leads.First Name}",\n    "Last_Name": "\${Leads.Last Name}",\n    "Mobile": "\${Leads.Mobile}",\n    "Phone": "\${Leads.Phone}",\n    "Email": "\${Leads.Email}",\n    "Company": "\${Leads.Company}"\n  }]\n}`)}>
                            Copy body template
                          </button>
                        </>,
                        <>Save the webhook. Back on the rule, click <strong className="text-foreground">Save</strong> then <strong className="text-foreground">Activate</strong>. Done — every new lead in Zoho will now trigger an instant call from this campaign.</>,
                      ].map((step, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="shrink-0 w-4 h-4 rounded-full bg-blue-500/15 text-blue-400 flex items-center justify-center text-[10px] font-bold mt-0.5">{i + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        <p className="text-[10px] text-muted-foreground/60 pt-1">
          Each campaign has its own webhook URL — you can safely use the same CRM account across multiple campaigns.
        </p>
      </div>
      )}

      {/* Import from CRM — always available for all CRM campaigns (instant and batch) */}
      <div className={cn("space-y-3", triggerMode === "instant" && "border-t border-border/60 pt-3 mt-1")}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Users className="w-3 h-3 text-emerald-400 shrink-0" />
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Import from CRM</p>
          <span className="text-[10px] text-muted-foreground/60">— pull contacts into a calling batch</span>
        </div>
        <p className="text-xs text-muted-foreground/70">
          Choose a connected CRM account to import contacts as a new calling batch.
        </p>
        <div className="flex flex-wrap gap-2">
          {crmConns.map(conn => (
            <Button key={conn.id} size="sm" className="h-8 text-xs gap-1.5"
              onClick={() => setImportConn(conn)}>
              <Building2 className="h-3.5 w-3.5" />
              Import from {conn.accountName ?? conn.provider}
            </Button>
          ))}
        </div>
      </div>
    </div>

    {importConn && (
      <CrmImportDialog
        connection={importConn}
        open={true}
        onClose={() => setImportConn(null)}
        defaultCampaignId={campaignId}
      />
    )}
    </>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-4 border-b border-border last:border-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-xs font-mono text-foreground/70">{value}</div>
    </div>
  );
}

// ── Campaign tab placeholder ──────────────────────────────────────────────────


// ── Webhook Intake URL Card ───────────────────────────────────────────────────

function WebhookIntakeCard({ webhookUrl }: { webhookUrl: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-muted/20">
      <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
        <Globe className="h-4 w-4 text-violet-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Webhook Intake URL</p>
        <code className="text-[11px] font-mono text-foreground/70 truncate block">{webhookUrl}</code>
      </div>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        title="Copy URL"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ── Meta Integration Card ─────────────────────────────────────────────────────

type MetaValidationError = {
  receivedFormId: string;
  expectedFormId: string | null;
  receivedPageId?: string | null;
  expectedPageId?: string | null;
  webhookToken: string;
  timestamp: string;
  reason: string;
};

type MetaCampaignProps = {
  webhookToken: string;
  lastWebhookAt?: string | null;
  lastWebhookStatus?: string | null;
  sourceFormId?: string | null;
  sourcePageId?: string | null;
  metaPageAccessTokenHint?: string | null;
  lastValidationError?: MetaValidationError | null;
};

function MetaIntegrationCard({
  campaignId,
  campaign,
}: {
  campaignId: number;
  campaign: MetaCampaignProps;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const update = useUpdateCampaign();

  const [formId,     setFormId]     = useState(campaign.sourceFormId ?? "");
  const [pageId,     setPageId]     = useState(campaign.sourcePageId ?? "");
  const [pageToken,  setPageToken]  = useState("");
  const [editing,    setEditing]    = useState(false);
  const [saving,     setSaving]     = useState(false);

  useEffect(() => {
    setFormId(campaign.sourceFormId ?? "");
    setPageId(campaign.sourcePageId ?? "");
  }, [campaign.sourceFormId, campaign.sourcePageId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = {
        sourceFormId: formId.trim() || null,
        sourcePageId: pageId.trim() || null,
      };
      // Only send the token if the user typed a new one (blank = keep existing)
      if (pageToken.trim()) data.metaPageAccessToken = pageToken.trim();
      await update.mutateAsync({ id: campaignId, data });
      await qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
      setEditing(false);
      setPageToken("");
      toast({ title: "Meta Integration saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setFormId(campaign.sourceFormId ?? "");
    setPageId(campaign.sourcePageId ?? "");
    setPageToken("");
  };

  const lastErr      = campaign.lastValidationError;
  const hasErr       = !!lastErr;
  const isConfigured = !!campaign.sourceFormId;
  const hasToken     = !!campaign.metaPageAccessTokenHint;
  const tokenMissing = !hasToken;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Instagram className="h-4 w-4 text-purple-400" />
          <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">Meta Lead Ads Integration</p>
        </div>
        {!editing && (
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-muted-foreground"
            onClick={() => setEditing(true)}>
            <Settings className="h-3 w-3" /> Configure
          </Button>
        )}
      </div>

      {/* Validation error banner */}
      {hasErr && (
        <div className="flex items-start gap-3 px-3 py-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.08]">
          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-amber-600 mb-0.5">Form ID Mismatch Detected</p>
            <p className="text-xs text-muted-foreground/70">
              Incoming Meta lead received from an unexpected Lead Form. Please verify your Meta Ads Manager configuration.
            </p>
            <div className="mt-2 space-y-0.5 font-mono text-[10px] text-muted-foreground/60">
              <p>Received: <span className="text-foreground/80">{lastErr!.receivedFormId}</span></p>
              {lastErr!.expectedFormId && (
                <p>Expected: <span className="text-foreground/80">{lastErr!.expectedFormId}</span></p>
              )}
              <p>Reason: <span className="text-foreground/70 font-sans">{lastErr!.reason}</span></p>
              <p className="text-muted-foreground/40">
                {new Date(lastErr!.timestamp).toLocaleString(undefined, {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Status strip */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
          <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/40 mb-1">Webhook Status</p>
          {campaign.lastWebhookStatus === "ok" && !hasErr ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-500">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </span>
          ) : campaign.lastWebhookStatus === "error" || hasErr ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-500">
              <AlertCircle className="h-3 w-3" /> Validation Error
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/50">Awaiting first event</span>
          )}
        </div>
        <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
          <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/40 mb-1">Last Lead Received</p>
          <span className="text-[10px] text-muted-foreground/70">
            {campaign.lastWebhookAt
              ? new Date(campaign.lastWebhookAt).toLocaleString(undefined, {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                })
              : "—"}
          </span>
        </div>
      </div>

      {/* Page Access Token warning — shown when not configured */}
      {tokenMissing && (
        <div className="flex items-start gap-3 px-3 py-3 rounded-lg border border-red-500/30 bg-red-500/[0.06]">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-red-600 mb-0.5">Page Access Token Required</p>
            <p className="text-[10px] text-muted-foreground/70">
              Meta webhooks only send a lead ID — the actual fields (phone, name, email)
              must be fetched from the Graph API using your Page Access Token.
              Click <strong>Configure</strong> to add it.
            </p>
          </div>
        </div>
      )}

      {/* Configuration: read view */}
      {!editing ? (
        <div className="space-y-2">
          {/* Token status row */}
          <div className="flex items-center justify-between">
            <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/40">Page Access Token</p>
            <span className={cn(
              "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border",
              hasToken
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                : "bg-red-500/10 text-red-500 border-red-500/20",
            )}>
              {hasToken
                ? <><CheckCircle2 className="h-2.5 w-2.5" /> Configured ({campaign.metaPageAccessTokenHint})</>
                : <><AlertCircle className="h-2.5 w-2.5" /> Not set — leads won&apos;t be fetched</>}
            </span>
          </div>
          {/* Form/Page ID validation row */}
          <div className="flex items-center justify-between">
            <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/40">Validation</p>
            <span className={cn(
              "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border",
              isConfigured
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                : "bg-muted/50 text-muted-foreground/50 border-border",
            )}>
              {isConfigured
                ? <><CheckCircle2 className="h-2.5 w-2.5" /> Form ID set</>
                : "Optional — all forms accepted"}
            </span>
          </div>
          {isConfigured && (
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground/50 text-[10px] w-20 shrink-0">Form ID</span>
                <span className="font-mono text-[10px] text-foreground/80 truncate">{campaign.sourceFormId}</span>
              </div>
              {campaign.sourcePageId && (
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground/50 text-[10px] w-20 shrink-0">Page ID</span>
                  <span className="font-mono text-[10px] text-foreground/80 truncate">{campaign.sourcePageId}</span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Page Access Token input — REQUIRED for leads to work */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Page Access Token <span className="text-red-400 text-[10px]">(required — leads won&apos;t work without this)</span>
            </Label>
            <Input
              className="h-8 text-xs font-mono"
              type="password"
              placeholder={hasToken ? `Current: ${campaign.metaPageAccessTokenHint} — paste new to replace` : "EAAxxxx..."}
              value={pageToken}
              onChange={e => setPageToken(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground/50">
              Get this from: Meta for Developers → Tools → Graph API Explorer → select your Page →
              generate a Page token with <code className="bg-muted px-0.5 rounded">leads_retrieval</code> +{" "}
              <code className="bg-muted px-0.5 rounded">pages_manage_metadata</code> permissions.
              Stored encrypted. Never shown in full.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Meta Lead Form ID <span className="text-muted-foreground/40 text-[10px]">(optional — restricts to one form)</span>
            </Label>
            <Input
              className="h-8 text-xs font-mono"
              placeholder="e.g. 123456789012345"
              value={formId}
              onChange={e => setFormId(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground/50">
              Found in Meta Ads Manager → Lead Ads → your form → Form ID.
              When set, webhooks from other forms on this Page are rejected.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Meta Page ID <span className="text-muted-foreground/40 text-[10px]">(optional)</span>
            </Label>
            <Input
              className="h-8 text-xs font-mono"
              placeholder="e.g. 987654321098765"
              value={pageId}
              onChange={e => setPageId(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" className="h-7 text-xs gap-1.5" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CampaignDetailPage() {
  const [, params] = useRoute("/app/campaigns/:id");
  const campaignId = parseInt(params?.id ?? "0", 10);
  const { toast } = useToast();
  const qc = useQueryClient();

  const [, setLocation] = useLocation();
  const search = useSearch();
  const [showDeleteCamp,   setShowDeleteCamp]   = useState(false);
  const [deleteNameInput,  setDeleteNameInput]  = useState("");
  const [deletingCamp,     setDeletingCamp]     = useState(false);
  const deleteCampaign = useDeleteCampaign();
  const update = useUpdateCampaign();

  async function handleSaveBusinessHours() {
    const start = hoursStart === "" ? null : parseInt(hoursStart, 10);
    const end   = hoursEnd   === "" ? null : parseInt(hoursEnd,   10);
    try {
      await update.mutateAsync({
        id: campaignId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { businessHoursStart: start, businessHoursEnd: end, timezone: hoursTz, isCallingHoursEnabled: hoursEnabled } as any,
      });
      await qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
      setEditingHours(false);
      toast({ title: "Calling hours saved" });
    } catch {
      toast({ title: "Failed to save calling hours", variant: "destructive" });
    }
  }

  async function handleClearSchedule() {
    try {
      await update.mutateAsync({
        id: campaignId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { businessHoursStart: null, businessHoursEnd: null, timezone: null, isCallingHoursEnabled: true } as any,
      });
      await qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
      setHoursStart("");
      setHoursEnd("");
      setHoursTz("Asia/Kolkata");
      toast({ title: "Schedule cleared — 24/7 dialing" });
    } catch {
      toast({ title: "Failed to clear schedule", variant: "destructive" });
    }
  }

  async function handleStatusChange(status: "active" | "paused" | "draft" | "stopped") {
    try {
      await update.mutateAsync({ id: campaignId, data: { status } });
      await qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
    } catch (err) {
      const irdai = getIrdaiBlockedError(err);
      if (irdai) {
        toast({ title: "Call blocked", description: irdai.message, variant: "destructive" });
      } else {
        toast({ title: "Failed to update status", variant: "destructive" });
      }
    }
  }

  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: campaign, isLoading: campLoading } = useGetCampaign(campaignId, { query: { enabled: campaignId > 0, refetchInterval: 15_000 } as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: batches, isLoading: batchLoading } = useListCampaignBatches(campaignId, { query: { enabled: campaignId > 0, refetchInterval: 10_000 } as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: analytics } = useGetCampaignAnalytics(campaignId, { query: { enabled: campaignId > 0, refetchInterval: 10_000 } as any });
  const reportingQuery = useQuery({
    queryKey: ["campaign-lead-reporting", campaignId],
    queryFn: () => customFetch<CampaignReportingPayload>(`/api/campaigns/${campaignId}/lead-reporting`),
    refetchInterval: 10_000,
    enabled: campaignId > 0,
  });
  const reporting = reportingQuery.data;

  // Business hours editor state — declared after campaign so the useEffect dep is valid
  const [editingHours, setEditingHours] = useState(false);
  const [hoursStart, setHoursStart] = useState<string>("");
  const [hoursEnd,   setHoursEnd]   = useState<string>("");
  const [hoursTz,    setHoursTz]    = useState<string>("Asia/Kolkata");
  const [hoursEnabled, setHoursEnabled] = useState<boolean>(true);
  const tabFromUrl = useMemo(() => {
    const raw = new URLSearchParams(search).get("tab");
    return resolveCampaignTab(raw).tab;
  }, [search]);
  const activeTab = tabFromUrl;
  const setActiveTab = useCallback((id: CampaignTab) => {
    const sp = new URLSearchParams(search);
    if (id === "overview") sp.delete("tab");
    else sp.set("tab", id);
    // Leaving Results clears list filters (view / disposition stay on Results URLs only)
    if (id !== "overview") {
      sp.delete("view");
      sp.delete("disposition");
      sp.delete("dispositionBucket");
    }
    const qs = sp.toString();
    setLocation(`/app/campaigns/${campaignId}${qs ? `?${qs}` : ""}`);
  }, [search, setLocation, campaignId]);

  useEffect(() => {
    const sp = new URLSearchParams(search);
    const raw = sp.get("tab");
    if (!raw) return;
    // Rewrite legacy + old Leads tab onto Results (overview) while keeping filters
    if (!isLegacyCampaignTab(raw) && raw !== "leads") return;
    const resolved = resolveCampaignTab(raw);
    if (resolved.tab === "overview") sp.delete("tab");
    else sp.set("tab", resolved.tab);
    if (resolved.view) sp.set("view", resolved.view);
    if (resolved.operationalOutcome) sp.set("operationalOutcome", resolved.operationalOutcome);
    const qs = sp.toString();
    setLocation(`/app/campaigns/${campaignId}${qs ? `?${qs}` : ""}`);
  }, [search, campaignId, setLocation]);
  const [leadTransferForm, setLeadTransferForm] = useState<LeadTransferForm>(EMPTY_LEAD_TRANSFER);
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [recampaignOpen, setRecampaignOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = campaign as any;
    if (!d) return;
    setHoursStart(d.businessHoursStart != null ? String(d.businessHoursStart) : "");
    setHoursEnd  (d.businessHoursEnd   != null ? String(d.businessHoursEnd)   : "");
    setHoursTz   (d.timezone ?? "Asia/Kolkata");
    setHoursEnabled(d.isCallingHoursEnabled !== false);
    setLeadTransferForm(readLeadTransfer(d.leadTransfer));
  }, [campaign]);

  async function handleSaveLeadTransfer() {
    if (!leadTransferReady(leadTransferForm)) {
      toast({
        title: "Incomplete transfer settings",
        description: "Pick dispositions and a valid destination, or turn transfer off.",
        variant: "destructive",
      });
      return;
    }
    const payload = toLeadTransferPayload(leadTransferForm);
    setSavingTransfer(true);
    try {
      await update.mutateAsync({
        id: campaignId,
        data: { leadTransfer: payload } as any,
      });
      await qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
      toast({ title: "Lead transfer saved" });
    } catch {
      toast({ title: "Failed to save lead transfer", variant: "destructive" });
    } finally {
      setSavingTransfer(false);
    }
  }


  const webhookUrl = campaign
    ? `${window.location.origin}${BASE}/api/webhooks/lead/${campaign.webhookToken}`
    : "";

  const fm = campaign?.fieldMappings as Record<string, string> | undefined;
  const technicalFailed = reporting?.workTechnical.technicalFailed ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isContinuous = ["webhook", "meta_ads", "crm", "google_sheets"].includes((campaign as any)?.leadSource ?? "");
  const agentLabel =
    (campaign as { agentName?: string | null } | undefined)?.agentName?.trim()
    || (campaign?.agentId != null ? `Agent #${campaign.agentId}` : "—");

  // ── Campaign-level summary metrics ────────────────────────────────────────
  const totalBatches     = batches?.length ?? 0;
  const activeBatches    = batches?.filter(b => b.status === "running").length ?? 0;

  // ── Campaign "finished" detection (UI-only) ───────────────────────────────
  // A campaign is finished when it has at least one batch, every batch is in a
  // terminal state (completed/stopped), no queued leads await a batch, and no
  // scheduled retries remain across the campaign. Instant-trigger campaigns are
  // always-on intake and never show the badge.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isInstantTrigger = (campaign as any)?.triggerMode === "instant";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queuedLeadsCount: number = (campaign as any)?.queuedLeadsCount ?? 0;
  const allBatchesTerminal =
    totalBatches > 0 &&
    (batches?.every(b => (b.status as string) === "completed" || b.status === "stopped") ?? false);
  const preFinished = !isInstantTrigger && allBatchesTerminal && queuedLeadsCount === 0;

  // Only fetch per-batch analytics (for pending-retry counts) once the cheap
  // pre-conditions hold, so we don't fan out queries on every campaign view.
  const batchAnalyticsQueries = useQueries({
    queries: (preFinished ? batches ?? [] : []).map(b => ({
      ...getGetBatchAnalyticsQueryOptions(campaignId, b.id),
    })),
  });
  const allAnalyticsLoaded =
    preFinished &&
    batchAnalyticsQueries.length > 0 &&
    batchAnalyticsQueries.every(q => q.data != null);
  const pendingRetriesTotal = batchAnalyticsQueries.reduce(
    (sum, q) => sum + (q.data?.stats.pendingRetries ?? 0),
    0,
  );
  const campaignFinished =
    preFinished && allAnalyticsLoaded && pendingRetriesTotal === 0;

  async function handleDeleteCampaign() {
    if (deleteNameInput.trim() !== campaign?.name) return;
    setDeletingCamp(true);
    try {
      await deleteCampaign.mutateAsync({ id: campaignId });
      toast({ title: "Campaign deleted" });
      setLocation("/app/campaigns");
    } catch {
      toast({ title: "Failed to delete campaign", variant: "destructive" });
      setDeletingCamp(false);
    }
  }

  if (campLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="h-10 w-full bg-muted rounded-xl" />
        <div className="h-64 bg-muted rounded-xl" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-[60vh] text-center">
        <div className="h-12 w-12 rounded-2xl bg-elevated border border-border flex items-center justify-center mb-4">
          <Megaphone className="h-6 w-6 text-muted-foreground/30" />
        </div>
        <p className="text-sm font-medium text-foreground/40">Campaign not found</p>
        <Link href="/app/campaigns">
          <Button variant="outline" size="sm" className="mt-4 gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Campaigns
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
      {/* Header */}
      <div className="px-6 pt-5 pb-0 border-b border-border shrink-0">
        {/* Title & Action row */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <Link href="/app/campaigns">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 -ml-1.5 text-muted-foreground hover:text-foreground rounded-lg"
                  title="Back to Campaigns"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <h2 className="text-xl font-bold tracking-tight text-foreground">{campaign.name}</h2>
              {(() => {
                const isActive = batches?.some(b => b.status === "running") || campaign.status === "active";
                const isPaused = campaign.status === "paused";
                const label = isActive ? "Active" : isPaused ? "Paused" : campaign.status;
                return (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                      isActive && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
                      isPaused && "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800",
                      !isActive && !isPaused && "bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-300 border-slate-200 dark:border-slate-800",
                    )}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        isActive && "bg-emerald-500",
                        isPaused && "bg-amber-500",
                        !isActive && !isPaused && "bg-slate-400",
                      )}
                    />
                    {label}
                  </span>
                );
              })()}
            </div>

            {/* Metadata Line */}
            <div className="flex items-center gap-3 mt-2 flex-wrap text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <span className="h-5 w-5 rounded-full bg-muted/80 text-foreground flex items-center justify-center text-[10px] font-bold uppercase">
                  {agentLabel ? agentLabel.charAt(0) : "A"}
                </span>
                {agentLabel}
              </span>
              {campaign.fromNumber && (
                <>
                  <span className="text-border">|</span>
                  <span className="font-mono flex items-center gap-1">
                    <Phone className="h-3 w-3 text-muted-foreground" /> {campaign.fromNumber}
                  </span>
                </>
              )}
              <span className="text-border">|</span>
              <span className="uppercase font-medium">
                {(campaign as { leadSource?: string }).leadSource?.replace(/_/g, " ") || "CSV"}
              </span>
              <span className="text-border">|</span>
              <span className="tabular-nums">
                {totalBatches} batch{totalBatches === 1 ? "" : "es"}
              </span>
              {campaign.createdAt && (
                <>
                  <span className="text-border">|</span>
                  <span>Created on {format(new Date(campaign.createdAt), "d MMM yyyy")}</span>
                </>
              )}
            </div>
          </div>

          {/* Top Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Call this list again */}
            {(!isContinuous || ((analytics?.dispositions?.length ?? 0) > 0 || technicalFailed > 0)) && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 px-3 text-xs gap-1.5 rounded-lg border-border font-medium"
                onClick={() => setRecampaignOpen(true)}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Call this list again
              </Button>
            )}

            {/* Upload more leads */}
            {(!isContinuous || campaign.status === "draft") && (
              <Button
                size="sm"
                className="h-9 px-3.5 text-xs gap-1.5 font-medium bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white rounded-lg shadow-sm"
                onClick={() => setLocation(`/app/campaigns/${campaignId}/batches/new`)}
              >
                <Upload className="h-3.5 w-3.5" /> Upload more leads
              </Button>
            )}

            {/* Pause / Resume Controls for active/paused */}
            {campaign.status === "active" && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 px-2.5 text-xs gap-1.5 text-amber-600 border-amber-500/40 hover:bg-amber-500/10 rounded-lg"
                onClick={() => void handleStatusChange("paused")}
              >
                <PauseCircle className="h-3.5 w-3.5" /> Pause
              </Button>
            )}
            {campaign.status === "paused" && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 px-2.5 text-xs gap-1.5 text-emerald-600 border-emerald-500/40 hover:bg-emerald-500/10 rounded-lg"
                onClick={() => void handleStatusChange("active")}
              >
                <PlayCircle className="h-3.5 w-3.5" /> Resume
              </Button>
            )}

            {/* More Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="outline" className="h-9 w-9 rounded-lg">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setActiveTab("analytics")}>Analytics</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocation(`/app/analytics?campaignId=${campaignId}`)}>
                  Workspace analytics
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setRecampaignOpen(true)}>Re-campaign</DropdownMenuItem>
                {campaign.status !== "stopped" && (
                  <DropdownMenuItem
                    className="text-red-500"
                    onClick={() => void handleStatusChange("stopped")}
                  >
                    Stop campaign
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => { setDeleteNameInput(""); setShowDeleteCamp(true); }}
                >
                  Delete campaign
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center px-0 border-b border-border/60 overflow-x-auto scrollbar-hide gap-4">
          {CAMPAIGN_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 pb-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0",
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

        {/* Content */}
        <div className="px-4 sm:px-6 py-4 min-w-0 flex-1 min-h-0 overflow-y-auto space-y-5">
          {activeTab === "overview" && (
            <CampaignLeadsWorkspace campaignId={campaignId} />
          )}

          {/* ── SETTINGS tab ──────────────────────────────────────── */}
          {activeTab === "settings" && (<>

          <section className="space-y-1">
            <h2 className="text-sm font-semibold">General</h2>
            <p className="text-xs text-muted-foreground">
              {agentLabel}
              {campaign.fromNumber ? ` · ${campaign.fromNumber}` : ""}
              {" · "}
              {(campaign as { leadSource?: string }).leadSource?.replace(/_/g, " ") || "source"}
            </p>
          </section>

          <h2 className="text-sm font-semibold">Source / Integrations</h2>

          {/* Webhook Intake URL — only for webhook/Meta intake campaigns */}
          {campaign.webhookToken && (campaign as any).leadSource !== "csv" && (
            <>
              <WebhookIntakeCard webhookUrl={webhookUrl} />
              {(campaign as any).leadSource === "meta_ads" && (
                <MetaIntegrationCard campaignId={campaignId} campaign={campaign as unknown as MetaCampaignProps} />
              )}
            </>
          )}

          {/* CRM Integration — only shown for CRM-sourced campaigns */}
          {(campaign as any).leadSource === "crm" && (
            <CrmIntegrationCard campaignId={campaignId} triggerMode={(campaign as any).triggerMode} webhookToken={campaign.webhookToken} />
          )}

          <div className="bg-card border border-border rounded-xl p-4 space-y-4">
            <LeadTransferSettings
              agentId={campaign.agentId ?? null}
              campaignId={campaignId}
              value={leadTransferForm}
              onChange={setLeadTransferForm}
              compact
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5"
                disabled={savingTransfer || update.isPending}
                onClick={() => void handleSaveLeadTransfer()}
              >
                {savingTransfer ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save lead transfer
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              WhatsApp / email after a call are configured on the agent (Builder → Disposition → After-call messages).
            </p>
          </div>

          {/* Calling Hours — instant trigger campaigns only */}
          {(campaign as unknown as Record<string, unknown>)["triggerMode"] === "instant" && (
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground/50" />
                  <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">Calling Hours</p>
                </div>
                {!editingHours && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-muted-foreground"
                      onClick={() => setEditingHours(true)}>
                      <Settings className="h-3 w-3" /> Configure
                    </Button>
                  </div>
                )}
              </div>
              {!editingHours ? (
                <div>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {(campaign as any).isCallingHoursEnabled === false ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted border border-border text-xs font-mono text-muted-foreground">
                        24/7 — Calling Hours Disabled
                      </span>
                    </div>
                  ) : (campaign as any).businessHoursStart != null && (campaign as any).businessHoursEnd != null ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-xs font-mono text-sky-400">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {formatHour((campaign as any).businessHoursStart)} – {formatHour((campaign as any).businessHoursEnd)}
                      </span>
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      <span className="text-xs text-muted-foreground/50">{(campaign as any).timezone ?? "Asia/Kolkata"}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/50">24/7 — no calling restriction. Leads are dialled immediately on arrival.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Toggle */}
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-foreground font-medium">Enable Calling Hours</Label>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={hoursEnabled}
                      onClick={() => setHoursEnabled(v => !v)}
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                        hoursEnabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                          hoursEnabled ? "translate-x-5" : "translate-x-1"
                        )}
                      />
                    </button>
                  </div>
                  {/* Schedule fields (disabled when toggle OFF) */}
                  <div className={cn("space-y-3", !hoursEnabled && "opacity-50 pointer-events-none")}>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Start (hour, 0–23)</Label>
                        <select
                          value={hoursStart}
                          onChange={e => setHoursStart(e.target.value)}
                          className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs font-mono"
                        >
                          <option value="">— no restriction —</option>
                          {Array.from({ length: 24 }, (_, h) => (
                            <option key={h} value={String(h)}>{formatHour(h)}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">End (exclusive, 0–23)</Label>
                        <select
                          value={hoursEnd}
                          onChange={e => setHoursEnd(e.target.value)}
                          className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs font-mono"
                        >
                          <option value="">— no restriction —</option>
                          {Array.from({ length: 24 }, (_, h) => (
                            <option key={h} value={String(h)}>{formatHour(h)}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Timezone</Label>
                      <select
                        value={hoursTz}
                        onChange={e => setHoursTz(e.target.value)}
                        className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs font-mono"
                      >
                        {COMMON_TZ.map(tz => (
                          <option key={tz.value} value={tz.value}>{tz.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground/50">
                    Leads arriving outside this window are queued and dialled automatically when the window opens.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" className="h-7 text-xs" onClick={() => void handleSaveBusinessHours()}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingHours(false)}>Cancel</Button>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(campaign as any).businessHoursStart != null && (campaign as any).businessHoursEnd != null && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-600 ml-auto"
                        onClick={() => { void handleClearSchedule(); }}>
                        Clear Schedule
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold">Danger zone</h2>
            <p className="text-xs text-muted-foreground">
              Stop ends outbound dialling. Delete permanently removes this campaign and its leads.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs text-red-600 border-red-500/40"
                disabled={campaign.status === "stopped"}
                onClick={() => void handleStatusChange("stopped")}
              >
                Stop campaign
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs text-red-600 border-red-500/40"
                onClick={() => { setDeleteNameInput(""); setShowDeleteCamp(true); }}
              >
                Delete campaign
              </Button>
            </div>
          </section>

          </>)}


          {activeTab === "analytics" && (
            <div className="space-y-5">
              <CampaignFunnel
                data={reporting?.funnel}
                rates={reporting?.rates}
                loading={reportingQuery.isLoading}
              />
              {(reporting?.workTechnical || reporting?.rates) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-card px-3.5 py-2.5 text-[12px] text-muted-foreground">
                  <span className="font-medium text-foreground">Telephony</span>
                  <span>Busy {reporting?.workTechnical?.busy ?? 0}</span>
                  <span>No answer {reporting?.workTechnical?.noPickup ?? 0}</span>
                  <span>Voicemail {reporting?.workTechnical?.voicemail ?? 0}</span>
                  <span>Couldn’t reach {reporting?.workTechnical?.technicalFailed ?? 0}</span>
                  {reporting?.rates ? (
                    <span className="text-[11px] text-muted-foreground/80">
                      Legacy success {reporting.rates.legacySuccessRate}%
                    </span>
                  ) : null}
                </div>
              )}
              <CampaignAnalyticsTab
                campaignId={campaignId}
                onAnalysed={() => {
                  void qc.invalidateQueries({ queryKey: getGetCampaignAnalyticsQueryKey(campaignId) });
                }}
              />
            </div>
          )}

        </div>

      <CallDetailDrawer
        open={selectedCallId !== null}
        callId={selectedCallId}
        onClose={() => setSelectedCallId(null)}
      />

      <RecampaignDialog
        open={recampaignOpen}
        onOpenChange={setRecampaignOpen}
        campaignId={campaignId}
        campaignName={campaign?.name}
        dispositions={analytics?.dispositions ?? []}
        statusBreakdown={(analytics as { statusBreakdown?: Record<string, number> } | undefined)?.statusBreakdown}
      />

      {/* ── Delete Campaign dialog ─────────────────────────────────────── */}
      <Dialog open={showDeleteCamp} onOpenChange={v => { if (!v) setShowDeleteCamp(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Trash2 className="h-4 w-4" /> Delete Campaign
            </DialogTitle>
            <DialogDescription className="text-left pt-1">
              This will permanently delete <strong className="text-foreground">{campaign?.name}</strong> along
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
                Type <span className="font-mono font-semibold text-foreground">{campaign?.name}</span> to confirm
              </Label>
              <Input
                className="h-9 text-sm"
                placeholder={campaign?.name}
                value={deleteNameInput}
                onChange={e => setDeleteNameInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && deleteNameInput.trim() === campaign?.name) {
                    void handleDeleteCampaign();
                  }
                }}
                autoFocus
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" className="h-8 text-xs"
              onClick={() => setShowDeleteCamp(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-red-600 hover:bg-red-700 text-white"
              disabled={deleteNameInput.trim() !== campaign?.name || deletingCamp}
              onClick={() => void handleDeleteCampaign()}
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
