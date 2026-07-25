import { useState, useCallback, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import {
  Eye, Camera, Database, Link2, Code2, Zap, Settings, Plus, Trash2,
  Copy, Check, Play, Square, Wrench, Upload, Save, Loader2, ChevronDown,
  ChevronRight, X, ExternalLink, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { GEMINI_LIVE_VOICES, GEMINI_LIVE_LANGUAGES } from "@/lib/agent-providers";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const TOKEN_KEY = "voiceorch:session";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...getAuthHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

/* ── Types ─────────────────────────────────────────────────────────────────── */

type VisionMode = "photo_upload" | "live_snapshot" | "live_stream";
type ConnectionType = "rest_api" | "webhook" | "database";
type AuthType = "none" | "bearer" | "api_key" | "basic";
type FieldType = "text" | "number" | "boolean" | "date";

interface VisionAgent {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "draft";
  systemPrompt: string | null;
  voiceName: string | null;
  thinkingLevel: "minimal" | "low" | "medium" | "high";
  language: string;
  multilingual: boolean;
  defaultProvider: string | null;
  retentionDays: number;
  visionMode: VisionMode;
  allowWhatsApp: boolean;
  allowApiStaging: boolean;
  notifyOnMedia: boolean;
  tools: VisionTools;
  sessionCount: number;
  createdAt: string;
}

interface VisionTools {
  vision_describe: ToolConfig;
  vision_extract: ToolConfig & { outputSchema: SchemaField[]; saveToDatabase: boolean; databaseSchemaId: string | null };
  vision_verify: ToolConfig;
  vision_compare: ToolConfig;
}

interface ToolConfig {
  enabled: boolean;
  name: string;
  description: string;
  promptTemplate: string;
  providerOverride: string | null;
}

interface SchemaField {
  name: string;
  type: FieldType;
  description: string;
}

interface DbSchema {
  id: string;
  name: string;
  description: string | null;
  fields: DbSchemaField[];
  recordCount: number;
  createdAt: string;
}

interface DbSchemaField {
  name: string;
  type: FieldType;
  required: boolean;
  description: string;
}

interface DbRecord {
  id: string;
  data: Record<string, unknown>;
  createdAt: string;
}

interface Connection {
  id: string;
  name: string;
  type: ConnectionType;
  config: Record<string, unknown>;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestLatencyMs: number | null;
}

interface CodeSnippets {
  curl: string;
  javascript: string;
  python: string;
  webhook: string;
}

interface WebcallLink {
  id: string;
  token: string;
  requireCamera: boolean;
  createdAt: string;
}

const joinUrl = (token: string) => `${window.location.origin}/join/${token}`;

/* ── Query keys ────────────────────────────────────────────────────────────── */
const vaKey = (id: string) => ["vision-agents", id] as const;
const vaConnectionsKey = (id: string) => ["vision-agents", id, "connections"] as const;
const vaSchemasKey = (id: string) => ["vision-agents", id, "db", "schemas"] as const;
const vaSchemaRecordsKey = (id: string, schemaId: string) => ["vision-agents", id, "db", "schemas", schemaId, "records"] as const;
const vaCodeKey = (id: string) => ["vision-agents", id, "code-snippets"] as const;
const vaWebcallKey = (id: string) => ["agents", id, "webcall-links"] as const;

/* ── Tab definitions ───────────────────────────────────────────────────────── */
type TabId = "overview" | "vision" | "tools" | "database" | "connections" | "code" | "advanced";

interface TabDef { id: TabId; label: string; icon: React.ReactNode }

const TABS: TabDef[] = [
  { id: "overview",     label: "Overview",     icon: <Eye className="h-3.5 w-3.5" /> },
  { id: "vision",       label: "Vision",       icon: <Camera className="h-3.5 w-3.5" /> },
  { id: "tools",        label: "Tools",        icon: <Wrench className="h-3.5 w-3.5" /> },
  { id: "database",     label: "Database",     icon: <Database className="h-3.5 w-3.5" /> },
  { id: "connections",  label: "Connections",  icon: <Link2 className="h-3.5 w-3.5" /> },
  { id: "code",         label: "Code & Share", icon: <Code2 className="h-3.5 w-3.5" /> },
  { id: "advanced",     label: "Advanced",     icon: <Settings className="h-3.5 w-3.5" /> },
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "kn", label: "Kannada" },
  { value: "ml", label: "Malayalam" },
  { value: "bn", label: "Bengali" },
  { value: "gu", label: "Gujarati" },
  { value: "mr", label: "Marathi" },
  { value: "pa", label: "Punjabi" },
];

const PROVIDERS = [
  { value: "gemini", label: "Gemini (Google)" },
  { value: "openai", label: "OpenAI" },
  { value: "claude", label: "Claude (Anthropic)" },
];

/* ── Copy button ───────────────────────────────────────────────────────────── */
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      title={`Copy ${label ?? ""}`}
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {label && <span>{copied ? "Copied!" : label}</span>}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ── Tab: Overview ─────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────── */

function OverviewTab({ agent, onSave, saving }: {
  agent: VisionAgent;
  onSave: (patch: Partial<VisionAgent>) => void;
  saving: boolean;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: agent.name,
    description: agent.description ?? "",
    systemPrompt: agent.systemPrompt ?? "",
    voiceName: agent.voiceName ?? "",
    thinkingLevel: agent.thinkingLevel,
    language: agent.language,
    multilingual: agent.multilingual ?? false,
  });

  const set = <K extends keyof typeof form>(key: K, val: (typeof form)[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  /* ── Voice preview ─────────────────────────────────────────────── */
  type PreviewState = "idle" | "loading" | "playing";
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef  = useRef<string | null>(null);

  const stopPreview = () => {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
  };

  const handlePreviewVoice = async () => {
    if (previewState === "playing") { stopPreview(); setPreviewState("idle"); return; }
    stopPreview();
    setPreviewState("loading");
    try {
      const res = await fetch(`${BASE}/api/voices/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ provider: "google", voice: form.voiceName, language: form.language }),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => { stopPreview(); setPreviewState("idle"); };
      audio.onerror = () => { stopPreview(); setPreviewState("idle"); };
      await audio.play();
      setPreviewState("playing");
    } catch (err) {
      stopPreview();
      setPreviewState("idle");
      toast({ title: "Preview failed", description: String(err), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-1.5">
        <Label>Name</Label>
        <Input value={form.name} onChange={e => set("name", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Description</Label>
        <Textarea
          value={form.description}
          onChange={e => set("description", e.target.value)}
          rows={2}
          placeholder="Describe what this agent does…"
        />
      </div>
      <div className="space-y-1.5">
        <Label>System Prompt</Label>
        <Textarea
          value={form.systemPrompt}
          onChange={e => set("systemPrompt", e.target.value)}
          rows={6}
          placeholder="You are a vision AI assistant. Analyze the provided image and…"
          className="font-mono text-xs"
        />
      </div>

      {/* ── Voice + preview ── */}
      <div className="space-y-1.5">
        <Label>Voice (Gemini Live)</Label>
        <div className="flex items-center gap-2">
          <Select value={form.voiceName} onValueChange={v => set("voiceName", v)}>
            <SelectTrigger className="flex-1"><SelectValue placeholder="Select voice…" /></SelectTrigger>
            <SelectContent className="max-h-64">
              {GEMINI_LIVE_VOICES.map(v => (
                <SelectItem key={v.name} value={v.name}>
                  {v.name} — {v.style}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handlePreviewVoice}
            disabled={!form.voiceName || previewState === "loading"}
            className="h-9 gap-1.5 shrink-0 text-xs"
          >
            {previewState === "loading" ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Generating…</>
            ) : previewState === "playing" ? (
              <><Square className="h-3.5 w-3.5" />Stop</>
            ) : (
              <><Play className="h-3.5 w-3.5 fill-current" />Preview</>
            )}
          </Button>
        </div>
        {!form.voiceName && (
          <p className="text-[11px] text-muted-foreground">Select a voice to enable preview</p>
        )}
      </div>

      {/* ── Language + multilingual ── */}
      <div className="space-y-1.5">
        <Label>Primary Language</Label>
        <Select value={form.language} onValueChange={v => set("language", v)}>
          <SelectTrigger><SelectValue placeholder="Select language…" /></SelectTrigger>
          <SelectContent className="max-h-64">
            {GEMINI_LIVE_LANGUAGES.map(l => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 p-4">
        <div>
          <p className="text-sm font-medium">Multilingual</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Allow Gemini Live to follow the caller when they switch languages mid-call.
            The agent automatically detects and responds in Hindi, Tamil, Telugu, and other
            supported Indian languages without losing context.
          </p>
        </div>
        <Switch
          checked={form.multilingual}
          onCheckedChange={v => set("multilingual", v)}
          className="shrink-0 mt-0.5"
        />
      </div>

      {/* ── Thinking level ── */}
      <div className="space-y-2">
        <div>
          <Label>Thinking Level</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Higher thinking = deeper reasoning but slower responses. Use Minimal for fast visual tasks.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["minimal", "low", "medium", "high"] as const).map(level => (
            <button
              key={level}
              onClick={() => set("thinkingLevel", level)}
              className={cn(
                "px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-colors",
                form.thinkingLevel === level
                  ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
                  : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground",
              )}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <Button
        onClick={() => onSave({
          name: form.name,
          description: form.description || null,
          systemPrompt: form.systemPrompt || null,
          voiceName: form.voiceName || null,
          thinkingLevel: form.thinkingLevel,
          language: form.language,
          multilingual: form.multilingual,
        })}
        disabled={saving}
        className="gap-1.5"
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <Save className="h-3.5 w-3.5" />
        Save
      </Button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ── Tab: Vision ───────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────── */

const VISION_MODES: { id: VisionMode; label: string; description: string; icon: React.ReactNode }[] = [
  { id: "photo_upload",   label: "Photo Upload",   description: "Accept uploaded images from users or API",    icon: <Upload className="h-4 w-4" /> },
  { id: "live_snapshot",  label: "Live Snapshot",  description: "Capture a single frame from a live feed",     icon: <Camera className="h-4 w-4" /> },
  { id: "live_stream",    label: "Live Stream",    description: "Analyze a continuous real-time video stream",  icon: <Play className="h-4 w-4" /> },
];

function VisionTab({ agent, onSave, saving }: {
  agent: VisionAgent;
  onSave: (patch: Partial<VisionAgent>) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    visionMode: agent.visionMode,
    defaultProvider: agent.defaultProvider ?? "",
    retentionDays: agent.retentionDays,
    allowWhatsApp: agent.allowWhatsApp,
    allowApiStaging: agent.allowApiStaging,
    notifyOnMedia: agent.notifyOnMedia,
  });

  const set = <K extends keyof typeof form>(key: K, val: (typeof form)[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-3">
        <Label>Vision Mode</Label>
        <div className="grid grid-cols-1 gap-3">
          {VISION_MODES.map(m => (
            <button
              key={m.id}
              onClick={() => set("visionMode", m.id)}
              className={cn(
                "flex items-center gap-3 p-4 rounded-xl border text-left transition-colors",
                form.visionMode === m.id
                  ? "border-violet-500/50 bg-violet-500/10"
                  : "border-border hover:border-border/80 hover:bg-muted/30",
              )}
            >
              <div className={cn(
                "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                form.visionMode === m.id ? "bg-violet-500/20 text-violet-400" : "bg-muted/50 text-muted-foreground",
              )}>
                {m.icon}
              </div>
              <div>
                <p className={cn("text-sm font-medium", form.visionMode === m.id ? "text-foreground" : "text-foreground/80")}>{m.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>
              </div>
              {form.visionMode === m.id && <Check className="h-4 w-4 text-violet-400 ml-auto" />}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Default Provider</Label>
        <Select value={form.defaultProvider} onValueChange={v => set("defaultProvider", v)}>
          <SelectTrigger><SelectValue placeholder="Select provider…" /></SelectTrigger>
          <SelectContent>
            {PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Media Retention</Label>
          <span className="text-sm font-medium tabular-nums">{form.retentionDays} days</span>
        </div>
        <Slider
          value={[form.retentionDays]}
          onValueChange={([v]) => set("retentionDays", v ?? 7)}
          min={1}
          max={90}
          step={1}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">Uploaded media is deleted after this period.</p>
      </div>

      <div className="rounded-xl border border-border/60 p-4 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Permissions</p>
        {(
          [
            { key: "allowWhatsApp" as const,   label: "Allow WhatsApp",    description: "Accept images sent via WhatsApp" },
            { key: "allowApiStaging" as const,  label: "Allow API Staging", description: "Enable staging environment for API testing" },
            { key: "notifyOnMedia" as const,    label: "Notify on Media",   description: "Send notifications when media is received" },
          ] as const
        ).map(({ key, label, description }) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <Switch
              checked={form[key]}
              onCheckedChange={v => set(key, v)}
            />
          </div>
        ))}
      </div>

      <Button
        onClick={() => onSave({
          visionMode: form.visionMode,
          defaultProvider: form.defaultProvider || null,
          retentionDays: form.retentionDays,
          allowWhatsApp: form.allowWhatsApp,
          allowApiStaging: form.allowApiStaging,
          notifyOnMedia: form.notifyOnMedia,
        })}
        disabled={saving}
        className="gap-1.5"
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <Save className="h-3.5 w-3.5" />
        Save
      </Button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ── Tab: Tools ────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────── */

type ToolId = "vision_describe" | "vision_extract" | "vision_verify" | "vision_compare";

const TOOL_META: Record<ToolId, { label: string; description: string; icon: React.ReactNode }> = {
  vision_describe: { label: "Vision Describe", description: "Generate a natural-language description of an image",   icon: <Eye className="h-4 w-4" /> },
  vision_extract:  { label: "Vision Extract",  description: "Extract structured data from an image",                icon: <Database className="h-4 w-4" /> },
  vision_verify:   { label: "Vision Verify",   description: "Verify that an image meets specific criteria",          icon: <Check className="h-4 w-4" /> },
  vision_compare:  { label: "Vision Compare",  description: "Compare two images and report differences",             icon: <Zap className="h-4 w-4" /> },
};

function SchemaFieldEditor({
  fields,
  onChange,
}: {
  fields: SchemaField[];
  onChange: (fields: SchemaField[]) => void;
}) {
  const addField = () => onChange([...fields, { name: "", type: "text", description: "" }]);
  const removeField = (i: number) => onChange(fields.filter((_, idx) => idx !== i));
  const updateField = (i: number, key: keyof SchemaField, val: string) =>
    onChange(fields.map((f, idx) => idx === i ? { ...f, [key]: val } : f));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Output Schema Fields</span>
        <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={addField}>
          <Plus className="h-2.5 w-2.5 mr-1" /> Add Field
        </Button>
      </div>
      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No output fields defined yet.</p>
      )}
      {fields.map((f, i) => (
        <div key={i} className="grid grid-cols-[1fr_80px_1fr_20px] gap-1.5 items-center">
          <Input
            placeholder="field_name"
            value={f.name}
            onChange={e => updateField(i, "name", e.target.value)}
            className="h-7 text-xs"
          />
          <Select value={f.type} onValueChange={v => updateField(i, "type", v)}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["text", "number", "boolean", "date"] as const).map(t => (
                <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="description"
            value={f.description}
            onChange={e => updateField(i, "description", e.target.value)}
            className="h-7 text-xs"
          />
          <button onClick={() => removeField(i)} className="text-muted-foreground hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ToolCard({
  toolId,
  config,
  visionMode,
  extractExtras,
  onChange,
  onExtractExtrasChange,
}: {
  toolId: ToolId;
  config: ToolConfig;
  visionMode: VisionMode;
  extractExtras?: { outputSchema: SchemaField[]; saveToDatabase: boolean; databaseSchemaId: string | null };
  onChange: (patch: Partial<ToolConfig>) => void;
  onExtractExtrasChange?: (patch: { outputSchema?: SchemaField[]; saveToDatabase?: boolean; databaseSchemaId?: string | null }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = TOOL_META[toolId];

  return (
    <div className={cn(
      "rounded-xl border transition-colors",
      config.enabled ? "border-violet-500/30 bg-violet-500/5" : "border-border/60 bg-card/30",
    )}>
      <div className="flex items-center gap-3 p-4">
        <div className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
          config.enabled ? "bg-violet-500/20 text-violet-400" : "bg-muted/50 text-muted-foreground",
        )}>
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{config.name || meta.label}</p>
          <p className="text-xs text-muted-foreground truncate">{meta.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={config.enabled} onCheckedChange={v => onChange({ enabled: v })} />
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/30 pt-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Display Name</Label>
            <Input value={config.name} onChange={e => onChange({ name: e.target.value })} className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Input value={config.description} onChange={e => onChange({ description: e.target.value })} className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Prompt Template</Label>
            <Textarea
              value={config.promptTemplate}
              onChange={e => onChange({ promptTemplate: e.target.value })}
              rows={4}
              className="text-xs font-mono"
              placeholder="Analyze this image and {{instruction}}…"
            />
          </div>
          {visionMode !== "live_stream" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Provider Override</Label>
              <Select
                value={config.providerOverride ?? "__none__"}
                onValueChange={v => onChange({ providerOverride: v === "__none__" ? null : v })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Use default provider" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">Use default provider</SelectItem>
                  {PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {visionMode === "live_stream" && (
            <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
              Provider is locked to Gemini Live — vision runs natively in the live session.
            </p>
          )}

          {/* Extract-specific extras */}
          {toolId === "vision_extract" && extractExtras && onExtractExtrasChange && (
            <>
              <SchemaFieldEditor
                fields={extractExtras.outputSchema}
                onChange={fields => onExtractExtrasChange({ outputSchema: fields })}
              />
              <div className="flex items-center justify-between pt-1">
                <div>
                  <p className="text-xs font-medium">Save to Database</p>
                  <p className="text-[10px] text-muted-foreground">Auto-save extracted records</p>
                </div>
                <Switch
                  checked={extractExtras.saveToDatabase}
                  onCheckedChange={v => onExtractExtrasChange({ saveToDatabase: v })}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const DEFAULT_TOOL_CONFIG: ToolConfig = {
  enabled: false,
  name: "",
  description: "",
  promptTemplate: "",
  providerOverride: null,
};

const DEFAULT_TOOLS: VisionTools = {
  vision_describe: { ...DEFAULT_TOOL_CONFIG },
  vision_extract:  { ...DEFAULT_TOOL_CONFIG, outputSchema: [], saveToDatabase: false, databaseSchemaId: null },
  vision_verify:   { ...DEFAULT_TOOL_CONFIG },
  vision_compare:  { ...DEFAULT_TOOL_CONFIG },
};

function mergeTools(raw: unknown): VisionTools {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    vision_describe: { ...DEFAULT_TOOLS.vision_describe, ...(src["vision_describe"] as object | undefined ?? {}) },
    vision_extract:  { ...DEFAULT_TOOLS.vision_extract,  ...(src["vision_extract"]  as object | undefined ?? {}) },
    vision_verify:   { ...DEFAULT_TOOLS.vision_verify,   ...(src["vision_verify"]   as object | undefined ?? {}) },
    vision_compare:  { ...DEFAULT_TOOLS.vision_compare,  ...(src["vision_compare"]  as object | undefined ?? {}) },
  };
}

function ToolsTab({ agent, onSave, saving }: {
  agent: VisionAgent;
  onSave: (patch: Partial<VisionAgent>) => void;
  saving: boolean;
}) {
  const [tools, setTools] = useState<VisionTools>(() => mergeTools(agent.tools));

  const updateTool = (toolId: ToolId, patch: Partial<ToolConfig>) =>
    setTools(t => ({ ...t, [toolId]: { ...t[toolId], ...patch } }));

  const updateExtractExtras = (patch: { outputSchema?: SchemaField[]; saveToDatabase?: boolean; databaseSchemaId?: string | null }) =>
    setTools(t => ({ ...t, vision_extract: { ...t.vision_extract, ...patch } }));

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Enable and configure the vision tool primitives available to this agent.
      </p>
      {(["vision_describe", "vision_extract", "vision_verify", "vision_compare"] as ToolId[]).map(toolId => (
        <ToolCard
          key={toolId}
          toolId={toolId}
          config={tools[toolId]}
          visionMode={agent.visionMode}
          extractExtras={toolId === "vision_extract" ? tools.vision_extract : undefined}
          onChange={patch => updateTool(toolId, patch)}
          onExtractExtrasChange={toolId === "vision_extract" ? updateExtractExtras : undefined}
        />
      ))}
      <Button onClick={() => onSave({ tools })} disabled={saving} className="gap-1.5">
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <Save className="h-3.5 w-3.5" />
        Save Tools
      </Button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ── Tab: Database ─────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────── */

function RecordsTable({ agentId, schemaId }: { agentId: string; schemaId: string }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const { data: recordsData, isLoading } = useQuery({
    queryKey: vaSchemaRecordsKey(agentId, schemaId),
    queryFn: () => apiFetch<{ records: DbRecord[]; total: number }>(
      `${BASE}/api/vision-agents/${agentId}/db/schemas/${schemaId}/records`,
    ),
  });

  const records = recordsData?.records ?? [];
  const filtered = records.filter(r =>
    Object.values(r.data).some(v => String(v).toLowerCase().includes(search.toLowerCase())),
  );
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const handleExport = async () => {
    try {
      const res = await fetch(`${BASE}/api/vision-agents/${agentId}/db/schemas/${schemaId}/export`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `schema-${schemaId}-records.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    }
  };

  if (isLoading) return <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search records…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="h-8 text-xs flex-1"
        />
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => void handleExport()}>
          <ExternalLink className="h-3 w-3" /> Export CSV
        </Button>
      </div>
      {paginated.length === 0 ? (
        <p className="text-center py-8 text-sm text-muted-foreground">No records found.</p>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">ID</TableHead>
                {Object.keys(paginated[0]?.data ?? {}).map(k => (
                  <TableHead key={k} className="text-xs">{k}</TableHead>
                ))}
                <TableHead className="text-xs">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-[11px] font-mono text-muted-foreground">{r.id.slice(0, 8)}…</TableCell>
                  {Object.values(r.data).map((v, i) => (
                    <TableCell key={i} className="text-xs max-w-[160px] truncate">{String(v)}</TableCell>
                  ))}
                  <TableCell className="text-[11px] text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-6 text-xs px-2" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
            <Button variant="outline" size="sm" className="h-6 text-xs px-2" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateSchemaModal({ agentId, open, onClose }: { agentId: string; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<DbSchemaField[]>([]);

  const mutation = useMutation({
    mutationFn: () => apiFetch(`${BASE}/api/vision-agents/${agentId}/db/schemas`, {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null, fields }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vaSchemasKey(agentId) });
      toast({ title: "Schema created" });
      onClose();
      setName(""); setDescription(""); setFields([]);
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const addField = () => setFields(f => [...f, { name: "", type: "text", required: false, description: "" }]);
  const removeField = (i: number) => setFields(f => f.filter((_, idx) => idx !== i));
  const updateField = <K extends keyof DbSchemaField>(i: number, key: K, val: DbSchemaField[K]) =>
    setFields(f => f.map((field, idx) => idx === i ? { ...field, [key]: val } : field));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Schema</DialogTitle>
          <DialogDescription>Define a data schema for storing extracted records.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="product_data" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Fields</Label>
              <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={addField}>
                <Plus className="h-3 w-3 mr-1" /> Add Field
              </Button>
            </div>
            {fields.map((f, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_auto_24px] gap-1.5 items-center">
                <Input placeholder="name" value={f.name} onChange={e => updateField(i, "name", e.target.value)} className="h-7 text-xs" />
                <Select value={f.type} onValueChange={v => updateField(i, "type", v as FieldType)}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["text", "number", "boolean", "date"] as const).map(t => (
                      <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                  <Switch checked={f.required} onCheckedChange={v => updateField(i, "required", v)} className="scale-75 origin-left" />
                  <span className="text-[10px] text-muted-foreground">req</span>
                </div>
                <button onClick={() => removeField(i)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!name.trim() || mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Create Schema
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DatabaseTab({ agentId }: { agentId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: schemas = [], isLoading } = useQuery({
    queryKey: vaSchemasKey(agentId),
    queryFn: () => apiFetch<DbSchema[]>(`${BASE}/api/vision-agents/${agentId}/db/schemas`),
  });

  const deleteSchema = useMutation({
    mutationFn: (schemaId: string) => apiFetch(`${BASE}/api/vision-agents/${agentId}/db/schemas/${schemaId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vaSchemasKey(agentId) });
      setSelectedSchemaId(null);
      toast({ title: "Schema deleted" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const selectedSchema = schemas.find(s => s.id === selectedSchemaId);

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Schema list */}
      <div className="w-56 shrink-0 flex flex-col gap-2">
        <Button size="sm" className="gap-1.5 text-xs h-8 w-full" onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> New Schema
        </Button>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
          </div>
        ) : schemas.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No schemas yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {schemas.map(s => (
              <div
                key={s.id}
                onClick={() => setSelectedSchemaId(s.id)}
                className={cn(
                  "flex items-center justify-between gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors group",
                  selectedSchemaId === s.id
                    ? "border-violet-500/40 bg-violet-500/10"
                    : "border-border/50 hover:border-border hover:bg-muted/30",
                )}
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{s.name}</p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">{s.recordCount} records</p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); deleteSchema.mutate(s.id); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Schema detail */}
      <div className="flex-1 min-w-0">
        {!selectedSchema ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            Select a schema to view records
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-sm">{selectedSchema.name}</h3>
              {selectedSchema.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{selectedSchema.description}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedSchema.fields.map(f => (
                <span
                  key={f.name}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/60 bg-muted/30 text-[10px] font-mono"
                >
                  {f.name}
                  <span className="text-muted-foreground">:{f.type}</span>
                  {f.required && <span className="text-red-400">*</span>}
                </span>
              ))}
            </div>
            <RecordsTable agentId={agentId} schemaId={selectedSchema.id} />
          </div>
        )}
      </div>

      <CreateSchemaModal agentId={agentId} open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ── Tab: Connections ──────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────── */

function ConnectionCard({
  conn,
  agentId,
  onDelete,
}: {
  conn: Connection;
  agentId: string;
  onDelete: () => void;
}) {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latency?: number; error?: string } | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<{ ok: boolean; latencyMs?: number; error?: string }>(
        `${BASE}/api/vision-agents/${agentId}/connections/${conn.id}/test`,
        { method: "POST" },
      );
      setTestResult({ ok: result.ok, latency: result.latencyMs, error: result.error });
    } catch (err) {
      setTestResult({ ok: false, error: String(err) });
    } finally {
      setTesting(false);
    }
  };

  const typeLabel: Record<ConnectionType, string> = {
    rest_api: "REST API",
    webhook: "Webhook",
    database: "Database",
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-muted/50 border border-border/50 flex items-center justify-center shrink-0">
            <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{conn.name}</p>
            <p className="text-xs text-muted-foreground">{typeLabel[conn.type]}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {testResult && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                testResult.ok
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20",
              )}
            >
              {testResult.ok ? `${testResult.latency ?? ""}ms` : "Failed"}
            </Badge>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2 gap-1" onClick={() => void handleTest()} disabled={testing}>
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Test
          </Button>
          <button onClick={onDelete} className="text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {testResult?.error && (
        <p className="text-[11px] text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{testResult.error}</p>
      )}
    </div>
  );
}

interface HeaderPair { key: string; value: string }

function CreateConnectionModal({
  agentId,
  open,
  onClose,
}: {
  agentId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<ConnectionType>("rest_api");

  // REST API
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("POST");
  const [headers, setHeaders] = useState<HeaderPair[]>([]);
  const [authType, setAuthType] = useState<AuthType>("none");
  const [authValue, setAuthValue] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [responseMapping, setResponseMapping] = useState("");

  // Webhook
  const [whUrl, setWhUrl] = useState("");
  const [whBodyTemplate, setWhBodyTemplate] = useState("");
  const [signingSecret, setSigningSecret] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      const config = type === "rest_api"
        ? { url, method, headers, authType, authValue, bodyTemplate, responseMapping }
        : type === "webhook"
        ? { url: whUrl, bodyTemplate: whBodyTemplate, signingSecret }
        : {};
      return apiFetch(`${BASE}/api/vision-agents/${agentId}/connections`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), type, config }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vaConnectionsKey(agentId) });
      toast({ title: "Connection created" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const addHeader = () => setHeaders(h => [...h, { key: "", value: "" }]);
  const removeHeader = (i: number) => setHeaders(h => h.filter((_, idx) => idx !== i));
  const updateHeader = (i: number, k: "key" | "value", v: string) =>
    setHeaders(h => h.map((pair, idx) => idx === i ? { ...pair, [k]: v } : pair));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Connection</DialogTitle>
          <DialogDescription>Connect this agent to an external API or service.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="My API Connection" />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={v => setType(v as ConnectionType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rest_api">REST API</SelectItem>
                <SelectItem value="webhook">Webhook</SelectItem>
                <SelectItem value="database">Database</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === "rest_api" && (
            <>
              <div className="grid grid-cols-[1fr_80px] gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">URL</Label>
                  <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com/v1" className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Method</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["GET", "POST", "PUT", "PATCH", "DELETE"].map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Headers</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={addHeader}>
                    <Plus className="h-2.5 w-2.5 mr-1" /> Add
                  </Button>
                </div>
                {headers.map((h, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_20px] gap-1.5 items-center">
                    <Input placeholder="key" value={h.key} onChange={e => updateHeader(i, "key", e.target.value)} className="h-7 text-xs" />
                    <Input placeholder="value" value={h.value} onChange={e => updateHeader(i, "value", e.target.value)} className="h-7 text-xs" />
                    <button onClick={() => removeHeader(i)} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Auth Type</Label>
                  <Select value={authType} onValueChange={v => setAuthType(v as AuthType)}>
                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["none", "bearer", "api_key", "basic"] as const).map(a => <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {authType !== "none" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Auth Value</Label>
                    <Input value={authValue} onChange={e => setAuthValue(e.target.value)} placeholder="token / key" className="text-xs" />
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Body Template</Label>
                <Textarea value={bodyTemplate} onChange={e => setBodyTemplate(e.target.value)} rows={3} className="text-xs font-mono" placeholder={'{"result": "{{vision_result}}"}'} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Response Mapping</Label>
                <Input value={responseMapping} onChange={e => setResponseMapping(e.target.value)} placeholder="data.result" className="text-xs" />
              </div>
            </>
          )}

          {type === "webhook" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Webhook URL</Label>
                <Input value={whUrl} onChange={e => setWhUrl(e.target.value)} placeholder="https://hooks.example.com/…" className="text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Body Template</Label>
                <Textarea value={whBodyTemplate} onChange={e => setWhBodyTemplate(e.target.value)} rows={3} className="text-xs font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Signing Secret</Label>
                <Input type="password" value={signingSecret} onChange={e => setSigningSecret(e.target.value)} placeholder="hmac_secret" className="text-xs" />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!name.trim() || mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionsTab({ agentId }: { agentId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: connections = [], isLoading } = useQuery({
    queryKey: vaConnectionsKey(agentId),
    queryFn: () => apiFetch<Connection[]>(`${BASE}/api/vision-agents/${agentId}/connections`),
  });

  const deleteConn = useMutation({
    mutationFn: (connId: string) => apiFetch(`${BASE}/api/vision-agents/${agentId}/connections/${connId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vaConnectionsKey(agentId) });
      toast({ title: "Connection deleted" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Connect this agent to external APIs, webhooks, and databases.</p>
        <Button size="sm" className="gap-1.5 text-xs h-8" onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> Add Connection
        </Button>
      </div>
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : connections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 py-12 text-center space-y-2">
          <Link2 className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No connections yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {connections.map(conn => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              agentId={agentId}
              onDelete={() => deleteConn.mutate(conn.id)}
            />
          ))}
        </div>
      )}
      <CreateConnectionModal agentId={agentId} open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ── Tab: Code & Share ─────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────── */

type SnippetTab = "curl" | "javascript" | "python" | "webhook";

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-lg border border-border/60 bg-muted/30 overflow-hidden">
      <div className="absolute top-2 right-2">
        <button
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-background/80 border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="p-4 pt-10 overflow-x-auto text-xs leading-relaxed font-mono text-foreground/80 whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function CodeShareTab({ agentId }: { agentId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeSnippet, setActiveSnippet] = useState<SnippetTab>("curl");
  const [showApiKey, setShowApiKey] = useState(false);

  const apiKey = localStorage.getItem(TOKEN_KEY) ?? "";
  const maskedKey = apiKey ? `${apiKey.slice(0, 8)}${"•".repeat(20)}` : "No API key found";

  const { data: snippets, isLoading: snippetsLoading } = useQuery({
    queryKey: vaCodeKey(agentId),
    queryFn: () => apiFetch<CodeSnippets>(`${BASE}/api/vision-agents/${agentId}/code-snippets`),
  });

  const { data: links = [], isLoading: linksLoading } = useQuery({
    queryKey: vaWebcallKey(agentId),
    queryFn: () => apiFetch<WebcallLink[]>(`${BASE}/api/agents/${agentId}/webcall-links`),
  });

  const createLink = useMutation({
    mutationFn: (requireCamera: boolean) => apiFetch<WebcallLink>(
      `${BASE}/api/agents/${agentId}/webcall-links`,
      { method: "POST", body: JSON.stringify({ requireCamera }) },
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vaWebcallKey(agentId) });
      toast({ title: "Link created" });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const SNIPPET_TABS: { id: SnippetTab; label: string }[] = [
    { id: "curl", label: "cURL" },
    { id: "javascript", label: "JavaScript" },
    { id: "python", label: "Python" },
    { id: "webhook", label: "Webhook" },
  ];

  const currentSnippet = snippets ? snippets[activeSnippet] : null;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* API Key */}
      <div className="rounded-xl border border-border/60 bg-card/50 p-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">API Key</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono bg-muted/50 px-3 py-2 rounded-lg border border-border/40 truncate">
            {showApiKey ? apiKey : maskedKey}
          </code>
          <button
            onClick={() => setShowApiKey(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md border border-border/40 hover:border-border"
          >
            {showApiKey ? "Hide" : "Show"}
          </button>
          <CopyButton text={apiKey} label="Copy" />
        </div>
      </div>

      {/* Shareable links */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Shareable Webcall Links</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => createLink.mutate(false)} disabled={createLink.isPending}>
              <Plus className="h-3 w-3" /> Link
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => createLink.mutate(true)} disabled={createLink.isPending}>
              <Camera className="h-3 w-3" /> + Camera
            </Button>
          </div>
        </div>
        {linksLoading ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : links.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No links yet. Create one above.</p>
        ) : (
          <div className="space-y-2">
            {links.map(link => (
              <div key={link.id} className="flex items-center gap-2 p-3 rounded-lg border border-border/60 bg-card/30">
                <div className="flex-1 min-w-0">
                  <code className="text-xs font-mono text-muted-foreground truncate block">{joinUrl(link.token)}</code>
                  <div className="flex items-center gap-2 mt-0.5">
                    {link.requireCamera && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 gap-0.5 border-violet-500/30 text-violet-400">
                        <Camera className="h-2.5 w-2.5" /> Camera required
                      </Badge>
                    )}
                  </div>
                </div>
                <CopyButton text={joinUrl(link.token)} />
                <a href={joinUrl(link.token)} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Code snippets */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Code Snippets</p>
        <div className="flex gap-1 border-b border-border/40">
          {SNIPPET_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveSnippet(t.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                activeSnippet === t.id
                  ? "border-violet-500 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {snippetsLoading ? (
          <Skeleton className="h-48 w-full rounded-lg" />
        ) : currentSnippet ? (
          <CodeBlock code={currentSnippet} />
        ) : (
          <p className="text-xs text-muted-foreground py-4 text-center">Snippets not available.</p>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ── Tab: Advanced ─────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────── */

function AdvancedTab({
  agent,
  onSave,
  saving,
  onDelete,
}: {
  agent: VisionAgent;
  onSave: (patch: Partial<VisionAgent>) => void;
  saving: boolean;
  onDelete: () => void;
}) {
  const [retentionDays, setRetentionDays] = useState(agent.retentionDays);
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Media Retention (days)</Label>
          <span className="text-sm font-medium tabular-nums">{retentionDays} days</span>
        </div>
        <Slider
          value={[retentionDays]}
          onValueChange={([v]) => setRetentionDays(v ?? 7)}
          min={1}
          max={365}
          step={1}
          className="w-full"
        />
      </div>
      <Button onClick={() => onSave({ retentionDays })} disabled={saving} className="gap-1.5">
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <Save className="h-3.5 w-3.5" />
        Save
      </Button>

      {/* Danger Zone */}
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-3">
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="h-4 w-4" />
          <p className="text-sm font-semibold">Danger Zone</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Permanently delete this vision agent and all associated data. This action cannot be undone.
        </p>
        <Button
          variant="destructive"
          size="sm"
          className="gap-1.5"
          onClick={() => setShowDelete(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete Agent
        </Button>
      </div>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Vision Agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{agent.name}</strong> and all its data, connections, and records.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ── Main Builder ──────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────── */

export default function VisionAgentBuilder() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const agentId = params.id;

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [editingName, setEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const { data: agent, isLoading, error } = useQuery({
    queryKey: vaKey(agentId),
    queryFn: () => apiFetch<VisionAgent>(`${BASE}/api/vision-agents/${agentId}`),
    enabled: !!agentId,
  });

  const updateMutation = useMutation({
    mutationFn: (patch: Partial<VisionAgent>) => apiFetch<VisionAgent>(
      `${BASE}/api/vision-agents/${agentId}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),
    onSuccess: (updated) => {
      queryClient.setQueryData(vaKey(agentId), updated);
      void queryClient.invalidateQueries({ queryKey: ["vision-agents"] });
      toast({ title: "Saved", description: "Agent updated successfully." });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`${BASE}/api/vision-agents/${agentId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vision-agents"] });
      toast({ title: "Agent deleted" });
      navigate("/app/vision-agents");
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const handleSave = useCallback((patch: Partial<VisionAgent>) => updateMutation.mutate(patch), [updateMutation]);
  const handleDelete = useCallback(() => deleteMutation.mutate(), [deleteMutation]);

  const toggleStatus = () => {
    if (!agent) return;
    updateMutation.mutate({ status: agent.status === "active" ? "draft" : "active" });
  };

  if (isLoading) {
    return (
      <div className="flex h-full overflow-hidden">
        {/* Left sidebar skeleton */}
        <div className="w-48 shrink-0 border-r border-border/60 p-3 space-y-1">
          {TABS.map(t => <Skeleton key={t.id} className="h-8 w-full rounded-lg" />)}
        </div>
        <div className="flex-1 p-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-32 w-full max-w-2xl" />
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex items-center justify-center h-full text-center p-8 space-y-4 flex-col">
        <AlertTriangle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-muted-foreground">Failed to load vision agent.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/app/vision-agents")}>
          Back to Vision Agents
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar */}
      <aside className="w-48 shrink-0 flex flex-col border-r border-border/60 bg-sidebar/40">
        {/* Agent name header */}
        <div className="p-3 border-b border-border/40 space-y-2">
          {editingName ? (
            <Input
              ref={nameInputRef}
              defaultValue={agent.name}
              className="h-7 text-xs font-semibold"
              onBlur={e => {
                const trimmed = e.target.value.trim();
                if (trimmed && trimmed !== agent.name) {
                  updateMutation.mutate({ name: trimmed });
                }
                setEditingName(false);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingName(false);
              }}
              autoFocus
            />
          ) : (
            <button
              className="text-xs font-semibold text-left w-full truncate hover:text-muted-foreground transition-colors"
              onClick={() => setEditingName(true)}
              title="Click to rename"
            >
              {agent.name}
            </button>
          )}
          <div className="flex items-center gap-2">
            <button onClick={toggleStatus} className="flex-1">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] w-full justify-center cursor-pointer hover:opacity-80 transition-opacity",
                  agent.status === "active"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
                )}
              >
                {agent.status}
              </Badge>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-xs transition-colors text-left",
                activeTab === tab.id
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Save button */}
        <div className="p-2 border-t border-border/40">
          <Button
            size="sm"
            className="w-full gap-1.5 text-xs h-8"
            onClick={() => {
              if (activeTab === "overview") return;
              updateMutation.mutate({});
            }}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save
          </Button>
        </div>
      </aside>

      {/* Content panel */}
      <main className="flex-1 overflow-y-auto p-6 min-w-0">
        {activeTab === "overview" && (
          <OverviewTab agent={agent} onSave={handleSave} saving={updateMutation.isPending} />
        )}
        {activeTab === "vision" && (
          <VisionTab agent={agent} onSave={handleSave} saving={updateMutation.isPending} />
        )}
        {activeTab === "tools" && (
          <ToolsTab agent={agent} onSave={handleSave} saving={updateMutation.isPending} />
        )}
        {activeTab === "database" && (
          <DatabaseTab agentId={agentId} />
        )}
        {activeTab === "connections" && (
          <ConnectionsTab agentId={agentId} />
        )}
        {activeTab === "code" && (
          <CodeShareTab agentId={agentId} />
        )}
        {activeTab === "advanced" && (
          <AdvancedTab
            agent={agent}
            onSave={handleSave}
            saving={updateMutation.isPending}
            onDelete={handleDelete}
          />
        )}
      </main>
    </div>
  );
}
