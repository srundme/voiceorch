import React, { useEffect, useState, useMemo, useRef } from "react";
import { diffWords, diffWordsWithSpace } from "diff";
import { useLocation, useParams } from "wouter";
import {
  Bot, Plus, Search, Phone, Mic, Brain, Zap, Webhook, PhoneForwarded,
  Save, MoreHorizontal, Power, Trash2, Settings, FileText, Wrench,
  VoicemailIcon, SlidersHorizontal, TestTube2, ChevronRight,
  Volume2, Check, X, Pencil, ChevronDown, List, Globe, BarChart3,
  User2, Sparkles, BookOpen, ToggleLeft, ToggleRight, Tag, Loader2, Square,
  Play, Pause,
  Timer, ShieldCheck, Layers, Gauge, MicOff, HelpCircle, PhoneOff,
  History, GitBranch, Eye, RotateCcw, ChevronUp, AlertTriangle, ArrowLeftRight,
  Upload, Archive, Info, AlertCircle,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import {
  useListAgents, useGetAgent, useUpdateAgent, useToggleAgent, useDeleteAgent,
  useCreateAgent, useInitiateOutboundCall, getListAgentsQueryKey, getGetAgentQueryKey,
  useListCalls, getListCallsQueryKey, useListCalendars, customFetch,
  useListKnowledgeSources, useRunToolTest, useListAmbientSounds, useListEventTypes,
  useListAgentVersions, usePublishAgentVersion, useGetAgentVersion, useRestoreAgentVersion,
  useArchiveAgentVersion,
  getListAgentVersionsQueryKey, getGetAgentVersionQueryKey,
} from "@workspace/api-client-react";
import type { AgentVersion } from "@workspace/api-client-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { agentFormSchema } from "./edit.schema";
import { buildUpdateAgentPayload, StagedPromptEditor } from "./edit";
import type { AgentFormValues } from "./edit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { formatApiError, mapApiErrors, isDestinationUnverifiedError } from "@/lib/format-api-error";
import {
  ASR_PROVIDERS, LLM_PROVIDERS, TTS_PROVIDERS,
  LANGUAGES, ASR_MODELS, LLM_MODELS, TTS_MODELS, TTS_VOICES, AGENT_TIMEZONES,
} from "@/lib/agent-providers";
import { useMinuteRatesMap, useUserProviderNames, computeAgentRateCents } from "@/hooks/use-minute-rates";
import { DestinationOtpDialog } from "@/components/destination-otp-dialog";
import { WebCallPanel } from "@/components/webcall-panel";
import { SimulationTab } from "./builder/SimulationTab";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API   = `${_DASH_BASE}/api`;

/* ── Types ──────────────────────────────────────────────────────────────────── */

type TabId = "overview" | "prompt" | "voice" | "tools" | "analysis" | "voicemail" | "advanced" | "logs" | "versions" | "simulation";

interface TabDef { id: TabId; label: string; icon: React.ReactNode }

const TABS: TabDef[] = [
  { id: "overview",    label: "Overview",    icon: <Bot className="h-3.5 w-3.5" /> },
  { id: "prompt",      label: "Prompt",      icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "voice",       label: "Voice",       icon: <Mic className="h-3.5 w-3.5" /> },
  { id: "tools",       label: "Tools",       icon: <Wrench className="h-3.5 w-3.5" /> },
  { id: "analysis",    label: "Analysis",    icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: "voicemail",   label: "Voicemail",   icon: <VoicemailIcon className="h-3.5 w-3.5" /> },
  { id: "advanced",    label: "Advanced",    icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
  { id: "logs",        label: "Logs",        icon: <List className="h-3.5 w-3.5" /> },
  { id: "versions",    label: "Versions",    icon: <History className="h-3.5 w-3.5" /> },
  { id: "simulation",  label: "Simulation",  icon: <TestTube2 className="h-3.5 w-3.5" /> },
];

/* ── Small helpers ──────────────────────────────────────────────────────────── */

function SmallSelect({ value, onChange, options, placeholder }: {
  value: string | undefined;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs bg-background/50">
        <SelectValue placeholder={placeholder ?? "Select…"} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-[280px] overflow-y-auto">
        {options.filter(o => o.value !== "").map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function OverviewCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-4 space-y-3">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {icon}{title}
      </div>
      {children}
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-border/40" />
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="h-px flex-1 bg-border/40" />
    </div>
  );
}

/* ── Agent Knowledge multi-select ───────────────────────────────────────────── */

const KB_TYPE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  faq:     { label: "FAQ",     icon: <List className="w-3 h-3" />,     color: "bg-violet-500/15 text-violet-400 border-violet-500/20" },
  text:    { label: "Text",    icon: <FileText className="w-3 h-3" />, color: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  website: { label: "Website", icon: <Globe className="w-3 h-3" />,    color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
  file:    { label: "File",    icon: <FileText className="w-3 h-3" />, color: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
};

function KnowledgeSourceMultiSelect({ value, onChange }: {
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: sources, isLoading } = useListKnowledgeSources();
  const list = sources ?? [];
  const selected = useMemo(() => list.filter((s) => value.includes(s.id)), [list, value]);

  const toggle = (id: number) => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between rounded-lg border border-border/60 bg-card/30 px-4 py-3 text-sm text-muted-foreground hover:border-border hover:text-foreground transition-colors"
          >
            <span>
              {value.length === 0
                ? "Select knowledge sources"
                : `${value.length} source${value.length === 1 ? "" : "s"} attached`}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search knowledge sources…" />
            <CommandList>
              {isLoading ? (
                <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>
              ) : list.length === 0 ? (
                <CommandEmpty>No knowledge sources yet. Create one in Agent Knowledge.</CommandEmpty>
              ) : (
                <>
                  <CommandEmpty>No matches.</CommandEmpty>
                  <CommandGroup>
                    {list.map((s) => {
                      const meta = KB_TYPE_META[s.type] ?? KB_TYPE_META["text"]!;
                      const checked = value.includes(s.id);
                      return (
                        <CommandItem
                          key={s.id}
                          value={`${s.name} ${meta.label}`}
                          onSelect={() => toggle(s.id)}
                          className="flex items-center gap-2"
                        >
                          <div className={cn(
                            "flex h-4 w-4 items-center justify-center rounded border",
                            checked ? "bg-primary border-primary text-primary-foreground" : "border-border",
                          )}>
                            {checked && <Check className="h-3 w-3" />}
                          </div>
                          <span className="flex-1 truncate">{s.name}</span>
                          <Badge variant="outline" className={cn("gap-1 text-[10px] py-0", meta.color)}>
                            {meta.icon}{meta.label}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground tabular-nums">{s.entryCount}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((s) => {
            const meta = KB_TYPE_META[s.type] ?? KB_TYPE_META["text"]!;
            return (
              <Badge key={s.id} variant="outline" className={cn("gap-1 pr-1", meta.color)}>
                {meta.icon}
                <span className="truncate max-w-[140px]">{s.name}</span>
                <button
                  type="button"
                  onClick={() => toggle(s.id)}
                  className="ml-0.5 rounded-sm hover:bg-background/40 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Webhook param editor (for Tools tab) ───────────────────────────────────── */

function WebhookParamsEditor({ control, toolIndex }: { control: any; toolIndex: number }) {
  const { fields, append, remove } = useFieldArray({ control, name: `tools.${toolIndex}.parameters` as any });
  return (
    <div className="space-y-2 mt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Parameters</span>
        <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-2"
          onClick={() => append({ paramName: "", dataType: "string", paramDescription: "", required: false })}>
          <Plus className="h-2.5 w-2.5 mr-1" /> Add
        </Button>
      </div>
      {fields.length === 0 && <p className="text-[10px] text-muted-foreground italic">No parameters defined — LLM will pass a reason string.</p>}
      {fields.map((param, pIdx) => (
        <div key={param.id} className="grid grid-cols-[1fr_80px_1fr_50px_20px] gap-1.5 items-center">
          <FormField control={control} name={`tools.${toolIndex}.parameters.${pIdx}.paramName` as any} render={({ field: f }) => (
            <FormItem className="space-y-0"><FormControl><Input placeholder="name" className="h-6 text-[10px]" {...f} /></FormControl></FormItem>
          )} />
          <FormField control={control} name={`tools.${toolIndex}.parameters.${pIdx}.dataType` as any} render={({ field: f }) => (
            <FormItem className="space-y-0">
              <Select value={f.value ?? "string"} onValueChange={f.onChange}>
                <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="string" className="text-[10px]">string</SelectItem>
                  <SelectItem value="number" className="text-[10px]">number</SelectItem>
                  <SelectItem value="boolean" className="text-[10px]">boolean</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )} />
          <FormField control={control} name={`tools.${toolIndex}.parameters.${pIdx}.paramDescription` as any} render={({ field: f }) => (
            <FormItem className="space-y-0"><FormControl><Input placeholder="description" className="h-6 text-[10px]" {...f} /></FormControl></FormItem>
          )} />
          <FormField control={control} name={`tools.${toolIndex}.parameters.${pIdx}.required` as any} render={({ field: f }) => (
            <FormItem className="space-y-0 flex items-center gap-1">
              <FormControl><Switch checked={!!f.value} onCheckedChange={f.onChange} className="scale-50 origin-left" /></FormControl>
              <span className="text-[9px] text-muted-foreground">req</span>
            </FormItem>
          )} />
          <button type="button" onClick={() => remove(pIdx)} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
        </div>
      ))}
    </div>
  );
}

/* ── Tab: Overview (Vapi-style) ─────────────────────────────────────────────── */

type CardSection = "transcriber" | "model" | "voice";

function OverviewTab({ form, rateMap, agent }: { form: any; rateMap: Map<string, number>; agent: any }) {
  const [openCard, setOpenCard] = useState<CardSection | null>(null);
  const [, navigate] = useLocation();
  const userProviderNames = useUserProviderNames();

  const asrProvider           = form.watch("asrProvider");
  const llmProvider           = form.watch("llmProvider");
  const ttsProvider           = form.watch("ttsProvider");
  const asrModel              = form.watch("asrModel");
  const llmModel              = form.watch("llmModel");
  const ttsVoice              = form.watch("ttsVoice");
  const ttsModel              = form.watch("ttsModel");
  const language              = form.watch("language");
  const temperature           = form.watch("temperature") ?? 0.1;
  const llmOptions    = LLM_MODELS[llmProvider]  ?? [];
  const ttsModelOpts  = TTS_MODELS[ttsProvider]  ?? [];
  const asrModelOpts  = ASR_MODELS[asrProvider]  ?? [];

  // Fetch admin-whitelisted voices (shared cache with VoiceTab)
  const { data: whitelistedData } = useQuery({
    queryKey: ["voices", "whitelisted"],
    queryFn: () => customFetch<{ voices: Array<{ id: string; name: string; language: string }> }>(`${DASH_API}/voices/whitelisted`),
    staleTime: 5 * 60 * 1000,
  });

  // Fetch user's phone numbers for inbound/outbound assignment
  const { data: phoneNumbersRaw } = useQuery({
    queryKey: ["phone-numbers", "list"],
    queryFn: () => customFetch<Array<{ id: number; number: string; countryCode: string | null }>>(`${DASH_API}/phone-numbers`),
    staleTime: 60 * 1000,
  });
  const phoneNumbers = Array.isArray(phoneNumbersRaw) ? phoneNumbersRaw : [];

  // Fetch platform-managed numbers (no KYC or purchase required — for testing)
  const { data: managedNumbersRaw } = useQuery({
    queryKey: ["phone-numbers", "managed"],
    queryFn: () => customFetch<{ numbers: string[] }>(`${DASH_API}/phone-numbers/managed`),
    staleTime: 5 * 60 * 1000,
  });
  const managedNumbers: string[] = managedNumbersRaw?.numbers ?? [];

  const cartesiaOverviewOpts = useMemo(() => {
    const all = whitelistedData?.voices ?? [];
    // Strictly show only voices whose language metadata matches the selected
    // Transcriber language (e.g. "ta-IN" → "ta"). No fallback to the static
    // English list — an empty/loading whitelist must never surface English
    // voices for a non-English language.
    const baseLang = (language ?? "en-US").split("-")[0]!.toLowerCase();
    const matched = all.filter(v => v.language?.toLowerCase() === baseLang);
    // If no voices for this language, show only the custom paste option
    const opts = matched.map(v => ({ value: v.id, label: v.name }));
    opts.push({ value: "__custom__", label: "Paste custom Voice ID" });
    return opts;
  }, [whitelistedData, language]);

  // When the language changes (or the whitelist finishes loading), clear a
  // selected curated voice that no longer supports the language. User-pasted
  // custom IDs (not present in the whitelist) are left untouched.
  useEffect(() => {
    if (ttsProvider !== "cartesia") return;
    const all = whitelistedData?.voices ?? [];
    if (all.length === 0) return;
    if (!ttsVoice || ttsVoice === "__custom__") return;
    const known = all.find(v => v.id === ttsVoice);
    if (!known) return; // user-pasted custom ID — leave it alone
    const baseLang = (language ?? "en-US").split("-")[0]!.toLowerCase();
    if (known.language?.toLowerCase() !== baseLang) {
      form.setValue("ttsVoice", "", { shouldDirty: true });
    }
  }, [language, whitelistedData, ttsProvider, ttsVoice, form]);

  const ttsVoiceRaw   = ttsProvider in TTS_VOICES ? TTS_VOICES[ttsProvider] : undefined;
  const ttsVoiceFree  = ttsVoiceRaw === null;
  const ttsVoiceOpts: { value: string; label: string }[] =
    ttsProvider === "cartesia"
      ? cartesiaOverviewOpts
      : ((ttsVoiceRaw ?? []) as { value: string; label: string }[]);

  const asrLabel       = ASR_PROVIDERS.find(p => p.value === asrProvider)?.label ?? asrProvider;
  const llmLabel       = LLM_PROVIDERS.find(p => p.value === llmProvider)?.label ?? llmProvider;
  const ttsLabel       = TTS_PROVIDERS.find(p => p.value === ttsProvider)?.label ?? ttsProvider;
  const langLabel      = LANGUAGES.find(l => l.value === language)?.label ?? language;
  const llmModelLabel  = llmOptions.find((m: any) => m.value === llmModel)?.label ?? llmModel;
  const curatedVoiceOpts = ttsVoiceOpts.filter(v => v.value !== "__custom__");
  const inCuratedList    = curatedVoiceOpts.some(v => v.value === ttsVoice);
  const showCustomVoiceInput = ttsVoiceFree || (ttsVoiceOpts.length > 0 && !inCuratedList);
  const ttsVoiceDropdownVal  = inCuratedList ? (ttsVoice ?? "") : "__custom__";
  const ttsVoiceLabel  = (!ttsVoice || ttsVoice === "__custom__") ? "" : (curatedVoiceOpts.find(v => v.value === ttsVoice)?.label ?? ttsVoice);
  const ttsModelLabel  = ttsModelOpts.find((m: any) => m.value === ttsModel)?.label ?? ttsModel;

  const costCents = agent ? computeAgentRateCents(rateMap, agent as any, userProviderNames) : null;

  const toggle = (c: CardSection) => setOpenCard(prev => prev === c ? null : c);

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: Vapi-style config ──────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-y-auto min-w-0 border-r border-border/50">
        <div className="p-5 space-y-5">

          {/* Agent name */}
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-[10px] text-muted-foreground uppercase tracking-widest">Agent Name</FormLabel>
              <FormControl><Input className="h-9 text-sm font-medium" {...field} /></FormControl>
              <FormMessage className="text-[10px]" />
            </FormItem>
          )} />

          {/* ── Three provider cards ─────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">

            {/* TRANSCRIBER */}
            <button type="button" onClick={() => toggle("transcriber")}
              className={cn(
                "relative text-left rounded-xl border p-4 cursor-pointer transition-all hover:border-blue-400/40",
                openCard === "transcriber"
                  ? "border-blue-400/50 bg-blue-950/20 shadow-[0_0_0_1px_rgba(96,165,250,0.2)]"
                  : "border-border/60 bg-card/50"
              )}>
              <Pencil className="absolute top-3 right-3 h-3 w-3 text-muted-foreground/40" />
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" /> Transcriber
              </div>
              <div className="text-sm font-medium truncate leading-snug">{langLabel || "—"}</div>
              <div className="text-[11px] text-muted-foreground mt-1 truncate">
                {asrLabel}{asrModel ? ` · ${asrModel}` : ""}
              </div>
            </button>

            {/* MODEL */}
            <button type="button" onClick={() => toggle("model")}
              className={cn(
                "relative text-left rounded-xl border p-4 cursor-pointer transition-all hover:border-purple-400/40",
                openCard === "model"
                  ? "border-purple-400/50 bg-purple-950/20 shadow-[0_0_0_1px_rgba(192,132,252,0.2)]"
                  : "border-border/60 bg-card/50"
              )}>
              <Pencil className="absolute top-3 right-3 h-3 w-3 text-muted-foreground/40" />
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-purple-400 mb-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" /> Model
              </div>
              <div className="text-sm font-medium truncate leading-snug">{llmModelLabel || llmLabel || "—"}</div>
              <div className="text-[11px] text-muted-foreground mt-1 truncate">{llmLabel}</div>
            </button>

            {/* VOICE */}
            <button type="button" onClick={() => toggle("voice")}
              className={cn(
                "relative text-left rounded-xl border p-4 cursor-pointer transition-all hover:border-green-400/40",
                openCard === "voice"
                  ? "border-green-400/50 bg-green-950/20 shadow-[0_0_0_1px_rgba(74,222,128,0.2)]"
                  : "border-border/60 bg-card/50"
              )}>
              <Pencil className="absolute top-3 right-3 h-3 w-3 text-muted-foreground/40" />
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-green-400 mb-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" /> Voice
              </div>
              <div className="text-sm font-medium truncate leading-snug">
                {ttsVoiceLabel || ttsVoice || ttsModelLabel || ttsLabel || "—"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1 truncate">
                {ttsLabel}{ttsModelLabel ? ` · ${ttsModelLabel}` : ""}
              </div>
            </button>
          </div>

          {/* ── Managed / BYOP callout ───────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3.5 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-sm shrink-0 text-amber-400">★</span>
              <div className="min-w-0">
                <p className="text-[11.5px] font-semibold text-amber-300/90 leading-snug">
                  Using managed API keys
                </p>
                <p className="text-[10.5px] text-muted-foreground leading-relaxed mt-0.5">
                  SnapServe provides keys for the selected providers. To use your own API keys, add them in the Providers section.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate("/app/providers")}
              className="shrink-0 text-[10.5px] font-semibold text-amber-400 hover:text-amber-300 border border-amber-500/30 hover:border-amber-400/50 rounded-md px-2.5 py-1.5 transition-colors whitespace-nowrap bg-amber-500/5 hover:bg-amber-500/10"
            >
              Add own keys →
            </button>
          </div>

          {/* ── Phone Number Assignment ──────────────────────────────────────── */}
          {phoneNumbers.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-card/50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Phone Numbers</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="inboundPhoneNumberId" render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Inbound Number</FormLabel>
                    <SmallSelect
                      value={field.value ? String(field.value) : "__none__"}
                      onChange={(v) => field.onChange(v === "__none__" ? null : parseInt(v, 10))}
                      options={[
                        { value: "__none__", label: "— None —" },
                        ...phoneNumbers.map(p => ({ value: String(p.id), label: p.number })),
                      ]}
                      placeholder="Select number"
                    />
                    <p className="text-[10px] text-muted-foreground">Calls to this number route here</p>
                  </FormItem>
                )} />
                <FormField control={form.control} name="outboundPhoneNumberId" render={({ field }) => {
                  const preferredManaged = form.watch("preferredManagedNumber");
                  const selectValue = field.value
                    ? String(field.value)
                    : preferredManaged
                    ? `managed:${preferredManaged}`
                    : "__none__";
                  return (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Outbound Caller ID</FormLabel>
                    <SmallSelect
                      value={selectValue}
                      onChange={(v) => {
                        if (v === "__none__") {
                          field.onChange(null);
                          form.setValue("preferredManagedNumber", null);
                        } else if (v.startsWith("managed:")) {
                          field.onChange(null);
                          form.setValue("preferredManagedNumber", v.slice(8));
                        } else {
                          field.onChange(parseInt(v, 10));
                          form.setValue("preferredManagedNumber", null);
                        }
                      }}
                      options={[
                        { value: "__none__", label: "— None —" },
                        ...phoneNumbers.map(p => ({ value: String(p.id), label: p.number })),
                        ...managedNumbers.map(n => ({ value: `managed:${n}`, label: `${n} ★ Platform` })),
                      ]}
                      placeholder="Select number"
                    />
                    <p className="text-[10px] text-muted-foreground">Caller ID for outbound calls</p>
                  </FormItem>
                  );
                }} />
              </div>
            </div>
          )}

          {/* ── Inline config for selected card ─────────────────────────────── */}
          {openCard === "transcriber" && (
            <div className="rounded-xl border border-blue-400/30 bg-blue-950/10 p-4 space-y-3 animate-in slide-in-from-top-1 duration-150">
              <div className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Transcriber Configuration</div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="language" render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Language</FormLabel>
                    <SmallSelect value={field.value} onChange={field.onChange}
                      options={LANGUAGES.map(l => ({ value: l.value, label: l.label }))} placeholder="Select language" />
                  </FormItem>
                )} />
                <FormField control={form.control} name="asrProvider" render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Provider</FormLabel>
                    <SmallSelect value={field.value} onChange={(v) => { field.onChange(v); form.setValue("asrModel", ""); }}
                      options={ASR_PROVIDERS.map(p => ({ value: p.value, label: p.label }))} />
                  </FormItem>
                )} />
                {asrModelOpts.length > 0 && (
                  <FormField control={form.control} name="asrModel" render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-[10px] text-muted-foreground">Model</FormLabel>
                      <SmallSelect value={field.value ?? ""} onChange={field.onChange}
                        options={asrModelOpts.map((m: any) => ({ value: m.value, label: m.label }))} placeholder="Default" />
                      <FormMessage className="text-[10px]" />
                    </FormItem>
                  )} />
                )}
              </div>
            </div>
          )}

          {openCard === "model" && (
            <div className="rounded-xl border border-purple-400/30 bg-purple-950/10 p-4 space-y-3 animate-in slide-in-from-top-1 duration-150">
              <div className="text-[10px] font-bold uppercase tracking-widest text-purple-400">Model Configuration</div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="llmProvider" render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Provider</FormLabel>
                    <SmallSelect value={field.value} onChange={(v) => { field.onChange(v); form.setValue("llmModel", ""); }}
                      options={LLM_PROVIDERS.map(p => ({ value: p.value, label: p.label }))} />
                  </FormItem>
                )} />
                {llmOptions.length > 0 && (
                  <FormField control={form.control} name="llmModel" render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-[10px] text-muted-foreground">Model</FormLabel>
                      <SmallSelect value={field.value ?? ""} onChange={field.onChange}
                        options={llmOptions.map((m: any) => ({ value: m.value, label: m.label }))} placeholder="Default" />
                      <FormMessage className="text-[10px]" />
                    </FormItem>
                  )} />
                )}
              </div>
              <FormField control={form.control} name="temperature" render={({ field }) => (
                <FormItem className="space-y-1">
                  <div className="flex justify-between items-center">
                    <FormLabel className="text-[10px] text-muted-foreground">Temperature — Creativity</FormLabel>
                    <span className="text-xs font-mono">{temperature.toFixed(2)}</span>
                  </div>
                  <input type="range" min={0} max={2} step={0.01} value={temperature}
                    onChange={e => field.onChange(parseFloat(e.target.value))}
                    className="w-full h-1.5 accent-primary cursor-pointer" />
                  <div className="flex justify-between text-[9px] text-muted-foreground"><span>0</span><span>2</span></div>
                </FormItem>
              )} />
            </div>
          )}

          {openCard === "voice" && (
            <div className="rounded-xl border border-green-400/30 bg-green-950/10 p-4 space-y-3 animate-in slide-in-from-top-1 duration-150">
              <div className="text-[10px] font-bold uppercase tracking-widest text-green-400">Voice Configuration</div>
              <div className="grid grid-cols-2 gap-3">
                <FormItem className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Provider</Label>
                  <div className="h-7 px-2 flex items-center rounded-md border border-input bg-muted/40 text-xs text-muted-foreground">
                    Cartesia (Sonic)
                  </div>
                </FormItem>
                {ttsVoiceOpts.length > 0 && (
                  <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-[10px] text-muted-foreground">Voice</FormLabel>
                      <SmallSelect
                        value={ttsVoiceDropdownVal}
                        onChange={(v) => field.onChange(v === "__custom__" ? "" : v)}
                        options={ttsVoiceOpts.map(v => ({ value: v.value, label: v.label }))}
                        placeholder="Default"
                      />
                    </FormItem>
                  )} />
                )}
                {ttsProvider === "cartesia" && (whitelistedData?.voices ?? []).length > 0 && curatedVoiceOpts.length === 0 && (
                  <p className="text-[10px] text-amber-400/80 leading-relaxed rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2">
                    No voices available for the selected language.
                  </p>
                )}
                {showCustomVoiceInput && (
                  <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-[10px] text-muted-foreground">
                        {ttsVoiceOpts.length > 0 ? "Custom Voice ID" : "Voice ID"}
                      </FormLabel>
                      <Input
                        value={field.value === "__custom__" ? "" : (field.value ?? "")}
                        onChange={(e) => field.onChange(e.target.value)}
                        placeholder="Paste UUID / voice ID…"
                        className="h-8 text-xs bg-background/50"
                      />
                    </FormItem>
                  )} />
                )}
                {ttsModelOpts.length > 0 && (
                  <FormField control={form.control} name="ttsModel" render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-[10px] text-muted-foreground">Model</FormLabel>
                      <SmallSelect value={field.value ?? ""} onChange={field.onChange}
                        options={ttsModelOpts.map((m: any) => ({ value: m.value, label: m.label }))} placeholder="Default" />
                    </FormItem>
                  )} />
                )}
              </div>
            </div>
          )}

          {/* ── First Message ────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">First Message</span>
              <FormField control={form.control} name="firstSpeaker" render={({ field }) => (
                <Select value={field.value === "user" ? "user" : "assistant"} onValueChange={field.onChange}>
                  <SelectTrigger className="h-8 w-48 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="assistant" className="text-xs">Assistant speaks first</SelectItem>
                    <SelectItem value="user" className="text-xs">User speaks first</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </div>
            <FormField control={form.control} name="greetingMessage" render={({ field }) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <Textarea className="min-h-[72px] text-sm resize-none" placeholder="Hello, how can I help?" {...field} />
                </FormControl>
                <FormMessage className="text-[10px]" />
              </FormItem>
            )} />
          </div>

          {/* ── System Prompt ────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">System Prompt</span>
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5 px-3">
                <Zap className="h-3 w-3" /> Generate
              </Button>
            </div>
            <FormField control={form.control} name="systemPrompt" render={({ field }) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <Textarea className="min-h-[220px] text-sm resize-none font-mono leading-relaxed" placeholder="You are a helpful voice assistant…" {...field} />
                </FormControl>
                <FormMessage className="text-[10px]" />
              </FormItem>
            )} />
          </div>

          {/* ── Agent Knowledge ──────────────────────────────────────────────── */}
          <div className="space-y-2">
            <span className="text-sm font-semibold">Agent Knowledge</span>
            <FormField control={form.control} name="knowledgeSourceIds" render={({ field }) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <KnowledgeSourceMultiSelect
                    value={(field.value ?? []) as number[]}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormDescription className="text-[10px] mt-1.5">
                  Attached sources are searched during live calls and relevant entries are injected into the agent's context.
                </FormDescription>
                <FormMessage className="text-[10px]" />
              </FormItem>
            )} />
          </div>

          {/* ── Bottom strip: cost ───────────────────────────────────────────── */}
          {costCents != null && (
            <div className="flex items-center gap-3 rounded-lg bg-muted/30 border border-border/40 px-4 py-2.5">
              <span className="text-[10px] text-muted-foreground shrink-0">Estimated cost</span>
              <div className="flex items-baseline gap-1 ml-auto shrink-0">
                <span className="text-sm font-bold">~${(costCents / 100).toFixed(3)}</span>
                <span className="text-[10px] text-muted-foreground">/min</span>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Right: Live Test panel ───────────────────────────────────────────── */}
      <div className="w-[272px] shrink-0 flex flex-col min-h-0 bg-background/20">
        <div className="px-4 py-3 border-b border-border/50 shrink-0 flex items-center gap-2">
          <Mic className="h-3 w-3 text-primary" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/70">Live Test</span>
          <span className="text-[10px] text-muted-foreground ml-auto">No phone needed</span>
        </div>
        <WebCallPanel agentId={agent.id} agentName={agent.name} compact />
      </div>

    </div>
  );
}

