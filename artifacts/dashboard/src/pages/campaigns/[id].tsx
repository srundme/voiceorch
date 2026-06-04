import { useState, useRef } from "react";
import { useRoute, Link, useLocation } from "wouter";
import {
  useGetCampaign,
  useListCampaignBatches,
  useCreateCampaignBatch,
  useDeleteCampaignBatch,
  useGetCampaignAnalytics,
  getListCampaignBatchesQueryKey,
  getGetCampaignQueryKey,
} from "@workspace/api-client-react";
import type { CampaignBatch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Copy, Check, Megaphone, Upload, FileText, Layers,
  ChevronRight, Calendar, Trash2, Play, Pause, Square, Users,
  Clock, AlertCircle, CheckCircle2, X, BarChart3, TrendingUp,
  PhoneCall, ArrowRight, Hash, Activity, PlayCircle, PauseCircle,
  XCircle, Target, Info
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── CSV parser ──────────────────────────────────────────────────────────────

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
  const configs: Record<string, { label: string; icon: React.ReactNode; bg: string; text: string; border: string }> = {
    draft: { label: "Draft", icon: <PauseCircle className="h-3 w-3" />, bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border" },
    running: { label: "Running", icon: <PlayCircle className="h-3 w-3" />, bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/20" },
    paused: { label: "Paused", icon: <PauseCircle className="h-3 w-3" />, bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", border: "border-amber-500/20" },
    completed: { label: "Completed", icon: <CheckCircle2 className="h-3 w-3" />, bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/20" },
    stopped: { label: "Stopped", icon: <XCircle className="h-3 w-3" />, bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", border: "border-red-500/20" },
  };
  const cfg = configs[status] ?? { label: status, icon: <Activity className="h-3 w-3" />, bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function CampaignStatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; icon: React.ReactNode; bg: string; text: string; border: string }> = {
    draft: { label: "Draft", icon: <PauseCircle className="h-3 w-3" />, bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border" },
    active: { label: "Active", icon: <PlayCircle className="h-3 w-3" />, bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/20" },
    paused: { label: "Paused", icon: <PauseCircle className="h-3 w-3" />, bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", border: "border-amber-500/20" },
    completed: { label: "Completed", icon: <CheckCircle2 className="h-3 w-3" />, bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/20" },
    archived: { label: "Archived", icon: <X className="h-3 w-3" />, bg: "bg-muted/30", text: "text-muted-foreground/60", border: "border-border" },
  };
  const cfg = configs[status] ?? { label: status, icon: <Activity className="h-3 w-3" />, bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-4 border-b border-border last:border-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-xs font-mono text-foreground/70">{value}</div>
    </div>
  );
}

// ── Upload Batch Modal ────────────────────────────────────────────────────

function UploadBatchModal({
  open,
  onClose,
  campaignId,
  nextBatchNumber,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: number;
  nextBatchNumber: number;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateCampaignBatch();
  const fileRef = useRef<HTMLInputElement>(null);

  const [batchName, setBatchName] = useState(`Batch ${nextBatchNumber}`);
  const [schedTime, setSchedTime] = useState("");
  const [csvData, setCsvData] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [fileName, setFileName] = useState("");
  const [parseErr, setParseErr] = useState("");

  function resetState() {
    setBatchName(`Batch ${nextBatchNumber}`);
    setSchedTime("");
    setCsvData(null);
    setFileName("");
    setParseErr("");
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseErr("");
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const parsed = parseCsv(text);
      if (parsed.rows.length === 0) {
        setParseErr("No valid rows found in CSV.");
        setCsvData(null);
      } else {
        setCsvData(parsed);
      }
    };
    reader.readAsText(file);
  }

  async function handleConfirm() {
    if (!csvData || csvData.rows.length === 0) return;
    try {
      await create.mutateAsync({
        id: campaignId,
        data: {
          name: batchName.trim() || `Batch ${nextBatchNumber}`,
          leads: csvData.rows,
          scheduledStartAt: schedTime ? new Date(schedTime).toISOString() : null,
        },
      });
      await qc.invalidateQueries({ queryKey: getListCampaignBatchesQueryKey(campaignId) });
      await qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
      toast({ title: "Batch uploaded", description: `${csvData.rows.length} leads imported.` });
      resetState();
      onClose();
    } catch {
      toast({ title: "Upload failed", description: "Check your CSV format and try again.", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { resetState(); onClose(); } }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">Upload Batch</DialogTitle>
          <DialogDescription className="text-xs">Upload a CSV of leads to add to this campaign batch.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Batch Name</Label>
              <Input value={batchName} onChange={e => setBatchName(e.target.value)} className="h-9 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Scheduled Start <span className="text-muted-foreground/50">(optional)</span></Label>
              <Input type="datetime-local" value={schedTime} onChange={e => setSchedTime(e.target.value)} className="h-9 text-xs" />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">CSV File</Label>
            <div
              className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-foreground/20 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
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
              {parseErr && (
                <div className="flex items-center justify-center gap-1.5 mt-2 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" /> {parseErr}
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </div>

          {csvData && csvData.rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Data Preview</Label>
                <span className="text-xs text-muted-foreground/50">{csvData.rows.length} rows total — showing first 5</span>
              </div>
              <div className="border border-border rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-elevated/40 border-b border-border">
                      {csvData.headers.map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {csvData.rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {csvData.headers.map(h => (
                          <td key={h} className="px-3 py-2 text-foreground/70 truncate max-w-[150px]">{row[h] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => { resetState(); onClose(); }}>Cancel</Button>
          <Button
            onClick={() => void handleConfirm()}
            disabled={!csvData || create.isPending}
            className="h-8 text-xs gap-2"
          >
            <Upload className="h-3.5 w-3.5" />
            {create.isPending ? "Uploading…" : "Confirm & Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Batch row ─────────────────────────────────────────────────────────────────

function BatchRow({
  batch,
  index,
  campaignId,
  onDelete,
}: {
  batch: CampaignBatch;
  index: number;
  campaignId: number;
  onDelete: (b: CampaignBatch) => void;
}) {
  const [, navigate] = useLocation();
  const calledPct = batch.totalLeads > 0
    ? Math.round((batch.calledLeads / batch.totalLeads) * 100)
    : 0;

  return (
    <div
      className="flex items-center gap-4 px-5 py-4 hover:bg-elevated/20 transition-colors cursor-pointer group border-b border-border/60 last:border-0"
      onClick={() => navigate(`/app/campaigns/${campaignId}/batches/${batch.id}`)}
    >
      <div className="h-8 w-8 rounded-lg bg-elevated border border-border flex items-center justify-center shrink-0">
        <span className="text-xs font-semibold text-muted-foreground">{index}</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-medium text-foreground">{batch.name}</p>
          <StatusBadge status={batch.status} />
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {batch.totalLeads} leads
          </span>
          <span>{batch.calledLeads} called ({calledPct}%)</span>
          {batch.scheduledStartAt && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {format(new Date(batch.scheduledStartAt), "MMM d, HH:mm")}
            </span>
          )}
        </div>
      </div>

      <div className="hidden sm:flex items-center gap-2 w-28">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-foreground/20 rounded-full transition-all" style={{ width: `${calledPct}%` }} />
        </div>
        <span className="text-[10px] text-muted-foreground/40 w-7 text-right font-mono">{calledPct}%</span>
      </div>

      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
          onClick={e => { e.stopPropagation(); onDelete(batch); }}
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground/50 hover:text-destructive" />
        </button>
        <ChevronRight className="h-4 w-4 text-muted-foreground/30" />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function CampaignDetailPage() {
  const [, params] = useRoute("/app/campaigns/:id");
  const campaignId = parseInt(params?.id ?? "0", 10);
  const { toast } = useToast();
  const qc = useQueryClient();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState<CampaignBatch | null>(null);
  const deleteBatch = useDeleteCampaignBatch();

  const { data: campaign, isLoading: campLoading } = useGetCampaign(campaignId);
  const { data: batches, isLoading: batchLoading } = useListCampaignBatches(campaignId);
  const { data: analytics } = useGetCampaignAnalytics(campaignId);

  const webhookUrl = campaign
    ? `${window.location.origin}${BASE}/api/webhooks/lead/${campaign.webhookToken}`
    : "";

  const fm = campaign?.fieldMappings as Record<string, string> | undefined;

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

  const calledPct = campaign && campaign.totalLeads > 0
    ? Math.round((campaign.calledLeads / campaign.totalLeads) * 100)
    : 0;

  if (campLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="h-32 bg-muted rounded-xl" />
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
      <div className="px-6 pt-6 pb-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/app/campaigns">
              <Button variant="outline" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold tracking-tight">{campaign.name}</h2>
                <CampaignStatusBadge status={campaign.status} />
              </div>
              {campaign.description && (
                <p className="text-xs text-muted-foreground/60 mt-0.5">{campaign.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`${BASE}/api/campaigns/${campaignId}/csv-template`}
              download
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-xs text-foreground/70 hover:bg-muted transition-colors"
            >
              <FileText className="h-3.5 w-3.5" /> CSV Template
            </a>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-5 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          <div className="bg-card border border-border rounded-xl p-3">
            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Total Leads</p>
            <p className="text-lg font-semibold text-foreground mt-0.5">{campaign.totalLeads}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-3">
            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Calls Made</p>
            <p className="text-lg font-semibold text-foreground mt-0.5">{campaign.calledLeads}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-3">
            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Progress</p>
            <p className="text-lg font-semibold text-foreground mt-0.5">{calledPct}%</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-3">
            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Max Attempts</p>
            <p className="text-lg font-semibold text-foreground mt-0.5">{campaign.maxAttempts}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-3">
            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Call Delay</p>
            <p className="text-lg font-semibold text-foreground mt-0.5">{campaign.callDelaySeconds}s</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-3">
            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Batches</p>
            <p className="text-lg font-semibold text-foreground mt-0.5">{batches?.length ?? 0}</p>
          </div>
        </div>

        {/* Analytics / Disposition Section */}
        {analytics && (analytics.dispositions.length > 0 || analytics.callbacks > 0) && (
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5" /> Campaign Analytics
            </h3>
            <div className="flex flex-wrap gap-3">
              {/* Status breakdown */}
              {Object.entries(analytics.statusBreakdown ?? {}).map(([status, count]) => (
                <div key={status} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background">
                  <span className="text-[10px] text-muted-foreground capitalize">{status.replace(/_/g, " ")}</span>
                  <span className="text-sm font-bold text-foreground">{count}</span>
                </div>
              ))}
              {analytics.callbacks > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-purple-500/20 bg-purple-500/5">
                  <span className="text-[10px] text-purple-600 dark:text-purple-400">Callbacks</span>
                  <span className="text-sm font-bold text-purple-700 dark:text-purple-300">{analytics.callbacks}</span>
                </div>
              )}
            </div>
            {analytics.dispositions.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Disposition Breakdown</p>
                <div className="flex flex-wrap gap-2">
                  {analytics.dispositions.map(d => {
                    const pct = analytics.calledLeads > 0 ? Math.round((d.count / analytics.calledLeads) * 100) : 0;
                    return (
                      <div key={d.label} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-background min-w-[120px]">
                        <div className="flex-1">
                          <p className="text-xs text-muted-foreground capitalize truncate">{d.label}</p>
                          <div className="flex items-baseline gap-1.5 mt-0.5">
                            <span className="text-sm font-bold text-foreground">{d.count}</span>
                            <span className="text-[10px] text-muted-foreground/50">{pct}%</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Campaign Overview Card */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Progress + Webhook */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 space-y-5">
            {/* Progress */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-foreground">Campaign Progress</p>
                <span className="text-xs font-mono text-muted-foreground">{calledPct}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary/30 rounded-full transition-all duration-500" style={{ width: `${calledPct}%` }} />
              </div>
              <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground/50">
                <span>{campaign.calledLeads} called</span>
                <span>{campaign.totalLeads - campaign.calledLeads} remaining</span>
              </div>
            </div>

            {/* Webhook URL */}
            <div>
              <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider mb-1.5">Webhook URL</p>
              <div className="flex items-center gap-2 bg-elevated/30 rounded-lg px-3 py-2.5 border border-border">
                <code className="text-xs font-mono text-muted-foreground/70 flex-1 truncate">{webhookUrl}</code>
                <CopyButton text={webhookUrl} />
              </div>
            </div>

            {/* Field Mappings */}
            {fm && Object.keys(fm).length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider mb-2">Field Mappings</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(fm).map(([role, source]) => (
                    <div key={role} className="flex items-center gap-1.5 bg-elevated/40 rounded-lg px-3 py-1.5 border border-border">
                      <span className="text-[10px] text-muted-foreground/50 uppercase">{role}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/30" />
                      <span className="text-xs text-foreground font-mono">{source as string}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Settings Summary */}
          <div className="bg-card border border-border rounded-xl p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-xs font-semibold text-foreground flex items-center gap-2">
                <Info className="h-4 w-4 text-primary/70" />
                Campaign Settings
              </p>
            </div>
            <DetailRow label="Agent ID" value={campaign.agentId} icon={<Hash className="h-3 w-3" />} />
            <DetailRow label="From Number" value={campaign.fromNumber ?? "—"} icon={<PhoneCall className="h-3 w-3" />} />
            <DetailRow label="Call Delay" value={`${campaign.callDelaySeconds}s`} icon={<Clock className="h-3 w-3" />} />
            <DetailRow label="Max Attempts" value={campaign.maxAttempts} icon={<Target className="h-3 w-3" />} />
            <DetailRow label="Created" value={formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true })} icon={<Calendar className="h-3 w-3" />} />
          </div>
        </div>

        {/* Batches */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground/50" />
              <h2 className="text-sm font-semibold text-foreground">Batches</h2>
              {!batchLoading && batches && (
                <span className="text-xs text-muted-foreground/40">({batches.length})</span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="h-3.5 w-3.5" /> Upload Batch
            </Button>
          </div>

          {batchLoading ? (
            <div className="divide-y divide-border">
              {[1, 2].map(i => (
                <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
                  <div className="h-8 w-8 bg-muted rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-32 bg-muted rounded" />
                    <div className="h-2.5 w-48 bg-muted rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : !batches?.length ? (
            <div className="py-16 text-center">
              <div className="h-10 w-10 rounded-xl bg-elevated border border-border flex items-center justify-center mx-auto mb-3">
                <Layers className="h-4.5 w-4.5 text-muted-foreground/30" />
              </div>
              <p className="text-sm font-medium text-foreground/70 mb-1">No batches yet</p>
              <p className="text-xs text-muted-foreground/40 mb-4">Upload a batch to get started</p>
              <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setUploadOpen(true)}>
                <Upload className="h-3.5 w-3.5" /> Upload First Batch
              </Button>
            </div>
          ) : (
            <div>
              {batches.map((batch, i) => (
                <BatchRow
                  key={batch.id}
                  batch={batch}
                  index={i + 1}
                  campaignId={campaignId}
                  onDelete={setDeletingBatch}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <UploadBatchModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        campaignId={campaignId}
        nextBatchNumber={(batches?.length ?? 0) + 1}
      />

      <AlertDialog open={!!deletingBatch} onOpenChange={v => { if (!v) setDeletingBatch(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete batch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deletingBatch?.name}</strong> and all its leads. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDeleteBatch()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
