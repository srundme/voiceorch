import { useState, useRef } from "react";
import { useRoute, useLocation, Link } from "wouter";
import {
  useGetCampaign, useListCampaignBatches, useCreateCampaignBatch,
  useDeleteCampaignBatch, useGetCampaignAnalytics, useUpdateCampaign,
  useListCampaignLeads, useGetCampaignActivity,
  useGetBatchWorkspaceKpis,
  getListCampaignBatchesQueryKey, getGetCampaignQueryKey,
} from "@workspace/api-client-react";
import type { CampaignBatch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getIrdaiBlockedError } from "@/lib/irdai-block";
import {
  ArrowLeft, Copy, Check, Megaphone, Upload, FileText, Layers,
  ChevronRight, Calendar, Trash2, Users, Clock, AlertCircle,
  CheckCircle2, X, BarChart3, PhoneCall, ArrowRight, Hash,
  Activity, PlayCircle, PauseCircle, XCircle, Info, Settings,
  Phone, Eye, Globe, Building2, Zap, ListFilter, Plus,
  PhoneIncoming, CalendarDays, ArrowRightLeft, Radio, Ban,
  TrendingUp, DollarSign, Target, Flame,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { BATCH_STATUS_MAP, CAMPAIGN_STATUS_MAP, callStatusCfg, outcomeCfg } from "@/lib/campaign-status";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
          {(batch as unknown as Record<string, unknown>)["leadSource"] !== "csv" && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 border border-purple-500/20 capitalize">
              {String((batch as unknown as Record<string, unknown>)["leadSource"] ?? "csv")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground/50">
          <span className="flex items-center gap-1"><Users className="h-3 w-3" />{batch.totalLeads} leads</span>
          <span>{batch.calledLeads} called ({calledPct}%)</span>
          {batch.scheduledStartAt && (
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(batch.scheduledStartAt), "MMM d, HH:mm")}</span>
          )}
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
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <StatusBadge status={batch.status} />
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

// ── Leads mini-table ─────────────────────────────────────────────────────────

function LeadsTab({ campaignId }: { campaignId: number }) {
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const PAGE_SIZE = 30;

  // API call unchanged — status filter only (outcome is visual-reference only).
  const { data, isLoading } = useListCampaignLeads(campaignId, {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
  });

  const raw = data as { leads?: unknown[]; total?: number } | unknown[] | undefined;
  const items = Array.isArray(raw)
    ? (raw as Record<string, unknown>[])
    : ((raw as { leads?: Record<string, unknown>[] })?.leads ?? []);
  const total = Array.isArray(raw)
    ? items.length
    : ((raw as { total?: number })?.total ?? 0);

  const STATUS_OPTS = [
    { key: "all",       label: "All"       },
    { key: "pending",   label: "Pending"   },
    { key: "calling",   label: "Calling"   },
    { key: "completed", label: "Completed" },
    { key: "failed",    label: "Failed"    },
    { key: "skipped",   label: "Skipped"   },
  ];
  // Visual-reference outcome chips — no filter state, purely presentational grouping.
  const OUTCOME_CHIPS = [
    { key: "booking_created",    label: "Booked",      color: "text-emerald-500"        },
    { key: "transfer_completed", label: "Transferred", color: "text-purple-500"         },
    { key: "callback_requested", label: "Callback",    color: "text-amber-500"          },
    { key: "interest_confirmed", label: "Interested",  color: "text-orange-500"         },
    { key: "no_contact",         label: "No Contact",  color: "text-muted-foreground/60"},
    { key: "failed",             label: "Failed",      color: "text-red-500"            },
  ];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Filter bar — STATUS (functional) + OUTCOME (visual reference grouping) */}
      <div className="px-5 py-3 border-b border-border">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* STATUS — functional filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider shrink-0">Status</span>
            <div className="flex items-center gap-0.5 flex-wrap">
              {STATUS_OPTS.map(s => (
                <button key={s.key} onClick={() => { setStatusFilter(s.key); setPage(0); }}
                  className={cn("text-xs font-medium px-2.5 py-1 rounded transition-colors",
                    statusFilter === s.key ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-muted/40"
                  )}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-4 w-px bg-border/50 shrink-0" />
          {/* OUTCOME — visual reference (no onClick, no new state) */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider shrink-0">Outcome</span>
            <div className="flex items-center gap-1 flex-wrap">
              {OUTCOME_CHIPS.map(o => (
                <span key={o.key} className={cn("text-xs font-medium px-2 py-0.5 rounded select-none", o.color)}>
                  {o.label}
                </span>
              ))}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {statusFilter !== "all" && (
              <button onClick={() => { setStatusFilter("all"); setPage(0); }}
                className="text-xs text-muted-foreground/60 underline-offset-2 hover:text-foreground hover:underline transition-colors">
                Clear filter
              </button>
            )}
            <span className="text-xs text-muted-foreground/40">{isLoading ? "…" : total} leads</span>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="divide-y divide-border/40">{[...Array(4)].map((_, i) => (
          <div key={i} className="flex gap-3 px-5 py-3 animate-pulse">
            <Skeleton className="h-4 w-16 rounded" /><Skeleton className="h-4 w-28 rounded" /><Skeleton className="h-4 w-24 rounded ml-auto" />
          </div>
        ))}</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center">
          <Users className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground/40">No leads match the current filter</p>
          {statusFilter !== "all" && (
            <button onClick={() => { setStatusFilter("all"); setPage(0); }}
              className="mt-3 text-xs text-muted-foreground/60 underline-offset-2 hover:text-foreground hover:underline transition-colors">
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/20 border-b border-border/60">
                  {/* Lead → Status → Outcome → Attempts → Last Activity → Actions */}
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground/40 uppercase tracking-widest">Lead</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground/40 uppercase tracking-widest">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground/40 uppercase tracking-widest hidden sm:table-cell">Outcome</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground/40 uppercase tracking-widest">Attempts</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground/40 uppercase tracking-widest hidden md:table-cell">Last Activity</th>
                  <th className="px-4 py-2.5 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {items.map(lead => {
                  const callStatus = String(lead["callStatus"] ?? "");
                  const oc = String(lead["operationalOutcome"] ?? "");
                  const la = lead["lastAttemptAt"] ? String(lead["lastAttemptAt"]) : null;
                  const statusCfg = callStatusCfg(callStatus);
                  const ocCfg = outcomeCfg(oc);
                  return (
                    <tr key={String(lead["id"])} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted/40 text-xs font-semibold text-muted-foreground/70 shrink-0">
                            {(String(lead["name"] ?? "").trim().charAt(0) || String(lead["phone"] ?? "").charAt(0) || "?").toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-foreground truncate max-w-[120px]">{String(lead["name"] ?? "—")}</p>
                            <p className="text-xs font-mono text-muted-foreground/60">{String(lead["phone"] ?? "")}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded border", statusCfg.cls)}>
                          {statusCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell">
                        <span className={cn("text-xs font-medium", ocCfg.color)}>
                          {oc ? ocCfg.label : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">{String(lead["callAttempts"] ?? 0)}</td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <span className="text-xs text-muted-foreground/60">
                          {la ? formatDistanceToNow(new Date(la), { addSuffix: true }) : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <a href={`${BASE}/app/campaigns/${campaignId}/leads/${String(lead["id"])}`}
                          className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted transition-colors">
                          <Eye className="h-3.5 w-3.5 text-muted-foreground/40" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border/60 bg-muted/10">
              <p className="text-xs text-muted-foreground/40">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</p>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
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
  const [deletingBatch, setDeletingBatch] = useState<CampaignBatch | null>(null);
  const deleteBatch = useDeleteCampaignBatch();
  const update = useUpdateCampaign();
  const [activeTab, setActiveTab] = useState("overview");

  async function handleStatusChange(status: "active" | "paused" | "draft") {
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

  const { data: campaign, isLoading: campLoading } = useGetCampaign(campaignId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: batches, isLoading: batchLoading } = useListCampaignBatches(campaignId, { query: { refetchInterval: 30_000 } as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: analytics } = useGetCampaignAnalytics(campaignId, { query: { refetchInterval: 30_000 } as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: activityData } = useGetCampaignActivity(campaignId, { limit: 50 }, { query: { refetchInterval: 30_000 } as any });

  const webhookUrl = campaign
    ? `${window.location.origin}${BASE}/api/webhooks/lead/${campaign.webhookToken}`
    : "";

  const fm = campaign?.fieldMappings as Record<string, string> | undefined;
  const imported    = analytics?.imported    ?? campaign?.totalLeads  ?? 0;
  const called      = analytics?.called      ?? campaign?.calledLeads ?? 0;
  const connected   = analytics?.connected   ?? 0;
  const interested  = analytics?.interested  ?? 0;
  const booked      = analytics?.booked      ?? 0;
  const transferred = analytics?.transferred ?? 0;
  const failed      = analytics?.failed      ?? 0;
  const calledPct   = imported > 0 ? Math.round((called / imported) * 100) : 0;
  const connRate    = analytics?.connectionRate ?? 0;
  const bookRate    = analytics?.bookingRate    ?? 0;
  const successRate = analytics?.successRate    ?? 0;

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
        {/* Title row */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/app/campaigns">
              <Button variant="outline" size="icon" className="h-8 w-8 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-semibold tracking-tight">{campaign.name}</h2>
                <StatusBadge status={campaign.status} />
              </div>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                <span className="text-xs text-muted-foreground/50 flex items-center gap-1">
                  <Users className="h-3 w-3" /> Agent #{campaign.agentId ?? "—"}
                </span>
                {campaign.fromNumber && (
                  <span className="text-xs text-muted-foreground/50 font-mono flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {campaign.fromNumber}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
              onClick={() => setLocation(`/app/campaigns/${campaignId}/batches/new`)}>
              <Plus className="h-3.5 w-3.5" /> Create Batch
            </Button>
            {campaign.status === "active" && (
              <Button size="sm" variant="outline"
                className="h-8 text-xs gap-1.5 text-amber-600 border-amber-500/30 hover:bg-amber-500/10"
                onClick={() => void handleStatusChange("paused")}>
                <PauseCircle className="h-3.5 w-3.5" /> Pause
              </Button>
            )}
            {campaign.status === "paused" && (
              <Button size="sm" variant="outline"
                className="h-8 text-xs gap-1.5 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
                onClick={() => void handleStatusChange("active")}>
                <PlayCircle className="h-3.5 w-3.5" /> Resume
              </Button>
            )}
            {(campaign.status === "active" || campaign.status === "paused") && (
              <Button size="sm" variant="outline"
                className="h-8 text-xs gap-1.5 text-red-500 border-red-500/20 hover:bg-red-500/10"
                onClick={() => void handleStatusChange("draft")}>
                <XCircle className="h-3.5 w-3.5" /> Stop
              </Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="h-auto bg-transparent p-0 gap-1 border-0 -mb-px overflow-x-auto flex-nowrap mt-3">
            {(["overview", "leads"] as const).map(tab => (
              <TabsTrigger key={tab} value={tab}
                className="h-9 px-4 rounded-none border-b-2 border-transparent bg-transparent data-[state=active]:border-foreground data-[state=active]:border-b-[3px] data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:font-semibold text-muted-foreground/60 text-xs font-medium whitespace-nowrap hover:text-foreground transition-colors shrink-0">
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── Overview ────────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5 space-y-5" style={{ maxHeight: "calc(100vh - 210px)" }}>
              {/* Summary stat tiles — connected strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-px bg-border/60 border border-border/60 rounded-xl overflow-hidden">
                {[
                  { label: "Leads",     value: imported,          pct: null,                              icon: <Users className="h-4 w-4" />,         accent: "text-blue-500",    tint: "bg-blue-500/10",    badge: "" },
                  { label: "Called",    value: called,            pct: calledPct > 0 ? calledPct : null,  icon: <PhoneCall className="h-4 w-4" />,      accent: "text-sky-500",     tint: "bg-sky-500/10",     badge: "text-sky-500" },
                  { label: "Connected", value: connected,         pct: connRate > 0 ? connRate : null,    icon: <Activity className="h-4 w-4" />,       accent: "text-cyan-500",    tint: "bg-cyan-500/10",    badge: "text-emerald-500" },
                  { label: "Booked",    value: booked,            pct: bookRate > 0 ? bookRate : null,    icon: <Target className="h-4 w-4" />,         accent: "text-emerald-500", tint: "bg-emerald-500/10", badge: "text-emerald-500" },
                  { label: "Callbacks", value: analytics?.callbacks ?? 0, pct: null,                      icon: <Clock className="h-4 w-4" />,          accent: "text-amber-500",   tint: "bg-amber-500/10",   badge: "" },
                  { label: "Transfers", value: transferred,       pct: null,                              icon: <ArrowRightLeft className="h-4 w-4" />, accent: "text-purple-500",  tint: "bg-purple-500/10",  badge: "text-purple-500" },
                  { label: "Success",   value: `${successRate}%`, pct: null,                              icon: <TrendingUp className="h-4 w-4" />,     accent: "text-emerald-500", tint: "bg-emerald-500/10", badge: "" },
                ].map(kpi => (
                  <div key={kpi.label} className="bg-card px-4 py-3.5 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2.5">
                      <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", kpi.tint, kpi.accent)}>
                        {kpi.icon}
                      </div>
                      <div className="min-w-0">
                        <p className="text-lg font-bold text-foreground tabular-nums leading-none">
                          {typeof kpi.value === "number" ? kpi.value.toLocaleString() : kpi.value}
                        </p>
                        <p className="text-xs text-muted-foreground/50 mt-1 truncate">{kpi.label}</p>
                      </div>
                    </div>
                    {kpi.pct !== null && (
                      <span className={cn("text-xs font-semibold tabular-nums", kpi.badge || "text-muted-foreground/50")}>{kpi.pct}%</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Call Funnel */}
              <div className="bg-card border border-border/60 rounded-xl p-5">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-sm font-semibold text-foreground">Call Funnel</h3>
                  {analytics && (
                    <div className="flex items-center gap-3">
                      {connRate > 0 && <span className="text-xs text-sky-500 font-medium">{connRate}% conn.</span>}
                      {bookRate > 0  && <span className="text-xs text-emerald-500 font-medium">{bookRate}% booked</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-0 overflow-x-auto pb-1">
                  {[
                    { label: "Imported",    value: imported,    icon: <Upload className="h-4 w-4" />,         accent: "text-blue-500",    tint: "bg-blue-500/10" },
                    { label: "Called",      value: called,      icon: <PhoneCall className="h-4 w-4" />,      accent: "text-sky-500",     tint: "bg-sky-500/10" },
                    { label: "Connected",   value: connected,   icon: <Activity className="h-4 w-4" />,       accent: "text-cyan-500",    tint: "bg-cyan-500/10" },
                    { label: "Interested",  value: interested,  icon: <Flame className="h-4 w-4" />,          accent: "text-orange-500",  tint: "bg-orange-500/10" },
                    { label: "Booked",      value: booked,      icon: <CalendarDays className="h-4 w-4" />,   accent: "text-emerald-500", tint: "bg-emerald-500/10" },
                    { label: "Transferred", value: transferred, icon: <ArrowRightLeft className="h-4 w-4" />, accent: "text-purple-500",  tint: "bg-purple-500/10" },
                  ].map((stage, i, arr) => (
                    <div key={stage.label} className="flex items-center shrink-0">
                      <div className="flex flex-col items-center px-3 min-w-[92px]">
                        <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center mb-2", stage.tint, stage.accent)}>{stage.icon}</div>
                        <p className="text-lg font-bold tabular-nums leading-none">{stage.value.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">{stage.label}</p>
                      </div>
                      {i < arr.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground/20 mx-0.5 shrink-0" />}
                    </div>
                  ))}
                </div>
                {imported > 0 && (
                  <div className="mt-5">
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary/40 rounded-full transition-all" style={{ width: `${calledPct}%` }} />
                    </div>
                    <div className="flex justify-between mt-1.5 text-xs text-muted-foreground/40">
                      <span>{called.toLocaleString()} called</span>
                      <span>{(imported - called).toLocaleString()} remaining</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Batch cards */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground">Batches</h3>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => setLocation(`/app/campaigns/${campaignId}/batches/new`)}>
                    <Plus className="h-3 w-3" /> New Batch
                  </Button>
                </div>
                {batchLoading ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {batches.map((batch, i) => (
                      <BatchKpiCard key={batch.id} batch={batch} index={i} campaignId={campaignId} />
                    ))}
                  </div>
                )}
              </div>

              {/* Activity Feed */}
              {(activityData?.events?.length ?? 0) > 0 && (
                <div className="bg-card border border-border rounded-xl p-5">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Activity className="h-3.5 w-3.5" /> Recent Activity
                  </h3>
                  <div className="space-y-0 divide-y divide-border/40">
                    {activityData!.events.slice(0, 20).map((ev: {
                      id: number | string; leadId: number | null; leadName: string | null; leadPhone: string | null;
                      eventType: string; data: Record<string, unknown> | null; createdAt: string;
                      batchName?: string | null;
                    }) => {
                      const isBatchEv = ev.eventType.startsWith("batch_");
                      const label = isBatchEv
                        ? (ev.batchName || (ev.data as Record<string,unknown> | null)?.batchName as string | null || "Batch")
                        : (ev.leadName || ev.leadPhone || `Lead #${ev.leadId}`);
                      const evTypeLabel = ev.eventType.replace(/_/g, " ");
                      const isGood = ["booking_created","transfer_completed","interest_confirmed","batch_completed"].includes(ev.eventType);
                      const isBad  = ["call_failed","dnc_flagged","opted_out","batch_stopped"].includes(ev.eventType);
                      const isInfo = isBatchEv && !isGood && !isBad;
                      return (
                        <div key={String(ev.id)} className="flex items-center gap-3 py-2">
                          <div className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold shrink-0",
                            isGood ? "bg-emerald-500/10 text-emerald-500" : isBad ? "bg-red-500/10 text-red-400" : isInfo ? "bg-blue-500/10 text-blue-400" : "bg-muted/40 text-muted-foreground/70",
                          )}>
                            {(label as string).trim().charAt(0).toUpperCase() || "•"}
                          </div>
                          <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
                            <span className={cn(
                              "text-xs font-medium truncate",
                              isBatchEv ? "text-muted-foreground/60" : "text-foreground/80",
                            )}>{label as string}</span>
                            <span className="text-xs text-muted-foreground/40 capitalize shrink-0">{evTypeLabel}</span>
                          </div>
                          <span className="text-xs text-muted-foreground/30 shrink-0 whitespace-nowrap">
                            {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Webhook */}
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground/40 uppercase tracking-wider mb-2">Webhook URL</p>
                <div className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2 border border-border">
                  <code className="text-xs font-mono text-muted-foreground/70 flex-1 truncate">{webhookUrl}</code>
                  <CopyButton text={webhookUrl} />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Leads ───────────────────────────────────────────────────────── */}
          <TabsContent value="leads" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "calc(100vh - 210px)" }}>
              <LeadsTab campaignId={campaignId} />
            </div>
          </TabsContent>

        </Tabs>
      </div>

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
    </div>
  );
}
