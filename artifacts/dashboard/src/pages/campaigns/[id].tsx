import { useState, useRef } from "react";
import { useRoute, Link, useLocation } from "wouter";
import {
  useGetCampaign,
  useListCampaignBatches,
  useCreateCampaignBatch,
  useDeleteCampaignBatch,
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
  Clock, AlertCircle, CheckCircle2, X,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── CSV parser ────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function batchStatusColors(status: string): string {
  const map: Record<string, string> = {
    draft:     "bg-zinc-100 text-zinc-500 border-zinc-200",
    running:   "bg-blue-50 text-blue-600 border-blue-200",
    paused:    "bg-amber-50 text-amber-600 border-amber-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    stopped:   "bg-red-50 text-red-600 border-red-200",
  };
  return map[status] ?? "bg-muted text-muted-foreground border-border";
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

// ── Upload Batch Modal ────────────────────────────────────────────────────────

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
  const qc            = useQueryClient();
  const { toast }     = useToast();
  const create        = useCreateCampaignBatch();
  const fileRef       = useRef<HTMLInputElement>(null);

  const [batchName, setBatchName]   = useState(`Batch ${nextBatchNumber}`);
  const [schedTime, SchedTime]      = useState("");
  const [csvData, setCsvData]       = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [fileName, setFileName]     = useState("");
  const [parseErr, setParseErr]     = useState("");

  function resetState() {
    setBatchName(`Batch ${nextBatchNumber}`);
    SchedTime("");
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
          <DialogTitle>Upload Batch</DialogTitle>
          <DialogDescription>Upload a CSV of leads to add to this campaign batch.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Batch name */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Batch Name</Label>
              <Input value={batchName} onChange={e => setBatchName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Scheduled Start Time <span className="text-muted-foreground/50 text-[10px]">(optional)</span></Label>
              <Input type="datetime-local" value={schedTime} onChange={e => SchedTime(e.target.value)} className="text-xs" />
            </div>
          </div>

          {/* CSV upload */}
          <div className="space-y-2">
            <Label>CSV File</Label>
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

          {/* CSV Preview */}
          {csvData && csvData.rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Data Preview</Label>
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
          <Button type="button" variant="outline" onClick={() => { resetState(); onClose(); }}>Cancel</Button>
          <Button
            onClick={() => void handleConfirm()}
            disabled={!csvData || create.isPending}
            className="gap-2"
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
      className="flex items-center gap-4 px-5 py-4 hover:bg-elevated/20 transition-colors cursor-pointer group"
      onClick={() => navigate(`/app/campaigns/${campaignId}/batches/${batch.id}`)}
    >
      {/* Batch number icon */}
      <div className="h-8 w-8 rounded-lg bg-elevated border border-border flex items-center justify-center shrink-0">
        <span className="text-xs font-semibold text-muted-foreground">{index}</span>
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-medium text-foreground">{batch.name}</p>
          <Badge variant="outline" className={`text-[10px] ${batchStatusColors(batch.status)}`}>
            {batch.status}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground/50">
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

      {/* Progress bar */}
      <div className="hidden sm:flex items-center gap-2 w-28">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-foreground/20 rounded-full transition-all"
            style={{ width: `${calledPct}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground/40 w-7 text-right">{calledPct}%</span>
      </div>

      {/* Actions */}
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CampaignDetailPage() {
  const [, params]    = useRoute("/app/campaigns/:id");
  const campaignId    = parseInt(params?.id ?? "0", 10);
  const { toast }     = useToast();
  const qc            = useQueryClient();

  const [uploadOpen, setUploadOpen]       = useState(false);
  const [deletingBatch, setDeletingBatch] = useState<CampaignBatch | null>(null);
  const deleteBatch                       = useDeleteCampaignBatch();

  const { data: campaign, isLoading: campLoading } = useGetCampaign(campaignId);
  const { data: batches, isLoading: batchLoading } = useListCampaignBatches(campaignId);

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

  if (campLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="h-32 bg-muted rounded-2xl" />
        <div className="h-64 bg-muted rounded-2xl" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-20">
        <p className="text-muted-foreground">Campaign not found.</p>
        <Link href="/app/campaigns"><Button variant="outline" className="mt-4">← Back to Campaigns</Button></Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <Link href="/app/campaigns">
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-foreground">{campaign.name}</h1>
          {campaign.description && (
            <p className="text-xs text-muted-foreground/60 mt-0.5">{campaign.description}</p>
          )}
        </div>
        <Badge variant="outline" className={`ml-auto text-[10px] font-medium ${campaign.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : campaign.status === "paused" ? "bg-amber-50 text-amber-600 border-amber-200" : "bg-zinc-100 text-zinc-500 border-zinc-200"}`}>
          {campaign.status}
        </Badge>
      </div>

      {/* ── Top stats ── */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Leads",  value: campaign.totalLeads },
            { label: "Calls Made",   value: campaign.calledLeads },
            { label: "Max Attempts", value: campaign.maxAttempts },
            { label: "Call Delay",   value: `${campaign.callDelaySeconds}s` },
          ].map(s => (
            <div key={s.label} className="bg-elevated/40 rounded-xl px-4 py-3">
              <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">{s.label}</p>
              <p className="text-lg font-semibold text-foreground mt-1">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Webhook URL */}
        <div>
          <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider mb-1.5">Webhook URL</p>
          <div className="flex items-center gap-2 bg-elevated/30 rounded-lg px-3 py-2.5">
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
                <div key={role} className="flex items-center gap-1.5 bg-elevated/40 rounded-lg px-3 py-1.5">
                  <span className="text-[10px] text-muted-foreground/50 uppercase">{role}</span>
                  <span className="text-xs text-foreground font-mono">{source as string}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Batches ── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
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
            className="h-7 text-xs gap-1.5"
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
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setUploadOpen(true)}>
              <Upload className="h-3.5 w-3.5" /> Upload First Batch
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
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
