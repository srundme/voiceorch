import { useState, useRef } from "react";
import LiveQueueTab from "./live-queue";
import CallbacksTab from "./callbacks";
import IncomingCallsTab from "./incoming";
import BookingsTab from "./bookings";
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
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <Link href="/app/campaigns">
              <Button variant="outline" size="icon" className="h-8 w-8 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-semibold tracking-tight">{campaign.name}</h2>
                <CampaignStatusBadge status={campaign.status} />
              </div>
              {campaign.description && (
                <p className="text-xs text-muted-foreground/60 mt-0.5">{campaign.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a href={`${BASE}/api/campaigns/${campaignId}/csv-template`} download
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-xs text-foreground/70 hover:bg-muted transition-colors">
              <FileText className="h-3.5 w-3.5" /> CSV Template
            </a>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="h-auto bg-transparent p-0 gap-0 border-0 -mb-px overflow-x-auto flex-nowrap">
            {(["overview", "batches", "live-queue", "callbacks", "incoming", "bookings", "transfers", "leads", "analytics", "settings"] as const).map(tab => (
              <TabsTrigger key={tab} value={tab}
                className="h-9 px-4 rounded-none border-b-2 border-transparent bg-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground/60 text-xs font-medium whitespace-nowrap hover:text-foreground transition-colors shrink-0">
                {tab === "live-queue" ? "Live Queue" :
                 tab === "incoming" ? "Incoming Calls" :
                 tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === "batches" && !batchLoading && batches?.length ? (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-muted text-[9px]">{batches.length}</span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── Overview ───────────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5 space-y-5" style={{ maxHeight: "calc(100vh - 160px)" }}>
              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {[
                  { label: "Total Leads",  value: campaign.totalLeads },
                  { label: "Calls Made",   value: campaign.calledLeads },
                  { label: "Progress",     value: `${calledPct}%` },
                  { label: "Batches",      value: batches?.length ?? 0 },
                  { label: "Concurrent",   value: campaign.concurrentCallLimit ?? 20 },
                  { label: "Delay",        value: `${campaign.callDelaySeconds}s` },
                ].map(stat => (
                  <div key={stat.label} className="bg-card border border-border rounded-xl p-3">
                    <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">{stat.label}</p>
                    <p className="text-lg font-semibold text-foreground mt-0.5">{stat.value}</p>
                  </div>
                ))}
              </div>

              {/* Progress + Webhook */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 space-y-5">
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
                  <div>
                    <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider mb-1.5">Webhook URL</p>
                    <div className="flex items-center gap-2 bg-elevated/30 rounded-lg px-3 py-2.5 border border-border">
                      <code className="text-xs font-mono text-muted-foreground/70 flex-1 truncate">{webhookUrl}</code>
                      <CopyButton text={webhookUrl} />
                    </div>
                  </div>
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
                <div className="bg-card border border-border rounded-xl p-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-xs font-semibold text-foreground flex items-center gap-2">
                      <Info className="h-4 w-4 text-primary/70" /> Campaign Settings
                    </p>
                  </div>
                  <DetailRow label="Agent ID" value={campaign.agentId ?? "—"} icon={<Hash className="h-3 w-3" />} />
                  <DetailRow label="From Number" value={campaign.fromNumber ?? "—"} icon={<Phone className="h-3 w-3" />} />
                  <DetailRow label="Max Attempts" value={campaign.maxAttempts} icon={<Activity className="h-3 w-3" />} />
                  <DetailRow label="Created" value={formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true })} icon={<Calendar className="h-3 w-3" />} />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Batches ────────────────────────────────────────────────────────── */}
          <TabsContent value="batches" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "calc(100vh - 160px)" }}>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-muted-foreground/50" />
                    <h2 className="text-sm font-semibold text-foreground">Batches</h2>
                    {!batchLoading && batches && (
                      <span className="text-xs text-muted-foreground/40">({batches.length})</span>
                    )}
                  </div>
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setLocation(`/app/campaigns/${campaignId}/batches/new`)}>
                    <Plus className="h-3.5 w-3.5" /> New Batch
                  </Button>
                </div>
                {batchLoading ? (
                  <div className="divide-y divide-border">
                    {[1, 2].map(i => (
                      <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
                        <div className="h-8 w-8 bg-muted rounded-lg" />
                        <div className="flex-1 space-y-2"><div className="h-3 w-32 bg-muted rounded" /><div className="h-2.5 w-48 bg-muted rounded" /></div>
                      </div>
                    ))}
                  </div>
                ) : !batches?.length ? (
                  <div className="py-16 text-center">
                    <div className="h-10 w-10 rounded-xl bg-elevated border border-border flex items-center justify-center mx-auto mb-3">
                      <Layers className="h-5 w-5 text-muted-foreground/30" />
                    </div>
                    <p className="text-sm font-medium text-foreground/70 mb-1">No batches yet</p>
                    <p className="text-xs text-muted-foreground/40 mb-4">Create a batch to start calling leads</p>
                    <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setLocation(`/app/campaigns/${campaignId}/batches/new`)}>
                      <Plus className="h-3.5 w-3.5" /> Create First Batch
                    </Button>
                  </div>
                ) : (
                  <div>
                    {batches.map((batch, i) => (
                      <BatchRow key={batch.id} batch={batch} index={i + 1} campaignId={campaignId} onDelete={setDeletingBatch} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ── Live Queue ─────────────────────────────────────────────────────── */}
          <TabsContent value="live-queue" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "calc(100vh - 160px)" }}>
              <LiveQueueTab campaignId={campaign.id} />
            </div>
          </TabsContent>

          {/* ── Callbacks ──────────────────────────────────────────────────────── */}
          <TabsContent value="callbacks" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "calc(100vh - 160px)" }}>
              <CallbacksTab campaignId={campaign.id} />
            </div>
          </TabsContent>

          {/* ── Incoming ───────────────────────────────────────────────────────── */}
          <TabsContent value="incoming" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "calc(100vh - 160px)" }}>
              <IncomingCallsTab campaignId={campaign.id} />
            </div>
          </TabsContent>

          {/* ── Bookings ───────────────────────────────────────────────────────── */}
          <TabsContent value="bookings" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "calc(100vh - 160px)" }}>
              <BookingsTab campaignId={campaign.id} />
            </div>
          </TabsContent>

          {/* ── Transfers ──────────────────────────────────────────────────────── */}
          <TabsContent value="transfers" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "calc(100vh - 160px)" }}>
              <CampaignTabPlaceholder
                icon={<ArrowRightLeft className="h-6 w-6" />}
                title="Transfers"
                description="Leads from this campaign who were transferred to a human agent. Track transfer outcomes, agents, and resolution status."
                color="rose"
              />
            </div>
          </TabsContent>

          {/* ── Leads ──────────────────────────────────────────────────────────── */}
          <TabsContent value="leads" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "calc(100vh - 160px)" }}>
              <LeadsTab campaignId={campaignId} />
            </div>
          </TabsContent>

          {/* ── Analytics ──────────────────────────────────────────────────────── */}
          <TabsContent value="analytics" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "calc(100vh - 160px)" }}>
              {!analytics || (!analytics.dispositions.length && !analytics.callbacks) ? (
                <div className="py-16 text-center text-muted-foreground/40">
                  <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No analytics data yet</p>
                  <p className="text-xs mt-1">Start calling leads to see results here</p>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {Object.entries(analytics.statusBreakdown ?? {}).map(([status, count]) => (
                      <div key={status} className="bg-card border border-border rounded-xl px-4 py-3">
                        <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider capitalize">{status.replace(/_/g, " ")}</p>
                        <p className="text-2xl font-semibold text-foreground mt-0.5 tabular-nums">{count}</p>
                      </div>
                    ))}
                    {analytics.callbacks > 0 && (
                      <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl px-4 py-3">
                        <p className="text-[9px] text-purple-400 uppercase tracking-wider">Callbacks</p>
                        <p className="text-2xl font-semibold text-purple-300 mt-0.5 tabular-nums">{analytics.callbacks}</p>
                      </div>
                    )}
                  </div>
                  {analytics.dispositions.length > 0 && (
                    <div className="bg-card border border-border rounded-xl p-5">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Disposition Breakdown</h3>
                      <div className="flex flex-wrap gap-3">
                        {analytics.dispositions.map(d => {
                          const pct = analytics.calledLeads > 0 ? Math.round((d.count / analytics.calledLeads) * 100) : 0;
                          return (
                            <div key={d.label} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-background min-w-[120px]">
                              <div>
                                <p className="text-xs text-muted-foreground capitalize truncate">{d.label}</p>
                                <div className="flex items-baseline gap-1.5 mt-0.5">
                                  <span className="text-xl font-bold text-foreground">{d.count}</span>
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
            </div>
          </TabsContent>

          {/* ── Settings ───────────────────────────────────────────────────────── */}
          <TabsContent value="settings" className="mt-0 border-0 p-0">
            <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: "calc(100vh - 160px)" }}>
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
