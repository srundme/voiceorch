import { useState, useRef, useCallback, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useMutation } from "@tanstack/react-query";
import {
  useGetCampaign, useListLeadSources,
  useListAgentVariables, useCreateCampaignBatch, useUpdateCampaignBatch, useStartCampaignBatch,
  getGetCampaignQueryKey, getListLeadSourcesQueryKey, getListAgentVariablesQueryKey,
  useListCrmConnections, getListCrmConnectionsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import type {
  LeadSource, AgentVariable, CampaignBatch, CrmConnection,
} from "@workspace/api-client-react";
import { CrmImportDialog } from "@/pages/connections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, ChevronRight, Upload, FileText, Database,
  Globe, Webhook, AlertTriangle, AlertCircle,
  RefreshCw, Check, ArrowLeft,
  Phone, User, Mail, Clock,
  Shield, Layers, ListChecks, Play, Info,
  Building2, ExternalLink, Copy, Zap, X, ChevronDown,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

interface ValidationPreviewRow {
  rowIndex: number;
  raw: Record<string, string>;
  normalized: string | null;
  phoneValid: boolean;
  isDuplicate: boolean;
  status: "valid" | "warning" | "error";
  errors: string[];
}

interface ValidationPreviewResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  previewRows: ValidationPreviewRow[];
}

type DuplicatePolicy = "ignore" | "skip" | "reject_with_report";
type SourceType = "csv" | "meta_form" | "webhook";

interface CrmImportSummary {
  leadsCreated: number;
  duplicatesFound: number;
  invalidPhones: number;
}

interface WizardState {
  batchName: string;
  batchDescription: string;
  sourceMode: "existing" | "new" | "crm";
  crmBatchId: number | null;
  crmImportSummary: CrmImportSummary | null;
  selectedSource: LeadSource | null;
  newSourceType: SourceType;
  createdSource: LeadSource | null;
  csvFile: File | null;
  csvHeaders: string[];
  csvRows: Record<string, string>[];
  csvFileName: string;
  fieldMapping: Record<string, string>;
  validationResult: ValidationPreviewResult | null;
  duplicatePolicy: DuplicatePolicy;
  callDelaySeconds: number;
  maxAttempts: number;
  retryDelayMinutes: number;
  timezone: string;
  businessHoursStart: number | null;
  businessHoursEnd: number | null;
  maxDailyCalls: number | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  autoStart: boolean;
}

const INITIAL_STATE: WizardState = {
  batchName: "",
  batchDescription: "",
  sourceMode: "new",
  crmBatchId: null,
  crmImportSummary: null,
  selectedSource: null,
  newSourceType: "webhook",
  createdSource: null,
  csvFile: null,
  csvHeaders: [],
  csvRows: [],
  csvFileName: "",
  fieldMapping: {},
  validationResult: null,
  duplicatePolicy: "skip",
  callDelaySeconds: 5,
  maxAttempts: 2,
  retryDelayMinutes: 60,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  businessHoursStart: null,
  businessHoursEnd: null,
  maxDailyCalls: null,
  scheduledStartAt: null,
  scheduledEndAt: null,
  autoStart: false,
};

const STEP_DEFS = [
  { num: 1, label: "Batch Info" },
  { num: 2, label: "Source Config" },
  { num: 3, label: "Variable Mapping" },
  { num: 4, label: "Validation" },
  { num: 5, label: "Duplicate Policy" },
  { num: 6, label: "Execution Rules" },
  { num: 7, label: "Review & Launch" },
] as const;

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

// ── Auto-mapping ──────────────────────────────────────────────────────────────

const PHONE_ALIASES  = ["phone", "mobile", "telephone", "cell", "contact", "phone_number", "mobile_number", "tel", "phonenumber", "mobilephone"];
const NAME_ALIASES   = ["name", "full_name", "fullname", "customer_name", "lead_name", "contact_name", "firstname", "first_name"];
const EMAIL_ALIASES  = ["email", "email_address", "mail", "e_mail", "emailaddress"];

function normalizeKey(s: string) { return s.toLowerCase().replace(/[\s_-]/g, ""); }

function autoMap(headers: string[], variables: AgentVariable[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();

  function findHeader(aliases: string[]): string {
    for (const alias of aliases) {
      const h = headers.find(h => normalizeKey(h) === normalizeKey(alias));
      if (h && !used.has(h)) { used.add(h); return h; }
    }
    return "";
  }

  mapping["phone"] = findHeader(PHONE_ALIASES);
  mapping["name"]  = findHeader(NAME_ALIASES);
  mapping["email"] = findHeader(EMAIL_ALIASES);

  for (const v of variables) {
    const varName = v.variableName;
    const bareKey = varName.replace(/^\{\{|\}\}$/g, "");
    const h = headers.find(h => normalizeKey(h) === normalizeKey(bareKey));
    if (h && !used.has(h)) { used.add(h); mapping[varName] = h; }
    else if (!mapping[varName]) mapping[varName] = "";
  }

  return mapping;
}

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function DetailRow({
  icon, label, value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-xs font-medium text-foreground/80 max-w-[220px] truncate text-right">{value}</div>
    </div>
  );
}

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 border border-border rounded-xl p-4">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">{title}</p>
      {children}
    </div>
  );
}

function StatCard({
  label, value, color,
}: {
  label: string;
  value: number;
  color: "default" | "green" | "red" | "amber";
}) {
  const bg   = { default: "bg-muted/30 border-border", green: "bg-emerald-500/10 border-emerald-500/20", red: "bg-destructive/10 border-destructive/20", amber: "bg-amber-500/10 border-amber-500/20" }[color];
  const text = { default: "text-foreground", green: "text-emerald-400", red: "text-destructive", amber: "text-amber-400" }[color];
  return (
    <div className={cn("border rounded-xl p-4 text-center", bg)}>
      <p className={cn("text-2xl font-bold tabular-nums", text)}>{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

// ── Step 1: Batch Info ────────────────────────────────────────────────────────

function Step1({
  state, setState, campaignId,
}: {
  state: WizardState;
  setState: (p: Partial<WizardState>) => void;
  campaignId: number;
}) {
  const { data: campaign, isLoading } = useGetCampaign(campaignId, {
    query: { queryKey: getGetCampaignQueryKey(campaignId) },
  });

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold">Batch Information</h2>
        <p className="text-sm text-muted-foreground mt-1">Name this batch and add an optional description.</p>
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">
            Batch Name <span className="text-destructive">*</span>
          </Label>
          <Input
            value={state.batchName}
            onChange={e => setState({ batchName: e.target.value })}
            placeholder="e.g. June Outreach — Wave 1"
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">
            Description <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Textarea
            value={state.batchDescription}
            onChange={e => setState({ batchDescription: e.target.value })}
            placeholder="Internal notes about this batch…"
            rows={3}
            className="text-sm resize-none"
          />
        </div>
      </div>
      <div className="bg-muted/40 border border-border rounded-xl p-4 space-y-1">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Campaign</p>
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-4 w-48" />)}</div>
        ) : (
          <>
            <DetailRow icon={<Zap className="w-3.5 h-3.5" />} label="Campaign" value={campaign?.name ?? "—"} />
            <DetailRow icon={<User className="w-3.5 h-3.5" />} label="Agent" value={campaign?.agentId ? `Agent #${campaign.agentId}` : "—"} />
            <DetailRow icon={<Phone className="w-3.5 h-3.5" />} label="Phone" value={campaign?.fromNumber ?? "—"} />
          </>
        )}
      </div>

    </div>
  );
}

// ── Step 2: Lead Source ───────────────────────────────────────────────────────

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  csv:       <FileText className="w-4 h-4 text-blue-400" />,
  webhook:   <Webhook className="w-4 h-4 text-violet-400" />,
  meta_form: <Building2 className="w-4 h-4 text-orange-400" />,
  manual:    <User className="w-4 h-4 text-zinc-400" />,
  api:       <Globe className="w-4 h-4 text-emerald-400" />,
};

