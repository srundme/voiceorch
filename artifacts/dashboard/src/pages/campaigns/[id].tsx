import { useState, useRef } from "react";
import LiveQueueTab from "./live-queue";
import CallbacksTab from "./callbacks";
import IncomingCallsTab from "./incoming";
import BookingsTab from "./bookings";
import TransfersTab from "./transfers";
import { useRoute, useLocation, Link } from "wouter";
import {
  useGetCampaign, useListCampaignBatches, useCreateCampaignBatch,
  useDeleteCampaignBatch, useGetCampaignAnalytics, useUpdateCampaign,
  useListCampaignLeads, useListAgents,
  getListCampaignBatchesQueryKey, getGetCampaignQueryKey,
  getListCampaignLeadsQueryKey,
} from "@workspace/api-client-react";
import type { CampaignBatch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import {
  ArrowLeft, Copy, Check, Megaphone, Upload, FileText, Layers,
  ChevronRight, Calendar, Trash2, Users, Clock, AlertCircle,
  CheckCircle2, X, BarChart3, PhoneCall, ArrowRight, Hash,
  Activity, PlayCircle, PauseCircle, XCircle, Info, Settings,
  Phone, Eye, Globe, Building2, Zap, ListFilter, Plus,
  PhoneIncoming, CalendarDays, ArrowRightLeft, Radio, Ban,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

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
  const configs: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    draft:     { label: "Draft",     icon: <PauseCircle className="h-3 w-3" />,  cls: "bg-muted/50 text-muted-foreground border-border" },
    running:   { label: "Running",   icon: <PlayCircle className="h-3 w-3" />,   cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
    paused:    { label: "Paused",    icon: <PauseCircle className="h-3 w-3" />,  cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
    completed: { label: "Completed", icon: <CheckCircle2 className="h-3 w-3" />, cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
    stopped:   { label: "Stopped",   icon: <XCircle className="h-3 w-3" />,      cls: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
  };
  const cfg = configs[status] ?? { label: status, icon: <Activity className="h-3 w-3" />, cls: "bg-muted/50 text-muted-foreground border-border" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md border", cfg.cls)}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function CampaignStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted/50 text-muted-foreground border-border",
    active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    paused: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md border", map[status] ?? "bg-muted/50 text-muted-foreground border-border")}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
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
      <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full border", c.badge)}>
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
    } catch {
      toast({ title: "Failed to create batch", variant: "destructive" });
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
                  "flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap transition-all",
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
                      {source === src && <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Selected</div>}
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
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{h}</th>
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
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 border border-purple-500/20 capitalize">
              {String((batch as unknown as Record<string, unknown>)["leadSource"] ?? "csv")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
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
        <span className="text-[10px] text-muted-foreground/40 w-7 text-right font-mono">{calledPct}%</span>
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

// ── Leads mini-table ─────────────────────────────────────────────────────────

function LeadsTab({ campaignId }: { campaignId: number }) {
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const PAGE_SIZE = 30;

  const { data, isLoading } = useListCampaignLeads(campaignId, {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
  });

  const raw = data as { leads?: unknown[]; total?: number } | unknown[] | undefined;
  const items = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : ((raw as { leads?: Record<string, unknown>[] })?.leads ?? []);
  const total = Array.isArray(raw) ? items.length : ((raw as { total?: number })?.total ?? 0);

  const STATUS_OPTS = ["all", "pending", "calling", "completed", "failed", "skipped"];
  const STATUS_CLS: Record<string, string> = {
    pending: "bg-muted/50 text-muted-foreground border-border",
    calling: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    failed: "bg-red-500/10 text-red-600 border-red-500/20",
    skipped: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_OPTS.map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(0); }}
              className={cn("text-[10px] font-medium px-2.5 py-1 rounded-full border transition-all capitalize",
                statusFilter === s ? "bg-foreground text-background border-foreground" : "bg-card border-border text-muted-foreground hover:text-foreground"
              )}>
              {s}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground/40">{isLoading ? "…" : total} leads</span>
      </div>
      {isLoading ? (
        <div className="divide-y divide-border/40">{[...Array(4)].map((_, i) => (
          <div key={i} className="flex gap-3 px-5 py-3 animate-pulse">
            <Skeleton className="h-4 w-16 rounded" /><Skeleton className="h-4 w-28 rounded" /><Skeleton className="h-4 w-24 rounded ml-auto" />
          </div>
        ))}</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground/40 text-sm">No leads found</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/20 border-b border-border/60">
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest">Status</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest">Phone</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest hidden sm:table-cell">Name</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest hidden md:table-cell">Disposition</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest">Attempts</th>
                  <th className="px-4 py-2.5 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {items.map(lead => (
                  <tr key={String(lead["id"])} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border",
                        STATUS_CLS[String(lead["callStatus"])] ?? "bg-muted/50 text-muted-foreground border-border"
                      )}>
                        {String(lead["callStatus"])}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-foreground">{String(lead["phone"] ?? "")}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">{String(lead["name"] ?? "—")}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell capitalize">{String(lead["disposition"] ?? "—")}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">{String(lead["callAttempts"] ?? 0)}</td>
                    <td className="px-4 py-2.5">
                      <a href={`${BASE}/app/campaigns/${campaignId}/leads/${String(lead["id"])}`}
                        className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted transition-colors">
                        <Eye className="h-3.5 w-3.5 text-muted-foreground/40" />
                      </a>
                    </td>
                  </tr>
                ))}
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

// ── Settings form ────────────────────────────────────────────────────────────

function SettingsTab({ campaign, campaignId }: { campaign: Record<string, unknown>; campaignId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateCampaign();
  const { data: agents } = useListAgents();

  const [name, setName] = useState(String(campaign["name"] ?? ""));
  const [desc, setDesc] = useState(String(campaign["description"] ?? ""));
  const [status, setStatus] = useState(String(campaign["status"] ?? "draft"));
  const [fromNumber, setFromNumber] = useState(String(campaign["fromNumber"] ?? ""));
  const [agentId, setAgentId] = useState(campaign["agentId"] ? String(campaign["agentId"]) : "");
  const [concurrentCallLimit, setConcurrentCallLimit] = useState(Number(campaign["concurrentCallLimit"] ?? 20));

  async function handleSave() {
    try {
      await update.mutateAsync({
        id: campaignId,
        data: {
          name: name.trim(),
          description: desc.trim() || undefined,
          status: status as "draft" | "active" | "paused",
          fromNumber: fromNumber.trim() || undefined,
          agentId: agentId ? parseInt(agentId, 10) : undefined,
          concurrentCallLimit,
        },
      });
      await qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
      toast({ title: "Settings saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    }
  }

  return (
    <div className="max-w-lg space-y-5">
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Campaign Details</h3>
        <div className="space-y-1.5">
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} className="h-9 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Description</Label>
          <Input value={desc} onChange={e => setDesc(e.target.value)} className="h-9 text-xs" placeholder="Optional description" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft" className="text-xs">Draft</SelectItem>
                <SelectItem value="active" className="text-xs">Active</SelectItem>
                <SelectItem value="paused" className="text-xs">Paused</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">From Number</Label>
            <Input value={fromNumber} onChange={e => setFromNumber(e.target.value)} className="h-9 text-xs" placeholder="+1..." />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Agent</Label>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select agent…" /></SelectTrigger>
            <SelectContent>
              {(agents ?? []).map(a => (
                <SelectItem key={a.id} value={String(a.id)} className="text-xs">{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Concurrency</h3>
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs">Max Concurrent Calls</Label>
            <span className="text-xl font-mono font-bold">{concurrentCallLimit}</span>
          </div>
          <input type="range" min={1} max={100} step={1} value={concurrentCallLimit}
            onChange={e => setConcurrentCallLimit(Number(e.target.value))}
            className="w-full h-1.5 accent-foreground cursor-pointer" />
          <div className="flex justify-between mt-1 text-[10px] text-muted-foreground/40"><span>1</span><span>100</span></div>
        </div>
      </div>

      <Button onClick={() => void handleSave()} disabled={update.isPending} className="h-9 text-xs">
        {update.isPending ? "Saving…" : "Save Changes"}
      </Button>
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
  const [opTab, setOpTab] = useState<"all" | "callbacks" | "incoming" | "bookings" | "transfers">("all");

  async function handleStatusChange(status: "active" | "paused" | "draft") {
    try {
      await update.mutateAsync({ id: campaignId, data: { status } });
      await qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
    } catch {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  }

  const { data: campaign, isLoading: campLoading } = useGetCampaign(campaignId);
  const { data: batches, isLoading: batchLoading } = useListCampaignBatches(campaignId);
  const { data: analytics } = useGetCampaignAnalytics(campaignId);

  const webhookUrl = campaign
    ? `${window.location.origin}${BASE}/api/webhooks/lead/${campaign.webhookToken}`
    : "";

  const fm = campaign?.fieldMappings as Record<string, string> | undefined;
  const calledPct = campaign && campaign.totalLeads > 0
    ? Math.round((campaign.calledLeads / campaign.totalLeads) * 100) : 0;

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

        {/* KPI chips */}
        <div className="flex items-center gap-2 pb-3 overflow-x-auto">
          {[
            { label: "Leads",     value: campaign.totalLeads, tab: "overview" },
            { label: "Called",    value: campaign.calledLeads, tab: "operations" },
            { label: "Callbacks", value: analytics?.callbacks ?? 0, tab: "operations" },
            { label: "Bookings",  value: analytics?.dispositions?.find((d: { label: string }) => d.label.toLowerCase().includes("book"))?.count ?? 0, tab: "operations" },
            { label: "Transfers", value: analytics?.dispositions?.find((d: { label: string }) => d.label.toLowerCase().includes("transfer"))?.count ?? 0, tab: "operations" },
          ].map(kpi => (
            <button key={kpi.label}
              onClick={() => setActiveTab(kpi.tab)}
              className="flex items-center gap-2.5 px-3 py-1.5 bg-card border border-border rounded-lg hover:border-foreground/30 hover:bg-muted/20 transition-colors shrink-0 group">
              <span className="text-[10px] text-muted-foreground/50 uppercase tracking-widest">{kpi.label}</span>
              <span className="text-sm font-semibold text-foreground tabular-nums">{kpi.value.toLocaleString()}</span>
            </button>
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="h-auto bg-transparent p-0 gap-0 border-0 -mb-px overflow-x-auto flex-nowrap">
            {(["overview", "operations", "leads", "analytics", "settings"] as const).map(tab => (
              <TabsTrigger key={tab} value={tab}
                className="h-9 px-4 rounded-none border-b-2 border-transparent bg-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground/60 text-xs font-medium whitespace-nowrap hover:text-foreground transition-colors shrink-0">
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── Overview ────────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5 space-y-5" style={{ maxHeight: "calc(100vh - 210px)" }}>
              {/* Funnel */}
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Call Funnel</h3>
                <div className="flex items-center gap-1 overflow-x-auto pb-1">
                  {[
                    { label: "Imported",    value: campaign.totalLeads,   cls: "bg-muted/60" },
                    { label: "Called",      value: campaign.calledLeads,  cls: "bg-blue-500/15" },
                    { label: "Connected",   value: (analytics?.statusBreakdown as Record<string, number> | undefined)?.["connected"] ?? "—", cls: "bg-blue-500/30" },
                    { label: "Interested",  value: (analytics?.statusBreakdown as Record<string, number> | undefined)?.["interested"] ?? "—", cls: "bg-emerald-500/15" },
                    { label: "Booked",      value: analytics?.dispositions?.find((d: { label: string; count: number }) => d.label.toLowerCase().includes("book"))?.count ?? "—", cls: "bg-emerald-500/30" },
                    { label: "Transferred", value: analytics?.dispositions?.find((d: { label: string; count: number }) => d.label.toLowerCase().includes("transfer"))?.count ?? "—", cls: "bg-purple-500/20" },
                  ].map((stage, i, arr) => (
                    <div key={stage.label} className="flex items-center shrink-0">
                      <div className={cn("px-4 py-3 rounded-xl text-center min-w-[88px]", stage.cls)}>
                        <p className="text-base font-bold tabular-nums leading-none">{typeof stage.value === "number" ? stage.value.toLocaleString() : stage.value}</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-1">{stage.label}</p>
                      </div>
                      {i < arr.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground/20 mx-0.5 shrink-0" />}
                    </div>
                  ))}
                </div>
                {campaign.totalLeads > 0 && (
                  <div className="mt-4">
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary/40 rounded-full transition-all" style={{ width: `${calledPct}%` }} />
                    </div>
                    <div className="flex justify-between mt-1 text-[10px] text-muted-foreground/40">
                      <span>{campaign.calledLeads.toLocaleString()} called</span>
                      <span>{(campaign.totalLeads - campaign.calledLeads).toLocaleString()} remaining</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Batch cards */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Batches</h3>
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
                    {batches.map((batch, i) => {
                      const bPct = batch.totalLeads > 0 ? Math.round((batch.calledLeads / batch.totalLeads) * 100) : 0;
                      return (
                        <div key={batch.id}
                          className="group bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-foreground/20 transition-all"
                          onClick={() => { window.location.href = `${BASE}/app/campaigns/${campaignId}/batches/${batch.id}`; }}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{batch.name || `Batch ${i + 1}`}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] capitalize text-muted-foreground/50">{batch.status}</span>
                                <span className="text-[10px] text-muted-foreground/40">{batch.totalLeads.toLocaleString()} leads</span>
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground/30 shrink-0 group-hover:translate-x-0.5 transition-transform mt-0.5" />
                          </div>
                          {batch.totalLeads > 0 && (
                            <div>
                              <div className="h-1 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-foreground/20 rounded-full" style={{ width: `${bPct}%` }} />
                              </div>
                              <p className="text-[10px] text-muted-foreground/40 mt-1 font-mono">{bPct}% called</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Webhook */}
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider mb-2">Webhook URL</p>
                <div className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2 border border-border">
                  <code className="text-xs font-mono text-muted-foreground/70 flex-1 truncate">{webhookUrl}</code>
                  <CopyButton text={webhookUrl} />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Operations ──────────────────────────────────────────────────── */}
          <TabsContent value="operations" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 210px)" }}>
              {/* Metrics bar */}
              <div className="px-6 py-4 border-b border-border/60 bg-muted/10">
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    { label: "Live Calls",    value: "—",   accent: "text-blue-500" },
                    { label: "Callbacks Due", value: analytics?.callbacks ?? 0, accent: "text-amber-500" },
                    { label: "Incoming",      value: "—",   accent: "" },
                    { label: "Bookings",      value: analytics?.dispositions?.find((d: { label: string; count: number }) => d.label.toLowerCase().includes("book"))?.count ?? 0, accent: "text-emerald-500" },
                    { label: "Transfers",     value: analytics?.dispositions?.find((d: { label: string; count: number }) => d.label.toLowerCase().includes("transfer"))?.count ?? 0, accent: "text-purple-500" },
                    { label: "Failed",        value: (analytics?.statusBreakdown as Record<string, number> | undefined)?.["failed"] ?? "—", accent: "text-red-500" },
                  ].map(m => (
                    <div key={m.label} className="bg-card border border-border rounded-xl px-3 py-2.5 text-center">
                      <p className="text-[9px] text-muted-foreground/40 uppercase tracking-widest leading-none mb-1">{m.label}</p>
                      <p className={cn("text-xl font-semibold tabular-nums leading-none", m.accent || "text-foreground")}>
                        {typeof m.value === "number" ? m.value.toLocaleString() : m.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sub-nav */}
              <div className="px-6 pt-3 pb-0 flex items-center gap-0 border-b border-border/60 overflow-x-auto">
                {(["all", "callbacks", "incoming", "bookings", "transfers"] as const).map(t => (
                  <button key={t} onClick={() => setOpTab(t)}
                    className={cn(
                      "px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap capitalize shrink-0 -mb-px",
                      opTab === t
                        ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground/60 hover:text-foreground"
                    )}>
                    {t === "all" ? "All Work" : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="px-6 py-4">
                {opTab === "all"       && <LiveQueueTab     campaignId={campaign.id} />}
                {opTab === "callbacks" && <CallbacksTab     campaignId={campaign.id} />}
                {opTab === "incoming"  && <IncomingCallsTab campaignId={campaign.id} />}
                {opTab === "bookings"  && <BookingsTab      campaignId={campaign.id} />}
                {opTab === "transfers" && <TransfersTab     campaignId={campaign.id} />}
              </div>
            </div>
          </TabsContent>

          {/* ── Leads ───────────────────────────────────────────────────────── */}
          <TabsContent value="leads" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "calc(100vh - 210px)" }}>
              <LeadsTab campaignId={campaignId} />
            </div>
          </TabsContent>

          {/* ── Analytics ───────────────────────────────────────────────────── */}
          <TabsContent value="analytics" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5 space-y-5" style={{ maxHeight: "calc(100vh - 210px)" }}>
              {!analytics ? (
                <div className="py-16 text-center text-muted-foreground/40">
                  <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No analytics data yet</p>
                  <p className="text-xs mt-1">Start calling leads to see results here</p>
                </div>
              ) : (
                <>
                  {/* Performance rates */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      {
                        label: "Connection Rate",
                        value: analytics.calledLeads > 0
                          ? `${Math.round(((analytics.statusBreakdown as Record<string, number> | undefined)?.["connected"] ?? 0) / analytics.calledLeads * 100)}%`
                          : "—",
                        desc: "Calls that connected",
                        accent: "text-blue-500",
                      },
                      {
                        label: "Booking Rate",
                        value: analytics.calledLeads > 0
                          ? `${Math.round(((analytics.dispositions?.find((d: { label: string; count: number }) => d.label.toLowerCase().includes("book"))?.count ?? 0) / analytics.calledLeads) * 100)}%`
                          : "—",
                        desc: "Calls that booked",
                        accent: "text-emerald-500",
                      },
                      {
                        label: "Transfer Rate",
                        value: analytics.calledLeads > 0
                          ? `${Math.round(((analytics.dispositions?.find((d: { label: string; count: number }) => d.label.toLowerCase().includes("transfer"))?.count ?? 0) / analytics.calledLeads) * 100)}%`
                          : "—",
                        desc: "Calls transferred",
                        accent: "text-purple-500",
                      },
                    ].map(r => (
                      <div key={r.label} className="bg-card border border-border rounded-xl p-5">
                        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-widest">{r.label}</p>
                        <p className={cn("text-4xl font-bold mt-2 tabular-nums", r.accent)}>{r.value}</p>
                        <p className="text-xs text-muted-foreground/40 mt-1">{r.desc}</p>
                      </div>
                    ))}
                  </div>

                  {/* Funnel */}
                  <div className="bg-card border border-border rounded-xl p-5">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Funnel</h3>
                    <div className="space-y-2">
                      {[
                        { label: "Imported",  value: campaign.totalLeads },
                        { label: "Called",    value: campaign.calledLeads },
                        { label: "Connected", value: (analytics.statusBreakdown as Record<string, number> | undefined)?.["connected"] ?? 0 },
                      ].map(stage => {
                        const pct = campaign.totalLeads > 0 ? Math.round((stage.value / campaign.totalLeads) * 100) : 0;
                        return (
                          <div key={stage.label} className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground/60 w-20 shrink-0">{stage.label}</span>
                            <div className="flex-1 h-6 bg-muted rounded-md overflow-hidden">
                              <div className="h-full bg-foreground/15 rounded-md flex items-center px-2 transition-all" style={{ width: `${Math.max(pct, 2)}%` }}>
                                <span className="text-[10px] font-mono text-foreground/70 whitespace-nowrap">{stage.value.toLocaleString()}</span>
                              </div>
                            </div>
                            <span className="text-[10px] font-mono text-muted-foreground/40 w-9 text-right shrink-0">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Disposition Breakdown */}
                  {analytics.dispositions.length > 0 && (
                    <div className="bg-card border border-border rounded-xl p-5">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Disposition Breakdown</h3>
                      <div className="space-y-3">
                        {analytics.dispositions.map((d: { label: string; count: number }) => {
                          const pct = analytics.calledLeads > 0 ? Math.round((d.count / analytics.calledLeads) * 100) : 0;
                          return (
                            <div key={d.label} className="flex items-center gap-3">
                              <span className="text-xs text-foreground/70 capitalize w-40 shrink-0 truncate">{d.label.replace(/_/g, " ")}</span>
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-foreground/20 rounded-full transition-all" style={{ width: `${Math.max(pct, 1)}%` }} />
                              </div>
                              <span className="text-xs font-semibold text-foreground tabular-nums w-12 text-right shrink-0">{d.count.toLocaleString()}</span>
                              <span className="text-[10px] text-muted-foreground/40 tabular-nums w-8 text-right shrink-0">{pct}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </TabsContent>

          {/* ── Settings ────────────────────────────────────────────────────── */}
          <TabsContent value="settings" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "calc(100vh - 210px)" }}>
              <SettingsTab campaign={campaign as unknown as Record<string, unknown>} campaignId={campaignId} />
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
