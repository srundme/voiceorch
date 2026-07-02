import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListConnections,
  useUpdateConnectionWebhookConfig,
  useStartConnectionListen,
  usePollConnectionListen,
  useStopConnectionListen,
  getListConnectionsQueryKey,
  useListCrmConnections,
  useDeleteCrmConnection,
  useListCrmContacts,
  useListCrmLists,
  useImportCrmContacts,
  useUpdateCrmConnection,
  getListCrmConnectionsQueryKey,
  useListCampaignLeads,
  useStartCampaignBatch,
  customFetch,
} from "@workspace/api-client-react";
import type { Connection, CrmConnection, CrmContact } from "@workspace/api-client-react";
import { useListCampaigns } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Copy, CheckCircle2, Globe, Webhook, AlertCircle, Clock,
  Zap, Sheet, Radio, X, ChevronDown, ChevronRight,
  ArrowRight, ExternalLink, Lock, RefreshCw, Eye, EyeOff,
  Phone, User, Mail, Loader2, Check, Link2, Link2Off, Building2, Code2, Search,
  Activity, KeyRound, ChevronLeft, ArrowUp, ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

type ConnectionStatus = "connected" | "waiting" | "error";

type ListenStatus = "idle" | "listening" | "captured" | "expired";

interface CapturedPayload {
  payload: Record<string, unknown>;
  flatFields: Record<string, string>;
  capturedAt: string;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, pulse = false }: { status: ConnectionStatus; pulse?: boolean }) {
  const cfg = {
    connected: { color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-500", label: "Connected" },
    waiting:   { color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",         dot: "bg-zinc-400",    label: "Waiting" },
    error:     { color: "bg-red-500/15 text-red-400 border-red-500/20",            dot: "bg-red-500",     label: "Error" },
  }[status];
  const showPulse = pulse && status === "connected";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.color}`}>
      <span className="relative flex items-center justify-center w-1.5 h-1.5">
        {showPulse && (
          <span className={`absolute inline-flex w-full h-full rounded-full ${cfg.dot} opacity-75 animate-ping`} />
        )}
        <span className={`relative w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      </span>
      {cfg.label}
    </span>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      title={`Copy ${label ?? ""}`}
    >
      {copied ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {label && <span>{copied ? "Copied!" : label}</span>}
    </button>
  );
}

// ── Field mapping editor ──────────────────────────────────────────────────────

function FieldMappingEditor({
  flatFields,
  mapping,
  systemPrompt,
  onChange,
}: {
  flatFields: Record<string, string>;
  mapping: Record<string, string>;
  systemPrompt: string | null;
  onChange: (m: Record<string, string>) => void;
}) {
  const keys = Object.keys(flatFields);
  const coreRoles = ["phone", "name", "email"];
  const customRoles = Object.keys(mapping).filter(k => !coreRoles.includes(k) && mapping[k]);

  // Extract {{variables}} from system prompt
  const promptVars = systemPrompt
    ? [...new Set([...systemPrompt.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]!))]
    : [];

  const allTargets = [...new Set([...coreRoles, ...promptVars, ...customRoles])];

  // Live preview: replace {{var}} in system prompt with mapped sample values
  const previewPrompt = systemPrompt
    ? systemPrompt.replace(/\{\{(\w+)\}\}/g, (_m, varName: string) => {
        const srcField = mapping[varName] ?? mapping[`{{${varName}}}`];
        if (srcField && flatFields[srcField] !== undefined) {
          return `[${flatFields[srcField] || varName}]`;
        }
        return `[${varName}]`;
      })
    : null;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Field Mapping</p>
        <p className="text-xs text-muted-foreground">
          Click a source field to map it to an agent variable.
        </p>
        <div className="grid gap-2">
          {allTargets.map(target => {
            const isCore = coreRoles.includes(target);
            const currentSrc = mapping[target] ?? "";
            const icons: Record<string, React.ReactNode> = {
              phone: <Phone className="w-3 h-3 text-blue-400" />,
              name:  <User className="w-3 h-3 text-violet-400" />,
              email: <Mail className="w-3 h-3 text-amber-400" />,
            };
            return (
              <div key={target} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 w-32 shrink-0">
                  {icons[target] ?? <Zap className="w-3 h-3 text-muted-foreground" />}
                  <span className="text-xs font-mono text-foreground truncate">
                    {isCore ? target : `{{${target}}}`}
                  </span>
                  {isCore && <span className="text-[9px] text-red-400">*</span>}
                </div>
                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                <select
                  value={currentSrc}
                  onChange={e => onChange({ ...mapping, [target]: e.target.value })}
                  className="flex-1 h-7 text-xs rounded-md border border-border bg-muted px-2 text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="">— not mapped —</option>
                  {keys.map(k => (
                    <option key={k} value={k}>{k} {flatFields[k] ? `(${flatFields[k].slice(0, 20)})` : ""}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {previewPrompt && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Script Preview</p>
          <div className="bg-muted/60 rounded-lg p-3 text-xs text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto border border-border">
            {previewPrompt}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Values in [brackets] come from the captured sample.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Listen dialog ─────────────────────────────────────────────────────────────

function ListenDialog({
  connection,
  open,
  onClose,
  onMappingSaved,
}: {
  connection: Connection;
  open: boolean;
  onClose: () => void;
  onMappingSaved: () => void;
}) {
  const { toast } = useToast();
  const [listenStatus, setListenStatus] = useState<ListenStatus>("idle");
  const [captured, setCaptured] = useState<CapturedPayload | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>(
    (connection.fieldMappings as Record<string, string> | null) ?? { phone: "phone" },
  );
  const [saving, setSaving] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const qc = useQueryClient();

  const startListen = useStartConnectionListen();
  const stopListen  = useStopConnectionListen();
  const updateConfig = useUpdateConnectionWebhookConfig();

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const beginListen = async () => {
    setListenStatus("listening");
    setCaptured(null);
    try {
      await startListen.mutateAsync({ campaignId: connection.id });
    } catch {
      setListenStatus("idle");
      toast({ title: "Failed to start listener", variant: "destructive" });
      return;
    }

    // Poll every 2 seconds
    pollRef.current = setInterval(async () => {
      try {
        const result = await customFetch<{
          status: string;
          campaignId: number;
          capturedAt?: string;
          payload?: Record<string, unknown>;
          flatFields?: Record<string, string>;
        }>(`${BASE}/api/connections/${connection.id}/listen/poll`);

        if (result.status === "captured" && result.payload) {
          stopPolling();
          setCaptured({
            payload:    result.payload,
            flatFields: result.flatFields ?? {},
            capturedAt: result.capturedAt ?? new Date().toISOString(),
          });
          setListenStatus("captured");
        } else if (result.status === "expired") {
          stopPolling();
          setListenStatus("expired");
        }
      } catch {
        // ignore transient poll errors
      }
    }, 2000);
  };

  const cancelListen = async () => {
    stopPolling();
    try { await stopListen.mutateAsync({ campaignId: connection.id }); } catch {}
    setListenStatus("idle");
    setCaptured(null);
  };

  const saveMapping = async () => {
    setSaving(true);
    try {
      await updateConfig.mutateAsync({
        campaignId: connection.id,
        data: { fieldMappings: mapping },
      });
      await qc.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      toast({ title: "Field mapping saved" });
      onMappingSaved();
      onClose();
    } catch {
      toast({ title: "Failed to save mapping", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Cleanup on unmount / close
  useEffect(() => {
    if (!open) {
      stopPolling();
      if (listenStatus === "listening") {
        stopListen.mutateAsync({ campaignId: connection.id }).catch(() => {});
      }
      setListenStatus("idle");
      setCaptured(null);
    }
  }, [open]);

  useEffect(() => () => stopPolling(), []);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="bg-card border-border max-w-lg flex flex-col max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-sm">Listen for Test Event</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Send a real payload from your source to capture a sample and map fields.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 pr-1 space-y-4">
          {/* Webhook URL */}
          <div className="bg-muted/40 border border-border rounded-lg p-3 space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-widest">Your Webhook URL</p>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-foreground flex-1 truncate">{connection.webhookUrl}</code>
              <CopyButton text={connection.webhookUrl} />
            </div>
          </div>

          {/* Listen states */}
          {listenStatus === "idle" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Radio className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Click "Start Listening" then send a test POST to your webhook URL.
              </p>
              <Button size="sm" onClick={beginListen} className="h-8 text-xs">
                <Radio className="w-3 h-3 mr-1.5" />
                Start Listening
              </Button>
            </div>
          )}

          {listenStatus === "listening" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
                <Radio className="w-5 h-5 text-primary" />
              </div>
              <p className="text-sm text-foreground font-medium">Listening for incoming event…</p>
              <p className="text-xs text-muted-foreground text-center">
                Send a POST to the webhook URL above. Expires in 2 minutes.
              </p>
              <Button size="sm" variant="ghost" onClick={cancelListen} className="h-7 text-xs text-muted-foreground">
                <X className="w-3 h-3 mr-1" />
                Cancel
              </Button>
            </div>
          )}

          {listenStatus === "expired" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-400" />
              </div>
              <p className="text-sm text-muted-foreground">Session expired. No event was received.</p>
              <Button size="sm" onClick={beginListen} className="h-8 text-xs">Try Again</Button>
            </div>
          )}

          {listenStatus === "captured" && captured && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm font-medium">Event captured!</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {format(new Date(captured.capturedAt), "HH:mm:ss")}
                </span>
              </div>

              {/* Raw payload (collapsible) */}
              <details className="group">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1">
                  <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                  View raw payload
                </summary>
                <pre className="mt-2 bg-muted rounded-lg p-3 text-[10px] font-mono text-muted-foreground overflow-x-auto max-h-32">
                  {JSON.stringify(captured.payload, null, 2)}
                </pre>
              </details>

              <FieldMappingEditor
                flatFields={captured.flatFields}
                mapping={mapping}
                systemPrompt={connection.agentSystemPrompt ?? null}
                onChange={setMapping}
              />
            </div>
          )}
        </div>

        {listenStatus === "captured" && (
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">Close</Button>
            <Button size="sm" disabled={saving} onClick={saveMapping}>
              {saving ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Check className="w-3 h-3 mr-1.5" />}
              Save mapping
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── HMAC Config dialog ────────────────────────────────────────────────────────

function HmacConfigDialog({
  connection,
  open,
  onClose,
}: {
  connection: Connection;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const updateConfig = useUpdateConnectionWebhookConfig();

  const generateSecret = () => {
    const arr = new Uint8Array(24);
    window.crypto.getRandomValues(arr);
    setSecret([...arr].map(b => b.toString(16).padStart(2, "0")).join(""));
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateConfig.mutateAsync({
        campaignId: connection.id,
        data: { hmacSecret: secret.trim() || null },
      });
      await qc.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      toast({ title: secret.trim() ? "HMAC secret saved" : "HMAC secret removed" });
      onClose();
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (open) setSecret("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Webhook Signature (HMAC)</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            When set, inbound requests must include a valid{" "}
            <code className="font-mono">X-Hub-Signature-256</code> header. Existing token-only sources keep working.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {connection.hasHmacSecret && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              Signature verification is active. Current hint: <code className="font-mono">{connection.hmacSecretHint}</code>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Secret (leave blank to remove)</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={secret}
                  onChange={e => setSecret(e.target.value)}
                  placeholder={connection.hasHmacSecret ? "Enter new secret to replace…" : "Enter HMAC secret…"}
                  className="h-8 text-sm font-mono bg-muted border-border pr-8"
                />
                <button
                  onClick={() => setShowSecret(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <Button size="sm" variant="outline" onClick={generateSecret} className="h-8 text-xs">
                Generate
              </Button>
            </div>
          </div>

          <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium">Verification</p>
            <p>We check the header: <code className="font-mono">X-Hub-Signature-256: sha256=&lt;hmac&gt;</code></p>
            <p>HMAC is computed over the raw request body using your secret.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">Cancel</Button>
          <Button size="sm" disabled={saving} onClick={save}>
            {saving ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : null}
            {secret.trim() === "" && connection.hasHmacSecret ? "Remove Secret" : "Save Secret"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Embed Snippet Panel ───────────────────────────────────────────────────────

function EmbedSnippetPanel({ connection }: { connection: Connection }) {
  // Derive the base origin from the webhook URL (strip the /api/webhooks/... path)
  const webhookOrigin = (() => {
    try {
      return new URL(connection.webhookUrl).origin;
    } catch {
      return window.location.origin;
    }
  })();

  const scriptSrc = `${webhookOrigin}/api/widget/lead-capture.js`;
  const token = connection.webhookToken ?? "";

  // Build a submit({}) example using source field names from fieldMappings
  const fm = (connection.fieldMappings ?? {}) as Record<string, string>;
  const submitFields: Record<string, string> = {};
  // Core roles first (phone, name, email), then any extra keys
  const roles = ["phone", "name", "email", ...Object.keys(fm).filter(k => !["phone","name","email"].includes(k))];
  for (const role of roles) {
    const srcField = fm[role];
    if (srcField) submitFields[srcField] = role === "phone" ? "+919876543210" : role === "name" ? "Priya Sharma" : role === "email" ? "priya@example.com" : "";
  }
  // If no mappings at all, fall back to sensible defaults
  if (Object.keys(submitFields).length === 0) {
    submitFields["phone"] = "+919876543210";
    submitFields["name"]  = "Priya Sharma";
  }

  const submitArg = JSON.stringify(submitFields, null, 2)
    .replace(/^/gm, "  ")
    .trimStart();

  const scriptTag   = `<script src="${scriptSrc}"\n        data-token="${token}">\n</script>`;
  const submitCall  = `SnapServe.submit(${submitArg})\n  .then(() => console.log("Lead sent!"))\n  .catch(err => console.error(err.message));`;
  const curlCommand = `curl -X POST "${webhookOrigin}/api/webhooks/lead/${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(Object.fromEntries(Object.entries(submitFields)))}'`;

  const Block = ({ label, code }: { label: string; code: string }) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</p>
        <CopyButton text={code} label="Copy" />
      </div>
      <pre className="bg-muted rounded-lg px-3 py-2.5 text-[11px] font-mono text-muted-foreground overflow-x-auto border border-border whitespace-pre">
        {code}
      </pre>
    </div>
  );

  return (
    <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Embed Snippet</p>
      <p className="text-xs text-muted-foreground">
        Drop the script tag on any page. Call <code className="font-mono text-foreground">SnapServe.submit(fields)</code> on form submit — no server required.
      </p>
      <Block label="1. Script tag" code={scriptTag} />
      <Block label="2. On form submit" code={submitCall} />
      <Block label="3. Test with curl" code={curlCommand} />
    </div>
  );
}

// ── Connection Card ───────────────────────────────────────────────────────────

function ConnectionCard({
  connection,
  onRefresh,
  hasNewEvent = false,
}: {
  connection: Connection;
  onRefresh: () => void;
  hasNewEvent?: boolean;
}) {
  const [listenOpen, setListenOpen] = useState(false);
  const [hmacOpen, setHmacOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);

  const typeLabel = connection.type === "meta_lead_ads" ? "Meta Lead Ads" : "Webhook";
  const typeIcon  = connection.type === "meta_lead_ads"
    ? <Globe className="w-4 h-4 text-blue-400" />
    : <Webhook className="w-4 h-4 text-violet-400" />;

  return (
    <>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
              {typeIcon}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-foreground truncate">{connection.name}</h3>
                <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted border border-border">
                  {typeLabel}
                </span>
                <StatusBadge status={connection.status as ConnectionStatus} pulse={hasNewEvent} />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-[11px] text-muted-foreground font-mono truncate max-w-[280px]">{connection.webhookUrl}</code>
                <CopyButton text={connection.webhookUrl} />
              </div>
              {connection.lastEventAt && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Last event: {format(new Date(connection.lastEventAt), "MMM d, HH:mm")}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            {connection.type === "webhook" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setListenOpen(true)}
                  className="h-7 px-2.5 text-xs border-border"
                >
                  <Radio className="w-3 h-3 mr-1" />
                  Listen
                </Button>
                <Button
                  size="sm"
                  variant={embedOpen ? "secondary" : "ghost"}
                  onClick={() => setEmbedOpen(v => !v)}
                  className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                  title={embedOpen ? "Hide embed snippet" : "Show embed snippet"}
                >
                  <Code2 className="w-3 h-3 mr-1" />
                  {embedOpen ? "Hide snippet" : "Show embed snippet"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setHmacOpen(true)}
                  className="h-7 px-2 text-muted-foreground hover:text-foreground"
                  title="Configure HMAC signature"
                >
                  <Lock className={cn("w-3.5 h-3.5", connection.hasHmacSecret && "text-emerald-400")} />
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(v => !v)}
              className="h-7 px-2 text-muted-foreground"
            >
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", expanded && "rotate-180")} />
            </Button>
          </div>
        </div>

        {/* Embed Snippet panel */}
        {embedOpen && connection.type === "webhook" && (
          <EmbedSnippetPanel connection={connection} />
        )}

        {/* Expanded setup steps */}
        {expanded && (
          <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Setup Instructions</p>
            <SetupSteps connection={connection} />
          </div>
        )}
      </div>

      {listenOpen && (
        <ListenDialog
          connection={connection}
          open={listenOpen}
          onClose={() => setListenOpen(false)}
          onMappingSaved={onRefresh}
        />
      )}
      {hmacOpen && (
        <HmacConfigDialog
          connection={connection}
          open={hmacOpen}
          onClose={() => { setHmacOpen(false); onRefresh(); }}
        />
      )}
    </>
  );
}

// ── Compact Webhook Row ───────────────────────────────────────────────────────

function WebhookRow({
  connection,
  onRefresh,
  hasNewEvent = false,
}: {
  connection: Connection;
  onRefresh: () => void;
  hasNewEvent?: boolean;
}) {
  const [listenOpen, setListenOpen] = useState(false);
  const [hmacOpen, setHmacOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);

  const initials = connection.name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("") || "W";

  return (
    <>
      <div className={cn("border-b border-border/50 last:border-b-0", hasNewEvent && "bg-violet-500/5")}>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center shrink-0 text-[10px] font-bold text-muted-foreground select-none">
            {initials}
          </div>

          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate max-w-[180px]">
              {connection.name}
            </span>
            <StatusBadge status={connection.status as ConnectionStatus} pulse={hasNewEvent} />
          </div>

          <div className="hidden sm:flex items-center gap-1 min-w-0 flex-1 max-w-[220px]">
            <code className="text-[10px] text-muted-foreground font-mono truncate">
              {connection.webhookUrl}
            </code>
            <CopyButton text={connection.webhookUrl} />
          </div>

          <div className="hidden md:block w-28 shrink-0 text-right">
            {connection.lastEventAt ? (
              <span className="text-[10px] text-muted-foreground">
                {format(new Date(connection.lastEventAt), "MMM d, HH:mm")}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground/40">—</span>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setListenOpen(true)}
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1"
              title="Listen for incoming payloads"
            >
              <Radio className="w-3 h-3" />
              <span className="hidden sm:inline">Listen</span>
            </Button>
            <Button
              size="sm"
              variant={embedOpen ? "secondary" : "ghost"}
              onClick={() => setEmbedOpen(v => !v)}
              className="h-6 px-2 text-muted-foreground hover:text-foreground"
              title={embedOpen ? "Hide embed snippet" : "Show embed snippet"}
            >
              <Code2 className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setHmacOpen(true)}
              className="h-6 px-2 text-muted-foreground hover:text-foreground"
              title="Configure HMAC signature"
            >
              <Lock className={cn("w-3 h-3", connection.hasHmacSecret && "text-emerald-400")} />
            </Button>
          </div>
        </div>

        {embedOpen && (
          <div className="px-4 pb-3 border-t border-border/30 pt-3">
            <EmbedSnippetPanel connection={connection} />
          </div>
        )}
      </div>

      {listenOpen && (
        <ListenDialog
          connection={connection}
          open={listenOpen}
          onClose={() => setListenOpen(false)}
          onMappingSaved={onRefresh}
        />
      )}
      {hmacOpen && (
        <HmacConfigDialog
          connection={connection}
          open={hmacOpen}
          onClose={() => { setHmacOpen(false); onRefresh(); }}
        />
      )}
    </>
  );
}

// ── Webhook Table ─────────────────────────────────────────────────────────────

const WEBHOOK_PAGE_SIZE = 5;

function WebhookTable({
  connections,
  onRefresh,
  newEventIds,
}: {
  connections: Connection[];
  onRefresh: () => void;
  newEventIds: Set<number>;
}) {
  const [search,   setSearch]   = useState("");
  // "asc" = oldest first, "desc" = newest first (default)
  const [dateSort, setDateSort] = useState<"asc" | "desc">("desc");
  const [page,     setPage]     = useState(1);

  // Reset to page 1 when search/sort changes
  useEffect(() => { setPage(1); }, [search, dateSort]);

  const filtered = useMemo(() =>
    connections.filter(c => c.name.toLowerCase().includes(search.toLowerCase())),
    [connections, search],
  );

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      // Connected / active always first regardless of date sort
      const aActive = a.status === "connected";
      const bActive = b.status === "connected";
      if (aActive && !bActive) return -1;
      if (bActive && !aActive) return 1;
      // Then sort by createdAt
      const aTs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateSort === "desc" ? bTs - aTs : aTs - bTs;
    });
  }, [filtered, dateSort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / WEBHOOK_PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageRows   = sorted.slice((safePage - 1) * WEBHOOK_PAGE_SIZE, safePage * WEBHOOK_PAGE_SIZE);

  return (
    <div className="space-y-2">
      {connections.length > WEBHOOK_PAGE_SIZE && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Filter by campaign name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-xs rounded-lg border border-border bg-muted/50 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary"
          />
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50 bg-muted/30">
          <div className="w-7 shrink-0" />
          <div className="flex-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Campaign</div>
          <div className="hidden sm:block flex-1 max-w-[220px] text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Webhook URL</div>
          <div className="hidden md:block w-28 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Last Event</div>
          {/* Date sort toggle */}
          <button
            onClick={() => setDateSort(d => d === "desc" ? "asc" : "desc")}
            className="hidden md:flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            title={dateSort === "desc" ? "Newest first — click for oldest first" : "Oldest first — click for newest first"}
          >
            {dateSort === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
          </button>
          <div className="w-[100px] text-[10px] font-semibold uppercase tracking-widest text-muted-foreground text-right">Actions</div>
        </div>

        {pageRows.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            {search ? `No campaigns match "${search}"` : "No webhook connections yet"}
          </div>
        ) : (
          pageRows.map(c => (
            <WebhookRow
              key={c.id}
              connection={c}
              onRefresh={onRefresh}
              hasNewEvent={newEventIds.has(c.id)}
            />
          ))
        )}
      </div>

      {/* Footer: count + pagination */}
      <div className="flex items-center justify-between pl-1">
        <p className="text-[10px] text-muted-foreground">
          {search && filtered.length !== connections.length
            ? `${filtered.length} of ${connections.length} webhooks`
            : `${connections.length} webhook${connections.length !== 1 ? "s" : ""}`}
          {" — "}one per campaign, auto-created
        </p>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              disabled={safePage <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="h-6 w-6 flex items-center justify-center rounded border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            <span className="text-[10px] text-muted-foreground tabular-nums px-1">
              {safePage} / {totalPages}
            </span>
            <button
              disabled={safePage >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="h-6 w-6 flex items-center justify-center rounded border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Setup steps per connection type ──────────────────────────────────────────

function SetupSteps({ connection }: { connection: Connection }) {
  const steps =
    connection.type === "meta_lead_ads"
      ? [
          { n: 1, text: "Go to Meta Business Manager → Lead Ads → Form Library." },
          { n: 2, text: "Open the form you want to connect, then click 'Integrate' or 'Webhooks'." },
          { n: 3, text: "Paste the Callback URL and Verify Token below:", detail: (
              <div className="mt-1.5 space-y-1.5">
                <div className="flex items-center gap-2 bg-muted rounded px-2.5 py-1.5">
                  <code className="text-[11px] font-mono flex-1 text-foreground">{connection.webhookUrl}</code>
                  <CopyButton text={connection.webhookUrl} />
                </div>
                <div className="flex items-center gap-2 bg-muted rounded px-2.5 py-1.5">
                  <span className="text-[11px] text-muted-foreground">Verify Token:</span>
                  <code className="text-[11px] font-mono flex-1 text-foreground">{connection.webhookToken}</code>
                  <CopyButton text={connection.webhookToken} />
                </div>
              </div>
            ) },
          { n: 4, text: "Subscribe to the 'leadgen' field change event." },
          { n: 5, text: "Submit a test lead from your form to verify the connection." },
        ]
      : [
          { n: 1, text: "Copy your webhook URL:", detail: (
              <div className="mt-1.5 flex items-center gap-2 bg-muted rounded px-2.5 py-1.5">
                <code className="text-[11px] font-mono flex-1 text-foreground truncate">{connection.webhookUrl}</code>
                <CopyButton text={connection.webhookUrl} />
              </div>
            ) },
          { n: 2, text: "In your form builder / CRM, configure an HTTP POST webhook to the URL above." },
          { n: 3, text: "Send a test submission, then click 'Listen' to capture the payload and map fields." },
          { n: 4, text: "(Optional) Enable HMAC signature verification via the lock icon for added security." },
        ];

  return (
    <ol className="space-y-2.5">
      {steps.map(s => (
        <li key={s.n} className="flex gap-2.5">
          <span className="shrink-0 w-5 h-5 rounded-full bg-muted border border-border flex items-center justify-center text-[10px] font-semibold text-muted-foreground">{s.n}</span>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">{s.text}</p>
            {s.detail}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Recipe cards (Zapier/Make, Google Sheets) ─────────────────────────────────

function RecipeCard({
  icon, title, description, badge, children, comingSoon,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  children?: React.ReactNode;
  comingSoon?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (comingSoon) {
    return (
      <div className="bg-card border border-border/40 rounded-xl overflow-hidden opacity-50 cursor-not-allowed select-none">
        <div className="w-full flex items-center gap-3 p-4 text-left">
          <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 grayscale">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-muted-foreground">{title}</span>
              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground/60">
                Coming Soon
              </span>
            </div>
            <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">{description}</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{title}</span>
            {badge && (
              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>
        </div>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && children && (
        <div className="px-4 pb-4 border-t border-border/50 pt-3">{children}</div>
      )}
    </div>
  );
}

const APPS_SCRIPT_CODE = `// Google Apps Script — paste into your Sheet's Script Editor
// Tools → Script editor → paste this → save → run setup() once to authorize

const WEBHOOK_URL = "PASTE_YOUR_WEBHOOK_URL_HERE";

function onFormSubmit(e) {
  const values = e.namedValues;
  const payload = {};
  for (const key in values) {
    payload[key] = values[key][0] || "";
  }
  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}

// To trigger on new rows from a form: set up a Form Submit trigger
// via Extensions → Apps Script → Triggers → Add trigger → onFormSubmit
`;

function GoogleSheetsRecipe({ firstWebhookUrl }: { firstWebhookUrl: string }) {
  const script = APPS_SCRIPT_CODE.replace("PASTE_YOUR_WEBHOOK_URL_HERE", firstWebhookUrl || "https://your-domain.com/api/webhooks/lead/TOKEN");
  const steps = [
    "Open your Google Spreadsheet → Extensions → Apps Script",
    "Replace the default code with the script below (update WEBHOOK_URL)",
    "Save → Run setup() once to authorize → go back to the Sheet",
    "Create a trigger: Triggers → Add Trigger → choose onFormSubmit → From spreadsheet → On form submit",
    "Submit a test row from your linked Google Form to verify",
  ];
  return (
    <div className="space-y-3">
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="shrink-0 w-5 h-5 rounded-full bg-muted border border-border flex items-center justify-center text-[10px] font-semibold text-muted-foreground">{i + 1}</span>
            <p className="text-xs text-muted-foreground">{s}</p>
          </li>
        ))}
      </ol>
      <div className="relative">
        <div className="absolute top-2 right-2 z-10">
          <CopyButton text={script} label="Copy script" />
        </div>
        <pre className="bg-muted rounded-lg p-3 text-[10px] font-mono text-muted-foreground overflow-x-auto max-h-52 whitespace-pre border border-border">
          {script}
        </pre>
      </div>
    </div>
  );
}

function ZapierMakeRecipe({ firstWebhookUrl }: { firstWebhookUrl: string }) {
  const steps = [
    { platform: "Zapier", steps: [
      'Create a new Zap → Trigger: choose your source app → Action: "Webhooks by Zapier" → POST',
      "Set the URL to your webhook URL (below)",
      "Set Payload Type to JSON",
      "Map your trigger fields to the payload",
      "Turn on the Zap and send a test event",
    ]},
    { platform: "Make (formerly Integromat)", steps: [
      "Create a new Scenario → Add trigger module from your source app",
      'Add an HTTP module → Make a Request → Method: POST',
      "Set the URL to your webhook URL, Body Type: application/json",
      "Map your source fields to the JSON body",
      "Run once to test, then schedule",
    ]},
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2">
        <span className="text-xs text-muted-foreground">Webhook URL:</span>
        <code className="text-xs font-mono text-foreground flex-1 truncate">{firstWebhookUrl || "—"}</code>
        {firstWebhookUrl && <CopyButton text={firstWebhookUrl} />}
      </div>
      {steps.map(platform => (
        <div key={platform.platform} className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">{platform.platform}</p>
          <ol className="space-y-1.5">
            {platform.steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 w-4 h-4 rounded-full bg-muted border border-border flex items-center justify-center text-[9px] font-semibold text-muted-foreground">{i + 1}</span>
                <p className="text-xs text-muted-foreground">{s}</p>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

// ── CRM Import Dialog — two-step wizard ───────────────────────────────────────
// Step 1: pick campaign + optional list/view filter + select contacts
// Step 2: map CRM raw fields → agent variables + writeback config → import

export function CrmImportDialog({
  connection,
  open,
  onClose,
  defaultCampaignId,
  onImported,
}: {
  connection: CrmConnection;
  open: boolean;
  onClose: () => void;
  defaultCampaignId?: number;
  onImported?: (batchId: number, leadsCreated: number, duplicatesFound: number, invalidPhones: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Step state (1–6)
  const [step, setStep]             = useState<1 | 2 | 3 | 4 | 5 | 6>(1);

  // Step 1 state
  const [campaignId, setCampaignId] = useState<number | null>(defaultCampaignId ?? null);
  const [query, setQuery]           = useState("");
  const [listId, setListId]         = useState<string>("");
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  // Zoho only — toggle between Contacts and Leads modules
  const [module, setModule]         = useState<"contacts" | "leads">("contacts");
  const isZoho = connection.provider === "zoho";

  // Step 2 state — field mapping
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>(
    (connection.fieldMapping as Record<string, string> | null) ?? { phone: "phone" }
  );

  // Step 4 state — duplicate policy
  const [duplicatePolicy, setDuplicatePolicy] = useState<"ignore" | "skip" | "reject_with_report">("skip");

  // Step 5 state — execution rules
  const [maxAttempts, setMaxAttempts]               = useState(2);
  const [retryDelayMinutes, setRetryDelayMinutes]   = useState(60);
  const [timezone, setTimezone]                     = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [businessHoursStart, setBusinessHoursStart] = useState<number | null>(null);
  const [businessHoursEnd, setBusinessHoursEnd]     = useState<number | null>(null);
  const [scheduledStartAt, setScheduledStartAt]     = useState<string | null>(null);
  const [autoStart, setAutoStart]                   = useState(false);

  const [importing, setImporting] = useState(false);

  const { data: campaigns = [] } = useListCampaigns();

  // Fetch available lists/views for the filter dropdown
  const { data: listsPage } = useListCrmLists(
    connection.id,
    isZoho ? { module } : undefined,
    { query: { enabled: open, refetchOnWindowFocus: false, queryKey: [connection.id, "crm-lists", module] } },
  );
  const availableLists = listsPage?.lists ?? [];

  const { data: contactsPage, isLoading: contactsLoading, isFetching } = useListCrmContacts(
    connection.id,
    { query: query || undefined, limit: 50, listId: listId || undefined, ...(isZoho ? { module } : {}) },
    { query: { enabled: open, refetchOnWindowFocus: false, queryKey: [connection.id, "crm-contacts", query, listId, module] } },
  );
  const contacts = contactsPage?.contacts ?? [];

  const importMut     = useImportCrmContacts();
  const updateConnMut = useUpdateCrmConnection();
  const startBatchMut = useStartCampaignBatch();

  // Fetch existing leads for the selected campaign to detect previously imported contacts
  const { data: existingLeadsPage } = useListCampaignLeads(
    campaignId ?? 0,
    { limit: 1000 },
    { query: { enabled: open && !!campaignId, queryKey: ["crm-existing-leads", campaignId] } },
  );
  const existingPhones = new Set(
    (existingLeadsPage?.leads ?? []).map((l: { phone: string }) => l.phone.replace(/\D/g, "").slice(-10)),
  );

  // ── Country-code config for phone normalization ────────────────────────────
  const COUNTRY_PHONE_CONFIG: Record<string, { name: string; nl: number }> = {
    "91":  { name: "India (+91)",       nl: 10 },
    "1":   { name: "US/Canada (+1)",    nl: 10 },
    "44":  { name: "UK (+44)",          nl: 10 },
    "971": { name: "UAE (+971)",        nl: 9  },
    "65":  { name: "Singapore (+65)",   nl: 8  },
    "61":  { name: "Australia (+61)",   nl: 9  },
    "60":  { name: "Malaysia (+60)",    nl: 9  },
    "234": { name: "Nigeria (+234)",    nl: 10 },
    "27":  { name: "South Africa (+27)",nl: 9  },
    "49":  { name: "Germany (+49)",     nl: 10 },
    "33":  { name: "France (+33)",      nl: 9  },
    "55":  { name: "Brazil (+55)",      nl: 11 },
  };

  const [phoneCountryCode, setPhoneCountryCode] = useState("91");

  // ── Client-side phone normalizer (mirrors server phone-normalization.ts) ────
  function clientNormalizePhone(raw: string | null | undefined, cc = phoneCountryCode): { normalized: string | null; valid: boolean } {
    if (!raw || typeof raw !== "string") return { normalized: null, valid: false };
    const nl = COUNTRY_PHONE_CONFIG[cc]?.nl ?? 10;
    const hasLeadingPlus = raw.trimStart().startsWith("+");
    const stripped  = raw.replace(/[\s\-().]/g, "").replace(/[^\d+]/g, "");
    const digitsOnly = stripped.replace(/\+/g, "");
    if (hasLeadingPlus || stripped.startsWith("+")) {
      if (digitsOnly.length < 7 || digitsOnly.length > 15) return { normalized: null, valid: false };
      return { normalized: "+" + digitsOnly, valid: true };
    }
    if (digitsOnly.startsWith("00")) {
      const w = digitsOnly.slice(2);
      if (w.length < 7 || w.length > 15) return { normalized: null, valid: false };
      return { normalized: "+" + w, valid: true };
    }
    if (digitsOnly.length === nl)                                return { normalized: "+" + cc + digitsOnly, valid: true };
    if (digitsOnly.startsWith(cc) && digitsOnly.slice(cc.length).length === nl)
                                                                 return { normalized: "+" + digitsOnly, valid: true };
    if (digitsOnly.startsWith("0") && digitsOnly.length === nl + 1)
                                                                 return { normalized: "+" + cc + digitsOnly.slice(1), valid: true };
    return { normalized: null, valid: false };
  }

  function isAlreadyImported(normalizedPhone: string | null | undefined): boolean {
    if (!normalizedPhone) return false;
    const tail = normalizedPhone.replace(/\D/g, "").slice(-10);
    return existingPhones.has(tail);
  }

  // Validation summary — computed from selected contacts + field mapping (used in steps 3 & 6)
  const selectedContacts = contacts.filter(c => selected.has(c.id));
  const phoneField       = fieldMapping["phone"] ?? "phone";

  // Per-contact validation rows: raw phone → normalized → status
  type ContactValidation = {
    contact: typeof selectedContacts[0];
    raw: string;
    normalized: string | null;
    hasRaw: boolean;
    validFormat: boolean;
    alreadyImported: boolean;
  };
  const validationRows: ContactValidation[] = selectedContacts.map(c => {
    const raw = ((c.rawFields as Record<string, string> | undefined)?.[phoneField] ?? c.phone ?? "").trim();
    const hasRaw = raw.length > 0;
    const { normalized, valid } = hasRaw ? clientNormalizePhone(raw) : { normalized: null, valid: false };
    return {
      contact: c,
      raw,
      normalized,
      hasRaw,
      validFormat: valid,
      alreadyImported: isAlreadyImported(normalized),
    };
  });

  const withPhone           = validationRows.filter(r => r.validFormat);
  const withoutPhone        = validationRows.filter(r => !r.hasRaw).length;
  const invalidPhoneCount   = validationRows.filter(r => r.hasRaw && !r.validFormat).length;
  const alreadyImportedCount = withPhone.filter(r => r.alreadyImported).length;

  const allTimezones: string[] = (() => {
    try { return Intl.supportedValuesOf("timeZone") as string[]; }
    catch { return [timezone]; }
  })();

  const toggleAll = () => {
    if (selected.size === contacts.length) setSelected(new Set());
    else setSelected(new Set(contacts.map(c => c.id)));
  };

  // Build flatFields for the mapping editor from first selected contact's rawFields
  const firstSelected = contacts.find(c => selected.has(c.id));
  const rawFields: Record<string, string> = { ...(firstSelected?.rawFields ?? {}) };
  if (firstSelected) {
    if (firstSelected.phone   && !rawFields["phone"])   rawFields["phone"]   = firstSelected.phone;
    if (firstSelected.name    && !rawFields["name"])    rawFields["name"]    = firstSelected.name;
    if (firstSelected.email   && !rawFields["email"])   rawFields["email"]   = firstSelected.email;
    if (firstSelected.company && !rawFields["company"]) rawFields["company"] = firstSelected.company;
  }

  const goToMapping = () => {
    if (!campaignId) { toast({ title: "Select a campaign first", variant: "destructive" }); return; }
    if (selected.size === 0) { toast({ title: "Select at least one contact", variant: "destructive" }); return; }
    const saved = (connection.fieldMapping as Record<string, string> | null) ?? {};
    setFieldMapping({ phone: saved["phone"] ?? "phone", ...saved });
    setStep(2);
  };

  const handleImport = async () => {
    if (!campaignId) return;
    // Only send contacts with a valid normalized phone (skips no-phone + invalid format)
    if (withPhone.length === 0) return;
    setImporting(true);
    try {
      // Persist updated field mapping to the connection before importing
      await updateConnMut.mutateAsync({ id: connection.id, data: { fieldMapping } });

      const result = await importMut.mutateAsync({
        id: connection.id,
        data: {
          campaignId,
          contacts: withPhone.map(r => ({
            id:        r.contact.id,
            phone:     r.normalized!,       // E.164 normalized phone
            name:      r.contact.name ?? null,
            email:     r.contact.email ?? null,
            company:   r.contact.company ?? null,
            rawFields: (r.contact.rawFields ?? {}) as Record<string, string>,
          })),
          fieldMapping,
          duplicatePolicy,
          maxAttempts,
          retryDelayMinutes,
          timezone,
          businessHoursStart: businessHoursStart ?? undefined,
          businessHoursEnd:   businessHoursEnd   ?? undefined,
          scheduledStartAt:   scheduledStartAt   ?? undefined,
        },
      });
      if (autoStart) {
        await startBatchMut.mutateAsync({ id: campaignId, batchId: result.batchId });
      }
      await qc.invalidateQueries({ queryKey: getListCrmConnectionsQueryKey() });
      toast({
        title: `Import complete — ${result.leadsCreated} leads added`,
        description: [
          result.duplicatesFound ? `${result.duplicatesFound} duplicates skipped` : null,
          result.invalidPhones   ? `${result.invalidPhones} invalid phones` : null,
          result.dncBlocked      ? `${result.dncBlocked} DNC blocked` : null,
        ].filter(Boolean).join(" · ") || undefined,
      });
      onImported?.(result.batchId, result.leadsCreated, result.duplicatesFound ?? 0, result.invalidPhones ?? 0);
      onClose();
    } catch (err) {
      toast({ title: "Import failed", description: String(err), variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setStep(1); setSelected(new Set()); setQuery(""); setCampaignId(null); setListId("");
      setModule("contacts");
      setFieldMapping((connection.fieldMapping as Record<string, string> | null) ?? { phone: "phone" });
      setDuplicatePolicy("skip");
      setMaxAttempts(2);
      setRetryDelayMinutes(60);
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      setBusinessHoursStart(null);
      setBusinessHoursEnd(null);
      setScheduledStartAt(null);
      setAutoStart(false);
      setPhoneCountryCode("91");
    }
  }, [open, connection.fieldMapping]);

  const providerName = connection.provider === "hubspot" ? "HubSpot" : "Zoho CRM";
  const listLabel    = connection.provider === "hubspot" ? "list" : "view";
  const recordLabel  = isZoho ? (module === "leads" ? "lead" : "contact") : "contact";
  const STEP_LABELS  = ["Select Contacts", "Field Mapping", "Validation", "Duplicates", "Execution Rules", "Review"];

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="bg-card border-border max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            Import from {providerName}
            <span className="ml-auto text-[10px] font-normal text-muted-foreground">
              Step {step} of 6 — {STEP_LABELS[step - 1]}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {step === 1 ? `${connection.accountName ?? connection.accountId} — filter by ${listLabel}, then select ${recordLabel}s.`
              : step === 2 ? "Map CRM fields to agent variables. Phone is required."
              : step === 3 ? "Review which contacts will be imported and which will be skipped."
              : step === 4 ? "Choose how to handle contacts already in this campaign."
              : step === 5 ? "Set retry rules, calling hours, and when to run the batch."
              : "Review all settings then click Import to create the batch."}
          </DialogDescription>
        </DialogHeader>

        {/* Step progress dots */}
        <div className="flex items-center justify-center gap-1.5">
          {([1, 2, 3, 4, 5, 6] as const).map(s => (
            <div
              key={s}
              className={cn(
                "h-1.5 rounded-full transition-all",
                s === step ? "w-5 bg-primary" : s < step ? "w-1.5 bg-primary/50" : "w-1.5 bg-muted-foreground/25",
              )}
            />
          ))}
        </div>

        {/* ── Step 1: Select Contacts ──────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Country code — affects phone normalization in the validation step */}
            <div className="space-y-1.5">
              <Label className="text-xs">Phone number country</Label>
              <select
                value={phoneCountryCode}
                onChange={e => setPhoneCountryCode(e.target.value)}
                className="w-full h-8 text-sm rounded-md border border-border bg-muted px-2 text-foreground focus:outline-none focus:border-primary"
              >
                {Object.entries(COUNTRY_PHONE_CONFIG).map(([cc, cfg]) => (
                  <option key={cc} value={cc}>{cfg.name}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">Used to normalize bare local numbers in the validation step</p>
            </div>

            {isZoho && (
              <div className="space-y-1.5">
                <Label className="text-xs">Import from</Label>
                <div className="flex rounded-md border border-border overflow-hidden h-8">
                  {(["contacts", "leads"] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { if (module !== m) { setModule(m); setListId(""); setSelected(new Set()); } }}
                      className={cn(
                        "flex-1 text-xs font-medium transition-colors",
                        module === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
                      )}
                    >
                      {m === "contacts" ? "Contacts" : "Leads"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!defaultCampaignId && (
              <div className="space-y-1.5">
                <Label className="text-xs">Destination Campaign</Label>
                <select
                  value={campaignId ?? ""}
                  onChange={e => setCampaignId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full h-8 text-sm rounded-md border border-border bg-muted px-2 text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="">— pick a campaign —</option>
                  {campaigns.map((c: { id: number; name: string }) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            {availableLists.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Filter by {listLabel} <span className="text-muted-foreground">(optional)</span></Label>
                <select
                  value={listId}
                  onChange={e => { setListId(e.target.value); setSelected(new Set()); }}
                  className="w-full h-8 text-sm rounded-md border border-border bg-muted px-2 text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="">— All contacts —</option>
                  {availableLists.map((l: { id: string; name: string; count?: number }) => (
                    <option key={l.id} value={l.id}>{l.name}{l.count != null ? ` (${l.count})` : ""}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Search contacts…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="h-7 text-xs"
                />
                {contacts.length > 0 && (
                  <Button size="sm" variant="outline" onClick={toggleAll} className="h-7 px-2 text-xs shrink-0">
                    {selected.size === contacts.length ? "Deselect all" : "Select all"}
                  </Button>
                )}
              </div>
              <div className="border border-border rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                {contactsLoading || isFetching ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : contacts.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                    {query ? `No ${recordLabel}s match your search` : `No ${recordLabel}s found`}
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {contacts.map((c: CrmContact) => {
                      const isSelected = selected.has(c.id);
                      const alreadyImported = isAlreadyImported(c.phone);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelected(prev => {
                            const next = new Set(prev);
                            isSelected ? next.delete(c.id) : next.add(c.id);
                            return next;
                          })}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors",
                            isSelected && "bg-primary/5",
                            alreadyImported && "opacity-70",
                          )}
                        >
                          <div className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors", isSelected ? "bg-primary border-primary" : "border-border")}>
                            {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-medium truncate">{c.name ?? c.phone}</p>
                              {alreadyImported && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
                                  Already Imported
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-muted-foreground font-mono">{c.phone}</span>
                              {c.email && <span className="text-[10px] text-muted-foreground truncate">{c.email}</span>}
                              {c.company && <span className="text-[10px] text-muted-foreground truncate">{c.company}</span>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {contacts.length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {selected.size} of {contacts.length} {recordLabel}s selected
                  {contactsPage?.total != null && contacts.length < contactsPage.total
                    ? ` (${contactsPage.total} total — search to filter)` : ""}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Field Mapping ─────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {Object.keys(rawFields).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No raw fields available. The import will use phone/name/email/company directly.
              </p>
            ) : (
              <FieldMappingEditor
                flatFields={rawFields}
                mapping={fieldMapping}
                systemPrompt={null}
                onChange={setFieldMapping}
              />
            )}
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Post-call status update (optional)
              </p>
              <p className="text-[10px] text-muted-foreground">
                After each call, update a CRM field with the call result. Set the field name and map each disposition value.
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground w-40 shrink-0">Status field name</span>
                <input
                  type="text"
                  placeholder={connection.provider === "hubspot" ? "e.g. hs_lead_status" : "e.g. Lead_Status"}
                  value={fieldMapping["__writeback_status_field"] ?? ""}
                  onChange={e => setFieldMapping(m => ({ ...m, "__writeback_status_field": e.target.value }))}
                  className="flex-1 h-6 text-xs rounded border border-border bg-background px-2 text-foreground focus:outline-none focus:border-primary"
                />
              </div>
              {fieldMapping["__writeback_status_field"] && (
                <div className="space-y-1 pt-1">
                  {["completed", "voicemail", "no_answer", "failed"].map(disp => (
                    <div key={disp} className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground w-40 shrink-0">{disp} →</span>
                      <input
                        type="text"
                        placeholder="CRM value"
                        value={fieldMapping[`__writeback_status_${disp}`] ?? ""}
                        onChange={e => setFieldMapping(m => ({ ...m, [`__writeback_status_${disp}`]: e.target.value }))}
                        className="flex-1 h-6 text-xs rounded border border-border bg-background px-2 text-foreground focus:outline-none focus:border-primary"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Validation Preview ────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-3">
            {/* Count summary */}
            <div className="bg-muted/30 border border-border rounded-xl p-4">
              <div className="grid grid-cols-4 gap-2 text-center">
                <div>
                  <p className="text-2xl font-bold">{selectedContacts.length}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Selected</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-400">{withPhone.length}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Ready</p>
                </div>
                <div>
                  <p className={cn("text-2xl font-bold", invalidPhoneCount > 0 ? "text-red-400" : "text-muted-foreground")}>
                    {invalidPhoneCount}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Invalid format</p>
                </div>
                <div>
                  <p className={cn("text-2xl font-bold", withoutPhone > 0 ? "text-amber-400" : "text-muted-foreground")}>
                    {withoutPhone}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Missing phone</p>
                </div>
              </div>
            </div>

            {/* Alerts */}
            {withPhone.length === 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-400">
                  No contacts have a valid phone under the mapped "{phoneField}" field. Go back and adjust the field mapping.
                </p>
              </div>
            )}
            {invalidPhoneCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  <span className="text-red-400 font-medium">{invalidPhoneCount} contacts</span> have an unrecognized phone format and will be skipped. Ensure numbers are 10-digit Indian or include a country code.
                </p>
              </div>
            )}
            {alreadyImportedCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  <span className="text-amber-400 font-medium">{alreadyImportedCount} contacts</span> appear to already be in this campaign. You'll set the duplicate policy in the next step.
                </p>
              </div>
            )}

            {/* Row preview with normalization */}
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/40 border-b border-border">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Row preview — phone normalization + duplicate detection
                </p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Name</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Phone (raw)</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Normalized</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {validationRows.slice(0, 8).map(r => (
                    <tr key={r.contact.id} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 truncate max-w-[90px]">{r.contact.name ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground text-[10px]">{r.raw || "—"}</td>
                      <td className="px-3 py-2 font-mono text-[10px]">
                        {r.normalized
                          ? <span className="text-emerald-400 font-semibold">{r.normalized}</span>
                          : <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {!r.hasRaw
                          ? <span className="text-amber-400 text-[10px]">No phone</span>
                          : !r.validFormat
                            ? <span className="text-red-400 text-[10px]">Invalid format</span>
                            : r.alreadyImported
                              ? <span className="text-amber-400 text-[10px]">Already imported</span>
                              : <span className="text-emerald-400 text-[10px]">Ready</span>}
                      </td>
                    </tr>
                  ))}
                  {validationRows.length > 8 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-center text-[10px] text-muted-foreground">
                        +{validationRows.length - 8} more contacts
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Step 4: Duplicate Handling ────────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Choose what happens when a contact's phone already exists in this campaign.
            </p>
            {([
              { value: "skip",               label: "Skip duplicates",    desc: "Duplicate contacts are silently skipped. Recommended for re-imports." },
              { value: "ignore",             label: "Allow duplicates",   desc: "All contacts are imported even if their phone exists. May cause repeat calls." },
              { value: "reject_with_report", label: "Reject with report", desc: "Duplicates are rejected and counted in the import result." },
            ] as const).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDuplicatePolicy(opt.value)}
                className={cn(
                  "w-full text-left rounded-xl border p-3.5 transition-colors",
                  duplicatePolicy === opt.value ? "border-primary bg-primary/5" : "border-border bg-muted/30 hover:bg-muted/50",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <div className={cn(
                    "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5",
                    duplicatePolicy === opt.value ? "border-primary" : "border-muted-foreground/40",
                  )}>
                    {duplicatePolicy === opt.value && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div>
                    <p className="text-xs font-medium">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Step 5: Execution Rules ───────────────────────────────────────── */}
        {step === 5 && (
          <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
            <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Retry Settings</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Max Attempts</Label>
                  <Input
                    type="number" min={1} max={10}
                    value={maxAttempts}
                    onChange={e => setMaxAttempts(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Retry Delay (min)</Label>
                  <Input
                    type="number" min={1}
                    value={retryDelayMinutes}
                    onChange={e => setRetryDelayMinutes(Math.max(1, parseInt(e.target.value, 10) || 60))}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                Business Hours <span className="normal-case font-normal text-muted-foreground">(optional)</span>
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs">Timezone</Label>
                <select
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="w-full h-9 text-sm rounded-md border border-border bg-muted px-2 text-foreground focus:outline-none focus:border-primary"
                >
                  {allTimezones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Start Hour (24h)</Label>
                  <Input
                    type="number" min={0} max={23}
                    value={businessHoursStart ?? ""}
                    onChange={e => setBusinessHoursStart(e.target.value ? parseInt(e.target.value, 10) : null)}
                    placeholder="e.g. 9"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">End Hour (24h)</Label>
                  <Input
                    type="number" min={0} max={23}
                    value={businessHoursEnd ?? ""}
                    onChange={e => setBusinessHoursEnd(e.target.value ? parseInt(e.target.value, 10) : null)}
                    placeholder="e.g. 18"
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Schedule Batch</p>
              <p className="text-xs text-muted-foreground -mt-2">When do you want to run this batch?</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Run At</Label>
                <Input
                  type="datetime-local"
                  value={scheduledStartAt ?? ""}
                  onChange={e => setScheduledStartAt(e.target.value || null)}
                  className="h-9 text-xs"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {[{ label: "In 10 Minutes", minutes: 10 }, { label: "In 30 Minutes", minutes: 30 }, { label: "In 1 Hour", minutes: 60 }].map(({ label, minutes }) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => {
                      const d = new Date(Date.now() + minutes * 60 * 1000);
                      setScheduledStartAt(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 pt-1 border-t border-border">
                <Switch id="crm-autostart" checked={autoStart} onCheckedChange={setAutoStart} />
                <Label htmlFor="crm-autostart" className="text-xs cursor-pointer">
                  Auto-start immediately after import
                </Label>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 6: Review & Launch ───────────────────────────────────────── */}
        {step === 6 && (
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            <div className="bg-muted/30 border border-border rounded-xl p-3.5 space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Contacts</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold">{selectedContacts.length}</p>
                  <p className="text-[10px] text-muted-foreground">Selected</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-emerald-400">{withPhone.length}</p>
                  <p className="text-[10px] text-muted-foreground">Will import</p>
                </div>
                <div>
                  <p className={cn("text-lg font-bold", (withoutPhone + invalidPhoneCount) > 0 ? "text-amber-400" : "text-muted-foreground")}>
                    {withoutPhone + invalidPhoneCount}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Skipped</p>
                </div>
              </div>
            </div>

            <div className="bg-muted/30 border border-border rounded-xl p-3.5 space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Execution</p>
              <div className="space-y-1.5">
                {([
                  ["Duplicate Policy", duplicatePolicy.replace(/_/g, " ")],
                  ["Max Attempts",     String(maxAttempts)],
                  ["Retry Delay",      `${retryDelayMinutes} min`],
                  ["Timezone",         timezone],
                  ...(businessHoursStart != null && businessHoursEnd != null
                    ? [["Business Hours", `${businessHoursStart}:00 – ${businessHoursEnd}:00`]] : []),
                  ["Run", scheduledStartAt
                    ? new Date(scheduledStartAt).toLocaleString()
                    : autoStart ? "Immediately after import" : "Manual — stays in Draft"],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="truncate max-w-[200px] text-right">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">Cancel</Button>
              <Button size="sm" disabled={selected.size === 0 || !campaignId} onClick={goToMapping}>
                Next: Field Mapping →
              </Button>
            </>
          ) : step < 6 ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep((step - 1) as typeof step)} className="text-muted-foreground">
                ← Back
              </Button>
              <Button
                size="sm"
                disabled={step === 3 && withPhone.length === 0}
                onClick={() => setStep((step + 1) as typeof step)}
              >
                {step === 5 ? "Review →" : "Next →"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep(5)} className="text-muted-foreground">← Back</Button>
              <Button size="sm" disabled={importing || withPhone.length === 0} onClick={handleImport}>
                {importing ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : null}
                Import {withPhone.length} {recordLabel}{withPhone.length !== 1 ? "s" : ""}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CRM Provider Card ─────────────────────────────────────────────────────────

const CRM_PROVIDERS: Array<{
  id: "hubspot" | "zoho";
  name: string;
  description: string;
  color: string;
  logo: React.ReactNode;
  comingSoon?: boolean;
}> = [
  {
    id: "hubspot",
    name: "HubSpot",
    description: "Import contacts and push call outcomes as notes",
    color: "text-orange-400",
    logo: <span className="text-orange-400 font-bold text-sm">HS</span>,
    comingSoon: true,
  },
  {
    id: "zoho",
    name: "Zoho CRM",
    description: "Import contacts and push call outcomes as notes",
    color: "text-blue-400",
    logo: <span className="text-blue-400 font-bold text-sm">ZO</span>,
  },
];

function CrmConnectorSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: connections = [], isLoading, refetch } = useListCrmConnections();
  const deleteMut = useDeleteCrmConnection();
  const [importConn, setImportConn] = useState<CrmConnection | null>(null);

  // After OAuth redirect back to /app/connections#crm-connected=<provider>,
  // the query cache is stale (page never unmounted). Detect the hash and force
  // a fresh fetch so the newly-connected account appears immediately.
  useEffect(() => {
    const hash = window.location.hash;
    const connected = hash.match(/crm-connected=(\w+)/)?.[1];
    const error     = hash.match(/crm-error=([^&]*)/)?.[1];

    if (connected) {
      qc.invalidateQueries({ queryKey: getListCrmConnectionsQueryKey() }).then(() => refetch());
      toast({ title: `${connected.charAt(0).toUpperCase() + connected.slice(1)} CRM connected` });
      // Clear the hash so refreshing the page doesn't re-trigger
      history.replaceState(null, "", window.location.pathname + window.location.search);
    } else if (error) {
      toast({ title: "CRM connection failed", description: decodeURIComponent(error), variant: "destructive" });
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = (provider: "hubspot" | "zoho") => {
    const token = localStorage.getItem("voiceorch:session") ?? "";
    const url = `${BASE}/api/crm/connect/${provider}?returnOrigin=${encodeURIComponent(window.location.origin)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
    window.location.href = url;
  };

  const handleDisconnect = async (conn: CrmConnection) => {
    if (!confirm(`Disconnect ${conn.accountName ?? conn.provider}? Existing imported leads will remain.`)) return;
    try {
      await deleteMut.mutateAsync({ id: conn.id });
      await qc.invalidateQueries({ queryKey: getListCrmConnectionsQueryKey() });
      toast({ title: "CRM disconnected" });
    } catch {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    }
  };

  return (
    <>
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          CRM Connectors
        </h2>
        <span className="text-[10px] text-muted-foreground">
          Import contacts • Push call outcomes
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="h-20 rounded-xl bg-card border border-border animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {CRM_PROVIDERS.map(provider => {
            const activeConns = connections.filter(c => c.provider === provider.id);
            const isConnected = activeConns.length > 0;

            return (
              <div
                key={provider.id}
                className={provider.comingSoon ? "cursor-not-allowed" : undefined}
              >
              <div
                className={`bg-card border border-border rounded-xl p-4${provider.comingSoon ? " opacity-50 pointer-events-none" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                      {provider.logo}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-foreground">{provider.name}</h3>
                        {isConnected && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-emerald-500/15 text-emerald-400 border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Connected
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{provider.description}</p>

                      {/* Show connected accounts with import action */}
                      {activeConns.map(conn => (
                        <div key={conn.id} className="mt-2 flex items-center gap-2 flex-wrap">
                          <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span className="text-xs text-foreground">{conn.accountName ?? conn.accountId}</span>
                          {conn.lastSyncAt && (
                            <span className="text-[10px] text-muted-foreground">
                              · Synced {format(new Date(conn.lastSyncAt), "MMM d, HH:mm")}
                            </span>
                          )}
                          {conn.lastError && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-red-400">
                              <AlertCircle className="w-2.5 h-2.5" />
                              {conn.lastError.slice(0, 60)}
                            </span>
                          )}
                          {conn.provider !== "zoho" && (
                            <Button
                              size="sm" variant="outline"
                              className="h-6 px-2 text-[10px] ml-auto"
                              onClick={() => setImportConn(conn)}
                            >
                              Import Contacts
                            </Button>
                          )}
                        </div>
                      ))}
                      {isConnected && (
                        <p className="mt-2 text-[10px] text-muted-foreground/60 flex items-center gap-1">
                          <Activity className="w-3 h-3" />
                          To set up instant webhook triggers, open the Campaign and use its CRM Integration section.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {!provider.comingSoon && activeConns.map(conn => (
                      <div key={conn.id} className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDisconnect(conn)}
                          className="h-7 px-2 text-muted-foreground hover:text-red-400"
                          title={`Disconnect ${conn.accountName ?? provider.name}`}
                        >
                          <Link2Off className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                    {provider.comingSoon ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                        Coming Soon
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant={isConnected ? "ghost" : "default"}
                        onClick={() => handleConnect(provider.id)}
                        className="h-7 px-3 text-xs"
                      >
                        <Link2 className="w-3 h-3 mr-1.5" />
                        {isConnected ? "Connect another" : "Connect"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              </div>
            );
          })}
        </div>
      )}

    </section>

    {importConn && (
      <CrmImportDialog
        connection={importConn}
        open={true}
        onClose={() => setImportConn(null)}
      />
    )}
  </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConnectionsPage() {
  const { data: connections = [], isLoading, refetch } = useListConnections({
    query: { queryKey: getListConnectionsQueryKey(), refetchInterval: 30_000 },
  });
  const qc = useQueryClient();

  // Track previous lastEventAt values to detect new events across refetch cycles
  const prevLastEventAt = useRef<Record<number, string | null>>({});
  const [newEventIds, setNewEventIds] = useState<Set<number>>(new Set());
  const clearTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (connections.length === 0) return;
    const prev = prevLastEventAt.current;
    const isFirstLoad = Object.keys(prev).length === 0;

    if (!isFirstLoad) {
      const freshIds = new Set<number>();
      for (const c of connections) {
        const prevTs = prev[c.id] ?? null;
        const curTs  = c.lastEventAt ?? null;
        if (curTs && curTs !== prevTs) freshIds.add(c.id);
      }
      if (freshIds.size > 0) {
        setNewEventIds(freshIds);
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => setNewEventIds(new Set()), 6_000);
      }
    }

    for (const c of connections) {
      prev[c.id] = c.lastEventAt ?? null;
    }
  }, [connections]);

  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
  }, []);

  const webhookConnections  = connections.filter(c => c.type === "webhook");
  const metaConnections     = connections.filter(c => c.type === "meta_lead_ads");
  const firstWebhookUrl     = webhookConnections[0]?.webhookUrl ?? "";

  const handleRefresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
    await refetch();
  }, [qc, refetch]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-foreground">Connections</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect your CRM, automate lead intake, and manage campaign webhooks.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRefresh}
          className="h-7 text-xs text-muted-foreground"
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8 space-y-8">

          {/* 1. CRM Connectors — primary integrations */}
          <CrmConnectorSection />

          {/* 2. Campaign Webhooks — compact searchable table */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Campaign Webhooks
              </h2>
              <span className="text-[10px] text-muted-foreground">
                {webhookConnections.length} webhook{webhookConnections.length !== 1 ? "s" : ""}
              </span>
            </div>

            {isLoading ? (
              <div className="space-y-1">
                {[1, 2, 3].map(i => <div key={i} className="h-10 rounded-lg bg-card border border-border animate-pulse" />)}
              </div>
            ) : webhookConnections.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center bg-card border border-border rounded-xl">
                <Webhook className="w-5 h-5 text-muted-foreground mb-2" />
                <p className="text-sm font-medium text-muted-foreground">No webhook connections</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Create a campaign to get a webhook URL for receiving leads automatically.
                </p>
              </div>
            ) : (
              <WebhookTable
                connections={webhookConnections}
                onRefresh={handleRefresh}
                newEventIds={newEventIds}
              />
            )}
          </section>

          {/* 3. Meta Lead Ads — only shown if connected */}
          {metaConnections.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Meta Lead Ads
              </h2>
              <div className="space-y-3">
                {metaConnections.map(c => (
                  <ConnectionCard key={`meta-${c.id}`} connection={c} onRefresh={handleRefresh} hasNewEvent={newEventIds.has(c.id)} />
                ))}
              </div>
            </section>
          )}

          {/* 4. Setup Recipes */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Setup Recipes
            </h2>
            <div className="space-y-3">
              <RecipeCard
                comingSoon
                icon={<Sheet className="w-4 h-4 text-emerald-400" />}
                title="Google Sheets"
                description="Forward new rows to your webhook via a Google Apps Script trigger"
              >
                <GoogleSheetsRecipe firstWebhookUrl={firstWebhookUrl} />
              </RecipeCard>
              <RecipeCard
                comingSoon
                icon={<Zap className="w-4 h-4 text-amber-400" />}
                title="Zapier & Make"
                description="Connect any app that supports Zapier or Make to your webhook"
              >
                <ZapierMakeRecipe firstWebhookUrl={firstWebhookUrl} />
              </RecipeCard>
              <RecipeCard
                comingSoon
                icon={<Globe className="w-4 h-4 text-blue-400" />}
                title="Generic Webhook"
                description="Any platform that can POST JSON — n8n, custom servers, CRMs"
                badge="Universal"
              >
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Send a POST request with a JSON body to your webhook URL. Include a{" "}
                    <code className="font-mono">phone</code> field (and optionally{" "}
                    <code className="font-mono">name</code>, <code className="font-mono">email</code>)
                    or configure custom field mappings using the "Listen" feature.
                  </p>
                  <div className="bg-muted rounded-lg p-3 font-mono text-[11px] text-muted-foreground space-y-0.5">
                    <p><span className="text-blue-400">POST</span> {firstWebhookUrl || "https://…/api/webhooks/lead/TOKEN"}</p>
                    <p><span className="text-violet-400">Content-Type</span>: application/json</p>
                    <p>{`{`}</p>
                    <p className="pl-4"><span className="text-amber-400">"phone"</span>: <span className="text-emerald-400">"+919876543210"</span>,</p>
                    <p className="pl-4"><span className="text-amber-400">"name"</span>: <span className="text-emerald-400">"Priya Sharma"</span>,</p>
                    <p className="pl-4"><span className="text-amber-400">"email"</span>: <span className="text-emerald-400">"priya@example.com"</span></p>
                    <p>{`}`}</p>
                  </div>
                  {firstWebhookUrl && <CopyButton text={firstWebhookUrl} label="Copy webhook URL" />}
                </div>
              </RecipeCard>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