function Step2({
  state, setState, campaignId, onCrmImported,
}: {
  state: WizardState;
  setState: (p: Partial<WizardState>) => void;
  campaignId: number;
  onCrmImported?: (batchId: number, summary: CrmImportSummary) => void;
}) {
  const { data: sources = [], isLoading } = useListLeadSources({
    query: { queryKey: getListLeadSourcesQueryKey() },
  });
  const { data: crmConnections = [] } = useListCrmConnections({
    query: { queryKey: getListCrmConnectionsQueryKey() },
  });
  const [search, setSearch] = useState("");
  const [importConn, setImportConn] = useState<CrmConnection | null>(null);
  const filtered = sources.filter(s => !search || s.sourceName.toLowerCase().includes(search.toLowerCase()));

  const CRM_TILES = [
    { id: "hubspot" as const, name: "HubSpot",    icon: <span className="text-orange-400 font-bold text-sm">HS</span> },
    { id: "zoho"    as const, name: "Zoho CRM",   icon: <span className="text-blue-400 font-bold text-sm">ZO</span> },
    { id: "sf"      as const, name: "Salesforce", icon: <Globe className="w-4 h-4 text-muted-foreground" />, disabled: true },
  ] as const;

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">Lead Source</h2>
        <p className="text-sm text-muted-foreground mt-1">Select an existing source or create a new one.</p>
      </div>

      {sources.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Existing Sources</p>
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-7 text-xs w-44"
            />
          </div>
          {isLoading ? (
            <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No sources match "{search}"</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {filtered.map(src => {
                const isSelected = state.sourceMode === "existing" && state.selectedSource?.id === src.id;
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => setState({
                      sourceMode: "existing",
                      selectedSource: src,
                      newSourceType: (src.sourceType as SourceType),
                    })}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-all",
                      isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      {SOURCE_ICONS[src.sourceType] ?? <Database className="w-4 h-4" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{src.sourceName}</span>
                          <span className="text-[10px] text-muted-foreground capitalize px-1.5 py-0.5 bg-muted rounded">
                            {src.sourceType.replace("_", " ")}
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          Created {new Date(src.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Create New Source</p>
        <div className="grid grid-cols-3 gap-3">
          {(["csv", "webhook", "meta_form"] as const).map(type => {
            const isSelected = state.sourceMode === "new" && state.newSourceType === type;
            const labels: Record<string, { name: string; desc: string }> = {
              csv:       { name: "CSV Upload",  desc: "Upload a CSV file" },
              webhook:   { name: "Webhook",     desc: "Receive leads via webhook" },
              meta_form: { name: "Meta Form",   desc: "Connect Meta Lead Ads" },
            };
            const info = labels[type]!;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setState({ sourceMode: "new", newSourceType: type, selectedSource: null })}
                className={cn(
                  "p-4 rounded-xl border text-left transition-all space-y-2",
                  isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
                )}
              >
                <div className="flex items-center justify-between">
                  {SOURCE_ICONS[type]}
                  {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-primary" />}
                </div>
                <div>
                  <p className="text-sm font-medium">{info.name}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{info.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* CRM tiles — connection-aware */}
        <div className="space-y-2 mt-1">
          <p className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wider">CRM Import</p>
          <div className="grid grid-cols-3 gap-3">
            {CRM_TILES.map(crm => {
              const conn = "disabled" in crm ? undefined : crmConnections.find(c => c.provider === crm.id);
              const isConnected = !!conn;
              const isDisabled  = "disabled" in crm && crm.disabled;

              const handleClick = () => {
                if (isDisabled) return;
                if (isConnected && conn) {
                  setImportConn(conn);
                } else {
                  window.location.href = `${BASE}/app/connections#crm-connect=${crm.id}`;
                }
              };

              return (
                <button
                  key={crm.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={handleClick}
                  className={cn(
                    "p-4 rounded-xl border text-left transition-all space-y-2",
                    isDisabled
                      ? "border-border opacity-40 pointer-events-none"
                      : isConnected
                        ? "border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-500/60 hover:bg-emerald-500/10"
                        : "border-border hover:border-primary/50 hover:bg-muted/30",
                  )}
                >
                  <div className="flex items-center justify-between">
                    {crm.icon}
                    {isConnected
                      ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          <span className="w-1 h-1 rounded-full bg-emerald-500" />Connected
                        </span>
                      : !isDisabled && <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    }
                  </div>
                  <div>
                    <p className="text-sm font-medium">{crm.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {isDisabled ? "Coming Soon" : isConnected ? "Import contacts →" : "Connect & import →"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {crmConnections.length > 0
              ? "Click a connected CRM to import contacts directly into this campaign."
              : "Click HubSpot or Zoho CRM to connect your account first, then return here to import."}
          </p>
        </div>
      </div>

      {importConn && (
        <CrmImportDialog
          connection={importConn}
          open={!!importConn}
          onClose={() => setImportConn(null)}
          defaultCampaignId={campaignId}
          onImported={(batchId, leadsCreated, duplicatesFound, invalidPhones) => {
            setState({ sourceMode: "crm", crmBatchId: batchId });
            setImportConn(null);
            onCrmImported?.(batchId, { leadsCreated, duplicatesFound, invalidPhones });
          }}
        />
      )}
    </div>
  );
}

// ── Meta Form Integration step ────────────────────────────────────────────────

type MetaIntegrationRow = {
  id: number;
  pageName: string | null;
  formId: string;
  formName: string | null;
  webhookToken: string;
  active: boolean;
  createdAt: string;
};

function MetaFormStep({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [integrations, setIntegrations] = useState<MetaIntegrationRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [creating, setCreating]       = useState(false);
  const [showNew, setShowNew]         = useState(false);
  const [formId, setFormId]           = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [pageName, setPageName]       = useState("");
  const [formName, setFormName]       = useState("");
  const [showToken, setShowToken]     = useState(false);
  const [justCreated, setJustCreated] = useState<{ webhookUrl: string; verifyToken: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  function copy(text: string, field: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    });
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await customFetch<{ integrations: MetaIntegrationRow[] }>(`${BASE}/api/meta/integrations`);
      setIntegrations(data.integrations);
      if (data.integrations.length === 0) setShowNew(true);
    } catch {
      setIntegrations([]);
      setShowNew(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate() {
    if (!formId.trim() || !accessToken.trim()) {
      toast({ title: "Form ID and Access Token are required", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const result = await customFetch<{ id: number; webhookUrl: string; verifyToken: string }>(
        `${BASE}/api/meta/integrations`,
        {
          method: "POST",
          body: JSON.stringify({
            formId:      formId.trim(),
            accessToken: accessToken.trim(),
            pageName:    pageName.trim() || undefined,
            formName:    formName.trim() || undefined,
          }),
        },
      );
      setJustCreated({ webhookUrl: result.webhookUrl, verifyToken: result.verifyToken });
      setShowNew(false);
      setFormId(""); setAccessToken(""); setPageName(""); setFormName("");
      await load();
    } catch {
      toast({ title: "Failed to create integration", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 max-w-xl">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold">Meta Lead Form</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Connect a Meta Lead Ads form. Leads arrive automatically via webhook and trigger outbound calls.
        </p>
      </div>

      {/* Existing integrations */}
      {integrations.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Connected Forms</p>
          {integrations.map(ig => (
            <div key={ig.id} className="p-3 rounded-lg border border-border bg-muted/20 space-y-2">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-orange-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{ig.formName ?? ig.formId}</p>
                  {ig.pageName && <p className="text-xs text-muted-foreground">{ig.pageName}</p>}
                </div>
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0",
                  ig.active
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-muted text-muted-foreground border-border",
                )}>
                  {ig.active ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[10px] font-mono bg-background border border-border px-2 py-1.5 rounded truncate text-muted-foreground">
                  {`${window.location.origin}${BASE}/api/meta/webhook/${ig.webhookToken}`}
                </code>
                <button
                  type="button"
                  onClick={() => copy(`${window.location.origin}${BASE}/api/meta/webhook/${ig.webhookToken}`, `url-${ig.id}`)}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  {copiedField === `url-${ig.id}` ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
          {!showNew && (
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="text-xs text-primary hover:underline"
            >
              + Connect another form
            </button>
          )}
        </div>
      )}

      {/* Just-created success banner */}
      {justCreated && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-400 font-medium">Integration created — configure your Meta webhook:</p>
          </div>
          {[
            { label: "Webhook URL",   value: justCreated.webhookUrl,   field: "url"   },
            { label: "Verify Token",  value: justCreated.verifyToken,  field: "token" },
          ].map(({ label, value, field }) => (
            <div key={field} className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase">{label}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[10px] font-mono bg-background border border-emerald-500/20 px-2 py-1.5 rounded truncate">
                  {value}
                </code>
                <button type="button" onClick={() => copy(value, field)} className="text-muted-foreground hover:text-foreground shrink-0">
                  {copiedField === field ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New integration form */}
      {showNew && (
        <div className="space-y-4 border border-border rounded-xl p-4 bg-muted/10">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">New Integration</p>
            {integrations.length > 0 && (
              <button type="button" onClick={() => setShowNew(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Form ID <span className="text-destructive">*</span></Label>
            <Input
              value={formId}
              onChange={e => setFormId(e.target.value)}
              placeholder="e.g. 1234567890123456"
              className="h-9 text-sm font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              Found in Meta Business Manager → Lead Ads → Forms Library
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Page Access Token <span className="text-destructive">*</span></Label>
            <div className="flex gap-2">
              <Input
                type={showToken ? "text" : "password"}
                value={accessToken}
                onChange={e => setAccessToken(e.target.value)}
                placeholder="Long-lived page access token"
                className="h-9 text-sm font-mono flex-1"
              />
              <button
                type="button"
                onClick={() => setShowToken(v => !v)}
                className="text-xs text-muted-foreground hover:text-foreground px-2.5 border border-border rounded-md shrink-0"
              >
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Stored encrypted. Generate from Meta Developers → Graph API Explorer → Page token.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Page Name <span className="text-muted-foreground/60">(optional)</span></Label>
              <Input value={pageName} onChange={e => setPageName(e.target.value)} placeholder="My Business Page" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Form Name <span className="text-muted-foreground/60">(optional)</span></Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Q3 Lead Gen Form" className="h-9 text-sm" />
            </div>
          </div>

          <Button
            size="sm"
            onClick={() => void handleCreate()}
            disabled={creating || !formId.trim() || !accessToken.trim()}
            className="gap-1.5"
          >
            {creating
              ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Creating…</>
              : <><Building2 className="w-3.5 h-3.5" />Connect Meta Form</>}
          </Button>
        </div>
      )}

      {/* Setup guide */}
      <div className="bg-muted/20 border border-border rounded-xl p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2.5">Setup in Meta Business Manager</p>
        <ol className="text-xs text-muted-foreground space-y-1.5 leading-relaxed">
          <li>1. Go to <strong>Meta Business Suite → Integrations → Leads Centre</strong></li>
          <li>2. Select your Facebook Page → <strong>Connect new CRM</strong></li>
          <li>3. Paste the <strong>Webhook URL</strong> and <strong>Verify Token</strong> shown above</li>
          <li>4. Subscribe to the <code className="bg-muted px-1 rounded text-[10px]">leadgen</code> field event</li>
          <li>5. Submit a test lead — an outbound call fires automatically within seconds</li>
        </ol>
      </div>
    </div>
  );
}

// ── CRM passthrough banner ─────────────────────────────────────────────────────

function CrmPassthroughBanner({ title }: { title: string }) {
  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-sm text-emerald-300">
          Leads already imported via CRM — no additional source config needed. Click <strong>Next</strong> to continue.
        </p>
      </div>
    </div>
  );
}

// ── Step 3: Source Configuration ──────────────────────────────────────────────

function Step3({
  state, setState, campaignId, campaignLeadSource, onCrmImported,
}: {
  state: WizardState;
  setState: (p: Partial<WizardState>) => void;
  campaignId: number;
  campaignLeadSource?: string | null;
  onCrmImported?: (batchId: number, summary: CrmImportSummary) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [importConn, setImportConn] = useState<CrmConnection | null>(null);
  const { data: campaign } = useGetCampaign(campaignId, {
    query: { queryKey: getGetCampaignQueryKey(campaignId) },
  });
  const { data: crmConnections = [] } = useListCrmConnections({
    query: { queryKey: getListCrmConnectionsQueryKey() },
  });

  if (state.sourceMode === "crm") {
    return <CrmPassthroughBanner title="Source Configuration" />;
  }

  const effectiveType: SourceType =
    state.sourceMode === "existing"
      ? (state.selectedSource?.sourceType as SourceType) ?? "csv"
      : state.newSourceType;

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCsv(text);
      if (headers.length === 0) {
        toast({ title: "Invalid CSV", description: "No headers found", variant: "destructive" });
        return;
      }
      setState({ csvFile: file, csvHeaders: headers, csvRows: rows, csvFileName: file.name, fieldMapping: {} });
    };
    reader.readAsText(file);
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // CRM tiles ─────────────────────────────────────────────────────────────────
  const CRM_TILES_DEF = [
    { id: "hubspot" as const, name: "HubSpot",    icon: <span className="text-orange-400 font-bold text-sm">HS</span> },
    { id: "zoho"    as const, name: "Zoho CRM",   icon: <span className="text-blue-400 font-bold text-sm">ZO</span> },
    { id: "sf"      as const, name: "Salesforce", icon: <Globe className="w-4 h-4 text-muted-foreground" />, disabled: true },
  ] as const;

  const crmSection = (
    <div className="space-y-2 pt-2 border-t border-border">
      <p className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wider pt-2">Or import from CRM</p>
      <div className="grid grid-cols-3 gap-3">
        {CRM_TILES_DEF.map(crm => {
          const conn = "disabled" in crm && crm.disabled ? undefined : crmConnections.find(c => c.provider === crm.id);
          const isConnected = !!conn;
          const isDisabled  = "disabled" in crm && crm.disabled;
          const handleClick = () => {
            if (isDisabled) return;
            if (isConnected && conn) {
              setImportConn(conn);
            } else {
              window.location.href = `${BASE}/app/connections#crm-connect=${crm.id}`;
            }
          };
          return (
            <button
              key={crm.id}
              type="button"
              disabled={isDisabled}
              onClick={handleClick}
              className={cn(
                "p-4 rounded-xl border text-left transition-all space-y-2",
                isDisabled
                  ? "border-border opacity-40 pointer-events-none"
                  : isConnected
                    ? "border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-500/60 hover:bg-emerald-500/10"
                    : "border-border hover:border-primary/50 hover:bg-muted/30",
              )}
            >
              <div className="flex items-center justify-between">
                {crm.icon}
                {isConnected
                  ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      <span className="w-1 h-1 rounded-full bg-emerald-500" />Connected
                    </span>
                  : !isDisabled && <ExternalLink className="w-3 h-3 text-muted-foreground" />
                }
              </div>
              <div>
                <p className="text-sm font-medium">{crm.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {isDisabled ? "Coming Soon" : isConnected ? "Import contacts →" : "Connect & import →"}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {crmConnections.length > 0
          ? "Click a connected CRM to import contacts directly. You'll skip to Execution Rules after import."
          : "Connect HubSpot or Zoho CRM first, then return here to import contacts."}
      </p>
    </div>
  );

  // CRM campaign: show only CRM import UI (no existing-sources list, no CSV/webhook/meta tiles)
  if (campaignLeadSource === "crm") {
    return (
      <div className="space-y-5 max-w-2xl">
        <div>
          <h2 className="text-lg font-semibold">Import from CRM</h2>
          <p className="text-sm text-muted-foreground mt-1">
            This campaign is configured to pull leads from your CRM. Select a connected CRM below to import contacts.
          </p>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-3">
            {CRM_TILES_DEF.map(crm => {
              const conn = "disabled" in crm && crm.disabled ? undefined : crmConnections.find(c => c.provider === crm.id);
              const isConnected = !!conn;
              const isDisabled  = "disabled" in crm && crm.disabled;
              const handleClick = () => {
                if (isDisabled) return;
                if (isConnected && conn) {
                  setImportConn(conn);
                } else {
                  window.location.href = `${BASE}/app/connections#crm-connect=${crm.id}`;
                }
              };
              return (
                <button
                  key={crm.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={handleClick}
                  className={cn(
                    "p-4 rounded-xl border text-left transition-all space-y-2",
                    isDisabled
                      ? "border-border opacity-40 pointer-events-none"
                      : isConnected
                        ? "border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-500/60 hover:bg-emerald-500/10"
                        : "border-border hover:border-primary/50 hover:bg-muted/30",
                  )}
                >
                  <div className="flex items-center justify-between">
                    {crm.icon}
                    {isConnected
                      ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          <span className="w-1 h-1 rounded-full bg-emerald-500" />Connected
                        </span>
                      : !isDisabled && <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    }
                  </div>
                  <div>
                    <p className="text-sm font-medium">{crm.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {isDisabled ? "Coming Soon" : isConnected ? "Import contacts →" : "Connect & import →"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {crmConnections.length > 0
              ? "Click a connected CRM to import contacts directly into this campaign."
              : "Click HubSpot or Zoho CRM to connect your account first, then return here to import."}
          </p>
        </div>
        {importConn && (
          <CrmImportDialog
            connection={importConn}
            open={!!importConn}
            onClose={() => setImportConn(null)}
            defaultCampaignId={campaignId}
            onImported={(batchId, leadsCreated, duplicatesFound, invalidPhones) => {
              setState({ sourceMode: "crm", crmBatchId: batchId });
              setImportConn(null);
              onCrmImported?.(batchId, { leadsCreated, duplicatesFound, invalidPhones });
            }}
          />
        )}
      </div>
    );
  }

  // CSV ────────────────────────────────────────────────────────────────────────
  if (effectiveType === "csv") {
    return (
      <div className="space-y-5 max-w-2xl">
        <div>
          <h2 className="text-lg font-semibold">Upload CSV</h2>
          <p className="text-sm text-muted-foreground mt-1">Upload your CSV file. First row must be headers.</p>
        </div>

        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          className={cn(
            "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
            state.csvFile
              ? "border-primary/50 bg-primary/5"
              : "border-border hover:border-primary/30 hover:bg-muted/20",
          )}
        >
          {state.csvFile ? (
            <div className="flex items-center justify-center gap-3">
              <FileText className="w-8 h-8 text-primary" />
              <div className="text-left">
                <p className="text-sm font-medium">{state.csvFileName}</p>
                <p className="text-xs text-muted-foreground">{state.csvRows.length.toLocaleString()} rows · {state.csvHeaders.length} columns</p>
              </div>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setState({ csvFile: null, csvHeaders: [], csvRows: [], csvFileName: "" }); }}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium">Drop CSV here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">Max 50,000 rows. UTF-8 encoding recommended.</p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>

        {state.csvHeaders.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Preview — first {Math.min(state.csvRows.length, 5)} of {state.csvRows.length.toLocaleString()} rows
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {state.csvHeaders.map(h => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.csvRows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                      {state.csvHeaders.map(h => (
                        <td key={h} className="px-3 py-2 font-mono text-muted-foreground/80 whitespace-nowrap max-w-[180px] truncate">
                          {row[h] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {crmSection}

        {importConn && (
          <CrmImportDialog
            connection={importConn}
            open={!!importConn}
            onClose={() => setImportConn(null)}
            defaultCampaignId={campaignId}
            onImported={(batchId, leadsCreated, duplicatesFound, invalidPhones) => {
              setState({ sourceMode: "crm", crmBatchId: batchId });
              setImportConn(null);
              onCrmImported?.(batchId, { leadsCreated, duplicatesFound, invalidPhones });
            }}
          />
        )}
      </div>
    );
  }

  // Webhook ────────────────────────────────────────────────────────────────────
  if (effectiveType === "webhook") {
    const webhookUrl = `${window.location.origin}${BASE}/api/webhooks/lead/${campaign?.webhookToken ?? ""}`;
    return (
      <div className="space-y-5 max-w-xl">
        <div>
          <h2 className="text-lg font-semibold">Webhook Source</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Your campaign has a dedicated intake URL — shared across all batches. POST leads from any CRM, form, or external system.
          </p>
        </div>
        <div className="space-y-4">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-sm text-emerald-400">Campaign webhook is ready to receive leads</span>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Campaign Intake URL</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted/50 border border-border px-3 py-2 rounded-lg font-mono truncate">
                {webhookUrl}
              </code>
              <button
                type="button"
                onClick={() => copy(webhookUrl)}
                className="text-muted-foreground hover:text-foreground"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              This URL is shared across all batches. Leads arriving when no batch is running are queued and auto-assigned when you start one.
            </p>
          </div>
          <div className="bg-muted/30 border border-border rounded-lg p-4">
            <p className="text-xs font-semibold mb-2">Sample Payload</p>
            <pre className="text-[11px] font-mono text-muted-foreground overflow-x-auto">{`{
  "phone": "+919876543210",
  "name": "Priya Sharma",
  "email": "priya@example.com"
}`}</pre>
          </div>
        </div>

        {crmSection}

        {importConn && (
          <CrmImportDialog
            connection={importConn}
            open={!!importConn}
            onClose={() => setImportConn(null)}
            defaultCampaignId={campaignId}
            onImported={(batchId, leadsCreated, duplicatesFound, invalidPhones) => {
              setState({ sourceMode: "crm", crmBatchId: batchId });
              setImportConn(null);
              onCrmImported?.(batchId, { leadsCreated, duplicatesFound, invalidPhones });
            }}
          />
        )}
      </div>
    );
  }

  // Meta form ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-xl">
      <MetaFormStep toast={toast} />
      {crmSection}
      {importConn && (
        <CrmImportDialog
          connection={importConn}
          open={!!importConn}
          onClose={() => setImportConn(null)}
          defaultCampaignId={campaignId}
          onImported={(batchId, leadsCreated, duplicatesFound, invalidPhones) => {
            setState({ sourceMode: "crm", crmBatchId: batchId });
            setImportConn(null);
            onCrmImported?.(batchId, { leadsCreated, duplicatesFound, invalidPhones });
          }}
        />
      )}
    </div>
  );
}

// ── Step 4: Variable Mapping ───────────────────────────────────────────────────

function Step4({
  state, setState, campaignId,
}: {
  state: WizardState;
  setState: (p: Partial<WizardState>) => void;
  campaignId: number;
}) {
  const { data: campaign } = useGetCampaign(campaignId, {
    query: { queryKey: getGetCampaignQueryKey(campaignId) },
  });
  const agentId = campaign?.agentId ?? 0;
  const { data: variables = [] } = useListAgentVariables(agentId, {
    query: { queryKey: getListAgentVariablesQueryKey(agentId), enabled: agentId > 0 },
  });

  if (state.sourceMode === "crm") {
    return <CrmPassthroughBanner title="Variable Mapping" />;
  }

  const effectiveType: SourceType =
    state.sourceMode === "existing"
      ? (state.selectedSource?.sourceType as SourceType) ?? "csv"
      : state.newSourceType;

  useEffect(() => {
    if (state.csvHeaders.length > 0 && Object.keys(state.fieldMapping).length === 0) {
      setState({ fieldMapping: autoMap(state.csvHeaders, variables as AgentVariable[]) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.csvHeaders.join(","), (variables as AgentVariable[]).length]);

  if (effectiveType !== "csv" || state.csvHeaders.length === 0) {
    return (
      <div className="space-y-4 max-w-xl">
        <div>
          <h2 className="text-lg font-semibold">Variable Mapping</h2>
          <p className="text-sm text-muted-foreground mt-1">Map lead data to agent variables.</p>
        </div>
        <div className="bg-muted/30 border border-border rounded-xl p-8 text-center">
          <Info className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {effectiveType !== "csv"
              ? "Variable mapping runs per-lead as they arrive via your source."
              : "Upload a CSV in Step 2 first."}
          </p>
        </div>
      </div>
    );
  }

  const standardFields = [
    { key: "phone", label: "phone",  icon: <Phone className="w-3.5 h-3.5 text-blue-400" />,   required: true  },
    { key: "name",  label: "name",   icon: <User className="w-3.5 h-3.5 text-green-400" />,   required: false },
    { key: "email", label: "email",  icon: <Mail className="w-3.5 h-3.5 text-violet-400" />,  required: false },
  ];

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Variable Mapping</h2>
          <p className="text-sm text-muted-foreground mt-1">Map CSV headers to standard fields and agent variables.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => setState({ fieldMapping: autoMap(state.csvHeaders, variables as AgentVariable[]) })}
        >
          <RefreshCw className="w-3 h-3 mr-1.5" />Auto-Map
        </Button>
      </div>

      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Variable</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Required</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">CSV Column</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {standardFields.map(f => (
              <MappingRow
                key={f.key}
                varKey={f.key}
                label={<span className="flex items-center gap-1.5">{f.icon}<span className="font-mono text-xs">{f.label}</span></span>}
                type="standard"
                required={f.required}
                headers={state.csvHeaders}
                value={state.fieldMapping[f.key] ?? ""}
                onChange={v => setState({ fieldMapping: { ...state.fieldMapping, [f.key]: v } })}
              />
            ))}
            {(variables as AgentVariable[]).map(v => (
              <MappingRow
                key={v.id}
                varKey={v.variableName}
                label={<code className="text-[11px] font-mono text-primary">{v.variableName}</code>}
                type={v.dataType}
                required={v.isRequired}
                headers={state.csvHeaders}
                value={state.fieldMapping[v.variableName] ?? ""}
                onChange={val => setState({ fieldMapping: { ...state.fieldMapping, [v.variableName]: val } })}
              />
            ))}
          </tbody>
        </table>
      </div>

      {!state.fieldMapping["phone"] && (
        <div className="flex items-center gap-2 text-destructive text-xs bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Phone column is required — please select a mapping above.</span>
        </div>
      )}
    </div>
  );
}

function MappingRow({
  varKey, label, type, required, headers, value, onChange,
}: {
  varKey: string;
  label: React.ReactNode;
  type: string;
  required: boolean;
  headers: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <tr className="hover:bg-muted/20">
      <td className="px-4 py-2.5 max-w-[180px]">{label}</td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground capitalize">{type}</td>
      <td className="px-4 py-2.5">
        {required
          ? <span className="text-[10px] text-destructive font-medium">Required</span>
          : <span className="text-[10px] text-muted-foreground">Optional</span>}
      </td>
      <td className="px-4 py-2.5">
        <Select value={value || "__none__"} onValueChange={v => onChange(v === "__none__" ? "" : v)}>
          <SelectTrigger className="h-7 text-xs w-44">
            <SelectValue placeholder="— not mapped —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs text-muted-foreground">— not mapped —</SelectItem>
            {headers.map(h => (
              <SelectItem key={h} value={h} className="text-xs font-mono">{h}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-4 py-2.5">
        {value ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
            <Check className="w-3 h-3" />Mapped
          </span>
        ) : required ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
            <AlertCircle className="w-3 h-3" />Missing
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

// ── Step 5: Validation ────────────────────────────────────────────────────────

function Step5({
  state, setState, campaignId,
}: {
  state: WizardState;
  setState: (p: Partial<WizardState>) => void;
  campaignId: number;
}) {
  const { getToken } = useAuth();

  if (state.sourceMode === "crm") {
    const s = state.crmImportSummary;
    return (
      <div className="space-y-5 max-w-xl">
        <div>
          <h2 className="text-lg font-semibold">Validation</h2>
          <p className="text-sm text-muted-foreground mt-1">Results from your CRM import.</p>
        </div>
        {s ? (
          <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
            <div className="flex items-center gap-3 px-4 py-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-sm flex-1">Leads added</span>
              <span className="text-sm font-semibold text-emerald-400">{s.leadsCreated}</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-sm flex-1">Duplicates skipped</span>
              <span className="text-sm font-semibold text-amber-400">{s.duplicatesFound}</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <X className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm flex-1">Invalid phone numbers</span>
              <span className="text-sm font-semibold text-muted-foreground">{s.invalidPhones}</span>
            </div>
          </div>
        ) : (
          <div className="bg-muted/30 border border-border rounded-xl p-8 text-center">
            <Shield className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No import summary available.</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Click <strong>Next</strong> to set how duplicates should be handled in future imports.</p>
      </div>
    );
  }

  const effectiveType: SourceType =
    state.sourceMode === "existing"
      ? (state.selectedSource?.sourceType as SourceType) ?? "csv"
      : state.newSourceType;

  const validateMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/campaigns/${campaignId}/validate-leads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          leads:        state.csvRows,
          fieldMapping: { phone: state.fieldMapping["phone"] ?? "phone" },
          policy:       state.duplicatePolicy,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ValidationPreviewResult>;
    },
    onSuccess: result => setState({ validationResult: result }),
  });

  if (effectiveType !== "csv" || state.csvRows.length === 0) {
    return (
      <div className="space-y-4 max-w-xl">
        <div>
          <h2 className="text-lg font-semibold">Validation</h2>
          <p className="text-sm text-muted-foreground mt-1">Phone normalization and duplicate checking.</p>
        </div>
        <div className="bg-muted/30 border border-border rounded-xl p-8 text-center">
          <Shield className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {effectiveType !== "csv"
              ? "Validation runs automatically as leads arrive."
              : "Upload a CSV file first."}
          </p>
        </div>
      </div>
    );
  }

  const result = state.validationResult;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Validation Preview</h2>
          <p className="text-sm text-muted-foreground mt-1">Phone normalization + duplicate detection. No leads created yet.</p>
        </div>
        <Button
          onClick={() => validateMutation.mutate()}
          disabled={validateMutation.isPending}
          size="sm"
        >
          {validateMutation.isPending
            ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-2" />
            : <Shield className="w-3.5 h-3.5 mr-2" />}
          {result ? "Re-validate" : "Run Validation"}
        </Button>
      </div>

      {validateMutation.isError && (
        <div className="flex items-center gap-2 text-destructive text-xs bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          Check your field mapping in Step 3 (phone column must be mapped).
        </div>
      )}

      {result ? (
        <>
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total"       value={result.totalRows}    color="default" />
            <StatCard label="Valid"        value={result.validRows}    color="green" />
            <StatCard label="Invalid"      value={result.invalidRows}  color="red" />
            <StatCard label="Duplicates"   value={result.duplicateRows} color="amber" />
          </div>
          {result.previewRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                Row Preview (first {Math.min(result.previewRows.length, 100)})
              </p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/30 border-b border-border">
                      <th className="text-left px-3 py-2 text-muted-foreground">#</th>
                      <th className="text-left px-3 py-2 text-muted-foreground">Phone (raw)</th>
                      <th className="text-left px-3 py-2 text-muted-foreground">Normalized</th>
                      <th className="text-left px-3 py-2 text-muted-foreground">Status</th>
                      <th className="text-left px-3 py-2 text-muted-foreground">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.previewRows.slice(0, 100).map(row => {
                      const phoneCol = state.fieldMapping["phone"] ?? "phone";
                      return (
                        <tr
                          key={row.rowIndex}
                          className={cn(
                            "border-b border-border last:border-0",
                            row.status === "error"   && "bg-destructive/5",
                            row.status === "warning" && "bg-amber-500/5",
                          )}
                        >
                          <td className="px-3 py-2 font-mono text-muted-foreground">{row.rowIndex + 1}</td>
                          <td className="px-3 py-2 font-mono">{row.raw[phoneCol] ?? "—"}</td>
                          <td className="px-3 py-2 font-mono">{row.normalized ?? <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-3 py-2">
                            {row.status === "valid"   && <span className="text-[10px] text-emerald-400 font-medium">Valid</span>}
                            {row.status === "warning" && <span className="text-[10px] text-amber-400 font-medium">Warning</span>}
                            {row.status === "error"   && <span className="text-[10px] text-destructive font-medium">Error</span>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{row.errors.join("; ") || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        !validateMutation.isPending && (
          <div className="bg-muted/20 border border-border rounded-xl p-8 text-center">
            <Shield className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Click "Run Validation" to preview phone normalization and duplicate detection.</p>
          </div>
        )
      )}
    </div>
  );
}

// ── Step 6: Duplicate Handling ────────────────────────────────────────────────

function Step6({
  state, setState,
}: {
  state: WizardState;
  setState: (p: Partial<WizardState>) => void;
}) {
  // CRM: show policy choices just like CSV — the selection is stored and applies to future imports

  const policies: Array<{ value: DuplicatePolicy; label: string; desc: string }> = [
    { value: "ignore",             label: "Ignore",             desc: "Create the lead anyway but flag it as a duplicate. Agent still calls." },
    { value: "skip",               label: "Skip",               desc: "Silently discard duplicates. No error report entry." },
    { value: "reject_with_report", label: "Reject with Report", desc: "Discard and include in downloadable error report." },
  ];

  const result  = state.validationResult;
  const dupes   = result?.duplicateRows ?? 0;
  const total   = result ? result.totalRows - result.invalidRows : null;
  const created = total !== null ? (state.duplicatePolicy === "ignore" ? total : total - dupes) : null;

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold">Duplicate Handling</h2>
        <p className="text-sm text-muted-foreground mt-1">What happens when a phone number already exists in this campaign?</p>
      </div>

      <div className="space-y-2">
        {policies.map(p => (
          <button
            key={p.value}
            type="button"
            onClick={() => setState({ duplicatePolicy: p.value })}
            className={cn(
              "w-full text-left p-4 rounded-xl border transition-all",
              state.duplicatePolicy === p.value
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30",
            )}
          >
            <div className="flex items-start gap-3">
              <div className={cn(
                "w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5",
                state.duplicatePolicy === p.value ? "border-primary bg-primary" : "border-muted-foreground",
              )} />
              <div>
                <p className="text-sm font-medium">{p.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {result && (
        <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-1">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Projected Outcome</p>
          <DetailRow
            icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
            label="Leads Created"
            value={created !== null ? created.toLocaleString() : "—"}
          />
          <DetailRow
            icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
            label="Duplicates Found"
            value={dupes.toLocaleString()}
          />
          <DetailRow
            icon={<X className="w-3.5 h-3.5 text-muted-foreground" />}
            label="Leads Skipped"
            value={state.duplicatePolicy !== "ignore" ? dupes.toLocaleString() : "0"}
          />
        </div>
      )}
    </div>
  );
}

// ── Step 7: Execution Rules ────────────────────────────────────────────────────

function TimezoneCombobox({
  value, options, onChange,
}: {
  value: string;
  options: string[];
  onChange: (tz: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="w-full flex items-center justify-between rounded-md border border-input bg-background px-3 h-9 text-xs hover:border-border transition-colors"
        >
          <span className="truncate">{value || "Select timezone"}</span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search timezone…" className="text-xs" />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {options.map(tz => (
                <CommandItem
                  key={tz}
                  value={tz}
                  onSelect={() => { onChange(tz); setOpen(false); }}
                  className="text-xs"
                >
                  <Check className={cn("mr-2 h-3.5 w-3.5", value === tz ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{tz}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Step7({
  state, setState,
}: {
  state: WizardState;
  setState: (p: Partial<WizardState>) => void;
}) {
  const allTimezones = (() => {
    try {
      return Intl.supportedValuesOf("timeZone") as string[];
    } catch {
      return [state.timezone];
    }
  })();

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold">Execution Rules</h2>
        <p className="text-sm text-muted-foreground mt-1">Configure retry, business hours, and scheduling.</p>
      </div>

      <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Retry Settings</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Max Attempts</Label>
            <Input
              type="number" min={1} max={10}
              value={state.maxAttempts}
              onChange={e => setState({ maxAttempts: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Retry Delay (min)</Label>
            <Input
              type="number" min={1}
              value={state.retryDelayMinutes}
              onChange={e => setState({ retryDelayMinutes: Math.max(1, parseInt(e.target.value, 10) || 60) })}
              className="h-9 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Business Hours</p>
        <div className="space-y-1.5">
          <Label className="text-xs">Timezone</Label>
          <TimezoneCombobox
            value={state.timezone}
            options={allTimezones}
            onChange={tz => setState({ timezone: tz })}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Start Hour (24h)</Label>
            <Input
              type="number" min={0} max={23}
              value={state.businessHoursStart ?? ""}
              onChange={e => setState({ businessHoursStart: e.target.value ? parseInt(e.target.value, 10) : null })}
              placeholder="e.g. 9"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">End Hour (24h)</Label>
            <Input
              type="number" min={0} max={23}
              value={state.businessHoursEnd ?? ""}
              onChange={e => setState({ businessHoursEnd: e.target.value ? parseInt(e.target.value, 10) : null })}
              placeholder="e.g. 18"
              className="h-9 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Scheduling</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Start Date & Time</Label>
            <Input
              type="datetime-local"
              value={state.scheduledStartAt ?? ""}
              onChange={e => setState({ scheduledStartAt: e.target.value || null })}
              className="h-9 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">End Date & Time</Label>
            <Input
              type="datetime-local"
              value={state.scheduledEndAt ?? ""}
              onChange={e => setState({ scheduledEndAt: e.target.value || null })}
              className="h-9 text-xs"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="autostart"
            checked={state.autoStart}
            onCheckedChange={v => setState({ autoStart: v })}
          />
          <Label htmlFor="autostart" className="text-xs cursor-pointer">
            Auto-start immediately after import
          </Label>
        </div>
      </div>
    </div>
  );
}

// ── Step 8: Review & Launch ───────────────────────────────────────────────────

function Step8({
  state, campaignId, onLaunchSuccess,
}: {
  state: WizardState;
  campaignId: number;
  onLaunchSuccess: (batch: CampaignBatch) => void;
}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: campaign } = useGetCampaign(campaignId, {
    query: { queryKey: getGetCampaignQueryKey(campaignId) },
  });
  const createBatch = useCreateCampaignBatch();
  const updateBatch = useUpdateCampaignBatch();
  const startBatch  = useStartCampaignBatch();
  const isCrmLaunching = updateBatch.isPending || startBatch.isPending;

  // CRM branch: batch already created — apply execution settings then launch
  if (state.sourceMode === "crm" && state.crmBatchId != null) {
    async function handleCrmLaunch() {
      try {
        await updateBatch.mutateAsync({
          id: campaignId,
          batchId: state.crmBatchId!,
          data: {
            maxAttempts:       state.maxAttempts,
            retryDelayMinutes: state.retryDelayMinutes,
            timezone:          state.timezone || undefined,
          },
        });
        if (state.autoStart) {
          await startBatch.mutateAsync({ id: campaignId, batchId: state.crmBatchId! });
        }
        setLocation(`/app/campaigns/${campaignId}/batches/${state.crmBatchId}`);
      } catch {
        toast({ title: "Launch failed", description: "Check your settings and try again.", variant: "destructive" });
      }
    }

    return (
      <div className="space-y-5 max-w-2xl">
        <div>
          <h2 className="text-lg font-semibold">Review & Launch</h2>
          <p className="text-sm text-muted-foreground mt-1">Your CRM import is complete. Review settings and launch the batch.</p>
        </div>

        <div className="space-y-3">
          <SummarySection title="Campaign">
            <DetailRow label="Name"  value={campaign?.name ?? "—"} />
            <DetailRow icon={<User className="w-3.5 h-3.5" />}  label="Agent" value={campaign?.agentId ? `#${campaign.agentId}` : "—"} />
            <DetailRow icon={<Phone className="w-3.5 h-3.5" />} label="Phone" value={campaign?.fromNumber ?? "—"} />
          </SummarySection>

          <SummarySection title="Batch">
            <DetailRow label="Name" value={state.batchName} />
            {state.batchDescription && <DetailRow label="Description" value={state.batchDescription} />}
          </SummarySection>

          <SummarySection title="Lead Source">
            <DetailRow label="Type"   value="CRM Import" />
            <DetailRow
              icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
              label="Status"
              value="Leads imported from CRM"
            />
          </SummarySection>

          <SummarySection title="Execution">
            <DetailRow label="Max Attempts"    value={String(state.maxAttempts)} />
            <DetailRow label="Retry Delay"     value={`${state.retryDelayMinutes}m`} />
            {state.timezone && <DetailRow icon={<Globe className="w-3.5 h-3.5" />} label="Timezone" value={state.timezone} />}
            <DetailRow
              icon={<Play className="w-3.5 h-3.5 text-emerald-400" />}
              label="Auto-start"
              value={state.autoStart ? "Yes — starts immediately" : "No — stays in Draft"}
            />
          </SummarySection>
        </div>

        <div className="pt-2">
          <Button
            size="lg"
            onClick={() => void handleCrmLaunch()}
            disabled={isCrmLaunching}
            className="w-full gap-2"
          >
            {isCrmLaunching
              ? <><RefreshCw className="w-4 h-4 animate-spin" />Launching…</>
              : <><Play className="w-4 h-4" />Launch Batch</>}
          </Button>
        </div>
      </div>
    );
  }

  const effectiveType: SourceType =
    state.sourceMode === "existing"
      ? (state.selectedSource?.sourceType as SourceType) ?? "csv"
      : state.newSourceType;
  const activeSource = state.selectedSource ?? state.createdSource;
  const validRows = state.validationResult?.validRows ?? state.csvRows.length;
  const dupeRows  = state.validationResult?.duplicateRows ?? 0;

  async function handleLaunch() {
    try {
      const leadSourceValue: "csv" | "meta" | "webhook" =
        effectiveType === "meta_form" ? "meta" : effectiveType === "webhook" ? "webhook" : "csv";

      const batch = await createBatch.mutateAsync({
        id: campaignId,
        data: {
          name:              state.batchName,
          description:       state.batchDescription || undefined,
          leadSource:        leadSourceValue,
          leadSourceId:      activeSource?.id ?? undefined,
          leads:             state.csvRows.length > 0 ? state.csvRows : undefined,
          fileName:          state.csvFileName || undefined,
          batchFieldMapping: Object.keys(state.fieldMapping).length > 0 ? state.fieldMapping : undefined,
          duplicatePolicy:   state.duplicatePolicy,
          callDelaySeconds:  state.callDelaySeconds,
          maxAttempts:       state.maxAttempts,
          retryDelayMinutes: state.retryDelayMinutes,
          timezone:          state.timezone || undefined,
          businessHoursStart: state.businessHoursStart ?? undefined,
          businessHoursEnd:   state.businessHoursEnd ?? undefined,
          maxDailyCalls:      state.maxDailyCalls ?? undefined,
          scheduledStartAt:   state.scheduledStartAt ?? undefined,
          scheduledEndAt:     state.scheduledEndAt ?? undefined,
          autoStart:          state.autoStart,
        },
      });
      onLaunchSuccess(batch);
    } catch {
      toast({ title: "Launch failed", description: "Check your settings and try again.", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">Review & Launch</h2>
        <p className="text-sm text-muted-foreground mt-1">Review everything before importing leads and starting the batch.</p>
      </div>

      <div className="space-y-3">
        <SummarySection title="Campaign">
          <DetailRow label="Name"  value={campaign?.name ?? "—"} />
          <DetailRow icon={<User className="w-3.5 h-3.5" />}  label="Agent" value={campaign?.agentId ? `#${campaign.agentId}` : "—"} />
          <DetailRow icon={<Phone className="w-3.5 h-3.5" />} label="Phone" value={campaign?.fromNumber ?? "—"} />
        </SummarySection>

        <SummarySection title="Batch">
          <DetailRow label="Name" value={state.batchName} />
          {state.batchDescription && <DetailRow label="Description" value={state.batchDescription} />}
        </SummarySection>

        <SummarySection title="Lead Source">
          <DetailRow label="Type"   value={effectiveType.replace("_", " ")} />
          <DetailRow label="Source" value={activeSource?.sourceName ?? "CSV Upload (new)"} />
          {state.csvFileName && (
            <DetailRow icon={<FileText className="w-3.5 h-3.5" />} label="File" value={state.csvFileName} />
          )}
        </SummarySection>

        <SummarySection title="Lead Import">
          <DetailRow label="Total Rows"       value={state.csvRows.length.toLocaleString() || "—"} />
          <DetailRow icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />} label="Valid Records" value={validRows.toLocaleString()} />
          <DetailRow icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-400" />} label="Duplicates"    value={dupeRows.toLocaleString()} />
          <DetailRow label="Duplicate Policy" value={state.duplicatePolicy.replace(/_/g, " ")} />
        </SummarySection>

        <SummarySection title="Execution">
          <DetailRow label="Max Attempts"    value={String(state.maxAttempts)} />
          <DetailRow label="Retry Delay"     value={`${state.retryDelayMinutes}m`} />
          {state.timezone && <DetailRow icon={<Globe className="w-3.5 h-3.5" />} label="Timezone" value={state.timezone} />}
          {state.businessHoursStart != null && state.businessHoursEnd != null && (
            <DetailRow label="Business Hours" value={`${state.businessHoursStart}:00 – ${state.businessHoursEnd}:00`} />
          )}
          <DetailRow
            icon={<Play className="w-3.5 h-3.5 text-emerald-400" />}
            label="Auto-start"
            value={state.autoStart ? "Yes — starts immediately" : "No — stays in Draft"}
          />
        </SummarySection>

        {Object.values(state.fieldMapping).some(Boolean) && (
          <SummarySection title="Field Mapping">
            {Object.entries(state.fieldMapping)
              .filter(([, v]) => v)
              .map(([k, v]) => <DetailRow key={k} label={k} value={v} />)}
          </SummarySection>
        )}
      </div>

      <div className="pt-2">
        <Button
          size="lg"
          onClick={() => void handleLaunch()}
          disabled={createBatch.isPending}
          className="w-full gap-2"
        >
          {createBatch.isPending
            ? <><RefreshCw className="w-4 h-4 animate-spin" />Importing leads…</>
            : <><Play className="w-4 h-4" />Launch Batch</>}
        </Button>
        {createBatch.isPending && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            Normalizing phone numbers, deduplicating, queuing calls…
          </p>
        )}
      </div>
    </div>
  );
}

// ── Post-launch success ───────────────────────────────────────────────────────

function LaunchSuccess({
  batch, campaignId,
}: {
  batch: CampaignBatch;
  campaignId: number;
}) {
  const [, setLocation] = useLocation();
  const summary = batch.importSummary;

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-6 max-w-md mx-auto">
      <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
        <CheckCircle2 className="w-8 h-8 text-emerald-400" />
      </div>
      <div>
        <h2 className="text-xl font-semibold">Batch Created!</h2>
        <p className="text-sm text-muted-foreground mt-1">"{batch.name}" is ready.</p>
      </div>

      {summary && (
        <div className="w-full bg-muted/30 border border-border rounded-xl p-4 space-y-1 text-left">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Import Results</p>
          <DetailRow
            icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
            label="Leads Created"
            value={summary.leadsCreated.toLocaleString()}
          />
          <DetailRow label="Total Rows Processed" value={summary.totalRows.toLocaleString()} />
          {summary.duplicatesFound > 0 && (
            <DetailRow
              icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
              label="Duplicates Skipped"
              value={summary.duplicatesFound.toLocaleString()}
            />
          )}
          {summary.invalidPhones > 0 && (
            <DetailRow
              icon={<AlertCircle className="w-3.5 h-3.5 text-destructive" />}
              label="Invalid Phones"
              value={summary.invalidPhones.toLocaleString()}
            />
          )}
          {summary.dncBlocked > 0 && (
            <DetailRow
              icon={<Shield className="w-3.5 h-3.5 text-muted-foreground" />}
              label="DNC Blocked"
              value={summary.dncBlocked.toLocaleString()}
            />
          )}
          <DetailRow
            icon={batch.status === "running"
              ? <Play className="w-3.5 h-3.5 text-blue-400" />
              : <Clock className="w-3.5 h-3.5 text-muted-foreground" />}
            label="Status"
            value={batch.status === "running" ? "Running — calls queued" : "Draft — not started"}
          />
        </div>
      )}

      <div className="flex gap-3 w-full">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => setLocation(`/app/campaigns/${campaignId}`)}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />Back to Campaign
        </Button>
        <Button
          className="flex-1"
          onClick={() => setLocation(`/app/campaigns/${batch.campaignId}/batches/${batch.id}`)}
        >
          Open Batch<ExternalLink className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

// ── Step Sidebar ──────────────────────────────────────────────────────────────

function StepSidebar({
  currentStep,
  completedSteps,
  onStepClick,
}: {
  currentStep: number;
  completedSteps: Set<number>;
  onStepClick: (n: number) => void;
}) {
  return (
    <aside className="w-56 flex-shrink-0 border-r border-border bg-background/60 flex flex-col">
      <div className="px-4 py-5 border-b border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Batch Wizard</p>
        <div className="mt-3">
          <Progress value={(currentStep - 1) / 6 * 100} className="h-1" />
          <p className="text-[11px] text-muted-foreground mt-1.5">Step {currentStep} of 7</p>
          {/* Steps 3, 4 may be auto-skipped for non-CSV sources */}
        </div>
      </div>
      <nav className="flex-1 py-2 overflow-y-auto">
        {STEP_DEFS.map(step => {
          const isActive    = step.num === currentStep;
          const isCompleted = completedSteps.has(step.num) && !isActive;
          const isPast      = step.num < currentStep;
          return (
            <button
              key={step.num}
              type="button"
              disabled={!isPast && !isActive}
              onClick={() => { if (isPast) onStepClick(step.num); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                isActive    ? "bg-primary/8 border-r-2 border-primary" : "",
                isPast      ? "hover:bg-muted/40 cursor-pointer" : "",
                !isPast && !isActive ? "opacity-35 cursor-default" : "",
              )}
            >
              <div className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold transition-colors",
                isActive    ? "bg-primary text-primary-foreground" : "",
                isCompleted ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "",
                !isActive && !isCompleted ? "bg-muted border border-border text-muted-foreground" : "",
              )}>
                {isCompleted ? <Check className="w-3 h-3" /> : step.num}
              </div>
              <p className={cn(
                "text-xs font-medium",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}>
                {step.label}
              </p>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

// ── BatchWizardPage ───────────────────────────────────────────────────────────

export default function BatchWizardPage() {
  const [, params]      = useRoute("/app/campaigns/:id/batches/new");
  const [, setLocation] = useLocation();
  const campaignId      = parseInt(params?.id ?? "0", 10);

  const [currentStep, setCurrentStep]     = useState(1);
  const [state, setWizardState]           = useState<WizardState>({ ...INITIAL_STATE });
  const [completedSteps, setCompleted]    = useState<Set<number>>(new Set());
  const [launchedBatch, setLaunchedBatch] = useState<CampaignBatch | null>(null);
  const [campaignLeadSource, setCampaignLeadSource] = useState<string | null>(null);

  const setState = useCallback((patch: Partial<WizardState>) => {
    setWizardState(prev => ({ ...prev, ...patch }));
  }, []);

  // Auto-init newSourceType from campaign's locked leadSource
  const { data: campaignData } = useGetCampaign(campaignId, {
    query: { queryKey: getGetCampaignQueryKey(campaignId), enabled: campaignId > 0 },
  });
  useEffect(() => {
    if (!campaignData) return;
    const ls = (campaignData as any).leadSource as string | undefined;
    setCampaignLeadSource(ls ?? null);
    // For non-CRM lead sources, pre-select the source type in the wizard state
    if (ls && ls !== "crm" && ls !== state.newSourceType) {
      setState({ newSourceType: ls as SourceType, sourceMode: "new" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignData]);

  // Resolved source type from state (used for skip logic)
  function resolvedType(): SourceType {
    return state.sourceMode === "existing"
      ? (state.selectedSource?.sourceType as SourceType) ?? "webhook"
      : state.newSourceType;
  }

  function canAdvance(): boolean {
    switch (currentStep) {
      case 1: return state.batchName.trim().length > 0;
      case 2: {
        // Source Config: csv needs a file, others are always ready
        if (state.sourceMode === "crm") return true;
        const t = resolvedType();
        if (t === "csv") return state.csvRows.length > 0;
        return true;
      }
      case 3: {
        // Variable Mapping: csv needs phone mapped
        if (state.sourceMode === "crm") return true;
        const t = resolvedType();
        if (t !== "csv") return true;
        return !!state.fieldMapping["phone"];
      }
      case 4: return true;
      case 5: return true;
      case 6: return true;
      default: return true;
    }
  }

  function goNext() {
    if (!canAdvance()) return;

    // Step 2 (Source Config) → skip Variable Mapping + Validation for non-CSV (but not for CRM,
    // which walks through all steps so the user sees the import summary and chooses duplicate policy)
    if (currentStep === 2 && state.sourceMode !== "crm") {
      const t = resolvedType();
      if (t !== "csv") {
        setCompleted(prev => new Set([...prev, 2, 3, 4]));
        setCurrentStep(5);
        return;
      }
    }

    setCompleted(prev => new Set([...prev, currentStep]));
    setCurrentStep(s => Math.min(s + 1, 7));
  }

  function goBack() {
    // Step 5 (Duplicate Policy) → back to step 2 for non-CSV (steps 3-4 were skipped)
    // CRM is excluded — it walks through all steps so back goes 5→4→3→2 naturally
    if (currentStep === 5 && state.sourceMode !== "crm") {
      const t = resolvedType();
      if (t !== "csv") {
        setCurrentStep(2);
        return;
      }
    }

    setCurrentStep(s => Math.max(s - 1, 1));
  }

  if (!campaignId) {
    return <div className="p-8 text-sm text-muted-foreground">Invalid campaign ID.</div>;
  }

  if (launchedBatch) {
    return (
      <div className="flex-1 overflow-auto p-8">
        <LaunchSuccess batch={launchedBatch} campaignId={campaignId} />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <StepSidebar
        currentStep={currentStep}
        completedSteps={completedSteps}
        onStepClick={setCurrentStep}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 px-8 py-4 border-b border-border flex items-center gap-3 bg-background/80">
          <button
            type="button"
            onClick={() => setLocation(`/app/campaigns/${campaignId}`)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <p className="text-sm font-semibold">New Batch</p>
            <p className="text-xs text-muted-foreground">Campaign #{campaignId}</p>
          </div>
          {state.batchName && (
            <span className="ml-2 text-xs text-primary font-medium">— {state.batchName}</span>
          )}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {currentStep === 1 && <Step1 state={state} setState={setState} campaignId={campaignId} />}
          {currentStep === 2 && (
            <Step3
              state={state}
              setState={setState}
              campaignId={campaignId}
              campaignLeadSource={campaignLeadSource}
              onCrmImported={(_batchId, summary) => {
                setState({ crmImportSummary: summary });
                setCompleted(prev => new Set([...prev, 2]));
                setCurrentStep(3);
              }}
            />
          )}
          {currentStep === 3 && <Step4 state={state} setState={setState} campaignId={campaignId} />}
          {currentStep === 4 && <Step5 state={state} setState={setState} campaignId={campaignId} />}
          {currentStep === 5 && <Step6 state={state} setState={setState} />}
          {currentStep === 6 && <Step7 state={state} setState={setState} />}
          {currentStep === 7 && (
            <Step8 state={state} campaignId={campaignId} onLaunchSuccess={setLaunchedBatch} />
          )}
        </div>

        {/* Bottom nav (hidden on Step 7 which has its own launch button) */}
        {currentStep < 7 && (
          <div className="flex-shrink-0 px-8 py-4 border-t border-border flex items-center justify-between bg-background/60">
            <Button variant="ghost" size="sm" onClick={goBack} disabled={currentStep === 1}>
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />Back
            </Button>

            {/* Dot indicators */}
            <div className="flex items-center gap-1.5">
              {STEP_DEFS.map(s => (
                <div
                  key={s.num}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    s.num === currentStep
                      ? "w-4 bg-primary"
                      : completedSteps.has(s.num)
                        ? "w-1.5 bg-primary/40"
                        : "w-1.5 bg-muted",
                  )}
                />
              ))}
            </div>

            <Button size="sm" onClick={goNext} disabled={!canAdvance()}>
              Next<ChevronRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
