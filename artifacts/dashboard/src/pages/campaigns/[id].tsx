import { useState, useRef, useCallback } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetCampaign,
  useUpdateCampaign,
  getGetCampaignQueryKey,
  useListCampaignBatches,
  useCreateCampaignBatch,
  useUpdateCampaignBatch,
  useDeleteCampaignBatch,
  getListCampaignBatchesQueryKey,
} from "@workspace/api-client-react";
import type { CampaignBatch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  ArrowLeft, Copy, Check, Phone, Megaphone, Upload, FileText,
  AlertCircle, CheckCircle2, X, Play, Pause, Square, Trash2,
  ChevronRight, Calendar, Layers,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

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

function batchStatusBadge(status: string) {
  const map: Record<string, string> = {
    draft:     "bg-muted text-muted-foreground border-border",
    running:   "bg-blue-50 text-blue-700 border-blue-200",
    paused:    "bg-amber-50 text-amber-700 border-amber-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    stopped:   "bg-muted text-muted-foreground border-border",
  };
  return map[status] ?? "bg-muted text-muted-foreground border-border";
}

function WebhookUrlBox({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${BASE}/api/webhooks/lead/${token}`;
  function copy() {
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="border border-dashed border-border rounded-xl bg-muted/50 p-4">
      <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
        <Megaphone className="h-3.5 w-3.5" /> Webhook URL
      </p>
      <div className="flex items-center gap-2">
        <code className="text-xs font-mono text-zinc-900 flex-1 truncate">{url}</code>
        <button onClick={copy} className="shrink-0 p-1.5 rounded-lg hover:bg-muted text-foreground transition-colors">
          {copied ? <Check className="h-3.5 w-3.5 text-zinc-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className="text-[11px] text-foreground/70 mt-2">
        POST JSON leads here — or use as Meta Lead Ads webhook URL.
      </p>
    </div>
  );
}

// ── Upload Batch Modal ────────────────────────────────────────────────────────

function UploadBatchModal({
  open, onClose, campaignId, fieldMappings, onSuccess,
}: {
  open: boolean; onClose: () => void; campaignId: number;
  fieldMappings: Record<string, string>; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const createBatch = useCreateCampaignBatch();

  const [batchName, setBatchName]         = useState("");
  const [scheduledAt, setScheduledAt]     = useState("");
  const [dragging, setDragging]           = useState(false);
  const [fileName, setFileName]           = useState<string | null>(null);
  const [parsed, setParsed]               = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [done, setDone]                   = useState(false);
  const fileInputRef                       = useRef<HTMLInputElement>(null);

  const phoneField = fieldMappings["phone"] ?? "phone";
  const nameField  = fieldMappings["name"]  ?? "name";
  const emailField = fieldMappings["email"] ?? "email";

  function reset() {
    setBatchName(""); setScheduledAt(""); setDragging(false);
    setFileName(null); setParsed(null); setDone(false);
  }
  function handleClose() { reset(); onClose(); }

  function loadFile(file: File) {
    setFileName(file.name);
    if (!batchName) setBatchName(file.name.replace(/\.csv$/i, ""));
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      setParsed(parseCsv(text));
    };
    reader.readAsText(file);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".csv")) loadFile(file);
    else toast({ title: "Please drop a .csv file", variant: "destructive" });
  }, []);

  async function doCreate() {
    if (!batchName.trim()) { toast({ title: "Batch name required", variant: "destructive" }); return; }
    if (!parsed) return;
    try {
      await createBatch.mutateAsync({
        id: campaignId,
        data: {
          name: batchName.trim(),
          leads: parsed.rows,
          scheduledStartAt: scheduledAt || null,
        } as Parameters<typeof createBatch.mutateAsync>[0]["data"],
      });
      setDone(true);
      onSuccess();
    } catch { toast({ title: "Failed to create batch", variant: "destructive" }); }
  }

  const phoneDetected = parsed ? parsed.headers.includes(phoneField) : null;
  const previewRows   = parsed?.rows.slice(0, 5) ?? [];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" /> Upload Batch
          </DialogTitle>
          <DialogDescription>Upload a CSV to create a new batch of leads.</DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="p-3 rounded-full bg-muted text-foreground">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">Batch created</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  <strong>{parsed?.rows.length.toLocaleString()}</strong> leads imported
                  {scheduledAt && <span> — scheduled for {format(new Date(scheduledAt), "MMM d, HH:mm")}</span>}
                </p>
              </div>
            </div>
            <DialogFooter><Button onClick={handleClose}>Done</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Batch name + schedule */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Batch name *</Label>
                <Input value={batchName} onChange={e => setBatchName(e.target.value)} placeholder="e.g. Week 1 Leads" />
              </div>
              <div>
                <Label>Scheduled start (optional)</Label>
                <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
              </div>
            </div>

            {/* Field mapping ref */}
            <div className="bg-muted rounded-lg p-3 text-xs">
              <p className="font-semibold text-muted-foreground mb-2">Campaign field mappings:</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { role: "Phone (required)", field: phoneField },
                  ...(fieldMappings["name"]  ? [{ role: "Name",  field: nameField  }] : []),
                  ...(fieldMappings["email"] ? [{ role: "Email", field: emailField }] : []),
                ].map(({ role, field }) => (
                  <div key={role} className="flex items-center gap-1.5 bg-card border border-border rounded px-2 py-1">
                    <span className="text-muted-foreground">{role}</span>
                    <span className="text-muted-foreground">←</span>
                    <code className="font-mono text-foreground">{field}</code>
                  </div>
                ))}
              </div>
            </div>

            {/* Drop zone */}
            {!parsed ? (
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
                  dragging ? "border-zinc-400 bg-muted" : "border-border hover:border-zinc-300 hover:bg-muted"
                }`}
              >
                <div className="p-3 rounded-full bg-muted text-zinc-400">
                  <FileText className="h-7 w-7" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">Drop your CSV file here, or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Must include a <code className="font-mono">{phoneField}</code> column</p>
                </div>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-muted border border-border rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-zinc-500" />
                    <span className="text-sm font-medium">{fileName}</span>
                    <span className="text-xs text-zinc-500">{parsed.rows.length.toLocaleString()} rows</span>
                  </div>
                  <button onClick={() => { setParsed(null); setFileName(null); }} className="text-zinc-400 hover:text-foreground transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {phoneDetected === false && (
                  <div className="flex items-start gap-2 bg-muted border border-border rounded-lg p-3">
                    <AlertCircle className="h-4 w-4 text-foreground mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-semibold">Phone column not found</p>
                      <p className="text-xs mt-0.5 text-muted-foreground">
                        Headers: <code className="font-mono">{parsed.headers.join(", ")}</code> — expected <code className="font-mono">{phoneField}</code>
                      </p>
                    </div>
                  </div>
                )}

                {phoneDetected && (
                  <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 text-zinc-500 shrink-0" />
                    <p className="text-xs">
                      Phone column <code className="font-mono font-bold">{phoneField}</code> detected —{" "}
                      ready to import <strong>{parsed.rows.length.toLocaleString()}</strong> leads
                    </p>
                  </div>
                )}

                {parsed.headers.length > 0 && previewRows.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="bg-muted border-b border-border">
                          {parsed.headers.map(h => (
                            <th key={h} className={`px-3 py-2 text-left font-medium ${h === phoneField ? "text-foreground" : "text-muted-foreground"}`}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => (
                          <tr key={i} className="border-b border-border last:border-0">
                            {parsed.headers.map(h => (
                              <td key={h} className={`px-3 py-1.5 truncate max-w-[160px] ${h === phoneField ? "font-mono font-medium text-foreground" : "text-muted-foreground"}`}>
                                {row[h] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={() => void doCreate()}
                disabled={!parsed || !phoneDetected || !batchName.trim() || createBatch.isPending}
                className="gap-2"
              >
                <Upload className="h-3.5 w-3.5" />
                {createBatch.isPending ? "Creating…" : parsed ? `Create batch (${parsed.rows.length.toLocaleString()} leads)` : "Create batch"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Batch card ────────────────────────────────────────────────────────────────

function BatchCard({ batch, campaignId }: { batch: CampaignBatch; campaignId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateCampaignBatch();
  const remove = useDeleteCampaignBatch();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const progress = batch.totalLeads > 0 ? Math.round((batch.calledLeads / batch.totalLeads) * 100) : 0;

  async function setStatus(status: string) {
    try {
      await update.mutateAsync({ id: campaignId, batchId: batch.id, data: { status } as Parameters<typeof update.mutateAsync>[0]["data"] });
      await qc.invalidateQueries({ queryKey: getListCampaignBatchesQueryKey(campaignId) });
      toast({ title: `Batch ${status}` });
    } catch { toast({ title: "Action failed", variant: "destructive" }); }
  }

  async function confirmDelete() {
    try {
      await remove.mutateAsync({ id: campaignId, batchId: batch.id });
      await qc.invalidateQueries({ queryKey: getListCampaignBatchesQueryKey(campaignId) });
      toast({ title: "Batch deleted" });
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  }

  return (
    <>
      <div className="bg-card border border-border rounded-2xl p-4 hover:border-border/80 transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-elevated border border-border flex items-center justify-center shrink-0">
              <Layers className="h-3.5 w-3.5 text-muted-foreground/60" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm text-foreground truncate">{batch.name}</p>
              {batch.scheduledStartAt && (
                <p className="text-[11px] text-muted-foreground/50 flex items-center gap-1 mt-0.5">
                  <Calendar className="h-3 w-3" />
                  {format(new Date(batch.scheduledStartAt), "MMM d, HH:mm")}
                </p>
              )}
            </div>
          </div>
          <Badge variant="outline" className={`text-[10px] shrink-0 ${batchStatusBadge(batch.status)}`}>
            {batch.status}
          </Badge>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex justify-between text-[10px] text-muted-foreground/50 mb-1">
            <span>{batch.calledLeads}/{batch.totalLeads} called</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-foreground/40 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-3 flex items-center gap-2">
          {batch.status === "draft" || batch.status === "paused" || batch.status === "stopped" ? (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => void setStatus("running")} disabled={update.isPending}>
              <Play className="h-3 w-3" /> Start
            </Button>
          ) : null}
          {batch.status === "running" && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => void setStatus("paused")} disabled={update.isPending}>
                <Pause className="h-3 w-3" /> Pause
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => void setStatus("stopped")} disabled={update.isPending}>
                <Square className="h-3 w-3" /> Stop
              </Button>
            </>
          )}

          <div className="ml-auto flex items-center gap-1">
            <Link href={`/app/campaigns/${campaignId}/batches/${batch.id}`}>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground">
                View leads <ChevronRight className="h-3 w-3" />
              </Button>
            </Link>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground/50 hover:text-foreground" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete batch?</AlertDialogTitle>
            <AlertDialogDescription>This will delete <strong>{batch.name}</strong> and all {batch.totalLeads} leads. Cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-foreground hover:bg-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CampaignDetailPage() {
  const [, params] = useRoute("/app/campaigns/:id");
  const id = parseInt(params?.id ?? "0", 10);
  const qc = useQueryClient();
  const { toast } = useToast();

  const [uploadOpen, setUploadOpen] = useState(false);

  const { data: campaign, isLoading: loadingCampaign } = useGetCampaign(id);
  const { data: batches, isLoading: loadingBatches }   = useListCampaignBatches(id);

  const upd = useUpdateCampaign();

  async function toggleActive() {
    if (!campaign) return;
    await upd.mutateAsync({ id: campaign.id, data: { isActive: !campaign.isActive } });
    await qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
  }

  async function handleBatchSuccess() {
    await qc.invalidateQueries({ queryKey: getListCampaignBatchesQueryKey(id) });
    await qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
    setUploadOpen(false);
  }

  if (loadingCampaign) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="h-8 w-48 bg-muted rounded animate-pulse mb-6" />
        <div className="h-40 bg-card border border-border rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-6 max-w-5xl mx-auto text-center py-24">
        <p className="text-muted-foreground">Campaign not found.</p>
        <Link href="/app/campaigns">
          <Button variant="outline" className="mt-4">Back to Campaigns</Button>
        </Link>
      </div>
    );
  }

  const fieldMappings = campaign.fieldMappings as Record<string, string>;
  const successRate = campaign.totalLeads > 0
    ? Math.round((campaign.calledLeads / campaign.totalLeads) * 100) : 0;

  const batchList = batches as CampaignBatch[] | undefined ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/app/campaigns">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-foreground truncate">{campaign.name}</h1>
          {campaign.description && <p className="text-sm text-muted-foreground/60">{campaign.description}</p>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-muted-foreground/60">{campaign.isActive ? "Active" : "Inactive"}</span>
          <Switch
            checked={campaign.isActive}
            onCheckedChange={() => { void toggleActive(); }}
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total leads",  value: campaign.totalLeads },
          { label: "Called",       value: campaign.calledLeads },
          { label: "Called %",     value: `${successRate}%` },
          { label: "Batches",      value: batchList.length },
        ].map(stat => (
          <div key={stat.label} className="bg-card border border-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground/50 mb-1 uppercase tracking-widest font-semibold">{stat.label}</p>
            <p className="text-lg font-bold text-foreground tabular-nums">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Webhook URL */}
      <div className="mb-6">
        <WebhookUrlBox token={campaign.webhookToken} />
      </div>

      {/* Batches section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Batches</h2>
            <p className="text-xs text-muted-foreground/60 mt-0.5">Upload CSV batches and control calling per batch</p>
          </div>
          <Button onClick={() => setUploadOpen(true)} className="h-8 text-xs gap-2">
            <Upload className="h-3.5 w-3.5" /> Upload Batch
          </Button>
        </div>

        {loadingBatches ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2].map(i => <div key={i} className="bg-card border border-border rounded-2xl h-32 animate-pulse" />)}
          </div>
        ) : batchList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center bg-card border border-border rounded-2xl">
            <div className="h-10 w-10 rounded-2xl bg-elevated border border-border flex items-center justify-center mb-3">
              <Layers className="h-4 w-4 text-muted-foreground/40" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">No batches yet</h3>
            <p className="text-xs text-muted-foreground/60 max-w-xs mb-4">
              Upload a CSV to create your first batch of leads. You can schedule it or start it immediately.
            </p>
            <Button onClick={() => setUploadOpen(true)} className="h-8 text-xs gap-2">
              <Upload className="h-3.5 w-3.5" /> Upload first batch
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {batchList.map(b => <BatchCard key={b.id} batch={b} campaignId={id} />)}
          </div>
        )}
      </div>

      {/* Webhook leads note */}
      <div className="mt-6 flex items-start gap-2 p-3 bg-elevated/30 border border-border rounded-xl">
        <Phone className="h-4 w-4 text-muted-foreground/40 mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground/60">
          Webhook and Instagram Ads leads appear in the{" "}
          <Link href="/app/campaigns">
            <span className="underline cursor-pointer hover:text-foreground">Campaigns overview</span>
          </Link>{" "}
          under Meta Campaign Leads.
        </p>
      </div>

      <UploadBatchModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        campaignId={id}
        fieldMappings={fieldMappings}
        onSuccess={() => void handleBatchSuccess()}
      />
    </div>
  );
}
