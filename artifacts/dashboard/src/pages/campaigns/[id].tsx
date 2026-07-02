import { useState, useRef, useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import {
  useGetCampaign, useListCampaignBatches, useCreateCampaignBatch,
  useDeleteCampaign, useDeleteCampaignBatch, useGetCampaignAnalytics, useUpdateCampaign,
  useGetBatchWorkspaceKpis,
  getListCampaignBatchesQueryKey, getGetCampaignQueryKey,
  getGetBatchAnalyticsQueryOptions,
  useListCrmConnections, useUpdateCrmConnection, getListCrmConnectionsQueryKey,
} from "@workspace/api-client-react";
import type { CampaignBatch, CrmConnection } from "@workspace/api-client-react";
import { CrmImportDialog } from "../connections";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DetailNav } from "@/components/detail-nav";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getIrdaiBlockedError } from "@/lib/irdai-block";
import {
  ArrowLeft, Copy, Check, Megaphone, Upload, FileText, Layers,
  ChevronRight, Calendar, Trash2, Users, Clock, AlertCircle,
  CheckCircle2, X, BarChart3, PhoneCall, ArrowRight, Hash,
  Activity, PlayCircle, PauseCircle, XCircle, Info, Settings,
  Phone, Globe, Building2, Zap, ListFilter, Plus,
  PhoneIncoming, ArrowRightLeft, Radio, Ban,
  TrendingUp, DollarSign, Target, MoreVertical, Eye,
  KeyRound, Link2, Link2Off, Loader2, Instagram,
} from "lucide-react";
import { CallDetailDrawer } from "@/components/call-detail-drawer";
import { TablePagination } from "@/components/table-pagination";
import { format, formatDistanceToNow } from "date-fns";
import { BATCH_STATUS_MAP, CAMPAIGN_STATUS_MAP } from "@/lib/campaign-status";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  function parseRow(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { current += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { fields.push(current.trim()); current = ""; }
        else { current += ch; }
      }
    }
    fields.push(current.trim());
    return fields;
  }
  const headers = parseRow(lines[0]!);
  const rows = lines.slice(1).map(line => {
    const values = parseRow(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) obj[h] = values[i] ?? ""; });
    return obj;
  }).filter(row => Object.values(row).some(v => v.trim()));
  return { headers, rows };
}

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
                Webhook Secret{conn.hasWebhookSecret && <span className="ml-1 text-emerald-400">✓ configured</span>}
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
                  {showGuide ? "▾" : "▸"} How to set this up in Zoho CRM
                </button>
                {showGuide && (
                  <div className="mt-2 space-y-2 text-[11px] text-muted-foreground leading-relaxed">
                    <p className="font-semibold text-foreground/80">Zoho CRM → Workflow Rule setup</p>
                    <ol className="space-y-1.5 list-none">
                      {[
                        <>In Zoho CRM, click the <strong className="text-foreground">⚙️ Setup</strong> icon (top-right) → <strong className="text-foreground">Automation → Workflow Rules</strong></>,
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

type PlaceholderColor = "blue" | "purple" | "amber" | "emerald" | "rose";

const PLACEHOLDER_COLORS: Record<PlaceholderColor, { bg: string; border: string; icon: string; badge: string }> = {
  blue:    { bg: "bg-blue-500/5",    border: "border-blue-500/15",    icon: "text-blue-400/50",    badge: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  purple:  { bg: "bg-purple-500/5",  border: "border-purple-500/15",  icon: "text-purple-400/50",  badge: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  amber:   { bg: "bg-amber-500/5",   border: "border-amber-500/15",   icon: "text-amber-400/50",   badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  emerald: { bg: "bg-emerald-500/5", border: "border-emerald-500/15", icon: "text-emerald-400/50", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  rose:    { bg: "bg-rose-500/5",    border: "border-rose-500/15",    icon: "text-rose-400/50",    badge: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
};

function CampaignTabPlaceholder({
  icon, title, description, color = "blue",
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  color?: PlaceholderColor;
}) {
  const c = PLACEHOLDER_COLORS[color];
  return (
    <div className={cn("rounded-2xl border p-10 flex flex-col items-center text-center max-w-md mx-auto mt-8", c.bg, c.border)}>
      <div className={cn("mb-4", c.icon)}>{icon}</div>
      <h3 className="text-sm font-semibold text-foreground/80 mb-1.5">{title}</h3>
      <p className="text-xs text-muted-foreground/50 leading-relaxed mb-4">{description}</p>
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border", c.badge)}>
        Coming in Phase 3
      </span>
    </div>
  );
}

// ── Batch creation wizard ────────────────────────────────────────────────────

type BatchSource = "csv" | "meta";
type BatchWizardStep = "source" | "upload" | "settings" | "review";

function getSteps(source: BatchSource): BatchWizardStep[] {
  return source === "csv" ? ["source", "upload", "settings", "review"] : ["source", "settings", "review"];
}

function CreateBatchWizard({
  open, onClose, campaignId, nextBatchNumber,
}: {
  open: boolean; onClose: () => void; campaignId: number; nextBatchNumber: number;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateCampaignBatch();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<BatchWizardStep>("source");
  const [source, setSource] = useState<BatchSource>("csv");
  const [batchName, setBatchName] = useState(`Batch ${nextBatchNumber}`);
  const [batchDesc, setBatchDesc] = useState("");
  const [csvData, setCsvData] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [fileName, setFileName] = useState("");
  const [parseErr, setParseErr] = useState("");
  const [schedTime, setSchedTime] = useState("");
  const [callDelay, setCallDelay] = useState("5");
  const [maxAttempts, setMaxAttempts] = useState("1");
  const [retryDelay, setRetryDelay] = useState("60");
  const [timezone, setTimezone] = useState("");
  const [bizStart, setBizStart] = useState("");
  const [bizEnd, setBizEnd] = useState("");
  const [maxDaily, setMaxDaily] = useState("");

  function reset() {
    setStep("source"); setSource("csv"); setBatchName(`Batch ${nextBatchNumber}`);
    setBatchDesc(""); setCsvData(null); setFileName(""); setParseErr("");
    setSchedTime(""); setCallDelay("5"); setMaxAttempts("1"); setRetryDelay("60");
    setTimezone(""); setBizStart(""); setBizEnd(""); setMaxDaily("");
  }
  function close() { reset(); onClose(); }

  const steps = getSteps(source);
  const stepIdx = steps.indexOf(step);
  const isLast = step === "review";

  function canNext(): boolean {
    if (step === "source") return batchName.trim().length > 0;
    if (step === "upload") return (csvData?.rows.length ?? 0) > 0;
    return true;
  }

  function next() {
    const i = steps.indexOf(step);
    if (i < steps.length - 1) setStep(steps[i + 1]!);
  }
  function back() {
    const i = steps.indexOf(step);
    if (i > 0) setStep(steps[i - 1]!);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name); setParseErr("");
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const parsed = parseCsv(text);
      if (parsed.rows.length === 0) { setParseErr("No valid rows found."); setCsvData(null); }
      else setCsvData(parsed);
    };
    reader.readAsText(file);
  }

  async function handleSubmit() {
    try {
      await create.mutateAsync({
        id: campaignId,
        data: {
          name: batchName.trim() || `Batch ${nextBatchNumber}`,
          description: batchDesc.trim() || undefined,
          leadSource: source,
          leads: csvData?.rows ?? [],
          scheduledStartAt: schedTime ? new Date(schedTime).toISOString() : null,
          callDelaySeconds: parseInt(callDelay, 10) || 5,
          maxAttempts: parseInt(maxAttempts, 10) || 1,
          retryDelayMinutes: parseInt(retryDelay, 10) || 60,
          timezone: timezone.trim() || undefined,
          businessHoursStart: bizStart ? parseInt(bizStart, 10) : undefined,
          businessHoursEnd: bizEnd ? parseInt(bizEnd, 10) : undefined,
          maxDailyCalls: maxDaily ? parseInt(maxDaily, 10) : undefined,
        } as Parameters<typeof create.mutateAsync>[0]["data"],
      });
      await qc.invalidateQueries({ queryKey: getListCampaignBatchesQueryKey(campaignId) });
      await qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
      toast({ title: "Batch created", description: csvData ? `${csvData.rows.length} leads imported.` : "Batch created." });
      close();
    } catch (err) {
      const irdai = getIrdaiBlockedError(err);
      if (irdai) {
        toast({ title: "Call blocked", description: irdai.message, variant: "destructive" });
      } else {
        toast({ title: "Failed to create batch", variant: "destructive" });
      }
    }
  }

  const STEP_LABELS: Record<BatchWizardStep, string> = {
    source: "Setup", upload: "Upload", settings: "Settings", review: "Review",
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-border shrink-0">
          <DialogTitle className="text-base font-semibold">Create Batch</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground/60 mt-0.5">
            Add a new lead batch to this campaign
          </DialogDescription>
          <div className="flex items-center gap-1.5 mt-4">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-1.5 flex-1">
                <div className={cn(
                  "flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap transition-all",
                  i < stepIdx ? "bg-foreground/10 text-muted-foreground" :
                  i === stepIdx ? "bg-foreground text-background" : "text-muted-foreground/30"
                )}>
                  <span>{i + 1}</span>
                  <span className="hidden sm:inline">{STEP_LABELS[s]}</span>
                </div>
                {i < steps.length - 1 && <div className="flex-1 h-px bg-border" />}
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-5 flex-1 overflow-y-auto min-h-0">
          {step === "source" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-0.5">Batch Setup</h3>
                <p className="text-xs text-muted-foreground/60">Name this batch and choose your lead source</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Batch Name <span className="text-destructive">*</span></Label>
                <Input value={batchName} onChange={e => setBatchName(e.target.value)}
                  className="h-9 text-sm" autoFocus onKeyDown={e => e.key === "Enter" && canNext() && next()} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description <span className="text-muted-foreground/40">(optional)</span></Label>
                <Input placeholder="e.g. Week 2 re-engagement batch" value={batchDesc} onChange={e => setBatchDesc(e.target.value)} className="h-9 text-xs" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Lead Source</Label>
                <div className="grid grid-cols-2 gap-3">
                  {(["csv", "meta"] as BatchSource[]).map(src => (
                    <button key={src} type="button" onClick={() => setSource(src)}
                      className={cn(
                        "p-4 rounded-xl border text-left transition-all",
                        source === src ? "border-foreground bg-foreground/5 ring-1 ring-foreground" : "border-border bg-card hover:bg-muted/30"
                      )}>
                      <div className="flex items-center gap-2 mb-1">
                        {src === "csv" ? <FileText className="h-4 w-4 text-muted-foreground" /> : <Zap className="h-4 w-4 text-muted-foreground" />}
                        <span className="text-sm font-medium capitalize">{src === "csv" ? "CSV Upload" : "Meta / Webhook"}</span>
                      </div>
                      <p className="text-xs text-muted-foreground/60">
                        {src === "csv" ? "Upload a spreadsheet of leads" : "Leads arrive via Meta Ads or webhook"}
                      </p>
                      {source === src && <div className="mt-2 flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Selected</div>}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === "upload" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-0.5">Upload CSV</h3>
                <p className="text-xs text-muted-foreground/60">Upload a CSV file containing your leads. Must include a phone column.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Scheduled Start <span className="text-muted-foreground/40">(optional)</span></Label>
                <Input type="datetime-local" value={schedTime} onChange={e => setSchedTime(e.target.value)} className="h-9 text-xs" />
              </div>
              <div
                className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-foreground/20 transition-colors"
                onClick={() => fileRef.current?.click()}>
                <Upload className="h-7 w-7 text-muted-foreground/30 mx-auto mb-2" />
                {fileName ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground/50" />
                    <span className="text-sm text-foreground/70">{fileName}</span>
                    {csvData && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground/50">Click to select CSV file</p>
                    <p className="text-xs text-muted-foreground/30 mt-1">Must include a phone column</p>
                  </>
                )}
                {parseErr && <div className="flex items-center justify-center gap-1.5 mt-2 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5" />{parseErr}</div>}
              </div>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
              {csvData && csvData.rows.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Preview</Label>
                    <span className="text-xs text-muted-foreground/50">{csvData.rows.length} rows — first 5 shown</span>
                  </div>
                  <div className="border border-border rounded-xl overflow-hidden max-h-44 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/40 border-b border-border">
                          {csvData.headers.map(h => (
                            <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {csvData.rows.slice(0, 5).map((row, i) => (
                          <tr key={i}>
                            {csvData.headers.map(h => (
                              <td key={h} className="px-3 py-2 text-foreground/70 truncate max-w-[120px]">{row[h] ?? ""}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "settings" && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold mb-0.5">Execution Settings</h3>
                <p className="text-xs text-muted-foreground/60">Configure how this batch makes calls. These override campaign-level defaults.</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Call Delay (sec)</Label>
                  <Input type="number" min={0} value={callDelay} onChange={e => setCallDelay(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max Attempts</Label>
                  <Input type="number" min={1} value={maxAttempts} onChange={e => setMaxAttempts(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Retry Delay (min)</Label>
                  <Input type="number" min={1} value={retryDelay} onChange={e => setRetryDelay(e.target.value)} className="h-9 text-xs" />
                </div>
              </div>
              <div className="space-y-3 pt-2 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground">Business Hours <span className="text-muted-foreground/40 font-normal">(optional)</span></p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Timezone</Label>
                    <Input placeholder="e.g. Asia/Kolkata" value={timezone} onChange={e => setTimezone(e.target.value)} className="h-9 text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Start Hour (0–23)</Label>
                    <Input type="number" min={0} max={23} placeholder="9" value={bizStart} onChange={e => setBizStart(e.target.value)} className="h-9 text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">End Hour (0–23)</Label>
                    <Input type="number" min={0} max={23} placeholder="18" value={bizEnd} onChange={e => setBizEnd(e.target.value)} className="h-9 text-xs" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max Daily Calls <span className="text-muted-foreground/40 font-normal">(optional cap)</span></Label>
                  <Input type="number" min={1} placeholder="No limit" value={maxDaily} onChange={e => setMaxDaily(e.target.value)} className="h-9 text-xs w-48" />
                </div>
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-0.5">Review Batch</h3>
                <p className="text-xs text-muted-foreground/60">Confirm before creating.</p>
              </div>
              <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
                {[
                  { label: "Batch Name",   value: batchName },
                  { label: "Lead Source",  value: source === "csv" ? `CSV (${csvData?.rows.length ?? 0} leads)` : "Meta / Webhook" },
                  { label: "Call Delay",   value: `${callDelay}s` },
                  { label: "Max Attempts", value: maxAttempts },
                  { label: "Retry Delay",  value: `${retryDelay} min` },
                  { label: "Scheduled",    value: schedTime ? format(new Date(schedTime), "MMM d, HH:mm") : "Immediate" },
                  ...(timezone ? [{ label: "Timezone", value: timezone }] : []),
                  ...(bizStart && bizEnd ? [{ label: "Business Hours", value: `${bizStart}:00 – ${bizEnd}:00` }] : []),
                  ...(maxDaily ? [{ label: "Max Daily", value: `${maxDaily} calls/day` }] : []),
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-xs text-muted-foreground">{r.label}</span>
                    <span className="text-xs font-medium text-foreground font-mono">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={stepIdx === 0 ? close : back}>
            {stepIdx === 0 ? "Cancel" : "← Back"}
          </Button>
          <div className="flex items-center gap-1">
            {steps.map((_, i) => (
              <div key={i} className={cn("h-1.5 rounded-full transition-all",
                i === stepIdx ? "w-4 bg-foreground" : i < stepIdx ? "w-1.5 bg-foreground/40" : "w-1.5 bg-border"
              )} />
            ))}
          </div>
          {isLast ? (
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => void handleSubmit()} disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create Batch"}
            </Button>
          ) : (
            <Button size="sm" className="h-8 text-xs" onClick={next} disabled={!canNext()}>Next →</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Batch row ────────────────────────────────────────────────────────────────

// ── ScheduledChip ─────────────────────────────────────────────────────────────
// Shows clock icon + formatted date. When launch is ≤24 h away, turns amber
// and shows a live "in Xh Ym" countdown ticking every minute.

function ScheduledChip({ scheduledStartAt }: { scheduledStartAt: string | null | undefined }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!scheduledStartAt) return;
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, [scheduledStartAt]);
  void tick;

  if (!scheduledStartAt) return null;
  const target = new Date(scheduledStartAt);
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return null;

  const within24h = diffMs < 86_400_000;
  const totalMin  = Math.floor(diffMs / 60_000);
  const h         = Math.floor(totalMin / 60);
  const m         = totalMin % 60;
  const inLabel   = h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;

  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md border font-medium",
      within24h
        ? "bg-amber-500/10 text-amber-500 border-amber-500/25"
        : "bg-muted/40 text-muted-foreground/60 border-border/60",
    )}>
      <Clock className="h-2.5 w-2.5" />
      {format(target, "MMM d, HH:mm")}
      {within24h && <span className="opacity-80 ml-0.5 font-normal">· {inLabel}</span>}
    </span>
  );
}

function BatchRow({ batch, index, campaignId, onDelete }: {
  batch: CampaignBatch; index: number; campaignId: number; onDelete: (b: CampaignBatch) => void;
}) {
  const calledPct = batch.totalLeads > 0 ? Math.round((batch.calledLeads / batch.totalLeads) * 100) : 0;
  return (
    <div className="group flex items-center gap-4 px-5 py-4 hover:bg-elevated/20 transition-colors cursor-pointer border-b border-border/60 last:border-0"
      onClick={() => { window.location.href = `${BASE}/app/campaigns/${campaignId}/batches/${batch.id}`; }}>
      <div className="h-8 w-8 rounded-lg bg-elevated border border-border flex items-center justify-center shrink-0">
        <span className="text-xs font-semibold text-muted-foreground">{index}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-medium text-foreground">{batch.name}</p>
          <StatusBadge status={batch.status} />
          {batch.name.startsWith("Live — ") && batch.status === "running" && (
            <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-medium">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              Live
            </span>
          )}
          {(batch as unknown as Record<string, unknown>)["leadSource"] !== "csv" && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 border border-purple-500/20 capitalize">
              {String((batch as unknown as Record<string, unknown>)["leadSource"] ?? "csv")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground/50">
          <span className="flex items-center gap-1"><Users className="h-3 w-3" />{batch.totalLeads} leads</span>
          <span>{batch.calledLeads} called ({calledPct}%)</span>
          <ScheduledChip scheduledStartAt={batch.scheduledStartAt} />
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-2 w-28">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-foreground/20 rounded-full transition-all" style={{ width: `${calledPct}%` }} />
        </div>
        <span className="text-xs text-muted-foreground/40 w-7 text-right font-mono">{calledPct}%</span>
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button type="button" className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
          onClick={e => { e.stopPropagation(); onDelete(batch); }}>
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground/50 hover:text-destructive" />
        </button>
        <ChevronRight className="h-4 w-4 text-muted-foreground/30" />
      </div>
    </div>
  );
}

// ── Batch KPI Card (overview tab) ────────────────────────────────────────────

function BatchKpiCard({ batch, index, campaignId }: {
  batch: CampaignBatch; index: number; campaignId: number;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: kpis } = useGetBatchWorkspaceKpis(campaignId, batch.id, { query: { refetchInterval: 30_000 } as any });
  // Use live aggregated counts; fall back to batch row only before first KPI load
  const total  = kpis?.total  ?? batch.totalLeads;
  const called = kpis?.called ?? batch.calledLeads;
  const bPct   = total > 0 ? Math.round((called / total) * 100) : 0;
  const chips = [
    { label: "Connected",  value: kpis?.connected  ?? 0, cls: "text-blue-500" },
    { label: "Booked",     value: kpis?.booked     ?? 0, cls: "text-emerald-500" },
    { label: "Interested", value: kpis?.interested ?? 0, cls: "text-emerald-400" },
    { label: "Failed",     value: kpis?.failed     ?? 0, cls: "text-red-500" },
    { label: "Callbacks",  value: kpis?.callbacks  ?? 0, cls: "text-amber-500" },
  ];
  const lastActivity = kpis?.lastActivityAt
    ? formatDistanceToNow(new Date(kpis.lastActivityAt), { addSuffix: true })
    : null;
  const etrMins = kpis?.estimatedTimeRemainingMins ?? null;
  const etrLabel = etrMins != null
    ? etrMins < 60
      ? `~${etrMins}m remaining`
      : `~${Math.round(etrMins / 60)}h remaining`
    : null;
  return (
    <div
      className="group bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-foreground/20 transition-all"
      onClick={() => { window.location.href = `${BASE}/app/campaigns/${campaignId}/batches/${batch.id}`; }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{batch.name || `Batch ${index + 1}`}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StatusBadge status={batch.status} />
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-muted/50 text-muted-foreground/70 border border-border/60">
              {batch.leadSource}
            </span>
            {kpis?.agentName && (
              <span className="text-xs text-muted-foreground/50 flex items-center gap-1">
                <Users className="h-2.5 w-2.5" />{kpis.agentName}
              </span>
            )}
            <span className="text-xs text-muted-foreground/40">{total.toLocaleString()} leads</span>
            {lastActivity && (
              <span className="text-xs text-muted-foreground/30 flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />{lastActivity}
              </span>
            )}
            {batch.status === "draft" && (
              <ScheduledChip scheduledStartAt={batch.scheduledStartAt} />
            )}
          </div>
        </div>
        <div className="flex flex-col items-end shrink-0 gap-1">
          {etrLabel && (
            <span className="text-xs text-muted-foreground/30 whitespace-nowrap">{etrLabel}</span>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
      {/* Progress bar — always from live data once kpis loaded */}
      {total > 0 && (
        <div className="mb-2">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-foreground/20 rounded-full transition-all" style={{ width: `${bPct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground/40 mt-1 font-mono">{bPct}% called ({called.toLocaleString()} / {total.toLocaleString()})</p>
        </div>
      )}
      {/* KPI chips */}
      {kpis && (
        <div className="flex items-center gap-3 flex-wrap">
          {chips.filter(c => c.value > 0).map(c => (
            <span key={c.label} className={cn("text-xs font-semibold", c.cls)}>
              {c.value.toLocaleString()} {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

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

// ── Campaign summary KPI card (mirrors the Batch Workspace KpiCard) ───────────

function KpiCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: number | string; color?: string;
}) {
  return (
    <div className="bg-card px-3.5 py-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className={cn("text-muted-foreground/50", color)}>{icon}</span>
        <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground/40 truncate">{label}</span>
      </div>
      <p className={cn("text-xl font-bold tabular-nums truncate", color ?? "text-foreground")}>{value}</p>
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
  const [deletingBatch,    setDeletingBatch]    = useState<CampaignBatch | null>(null);
  const [showDeleteCamp,   setShowDeleteCamp]   = useState(false);
  const [deleteNameInput,  setDeleteNameInput]  = useState("");
  const [deletingCamp,     setDeletingCamp]     = useState(false);
  const deleteBatch    = useDeleteCampaignBatch();
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
  const { data: campaign, isLoading: campLoading } = useGetCampaign(campaignId, { query: { refetchInterval: 15_000 } as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: batches, isLoading: batchLoading } = useListCampaignBatches(campaignId, { query: { refetchInterval: 10_000 } as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: analytics } = useGetCampaignAnalytics(campaignId, { query: { refetchInterval: 10_000 } as any });

  // Business hours editor state — declared after campaign so the useEffect dep is valid
  const [editingHours, setEditingHours] = useState(false);
  const [hoursStart, setHoursStart] = useState<string>("");
  const [hoursEnd,   setHoursEnd]   = useState<string>("");
  const [hoursTz,    setHoursTz]    = useState<string>("Asia/Kolkata");
  const [hoursEnabled, setHoursEnabled] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<"overview" | "config">("overview");

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = campaign as any;
    if (!d) return;
    setHoursStart(d.businessHoursStart != null ? String(d.businessHoursStart) : "");
    setHoursEnd  (d.businessHoursEnd   != null ? String(d.businessHoursEnd)   : "");
    setHoursTz   (d.timezone ?? "Asia/Kolkata");
    setHoursEnabled(d.isCallingHoursEnabled !== false);
  }, [campaign]);

  const webhookUrl = campaign
    ? `${window.location.origin}${BASE}/api/webhooks/lead/${campaign.webhookToken}`
    : "";

  const fm = campaign?.fieldMappings as Record<string, string> | undefined;
  const imported    = analytics?.imported    ?? campaign?.totalLeads  ?? 0;
  const called      = analytics?.called      ?? campaign?.calledLeads ?? 0;
  const failed      = analytics?.failed      ?? 0;
  const hasCsvSource = batches?.some(b => b.leadSource === "csv") ?? false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isContinuous = ["webhook", "meta_ads", "crm"].includes((campaign as any)?.leadSource ?? "");

  // ── Campaign-level summary metrics ────────────────────────────────────────
  const totalBatches     = batches?.length ?? 0;
  const activeBatches    = batches?.filter(b => b.status === "running").length ?? 0;
  const completedBatches = batches?.filter(b => (b.status as string) === "completed").length ?? 0;
  const stoppedBatches   = batches?.filter(b => b.status === "stopped").length ?? 0;

  const campaignCreated = campaign?.createdAt
    ? formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true })
    : "—";

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

  // Overall progress: leads processed vs imported. While running with no
  // progress yet, show "Tracking..." instead of a bare 0%.
  const overallPct = imported > 0 ? Math.round((called / imported) * 100) : 0;
  const campaignRunning = activeBatches > 0;
  const overallProgress = overallPct > 0
    ? `${overallPct}%`
    : campaignRunning
      ? "Tracking..."
      : "0%";

  // Campaign health: derived purely from already-fetched batch/analytics data.
  const failureRate = called > 0 ? failed / called : 0;
  const campaignHealth: { label: string; accent: string; dotCls: string; icon: React.ReactNode } = (() => {
    // No activity yet → neutral.
    if (imported === 0 && called === 0) {
      return { label: "Healthy", accent: "text-emerald-500", dotCls: "bg-emerald-500", icon: <CheckCircle2 className="h-3.5 w-3.5" /> };
    }
    // Fully completed (everything processed) → healthy.
    if (imported > 0 && called >= imported) {
      return { label: "Healthy", accent: "text-emerald-500", dotCls: "bg-emerald-500", icon: <CheckCircle2 className="h-3.5 w-3.5" /> };
    }
    // Unfinished work but nothing running → stalled.
    if (imported > called && activeBatches === 0) {
      return { label: "Stalled", accent: "text-red-500", dotCls: "bg-red-500", icon: <AlertCircle className="h-3.5 w-3.5" /> };
    }
    // Something running but high failure rate or mixed stopped batches → needs attention.
    if (activeBatches > 0 && (failureRate >= 0.3 || stoppedBatches > 0)) {
      return { label: "Needs Attention", accent: "text-amber-500", dotCls: "bg-amber-500", icon: <AlertCircle className="h-3.5 w-3.5" /> };
    }
    // Otherwise running cleanly.
    return { label: "Healthy", accent: "text-emerald-500", dotCls: "bg-emerald-500", icon: <CheckCircle2 className="h-3.5 w-3.5" /> };
  })();

  // Outcome metrics sourced directly from the analytics endpoint — these are
  // what a user actually acts on (vs administrative batch bookkeeping).
  const connectedCalls  = analytics?.connected ?? 0;
  const successRatePct  = analytics?.successRate ?? 0;
  const leadsRemaining  = Math.max(imported - called, 0);

  async function handleDeleteBatch() {
    if (!deletingBatch) return;
    try {
      await deleteBatch.mutateAsync({ id: campaignId, batchId: deletingBatch.id });
      await qc.invalidateQueries({ queryKey: getListCampaignBatchesQueryKey(campaignId) });
      toast({ title: "Batch deleted" });
    } catch {
      toast({ title: "Error", description: "Failed to delete batch", variant: "destructive" });
    }
    setDeletingBatch(null);
  }

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
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-0 border-b border-border shrink-0">
        {/* Breadcrumb */}
        <DetailNav
          className="mb-2"
          backTo="/app/campaigns"
          backLabel="Back to Campaigns"
          crumbs={[
            { label: "Campaigns", href: "/app/campaigns" },
            { label: campaign.name },
          ]}
        />
        {/* Title row */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-xl font-semibold tracking-tight">{campaign.name}</h2>
              <StatusBadge status={
                // Only instant-trigger CRM/webhook campaigns "listen" for leads.
                // Batch CRM campaigns wait for a manual import — show plain Active.
                isContinuous && isInstantTrigger && activeBatches === 0 && campaign.status === "active"
                  ? "listening"
                  : batches?.some(b => b.status === "running")
                    ? "active"
                    : campaign.status
              } />
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground/50 flex items-center gap-1">
                <Users className="h-3 w-3" /> Agent #{campaign.agentId ?? "—"}
              </span>
              {campaign.fromNumber && (
                <span className="text-xs text-muted-foreground/50 font-mono flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {campaign.fromNumber}
                </span>
              )}
              {hasCsvSource && (
                <span className="text-xs text-muted-foreground/50 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> csv
                </span>
              )}
              {(campaign as any).leadSource === "meta_ads" && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-400 border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 rounded-md">
                  <Instagram className="h-3 w-3" /> Meta Ads
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Delete campaign — always visible */}
            <Button
              size="icon" variant="ghost"
              className="h-8 w-8 text-foreground/70 hover:text-red-500 hover:bg-red-500/10"
              title="Delete campaign"
              onClick={() => { setDeleteNameInput(""); setShowDeleteCamp(true); }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            {/* Continuous campaigns never show "finished" badge — they are always-on pipelines */}
            {!isContinuous && campaignFinished && (
              <span className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-md border bg-emerald-500/10 text-emerald-600 border-emerald-500/30 select-none">
                <CheckCircle2 className="h-3.5 w-3.5" /> Campaign Completed
              </span>
            )}
            {/* CSV campaigns: Create Batch button + dropdown controls */}
            {(!isContinuous || campaign.status === "draft") && (
              <Button size="sm" className="h-8 text-xs gap-1.5"
                onClick={() => setLocation(`/app/campaigns/${campaignId}/batches/new`)}>
                <Plus className="h-3.5 w-3.5" /> Create Batch
              </Button>
            )}
            {/* Stopped continuous campaign → Activate button */}
            {isContinuous && campaign.status === "stopped" && (
              <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => void handleStatusChange("active")}>
                <Zap className="h-3.5 w-3.5" /> Activate
              </Button>
            )}
            {/* Pause / Resume / Stop for all campaigns */}
            {(campaign.status === "active" || campaign.status === "paused") && (
              <div className="flex items-center gap-1.5">
                {campaign.status === "active" && (
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-amber-600 border-amber-500/40 hover:bg-amber-500/10"
                    onClick={() => void handleStatusChange("paused")}>
                    <PauseCircle className="h-3.5 w-3.5" /> Pause
                  </Button>
                )}
                {campaign.status === "paused" && (
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-emerald-600 border-emerald-500/40 hover:bg-emerald-500/10"
                    onClick={() => void handleStatusChange("active")}>
                    <PlayCircle className="h-3.5 w-3.5" /> Resume
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-red-500 border-red-500/40 hover:bg-red-500/10"
                  onClick={() => void handleStatusChange("stopped")}>
                  <XCircle className="h-3.5 w-3.5" /> Stop
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center px-4 border-b border-border/60">
          {(["overview", "config"] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                activeTab === tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "config" && <Settings className="h-3 w-3" />}
              {tab === "overview" ? "Overview" : "Configuration"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto px-6 py-5 space-y-5" style={{ maxHeight: "calc(100vh - 248px)" }}>

          {/* ── OVERVIEW tab ─────────────────────────────────────────────── */}
          {activeTab === "overview" && (<>

          {/* View Analytics */}
          <div className="flex items-center justify-end">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
              onClick={() => setLocation(`/app/analytics?campaignId=${campaignId}`)}>
              <BarChart3 className="h-3 w-3" /> View Analytics
            </Button>
          </div>

          {/* Queued leads banner — fallback: leads without a batch (auto-dial failed or pre-existing) */}
          {(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const queued: number = (campaign as any).queuedLeadsCount ?? 0;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const isWebhook = (campaign as any).leadSource === "webhook";
            if (queued === 0) return null;
            return (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/8">
                <div className="h-8 w-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
                  <Clock className="h-4 w-4 text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {queued} lead{queued !== 1 ? "s" : ""} pending dial
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">
                    {isWebhook
                      ? "These leads are queued and will be dialled as soon as a live batch is active."
                      : "These arrived while no batch was running. Start a batch to begin dialling them."}
                  </p>
                </div>
                {!isWebhook && (
                  <Button size="sm" className="h-8 text-xs gap-1.5 shrink-0"
                    onClick={() => setLocation(`/app/campaigns/${campaignId}/batches/new`)}>
                    <Zap className="h-3.5 w-3.5" /> Start batch
                  </Button>
                )}
              </div>
            );
          })()}

          </>)}

          {/* ── CONFIGURATION tab ──────────────────────────────────────── */}
          {activeTab === "config" && (<>

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

          {/* CSV campaigns — no extra configuration needed */}
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {(campaign as any).leadSource === "csv" && (
            <div className="py-12 text-center border border-dashed border-border rounded-xl">
              <FileText className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground/50">No extra configuration needed</p>
              <p className="text-xs text-muted-foreground/30 mt-0.5">Upload a CSV file when creating a new batch</p>
            </div>
          )}

          </>)}

          {/* ── OVERVIEW continued: stats + batches ──────────────────────── */}
          {activeTab === "overview" && (<>

          {/* Campaign-level summary — health + progress, then outcome metrics that
              actually help judge performance (vs. flat administrative counts). */}
          <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-8 px-4 py-3.5 border-b border-border/50">
              <div className="flex items-center gap-2 shrink-0" title={campaignHealth.label}>
                <span className={cn("h-2 w-2 rounded-full shrink-0", campaignHealth.dotCls)} />
                <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", campaignHealth.accent)}>
                  {campaignHealth.icon}
                  {campaignHealth.label}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/40">Overall Progress</span>
                  <span className="text-xs font-mono font-semibold text-foreground/80 tabular-nums">{overallProgress}</span>
                </div>
                <Progress value={overallPct} className="h-1.5" />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/60">
              <KpiCard icon={<PhoneCall className="h-3 w-3" />} label="Connected"       value={connectedCalls.toLocaleString()} color="text-sky-500" />
              <KpiCard icon={<Target className="h-3 w-3" />}    label="Success Rate"    value={`${successRatePct}%`} color="text-emerald-500" />
              <KpiCard icon={<Users className="h-3 w-3" />}     label="Leads Remaining" value={leadsRemaining.toLocaleString()} color="text-amber-500" />
              <KpiCard icon={<XCircle className="h-3 w-3" />}   label="Failed"          value={failed.toLocaleString()} color="text-red-500" />
            </div>
          </div>

          {/* Batches — batch-mode campaigns only */}
          {(campaign as unknown as Record<string, unknown>)["triggerMode"] !== "instant" ? (
          <div>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Batches</h3>
                <p className="text-xs text-muted-foreground/50 mt-0.5">Manage and monitor your batches</p>
              </div>
              {(campaign as any).leadSource === "crm" && (
                <CrmImportButton campaignId={campaignId} />
              )}
            </div>
            {batchLoading ? (
              <div className="grid grid-cols-1 gap-3">
                {[1, 2].map(i => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
              </div>
            ) : !batches?.length ? (
              <div className="py-10 text-center border border-dashed border-border rounded-xl">
                <Layers className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground/50">No batches yet</p>
                <p className="text-xs text-muted-foreground/30 mt-0.5 mb-4">Create a batch to start calling leads</p>
                <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                  onClick={() => setLocation(`/app/campaigns/${campaignId}/batches/new`)}>
                  <Plus className="h-3 w-3" /> Create First Batch
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {batches.map((batch, i) => (
                  <BatchKpiCard key={batch.id} batch={batch} index={i} campaignId={campaignId} />
                ))}
              </div>
            )}
          </div>
          ) : (
          <div>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Daily Batches</h3>
                <p className="text-xs text-muted-foreground/50 mt-0.5">Auto-created per day as leads arrive via the webhook</p>
              </div>
              {(campaign as any).leadSource === "crm" && (
                <CrmImportButton campaignId={campaignId} />
              )}
            </div>
            {batchLoading ? (
              <div className="grid grid-cols-1 gap-3">
                {[1, 2].map(i => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
              </div>
            ) : !batches?.length ? (
              <div className="py-10 text-center border border-dashed border-border rounded-xl">
                <Zap className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground/50">No leads yet</p>
                <p className="text-xs text-muted-foreground/30 mt-0.5">A batch is auto-created the moment the first lead arrives today.</p>
              </div>
            ) : (() => {
              // Group batches by their date label (extracted from "Live — Jun 30" names)
              const groups: { dateLabel: string; items: CampaignBatch[] }[] = [];
              const seen = new Map<string, CampaignBatch[]>();
              [...batches].sort((a, b) => b.id - a.id).forEach(batch => {
                const match = batch.name.match(/Live — (.+)/);
                const label = match ? match[1]! : batch.name;
                if (!seen.has(label)) { seen.set(label, []); groups.push({ dateLabel: label, items: seen.get(label)! }); }
                seen.get(label)!.push(batch);
              });
              return (
                <div className="space-y-4">
                  {groups.map(({ dateLabel, items }) => (
                    <div key={dateLabel}>
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar className="h-3 w-3 text-muted-foreground/40" />
                        <span className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">{dateLabel}</span>
                        <div className="flex-1 h-px bg-border/40" />
                      </div>
                      <div className="grid grid-cols-1 gap-3">
                        {items.map((batch, i) => <BatchKpiCard key={batch.id} batch={batch} index={i} campaignId={campaignId} />)}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          )}

          </>)}

        </div>
      </div>

      <CallDetailDrawer
        open={selectedCallId !== null}
        callId={selectedCallId}
        onClose={() => setSelectedCallId(null)}
      />

      <AlertDialog open={!!deletingBatch} onOpenChange={v => { if (!v) setDeletingBatch(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete batch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deletingBatch?.name}</strong> and all its leads.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDeleteBatch()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
