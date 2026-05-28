import { useState, useRef, useCallback } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetCampaign,
  useListCampaignLeads,
  useUpdateCampaign,
  useRetryCampaignLead,
  useImportCampaignLeads,
  getListCampaignLeadsQueryKey,
  getGetCampaignQueryKey,
} from "@workspace/api-client-react";
import type { CampaignLead } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Copy, Check, RefreshCw, Phone, Mail,
  Clock, RotateCcw, Megaphone, Upload, FileText,
  AlertCircle, CheckCircle2, X,
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

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending:   "bg-gray-50 text-gray-600 border-gray-200",
    calling:   "bg-zinc-50 text-zinc-700 border-zinc-200",
    completed: "bg-zinc-50 text-zinc-700 border-zinc-200",
    failed:    "bg-red-50 text-red-700 border-red-200",
    skipped:   "bg-zinc-50 text-zinc-700 border-zinc-200",
  };
  return map[status] ?? "bg-gray-50 text-gray-500 border-gray-200";
}

function sourceLabel(source: string) {
  if (source === "instagram_ads") return "Instagram";
  if (source === "csv")           return "CSV";
  return "Webhook";
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
    <div className="border border-dashed border-zinc-200 rounded-xl bg-zinc-50/50 p-4">
      <p className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5">
        <Megaphone className="h-3.5 w-3.5" /> Webhook URL
      </p>
      <div className="flex items-center gap-2">
        <code className="text-xs font-mono text-zinc-900 flex-1 truncate">{url}</code>
        <button
          onClick={copy}
          className="shrink-0 p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-600 transition-colors"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-zinc-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className="text-[11px] text-zinc-600/70 mt-2">
        POST JSON leads here — or use as Meta Lead Ads webhook URL (GET for verification, POST for leads).
      </p>
    </div>
  );
}

// ── CSV Upload Modal ──────────────────────────────────────────────────────────

type ImportResult = { imported: number; skipped: number; errors?: string[] };