/* ── Tab: Prompt ────────────────────────────────────────────────────────────── */

function PromptTab({ form }: { form: any }) {
  const { fields: pvFields, append: pvAppend, remove: pvRemove } = useFieldArray({ control: form.control, name: "promptVariables" });
  return (
    <div className="relative flex flex-col h-full p-6 gap-4 overflow-y-auto">
      <FormField control={form.control} name="systemPrompt" render={({ field }) => (
        <FormItem className="flex-1 flex flex-col space-y-2">
          <FormLabel className="text-sm font-semibold">System Prompt</FormLabel>
          <FormControl>
            <Textarea className="flex-1 min-h-[320px] font-mono text-sm resize-none leading-relaxed" placeholder="You are a helpful voice assistant…" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )} />
      <div className="space-y-4">
        <SectionDivider label="Call Behaviour" />
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="greetingMessage" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Greeting Message</FormLabel>
              <FormControl><Input placeholder="Hello! How can I help you today?" className="h-8 text-xs" {...field} /></FormControl>
            </FormItem>
          )} />
          <FormField control={form.control} name="timezone" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Agent Timezone</FormLabel>
              <SmallSelect value={field.value ?? ""} onChange={field.onChange}
                options={[{ value: "", label: "Not set" }, ...AGENT_TIMEZONES]}
                placeholder="Not set" />
              <FormDescription className="text-[10px]">Injected as current-time context</FormDescription>
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="endCallPhrases" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">End-Call Phrases (comma-separated)</FormLabel>
            <FormControl><Input placeholder="goodbye, bye, see you" className="h-8 text-xs" {...field} /></FormControl>
            <FormDescription className="text-[10px]">Agent hangs up when caller says any of these</FormDescription>
          </FormItem>
        )} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionDivider label="Prompt Variables" />
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs ml-4"
            onClick={() => pvAppend({ key: "", defaultValue: "", description: "" })}>
            <Plus className="h-3 w-3 mr-1" /> Add Variable
          </Button>
        </div>
        {pvFields.length === 0 && <p className="text-xs text-muted-foreground">No variables — use {"{{variable}}"} in prompt to inject runtime values.</p>}
        {pvFields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-[1fr_1fr_2fr_28px] gap-2 items-start">
            <FormField control={form.control} name={`promptVariables.${i}.key`} render={({ field: ff }) => (
              <FormItem className="space-y-0">
                <FormControl><Input placeholder="key" className="h-8 text-xs" {...ff} /></FormControl>
                <FormMessage className="text-[10px]" />
              </FormItem>
            )} />
            <FormField control={form.control} name={`promptVariables.${i}.defaultValue`} render={({ field: ff }) => (
              <FormItem className="space-y-0"><FormControl><Input placeholder="default" className="h-8 text-xs" {...ff} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name={`promptVariables.${i}.description`} render={({ field: ff }) => (
              <FormItem className="space-y-0"><FormControl><Input placeholder="description" className="h-8 text-xs" {...ff} /></FormControl></FormItem>
            )} />
            <Button type="button" variant="ghost" size="icon" className="h-8 w-7 text-muted-foreground hover:text-destructive" onClick={() => pvRemove(i)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Tab: Voice ─────────────────────────────────────────────────────────────── */

function VoiceTab({ form }: { form: any }) {
  const backchannelingEnabled = form.watch("backchannelingEnabled");
  const ttsProvider   = form.watch("ttsProvider");
  const ttsVoice      = form.watch("ttsVoice");
  const ttsModel      = form.watch("ttsModel");
  const agentLanguage = (form.watch("language") as string) ?? "en-US";

  // Fetch admin-whitelisted voices (public endpoint, no auth required)
  const { data: whitelistedData } = useQuery({
    queryKey: ["voices", "whitelisted"],
    queryFn: () => customFetch<{ voices: Array<{ id: string; name: string; language: string }> }>(`${DASH_API}/voices/whitelisted`),
    staleTime: 5 * 60 * 1000,
  });

  // For Cartesia: strictly show only voices whose language metadata matches the
  // selected Transcriber language. e.g. "ta-IN" → "ta"; "te-IN" → "te"; "en-US" → "en".
  // No fallback to the static English list — an empty/loading whitelist must
  // never surface English voices for a non-English language.
  const cartesiaVoiceOpts = useMemo(() => {
    const all = whitelistedData?.voices ?? [];
    const baseLang = agentLanguage.split("-")[0]!.toLowerCase();
    const matched = all.filter(v => v.language?.toLowerCase() === baseLang);
    // If no voices for this language, show only the custom paste option
    const opts = matched.map(v => ({ value: v.id, label: v.name }));
    opts.push({ value: "__custom__", label: "Paste custom Voice ID" });
    return opts;
  }, [whitelistedData, agentLanguage]);

  // When the language changes (or the whitelist finishes loading), clear a
  // selected curated voice that no longer supports the language. User-pasted
  // custom IDs (not present in the whitelist) are left untouched.
  useEffect(() => {
    if (ttsProvider !== "cartesia") return;
    const all = whitelistedData?.voices ?? [];
    if (all.length === 0) return;
    if (!ttsVoice || ttsVoice === "__custom__") return;
    const known = all.find(v => v.id === ttsVoice);
    if (!known) return; // user-pasted custom ID — leave it alone
    const baseLang = agentLanguage.split("-")[0]!.toLowerCase();
    if (known.language?.toLowerCase() !== baseLang) {
      form.setValue("ttsVoice", "", { shouldDirty: true });
    }
  }, [agentLanguage, whitelistedData, ttsProvider, ttsVoice, form]);

  // For non-Cartesia providers fall back to the hardcoded list
  const ttsVoiceRawV  = ttsProvider in TTS_VOICES ? TTS_VOICES[ttsProvider] : undefined;
  const ttsVoiceOptsV: { value: string; label: string }[] =
    ttsProvider === "cartesia"
      ? cartesiaVoiceOpts
      : ((ttsVoiceRawV ?? []) as { value: string; label: string }[]);

  const ttsModelOptsV = TTS_MODELS[ttsProvider] ?? [];
  const curatedVoiceOptsV = ttsVoiceOptsV.filter(v => v.value !== "__custom__");
  const inCuratedV        = curatedVoiceOptsV.some(v => v.value === ttsVoice);
  const showCustomV       = ttsVoiceRawV === null || (ttsVoiceOptsV.length > 0 && !inCuratedV);
  const dropdownValV      = inCuratedV ? (ttsVoice ?? "") : "__custom__";

  // ── Voice preview ─────────────────────────────────────────────────────────
  const { toast } = useToast();
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "playing">("idle");
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Tear down any in-flight preview audio + object URL.
  const stopPreview = React.useCallback(() => {
    const audio = previewAudioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.src = "";
      previewAudioRef.current = null;
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  // Stop playback when leaving the tab / unmounting.
  useEffect(() => () => stopPreview(), [stopPreview]);

  // ── Ambient (background noise) track ──────────────────────────────────────
  const { data: ambientSounds, isLoading: ambientSoundsLoading } = useListAmbientSounds();
  const ambientNoiseEnabled = form.watch("ambientNoiseEnabled") ?? false;
  const ambientNoiseTrack   = form.watch("ambientNoiseTrack") ?? "";
  const [ambientPreviewPlaying, setAmbientPreviewPlaying] = useState<string | null>(null);
  const ambientAudioRef = useRef<HTMLAudioElement | null>(null);
  const ambientPreviewUrlRef = useRef<string | null>(null);

  // The user audio endpoint is Bearer-authenticated; <audio> can't send headers,
  // so fetch it as an authenticated blob and play via an object URL.
  const stopAmbientPreview = React.useCallback(() => {
    if (ambientAudioRef.current) {
      ambientAudioRef.current.pause();
      ambientAudioRef.current = null;
    }
    if (ambientPreviewUrlRef.current) {
      URL.revokeObjectURL(ambientPreviewUrlRef.current);
      ambientPreviewUrlRef.current = null;
    }
    setAmbientPreviewPlaying(null);
  }, []);

  const previewAmbient = async (soundId: string) => {
    if (ambientPreviewPlaying === soundId) {
      stopAmbientPreview();
      return;
    }
    stopAmbientPreview();
    setAmbientPreviewPlaying(soundId);
    try {
      const blob = await customFetch<Blob>(`${DASH_API}/ambient-sounds/${soundId}/audio`, {
        responseType: "blob",
        timeoutMs: 30_000,
      });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      ambientAudioRef.current = audio;
      ambientPreviewUrlRef.current = url;
      audio.onended = () => stopAmbientPreview();
      audio.onerror = () => {
        stopAmbientPreview();
        toast({ title: "Playback failed", description: "Could not play this ambient track.", variant: "destructive" });
      };
      await audio.play();
    } catch (err) {
      stopAmbientPreview();
      toast({ title: "Playback failed", description: formatApiError(err), variant: "destructive" });
    }
  };

  // Stop ambient preview on unmount.
  useEffect(() => () => stopAmbientPreview(), [stopAmbientPreview]);

  // Stop ambient preview when a different track is selected or the toggle is turned off.
  useEffect(() => {
    if (ambientPreviewPlaying && ambientPreviewPlaying !== ambientNoiseTrack) {
      stopAmbientPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambientNoiseTrack, ambientNoiseEnabled]);

  const handlePreviewVoice = async () => {
    // Clicking while playing acts as a stop button.
    if (previewState === "playing") {
      stopPreview();
      setPreviewState("idle");
      return;
    }
    // Always stop anything already playing/loading before starting a new one.
    stopPreview();
    setPreviewState("loading");
    try {
      const blob = await customFetch<Blob>(`${DASH_API}/voices/preview`, {
        method: "POST",
        body: JSON.stringify({
          provider: ttsProvider,
          voice: ttsVoice,
          model: ttsModel || undefined,
          language: agentLanguage,
        }),
        responseType: "blob",
        timeoutMs: 30_000,
      });
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        stopPreview();
        setPreviewState("idle");
      };
      audio.onerror = () => {
        stopPreview();
        setPreviewState("idle");
        toast({ title: "Playback failed", description: "Could not play the voice sample.", variant: "destructive" });
      };
      await audio.play();
      setPreviewState("playing");
    } catch (err) {
      stopPreview();
      setPreviewState("idle");
      toast({ title: "Preview failed", description: formatApiError(err), variant: "destructive" });
    }
  };

  const previewVoiceControl = (
    <div className="flex items-center gap-2 pt-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handlePreviewVoice}
        disabled={!ttsVoice || previewState === "loading"}
        className="h-9 text-sm gap-2 font-medium"
      >
        {previewState === "loading" ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
        ) : previewState === "playing" ? (
          <><Square className="h-4 w-4" /> Stop</>
        ) : (
          <><Play className="h-4 w-4 fill-current" /> Preview Voice</>
        )}
      </Button>
      {!ttsVoice && (
        <span className="text-[10px] text-muted-foreground">
          Select a voice to preview
        </span>
      )}
    </div>
  );

  return (
    <div className="relative p-6 overflow-y-auto h-full space-y-6">

      {/* ── Provider & Voice ── */}
      <div className="space-y-3">
        <SectionDivider label="Text-to-Speech — Provider & Voice" />
        <div className="grid grid-cols-2 gap-3">
          <FormItem className="space-y-1">
            <Label className="text-xs text-muted-foreground">Provider</Label>
            <div className="h-9 px-3 flex items-center rounded-md border border-input bg-muted/40 text-sm text-muted-foreground">
              Cartesia (Sonic)
            </div>
          </FormItem>

          {ttsVoiceOptsV.length > 0 && (
            <FormField control={form.control} name="ttsVoice" render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs text-muted-foreground">Voice</FormLabel>
                <Select
                  value={dropdownValV}
                  onValueChange={(v) => field.onChange(v === "__custom__" ? "" : v)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select voice" />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-[300px]">
                    {ttsVoiceOptsV.map(v => (
                      <SelectItem key={v.value} value={v.value} className="text-sm">
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {previewVoiceControl}
              </FormItem>
            )} />
          )}

          {ttsProvider === "cartesia" && (whitelistedData?.voices ?? []).length > 0 && curatedVoiceOptsV.length === 0 && (
            <p className="text-xs text-amber-400/80 leading-relaxed rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
              No voices available for the selected language.
            </p>
          )}

          {ttsModelOptsV.length > 0 && (
            <FormField control={form.control} name="ttsModel" render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs text-muted-foreground">Model</FormLabel>
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-[280px]">
                    {ttsModelOptsV.map((m: any) => (
                      <SelectItem key={m.value} value={m.value} className="text-sm">{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
          )}
        </div>

        {/* Custom voice ID input — shown when free-form or "Paste custom" selected */}
        {showCustomV && (
          <FormField control={form.control} name="ttsVoice" render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-xs text-muted-foreground">
                {ttsVoiceOptsV.length > 0 ? "Custom Voice ID" : "Voice ID"}
              </FormLabel>
              <FormControl>
                <Input
                  value={field.value === "__custom__" ? "" : (field.value ?? "")}
                  onChange={(e) => field.onChange(e.target.value)}
                  placeholder="Paste UUID / voice ID from your provider dashboard…"
                  className="h-9 text-sm font-mono bg-background/50"
                />
              </FormControl>
              <FormDescription className="text-[10px]">
                {ttsProvider === "cartesia"
                  ? "Find voice IDs in your Cartesia Voice Library dashboard"
                  : ttsProvider === "elevenlabs"
                    ? "Find voice IDs in the ElevenLabs Voice Lab"
                    : "Provider-specific voice identifier"}
              </FormDescription>
              {ttsVoiceOptsV.length === 0 && previewVoiceControl}
            </FormItem>
          )} />
        )}
      </div>

      {/* ── Behavioral settings ── */}
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <SectionDivider label="Speech Recognition" />
          <FormField control={form.control} name="noiseCancellationEnabled" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
              <div><FormLabel className="text-sm">Noise Cancellation</FormLabel>
                <FormDescription className="text-[10px]">Filter background noise from caller audio</FormDescription></div>
              <FormControl><Switch checked={field.value ?? true} onCheckedChange={field.onChange} /></FormControl>
            </FormItem>
          )} />
          <FormField control={form.control} name="vadSilenceMs" render={({ field }) => (
            <FormItem>
              <div className="flex justify-between"><FormLabel className="text-xs">VAD Silence Threshold</FormLabel>
                <span className="text-xs font-mono">{field.value ?? 250}ms</span></div>
              <FormControl>
                <input type="range" min={50} max={2000} step={50} value={field.value ?? 250}
                  onChange={e => field.onChange(parseInt(e.target.value))}
                  className="w-full h-1.5 accent-primary cursor-pointer" />
              </FormControl>
              <FormDescription className="text-[10px]">Silence duration before end-of-utterance is detected</FormDescription>
            </FormItem>
          )} />
        </div>
        <div className="space-y-4">
          <SectionDivider label="Text-to-Speech Behaviour" />
          <FormField control={form.control} name="backchannelingEnabled" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
              <div><FormLabel className="text-sm">Backchanneling</FormLabel>
                <FormDescription className="text-[10px]">Agent says "mm-hmm", "I see" while listening</FormDescription></div>
              <FormControl><Switch checked={field.value ?? true} onCheckedChange={field.onChange} /></FormControl>
            </FormItem>
          )} />
          {backchannelingEnabled && (
            <>
              <FormField control={form.control} name="backchannelingFrequency" render={({ field }) => (
                <FormItem>
                  <div className="flex justify-between"><FormLabel className="text-xs">Frequency</FormLabel>
                    <span className="text-xs font-mono">{((field.value ?? 0.5) * 100).toFixed(0)}%</span></div>
                  <FormControl>
                    <input type="range" min={0} max={1} step={0.05} value={field.value ?? 0.5}
                      onChange={e => field.onChange(parseFloat(e.target.value))}
                      className="w-full h-1.5 accent-primary cursor-pointer" />
                  </FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="backchannelPhrases" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Custom Phrases (comma-separated)</FormLabel>
                  <FormControl><Input placeholder="mm-hmm, I see, got it" className="h-8 text-xs" {...field} /></FormControl>
                </FormItem>
              )} />
            </>
          )}

          <FormField control={form.control} name="ambientNoiseEnabled" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
              <div><FormLabel className="text-sm">Background Noise</FormLabel>
                <FormDescription className="text-[10px]">Play an ambient background track to make the call feel natural</FormDescription></div>
              <FormControl><Switch checked={field.value ?? false} onCheckedChange={field.onChange} /></FormControl>
            </FormItem>
          )} />
          {ambientNoiseEnabled && (
            <FormField control={form.control} name="ambientNoiseTrack" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Track</FormLabel>
                {ambientSoundsLoading ? (
                  <div className="h-8 flex items-center text-xs text-muted-foreground">Loading tracks…</div>
                ) : !ambientSounds || ambientSounds.length === 0 ? (
                  <div className="h-8 flex items-center text-xs text-muted-foreground italic">
                    No ambient sounds uploaded yet — ask your admin to add some.
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Select value={field.value || undefined} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select a track" /></SelectTrigger>
                      </FormControl>
                      <SelectContent position="popper" className="max-h-[280px]">
                        {ambientSounds.map(s => <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      disabled={!field.value}
                      onClick={() => { if (field.value) void previewAmbient(field.value); }}
                      aria-label={ambientPreviewPlaying && ambientPreviewPlaying === field.value ? "Stop preview" : "Play preview"}
                      title={field.value ? "Preview track" : "Select a track to preview"}
                      className="h-8 w-8 shrink-0 flex items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {ambientPreviewPlaying && ambientPreviewPlaying === field.value
                        ? <Pause className="h-3.5 w-3.5" />
                        : <Play className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
              </FormItem>
            )} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Tab: Tools ─────────────────────────────────────────────────────────────── */



function ToolsTab({ form, agentId }: { form: any; agentId: number | undefined }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "tools" });
  const genderEnabled = form.watch("genderDetectionEnabled") ?? false;
  const recordingEnabled = form.watch("recordingEnabled") ?? false;
  const watchedTools  = (form.watch("tools") ?? []) as any[];
  const { toast } = useToast();

  const { data: calendarsData } = useListCalendars();
  const agentCalendar = agentId ? (calendarsData ?? []).find((cal: any) => cal.agentId === agentId) : undefined;
  const calendarIdForEt = agentCalendar?.id;
  const { data: agentEventTypes } = useListEventTypes(
    calendarIdForEt ? { calendarId: calendarIdForEt } : undefined,
    { query: { enabled: !!calendarIdForEt, queryKey: ["agent-event-types", calendarIdForEt ?? null] } }
  );

  // Reset eventTypeId on booking tools whenever the assigned calendar changes
  const prevCalendarIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (prevCalendarIdRef.current === undefined) {
      prevCalendarIdRef.current = calendarIdForEt;
      return;
    }
    if (prevCalendarIdRef.current !== calendarIdForEt) {
      prevCalendarIdRef.current = calendarIdForEt;
      const tools = form.getValues("tools") ?? [];
      const typesToReset = ["native_booking", "native_check_availability", "native_list_bookings", "native_reschedule", "native_cancel"];
      (tools as any[]).forEach((t: any, idx: number) => {
        if (typesToReset.includes(t.type)) {
          form.setValue(`tools.${idx}.eventTypeId` as any, undefined);
        }
      });
    }
  }, [calendarIdForEt]);

  const [expandedSchema, setExpandedSchema] = useState<string | null>(null);
  const [expandedTest, setExpandedTest]     = useState<string | null>(null);
  const [testArgs, setTestArgs]             = useState<Record<string, string>>({});
  const [testResult, setTestResult]         = useState<Record<string, string | null>>({});

  const runTest = useRunToolTest();

  const hasNativeTool = (type: string) => watchedTools.some((t: any) => t.type === type);
  const nativeToolIndex = (type: string) => watchedTools.findIndex((t: any) => t.type === type);

  const NATIVE_DEFAULT_NAMES: Record<string, string> = {
    native_booking: "book_appointment",
    native_check_availability: "check_availability",
    native_list_bookings: "list_bookings",
    native_reschedule: "reschedule_booking",
    native_cancel: "cancel_booking",
  };

  const toggleNativeTool = (type: string) => {
    const idx = nativeToolIndex(type);
    if (idx >= 0) {
      remove(idx);
      setExpandedSchema(null);
      setExpandedTest(null);
    } else {
      append({ type: type as any, name: NATIVE_DEFAULT_NAMES[type] ?? "", description: "" });
      const bookingTypes = ["native_booking", "native_check_availability", "native_list_bookings", "native_reschedule", "native_cancel"];
      if (bookingTypes.includes(type)) {
        if (!agentId) {
          toast({ title: "Save agent first", description: "Save this agent before configuring calendar tools.", variant: "destructive" });
        } else if (!agentCalendar) {
          toast({ title: "No calendar configured", description: "No calendar configured for this agent. Go to Settings → Calendar to set one up.", variant: "destructive" });
        } else if (!(agentCalendar as any).connectedGoogleEmail) {
          toast({ title: "No Google account connected", description: `Connect a Google account to the "${agentCalendar.name}" calendar in Scheduling.`, variant: "destructive" });
        } else if ((agentEventTypes ?? []).length === 0 && ["native_booking", "native_check_availability", "native_list_bookings"].includes(type)) {
          toast({ title: "No event types found", description: "Create an event type in Scheduling before using this tool.", variant: "destructive" });
        }
      }
    }
  };


  const BOOKING_TOOLS = [
    { type: "native_booking",           fnName: "book_appointment",   icon: <BookOpen className="h-4 w-4" />, color: "emerald", label: "Book Appointment",    description: "Lets the agent book a meeting slot for the caller. Agent collects name, email, and preferred time, then confirms the booking live." },
    { type: "native_check_availability", fnName: "check_availability", icon: <Sparkles className="h-4 w-4" />, color: "sky",     label: "Check Availability", description: "Enables the agent to look up open slots before suggesting a time. Use alongside Book Appointment for a natural booking flow." },
    { type: "native_list_bookings",      fnName: "list_bookings",      icon: <List className="h-4 w-4" />,     color: "violet",  label: "List Bookings",      description: "Allows the agent to retrieve existing bookings for the caller — useful for reschedule or cancellation flows." },
    { type: "native_reschedule",         fnName: "reschedule_booking", icon: <Pencil className="h-4 w-4" />,   color: "amber",   label: "Reschedule Booking", description: "Lets the agent reschedule an existing booking to a new time slot chosen by the caller." },
    { type: "native_cancel",             fnName: "cancel_booking",     icon: <X className="h-4 w-4" />,        color: "red",     label: "Cancel Booking",     description: "Allows the agent to cancel an upcoming booking on the caller's request." },
  ] as const;

  const BOOKING_TOOL_SCHEMAS: Record<string, object> = {
    native_booking: {
      name: "book_appointment",
      description: "Book an appointment for the caller.",
      parameters: {
        type: "object",
        properties: {
          attendee_name:  { type: "string", description: "Full name of the person being booked" },
          attendee_email: { type: "string", description: "Email address of the person being booked" },
          preferred_date: { type: "string", description: "Optional preferred date/time, e.g. 'next Tuesday' or '2026-06-10'" },
          meeting_type:   { type: "string", enum: ["google_meet", "in_person"], description: "Meeting format" },
          meeting_address: { type: "string", description: "Physical address (required when meeting_type is in_person)" },
        },
        required: ["attendee_name", "attendee_email"],
      },
    },
    native_check_availability: {
      name: "check_availability",
      description: "Check available appointment slots.",
      parameters: {
        type: "object",
        properties: {
          preferred_date: { type: "string", description: "Optional preferred date/time to check, e.g. 'tomorrow morning'" },
          timezone:       { type: "string", description: "IANA timezone, e.g. 'America/New_York'" },
        },
        required: [],
      },
    },
    native_list_bookings: {
      name: "list_bookings",
      description: "List existing bookings for the caller.",
      parameters: {
        type: "object",
        properties: {
          attendee_name: { type: "string", description: "Full name of the caller whose bookings to look up" },
          timezone:      { type: "string", description: "IANA timezone for formatting dates" },
        },
        required: ["attendee_name"],
      },
    },
    native_reschedule: {
      name: "reschedule_booking",
      description: "Reschedule an existing booking to a new time slot.",
      parameters: {
        type: "object",
        properties: {
          booking_id:     { type: "string", description: "The booking reference ID to reschedule" },
          preferred_date: { type: "string", description: "Optional new preferred date/time" },
        },
        required: ["booking_id"],
      },
    },
    native_cancel: {
      name: "cancel_booking",
      description: "Cancel an upcoming booking on the caller's request.",
      parameters: {
        type: "object",
        properties: {
          booking_id: { type: "string", description: "The booking reference ID to cancel" },
        },
        required: ["booking_id"],
      },
    },
  };

  const CALL_CONTROL_TOOLS = [
    {
      type: "end_call",
      icon: <PhoneOff className="h-4 w-4" />,
      color: "slate",
      label: "End Call",
      description: "Lets the agent gracefully end the call when the conversation is complete.",
      needsEventType: false,
    },
  ] as const;

  const colorMap: Record<string, { border: string; bg: string; iconBg: string; iconText: string; label: string; badge: string; badgeText: string; active: string }> = {
    emerald: { border: "border-emerald-400/40", bg: "bg-emerald-950/10", iconBg: "bg-emerald-500/15", iconText: "text-emerald-400", label: "text-emerald-300", badge: "bg-emerald-500/20", badgeText: "text-emerald-300", active: "" },
    sky:     { border: "border-sky-400/40",     bg: "bg-sky-950/10",     iconBg: "bg-sky-500/15",     iconText: "text-sky-400",     label: "text-sky-300",     badge: "bg-sky-500/20",     badgeText: "text-sky-300",     active: "" },
    violet:  { border: "border-violet-400/40",  bg: "bg-violet-950/10",  iconBg: "bg-violet-500/15",  iconText: "text-violet-400",  label: "text-violet-300",  badge: "bg-violet-500/20",  badgeText: "text-violet-300",  active: "" },
    amber:   { border: "border-amber-400/40",   bg: "bg-amber-950/10",   iconBg: "bg-amber-500/15",   iconText: "text-amber-400",   label: "text-amber-300",   badge: "bg-amber-500/20",   badgeText: "text-amber-300",   active: "" },
    red:     { border: "border-red-400/40",     bg: "bg-red-950/10",     iconBg: "bg-red-500/15",     iconText: "text-red-400",     label: "text-red-300",     badge: "bg-red-500/20",     badgeText: "text-red-300",     active: "" },
    slate:   { border: "border-slate-400/40",   bg: "bg-slate-950/10",   iconBg: "bg-slate-500/15",   iconText: "text-slate-400",   label: "text-slate-300",   badge: "bg-slate-500/20",   badgeText: "text-slate-300",   active: "" },
  };

  return (
    <div className="relative p-6 overflow-y-auto h-full space-y-6">

      {/* ── Platform Tools ─── */}
      <div>
        <h3 className="text-sm font-semibold mb-0.5">Platform Tools</h3>
        <p className="text-xs text-muted-foreground mb-3">Built-in capabilities you can enable for this agent</p>

        <div className="space-y-2">

        {/* ── Booking Tools ── */}
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 px-0.5 mb-1 mt-3">Scheduling & Bookings</p>
        {BOOKING_TOOLS.map(({ type, fnName, icon, color, label, description }) => {
          const isOn = hasNativeTool(type);
          const c = colorMap[color];
          const schemaOpen = expandedSchema === type;
          const testOpen   = expandedTest === type;
          const argKey = `${type}:args`;
          const handleRunTest = async () => {
            setTestResult((r) => ({ ...r, [type]: null }));
            try {
              let parsedArgs: Record<string, unknown> = {};
              try { parsedArgs = JSON.parse(testArgs[argKey] || "{}"); } catch { parsedArgs = {}; }
              const res = await runTest.mutateAsync({ data: { agentId: agentId!, toolName: fnName, args: parsedArgs } });
              setTestResult((r) => ({ ...r, [type]: res.result ?? JSON.stringify(res) }));
            } catch (err: any) {
              setTestResult((r) => ({ ...r, [type]: `Error: ${err?.message ?? String(err)}` }));
            }
          };
          return (
            <div key={type} className={cn("rounded-xl border transition-all duration-150", isOn ? "border-border/70 bg-card/40" : "border-border/40 bg-card/20")}>
              <button
                type="button"
                onClick={() => toggleNativeTool(type)}
                className="w-full text-left p-4 flex items-start gap-3"
              >
                <div className="mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-muted/30">
                  <span className={cn(isOn ? "text-foreground/70" : "text-muted-foreground/35")}>{icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <code className="text-[11px] font-mono font-semibold text-foreground/80">{fnName}</code>
                  </div>
                  <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{description}</p>
                </div>
                <div className="shrink-0 mt-1">
                  <Switch checked={isOn} onCheckedChange={() => toggleNativeTool(type)} onClick={e => e.stopPropagation()} />
                </div>
              </button>
              {isOn && (
                <div className="px-4 pb-4 -mt-1">
                  <div className="border-t border-border/30 pt-3 space-y-2">
                    {/* Calendar status block */}
                    {!agentId ? (
                      <p className="text-[10px] text-amber-400/80">
                        Save this agent first, then configure calendar tools in <span className="font-medium">Settings → Calendar</span>.
                      </p>
                    ) : !agentCalendar ? (
                      <p className="text-[10px] text-amber-400/80">
                        No calendar found for this agent. Go to <span className="font-medium">Settings → Calendar</span> to create one.
                      </p>
                    ) : !(agentCalendar as any).connectedGoogleEmail ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">Assigned calendar:</span>
                        <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded", c.badge, c.badgeText)}>
                          {agentCalendar.name || "Calendar"}
                        </span>
                        <span className="text-[10px] text-amber-400/80">No Google account connected to this calendar.</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">Assigned calendar:</span>
                        <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded", c.badge, c.badgeText)}>
                          {agentCalendar.name || "Calendar"}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60">
                          {(agentCalendar as any).connectedGoogleAccountsCount > 1
                            ? `${(agentCalendar as any).connectedGoogleAccountsCount} accounts`
                            : (agentCalendar as any).connectedGoogleEmail}
                        </span>
                      </div>
                    )}
                    {/* Event Type (all booking tools) */}
                    {(() => {
                      const idx = nativeToolIndex(type);
                      const toolEventTypeId = watchedTools[idx]?.eventTypeId;
                      return (
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground block">Event Type (optional)</label>
                          <Select
                            value={toolEventTypeId != null ? String(toolEventTypeId) : "__none__"}
                            onValueChange={(v) => form.setValue(`tools.${idx}.eventTypeId` as any, v === "__none__" ? undefined : Number(v))}
                            disabled={!agentCalendar}
                          >
                            <SelectTrigger className="h-7 text-xs bg-background/50"><SelectValue placeholder="Any event type" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__" className="text-xs">Any event type</SelectItem>
                              {(agentEventTypes ?? []).map((et: any) => (
                                <SelectItem key={et.id} value={String(et.id)} className="text-xs">{et.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {agentCalendar && (agentEventTypes ?? []).length === 0 && (
                            <p className="text-[10px] text-amber-400/80">No event types found for this calendar. Create one in Scheduling.</p>
                          )}
                        </div>
                      );
                    })()}
                    {/* Timezone */}
                    {(() => {
                      const idx = nativeToolIndex(type);
                      const toolTimezone = watchedTools[idx]?.timezone;
                      return (
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground block">Timezone (optional)</label>
                          <SmallSelect
                            value={toolTimezone || "__none__"}
                            onChange={(v) => form.setValue(`tools.${idx}.timezone` as any, v === "__none__" ? undefined : v)}
                            options={[{ value: "__none__", label: "Use caller timezone" }, ...AGENT_TIMEZONES]}
                            placeholder="Use caller timezone"
                          />
                        </div>
                      );
                    })()}
                    {/* Action buttons */}
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] px-2 gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedSchema(schemaOpen ? null : type);
                          setExpandedTest(null);
                        }}
                      >
                        <FileText className="h-3 w-3" /> View Schema
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] px-2 gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedTest(testOpen ? null : type);
                          setExpandedSchema(null);
                          setTestResult((r) => ({ ...r, [type]: null }));
                        }}
                      >
                        <TestTube2 className="h-3 w-3" /> Test Tool
                      </Button>
                    </div>
                    {/* Schema panel */}
                    {schemaOpen && (
                      <div className="rounded-md bg-muted/20 border border-border/30 p-3">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">Function Schema</p>
                        <pre className="text-[10px] text-muted-foreground/80 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                          {JSON.stringify(BOOKING_TOOL_SCHEMAS[type] ?? {}, null, 2)}
                        </pre>
                      </div>
                    )}
                    {/* Test panel */}
                    {testOpen && (
                      <div className="rounded-md bg-muted/20 border border-border/30 p-3 space-y-2">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Test Tool</p>
                        {!agentCalendar ? (
                          <p className="text-[10px] text-amber-400/80">No calendar is assigned to this agent yet. Go to Settings → Calendar to set one up.</p>
                        ) : (
                          <>
                            <div>
                              <label className="text-[10px] text-muted-foreground block mb-1">Arguments (JSON)</label>
                              <textarea
                                className="w-full rounded-md border border-border/50 bg-background/50 text-[10px] font-mono p-2 min-h-[60px] resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                                placeholder={`{}`}
                                value={testArgs[argKey] ?? "{}"}
                                onChange={(e) => setTestArgs((a) => ({ ...a, [argKey]: e.target.value }))}
                              />
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              className="h-6 text-[10px] px-3"
                              disabled={runTest.isPending}
                              onClick={handleRunTest}
                            >
                              {runTest.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Run Test"}
                            </Button>
                            {testResult[type] != null && (
                              <div className="rounded-md bg-background/50 border border-border/30 p-2">
                                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1">Response</p>
                                <pre className="text-[10px] text-muted-foreground/80 font-mono whitespace-pre-wrap break-all">{testResult[type]}</pre>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 px-0.5 mb-1 mt-4">Call Control</p>
        {CALL_CONTROL_TOOLS.map(({ type, icon, color, label, description }) => {
          const isOn = hasNativeTool(type);
          const c = colorMap[color];
          return (
            <div key={type} className={cn("rounded-xl border transition-all duration-150", isOn ? "border-border/70 bg-card/40" : "border-border/40 bg-card/20")}>
              <button
                type="button"
                onClick={() => toggleNativeTool(type)}
                className="w-full text-left p-4 flex items-start gap-3"
              >
                <div className="mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-muted/30">
                  <span className={cn(isOn ? "text-foreground/70" : "text-muted-foreground/35")}>{icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-foreground/80">{label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{description}</p>
                </div>
                <div className="shrink-0 mt-1">
                  <Switch checked={isOn} onCheckedChange={() => toggleNativeTool(type)} onClick={e => e.stopPropagation()} />
                </div>
              </button>
            </div>
          );
        })}

        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 px-0.5 mb-1 mt-4">Recording</p>
        {/* Call Recording card */}
        <div className={cn("rounded-xl border transition-all duration-150", recordingEnabled ? "border-border/70 bg-card/40" : "border-border/40 bg-card/20")}>
          <button
            type="button"
            onClick={() => form.setValue("recordingEnabled", !recordingEnabled, { shouldDirty: true })}
            className="w-full text-left p-4 flex items-start gap-3"
          >
            <div className="mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-muted/30">
              <Mic className={cn("h-4 w-4", recordingEnabled ? "text-foreground/70" : "text-muted-foreground/35")} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-foreground/80">Call Recording</span>
              </div>
              <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                Records the full audio of each call (caller and agent) and stores it on the call. When enabled, recordings appear in the Call Recording tab on the call's detail page for playback and download.
              </p>
            </div>
            <div className="shrink-0 mt-1">
              <Switch
                checked={recordingEnabled}
                onCheckedChange={(v) => form.setValue("recordingEnabled", v, { shouldDirty: true })}
                onClick={e => e.stopPropagation()}
              />
            </div>
          </button>
        </div>

        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 px-0.5 mb-1 mt-4">Caller Intelligence</p>
        {/* Gender Identification card */}
        <div className={cn("rounded-xl border transition-all duration-150", genderEnabled ? "border-border/70 bg-card/40" : "border-border/40 bg-card/20")}>
          <button
            type="button"
            onClick={() => form.setValue("genderDetectionEnabled", !genderEnabled, { shouldDirty: true })}
            className="w-full text-left p-4 flex items-start gap-3"
          >
            <div className="mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-muted/30">
              <User2 className={cn("h-4 w-4", genderEnabled ? "text-foreground/70" : "text-muted-foreground/35")} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-foreground/80">Gender Identification</span>
              </div>
              <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                Detects caller gender from voice at the start of the call. When enabled, the agent uses gender-appropriate salutations — "Sir", "Ma'am", or a neutral fallback.
              </p>
            </div>
            <div className="shrink-0 mt-1">
              <Switch
                checked={genderEnabled}
                onCheckedChange={(v) => form.setValue("genderDetectionEnabled", v, { shouldDirty: true })}
                onClick={e => e.stopPropagation()}
              />
            </div>
          </button>
        </div>
      </div>
      </div>

      {/* ── Custom Tools ─── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold mb-0.5">Custom Tools</h3>
            <p className="text-xs text-muted-foreground">Functions the LLM can invoke mid-conversation</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => append({ type: "call_transfer", name: "transfer_to_human", description: "Transfer to a human agent.", transferTo: "", warmHandoffMessage: "" })}>
              <PhoneForwarded className="h-3.5 w-3.5 mr-1" /> Call Transfer
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => append({ type: "webhook", name: "custom_action", description: "Invoke when caller requests a specific action.", url: "", method: "POST", secret: "", preToolMessage: "One moment…", parameters: [] })}>
              <Webhook className="h-3.5 w-3.5 mr-1" /> Custom Function
            </Button>
          </div>
        </div>

        {(form.watch("tools") ?? []).filter((t: { type: string }) => t.type === "call_transfer" || t.type === "webhook").length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
            <Wrench className="h-7 w-7 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm font-medium text-muted-foreground/50">No custom tools</p>
            <p className="text-xs text-muted-foreground/30 mt-0.5">Add a Call Transfer or Custom Function above</p>
          </div>
        ) : (
          <div className="space-y-3">
            {fields.flatMap((field, index) => {
              const toolType = form.watch(`tools.${index}.type`);
              if (toolType !== "call_transfer" && toolType !== "webhook") return [];
              return (
                <div key={field.id} className="rounded-xl border border-border/60 bg-card/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {toolType === "webhook"
                        ? <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-purple-400"><Webhook className="h-3 w-3" />Custom Function</span>
                        : <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-blue-400"><PhoneForwarded className="h-3 w-3" />Call Transfer</span>
                      }
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove(index)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name={`tools.${index}.name`} render={({ field: f }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[10px] text-muted-foreground">Function Name</FormLabel>
                        <FormControl><Input placeholder="snake_case_name" className="h-8 text-xs" {...f} /></FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )} />
                    {toolType === "webhook" ? (
                      <FormField control={form.control} name={`tools.${index}.preToolMessage`} render={({ field: f }) => (
                        <FormItem className="space-y-1">
                          <FormLabel className="text-[10px] text-muted-foreground">Pre-call Message</FormLabel>
                          <FormControl><Input placeholder="One moment…" className="h-8 text-xs" {...f} /></FormControl>
                        </FormItem>
                      )} />
                    ) : (
                      <FormField control={form.control} name={`tools.${index}.transferTo`} render={({ field: f }) => (
                        <FormItem className="space-y-1">
                          <FormLabel className="text-[10px] text-muted-foreground">Transfer To</FormLabel>
                          <FormControl><Input placeholder="+12125551234" className="h-8 text-xs" {...f} /></FormControl>
                        </FormItem>
                      )} />
                    )}
                  </div>
                  <FormField control={form.control} name={`tools.${index}.description`} render={({ field: f }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-[10px] text-muted-foreground">Description (shown to LLM)</FormLabel>
                      <FormControl><Textarea className="min-h-[60px] text-xs resize-none" placeholder="When should the LLM call this tool?" {...f} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  {toolType === "webhook" && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-[1fr_100px] gap-2">
                        <FormField control={form.control} name={`tools.${index}.url`} render={({ field: f }) => (
                          <FormItem className="space-y-1">
                            <FormLabel className="text-[10px] text-muted-foreground">Endpoint URL</FormLabel>
                            <FormControl><Input placeholder="https://your-api.com/webhook" className="h-8 text-xs" {...f} /></FormControl>
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`tools.${index}.method`} render={({ field: f }) => (
                          <FormItem className="space-y-1">
                            <FormLabel className="text-[10px] text-muted-foreground">Method</FormLabel>
                            <Select value={f.value ?? "POST"} onValueChange={f.onChange}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="POST" className="text-xs">POST</SelectItem>
                                <SelectItem value="GET" className="text-xs">GET</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )} />
                      </div>
                      <FormField control={form.control} name={`tools.${index}.secret`} render={({ field: f }) => (
                        <FormItem className="space-y-1">
                          <FormLabel className="text-[10px] text-muted-foreground">X-Webhook-Secret (optional)</FormLabel>
                          <FormControl><Input type="password" placeholder="shared-secret" className="h-8 text-xs" {...f} /></FormControl>
                        </FormItem>
                      )} />
                      <div className="border-t border-border/40 pt-3">
                        <WebhookParamsEditor control={form.control} toolIndex={index} />
                      </div>
                    </div>
                  )}
                  {toolType === "call_transfer" && (
                    <FormField control={form.control} name={`tools.${index}.warmHandoffMessage`} render={({ field: f }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[10px] text-muted-foreground">Warm Handoff Message</FormLabel>
                        <FormControl><Input placeholder="Connecting you with a specialist now…" className="h-8 text-xs" {...f} /></FormControl>
                      </FormItem>
                    )} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Voicemail ─────────────────────────────────────────────────────────── */

function VoicemailTab({ form }: { form: any }) {
  const mode   = form.watch("machineDetectionMode");
  const action = form.watch("voicemailAction");
  return (
    <div className="relative p-6 overflow-y-auto h-full space-y-5 max-w-xl">
      <div>
        <h3 className="text-sm font-semibold">Voicemail Detection (AMD)</h3>
        <p className="text-xs text-muted-foreground mt-1">Outbound calls only — detects answering machines and takes action.</p>
      </div>
      <FormField control={form.control} name="machineDetectionMode" render={({ field }) => (
        <FormItem>
          <FormLabel className="text-xs">Detection Mode</FormLabel>
          <Select value={field.value ?? "disabled"} onValueChange={field.onChange}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="disabled">Disabled</SelectItem>
              <SelectItem value="enable">Enable — detect at call start</SelectItem>
              <SelectItem value="detect_message_end">Detect Message End — wait for beep</SelectItem>
            </SelectContent>
          </Select>
          <FormDescription className="text-[10px]">"Detect Message End" waits for the beep before speaking the voicemail.</FormDescription>
        </FormItem>
      )} />
      {mode !== "disabled" && (
        <>
          <FormField control={form.control} name="voicemailAction" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">When voicemail detected</FormLabel>
              <Select value={field.value ?? "hangup"} onValueChange={field.onChange}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hangup">Hang up immediately</SelectItem>
                  <SelectItem value="leave_message">Leave a voicemail message</SelectItem>
                  <SelectItem value="continue">Continue — AI talks to the recording</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )} />
          {action === "leave_message" && (
            <FormField control={form.control} name="voicemailMessage" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Voicemail Message</FormLabel>
                <FormControl>
                  <Textarea className="min-h-[100px] text-sm resize-none"
                    placeholder="Hello, we tried to reach you. Please call us back at your earliest convenience." {...field} />
                </FormControl>
                <FormDescription className="text-[10px]">Spoken via TTS into the voicemail recording.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
          )}
        </>
      )}
    </div>
  );
}

/* ── Tab: Advanced ──────────────────────────────────────────────────────────── */

type AdvSection = "timing" | "interruption" | "limits" | "compliance" | "optimize";

function AdvSlider({ form, name, label, hint, min, max, step, fmt }: {
  form: any; name: string; label: string; hint?: string;
  min: number; max: number; step: number; fmt: (v: number) => string;
}) {
  return (
    <FormField control={form.control} name={name} render={({ field }) => {
      const val = field.value ?? min;
      const pct = ((val - min) / (max - min)) * 100;
      return (
        <FormItem className="space-y-0">
          <div className="flex items-center justify-between mb-1.5">
            <FormLabel className="text-[12px] font-medium text-foreground/90">{label}</FormLabel>
            <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
              {fmt(val)}
            </span>
          </div>
          <FormControl>
            <div className="relative h-5 flex items-center">
              <div className="absolute inset-x-0 h-1.5 rounded-full bg-border/60" />
              <div className="absolute left-0 h-1.5 rounded-full bg-primary/70 pointer-events-none" style={{ width: `${pct}%` }} />
              <input
                type="range" min={min} max={max} step={step} value={val}
                onChange={e => field.onChange(step % 1 !== 0 ? parseFloat(e.target.value) : parseInt(e.target.value))}
                className="absolute inset-x-0 w-full opacity-0 h-5 cursor-pointer"
              />
            </div>
          </FormControl>
          {hint && <p className="text-[10px] text-muted-foreground/70 mt-1 leading-relaxed">{hint}</p>}
        </FormItem>
      );
    }} />
  );
}

function IrdaiComplianceBanner({ enabled, agent }: { enabled: boolean; agent?: any }) {
  if (!enabled) return null;
  const status = (agent?.agentConfig?.irdaiComplianceStatus ?? []) as Array<{ requirement: string; status: "present" | "missing"; detail: string }>;
  if (!Array.isArray(status) || status.length === 0) return null;
  const missing = status.filter((s) => s.status === "missing");
  if (missing.length > 0) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
        <p className="text-[12.5px] font-semibold text-amber-600 dark:text-amber-400">
          This agent's system prompt may not meet IRDAI guidelines
        </p>
        <ul className="list-disc pl-4 space-y-1 text-[11.5px] text-muted-foreground">
          {missing.map((m) => (
            <li key={m.requirement}>{m.detail}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <p className="text-[11.5px] text-emerald-600 dark:text-emerald-400">
      This agent's system prompt meets IRDAI guideline requirements
    </p>
  );
}

function AdvancedTab({ form, agent }: { form: any; agent?: any }) {
  const [section, setSection] = useState<AdvSection>("timing");
  const [traiConfirmOpen, setTraiConfirmOpen] = useState(false);
  const [dpdpConfirmOpen, setDpdpConfirmOpen] = useState(false);
  const [irdaiConfirmOpen, setIrdaiConfirmOpen] = useState(false);
  const bargeIn = form.watch("bargeInEnabled");
  const llmProvider = form.watch("llmProvider");
  const stagedPromptEnabled = form.watch("stagedPromptEnabled");

  const nav: { id: AdvSection; icon: React.ReactNode; label: string }[] = [
    { id: "timing",       icon: <Timer className="h-3.5 w-3.5" />,       label: "Timing"       },
    { id: "interruption", icon: <MicOff className="h-3.5 w-3.5" />,      label: "Interruption" },
    { id: "limits",       icon: <Gauge className="h-3.5 w-3.5" />,       label: "Limits"       },
    { id: "compliance",   icon: <ShieldCheck className="h-3.5 w-3.5" />, label: "Compliance"   },
    { id: "optimize",     icon: <Layers className="h-3.5 w-3.5" />,      label: "Optimize"     },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Sub-nav ── */}
      <div className="flex items-center gap-1 px-4 pt-4 pb-3 border-b border-border/40 flex-shrink-0">
        {nav.map(n => (
          <button
            key={n.id}
            type="button"
            onClick={() => setSection(n.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-medium transition-all",
              section === n.id
                ? "bg-primary/15 text-primary border border-primary/30"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
            )}
          >
            {n.icon}
            {n.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">

        {/* ── TIMING ── */}
        {section === "timing" && (
          <>
            <div>
              <h3 className="text-[13px] font-semibold text-foreground">Pipeline Latency</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Tune each stage of the STT → LLM → TTS pipeline. Lower values cut response time; higher values add reliability.
              </p>
            </div>
            <div className="space-y-5 rounded-xl border border-border/50 bg-card/40 p-4">
              <AdvSlider form={form} name="asrEndpointingSilenceMs"  label="STT Endpointing Silence"     hint="How long Azure waits after last spoken word before sending transcript. Lower = faster. Default: 400ms" min={100} max={2000} step={50}  fmt={v => `${v}ms`} />
              <AdvSlider form={form} name="ttsMinSentenceChars"       label="TTS Early Dispatch Threshold" hint="Min characters before a comma-clause fires an early TTS request mid-stream. Lower = TTS fires earlier. Default: 15" min={5}   max={200}  step={5}   fmt={v => `${v}ch`} />
              <AdvSlider form={form} name="linearDelayMs"             label="Post-Transcript Buffer"       hint="Extra wait after transcript arrives before LLM starts — helps callers who pause mid-sentence. Default: 0ms" min={0}   max={2000} step={50}  fmt={v => v === 0 ? "off" : `${v}ms`} />
              <FormField control={form.control} name="llmMaxTokens" render={({ field }) => (
                <FormItem className="space-y-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <FormLabel className="text-[12px] font-medium text-foreground/90">LLM Max Output Tokens</FormLabel>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">Cap LLM output per turn — shorter replies finish faster. Leave blank for model default</p>
                    </div>
                    <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                      {field.value ?? "auto"}
                    </span>
                  </div>
                  <FormControl>
                    <input
                      type="number" min={1} max={16000} placeholder="auto"
                      value={field.value ?? ""}
                      onChange={e => { const v = e.target.value; field.onChange(v === "" ? null : parseInt(v, 10)); }}
                      className="w-full h-8 rounded-lg border border-border/60 bg-card/40 px-3 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </FormControl>
                </FormItem>
              )} />
            </div>

            <div>
              <h3 className="text-[13px] font-semibold text-foreground">Response Timing</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Control how long the agent waits after detecting end-of-turn before it starts speaking.
              </p>
            </div>
            <div className="space-y-5 rounded-xl border border-border/50 bg-card/40 p-4">
              <AdvSlider form={form} name="startSpeakingWaitSecs"          label="Base Wait"           hint="Extra pause before any response (0 = off)"               min={0} max={5}   step={0.1}  fmt={v => `${v.toFixed(1)}s`} />
              <AdvSlider form={form} name="startSpeakingOnPunctuationSecs"  label="After Punctuation"   hint="Delay when utterance ends with . ? !"                    min={0} max={3}   step={0.05} fmt={v => `${v.toFixed(2)}s`} />
              <AdvSlider form={form} name="startSpeakingOnNoPunctuationSecs" label="After No Punctuation" hint="Delay when utterance has no terminal punctuation"        min={0} max={3}   step={0.1}  fmt={v => `${v.toFixed(1)}s`} />
              <AdvSlider form={form} name="startSpeakingOnNumberSecs"       label="After Number"        hint="Extra delay when utterance ends with a digit"            min={0} max={3}   step={0.05} fmt={v => `${v.toFixed(2)}s`} />
            </div>
          </>
        )}

        {/* ── INTERRUPTION ── */}
        {section === "interruption" && (
          <>
            <div>
              <h3 className="text-[13px] font-semibold text-foreground">Interruption Control</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Configure how caller speech interrupts the agent mid-utterance (barge-in).
              </p>
            </div>

            <FormField control={form.control} name="bargeInEnabled" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-xl border border-border/50 bg-card/40 px-4 py-3.5 gap-3">
                <div className="flex items-center gap-3">
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", field.value ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground")}>
                    <MicOff className="h-4 w-4" />
                  </div>
                  <div>
                    <FormLabel className="text-[13px] font-semibold">Allow Barge-in</FormLabel>
                    <FormDescription className="text-[11px]">Caller can interrupt the agent while it speaks</FormDescription>
                  </div>
                </div>
                <FormControl><Switch checked={field.value ?? true} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />

            {bargeIn && (
              <div className="space-y-5 rounded-xl border border-border/50 bg-card/40 p-4">
                <AdvSlider form={form} name="stopSpeakingNumWords"    label="Min Words"           hint="Caller must say this many words before barge-in fires (0 = use frames)"  min={0}   max={10}   step={1}    fmt={v => v === 0 ? "off" : `${v}w`} />
                <AdvSlider form={form} name="stopSpeakingVoiceSecs"   label="Min Voice Duration"  hint="Minimum caller voice time needed to trigger interruption"                min={0}   max={0.5}  step={0.02} fmt={v => `${v.toFixed(2)}s`} />
                <AdvSlider form={form} name="stopSpeakingBackOffSecs" label="Back-off Silence"    hint="Silence after TTS starts before barge-in becomes active"                min={0}   max={10}   step={0.1}  fmt={v => `${v.toFixed(1)}s`} />
                <FormField control={form.control} name="bargeInEnergyThreshold" render={({ field }) => {
                  const val = field.value ?? 1200;
                  const pct = ((val - 100) / (5000 - 100)) * 100;
                  return (
                    <FormItem className="space-y-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <FormLabel className="text-[12px] font-medium text-foreground/90">Energy Threshold</FormLabel>
                        <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">{val}</span>
                      </div>
                      <FormControl>
                        <div className="relative h-5 flex items-center">
                          <div className="absolute inset-x-0 h-1.5 rounded-full bg-border/60" />
                          <div className="absolute left-0 h-1.5 rounded-full bg-primary/70 pointer-events-none" style={{ width: `${pct}%` }} />
                          <input type="range" min={100} max={5000} step={100} value={val}
                            onChange={e => field.onChange(parseInt(e.target.value))}
                            className="absolute inset-x-0 w-full opacity-0 h-5 cursor-pointer" />
                        </div>
                      </FormControl>
                      <p className="text-[10px] text-muted-foreground/70 mt-1 leading-relaxed">Min RMS energy level for speech to count as a barge-in signal</p>
                    </FormItem>
                  );
                }} />
              </div>
            )}

            {!bargeIn && (
              <div className="rounded-xl border border-border/30 bg-muted/20 px-4 py-6 flex flex-col items-center text-center gap-2">
                <MicOff className="h-5 w-5 text-muted-foreground/40" />
                <p className="text-[12px] text-muted-foreground/60">Barge-in is disabled — the caller cannot interrupt the agent.</p>
              </div>
            )}
          </>
        )}

        {/* ── LIMITS ── */}
        {section === "limits" && (
          <>
            <div>
              <h3 className="text-[13px] font-semibold text-foreground">Call Limits</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Set hard boundaries on call duration and silence tolerance.
              </p>
            </div>
            <div className="space-y-5 rounded-xl border border-border/50 bg-card/40 p-4">
              <FormField control={form.control} name="silenceTimeoutSeconds" render={({ field }) => {
                const val = field.value ?? 30;
                const pct = ((val - 5) / (300 - 5)) * 100;
                return (
                  <FormItem className="space-y-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <FormLabel className="text-[12px] font-medium text-foreground/90">Silence Timeout</FormLabel>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">Hang up if caller is silent for this duration</p>
                      </div>
                      <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">{val}s</span>
                    </div>
                    <FormControl>
                      <div className="relative h-5 flex items-center">
                        <div className="absolute inset-x-0 h-1.5 rounded-full bg-border/60" />
                        <div className="absolute left-0 h-1.5 rounded-full bg-primary/70 pointer-events-none" style={{ width: `${pct}%` }} />
                        <input type="range" min={5} max={300} step={5} value={val}
                          onChange={e => field.onChange(parseInt(e.target.value))}
                          className="absolute inset-x-0 w-full opacity-0 h-5 cursor-pointer" />
                      </div>
                    </FormControl>
                    <div className="flex justify-between mt-1">
                      <span className="text-[9px] text-muted-foreground/50">5s</span>
                      <span className="text-[9px] text-muted-foreground/50">5min</span>
                    </div>
                  </FormItem>
                );
              }} />
              <div className="border-t border-border/30" />
              <FormField control={form.control} name="maxDuration" render={({ field }) => {
                const val = field.value ?? 300;
                const mins = Math.floor(val / 60);
                const secs = val % 60;
                const pct = ((val - 10) / (3600 - 10)) * 100;
                return (
                  <FormItem className="space-y-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <FormLabel className="text-[12px] font-medium text-foreground/90">Max Call Duration</FormLabel>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">Hard cut-off — call is ended after this time</p>
                      </div>
                      <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">{mins}m {secs > 0 ? `${secs}s` : ""}</span>
                    </div>
                    <FormControl>
                      <div className="relative h-5 flex items-center">
                        <div className="absolute inset-x-0 h-1.5 rounded-full bg-border/60" />
                        <div className="absolute left-0 h-1.5 rounded-full bg-primary/70 pointer-events-none" style={{ width: `${pct}%` }} />
                        <input type="range" min={10} max={3600} step={30} value={val}
                          onChange={e => field.onChange(parseInt(e.target.value))}
                          className="absolute inset-x-0 w-full opacity-0 h-5 cursor-pointer" />
                      </div>
                    </FormControl>
                    <div className="flex justify-between mt-1">
                      <span className="text-[9px] text-muted-foreground/50">10s</span>
                      <span className="text-[9px] text-muted-foreground/50">60min</span>
                    </div>
                  </FormItem>
                );
              }} />
            </div>
          </>
        )}

        {/* ── COMPLIANCE ── */}
        {section === "compliance" && (
          <>
            <div>
              <h3 className="text-[13px] font-semibold text-foreground">Compliance Frameworks</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Regulatory disclosures injected into the system prompt at runtime. Enable the frameworks that apply to your use-case.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([
                { name: "complianceIrdai", label: "IRDAI",    badge: "Insurance",   desc: "Insurance Regulatory and Development Authority of India — for insurance advisory calls"         },
                { name: "complianceDpdp",  label: "DPDP Act", badge: "Data Privacy", desc: "Digital Personal Data Protection Act 2023 — when collecting personal data from callers"       },
                { name: "complianceHipaa", label: "HIPAA",    badge: "Healthcare",  desc: "Health Insurance Portability and Accountability Act — for healthcare-related calls"           },
                { name: "complianceTrai",  label: "TRAI",     badge: "Telecom",     desc: "Telecom Regulatory Authority of India — for commercial communications; includes opt-out"      },
              ] as const).map(({ name, label, badge, desc }) => (
                <FormField key={name} control={form.control} name={name} render={({ field }) => {
                  // TRAI/DPDP/IRDAI: intercept OFF→ON to require confirmation; ON→OFF stays immediate.
                  const isTrai = name === "complianceTrai";
                  const isDpdp = name === "complianceDpdp";
                  const isIrdai = name === "complianceIrdai";
                  const setValue = (next: boolean) => {
                    if (isTrai && next && !field.value) { setTraiConfirmOpen(true); return; }
                    if (isDpdp && next && !field.value) { setDpdpConfirmOpen(true); return; }
                    if (isIrdai && next && !field.value) { setIrdaiConfirmOpen(true); return; }
                    field.onChange(next);
                  };
                  return (
                  <FormItem
                    className={cn(
                      "rounded-xl border p-4 cursor-pointer transition-all space-y-0",
                      field.value
                        ? "border-primary/40 bg-primary/5"
                        : "border-border/50 bg-card/40 hover:border-border",
                    )}
                    onClick={() => setValue(!field.value)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[12.5px] font-bold text-foreground">{label}</span>
                        </div>
                        <span className={cn("text-[9.5px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded", field.value ? "bg-primary/20 text-primary" : "bg-muted/60 text-muted-foreground")}>
                          {badge}
                        </span>
                      </div>
                      <FormControl>
                        <Switch checked={!!field.value} onCheckedChange={setValue} onClick={e => e.stopPropagation()} className="shrink-0" />
                      </FormControl>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed mt-2.5">{desc}</p>
                  </FormItem>
                  );
                }} />
              ))}
            </div>

            <AlertDialog open={traiConfirmOpen} onOpenChange={setTraiConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Enable TRAI Compliance</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2.5 text-[12px] text-muted-foreground">
                      <p>Enabling TRAI compliance changes how this agent makes calls:</p>
                      <ul className="list-disc pl-4 space-y-1.5">
                        <li>Calls are blocked outside <span className="font-medium text-foreground">9 AM–9 PM</span> (IST).</li>
                        <li>Numbers on the suppression list are <span className="font-medium text-foreground">not dialed</span>.</li>
                        <li>An <span className="font-medium text-foreground">opt-out disclosure</span> is added to the agent's prompt.</li>
                        <li>Caller opt-out requests are <span className="font-medium text-foreground">auto-detected and suppressed</span> for future calls.</li>
                      </ul>
                      <p className="text-[11px] text-muted-foreground/80">
                        This applies to all calls made by this agent going forward. It does not affect past calls.
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setTraiConfirmOpen(false)}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      form.setValue("complianceTrai", true, { shouldDirty: true });
                      setTraiConfirmOpen(false);
                    }}
                  >
                    Confirm &amp; Enable
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={dpdpConfirmOpen} onOpenChange={setDpdpConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Enable DPDP Act Compliance</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2.5 text-[12px] text-muted-foreground">
                      <p>Enabling DPDP compliance adds data-protection safeguards to this agent:</p>
                      <ul className="list-disc pl-4 space-y-1.5">
                        <li>A <span className="font-medium text-foreground">data-purpose disclosure</span> is added to the agent's prompt.</li>
                        <li>Personal data in transcripts is <span className="font-medium text-foreground">flagged for redaction</span> in analytics.</li>
                        <li>Call data is <span className="font-medium text-foreground">automatically anonymized</span> after the retention period (default 180 days).</li>
                        <li>Campaigns using this agent require a <span className="font-medium text-foreground">documented consent basis</span> before launch.</li>
                      </ul>
                      <p className="text-[11px] text-muted-foreground/80">
                        These are audit and privacy safeguards only — they never block or delay calls from dialing.
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setDpdpConfirmOpen(false)}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      form.setValue("complianceDpdp", true, { shouldDirty: true });
                      setDpdpConfirmOpen(false);
                    }}
                  >
                    Confirm &amp; Enable
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={irdaiConfirmOpen} onOpenChange={setIrdaiConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Enable IRDAI Compliance</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2.5 text-[12px] text-muted-foreground">
                      <p>Enabling IRDAI compliance checks this agent's saved system prompt against IRDAI disclosure guidelines:</p>
                      <ul className="list-disc pl-4 space-y-1.5">
                        <li>The prompt is checked for <span className="font-medium text-foreground">insurer identification</span> and a <span className="font-medium text-foreground">call-recording disclosure</span>.</li>
                        <li>It flags any <span className="font-medium text-foreground">guaranteed-outcome language</span> and missing <span className="font-medium text-foreground">indicative-quote</span> disclosures.</li>
                        <li>It checks for <span className="font-medium text-foreground">grievance redressal</span> details and <span className="font-medium text-foreground">human handoff for claim decisions</span>.</li>
                        <li>A warning is shown if any disclosures are missing — this <span className="font-medium text-foreground">does not block calls or saving</span>.</li>
                      </ul>
                      <p className="text-[11px] text-muted-foreground/80">
                        This is an informational check only. It does not alter call behavior or block any action.
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setIrdaiConfirmOpen(false)}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      form.setValue("complianceIrdai", true, { shouldDirty: true });
                      setIrdaiConfirmOpen(false);
                    }}
                  >
                    Confirm &amp; Enable
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <IrdaiComplianceBanner enabled={!!form.watch("complianceIrdai")} agent={agent} />
          </>
        )}

        {/* ── OPTIMIZE ── */}
        {section === "optimize" && (
          <>
            <div>
              <h3 className="text-[13px] font-semibold text-foreground">Token Optimization</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Reduce LLM token usage to lower costs. Each layer is independent.
              </p>
            </div>

            {/* KV Cache */}
            {(() => {
              const kvCacheTooltips: Record<string, string> = {
                anthropic: "Explicit prompt caching — VoiceOrch sends cache_control breakpoints so Anthropic caches your system prompt server-side after turn 1, saving ~5× on repeated input tokens.",
                gemini: "Google auto-caches prompts >1024 tokens on their end — no explicit configuration needed. Savings appear automatically in your Google AI usage.",
                openai: "OpenAI silently caches prompts >1024 tokens at no extra cost — no explicit configuration needed.",
              };
              const kvCacheTooltip = kvCacheTooltips[llmProvider ?? ""] ??
                "This provider does not currently support prompt caching. Consider Sliding Window or Summarization to reduce token costs.";
              return (
                <div className="rounded-xl border border-border/50 bg-card/40 px-4 py-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", llmProvider === "anthropic" ? "bg-amber-500/15 text-amber-400" : "bg-muted/40 text-muted-foreground/50")}>
                      <Zap className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[12.5px] font-semibold text-foreground">KV Cache <span className="text-[10px] text-muted-foreground font-normal ml-1">Anthropic only</span></p>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">Auto-enabled — caches system prompt, saving ~5× on repeated input tokens</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-default">
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-[260px] text-[11px] leading-relaxed">
                        {kvCacheTooltip}
                      </TooltipContent>
                    </Tooltip>
                    <span className={cn("text-[10.5px] font-semibold px-2.5 py-1 rounded-lg", llmProvider === "anthropic" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-muted/40 text-muted-foreground border border-border/40")}>
                      {llmProvider === "anthropic" ? "Active" : "N/A"}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Sliding Window */}
            <FormField control={form.control} name="contextWindowTurns" render={({ field }) => (
              <FormItem className="rounded-xl border border-border/50 bg-card/40 px-4 py-3.5 space-y-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
                      <Layers className="h-4 w-4" />
                    </div>
                    <div>
                      <FormLabel className="text-[12.5px] font-semibold">Sliding Window Context</FormLabel>
                      <FormDescription className="text-[10px]">Limit past turns sent — older turns dropped. Blank = full history.</FormDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] text-muted-foreground">Last</span>
                    <FormControl>
                      <Input type="number" min={1} max={1000} placeholder="∞"
                        className="w-14 h-7 text-xs text-center"
                        value={field.value == null ? "" : String(field.value)}
                        onChange={(e) => field.onChange(e.target.value === "" ? undefined : parseInt(e.target.value, 10))}
                      />
                    </FormControl>
                    <span className="text-[10px] text-muted-foreground">turns</span>
                  </div>
                </div>
                <FormMessage />
              </FormItem>
            )} />

            {/* Auto Summarization (post-call summary) */}
            <FormField control={form.control} name="summarizationEnabled" render={({ field }) => (
              <FormItem className={cn("rounded-xl border bg-card/40 px-4 py-3.5 space-y-0 transition-colors", field.value ? "border-primary/30" : "border-border/50")}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", field.value ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground/50")}>
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <FormLabel className="text-[12.5px] font-semibold">Auto Summarization</FormLabel>
                      <FormDescription className="text-[10px]">Generate a concise AI summary for every completed call, shown in the call log</FormDescription>
                    </div>
                  </div>
                  <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                </div>
              </FormItem>
            )} />

            {/* Staged Prompt */}
            <FormField control={form.control} name="stagedPromptEnabled" render={({ field }) => (
              <FormItem className={cn("rounded-xl border bg-card/40 px-4 py-3.5 space-y-0 transition-colors", field.value ? "border-primary/30" : "border-border/50")}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", field.value ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground/50")}>
                      <FileText className="h-4 w-4" />
                    </div>
                    <div>
                      <FormLabel className="text-[12.5px] font-semibold">Staged System Prompt</FormLabel>
                      <FormDescription className="text-[10px]">Stage-specific prompts per conversation phase — LLM signals via <code className="bg-muted px-1 rounded">[STAGE:Name]</code></FormDescription>
                    </div>
                  </div>
                  <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                </div>
                {stagedPromptEnabled && (
                  <div className="mt-3 pt-3 border-t border-border/40 space-y-3">
                    <FormField control={form.control} name="stagedPromptCoreIdentity" render={({ field: idf }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Core Identity <span className="text-muted-foreground font-normal">(always included)</span></FormLabel>
                        <FormControl>
                          <Textarea className="min-h-[60px] text-xs"
                            placeholder="You are a helpful assistant for Acme Corp. Always be polite and professional."
                            {...idf} />
                        </FormControl>
                        <FormDescription className="text-[10px]">Prepended to every stage prompt — name, role, tone only.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <StagedPromptEditor control={form.control} />
                  </div>
                )}
              </FormItem>
            )} />
          </>
        )}

      </div>
    </div>
  );
}

/* ── Agent list panel ───────────────────────────────────────────────────────── */

function AgentListPanel({ selectedId, onSelect, rateMap }: {
  selectedId: number | null;
  onSelect: (id: number) => void;
  rateMap: Map<string, number>;
}) {
  const [search, setSearch] = useState("");
  const { data: agents, isLoading } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });
  const createAgent = useCreateAgent();
  const { toast } = useToast();
  const userProviderNames = useUserProviderNames();

  const handleCreate = () => {
    createAgent.mutate(
      { data: { name: "New Agent", asrProvider: "azure", asrModel: "en-US-standard", llmProvider: "openai", llmModel: "gpt-4o-mini", ttsProvider: "cartesia", ttsVoice: "", ttsModel: "", telephonyProvider: "vobiz", systemPrompt: "You are a helpful AI voice assistant.", greetingMessage: "Hello", language: "en-US" } as any },
      { onSuccess: (agent) => onSelect(agent.id), onError: (err: unknown) => toast({ title: "Error", description: formatApiError(err), variant: "destructive" }) }
    );
  };

  const filtered = (agents ?? []).filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="w-[240px] shrink-0 border-r border-border/60 flex flex-col h-full bg-background/40">
      <div className="p-3 border-b border-border/60 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agents</span>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCreate} disabled={createAgent.isPending}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…" className="h-7 pl-6 text-xs" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-3 py-2.5"><Skeleton className="h-4 w-3/4 mb-1.5" /><Skeleton className="h-3 w-1/2" /></div>
        ))}
        {!isLoading && filtered.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-muted-foreground">No agents yet</p>
            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={handleCreate} disabled={createAgent.isPending}>
              <Plus className="h-3 w-3 mr-1" /> Create
            </Button>
          </div>
        )}
        {filtered.map(agent => {
          const isSelected = agent.id === selectedId;
          const costCents = computeAgentRateCents(rateMap, agent as any, userProviderNames);
          return (
            <button key={agent.id} onClick={() => onSelect(agent.id)}
              className={`w-full text-left px-3 py-2.5 hover:bg-accent/50 transition-colors border-b border-border/30 last:border-0 ${isSelected ? "bg-accent" : ""}`}>
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-xs font-medium truncate">{agent.name}</span>
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${agent.status === "active" ? "bg-green-400" : "bg-muted-foreground/40"}`} />
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-muted-foreground truncate">{agent.asrProvider} · {agent.ttsProvider}</span>
                {costCents ? <span className="text-[10px] text-muted-foreground ml-auto shrink-0">~${(costCents / 100).toFixed(3)}/m</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Tab: Analysis ──────────────────────────────────────────────────────────── */

type DispositionCategory = { id: string; name: string; values: string };

function AnalysisTab({ form, agentId }: { form: any; agentId: number }) {
  const { toast } = useToast();

  // ── Disposition config state ──────────────────────────────────────────────
  const [categories, setCategories] = useState<DispositionCategory[]>([]);
  const [dirty, setDirty] = useState(false);

  const { data: dispConfig, isLoading: dispLoading } = useQuery<{ taxonomy: Record<string, string[]> } | null>({
    queryKey: ["disposition-config", agentId],
    queryFn: async () => {
      try {
        return await customFetch<{ taxonomy: Record<string, string[]> }>(`${DASH_API}/disposition/config/${agentId}`);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
    enabled: agentId > 0,
  });

  useEffect(() => {
    if (dispConfig?.taxonomy) {
      setCategories(
        Object.entries(dispConfig.taxonomy).map(([name, vals]) => ({
          id: crypto.randomUUID(),
          name,
          values: vals.join(", "),
        })),
      );
    }
    setDirty(false);
  }, [dispConfig]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const taxonomy: Record<string, string[]> = {};
      for (const cat of categories) {
        const name = cat.name.trim();
        if (!name) continue;
        taxonomy[name] = cat.values
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
      }
      await customFetch(`${DASH_API}/disposition/config/${agentId}`, {
        method: "PUT",
        body: JSON.stringify({ taxonomy }),
      });
    },
    onSuccess: () => {
      toast({ title: "Disposition config saved" });
      setDirty(false);
    },
    onError: () => {
      toast({ title: "Failed to save", variant: "destructive" });
    },
  });

  function addCategory() {
    setCategories((prev) => [...prev, { id: crypto.randomUUID(), name: "", values: "" }]);
    setDirty(true);
  }

  function removeCategory(id: string) {
    setCategories((prev) => prev.filter((c) => c.id !== id));
    setDirty(true);
  }

  function updateCategory(id: string, field: "name" | "values", value: string) {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
    setDirty(true);
  }
  return (
    <div className="relative p-6 overflow-y-auto h-full space-y-8">

      {/* ── Webhook ── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Webhook className="h-4 w-4 text-violet-400" />
          <h3 className="text-sm font-semibold">Post-call Webhook</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          When a call ends we'll POST the full call data (transcript, duration, cost, disposition) to this URL.
        </p>
        <div className="space-y-3">
          <FormField control={form.control} name="webhookUrl" render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">Webhook URL</FormLabel>
              <FormControl>
                <Input
                  placeholder="https://your-server.com/voiceorch-webhook"
                  className="h-9 text-sm font-mono bg-background/50"
                  {...field}
                />
              </FormControl>
              <FormDescription className="text-[10px]">
                Must be HTTPS. We send a JSON payload with <code className="font-mono bg-muted px-0.5 rounded">callId</code>, <code className="font-mono bg-muted px-0.5 rounded">status</code>, <code className="font-mono bg-muted px-0.5 rounded">transcript</code>, <code className="font-mono bg-muted px-0.5 rounded">disposition</code> and more.
              </FormDescription>
            </FormItem>
          )} />
          <FormField control={form.control} name="webhookSecret" render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">Signing Secret (optional)</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder="Shared HMAC secret for signature verification"
                  className="h-9 text-xs bg-background/50"
                  {...field}
                />
              </FormControl>
              <FormDescription className="text-[10px]">
                Sent as <code className="font-mono bg-muted px-0.5 rounded">X-Webhook-Signature</code> header so you can verify the payload wasn't tampered with.
              </FormDescription>
            </FormItem>
          )} />
        </div>
      </div>

      {/* ── Call Disposition ── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold">Call Disposition</h3>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={addCategory}
          >
            <Plus className="h-3.5 w-3.5" /> Add Category
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Define categories and their possible values. After each call the AI automatically picks the best match from the transcript and saves it. Results appear in the call detail page.
        </p>

        {dispLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-muted/20 animate-pulse" />)}
          </div>
        ) : categories.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
            <Tag className="h-7 w-7 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm font-medium text-muted-foreground/50">No categories yet</p>
            <p className="text-xs text-muted-foreground/30 mt-0.5">Add a category to start capturing structured call outcomes</p>
          </div>
        ) : (
          <div className="space-y-3">
            {categories.map((cat) => (
              <div key={cat.id} className="rounded-xl border border-border/60 bg-card/20 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Category name</label>
                      <Input
                        className="h-8 text-xs"
                        placeholder="e.g. intent"
                        value={cat.name}
                        onChange={(e) => updateCategory(cat.id, "name", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Possible values <span className="normal-case">(comma-separated)</span></label>
                      <Input
                        className="h-8 text-xs"
                        placeholder="e.g. interested, not_interested, callback"
                        value={cat.values}
                        onChange={(e) => updateCategory(cat.id, "values", e.target.value)}
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 mt-5 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => removeCategory(cat.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {cat.values && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {cat.values.split(",").map((v) => v.trim()).filter(Boolean).map((v) => (
                      <span key={v} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        {v}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {(categories.length > 0 || dirty) && (
          <div className="flex justify-end mt-4">
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs gap-1.5"
              disabled={saveMutation.isPending || !dirty}
              onClick={() => saveMutation.mutate()}
            >
              <Save className="h-3.5 w-3.5" />
              {saveMutation.isPending ? "Saving…" : "Save Disposition Config"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Logs tab ───────────────────────────────────────────────────────────────── */

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed", failed: "Failed", in_progress: "In Progress",
  pending: "Pending", cancelled: "Cancelled", transferred: "Transferred",
  booked: "Booked", callback_scheduled: "Callback", voicemail: "Voicemail",
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  completed:         { bg: "bg-emerald-500/10", text: "text-emerald-400" },
  failed:            { bg: "bg-red-500/10",     text: "text-red-400" },
  in_progress:       { bg: "bg-blue-500/10",    text: "text-blue-400" },
  pending:           { bg: "bg-zinc-500/10",    text: "text-zinc-400" },
  cancelled:         { bg: "bg-zinc-500/10",    text: "text-zinc-400" },
  transferred:       { bg: "bg-amber-500/10",   text: "text-amber-400" },
  booked:            { bg: "bg-teal-500/10",    text: "text-teal-400" },
  callback_scheduled:{ bg: "bg-orange-500/10",  text: "text-orange-400" },
  voicemail:         { bg: "bg-purple-500/10",  text: "text-purple-400" },
};

function LogsTab({ agentId }: { agentId: number }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter,   setTypeFilter]   = useState("all");
  const [search,       setSearch]       = useState("");
  const [page,         setPage]         = useState(1);
  const PAGE_SIZE = 25;

  const { data: calls = [], isLoading } = useListCalls(
    { agentId },
    { query: { queryKey: getListCallsQueryKey({ agentId }) } }
  );

  const filtered = useMemo(() => {
    let r = [...calls];
    if (statusFilter !== "all") r = r.filter(c => c.status === statusFilter);
    if (typeFilter !== "all") {
      r = r.filter(c =>
        typeFilter === "webcall" ? (!c.toNumber || c.toNumber === "") : !!(c.toNumber)
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(c =>
        String(c.id).includes(q) ||
        c.toNumber?.toLowerCase().includes(q) ||
        c.fromNumber?.toLowerCase().includes(q)
      );
    }
    return r;
  }, [calls, statusFilter, typeFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const fmtDur = (s?: number | null) => {
    if (!s) return "—";
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
          <Input
            className="h-8 pl-8 w-48 text-xs bg-background/50"
            placeholder="Call ID or phone…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="h-8 text-xs w-36 bg-background/50">
            <SelectValue placeholder="Call Types" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all" className="text-xs">All Types</SelectItem>
            <SelectItem value="webcall" className="text-xs">Webcall</SelectItem>
            <SelectItem value="telephony" className="text-xs">Telephony</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="h-8 text-xs w-36 bg-background/50">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
            <SelectItem value="completed" className="text-xs">Completed</SelectItem>
            <SelectItem value="failed" className="text-xs">Failed</SelectItem>
            <SelectItem value="in_progress" className="text-xs">In Progress</SelectItem>
            <SelectItem value="pending" className="text-xs">Pending</SelectItem>
            <SelectItem value="cancelled" className="text-xs">Cancelled</SelectItem>
            <SelectItem value="transferred" className="text-xs">Transferred</SelectItem>
            <SelectItem value="booked" className="text-xs">Booked</SelectItem>
            <SelectItem value="voicemail" className="text-xs">Voicemail</SelectItem>
          </SelectContent>
        </Select>

        <span className="ml-auto text-[10px] text-muted-foreground/30">
          {filtered.length} call{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="relative flex-1 overflow-auto min-h-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 h-9 w-[110px]">Type</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 h-9 w-[80px]">Call ID</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 h-9">Phone Number</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 h-9 w-[110px]">Status</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 h-9 w-[130px]">Start Time</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 h-9 w-[90px]">Duration</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 h-9 w-[80px]">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i} className="border-b border-border/40">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j} className="py-3"><Skeleton className="h-3 w-16" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : pageItems.length > 0 ? (
              pageItems.map(call => {
                const isWeb = !call.toNumber || call.toNumber.trim() === "";
                const costCents = (call as any).costCents ?? 0;
                const sc = STATUS_COLORS[call.status] ?? { bg: "bg-zinc-500/10", text: "text-zinc-400" };
                return (
                  <TableRow key={call.id} className="hover:bg-muted/20 border-b border-border/40 cursor-default">
                    <TableCell className="py-2.5">
                      <span className={cn(
                        "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded",
                        isWeb ? "bg-cyan-500/10 text-cyan-400" : "bg-violet-500/10 text-violet-400"
                      )}>
                        {isWeb ? <Globe className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
                        {isWeb ? "Webcall" : "Telephony"}
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5 font-mono text-[10px] text-muted-foreground/40">
                      #{call.id}
                    </TableCell>
                    <TableCell className="py-2.5 font-mono text-xs text-foreground/70">
                      {call.toNumber || call.fromNumber || <span className="text-muted-foreground/25">—</span>}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <span className={cn("inline-block text-[10px] font-medium px-1.5 py-0.5 rounded", sc.bg, sc.text)}>
                        {STATUS_LABELS[call.status] ?? call.status}
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5 text-[11px] text-muted-foreground/50 whitespace-nowrap">
                      {format(parseISO(call.createdAt), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell className="py-2.5 font-mono text-xs text-muted-foreground/50">
                      {fmtDur(call.durationSeconds)}
                    </TableCell>
                    <TableCell className="py-2.5 font-mono text-xs text-muted-foreground/50">
                      {costCents > 0 ? `$${(costCents / 100).toFixed(3)}` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-64">
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                    <div className="h-12 w-12 rounded-full bg-muted/20 flex items-center justify-center">
                      <Phone className="h-5 w-5 text-muted-foreground/20" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground/50">No call logs available</p>
                      <p className="text-xs text-muted-foreground/30 mt-0.5">There are no items to display at this time.</p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination footer */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-border text-[11px] text-muted-foreground/40">
        <div className="flex items-center gap-1">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
            className="px-2 py-1 rounded hover:bg-muted/30 disabled:opacity-30 disabled:cursor-not-allowed"
          >‹</button>
          <span className="px-2">Page {page}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="px-2 py-1 rounded hover:bg-muted/30 disabled:opacity-30 disabled:cursor-not-allowed"
          >›</button>
        </div>
        <div className="flex items-center gap-1.5">
          <span>Rows per page</span>
          <span className="font-semibold text-foreground/50">{PAGE_SIZE}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Version status badge ────────────────────────────────────────────────────── */

function VersionStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; className: string }> = {
    production: { label: "Production",  className: "bg-green-500/15 text-green-400 border-green-500/30" },
    published:  { label: "Published",   className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    draft:      { label: "Draft",       className: "bg-muted/40 text-muted-foreground border-border" },
    restored:   { label: "Restored",    className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    archived:   { label: "Archived",    className: "bg-muted/20 text-muted-foreground/60 border-border/40" },
    deprecated: { label: "Deprecated",  className: "bg-muted/20 text-muted-foreground/60 border-border/40" },
  };
  const { label, className } = cfg[status] ?? cfg["draft"]!;
  return <Badge variant="outline" className={cn("text-[10px] h-5 px-1.5", className)}>{label}</Badge>;
}

/* ── Publish version modal ───────────────────────────────────────────────────── */

const VERSION_LIMIT = 10;

function PublishVersionModal({
  open, onOpenChange, agentId, onSuccess, publishedCount,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agentId: number;
  onSuccess: (v: AgentVersion) => void;
  publishedCount: number;
}) {
  const [versionName, setVersionName] = useState("");
  const [commitDesc, setCommitDesc] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [limitReached, setLimitReached] = useState(false);
  const { toast } = useToast();
  const publish = usePublishAgentVersion();

  const isAtLimit = publishedCount >= VERSION_LIMIT;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!versionName.trim()) return;
    if (!commitDesc.trim()) return;
    if (isAtLimit) { setLimitReached(true); return; }
    try {
      const result = await publish.mutateAsync({
        id: agentId,
        data: {
          versionName: versionName.trim(),
          commitDescription: commitDesc.trim(),
          releaseNotes: releaseNotes.trim() || undefined,
        },
      });
      toast({ title: `Published ${result.versionNumber}`, description: `"${result.versionName}" is now live in Production.` });
      setVersionName(""); setCommitDesc(""); setReleaseNotes("");
      onOpenChange(false);
      onSuccess(result);
    } catch (err: any) {
      const errorCode = err?.response?.data?.error ?? err?.data?.error;
      if (errorCode === "VERSION_LIMIT_REACHED") {
        setLimitReached(true);
        return;
      }
      toast({ title: "Publish failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  };

  if (limitReached) {
    return (
      <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) setLimitReached(false); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive" /> Maximum Published Versions Reached
            </DialogTitle>
            <DialogDescription>
              You have reached the limit of <strong>{VERSION_LIMIT} published versions</strong>. Archive older versions to free up space before publishing a new one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => { onOpenChange(false); setLimitReached(false); }}>Cancel</Button>
            <Button
              type="button"
              onClick={() => { onOpenChange(false); setLimitReached(false); }}
              className="gap-1.5"
            >
              <Archive className="h-3.5 w-3.5" /> Manage Versions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" /> Publish New Version
          </DialogTitle>
          <DialogDescription>
            Snapshot the current agent config and promote it to Production. The previous Production version becomes Published (frozen).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Version name <span className="text-destructive">*</span></label>
            <Input
              value={versionName}
              onChange={e => setVersionName(e.target.value)}
              placeholder="e.g. Initial release, Customer support v2…"
              className="h-9"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">What changed? <span className="text-destructive">*</span></label>
            <Textarea
              value={commitDesc}
              onChange={e => setCommitDesc(e.target.value)}
              placeholder="Describe the key changes in this version…"
              className="min-h-[80px] text-sm resize-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Release notes <span className="text-[10px]">(optional)</span></label>
            <Textarea
              value={releaseNotes}
              onChange={e => setReleaseNotes(e.target.value)}
              placeholder="Additional notes for stakeholders…"
              className="min-h-[60px] text-sm resize-none"
            />
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            <span>A new draft is automatically kept on the live agent row — you can keep editing after publishing.</span>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="submit"
              disabled={publish.isPending || !versionName.trim() || !commitDesc.trim() || isAtLimit}
              className="gap-1.5"
            >
              <Upload className="h-3.5 w-3.5" />
              {publish.isPending ? "Publishing…" : "Publish Version"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Publish version modal wrapper (fetches publishedCount) ─────────────────── */

function PublishVersionModalWrapper({
  open, onOpenChange, agentId, onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agentId: number;
  onSuccess: (v: AgentVersion) => void;
}) {
  const { data: listData } = useListAgentVersions(agentId);
  const publishedCount = listData?.publishedCount ?? 0;

  return (
    <PublishVersionModal
      open={open}
      onOpenChange={onOpenChange}
      agentId={agentId}
      onSuccess={onSuccess}
      publishedCount={publishedCount}
    />
  );
}

/* ── Compare view (frontend-only diff) ───────────────────────────────────────── */

const COMPARE_SECTIONS: Array<{ label: string; keys: string[] }> = [
  { label: "Prompt",        keys: ["systemPrompt", "greetingMessage", "endCallPhrases"] },
  { label: "ASR",           keys: ["asrProvider", "asrModel", "asrLanguage", "asrBackgroundDenoising", "asrConfidenceThreshold", "asrKeyterms", "asrSmartEndpointing"] },
  { label: "LLM",           keys: ["llmProvider", "llmModel", "temperature"] },
  { label: "TTS / Voice",   keys: ["ttsProvider", "ttsVoice", "ttsModel"] },
  { label: "Telephony",     keys: ["telephonyProvider"] },
  { label: "Call Settings", keys: ["maxDuration", "silenceTimeoutSeconds", "language", "webhookUrl", "noiseCancellationEnabled", "backchannelingEnabled"] },
  { label: "Advanced",      keys: ["agentConfig"] },
];

function normalizeForDiff(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isTextValue(raw: unknown, rendered: string): boolean {
  if (typeof raw === "boolean" || typeof raw === "number") return false;
  if (typeof raw === "object" && raw !== null) return true;
  return /[\s\n]/.test(rendered) || rendered.length > 40;
}

function WordDiff({ oldText, newText, ignoreFormatting }: { oldText: string; newText: string; ignoreFormatting: boolean }) {
  const changes = useMemo(() => {
    const a = ignoreFormatting ? normalizeForDiff(oldText) : oldText;
    const b = ignoreFormatting ? normalizeForDiff(newText) : newText;
    return ignoreFormatting ? diffWords(a, b) : diffWordsWithSpace(a, b);
  }, [oldText, newText, ignoreFormatting]);

  const oldParts = changes.filter(c => !c.added);
  const newParts = changes.filter(c => !c.removed);

  return (
    <div className="flex gap-3">
      <pre className="whitespace-pre-wrap break-all font-mono text-[11px] flex-1 leading-relaxed">
        {oldParts.map((c, i) =>
          c.removed ? (
            <span key={i} className="bg-red-500/15 text-red-400 line-through rounded-sm px-0.5">{c.value}</span>
          ) : (
            <span key={i}>{c.value}</span>
          )
        )}
      </pre>
      <pre className="whitespace-pre-wrap break-all font-mono text-[11px] flex-1 leading-relaxed">
        {newParts.map((c, i) =>
          c.added ? (
            <span key={i} className="bg-green-500/15 text-green-400 rounded-sm px-0.5">{c.value}</span>
          ) : (
            <span key={i}>{c.value}</span>
          )
        )}
      </pre>
    </div>
  );
}

function CompareView({
  agentId, baseVersion, allVersions,
  onClose,
}: {
  agentId: number;
  baseVersion: AgentVersion;
  allVersions: VersionSummary[];
  onClose: () => void;
}) {
  const [compareId, setCompareId] = useState<number | null>(null);
  const [ignoreFormatting, setIgnoreFormatting] = useState(true);
  const compareTarget = allVersions.find(v => v.id === compareId);

  const { data: baseSnap } = useGetAgentVersion(agentId, baseVersion.id, {
    query: { queryKey: getGetAgentVersionQueryKey(agentId, baseVersion.id) },
  });
  const { data: compareSnap } = useGetAgentVersion(agentId, compareId ?? -1, {
    query: {
      queryKey: getGetAgentVersionQueryKey(agentId, compareId ?? -1),
      enabled: compareId != null,
    },
  });

  const otherVersions = allVersions.filter(v => v.id !== baseVersion.id);

  const renderValue = (val: unknown): string => {
    if (val === null || val === undefined) return "—";
    if (typeof val === "object") return JSON.stringify(val, null, 2);
    return String(val);
  };

  const renderDiff = (section: typeof COMPARE_SECTIONS[number]) => {
    const a = (baseSnap?.snapshot ?? {}) as Record<string, unknown>;
    const b = (compareSnap?.snapshot ?? {}) as Record<string, unknown>;
    return section.keys.map(key => {
      const aRaw = a[key];
      const bRaw = b[key];
      const aVal = renderValue(aRaw);
      const bVal = renderValue(bRaw);
      const changed = aVal !== bVal;
      const useWordDiff = changed && (isTextValue(aRaw, aVal) || isTextValue(bRaw, bVal));

      if (useWordDiff) {
        return (
          <tr key={key} className="bg-yellow-500/5">
            <td className="py-1.5 pr-3 text-[10px] text-muted-foreground font-mono align-top w-32 shrink-0">{key}</td>
            <td colSpan={2} className="py-1.5 pr-3 text-[11px] align-top">
              <WordDiff oldText={aVal} newText={compareSnap ? bVal : "—"} ignoreFormatting={ignoreFormatting} />
            </td>
          </tr>
        );
      }

      return (
        <tr key={key} className={changed ? "bg-yellow-500/5" : ""}>
          <td className="py-1.5 pr-3 text-[10px] text-muted-foreground font-mono align-top w-32 shrink-0">{key}</td>
          <td className={cn("py-1.5 pr-3 text-[11px] align-top", changed && "text-red-400 line-through opacity-60")}>
            <pre className="whitespace-pre-wrap break-all font-mono">{aVal}</pre>
          </td>
          <td className={cn("py-1.5 text-[11px] align-top", changed && "text-green-400")}>
            {compareSnap ? <pre className="whitespace-pre-wrap break-all font-mono">{bVal}</pre> : <span className="text-muted-foreground/40 italic">—</span>}
          </td>
        </tr>
      );
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border/60 shrink-0 flex-wrap">
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
        <ArrowLeftRight className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">Compare Versions</span>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <Switch
              checked={ignoreFormatting}
              onCheckedChange={setIgnoreFormatting}
              className="scale-75 origin-left"
            />
            <span className="text-[11px] text-muted-foreground">Ignore Formatting</span>
          </label>
          <span className="text-xs text-muted-foreground">Comparing</span>
          <Badge variant="outline" className="text-[10px]">{baseVersion.versionNumber}: {baseVersion.versionName}</Badge>
          <span className="text-xs text-muted-foreground">vs</span>
          <Select value={compareId != null ? String(compareId) : "__none__"} onValueChange={v => setCompareId(v === "__none__" ? null : parseInt(v, 10))}>
            <SelectTrigger className="h-7 w-48 text-xs">
              <SelectValue placeholder="Pick version…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs">Pick version…</SelectItem>
              {otherVersions.map(v => (
                <SelectItem key={v.id} value={String(v.id)} className="text-xs">{v.versionNumber}: {v.versionName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {!compareId && (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            Select a version to compare against
          </div>
        )}
        {compareId && COMPARE_SECTIONS.map(section => (
          <div key={section.label} className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{section.label}</div>
            <div className="rounded-lg border border-border/50 overflow-hidden">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    <th className="text-left py-1.5 px-3 font-medium text-[10px] text-muted-foreground w-32">Field</th>
                    <th className="text-left py-1.5 px-3 font-medium text-[10px] text-muted-foreground">{baseVersion.versionNumber}</th>
                    <th className="text-left py-1.5 px-3 font-medium text-[10px] text-muted-foreground">{compareTarget?.versionNumber ?? "…"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {renderDiff(section)}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Version card ────────────────────────────────────────────────────────────── */

type VersionSummary = Omit<AgentVersion, "snapshot">;

function VersionCard({
  v,
  onCompare,
  onRestore,
  onArchive,
  restorePending,
  archivePending,
  showArchiveAction,
}: {
  v: VersionSummary;
  onCompare: () => void;
  onRestore: () => void;
  onArchive?: () => void;
  restorePending: boolean;
  archivePending: boolean;
  showArchiveAction: boolean;
}) {
  const isArchived = v.status === "archived";
  const changedFields = (v as any).changedFields as string[] | null | undefined;

  return (
    <div className={cn(
      "flex items-start gap-4 px-5 py-4 hover:bg-muted/10 transition-colors",
      isArchived && "opacity-60",
    )}>
      {/* Timeline node */}
      <div className="shrink-0 mt-1 flex flex-col items-center gap-1">
        <div className={cn(
          "h-7 w-10 rounded-md border text-[11px] font-mono font-bold flex items-center justify-center",
          v.status === "production" ? "bg-green-500/15 border-green-500/40 text-green-400" :
          v.status === "published"  ? "bg-blue-500/15 border-blue-500/30 text-blue-400" :
          v.status === "archived"   ? "bg-muted/20 border-border/30 text-muted-foreground/50" :
          "bg-muted/30 border-border/50 text-foreground/80",
        )}>
          {v.versionNumber}
        </div>
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-sm font-semibold truncate", isArchived && "text-muted-foreground")}>{v.versionName}</span>
          <VersionStatusBadge status={v.status} />
          {v.restoredFromVersionId && (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-muted-foreground">
              <RotateCcw className="h-2.5 w-2.5 mr-1" /> restored
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">{v.commitDescription}</p>

        {/* Changed fields pills */}
        {changedFields && changedFields.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {changedFields.map((label) => (
              <span key={label} className="inline-flex items-center rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground font-medium">
                {label}
              </span>
            ))}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
          {v.publishedBy && (
            <>
              <User2 className="h-2.5 w-2.5" />
              <span className="font-mono">{v.publishedBy.slice(0, 12)}</span>
              <span className="mx-0.5">·</span>
            </>
          )}
          {format(new Date(v.createdAt), "MMM d, yyyy · HH:mm")}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={onCompare}>
          <ArrowLeftRight className="h-3 w-3" /> Compare
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={onRestore} disabled={restorePending}>
          <RotateCcw className="h-3 w-3" /> Restore
        </Button>
        {showArchiveAction && !isArchived && onArchive && (
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground hover:text-amber-400" onClick={onArchive} disabled={archivePending}>
            <Archive className="h-3 w-3" /> Archive
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── Versions tab ────────────────────────────────────────────────────────────── */

function VersionsTab({ agentId }: { agentId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [compareVersion, setCompareVersion] = useState<AgentVersion | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<VersionSummary | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<VersionSummary | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const { data: listData, isLoading } = useListAgentVersions(agentId);
  const versions: VersionSummary[] = listData?.versions ?? [];
  const publishedCount = listData?.publishedCount ?? 0;
  const limit = listData?.limit ?? VERSION_LIMIT;

  const restore = useRestoreAgentVersion();
  const archive = useArchiveAgentVersion();

  const activeVersions = versions.filter(v => v.status !== "archived");
  const archivedVersions = versions.filter(v => v.status === "archived");
  const productionVersion = versions.find(v => v.status === "production");

  const handleConfirmRestore = async () => {
    if (!restoreTarget) return;
    try {
      await restore.mutateAsync({ id: agentId, versionId: restoreTarget.id });
      queryClient.invalidateQueries({ queryKey: getListAgentVersionsQueryKey(agentId) });
      queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
      toast({ title: "Restored", description: `Created draft from ${restoreTarget.versionNumber}: ${restoreTarget.versionName}.` });
      setRestoreTarget(null);
      navigate(`/app/agents/${agentId}`);
    } catch (err: any) {
      toast({ title: "Restore failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    try {
      await archive.mutateAsync({ id: agentId, versionId: archiveTarget.id });
      queryClient.invalidateQueries({ queryKey: getListAgentVersionsQueryKey(agentId) });
      toast({ title: "Archived", description: `${archiveTarget.versionNumber} has been archived and no longer counts toward your limit.` });
      setArchiveTarget(null);
    } catch (err: any) {
      toast({ title: "Archive failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  };

  const usagePct = Math.min((publishedCount / limit) * 100, 100);
  const isNearLimit = publishedCount >= 8;

  if (compareVersion) {
    return (
      <CompareView
        agentId={agentId}
        baseVersion={compareVersion}
        allVersions={versions}
        onClose={() => setCompareVersion(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header strip */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-primary" />
          Version History
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 ml-1">{versions.length}</Badge>
        </div>
        {productionVersion && (
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setRestoreTarget(productionVersion)}>
            <RotateCcw className="h-3 w-3" /> Restore Last Working Version
          </Button>
        )}
      </div>

      {/* Usage indicator */}
      {!isLoading && versions.length > 0 && (
        <div className="px-5 py-3 border-b border-border/40 shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground font-medium">
              <span className={cn("font-bold", publishedCount >= limit ? "text-destructive" : publishedCount >= 8 ? "text-amber-400" : "text-foreground")}>
                {publishedCount}
              </span>
              {" / "}{limit} Versions Used
            </span>
            <span className="text-[10px] text-muted-foreground/60">{archivedVersions.length} archived</span>
          </div>
          <Progress value={usagePct} className={cn("h-1.5", publishedCount >= limit ? "[&>div]:bg-destructive" : publishedCount >= 8 ? "[&>div]:bg-amber-400" : "")} />
        </div>
      )}

      {/* Warning banner */}
      {isNearLimit && publishedCount < limit && (
        <div className="mx-5 mt-3 shrink-0 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3.5 py-2.5">
          <Info className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-400/90 leading-relaxed">
            <strong>Approaching limit:</strong> You have {publishedCount} of {limit} published versions used. Consider archiving older versions to keep publishing new ones.
          </p>
        </div>
      )}

      {/* Version list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && versions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-60 gap-3 text-center px-6">
            <div className="h-12 w-12 rounded-xl bg-muted/30 border border-border/50 flex items-center justify-center">
              <History className="h-6 w-6 text-muted-foreground/40" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No versions yet</p>
              <p className="text-xs text-muted-foreground">Click <strong>Publish</strong> in the toolbar to create your first stable snapshot.</p>
            </div>
          </div>
        )}
        {!isLoading && activeVersions.length > 0 && (
          <div className="divide-y divide-border/40">
            {activeVersions.map((v) => (
              <VersionCard
                key={v.id}
                v={v}
                onCompare={() => setCompareVersion(v as AgentVersion)}
                onRestore={() => setRestoreTarget(v)}
                onArchive={() => setArchiveTarget(v)}
                restorePending={restore.isPending}
                archivePending={archive.isPending}
                showArchiveAction={v.status !== "production"}
              />
            ))}
          </div>
        )}

        {/* Archived versions section */}
        {!isLoading && archivedVersions.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setArchivedOpen(o => !o)}
              className="w-full flex items-center gap-2 px-5 py-2.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors border-t border-border/40 hover:bg-muted/10"
            >
              {archivedOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              <Archive className="h-3 w-3" />
              Archived Versions
              <Badge variant="outline" className="text-[10px] h-4 px-1 ml-1">{archivedVersions.length}</Badge>
              <span className="ml-auto text-[10px] text-muted-foreground/50">Don&apos;t count toward limit</span>
            </button>
            {archivedOpen && (
              <div className="divide-y divide-border/30 border-t border-border/30 bg-muted/5">
                {archivedVersions.map((v) => (
                  <VersionCard
                    key={v.id}
                    v={v}
                    onCompare={() => setCompareVersion(v as AgentVersion)}
                    onRestore={() => setRestoreTarget(v)}
                    restorePending={restore.isPending}
                    archivePending={archive.isPending}
                    showArchiveAction={false}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Restore confirmation dialog */}
      <Dialog open={!!restoreTarget} onOpenChange={open => { if (!open) setRestoreTarget(null); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> Restore Version
            </DialogTitle>
            <DialogDescription>
              This will create a new draft from <strong>{restoreTarget?.versionNumber}: {restoreTarget?.versionName}</strong>. Your current draft will be replaced with this snapshot. Call logs and analytics are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRestoreTarget(null)}>Cancel</Button>
            <Button type="button" disabled={restore.isPending} onClick={handleConfirmRestore} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              {restore.isPending ? "Restoring…" : "Restore Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation dialog */}
      <Dialog open={!!archiveTarget} onOpenChange={open => { if (!open) setArchiveTarget(null); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-amber-400" /> Archive Version
            </DialogTitle>
            <DialogDescription>
              Archive <strong>{archiveTarget?.versionNumber}: {archiveTarget?.versionName}</strong>? It will no longer count toward your {limit}-version limit. You can still compare and restore archived versions at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setArchiveTarget(null)}>Cancel</Button>
            <Button type="button" disabled={archive.isPending} onClick={handleConfirmArchive} className="gap-1.5">
              <Archive className="h-3.5 w-3.5" />
              {archive.isPending ? "Archiving…" : "Archive Version"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Agent editor panel ─────────────────────────────────────────────────────── */

function AgentEditorPanel({ agentId }: { agentId: number }) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [callDialog, setCallDialog] = useState(false);
  const [callNumber, setCallNumber] = useState("");
  const [otpOpen, setOtpOpen] = useState(false);
  const [pendingNumber, setPendingNumber] = useState("");
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const rateMap = useMinuteRatesMap();
  const [, navigate] = useLocation();

  const { data: agent, isLoading } = useGetAgent(agentId, {
    query: { queryKey: getGetAgentQueryKey(agentId) },
  });
  const updateAgent = useUpdateAgent();
  const toggleAgent = useToggleAgent();
  const deleteAgent = useDeleteAgent();
  const initiateOutbound = useInitiateOutboundCall();

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: "", description: "", asrProvider: "deepgram", asrModel: "",
      llmProvider: "openai", llmModel: "", ttsProvider: "cartesia",
      ttsVoice: "", ttsModel: "", telephonyProvider: "vobiz",
      systemPrompt: "", temperature: 0.10, maxDuration: 300,
      greetingMessage: "Hello", firstSpeaker: "assistant", endCallPhrases: "", silenceTimeoutSeconds: 30,
      language: "en-US", asrLanguage: "", backchannelingEnabled: true,
      backchannelingFrequency: 0.5, backchannelPhrases: "", webhookUrl: "",
      webhookSecret: "", noiseCancellationEnabled: true,
      ambientNoiseEnabled: false, ambientNoiseTrack: "", promptVariables: [],
      vadSilenceMs: 250, bargeInEnabled: true, bargeInEnergyThreshold: 1200,
      bargeInMinFrames: 4, timezone: "", machineDetectionMode: "disabled",
      voicemailAction: "hangup",
      voicemailMessage: "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      tools: [], genderDetectionEnabled: false, recordingEnabled: false,
      startSpeakingWaitSecs: 0, startSpeakingOnPunctuationSecs: 0.1,
      startSpeakingOnNoPunctuationSecs: 1.5, startSpeakingOnNumberSecs: 0.5,
      stopSpeakingNumWords: 0, stopSpeakingVoiceSecs: 0.2, stopSpeakingBackOffSecs: 1,
      complianceIrdai: false, complianceDpdp: false, complianceHipaa: false, complianceTrai: false,
      knowledgeSourceIds: [],
      contextWindowTurns: undefined,
      summarizationEnabled: false,
      stagedPromptEnabled: false,
      stagedPromptStages: [],
      stagedPromptCoreIdentity: "",
      inboundPhoneNumberId: undefined,
      outboundPhoneNumberId: undefined,
      preferredManagedNumber: null,
      asrEndpointingSilenceMs: 400,
      llmMaxTokens: undefined,
      ttsMinSentenceChars: 15,
      linearDelayMs: 0,
    },
  });

  useEffect(() => {
    if (!agent) return;
    form.reset({
      name:                     agent.name,
      description:              agent.description ?? "",
      asrProvider:              agent.asrProvider,
      asrModel:                 agent.asrModel ?? "",
      llmProvider:              agent.llmProvider,
      llmModel:                 agent.llmModel ?? "",
      ttsProvider:              agent.ttsProvider,
      ttsVoice:                 agent.ttsVoice ?? "",
      ttsModel:                 agent.ttsModel ?? "",
      telephonyProvider:        agent.telephonyProvider,
      systemPrompt:             agent.systemPrompt,
      temperature:              agent.temperature ?? 0.10,
      maxDuration:              agent.maxDuration ?? 300,
      greetingMessage:          agent.greetingMessage ?? "Hello",
      firstSpeaker:             ((agent as any).firstSpeaker === "user" ? "user" : "assistant") as AgentFormValues["firstSpeaker"],
      endCallPhrases:           agent.endCallPhrases ?? "",
      silenceTimeoutSeconds:    agent.silenceTimeoutSeconds ?? 30,
      language:                 agent.language ?? "en-US",
      asrLanguage:              agent.asrLanguage ?? "",
      backchannelingEnabled:    agent.backchannelingEnabled ?? true,
      backchannelingFrequency:  agent.backchannelingFrequency ?? 0.5,
      backchannelPhrases:       agent.backchannelPhrases ?? "",
      webhookUrl:               agent.webhookUrl ?? "",
      webhookSecret:            (agent as any).agentConfig?.webhookSecret ?? "",
      noiseCancellationEnabled: agent.noiseCancellationEnabled ?? true,
      ambientNoiseEnabled:      (agent as any).agentConfig?.ambientNoiseEnabled ?? false,
      ambientNoiseTrack:        (agent as any).agentConfig?.ambientNoiseTrack ?? "",
      promptVariables:          ((agent as any).agentConfig?.promptVariables ?? []) as AgentFormValues["promptVariables"],
      vadSilenceMs:             (agent as any).agentConfig?.vadSilenceMs ?? 250,
      bargeInEnabled:           (agent as any).agentConfig?.bargeInEnabled ?? true,
      bargeInEnergyThreshold:   (agent as any).agentConfig?.bargeInEnergyThreshold ?? 1200,
      bargeInMinFrames:         (agent as any).agentConfig?.bargeInMinFrames ?? 4,
      timezone:                 (agent as any).agentConfig?.timezone ?? "",
      machineDetectionMode:     ((agent as any).agentConfig?.machineDetectionMode ?? "disabled") as AgentFormValues["machineDetectionMode"],
      voicemailAction:          ((agent as any).agentConfig?.voicemailAction ?? "hangup") as AgentFormValues["voicemailAction"],
      voicemailMessage:         (agent as any).agentConfig?.voicemailMessage ?? "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      tools:                    (agent.tools ?? []) as AgentFormValues["tools"],
      genderDetectionEnabled:   (agent as any).agentConfig?.genderDetectionEnabled ?? false,
      recordingEnabled:         (agent as any).agentConfig?.recordingEnabled ?? false,
      startSpeakingWaitSecs:            (agent as any).agentConfig?.startSpeakingPlan?.waitSeconds            ?? 0,
      startSpeakingOnPunctuationSecs:   (agent as any).agentConfig?.startSpeakingPlan?.onPunctuationSeconds   ?? 0.1,
      startSpeakingOnNoPunctuationSecs: (agent as any).agentConfig?.startSpeakingPlan?.onNoPunctuationSeconds ?? 1.5,
      startSpeakingOnNumberSecs:        (agent as any).agentConfig?.startSpeakingPlan?.onNumberSeconds        ?? 0.5,
      stopSpeakingNumWords:    (agent as any).agentConfig?.stopSpeakingPlan?.numWords       ?? 0,
      stopSpeakingVoiceSecs:   (agent as any).agentConfig?.stopSpeakingPlan?.voiceSeconds   ?? 0.2,
      stopSpeakingBackOffSecs: (agent as any).agentConfig?.stopSpeakingPlan?.backOffSeconds ?? 1,
      complianceIrdai: (agent as any).agentConfig?.compliance?.irdai ?? false,
      complianceDpdp:  (agent as any).agentConfig?.compliance?.dpdp  ?? false,
      complianceHipaa: (agent as any).agentConfig?.compliance?.hipaa ?? false,
      complianceTrai:  (agent as any).agentConfig?.compliance?.trai  ?? false,
      snapserveAgentId: (agent as any).snapserveAgentId ?? "",
      knowledgeSourceIds:       ((agent as any).knowledgeSourceIds ?? []) as number[],
      contextWindowTurns:              (agent as any).contextWindowTurns ?? undefined,
      summarizationEnabled:            (agent as any).agentConfig?.summarizationEnabled ?? false,
      stagedPromptEnabled:             (agent as any).stagedPromptEnabled ?? false,
      stagedPromptStages:              (agent as any).stagedPromptStages ?? [],
      stagedPromptCoreIdentity:        (agent as any).stagedPromptCoreIdentity ?? "",
      inboundPhoneNumberId:            (agent as any).inboundPhoneNumberId ?? undefined,
      outboundPhoneNumberId:           (agent as any).outboundPhoneNumberId ?? undefined,
      preferredManagedNumber:          ((agent as any).agentConfig?.preferredManagedNumber as string | undefined) ?? null,
      asrEndpointingSilenceMs:         (agent as any).agentConfig?.asrEndpointingSilenceMs ?? 400,
      llmMaxTokens:                    (agent as any).agentConfig?.llmMaxTokens ?? null,
      ttsMinSentenceChars:             (agent as any).agentConfig?.ttsMinSentenceChars ?? 15,
      linearDelayMs:                   (agent as any).agentConfig?.incrementalDelay ?? 0,
    });
  }, [agent]);

  const onSave = form.handleSubmit(
    async (data) => {
      try {
        const payload = buildUpdateAgentPayload(data);
        await updateAgent.mutateAsync({ id: agentId, data: payload as any });
        queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        toast({ title: "Saved", description: `${data.name} updated.` });
      } catch (err) {
        const mapped = mapApiErrors(err);
        if (mapped) { Object.entries(mapped).forEach(([k, v]) => form.setError(k as any, { message: v })); }
        toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
      }
    },
    (errors) => {
      const firstError = Object.values(errors)[0];
      const msg = firstError && typeof firstError === "object" && "message" in firstError
        ? String((firstError as any).message)
        : "Please fix the highlighted fields before saving.";
      toast({ title: "Validation error", description: msg, variant: "destructive" });
    }
  );

  const handleToggle = async () => {
    try {
      await toggleAgent.mutateAsync({ id: agentId });
      queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
      queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
    } catch (err) {
      toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    const agentName = form.getValues("name") || "this agent";
    if (!confirm(`Delete "${agentName}"? This cannot be undone.`)) return;
    try {
      await deleteAgent.mutateAsync({ id: agentId });
      queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      navigate("/app/agents");
    } catch (err) {
      toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
    }
  };

  const handleOutbound = (e: React.FormEvent) => {
    e.preventDefault();
    if (!callNumber.trim()) return;
    initiateOutbound.mutate(
      { data: { agentId, toNumber: callNumber } } as any,
      {
        onSuccess: () => { setCallDialog(false); setCallNumber(""); toast({ title: "Calling…" }); },
        onError: (err: any) => {
          if (isDestinationUnverifiedError(err)) {
            setPendingNumber(callNumber); setCallDialog(false); setOtpOpen(true);
          } else {
            toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
          }
        },
      }
    );
  };

  const isDirty   = form.formState.isDirty;
  const nameValue = form.watch("name");

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
        </div>
      </div>
    );
  }

  if (!agent) return null;

  return (
    <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-3">
          <div className={`h-2 w-2 rounded-full shrink-0 ${agent.status === "active" ? "bg-green-400" : "bg-muted-foreground/40"}`} />
          <input
            className="text-base font-semibold bg-transparent outline-none border-b border-transparent hover:border-muted-foreground/30 focus:border-primary transition-colors min-w-0 max-w-[220px] truncate cursor-text"
            value={nameValue ?? agent.name}
            onChange={e => form.setValue("name", e.target.value, { shouldDirty: true })}
            onKeyDown={e => { if (e.key === "Enter") { e.currentTarget.blur(); void onSave(); } }}
            onBlur={() => { if (isDirty) void onSave(); }}
            title="Click to rename"
            aria-label="Agent name"
          />
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-mono shrink-0">#{String(agent.id).padStart(4, "0")}</Badge>
          <span className="text-xs text-muted-foreground">{(agent as any).totalCalls ?? 0} calls</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-7 text-xs gap-1.5" onClick={onSave} disabled={updateAgent.isPending} title={!isDirty ? "No unsaved changes" : undefined}>
            <Save className="h-3.5 w-3.5" />
            {updateAgent.isPending ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setPublishModalOpen(true)}>
            <Upload className="h-3.5 w-3.5" /> Publish
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setCallDialog(true)}>
            <Phone className="h-3.5 w-3.5" /> Call
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleToggle}>
                <Power className="h-3.5 w-3.5 mr-2" />
                {agent.status === "active" ? "Deactivate" : "Activate"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={handleDelete}>
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete Agent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-0.5 px-4 border-b border-border/60 shrink-0 overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "logs" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <LogsTab agentId={agent.id} />
        </div>
      ) : activeTab === "versions" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <VersionsTab agentId={agent.id} />
        </div>
      ) : activeTab === "simulation" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <SimulationTab agentId={agentId} />
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={e => e.preventDefault()} className="flex-1 min-h-0 overflow-hidden">
            {activeTab === "overview"  && <OverviewTab form={form} rateMap={rateMap} agent={agent} />}
            {activeTab === "prompt"    && <PromptTab form={form} />}
            {activeTab === "voice"     && <VoiceTab form={form} />}
            {activeTab === "tools"     && <ToolsTab form={form} agentId={agentId} />}
            {activeTab === "analysis"  && <AnalysisTab form={form} agentId={agentId} />}
            {activeTab === "voicemail" && <VoicemailTab form={form} />}
            {activeTab === "advanced"  && <AdvancedTab form={form} agent={agent} />}
          </form>
        </Form>
      )}

      {/* Outbound call dialog */}
      <Dialog open={callDialog} onOpenChange={setCallDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make Outbound Call</DialogTitle>
            <DialogDescription>Agent <strong>{agent.name}</strong> will call this number.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleOutbound} className="space-y-4">
            <Input value={callNumber} onChange={e => setCallNumber(e.target.value)}
              placeholder="+12125551234" className="h-10" autoFocus />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCallDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={initiateOutbound.isPending}>
                <Phone className="h-4 w-4 mr-1.5" />
                {initiateOutbound.isPending ? "Calling…" : "Call"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {otpOpen && <DestinationOtpDialog open={otpOpen} phoneNumber={pendingNumber} onClose={() => setOtpOpen(false)} onVerified={() => setOtpOpen(false)} />}

      {/* Publish version modal */}
      <PublishVersionModalWrapper
        open={publishModalOpen}
        onOpenChange={setPublishModalOpen}
        agentId={agentId}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: getListAgentVersionsQueryKey(agentId) });
          setActiveTab("versions");
        }}
      />
    </div>
  );
}

/* ── Empty state ────────────────────────────────────────────────────────────── */

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="h-16 w-16 rounded-2xl bg-muted/40 border border-border/60 flex items-center justify-center mx-auto mb-4">
          <Bot className="h-8 w-8 text-muted-foreground/40" />
        </div>
        <h3 className="text-base font-semibold mb-1">No agent selected</h3>
        <p className="text-sm text-muted-foreground mb-4">Pick an agent from the list or create a new one to get started.</p>
        <Button onClick={onCreate} size="sm">
          <Plus className="h-4 w-4 mr-1.5" /> Create Agent
        </Button>
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────────── */

const LAST_AGENT_ID_KEY = "voiceorch:lastAgentId";

export default function AgentBuilder() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const createAgent = useCreateAgent();
  const { toast } = useToast();
  const rateMap = useMinuteRatesMap();
  const { data: agents, isLoading: agentsLoading } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });

  const selectedId = params.id ? parseInt(params.id, 10) : null;

  const handleSelect = (id: number) => {
    try { localStorage.setItem(LAST_AGENT_ID_KEY, String(id)); } catch { /* ignore */ }
    navigate(`/app/agents/${id}`);
  };

  // Persist the currently-viewed agent so it can be restored next session.
  useEffect(() => {
    if (selectedId == null) return;
    try { localStorage.setItem(LAST_AGENT_ID_KEY, String(selectedId)); } catch { /* ignore */ }
  }, [selectedId]);

  // Auto-select an agent when landing on the page with none selected.
  useEffect(() => {
    if (selectedId != null) return;
    if (agentsLoading) return;
    if (!agents || agents.length === 0) return;
    let stored: number | null = null;
    try {
      const raw = localStorage.getItem(LAST_AGENT_ID_KEY);
      stored = raw ? parseInt(raw, 10) : null;
    } catch { /* ignore */ }
    const target = (stored != null && agents.some(a => a.id === stored)) ? stored : agents[0].id;
    navigate(`/app/agents/${target}`, { replace: true });
  }, [selectedId, agentsLoading, agents, navigate]);

  const handleCreate = () => {
    createAgent.mutate(
      { data: { name: "New Agent", asrProvider: "azure", asrModel: "en-US-standard", llmProvider: "openai", llmModel: "gpt-4o-mini", ttsProvider: "cartesia", ttsVoice: "", ttsModel: "", telephonyProvider: "vobiz", systemPrompt: "You are a helpful AI voice assistant.", greetingMessage: "Hello", language: "en-US" } as any },
      { onSuccess: (agent) => handleSelect(agent.id), onError: (err: unknown) => toast({ title: "Error", description: formatApiError(err), variant: "destructive" }) }
    );
  };

  return (
    <div className="flex h-full overflow-hidden">
      <AgentListPanel selectedId={selectedId} onSelect={handleSelect} rateMap={rateMap} />
      {selectedId
        ? <AgentEditorPanel agentId={selectedId} />
        : (agentsLoading || (agents && agents.length > 0))
          ? <div className="flex-1" />
          : <EmptyState onCreate={handleCreate} />
      }
    </div>
  );
}