function UploadCsvModal({
  open,
  onClose,
  campaignId,
  fieldMappings,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: number;
  fieldMappings: Record<string, string>;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const importLeads = useImportCampaignLeads();

  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const phoneField = fieldMappings["phone"] ?? "phone";
  const nameField  = fieldMappings["name"]  ?? "name";
  const emailField = fieldMappings["email"] ?? "email";

  function reset() {
    setDragging(false);
    setFileName(null);
    setParsed(null);
    setResult(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function loadFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const data = parseCsv(text);
      setParsed(data);
    };
    reader.readAsText(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".csv")) loadFile(file);
    else toast({ title: "Please drop a .csv file", variant: "destructive" });
  }, []);

  async function doImport() {
    if (!parsed) return;
    try {
      const res = await importLeads.mutateAsync({
        id: campaignId,
        data: { leads: parsed.rows },
      });
      setResult(res);
      onSuccess();
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    }
  }

  const phoneDetected = parsed ? parsed.headers.includes(phoneField) : null;
  const previewRows   = parsed?.rows.slice(0, 5) ?? [];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-zinc-600" /> Upload CSV
          </DialogTitle>
          <DialogDescription>
            Upload a CSV file to bulk-import leads into this campaign.
          </DialogDescription>
        </DialogHeader>

        {/* Success result */}
        {result ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="p-3 rounded-full bg-zinc-50 text-zinc-600">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">Import complete</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  <span className="font-semibold text-zinc-700">{result.imported} leads imported</span>
                  {result.skipped > 0 && (
                    <span className="text-zinc-600">, {result.skipped} rows skipped</span>
                  )}
                </p>
              </div>
              {(result.errors ?? []).length > 0 && (
                <div className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-left">
                  <p className="text-xs font-semibold text-zinc-700 mb-1.5 flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" /> Skipped rows
                  </p>
                  <ul className="space-y-0.5">
                    {(result.errors ?? []).map((e, i) => (
                      <li key={i} className="text-xs text-zinc-700 font-mono">{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Field mapping reference */}
            <div className="bg-gray-50 rounded-lg p-3 text-xs">
              <p className="font-semibold text-gray-500 mb-2">This campaign maps CSV columns:</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { role: "Phone (required)", field: phoneField },
                  ...(fieldMappings["name"]  ? [{ role: "Name",  field: nameField  }] : []),
                  ...(fieldMappings["email"] ? [{ role: "Email", field: emailField }] : []),
                ].map(({ role, field }) => (
                  <div key={role} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded px-2 py-1">
                    <span className="text-gray-400">{role}</span>
                    <span className="text-gray-300">←</span>
                    <code className="font-mono text-zinc-700">{field}</code>
                  </div>
                ))}
              </div>
              <p className="text-gray-400 mt-1.5">
                Make sure your CSV has a column named exactly <code className="font-mono text-zinc-700">{phoneField}</code>.
              </p>
            </div>

            {/* Drop zone */}
            {!parsed ? (
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
                  dragging
                    ? "border-zinc-400 bg-zinc-50"
                    : "border-gray-200 hover:border-zinc-300 hover:bg-gray-50"
                }`}
              >
                <div className="p-3 rounded-full bg-zinc-50 text-zinc-400">
                  <FileText className="h-7 w-7" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700">
                    Drop your CSV file here, or click to browse
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Must include a <code className="font-mono">{phoneField}</code> column • Any number of rows
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={onFileChange}
                />
              </div>
            ) : (
              <div className="space-y-3">
                {/* File name + clear */}
                <div className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-zinc-500" />
                    <span className="text-sm font-medium text-zinc-800">{fileName}</span>
                    <span className="text-xs text-zinc-500">
                      {parsed.rows.length.toLocaleString()} rows detected
                    </span>
                  </div>
                  <button
                    onClick={reset}
                    className="text-zinc-400 hover:text-zinc-700 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Column detection status */}
                {phoneDetected === false && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    <div className="text-sm text-red-700">
                      <p className="font-semibold">Phone column not found</p>
                      <p className="text-xs mt-0.5">
                        Your CSV headers: <code className="font-mono">{parsed.headers.join(", ")}</code>
                        <br />
                        Expected column: <code className="font-mono text-red-800">{phoneField}</code>
                        <br />
                        Update the campaign's field mappings to match your column names.
                      </p>
                    </div>
                  </div>
                )}

                {phoneDetected && (
                  <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 text-zinc-500 shrink-0" />
                    <p className="text-xs text-zinc-700">
                      Phone column <code className="font-mono font-bold">{phoneField}</code> detected —{" "}
                      ready to import <strong>{parsed.rows.length.toLocaleString()}</strong> leads
                    </p>
                  </div>
                )}

                {/* Preview table */}
                {parsed.headers.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                      Preview (first {Math.min(previewRows.length, 5)} rows)
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-gray-100">
                      <table className="text-xs w-full">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            {parsed.headers.map(h => (
                              <th
                                key={h}
                                className={`px-3 py-2 text-left font-medium ${
                                  h === phoneField
                                    ? "text-zinc-700 bg-zinc-50"
                                    : h === nameField || h === emailField
                                    ? "text-zinc-600"
                                    : "text-gray-400"
                                }`}
                              >
                                {h}
                                {h === phoneField && (
                                  <span className="ml-1 text-[9px] bg-zinc-100 text-zinc-600 px-1 rounded">phone</span>
                                )}
                                {h === nameField && h !== phoneField && (
                                  <span className="ml-1 text-[9px] bg-zinc-100 text-zinc-600 px-1 rounded">name</span>
                                )}
                                {h === emailField && h !== phoneField && (
                                  <span className="ml-1 text-[9px] bg-zinc-100 text-zinc-600 px-1 rounded">email</span>
                                )}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.map((row, i) => (
                            <tr key={i} className="border-b border-gray-50 last:border-0">
                              {parsed.headers.map(h => (
                                <td
                                  key={h}
                                  className={`px-3 py-1.5 truncate max-w-[160px] ${
                                    h === phoneField ? "font-mono font-medium text-gray-800" : "text-gray-500"
                                  }`}
                                >
                                  {row[h] ?? ""}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {parsed.rows.length > 5 && (
                      <p className="text-[11px] text-gray-400 mt-1">
                        …and {(parsed.rows.length - 5).toLocaleString()} more rows
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={() => void doImport()}
                disabled={!parsed || !phoneDetected || importLeads.isPending}
                className="gap-2"
              >
                <Upload className="h-3.5 w-3.5" />
                {importLeads.isPending
                  ? "Importing…"
                  : parsed
                  ? `Import ${parsed.rows.length.toLocaleString()} leads`
                  : "Import leads"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Lead row ──────────────────────────────────────────────────────────────────

function LeadRow({ lead, onRetry }: { lead: CampaignLead; onRetry: () => void }) {
  const [open, setOpen] = useState(false);
  const canRetry = lead.callStatus === "failed" || lead.callStatus === "skipped";

  return (
    <>
      <tr
        className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <span className="text-sm font-mono font-medium text-gray-800">{lead.phone}</span>
          </div>
          {lead.name && <p className="text-xs text-gray-400 mt-0.5 ml-5.5">{lead.name}</p>}
        </td>
        <td className="py-3 px-4">
          <Badge variant="outline" className={`text-[10px] ${statusBadge(lead.callStatus)}`}>
            {lead.callStatus}
          </Badge>
        </td>
        <td className="py-3 px-4 text-xs text-gray-400">{lead.callAttempts}</td>
        <td className="py-3 px-4 text-xs text-gray-400">{sourceLabel(lead.source)}</td>
        <td className="py-3 px-4 text-xs text-gray-400">
          {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}
        </td>
        <td className="py-3 px-4">
          {canRetry && (
            <Button
              variant="ghost" size="sm"
              className="h-6 text-xs gap-1"
              onClick={e => { e.stopPropagation(); onRetry(); }}
            >
              <RotateCcw className="h-3 w-3" /> Retry
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-zinc-50/30">
          <td colSpan={6} className="px-4 py-3">
            <div className="grid grid-cols-2 gap-4 text-xs">
              {lead.email && (
                <div className="flex items-center gap-1.5 text-gray-500">
                  <Mail className="h-3.5 w-3.5" /> {lead.email}
                </div>
              )}
              {lead.lastAttemptAt && (
                <div className="flex items-center gap-1.5 text-gray-500">
                  <Clock className="h-3.5 w-3.5" /> Last attempt: {format(new Date(lead.lastAttemptAt), "MMM d, HH:mm")}
                </div>
              )}
              {lead.externalLeadId && (
                <div className="text-gray-400">Lead ID: <code className="font-mono">{lead.externalLeadId}</code></div>
              )}
              {lead.notes && (
                <div className="col-span-2 text-red-500">{lead.notes}</div>
              )}
              {Object.keys(lead.leadData ?? {}).length > 0 && (
                <div className="col-span-2">
                  <p className="font-medium text-gray-500 mb-1">Form data</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(lead.leadData as Record<string, string>).map(([k, v]) => (
                      <div key={k} className="flex gap-1">
                        <span className="text-gray-400 font-mono">{k}:</span>
                        <span className="text-gray-600 truncate">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CampaignDetailPage() {
  const [, params] = useRoute("/app/campaigns/:id");
  const id = parseInt(params?.id ?? "0", 10);
  const qc = useQueryClient();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const PAGE_SIZE = 25;

  const { data: campaign, isLoading: loadingCampaign } = useGetCampaign(id);
  const { data: leadsData, isLoading: loadingLeads, refetch } = useListCampaignLeads(id, {
    status: statusFilter === "all" ? undefined : statusFilter,
    limit:  PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const upd   = useUpdateCampaign();
  const retry = useRetryCampaignLead();

  async function toggleActive() {
    if (!campaign) return;
    await upd.mutateAsync({ id: campaign.id, data: { isActive: !campaign.isActive } });
    await qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
  }

  async function handleRetry(leadId: number) {
    try {
      await retry.mutateAsync({ id, leadId });
      await qc.invalidateQueries({ queryKey: getListCampaignLeadsQueryKey(id) });
      toast({ title: "Retry queued" });
    } catch {
      toast({ title: "Retry failed", variant: "destructive" });
    }
  }

  async function handleImportSuccess() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListCampaignLeadsQueryKey(id) }),
      qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) }),
    ]);
    toast({ title: "Leads imported — campaign updated" });
  }

  if (loadingCampaign) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="h-40 bg-gray-50 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Campaign not found.</p>
        <Link href="/app/campaigns"><Button variant="ghost" className="mt-2">Back to campaigns</Button></Link>
      </div>
    );
  }

  const leads = leadsData?.leads ?? [];
  const total = leadsData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const fieldMappings = campaign.fieldMappings as Record<string, string>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Back */}
      <Link href="/app/campaigns">
        <button className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 mb-4 transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Campaigns
        </button>
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-zinc-50 text-zinc-600">
            <Megaphone className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{campaign.name}</h1>
            {campaign.description && <p className="text-sm text-gray-400">{campaign.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-sm"
            onClick={() => setUploadOpen(true)}
          >
            <Upload className="h-3.5 w-3.5" /> Upload CSV
          </Button>
          <span className="text-sm text-gray-500">{campaign.isActive ? "Active" : "Inactive"}</span>
          <Switch checked={campaign.isActive} onCheckedChange={() => void toggleActive()} />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total leads",  value: campaign.totalLeads  },
          { label: "Calls made",   value: campaign.calledLeads  },
          { label: "Max attempts", value: campaign.maxAttempts  },
          { label: "Delay (s)",    value: campaign.callDelaySeconds },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-3 text-center">
            <p className="text-[11px] text-gray-400">{s.label}</p>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Webhook URL */}
      <div className="mb-6">
        <WebhookUrlBox token={campaign.webhookToken} />
      </div>

      {/* Field mappings */}
      <div className="mb-6 bg-white border border-gray-100 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Field Mappings</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(fieldMappings).map(([role, field]) => (
            <div key={role} className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-3 py-1.5 text-xs">
              <span className="font-medium text-gray-700">{role}</span>
              <span className="text-gray-300">←</span>
              <code className="font-mono text-zinc-700">{field}</code>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          Use <code className="font-mono">{"{{name}}"}</code>, <code className="font-mono">{"{{phone}}"}</code>, etc. as variables in your agent's system prompt.
          When uploading CSV, column names must match these field mappings exactly.
        </p>
      </div>

      {/* Leads table */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
          <p className="text-sm font-semibold text-gray-700">
            Leads <span className="text-gray-400 font-normal">({total})</span>
          </p>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="h-7 text-xs w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="calling">Calling</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="h-3 w-3" /> Upload CSV
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => void refetch()}>
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
          </div>
        </div>

        {loadingLeads ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading leads…</div>
        ) : !leads.length ? (
          <div className="p-12 text-center">
            <div className="inline-flex flex-col items-center gap-3">
              <div className="p-3 rounded-full bg-gray-50 text-gray-300">
                <FileText className="h-7 w-7" />
              </div>
              <p className="text-gray-400 text-sm font-medium">No leads yet</p>
              <div className="flex gap-2 mt-1">
                <Button size="sm" className="gap-1.5 text-xs" onClick={() => setUploadOpen(true)}>
                  <Upload className="h-3.5 w-3.5" /> Upload CSV
                </Button>
                <Button variant="outline" size="sm" className="text-xs">
                  or POST to webhook
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-50">
                {["Phone / Name", "Status", "Attempts", "Source", "Received", ""].map(h => (
                  <th key={h} className="py-2 px-4 text-[11px] font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map(lead => (
                <LeadRow key={lead.id} lead={lead} onRetry={() => void handleRetry(lead.id)} />
              ))}
            </tbody>
          </table>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
            <p className="text-xs text-gray-400">Page {page + 1} of {totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* CSV Upload Modal */}
      <UploadCsvModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        campaignId={id}
        fieldMappings={fieldMappings}
        onSuccess={() => void handleImportSuccess()}
      />
    </div>
  );
}
