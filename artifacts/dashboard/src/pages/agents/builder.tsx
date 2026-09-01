import React, { useEffect, useState, useMemo, useRef } from "react";
import { diffWords, diffWordsWithSpace } from "diff";
import { useLocation, useParams, useSearch, Link } from "wouter";
import {
  Bot, Plus, Search, Phone, Mic, Brain, Webhook, PhoneForwarded,
  Save, MoreHorizontal, Trash2, Settings, FileText, Wrench,
  TestTube2, ChevronRight,
  Volume2, Check, X, Pencil, ChevronDown, List, Globe, BarChart3,
  User2, Users, Sparkles, CopyPlus, BookOpen, ToggleLeft, ToggleRight, Tag, Loader2, Square, AudioLines,
  Play, Pause, Copy,
  Timer, ShieldCheck, Layers, Gauge, MicOff, HelpCircle, PhoneOff, Mail, MessageCircle,
  History, GitBranch, Eye, RotateCcw, ChevronUp, AlertTriangle, ArrowLeftRight,
  Upload, Archive, Info, AlertCircle, Calendar, Star, BadgeCheck, Video, ExternalLink,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { WebcallPanel } from "@/components/webcall-panel";
import { AgentConfigCard, EditConfigDialog } from "@/components/agent-config-card";
import { GeminiLiveVoicePicker } from "@/components/gemini-live-voice-picker";
import { CloneVoiceDialog, type ClonedVoiceResult } from "@/components/clone-voice-dialog";
import { RegisterSarvamVoiceDialog } from "@/components/register-sarvam-voice-dialog";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import {
  useListAgents, useGetAgent, useUpdateAgent, useDeleteAgent,
  useCreateAgent, useInitiateOutboundCall, getListAgentsQueryKey, getGetAgentQueryKey,
  useListCalendars, customFetch,
  useListKnowledgeSources, useListAmbientSounds, useListEventTypes,
  useListAgentVersions, usePublishAgentVersion, useGetAgentVersion, useRestoreAgentVersion,
  useArchiveAgentVersion, useDeleteAgentVersion,
  getListAgentVersionsQueryKey, getGetAgentVersionQueryKey,
  useListPhoneNumbers, useAssignPhoneNumber, getListPhoneNumbersQueryKey,
  useListProviders, getListProvidersQueryKey,
} from "@workspace/api-client-react";
import type { AgentVersion } from "@workspace/api-client-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { agentFormSchema, hydrateToolsForForm, CALL_ENGINE_PRESETS, type CallEnginePreset, clampBargeInEnergyThreshold, clampEndpointingMs, clampLinearDelayMs, clampFragmentCoalesceListeningMs, clampFragmentCoalescePlayingMs, clampTelephonyTailDrainMs, clampSarvamSpeechEndFlushMs, clampSarvamIncompleteHoldMs, hydrateSarvamRealtimeVad, clampInterruptWords, voiceSecondsFromInterruptWords, clampSemanticTurnStopMs, WEBHOOK_PAYLOAD_TEMPLATE_PLACEHOLDER } from "./edit.schema";
import { AgentWebsiteEmbedPanel } from "./website-embed";
import { buildUpdateAgentPayload, StagedPromptEditor } from "./edit";
import type { AgentFormValues } from "./edit";
import { Button } from "@/components/ui/button";
import { DetailNav } from "@/components/detail-nav";
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
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { formatApiError, mapApiErrors, isDestinationUnverifiedError } from "@/lib/format-api-error";
import {
  OUTCOME_PRESETS,
  DOMAIN_FIELD_QUICK_ADDS,
  taxonomyToCategories,
  categoriesToTaxonomy,
  fromStoredDomainField,
  toStoredDomainField,
  slugDispositionKey,
  type DispositionCategory,
  type UiDomainField,
  type UiDomainFieldType,
  type StoredDomainField,
} from "@/lib/disposition-fields";
import { SnapServeAgentIcon } from "@/components/logo";
import { hostProductName } from "@/lib/white-label";
import { findBySchedulingId, normalizeSchedulingId } from "@/lib/scheduling-setup";
import { usePartnerManagedWorkspace } from "@/hooks/use-partner";
import {
  LLM_PROVIDERS, TTS_PROVIDERS,
  LANGUAGES, SARVAM_PERSONALISATION_LANGUAGES, asrModelsForPicker, SARVAM_PRODUCT_ASR_MODEL,
  llmModelsForPicker, TTS_MODELS, TTS_VOICES, AGENT_TIMEZONES,
  DEFAULT_CARTESIA_VOICE_ID, DEFAULT_CARTESIA_VOICE_NAME,
  orderVoicesByLanguage, isVoiceCompatibleWithLanguage, shouldClearVoiceForLanguage,
  baseLanguage,
  getSarvamTtsVoices, isSarvamVoiceCompatible,
  GEMINI_LIVE_LLM_MODEL, GEMINI_LIVE_THINKING_LEVELS, VOICE_STACK_OPTIONS,
  geminiLiveModelLabel, isGeminiLiveAgent, voiceStackForLlmModel,
  llmFieldsForVoiceStack,
  languagesForAgent, isSarvamRealtimeAsr,
} from "@/lib/agent-providers";
import { useMinuteRatesMap, useUserProviderNames, computeAgentRateCents } from "@/hooks/use-minute-rates";
import { DestinationOtpDialog } from "@/components/destination-otp-dialog";
import { RecentNumbersList } from "@/components/recent-numbers-list";
import { useRecentNumbers } from "@/hooks/use-recent-numbers";
import { GeneratePromptSheet } from "./generate-prompt-sheet";
import { AgentInboundPanel } from "./agent-inbound-panel";
import {
  useAgentTeamMap,
  sortAgentsByTeam,
  agentPathWithSection,
  type AgentTeamMembership,
} from "./agent-team";
import { ToolsWhatsappSetup, ToolsEmailSetup, connectionsSetupHref } from "./tools-messaging";
import { WhatsappTemplateSelect, type WaCatalogEntry, type WaTplChoice } from "@/components/whatsapp/agent-template-picks";
import { AgentAnalyticsPanel } from "./agent-analytics-panel";
import {
  PropertyRow,
  StatusDot,
  WorkspaceInspector,
  WorkspaceSegmentNav,
  type WorkspaceNavItem,
} from "@/components/workspace/workspace";
const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API   = `${_DASH_BASE}/api`;

/* ── Types ──────────────────────────────────────────────────────────────────── */

type TabId = "overview" | "prompt" | "voice" | "tools" | "outcomes" | "analytics" | "voicemail" | "settings" | "versions";

interface TabDef { id: TabId; label: string; icon: React.ReactNode }

const TABS: TabDef[] = [
  { id: "overview",  label: "Overview",  icon: <Bot className="h-3.5 w-3.5" /> },
  { id: "prompt",    label: "Script",    icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "voice",     label: "Sound",     icon: <Mic className="h-3.5 w-3.5" /> },
  { id: "tools",     label: "Actions",   icon: <Wrench className="h-3.5 w-3.5" /> },
  { id: "outcomes",  label: "After the call", icon: <Tag className="h-3.5 w-3.5" /> },
  { id: "analytics", label: "Activity",  icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: "settings",  label: "Settings",  icon: <Settings className="h-3.5 w-3.5" /> },
  { id: "versions",  label: "Versions",  icon: <History className="h-3.5 w-3.5" /> },
];

const BUILDER_SEGMENTS: WorkspaceNavItem<TabId>[] = TABS.map((tab) => ({
  id: tab.id,
  label: tab.label,
  // Build (overview → after the call) | Review (activity, settings, versions)
  dividerBefore: tab.id === "analytics",
}));

/** One left edge for header, tabs, and every builder page. */
const BUILDER_TAB_PAD = "px-5 py-6 sm:px-8";

function BuilderTabHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div className="min-w-0 max-w-[68ch]">
        <h2 className="text-[17px] font-semibold tracking-[-0.03em] text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function BuilderStatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        ok
          ? "border-border/70 bg-muted/25 text-muted-foreground"
          : "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", ok ? "bg-emerald-500" : "bg-amber-500")} />
      {label}
    </span>
  );
}

function BuilderPipelineStatus({ form }: { form: any }) {
  const promptOk = String(form.watch("systemPrompt") ?? "").trim().length >= 40;
  const greetOk = String(form.watch("greetingMessage") ?? "").trim().length >= 4;
  const isGeminiLive = isGeminiLiveAgent({
    llmModel: form.watch("llmModel"),
    voiceStack: form.watch("voiceStack"),
  });
  const ttsVoice = form.watch("ttsVoice");
  const voiceOk = isGeminiLive || Boolean(ttsVoice && ttsVoice !== "__custom__");
  return (
    <div className="hidden min-w-0 items-center gap-1 lg:flex" aria-label="Builder readiness">
      <BuilderStatusChip ok={greetOk && promptOk} label="Script" />
      <BuilderStatusChip ok={voiceOk} label="Sound" />
    </div>
  );
}

/** Map legacy ?section= values onto current tabs. */
function sectionFromSearch(search: string): TabId {
  const requested = new URLSearchParams(search).get("section");
  if (requested === "advanced") return "settings";
  // Channels removed — messaging/booking live under Actions.
  if (requested === "channels") return "tools";
  // Voicemail now sits on After the call.
  if (requested === "voicemail") return "outcomes";
  // Disposition used to nest under Settings → Analytics.
  if (requested === "disposition" || requested === "dispositions") {
    return "outcomes";
  }
  // Old Settings → Analytics was webhooks; real agent analytics is its own tab now.
  if (requested === "integrations") return "settings";
  if (requested === "website" || requested === "embed") return "settings";
  return TABS.some((tab) => tab.id === requested) ? requested as TabId : "overview";
}

/* ── Small helpers ──────────────────────────────────────────────────────────── */

function VoiceOptionLabel({ label, recommended }: { label: string; recommended?: boolean }) {
  if (!recommended) return <>{label}</>;
  return (
    <span className="inline-flex items-center gap-1.5" title="Recommended for this language">
      <span>{label}</span>
      <BadgeCheck
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden
        strokeWidth={2}
      />
    </span>
  );
}

function SmallSelect({ value, onChange, options, placeholder }: {
  value: string | undefined;
  onChange: (v: string) => void;
  options: { value: string; label: string; recommended?: boolean }[];
  placeholder?: string;
}) {
  // Radix Select crashes if `value` is "" or not present in SelectItem list.
  // Normalize to undefined so the placeholder shows instead of throwing.
  const safeOptions = options.filter((o) => o.value !== "");
  const safeValue =
    value && safeOptions.some((o) => o.value === value) ? value : undefined;
  return (
    <Select value={safeValue} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs bg-background/50">
        <SelectValue placeholder={placeholder ?? "Select…"} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-[280px] overflow-y-auto">
        {safeOptions.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            <VoiceOptionLabel label={o.label} recommended={o.recommended} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Resolve a friendly voice label from whitelist, static catalog, or truncated ID. */
function resolveVoiceLabel(
  voiceId: string | undefined | null,
  provider: string | undefined | null,
  whitelist: Array<{ id: string; name: string }> = [],
  storedName?: string | null,
): string {
  if (!voiceId || voiceId === "__custom__") return "";
  const fromWhitelist = whitelist.find(v => v.id === voiceId)?.name;
  if (fromWhitelist) return fromWhitelist;
  if (storedName) return storedName;
  const staticList = provider && provider in TTS_VOICES ? TTS_VOICES[provider] : undefined;
  if (Array.isArray(staticList)) {
    const fromStatic = staticList.find(v => v.value === voiceId)?.label;
    if (fromStatic) return fromStatic;
  }
  if (voiceId.length > 12) return `…${voiceId.slice(-8)}`;
  return voiceId;
}

/**
 * Filled section box used by every builder tab — the title lives inside the
 * shape so sections read as panels instead of floating labels.
 */
function BuilderPanel({
  title,
  description,
  icon,
  hint,
  action,
  children,
  bodyClassName,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex h-full min-h-0 flex-col rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border bg-muted/40 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? <span className="shrink-0 text-muted-foreground [&_svg]:size-3.5">{icon}</span> : null}
          <h3 className="truncate text-[13px] font-semibold tracking-[-0.02em] text-foreground">{title}</h3>
          {description ? (
            <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">— {description}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hint}
          {action}
        </div>
      </div>
      <div className={cn("flex min-h-0 flex-1 flex-col p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <div className="h-px flex-1 bg-border/70" />
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
            className="flex h-12 w-full items-center justify-between rounded-lg border border-border bg-background px-4 text-sm text-muted-foreground hover:border-foreground/20 hover:text-foreground transition-colors"
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
                <CommandEmpty>No knowledge sources yet. Create one under Knowledge.</CommandEmpty>
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

function AgentCostSummary({
  form,
  rateMap,
  compact = false,
  variant = "default",
}: {
  form: any;
  rateMap: Map<string, number>;
  agent?: any;
  compact?: boolean;
  /** line = readiness one-liner; chip/compact = header pill */
  variant?: "default" | "line" | "chip";
}) {
  const userProviderNames = useUserProviderNames();

  const asrProvider = form.watch("asrProvider");
  const llmProvider = form.watch("llmProvider");
  const ttsProvider = form.watch("ttsProvider");

  const agentProviders = [asrProvider, llmProvider, ttsProvider].filter(Boolean).map((p: string) => p.toLowerCase());
  const isByop = agentProviders.some(p => userProviderNames.has(p));
  const platformCents = rateMap.get(isByop ? "byop" : "managed") ?? 500;
  const totalPerMin = platformCents / 100; // paise → INR (map already reflects account-level partner rates)

  const segments = [
    { key: "platform", label: "Platform", provider: "Platform", cost: totalPerMin, color: "#059669" },
  ];
  const breakdown = segments.filter(s => s.cost > 0);
  const barTotal = Math.max(breakdown.reduce((s, x) => s + x.cost, 0), 0.0001);
  const mode = variant === "default" && compact ? "chip" : variant;

  if (mode === "line") {
    return (
      <span className="text-[11px] text-muted-foreground">
        <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
          ₹{totalPerMin.toFixed(2)}
        </span>
        <span className="text-emerald-700/70 dark:text-emerald-400/70">/min</span>
        {isByop ? " · BYOP" : ""}
      </span>
    );
  }

  if (mode === "chip" || compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 text-[11px] cursor-default">
            <span className="hidden text-emerald-800/55 dark:text-emerald-300/55 sm:inline">Est.</span>
            <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              ₹{totalPerMin.toFixed(2)}
            </span>
            <span className="text-emerald-700/65 dark:text-emerald-400/65">/min</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs space-y-1">
          <p className="font-medium text-foreground">Estimated call cost</p>
          {breakdown.map(seg => (
            <div key={seg.key} className="flex items-center justify-between gap-3">
              <span className="font-medium">{seg.label}</span>
              <span className="tabular-nums text-emerald-700 dark:text-emerald-400">
                ₹{seg.cost.toFixed(2)}/min
              </span>
            </div>
          ))}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Cost strip: price + segmented color bar + legend
  return (
    <div className="w-full max-w-xl space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="text-muted-foreground">Cost per min</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 cursor-default">
              ₹{totalPerMin.toFixed(2)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs space-y-1">
            {breakdown.map(seg => (
              <div key={seg.key} className="flex items-center justify-between gap-3">
                <span className="font-medium">
                  {seg.label}
                  {seg.provider && seg.provider !== "Platform" && (
                    <span className="text-muted-foreground ml-1 capitalize">({seg.provider})</span>
                  )}
                </span>
                <span className="tabular-nums text-emerald-700 dark:text-emerald-400">
                  ₹{seg.cost.toFixed(2)}/min
                </span>
              </div>
            ))}
          </TooltipContent>
        </Tooltip>
        <span className="text-muted-foreground/40">·</span>
        <span className="text-muted-foreground/70">{isByop ? "BYOP routing" : "Managed routing"}</span>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
        {breakdown.map(seg => (
          <div
            key={seg.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(seg.cost / barTotal) * 100}%`, backgroundColor: seg.color }}
            title={`${seg.label}: ₹${seg.cost.toFixed(2)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {segments.map(seg => (
          <div key={seg.key} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/75">
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
            <span>{seg.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SECTION_FIELDS: Record<CardSection, string[]> = {
  transcriber: ["language", "asrProvider", "asrModel", "sarvamSttMode", "sarvamSttStreamType", "sarvamSttPrompt", "languageAutoDetect", "multilingualLanguages", "sarvamIndicNumbers"],
  model: ["voiceStack", "llmProvider", "llmModel", "temperature"],
  voice: ["ttsProvider", "ttsModel", "ttsVoice", "ttsSpeed", "geminiLiveVoiceName", "geminiLiveThinkingLevel"],
};

/* ── Overview ───────────────────────────────────────────────────────────────── */

function OverviewTab({
  form,
  agent,
  onGoToPrompt,
  onGoToAnalytics,
  rateMap,
}: {
  form: any;
  agent: any;
  onGoToPrompt?: () => void;
  onGoToAnalytics?: () => void;
  rateMap: Map<string, number>;
}) {
  const [openSection, setOpenSection] = useState<CardSection | null>(null);
  const [confirmDiscardSection, setConfirmDiscardSection] = useState<CardSection | null>(null);
  const sectionSnapshotRef = useRef<{ values: Record<string, any>; voiceCustomMode: boolean }>({ values: {}, voiceCustomMode: false });
  const [cloneOpen, setCloneOpen] = useState(false);
  const queryClient = useQueryClient();

  const asrProvider           = form.watch("asrProvider");
  const llmProvider           = form.watch("llmProvider");
  const ttsProvider           = form.watch("ttsProvider");
  const voiceStack            = form.watch("voiceStack");
  const geminiLiveVoiceName   = form.watch("geminiLiveVoiceName");
  const telephonyProvider     = form.watch("telephonyProvider") ?? "vobiz";
  const asrModel              = form.watch("asrModel");
  const llmModel              = form.watch("llmModel");
  const isGeminiLive          = isGeminiLiveAgent({ llmModel, voiceStack });
  const ttsVoice              = form.watch("ttsVoice");
  const ttsModel              = form.watch("ttsModel");
  const language              = form.watch("language");
  const temperature           = form.watch("temperature") ?? 0.4;
  const llmOptions    = llmModelsForPicker(llmProvider, llmModel);
  const ttsModelOpts  = TTS_MODELS[ttsProvider]  ?? [];
  const asrModelOpts  = asrModelsForPicker(asrProvider, asrModel);

  // Fetch admin-whitelisted voices (shared cache with VoiceTab)
  const { data: whitelistedData } = useQuery({
    queryKey: ["voices", "whitelisted"],
    queryFn: () => customFetch<{ voices: Array<{ id: string; name: string; language: string }> }>(`${DASH_API}/voices/whitelisted`),
    staleTime: 5 * 60 * 1000,
  });

  const { data: myClonesData } = useQuery({
    queryKey: ["voices", "mine"],
    queryFn: () => customFetch<{ voices: ClonedVoiceResult[] }>(`${DASH_API}/voices/mine`),
    staleTime: 60 * 1000,
  });
  const myClones = myClonesData?.voices ?? [];
  const myCartesiaClones = myClones.filter((c) => (c.provider ?? "cartesia") === "cartesia");
  const mySarvamClones = myClones.filter((c) => c.provider === "sarvam");
  const [sarvamCloneOpen, setSarvamCloneOpen] = useState(false);

  // Curated Cartesia voice list: show ALL admin-whitelisted voices, with
  // language-matching (recommended) voices sorted to the top. Fall back to the
  // static catalog when whitelist is empty. Always append the current voice if
  // missing so the select can display it. Always end with Paste-custom.
  const cartesiaOverviewOpts = useMemo(() => {
    const all = whitelistedData?.voices ?? [];
    const ordered = orderVoicesByLanguage(all, language);
    const seen = new Set<string>();
    const opts: { value: string; label: string; recommended?: boolean }[] = [];
    for (const c of myCartesiaClones) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      opts.push({ value: c.id, label: `✦ ${c.name}` });
    }
    for (const v of ordered) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      const recommended = isVoiceCompatibleWithLanguage(v.language, language)
        && baseLanguage(language) !== "en";
      opts.push({
        value: v.id,
        label: v.name,
        recommended: recommended || undefined,
      });
    }
    if (opts.length === 0 && Array.isArray(TTS_VOICES.cartesia)) {
      for (const v of TTS_VOICES.cartesia) {
        if (v.value === "__custom__" || seen.has(v.value)) continue;
        seen.add(v.value);
        opts.push(v);
      }
    }
    if (ttsVoice && ttsVoice !== "__custom__" && !seen.has(ttsVoice)) {
      opts.unshift({
        value: ttsVoice,
        label: resolveVoiceLabel(ttsVoice, "cartesia", all, (agent as any)?.ttsVoiceName),
      });
    }
    opts.push({ value: "__custom__", label: "Paste custom Voice ID" });
    return opts;
  }, [whitelistedData, language, ttsVoice, agent, myCartesiaClones]);

  // When the language changes (or the whitelist finishes loading), clear a
  // selected curated voice the language no longer offers. Membership of the
  // OFFERED list is the test — testing the language tag directly would wipe
  // picks the list legitimately shows for languages no vendor tags (Marathi),
  // leaving the agent with no voice at all. User-pasted custom IDs (not present
  // in the whitelist) are left untouched.
  useEffect(() => {
    if (ttsProvider !== "cartesia") return;
    if (shouldClearVoiceForLanguage(whitelistedData?.voices ?? [], ttsVoice, language)) {
      form.setValue("ttsVoice", "", { shouldDirty: true });
    }
  }, [language, whitelistedData, ttsProvider, ttsVoice, form]);

  // Clear Sarvam voice when it is incompatible with the selected Bulbul model
  // (v2 speakers + bulbul:v3 → API 400).
  useEffect(() => {
    if (ttsProvider !== "sarvam") return;
    if (!ttsVoice || ttsVoice === "__custom__") return;
    if (!isSarvamVoiceCompatible(ttsVoice, ttsModel)) {
      form.setValue("ttsVoice", "", { shouldDirty: true });
    }
  }, [ttsProvider, ttsModel, ttsVoice, form]);

  // "Paste custom Voice ID" UI mode — selecting the option must NOT erase an
  // already-saved voice ID; the value only changes when the user types into
  // the custom input or picks a different curated voice.
  const [voiceCustomMode, setVoiceCustomMode] = useState(false);

  function applyClonedVoice(voice: ClonedVoiceResult) {
    form.setValue("ttsProvider", "cartesia", { shouldDirty: true });
    form.setValue("ttsVoice", voice.id, { shouldDirty: true });
    setVoiceCustomMode(false);
    void queryClient.invalidateQueries({ queryKey: ["voices", "mine"] });
  }

  function applySarvamClonedVoice(voice: ClonedVoiceResult) {
    form.setValue("ttsProvider", "sarvam", { shouldDirty: true });
    form.setValue("ttsVoice", voice.id, { shouldDirty: true });
    setVoiceCustomMode(false);
    void queryClient.invalidateQueries({ queryKey: ["voices", "mine"] });
  }

  const ttsVoiceRaw   = ttsProvider in TTS_VOICES ? TTS_VOICES[ttsProvider] : undefined;
  const ttsVoiceFree  = ttsVoiceRaw === null;
  const sarvamOverviewOpts = useMemo(() => {
    const catalog = getSarvamTtsVoices(ttsModel);
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [];
    for (const c of mySarvamClones) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      opts.push({ value: c.id, label: `✦ ${c.name}` });
    }
    for (const v of catalog) {
      if (seen.has(v.value)) continue;
      seen.add(v.value);
      opts.push(v);
    }
    if (ttsVoice && ttsVoice !== "__custom__" && !seen.has(ttsVoice)) {
      opts.unshift({ value: ttsVoice, label: ttsVoice });
    }
    opts.push({ value: "__custom__", label: "Paste custom speaker ID" });
    return opts;
  }, [mySarvamClones, ttsModel, ttsVoice]);

  const ttsVoiceOpts: { value: string; label: string; recommended?: boolean }[] =
    ttsProvider === "cartesia"
      ? cartesiaOverviewOpts
      : ttsProvider === "sarvam"
      ? sarvamOverviewOpts
      : ((ttsVoiceRaw ?? []) as { value: string; label: string; recommended?: boolean }[]);

  const llmLabel       = LLM_PROVIDERS.find(p => p.value === llmProvider)?.label ?? llmProvider;
  const ttsLabel       = TTS_PROVIDERS.find(p => p.value === ttsProvider)?.label ?? ttsProvider;
  const langLabel      = LANGUAGES.find(l => l.value === language)?.label ?? language;
  const llmModelLabel  = llmOptions.find((m: any) => m.value === llmModel)?.label ?? llmModel;
  const curatedVoiceOpts = ttsVoiceOpts.filter(v => v.value !== "__custom__");
  const inCuratedList    = curatedVoiceOpts.some(v => v.value === ttsVoice);
  // Languages with dedicated tags: recommended voices are sorted first.
  // Languages with no tags: every voice is available (same full list).
  const hasRecommendedVoicesForLanguage =
    (whitelistedData?.voices ?? []).some(v => isVoiceCompatibleWithLanguage(v.language, language))
    && baseLanguage(language) !== "en";
  const showingAllVoicesForLanguage =
    (whitelistedData?.voices ?? []).length > 0 &&
    (whitelistedData?.voices ?? []).every(v => !isVoiceCompatibleWithLanguage(v.language, language));
  // Only show custom paste when user explicitly chose it, provider is free-form,
  // OR current voice ID is set but not in the curated list (edit existing custom).
  // Empty voice must NOT force custom mode — that hid the "Choose voice" dropdown.
  const showCustomVoiceInput =
    ttsVoiceFree
    || voiceCustomMode
    || (!!ttsVoice && ttsVoice !== "__custom__" && !inCuratedList);
  const ttsVoiceDropdownVal = (() => {
    if (voiceCustomMode || ttsVoiceFree) return "__custom__";
    if (inCuratedList) return ttsVoice ?? "";
    if (!ttsVoice || ttsVoice === "__custom__") return ""; // unselected → placeholder
    return "__custom__"; // unknown custom id
  })();
  const ttsVoiceLabel = resolveVoiceLabel(
    ttsVoice,
    ttsProvider,
    whitelistedData?.voices ?? [],
    (agent as any)?.ttsVoiceName,
  );
  const ttsModelLabel  = ttsModelOpts.find((m: any) => m.value === ttsModel)?.label ?? ttsModel;

  const openPipelineDialog = (section: CardSection) => {
    const snap: Record<string, any> = {};
    for (const field of SECTION_FIELDS[section]) {
      snap[field] = form.getValues(field);
    }
    sectionSnapshotRef.current = { values: snap, voiceCustomMode };
    setOpenSection(section);
  };

  const isSectionDirty = (section: CardSection) => {
    const snap = sectionSnapshotRef.current;
    const fieldsDirty = SECTION_FIELDS[section].some(
      (field) => JSON.stringify(form.getValues(field)) !== JSON.stringify(snap.values[field])
    );
    if (section === "voice" && voiceCustomMode !== snap.voiceCustomMode) return true;
    return fieldsDirty;
  };

  const requestClosePipelineDialog = () => {
    if (!openSection) return;
    if (isSectionDirty(openSection)) {
      setConfirmDiscardSection(openSection);
    } else {
      setOpenSection(null);
    }
  };

  const discardPipelineChanges = () => {
    if (confirmDiscardSection) {
      const snap = sectionSnapshotRef.current;
      for (const field of SECTION_FIELDS[confirmDiscardSection]) {
        form.setValue(field as any, snap.values[field]);
      }
      if (confirmDiscardSection === "voice") setVoiceCustomMode(snap.voiceCustomMode);
    }
    setConfirmDiscardSection(null);
    setOpenSection(null);
  };

  const savePipelineDialog = () => setOpenSection(null);

  const greetingMessage = String(form.watch("greetingMessage") ?? "").trim();
  const systemPrompt = String(form.watch("systemPrompt") ?? "").trim();
  const knowledgeIds = (form.watch("knowledgeSourceIds") ?? []) as number[];
  const voiceReady = isGeminiLive
    ? true
    : Boolean(ttsVoice && ttsVoice !== "__custom__");
  const promptReady = systemPrompt.length >= 40;
  const greetingReady = greetingMessage.length >= 4;

  const { data: overviewPhones } = useListPhoneNumbers({
    query: { queryKey: getListPhoneNumbersQueryKey(), staleTime: 60_000 },
  });
  const assignedPhone = useMemo(() => {
    const list = Array.isArray(overviewPhones) ? overviewPhones : [];
    return list.find((p: any) => p.agentId === agent?.id);
  }, [overviewPhones, agent?.id]);
  const phoneReady = Boolean(assignedPhone || form.watch("preferredManagedNumber"));

  const missingSetup = [
    !promptReady ? "call prompt" : null,
    !greetingReady ? "welcome message" : null,
    !voiceReady ? "voice" : null,
    !phoneReady ? "phone number" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col">
      <div className="relative min-w-0">
        <div className={cn("space-y-6", BUILDER_TAB_PAD)}>
          <BuilderTabHeader
            title="Overview"
            description={
              missingSetup.length === 0
                ? "Ready to test. Script, sound, and phone are set."
                : `Still needs ${missingSetup.join(", ")}.`
            }
            actions={
              <>
                {missingSetup.length === 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    <Check className="size-3" />
                    Ready
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                    <AlertCircle className="size-3" />
                    {missingSetup.length} to finish
                  </span>
                )}
                {onGoToAnalytics && agent?.id ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={onGoToAnalytics}
                  >
                    <BarChart3 className="size-3.5" />
                    Activity
                  </Button>
                ) : null}
                {onGoToPrompt && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={onGoToPrompt}
                  >
                    <FileText className="size-3.5" />
                    Edit script
                  </Button>
                )}
              </>
            }
          />

          <BuilderPanel
            title="How it talks"
            icon={<AudioLines />}
            hint={<AgentCostSummary form={form} rateMap={rateMap} variant="line" />}
          >
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
              <AgentConfigCard
                icon={isGeminiLive ? <Globe /> : <Mic />}
                label={isGeminiLive ? "Language" : "Transcriber"}
                value={langLabel}
                subtext={isGeminiLive ? "Gemini Live conversation language" : "Caller speech"}
                active={openSection === "transcriber"}
                onClick={() => openPipelineDialog("transcriber")}
              />
              <AgentConfigCard
                icon={<Brain />}
                label="Model"
                value={isGeminiLive ? geminiLiveModelLabel() : (llmModelLabel || llmLabel)}
                subtext={isGeminiLive ? "Native realtime audio" : llmLabel}
                active={openSection === "model"}
                onClick={() => openPipelineDialog("model")}
              />
              <AgentConfigCard
                icon={<Volume2 />}
                label="Voice"
                value={isGeminiLive ? (geminiLiveVoiceName || "Kore") : (ttsVoiceLabel || "Select a voice")}
                subtext={isGeminiLive ? "Gemini Live preset voice" : <>{ttsLabel}{ttsModelLabel ? ` · ${ttsModelLabel}` : ""}</>}
                active={openSection === "voice"}
                onClick={() => openPipelineDialog("voice")}
              />
            </div>
          </BuilderPanel>

          <section className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
            {agent?.id != null && (
              <BuilderPanel
                title="Phone"
                icon={<PhoneForwarded />}
                hint={phoneReady ? (
                  <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">Live</span>
                ) : (
                  <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300">Required</span>
                )}
                action={
                  <Link href="/app/phone-numbers" className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
                    Numbers →
                  </Link>
                }
              >
                <AgentInboundPanel
                  agentId={agent.id}
                  preferredManagedNumber={form.watch("preferredManagedNumber")}
                  telephonyProvider={form.watch("telephonyProvider")}
                  bare
                />
              </BuilderPanel>
            )}
            <BuilderPanel
              title="Knowledge"
              icon={<BookOpen />}
              hint={
                <span className="text-[10px] text-muted-foreground">
                  {knowledgeIds.length > 0
                    ? `${knowledgeIds.length} source${knowledgeIds.length === 1 ? "" : "s"}`
                    : "Optional"}
                </span>
              }
            >
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Documents searched during live calls and injected into context.
              </p>
              <FormField control={form.control} name="knowledgeSourceIds" render={({ field }) => (
                <FormItem className="mt-3 space-y-0">
                  <FormControl>
                    <KnowledgeSourceMultiSelect
                      value={(field.value ?? []) as number[]}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage className="text-[10px]" />
                </FormItem>
              )} />
              {knowledgeIds.length === 0 ? (
                <p className="mt-auto pt-4 text-[11px] leading-relaxed text-muted-foreground">
                  Empty is fine. Attach a source only if this agent should look things up on the call.
                </p>
              ) : null}
            </BuilderPanel>
          </section>

          {agent?.id != null && (
            <BuilderPanel title="Team" icon={<Users />}>
              <AgentTeamStrip agentId={agent.id} compact />
            </BuilderPanel>
          )}

          {agent?.id != null && (
            <BuilderPanel
              title="Website embed"
              icon={<Globe />}
              description="Copy this onto your site so visitors can webcall this agent in the browser"
            >
              <AgentWebsiteEmbedPanel agentId={agent.id} agentName={agent.name ?? ""} />
            </BuilderPanel>
          )}

          {/* ── Transcriber / Language dialog ── */}
          <EditConfigDialog
            open={openSection === "transcriber"}
            onRequestClose={requestClosePipelineDialog}
            onSave={savePipelineDialog}
            icon={isGeminiLive ? <Globe /> : <Mic />}
            title={isGeminiLive ? "Language" : "Transcriber"}
            description={
              isGeminiLive
                ? "Choose the conversation language for Gemini Live. Native audio has no separate STT — language is enforced via system instructions."
                : "What language callers speak, and how their words should be written."
            }
          >
            {isGeminiLive && (
              <p className="text-[11px] text-muted-foreground rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                Gemini Live supports ~97 languages. Pick the primary language callers should hear and speak.
              </p>
            )}
            <div className="space-y-4">
              <FormField control={form.control} name="language" render={({ field }) => {
                const langOpts = languagesForAgent(isGeminiLive);
                const current = field.value ?? "";
                const inList = langOpts.some(l => l.value === current);
                const options = (!current || inList)
                  ? langOpts
                  : [{ value: current, label: LANGUAGES.find(l => l.value === current)?.label ?? current }, ...langOpts];
                return (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground">Language</FormLabel>
                  <SmallSelect value={field.value} onChange={(v) => {
                    field.onChange(v);
                  }}
                    options={options.map(l => ({ value: l.value, label: l.label }))} placeholder="Select language" />
                </FormItem>
                );
              }} />
              {!isGeminiLive && asrProvider === "sarvam" && asrModel && asrModel !== SARVAM_PRODUCT_ASR_MODEL && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 space-y-2">
                  <p className="text-[11px] text-foreground/80 leading-snug">
                    This agent is on a legacy transcriber. Switch to Saaras v3 for live calls.
                  </p>
                  <button
                    type="button"
                    className="text-[11px] font-medium text-primary hover:underline"
                    onClick={() => form.setValue("asrModel", SARVAM_PRODUCT_ASR_MODEL, { shouldDirty: true })}
                  >
                    Use Saaras v3
                  </button>
                </div>
              )}
              {!isGeminiLive && asrProvider === "sarvam" && asrModelOpts.length > 1 && (
                <FormField control={form.control} name="asrModel" render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Model</FormLabel>
                    <SmallSelect value={field.value ?? ""} onChange={field.onChange}
                      options={asrModelOpts.map((m: any) => ({ value: m.value, label: m.label }))} placeholder="Default" />
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )} />
              )}
              {!isGeminiLive && asrProvider === "sarvam" && (
                <FormField control={form.control} name="sarvamSttMode" render={({ field }) => {
                  const currentValue = field.value ?? "codemix";
                  return (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] font-medium text-foreground/80">How speech is written</FormLabel>
                    <SmallSelect value={currentValue} onChange={field.onChange}
                      options={[
                        { value: "codemix", label: "Mixed — Hinglish, Tanglish, …" },
                        { value: "transcribe", label: "Native script — हिंदी, தமிழ்" },
                        { value: "translate", label: "English text — any language spoken" },
                        ...(currentValue === "verbatim"
                          ? [{ value: "verbatim", label: "Verbatim — include fillers" }]
                          : []),
                        ...(currentValue === "translit"
                          ? [{ value: "translit", label: "Roman script — Indic in Latin letters" }]
                          : []),
                      ]} />
                    <p className="text-[9.5px] text-muted-foreground leading-snug mt-1">
                      {currentValue === "transcribe"
                        ? "Every word in native script (मेरा फोन नंबर). Not for Hinglish — English becomes हिंदी."
                        : currentValue === "codemix"
                        ? "Sarvam's code-mix mode: English stays English, Hindi stays हिंदी. Right default for Indian calls."
                        : currentValue === "verbatim"
                        ? "Keeps fillers and exact phrasing as spoken."
                        : currentValue === "translit"
                        ? "Writes Indic speech in English letters."
                        : currentValue === "translate"
                        ? "Whatever the caller speaks is written as English."
                        : "Defaults to mixed speech so Hinglish is captured. Pick native script only if every word should stay in हिंदी / தமிழ்."}
                    </p>
                  </FormItem>
                  );
                }} />
              )}
              {!isGeminiLive && asrProvider === "sarvam" && (
                <FormField control={form.control} name="sarvamSttPrompt" render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] font-medium text-foreground/80">Brand names & terms</FormLabel>
                    <Input
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      placeholder="e.g. SuperBae, IRDAI, UPI, GSTIN"
                      className="h-8 text-[11px]"
                      maxLength={500}
                    />
                    <p className="text-[9.5px] text-muted-foreground leading-snug mt-1">
                      Helps the transcriber spell these words correctly.
                    </p>
                  </FormItem>
                )} />
              )}
              {!isGeminiLive && asrProvider === "sarvam" && form.watch("sarvamSttStreamType") === "simulated" && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 space-y-2">
                  <p className="text-[11px] text-foreground/80 leading-snug">
                    Partials are off, so the agent waits for a full sentence before it can hear an interrupt. Turn this on for live calls.
                  </p>
                  <button
                    type="button"
                    className="text-[11px] font-medium text-primary hover:underline"
                    onClick={() => form.setValue("sarvamSttStreamType", "fast", { shouldDirty: true })}
                  >
                    Use fast partials
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-3 border-t border-border pt-3 mt-1">
              <p className="text-[11px] font-semibold text-foreground tracking-tight">Language personalisation</p>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium text-foreground/80">Switch language during call</p>
                  <p className="text-[9px] text-muted-foreground">
                    {isGeminiLive
                      ? "Allow Gemini Live to follow the caller when they switch languages mid-call."
                      : "Follow the caller if they switch languages mid-call."}
                  </p>
                </div>
                <FormField control={form.control} name="languageAutoDetect" render={({ field }) => (
                  <Switch
                    checked={field.value ?? false}
                    onCheckedChange={(v) => {
                      field.onChange(v);
                      if (v && !(form.getValues("multilingualLanguages")?.length)) {
                        const start = form.getValues("language") || "en-IN";
                        const seed = ["en-IN", "hi-IN", "ta-IN"].includes(start)
                          ? ["en-IN", "hi-IN", "ta-IN"]
                          : [start, "en-IN"];
                        form.setValue("multilingualLanguages", [...new Set(seed)], { shouldDirty: true });
                      }
                    }}
                  />
                )} />
              </div>
              {!!form.watch("languageAutoDetect") && (
                <FormField control={form.control} name="multilingualLanguages" render={({ field }) => {
                  const selected = new Set(field.value ?? []);
                  return (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-[10px] font-medium text-foreground/80">Languages allowed</FormLabel>
                      <p className="text-[9px] text-muted-foreground">Languages this agent can understand and reply in.</p>
                      <div className="flex flex-wrap gap-1.5">
                        {SARVAM_PERSONALISATION_LANGUAGES.map((lang) => {
                          const on = selected.has(lang.value);
                          return (
                            <button
                              key={lang.value}
                              type="button"
                              onClick={() => {
                                const next = new Set(selected);
                                if (on) next.delete(lang.value);
                                else next.add(lang.value);
                                field.onChange([...next]);
                              }}
                              className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] border transition-colors",
                                on
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-background text-muted-foreground border-border hover:border-foreground/30",
                              )}
                            >
                              {lang.label.replace(" (India)", "")}
                            </button>
                          );
                        })}
                      </div>
                    </FormItem>
                  );
                }} />
              )}
              <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium text-foreground/80">Output numbers in Indic</p>
                  <p className="text-[9px] text-muted-foreground">Converts numbers for speech. E.g. &apos;500&apos; → &apos;paanch sau&apos; (Sarvam TTS).</p>
                </div>
                <FormField control={form.control} name="sarvamIndicNumbers" render={({ field }) => (
                  <Switch
                    checked={field.value !== false}
                    onCheckedChange={field.onChange}
                  />
                )} />
              </div>
            </div>
          </EditConfigDialog>

          {/* ── Model dialog ── */}
          <EditConfigDialog
            open={openSection === "model"}
            onRequestClose={requestClosePipelineDialog}
            onSave={savePipelineDialog}
            icon={<Brain />}
            title="Model"
            description="Choose Classic STT+LLM+TTS, or Gemini Live native speech-to-speech."
          >
            <FormField control={form.control} name="voiceStack" render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-[10px] text-muted-foreground">Voice stack</FormLabel>
                <SmallSelect
                  value={isGeminiLive ? "gemini_live" : (field.value ?? "classic")}
                  onChange={(v) => {
                    const stack = v === "gemini_live" ? "gemini_live" : "classic";
                    field.onChange(stack);
                    const next = llmFieldsForVoiceStack(stack, {
                      llmProvider: form.getValues("llmProvider"),
                      llmModel: form.getValues("llmModel"),
                    });
                    form.setValue("llmProvider", next.llmProvider, { shouldDirty: true });
                    form.setValue("llmModel", next.llmModel, { shouldDirty: true });
                  }}
                  options={VOICE_STACK_OPTIONS.map((p) => ({ value: p.value, label: p.label }))}
                />
              </FormItem>
            )} />
            {isGeminiLive && (
              <p className="text-[11px] text-muted-foreground rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                Gemini Live uses native speech-to-speech. Classic STT/TTS are skipped — set language in the Language card and pick a preset voice in Voice.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="llmProvider" render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground">Provider</FormLabel>
                  <SmallSelect value={field.value} onChange={(v) => {
                    field.onChange(v);
                    form.setValue("llmModel", "");
                    form.setValue("voiceStack", "classic");
                  }}
                    options={LLM_PROVIDERS.map(p => ({ value: p.value, label: p.label }))} />
                </FormItem>
              )} />
              {llmOptions.length > 0 && (
                <FormField control={form.control} name="llmModel" render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Model</FormLabel>
                    <SmallSelect value={field.value ?? ""} onChange={(v) => {
                      field.onChange(v);
                      form.setValue("voiceStack", voiceStackForLlmModel(v), { shouldDirty: true });
                    }}
                      options={llmOptions.map((m: { value: string; label: string }) => ({ value: m.value, label: m.label }))} placeholder="Default" />
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )} />
              )}
            </div>
            {!isGeminiLive && (
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
            )}
          </EditConfigDialog>

          {/* ── Voice dialog ── */}
          <EditConfigDialog
            open={openSection === "voice"}
            onRequestClose={requestClosePipelineDialog}
            onSave={savePipelineDialog}
            icon={<Volume2 />}
            title="Voice"
            description={isGeminiLive ? "Choose a Gemini Live preset voice for this agent." : "Choose the TTS provider and voice for spoken responses."}
          >
            {isGeminiLive ? (
              <div className="space-y-3">
                <FormField control={form.control} name="geminiLiveVoiceName" render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <GeminiLiveVoicePicker value={field.value ?? "Kore"} onChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="geminiLiveThinkingLevel" render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Thinking level</FormLabel>
                    <SmallSelect value={field.value ?? "minimal"} onChange={field.onChange}
                      options={GEMINI_LIVE_THINKING_LEVELS.map(p => ({ value: p.value, label: p.label }))} />
                  </FormItem>
                )} />
              </div>
            ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="ttsProvider" render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Provider</FormLabel>
                    <SmallSelect value={field.value} onChange={(v) => { field.onChange(v); setVoiceCustomMode(false); form.setValue("ttsVoice", ""); form.setValue("ttsModel", ""); }}
                      options={TTS_PROVIDERS.map(p => ({ value: p.value, label: p.label }))} />
                  </FormItem>
                )} />
                {ttsModelOpts.length > 0 && (
                  <FormField control={form.control} name="ttsModel" render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-[10px] text-muted-foreground">Model</FormLabel>
                      <SmallSelect
                        value={field.value ?? ""}
                        onChange={(v) => {
                          field.onChange(v);
                          if (ttsProvider === "sarvam") {
                            const current = form.getValues("ttsVoice");
                            if (!isSarvamVoiceCompatible(current, v)) {
                              form.setValue("ttsVoice", "", { shouldDirty: true });
                            }
                          }
                        }}
                        options={ttsModelOpts.map((m: any) => ({ value: m.value, label: m.label }))}
                        placeholder="Default"
                      />
                    </FormItem>
                  )} />
                )}
              </div>

              {(ttsVoiceOpts.length > 0 || ttsVoiceFree) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-medium text-muted-foreground">Choose voice</p>
                    {!isGeminiLive && ttsProvider === "cartesia" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] gap-1 px-2"
                        onClick={() => setCloneOpen(true)}
                      >
                        <CopyPlus className="h-3 w-3" />
                        Clone voice
                      </Button>
                    )}
                    {!isGeminiLive && ttsProvider === "sarvam" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] gap-1 px-2"
                        onClick={() => setSarvamCloneOpen(true)}
                      >
                        <CopyPlus className="h-3 w-3" />
                        Add Sarvam clone
                      </Button>
                    )}
                  </div>
                  {ttsProvider === "sarvam" && (
                    <p className="text-[10px] text-muted-foreground/90 leading-relaxed">
                      Default stack
                    </p>
                  )}
                  {ttsVoiceOpts.length > 0 && (
                    <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                      <FormItem className="space-y-0">
                        <FormControl>
                          <SmallSelect
                            value={ttsVoiceDropdownVal}
                            onChange={(v) => {
                              if (v === "__custom__") {
                                // Show the custom input without erasing the saved voice ID.
                                setVoiceCustomMode(true);
                                return;
                              }
                              setVoiceCustomMode(false);
                              field.onChange(v);
                            }}
                            options={ttsVoiceOpts.map(v => ({
                              value: v.value,
                              label: v.label,
                              recommended: v.recommended,
                            }))}
                            placeholder="Select a voice…"
                          />
                        </FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )} />
                  )}
                  {ttsProvider === "cartesia" && hasRecommendedVoicesForLanguage && (
                    <p className="text-[10px] text-muted-foreground leading-relaxed rounded-md border border-border bg-muted/40 px-2.5 py-2">
                      Voices recommended for {langLabel} are listed first. You can still pick any other voice.
                    </p>
                  )}
                  {ttsProvider === "cartesia" && showingAllVoicesForLanguage && (
                    <p className="text-[10px] text-muted-foreground leading-relaxed rounded-md border border-border bg-muted/40 px-2.5 py-2">
                      No voices are tagged for {langLabel} — showing every available voice. Most multilingual voices speak it well; preview a few to pick one.
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
                          className="h-8 text-xs bg-background/50 font-mono"
                        />
                        <FormDescription className="text-[10px]">
                          Find voice IDs in your {ttsProvider === "cartesia" ? "Cartesia" : ttsProvider === "elevenlabs" ? "ElevenLabs" : ttsProvider === "sarvam" ? "Sarvam Creative Studio" : "provider"} dashboard.
                        </FormDescription>
                      </FormItem>
                    )} />
                  )}
                </div>
              )}
              <CloneVoiceDialog
                open={cloneOpen}
                onOpenChange={setCloneOpen}
                defaultLanguage={language}
                onCloned={applyClonedVoice}
              />
              <RegisterSarvamVoiceDialog
                open={sarvamCloneOpen}
                onOpenChange={setSarvamCloneOpen}
                defaultLanguage={language}
                onRegistered={applySarvamClonedVoice}
              />
            </div>
            )}
          </EditConfigDialog>

          {/* ── Unsaved changes confirmation ── */}
          <AlertDialog open={confirmDiscardSection !== null} onOpenChange={(v) => { if (!v) setConfirmDiscardSection(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
                <AlertDialogDescription>
                  You have unsaved changes in this dialog. Closing now will discard them.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setConfirmDiscardSection(null)}>Keep Editing</AlertDialogCancel>
                <AlertDialogAction onClick={discardPipelineChanges}>Discard Changes</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

        </div>
      </div>
    </div>
  );
}

/* ── Tab: Prompt ────────────────────────────────────────────────────────────── */

function PromptTab({ form, agentId }: { form: any; agentId?: number }) {
  const [, navigate] = useLocation();
  const { teamByAgentId } = useAgentTeamMap();
  const team = agentId != null ? teamByAgentId.get(agentId) : undefined;
  const { fields: pvFields, append: pvAppend, remove: pvRemove } = useFieldArray({ control: form.control, name: "promptVariables" });
  const [generateOpen, setGenerateOpen] = useState(false);
  const [promptSurface, setPromptSurface] = useState<"calls" | "meetings">("calls");
  const agentName  = form.watch("name")     as string | undefined;
  const agentLang  = form.watch("language") as string | undefined;
  const canAttendMeetings = form.watch("agentSurfaces") === "phone_and_meet";
  const callPromptLen = String(form.watch("systemPrompt") ?? "").length;
  const meetPromptLen = String(form.watch("meetingPrompt") ?? "").length;
  const promptLen = promptSurface === "calls" ? callPromptLen : meetPromptLen;
  const langLabel = LANGUAGES.find(l => l.value === agentLang)?.label ?? agentLang ?? "Language";

  useEffect(() => {
    if (!canAttendMeetings && promptSurface === "meetings") setPromptSurface("calls");
  }, [canAttendMeetings, promptSurface]);

  return (
    <div className={cn("relative flex min-h-full flex-col gap-6", BUILDER_TAB_PAD)}>
      <BuilderTabHeader
        title="Script"
        description="Welcome first, then the instructions for the whole call. Live-test from the header before you publish."
      />
      <GeneratePromptSheet
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        defaultAgentName={agentName ?? ""}
        defaultLanguage={agentLang ?? "en-US"}
        currentPrompt={form.watch("systemPrompt") ?? ""}
        onApply={(prompt, meta) => {
          form.setValue("systemPrompt", prompt, { shouldDirty: true });
          form.setValue("systemPromptGenMeta", meta, { shouldDirty: true });
          setPromptSurface("calls");
        }}
      />

      {team && team.members.length >= 2 && (
        <BuilderPanel
          title="Team prompts"
          icon={<Users />}
          description="Handoffs use the specialist's prompt"
        >
          <div className="flex flex-wrap gap-1.5">
            {team.members.map((m) => {
              const active = m.agentId === agentId;
              return (
                <button
                  key={m.agentId}
                  type="button"
                  disabled={active}
                  onClick={() => navigate(agentPathWithSection(m.agentId, "prompt"))}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors",
                    active
                      ? "border-foreground/25 bg-background font-medium text-foreground"
                      : "border-border/70 bg-background/60 text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                  )}
                  title={active ? `Editing ${m.agentName}'s prompt` : `Edit ${m.agentName}'s prompt`}
                >
                  <span className="truncate">{active ? `Editing ${m.agentName}` : m.agentName}</span>
                  <span className="truncate text-muted-foreground">· {m.roleName}</span>
                </button>
              );
            })}
          </div>
        </BuilderPanel>
      )}

      <BuilderPanel
        title="Welcome"
        icon={<MessageCircle />}
        description="What callers hear first"
        bodyClassName="gap-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label className="text-[12px] font-medium text-foreground/90">Who speaks first</Label>
          <FormField control={form.control} name="firstSpeaker" render={({ field }) => (
            <Select value={field.value === "user" ? "user" : "assistant"} onValueChange={field.onChange}>
              <SelectTrigger className="h-8 w-48 shrink-0 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="assistant" className="text-[13px]">Assistant speaks first</SelectItem>
                <SelectItem value="user" className="text-[13px]">User speaks first</SelectItem>
              </SelectContent>
            </Select>
          )} />
        </div>
        <FormField control={form.control} name="greetingMessage" render={({ field }) => (
          <FormItem className="space-y-0">
            <FormControl>
              <Textarea
                className="min-h-[72px] max-h-[120px] resize-none rounded-lg border-border bg-background px-3.5 py-2.5 text-[13px] leading-relaxed shadow-none focus-visible:border-foreground/20 focus-visible:ring-0"
                placeholder="Hello, how can I help?"
                {...field}
              />
            </FormControl>
            <FormMessage className="text-[10px]" />
          </FormItem>
        )} />
      </BuilderPanel>

      <BuilderPanel
        title="Talk"
        icon={<FileText />}
        description={canAttendMeetings ? "Phone calls and meetings" : "Instructions for phone calls"}
        hint={
          <>
            <Badge variant="secondary" className="h-5 rounded-md px-1.5 py-0 text-[10px] font-medium">
              {langLabel}
            </Badge>
            <span className="hidden text-[10px] tabular-nums text-muted-foreground sm:inline">
              {promptLen.toLocaleString()} chars
            </span>
          </>
        }
        action={promptSurface === "calls" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-[11px]"
            onClick={() => setGenerateOpen(true)}
          >
            <Sparkles className="size-3.5" />
            Generate
          </Button>
        ) : undefined}
        bodyClassName="p-0"
      >
      {canAttendMeetings ? (
        <Tabs value={promptSurface} onValueChange={(v) => setPromptSurface(v as "calls" | "meetings")} className="w-full">
          <div className="border-b border-border px-4 py-2.5">
            <TabsList className="h-9 w-full sm:w-auto grid grid-cols-2 sm:inline-flex">
              <TabsTrigger value="calls" className="gap-1.5 text-xs">
                <Phone className="h-3.5 w-3.5" />
                On calls
              </TabsTrigger>
              <TabsTrigger value="meetings" className="gap-1.5 text-xs">
                <Video className="h-3.5 w-3.5" />
                In meetings
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="calls" className="mt-0">
            <FormField control={form.control} name="systemPrompt" render={({ field }) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <Textarea
                    className="min-h-[min(48vh,480px)] resize-y rounded-none border-0 bg-transparent px-4 py-4 font-mono text-[12.5px] leading-6 shadow-none focus-visible:ring-0"
                    placeholder="You are a helpful voice assistant on phone calls…"
                    {...field}
                  />
                </FormControl>
                <FormMessage className="px-4 pb-3" />
              </FormItem>
            )} />
          </TabsContent>
          <TabsContent value="meetings" className="mt-0">
            <div className="border-b border-border bg-muted/25 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
              <p className="font-medium text-foreground/90">Meeting ≠ phone call</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                <li>People may ask you to wait 2–3 minutes for others — stay quiet after one acknowledgment.</li>
                <li>Speaker tags like <span className="font-mono text-[10px]">[Speaker: Name]</span> are for you; never read them aloud.</li>
                <li>
                  Waiting patience &amp; max length are on{" "}
                  <Link href={agentId ? `/app/meet?agentId=${agentId}` : "/app/meet"} className="text-foreground/80 underline underline-offset-2">
                    Meeting bots
                  </Link>{" "}
                  (not Engine phone silence).
                </li>
              </ul>
            </div>
            <FormField control={form.control} name="meetingPrompt" render={({ field }) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <Textarea
                    className="min-h-[min(48vh,480px)] resize-y rounded-none border-0 bg-transparent px-4 py-4 font-mono text-[12.5px] leading-6 shadow-none focus-visible:ring-0"
                    placeholder={"You are a participant in a live video meeting…\nIf asked to wait for others, acknowledge once and stay quiet.\nAddress people by name when speaker tags appear."}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage className="px-4" />
              </FormItem>
            )} />
            <p className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
              Blank uses the call prompt. Join links, wait time, and deck live on{" "}
              <Link href={agentId ? `/app/meet?agentId=${agentId}` : "/app/meet"} className="underline underline-offset-2">
                Meeting bots
              </Link>
              .
            </p>
          </TabsContent>
        </Tabs>
      ) : (
        <FormField control={form.control} name="systemPrompt" render={({ field }) => (
          <FormItem className="space-y-0">
            <FormControl>
              <Textarea
                className="min-h-[min(48vh,480px)] resize-y rounded-none border-0 bg-transparent px-4 py-4 font-mono text-[12.5px] leading-6 shadow-none focus-visible:ring-0"
                placeholder="You are a helpful voice assistant on phone calls…"
                {...field}
              />
            </FormControl>
            <FormMessage className="px-4 pb-3" />
          </FormItem>
        )} />
      )}
      </BuilderPanel>

      <BuilderPanel title="Call behaviour" icon={<Settings />} bodyClassName="p-0 px-4">
        <div>
          <PropertyRow
            label="Timezone"
            description="Injected as current-time context"
          >
            <FormField control={form.control} name="timezone" render={({ field }) => (
              <FormItem className="space-y-0">
                <SmallSelect
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  options={[{ value: "", label: "Not set" }, ...AGENT_TIMEZONES]}
                  placeholder="Not set"
                />
              </FormItem>
            )} />
          </PropertyRow>
          <PropertyRow
            label="End-call phrases"
            description="Hang up after saying any of these"
          >
            <FormField control={form.control} name="endCallPhrases" render={({ field }) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <Input placeholder="goodbye, bye, see you" className="h-8 text-xs" {...field} />
                </FormControl>
              </FormItem>
            )} />
          </PropertyRow>
        </div>
      </BuilderPanel>

      <BuilderPanel
        title="Prompt variables"
        icon={<Layers />}
        description={`Use ${"{{variable}}"} in the prompt`}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2.5 text-[11px]"
            onClick={() => pvAppend({ key: "", defaultValue: "", description: "" })}
          >
            <Plus className="size-3" />
            Add
          </Button>
        }
        bodyClassName="p-0"
      >
        {pvFields.length === 0 ? (
          <p className="px-4 py-5 text-[12px] leading-relaxed text-muted-foreground">
            Optional defaults for {"{{placeholders}}"}. On each{" "}
            <code className="font-mono text-[11px]">POST /calls/outbound</code>, pass a{" "}
            <code className="font-mono text-[11px]">variables</code> object (patient name, category,
            questions). Those values override defaults for that call only — one agent can serve many
            questionnaires.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {pvFields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-[1fr_1fr_minmax(0,1.4fr)_28px] items-center gap-2 px-4 py-2.5">
                <FormField control={form.control} name={`promptVariables.${i}.key`} render={({ field: ff }) => (
                  <FormItem className="space-y-0">
                    <FormControl><Input placeholder="key" className="h-8 text-xs" {...ff} /></FormControl>
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )} />
                <FormField control={form.control} name={`promptVariables.${i}.defaultValue`} render={({ field: ff }) => (
                  <FormItem className="space-y-0">
                    <FormControl><Input placeholder="default" className="h-8 text-xs" {...ff} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name={`promptVariables.${i}.description`} render={({ field: ff }) => (
                  <FormItem className="space-y-0">
                    <FormControl><Input placeholder="description" className="h-8 text-xs" {...ff} /></FormControl>
                  </FormItem>
                )} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={() => pvRemove(i)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </BuilderPanel>
    </div>
  );
}

/* ── Tab: Voice ─────────────────────────────────────────────────────────────── */

function VoiceTab({ form }: { form: any }) {
  const ttsProvider    = form.watch("ttsProvider");
  const ttsVoice       = form.watch("ttsVoice");
  const ttsModel       = form.watch("ttsModel");
  const agentLanguage  = (form.watch("language") as string) ?? "en-US";
  const llmModel       = (form.watch("llmModel")   as string) ?? "";
  const voiceStack     = (form.watch("voiceStack") as string) ?? "classic";
  const geminiLiveVoiceName = (form.watch("geminiLiveVoiceName") as string) ?? "Kore";
  const isGeminiLive   = isGeminiLiveAgent({ llmModel, voiceStack });
  const [cloneOpenV, setCloneOpenV] = useState(false);
  const [sarvamCloneOpenV, setSarvamCloneOpenV] = useState(false);
  const queryClient = useQueryClient();

  // Fetch admin-whitelisted voices (public endpoint, no auth required)
  const { data: whitelistedData } = useQuery({
    queryKey: ["voices", "whitelisted"],
    queryFn: () => customFetch<{ voices: Array<{ id: string; name: string; language: string }> }>(`${DASH_API}/voices/whitelisted`),
    staleTime: 5 * 60 * 1000,
  });

  const { data: myClonesData } = useQuery({
    queryKey: ["voices", "mine"],
    queryFn: () => customFetch<{ voices: ClonedVoiceResult[] }>(`${DASH_API}/voices/mine`),
    staleTime: 60 * 1000,
  });
  const myClones = myClonesData?.voices ?? [];
  const myCartesiaClonesV = myClones.filter((c) => (c.provider ?? "cartesia") === "cartesia");
  const mySarvamClonesV = myClones.filter((c) => c.provider === "sarvam");

  // Show ALL whitelisted voices; language matches (recommended) sorted first.
  // Identical to the Overview section's list.
  const cartesiaVoiceOpts = useMemo(() => {
    const all = whitelistedData?.voices ?? [];
    const ordered = orderVoicesByLanguage(all, agentLanguage);
    const seen = new Set<string>();
    const opts: { value: string; label: string; recommended?: boolean }[] = [];
    for (const c of myCartesiaClonesV) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      opts.push({ value: c.id, label: `✦ ${c.name}` });
    }
    for (const v of ordered) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      const recommended = isVoiceCompatibleWithLanguage(v.language, agentLanguage)
        && baseLanguage(agentLanguage) !== "en";
      opts.push({
        value: v.id,
        label: v.name,
        recommended: recommended || undefined,
      });
    }
    if (opts.length === 0 && Array.isArray(TTS_VOICES.cartesia)) {
      for (const v of TTS_VOICES.cartesia) {
        if (v.value === "__custom__" || seen.has(v.value)) continue;
        seen.add(v.value);
        opts.push(v);
      }
    }
    if (ttsVoice && ttsVoice !== "__custom__" && !seen.has(ttsVoice)) {
      opts.unshift({
        value: ttsVoice,
        label: resolveVoiceLabel(ttsVoice, "cartesia", all),
      });
    }
    opts.push({ value: "__custom__", label: "Paste custom Voice ID" });
    return opts;
  }, [whitelistedData, agentLanguage, ttsVoice, myCartesiaClonesV]);

  // Same rule as the Overview section: membership of the offered list, not the
  // raw language tag, so mounting either section never wipes a voice the other
  // one showed. User-pasted custom IDs are left untouched.
  useEffect(() => {
    if (ttsProvider !== "cartesia") return;
    if (shouldClearVoiceForLanguage(whitelistedData?.voices ?? [], ttsVoice, agentLanguage)) {
      form.setValue("ttsVoice", "", { shouldDirty: true });
    }
  }, [agentLanguage, whitelistedData, ttsProvider, ttsVoice, form]);

  // "Paste custom Voice ID" UI mode — selecting the option must NOT erase an
  // already-saved voice ID; the value only changes when the user types into
  // the custom input or picks a different curated voice.
  const [voiceCustomModeV, setVoiceCustomModeV] = useState(false);

  function applyClonedVoiceV(voice: ClonedVoiceResult) {
    form.setValue("ttsProvider", "cartesia", { shouldDirty: true });
    form.setValue("ttsVoice", voice.id, { shouldDirty: true });
    setVoiceCustomModeV(false);
    void queryClient.invalidateQueries({ queryKey: ["voices", "mine"] });
  }

  function applySarvamClonedVoiceV(voice: ClonedVoiceResult) {
    form.setValue("ttsProvider", "sarvam", { shouldDirty: true });
    form.setValue("ttsVoice", voice.id, { shouldDirty: true });
    setVoiceCustomModeV(false);
    void queryClient.invalidateQueries({ queryKey: ["voices", "mine"] });
  }

  const sarvamVoiceOptsV = useMemo(() => {
    const catalog = getSarvamTtsVoices(ttsModel);
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [];
    for (const c of mySarvamClonesV) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      opts.push({ value: c.id, label: `✦ ${c.name}` });
    }
    for (const v of catalog) {
      if (seen.has(v.value)) continue;
      seen.add(v.value);
      opts.push(v);
    }
    if (ttsVoice && ttsVoice !== "__custom__" && !seen.has(ttsVoice)) {
      opts.unshift({ value: ttsVoice, label: ttsVoice });
    }
    opts.push({ value: "__custom__", label: "Paste custom speaker ID" });
    return opts;
  }, [mySarvamClonesV, ttsModel, ttsVoice]);

  // For non-Cartesia providers fall back to the hardcoded list
  const ttsVoiceRawV  = ttsProvider in TTS_VOICES ? TTS_VOICES[ttsProvider] : undefined;
  const ttsVoiceOptsV: { value: string; label: string; recommended?: boolean }[] =
    ttsProvider === "cartesia"
      ? cartesiaVoiceOpts
      : ttsProvider === "sarvam"
      ? sarvamVoiceOptsV
      : ((ttsVoiceRawV ?? []) as { value: string; label: string; recommended?: boolean }[]);

  const ttsModelOptsV = TTS_MODELS[ttsProvider] ?? [];
  const curatedVoiceOptsV = ttsVoiceOptsV.filter(v => v.value !== "__custom__");
  const inCuratedV        = curatedVoiceOptsV.some(v => v.value === ttsVoice);
  const hasRecommendedVoicesForLanguageV =
    (whitelistedData?.voices ?? []).some(v => isVoiceCompatibleWithLanguage(v.language, agentLanguage))
    && baseLanguage(agentLanguage) !== "en";
  const showingAllVoicesForLanguageV =
    (whitelistedData?.voices ?? []).length > 0 &&
    (whitelistedData?.voices ?? []).every(v => !isVoiceCompatibleWithLanguage(v.language, agentLanguage));
  // Don't force custom mode when voice is empty — that hid the Choose Voice dropdown.
  const showCustomV =
    ttsVoiceRawV === null
    || voiceCustomModeV
    || (!!ttsVoice && ttsVoice !== "__custom__" && !inCuratedV);
  const dropdownValV = (() => {
    if (voiceCustomModeV || ttsVoiceRawV === null) return "__custom__";
    if (inCuratedV) return ttsVoice ?? "";
    if (!ttsVoice || ttsVoice === "__custom__") return "";
    return "__custom__";
  })();

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
  const ambientNoiseVolume  = (form.watch("ambientNoiseVolume") as number | undefined) ?? 1.0;
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
      // Mirror Voice-tab Volume so preview matches the call bed level.
      audio.volume = Math.max(0, Math.min(1, ambientNoiseVolume));
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

  // Keep live preview bed level in sync with the Volume slider.
  useEffect(() => {
    if (ambientAudioRef.current) {
      ambientAudioRef.current.volume = Math.max(0, Math.min(1, ambientNoiseVolume));
    }
  }, [ambientNoiseVolume]);

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
    <div className={cn("relative flex min-h-full flex-col gap-6", BUILDER_TAB_PAD)}>
      <BuilderTabHeader
        title="Sound"
        description="Voice, language, and how quickly the agent takes a turn after the caller pauses."
      />

      <BuilderPanel
        title="Speaking"
        icon={<Volume2 />}
        description="Provider, voice, speed, and model"
        bodyClassName="gap-3"
      >
        <div className="space-y-3">
          <FormField control={form.control} name="voiceStack" render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-xs text-muted-foreground">Voice stack</FormLabel>
              <SmallSelect
                value={isGeminiLive ? "gemini_live" : (field.value ?? "classic")}
                onChange={(v) => {
                  const stack = v === "gemini_live" ? "gemini_live" : "classic";
                  field.onChange(stack);
                  const next = llmFieldsForVoiceStack(stack, {
                    llmProvider: form.getValues("llmProvider"),
                    llmModel: form.getValues("llmModel"),
                  });
                  form.setValue("llmProvider", next.llmProvider, { shouldDirty: true });
                  form.setValue("llmModel", next.llmModel, { shouldDirty: true });
                }}
                options={VOICE_STACK_OPTIONS.map((p) => ({ value: p.value, label: p.label }))}
              />
            </FormItem>
          )} />
          {isGeminiLive ? (
            <div className="space-y-3">
              <FormField control={form.control} name="geminiLiveVoiceName" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-muted-foreground">Preset voice</FormLabel>
                  <FormControl>
                    <GeminiLiveVoicePicker value={field.value ?? "Kore"} onChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="geminiLiveThinkingLevel" render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-xs text-muted-foreground">Thinking level</FormLabel>
                  <SmallSelect value={field.value ?? "minimal"} onChange={field.onChange}
                    options={GEMINI_LIVE_THINKING_LEVELS.map(p => ({ value: p.value, label: p.label }))} />
                </FormItem>
              )} />
            </div>
          ) : (
          <>
          <div className="grid grid-cols-2 gap-3">
            <FormField control={form.control} name="ttsProvider" render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs text-muted-foreground">Provider</FormLabel>
                <Select value={field.value} onValueChange={(v) => { field.onChange(v); setVoiceCustomModeV(false); form.setValue("ttsVoice", ""); form.setValue("ttsModel", ""); }}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {TTS_PROVIDERS.map(p => (
                      <SelectItem key={p.value} value={p.value} className="text-sm">{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )} />

            {ttsVoiceOptsV.length > 0 && (
              <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                <FormItem className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel className="text-xs text-muted-foreground">Choose voice</FormLabel>
                    {ttsProvider === "cartesia" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] gap-1 px-2"
                        onClick={() => setCloneOpenV(true)}
                      >
                        <CopyPlus className="h-3 w-3" />
                        Clone voice
                      </Button>
                    )}
                    {ttsProvider === "sarvam" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] gap-1 px-2"
                        onClick={() => setSarvamCloneOpenV(true)}
                      >
                        <CopyPlus className="h-3 w-3" />
                        Add Sarvam clone
                      </Button>
                    )}
                  </div>
                  {ttsProvider === "sarvam" && (
                    <p className="text-[10px] text-muted-foreground leading-relaxed -mt-0.5 mb-1">
                      Default stack
                    </p>
                  )}
                  <Select
                    value={
                      dropdownValV && ttsVoiceOptsV.some((v) => v.value === dropdownValV)
                        ? dropdownValV
                        : undefined
                    }
                    onValueChange={(v) => {
                      if (v === "__custom__") {
                        setVoiceCustomModeV(true);
                        return;
                      }
                      setVoiceCustomModeV(false);
                      field.onChange(v);
                    }}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select a voice…" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="max-h-[300px]">
                      {ttsVoiceOptsV.filter((v) => v.value !== "").map(v => (
                        <SelectItem key={v.value} value={v.value} className="text-sm">
                          <VoiceOptionLabel label={v.label} recommended={v.recommended} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {previewVoiceControl}
                </FormItem>
              )} />
            )}

            {ttsProvider === "cartesia" && hasRecommendedVoicesForLanguageV && (
              <p className="text-xs text-muted-foreground leading-relaxed rounded-md border border-border bg-muted/40 px-3 py-2.5 col-span-2">
                Voices recommended for this language are listed first. You can still pick any other voice.
              </p>
            )}
            {ttsProvider === "cartesia" && showingAllVoicesForLanguageV && (
              <p className="text-xs text-muted-foreground leading-relaxed rounded-md border border-border bg-muted/40 px-3 py-2.5 col-span-2">
                No voices are tagged for this language — showing every available voice. Most multilingual voices speak it well; preview a few to pick one.
              </p>
            )}

            {ttsProvider === "cartesia" && ttsVoiceOptsV.length === 0 && (
              <div className="col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => setCloneOpenV(true)}
                >
                  <CopyPlus className="h-3.5 w-3.5" />
                  Clone my voice
                </Button>
              </div>
            )}

            {ttsModelOptsV.length > 0 && (
              <FormField control={form.control} name="ttsModel" render={({ field }) => {
                const modelVal = field.value ?? "";
                const modelSafe = modelVal && ttsModelOptsV.some((m: any) => m.value === modelVal) ? modelVal : undefined;
                return (
                <FormItem className="space-y-1">
                  <FormLabel className="text-xs text-muted-foreground">Model</FormLabel>
                  <Select value={modelSafe} onValueChange={field.onChange}>
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
                );
              }} />
            )}
          </div>

          <CloneVoiceDialog
            open={cloneOpenV}
            onOpenChange={setCloneOpenV}
            defaultLanguage={agentLanguage}
            onCloned={applyClonedVoiceV}
          />
          <RegisterSarvamVoiceDialog
            open={sarvamCloneOpenV}
            onOpenChange={setSarvamCloneOpenV}
            defaultLanguage={agentLanguage}
            onRegistered={applySarvamClonedVoiceV}
          />

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

          {!isGeminiLive && (ttsProvider === "sarvam" || ttsProvider === "cartesia" || ttsProvider === "elevenlabs") && (
            <div className="border-t border-border/50 pt-3 mt-1">
              <FormField control={form.control} name="ttsSpeed" render={({ field }) => {
                const val = typeof field.value === "number" && Number.isFinite(field.value) ? field.value : 1;
                const pct = ((val - 0.7) / (1.5 - 0.7)) * 100;
                return (
                  <FormItem className="space-y-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <FormLabel className="text-sm font-medium text-foreground">Speaking speed</FormLabel>
                        <FormDescription className="text-[10px] mt-0.5">
                          {ttsProvider === "sarvam"
                            ? "How fast the agent talks (Sarvam Bulbul pace). 1.0× is normal."
                            : "How fast the agent talks. 1.0× is normal."}
                        </FormDescription>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 w-[min(100%,220px)]">
                        <div className="relative h-5 flex-1 flex items-center">
                          <div className="absolute inset-x-0 h-1.5 rounded-full bg-border/60" />
                          <div className="absolute left-0 h-1.5 rounded-full bg-primary/70 pointer-events-none" style={{ width: `${pct}%` }} />
                          <input
                            type="range"
                            min={0.7}
                            max={1.5}
                            step={0.05}
                            value={val}
                            onChange={(e) => field.onChange(parseFloat(e.target.value))}
                            className="absolute inset-x-0 w-full opacity-0 h-5 cursor-pointer"
                          />
                        </div>
                        <Input
                          type="number"
                          min={0.7}
                          max={1.5}
                          step={0.05}
                          value={val}
                          onChange={(e) => {
                            const n = parseFloat(e.target.value);
                            if (Number.isFinite(n)) field.onChange(Math.min(1.5, Math.max(0.7, n)));
                          }}
                          className="h-8 w-[4.25rem] text-xs tabular-nums text-center"
                        />
                        <span className="text-[10px] text-muted-foreground shrink-0">×</span>
                      </div>
                    </div>
                  </FormItem>
                );
              }} />
            </div>
          )}
          </>
          )}
        </div>
      </BuilderPanel>

      <BuilderPanel
        title="Listening"
        icon={<Mic />}
        description="Noise cancel, backchannels, and ambient bed"
      >
        <div className="space-y-3">
          <FormField control={form.control} name="noiseCancellationEnabled" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2.5">
              <div>
                <FormLabel className="text-sm">Noise Cancellation</FormLabel>
                <FormDescription className="text-[10px]">Removes fans/traffic/hiss. Does not ignore other people nearby — keep the phone close. Greeting echo is ignored so the agent does not cut herself. Browser web calls use the mic’s own suppression.</FormDescription>
              </div>
              <FormControl><Switch checked={field.value ?? true} onCheckedChange={field.onChange} /></FormControl>
            </FormItem>
          )} />
          <FormField control={form.control} name="backchannelingEnabled" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2.5">
              <div>
                <FormLabel className="text-sm">Backchanneling</FormLabel>
                <FormDescription className="text-[10px]">Agent says &quot;mm-hmm&quot;, &quot;I see&quot; while listening</FormDescription>
              </div>
              <FormControl><Switch checked={field.value ?? false} onCheckedChange={field.onChange} /></FormControl>
            </FormItem>
          )} />
          <FormField control={form.control} name="ambientNoiseEnabled" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2.5">
              <div>
                <FormLabel className="text-sm">Background Noise</FormLabel>
                <FormDescription className="text-[10px]">Ambient bed under the agent — not the agent voice level</FormDescription>
              </div>
              <FormControl><Switch checked={field.value ?? false} onCheckedChange={field.onChange} /></FormControl>
            </FormItem>
          )} />
          {ambientNoiseEnabled && (
            <div className="rounded-lg border border-dashed border-border/50 bg-muted/10 px-3 py-3 space-y-3">
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
              <FormField control={form.control} name="ambientNoiseVolume" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-xs">Background bed volume</FormLabel>
                    <span className="text-xs text-muted-foreground tabular-nums">{Math.round((field.value ?? 1.0) * 100)}%</span>
                  </div>
                  <FormControl>
                    <input
                      type="range"
                      min={0} max={1} step={0.05}
                      value={field.value ?? 1.0}
                      onChange={e => field.onChange(parseFloat(e.target.value))}
                      className="w-full h-1.5 rounded-full accent-primary cursor-pointer"
                    />
                  </FormControl>
                  <FormDescription className="text-[10px]">
                    Background bed only — does not change the agent&apos;s speaking volume. Lower if the bed is loud relative to the voice.
                  </FormDescription>
                </FormItem>
              )} />
            </div>
          )}
        </div>
      </BuilderPanel>

      {/* ── CALL FEEL (same fields as Advanced → Engine presets) ── */}
      <VoiceCallFeelPresets form={form} />
    </div>
  );
}

/**
 * Call Engine preset state shared by the Voice tab and Settings → Engine.
 *
 * A preset (Fast / Balanced / Patient) is a STARTING POINT, not a lock: the
 * chosen preset stays selected while the user fine-tunes the individual knobs,
 * and the edited values save exactly as set. There is no "Custom" mode — a
 * `tweaked` flag just signals the values now differ from the named preset.
 */
function useCallEnginePreset(form: any): {
  preset: CallEnginePreset;
  tweaked: boolean;
  applyPreset: (key: CallEnginePreset) => void;
} {
  const asrProviderVal = form.watch("asrProvider") as string | undefined;
  const asrModelVal = form.watch("asrModel") as string | undefined;
  const realtime = asrProviderVal === "sarvam" && isSarvamRealtimeAsr(asrModelVal);
  const endpointMs = form.watch("asrEndpointingSilenceMs") ?? 250;
  const linearMs = form.watch("linearDelayMs") ?? 0;
  const interruptWords = form.watch("stopSpeakingNumWords") ?? 3;
  const vad = form.watch("sarvamHighVadSensitivity") ?? false;
  const silenceMs = form.watch("sarvamEndOfSpeechSilenceMs") ?? 300;
  const minSpeechMs = form.watch("sarvamFirstTurnMinSpeechMs") ?? 250;
  const threshold = form.watch("sarvamVadThreshold") ?? 0.3;
  const stopMs = form.watch("semanticTurnStopMs") ?? 1200;

  const matches = (key: CallEnginePreset): boolean => {
    const p = CALL_ENGINE_PRESETS[key];
    if (
      endpointMs !== p.asrEndpointingSilenceMs
      || linearMs !== p.linearDelayMs
      || interruptWords !== p.stopSpeakingNumWords
      || stopMs !== p.semanticTurnStopMs
    ) return false;
    if (realtime) {
      return (
        silenceMs === p.sarvamEndOfSpeechSilenceMs
        && minSpeechMs === p.sarvamFirstTurnMinSpeechMs
        && Math.abs(threshold - p.sarvamVadThreshold) < 0.001
      );
    }
    return asrProviderVal !== "sarvam" || vad === p.sarvamHighVadSensitivity;
  };
  const derived = (Object.keys(CALL_ENGINE_PRESETS) as CallEnginePreset[]).find(matches) ?? null;

  // The selected chip. Seeded from the saved values; falls back to Balanced for
  // legacy agents whose values match no preset (never shown as "Custom").
  const [pinned, setPinned] = useState<CallEnginePreset>(derived ?? "balanced");
  // Follow the values when they land exactly on a (possibly different) preset —
  // e.g. the user drags the knobs until they match Fast.
  useEffect(() => {
    if (derived && derived !== pinned) setPinned(derived);
  }, [derived]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyPreset = (key: CallEnginePreset) => {
    const p = CALL_ENGINE_PRESETS[key];
    form.setValue("asrEndpointingSilenceMs", p.asrEndpointingSilenceMs, { shouldDirty: true });
    form.setValue("linearDelayMs", p.linearDelayMs, { shouldDirty: true });
    form.setValue("stopSpeakingNumWords", p.stopSpeakingNumWords, { shouldDirty: true });
    form.setValue("stopSpeakingVoiceSecs", voiceSecondsFromInterruptWords(p.stopSpeakingNumWords), { shouldDirty: true });
    // Sarvam pause-detection is part of the preset — Fast without it leaves a ~2s turn tax.
    form.setValue("sarvamHighVadSensitivity", p.sarvamHighVadSensitivity, { shouldDirty: true });
    form.setValue("sarvamEndOfSpeechSilenceMs", p.sarvamEndOfSpeechSilenceMs, { shouldDirty: true });
    form.setValue("sarvamFirstTurnMinSpeechMs", p.sarvamFirstTurnMinSpeechMs, { shouldDirty: true });
    form.setValue("sarvamVadThreshold", p.sarvamVadThreshold, { shouldDirty: true });
    form.setValue("semanticTurnStopMs", p.semanticTurnStopMs, { shouldDirty: true });
    setPinned(key);
  };

  return { preset: pinned, tweaked: !matches(pinned), applyPreset };
}

/** Voice-tab Call Engine presets — writes the same form keys as Advanced → Engine. */
function VoiceCallFeelPresets({ form }: { form: any }) {
  const asrProviderVal = form.watch("asrProvider") as string | undefined;
  const asrModelVal = form.watch("asrModel") as string | undefined;
  const realtime = asrProviderVal === "sarvam" && isSarvamRealtimeAsr(asrModelVal);
  const { preset: activePreset, tweaked, applyPreset } = useCallEnginePreset(form);

  return (
    <BuilderPanel
      title="Phone feel"
      icon={<Timer />}
      description="How soon the agent replies after a pause"
      hint={tweaked ? (
        <span className="text-[10px] text-muted-foreground">edited — saves as set</span>
      ) : undefined}
      bodyClassName="gap-3"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {([
          { id: "fast" as const, label: "Fast", hint: "Default — replies as soon as you pause" },
          { id: "balanced" as const, label: "Balanced", hint: "Slightly more pause before the agent talks" },
          { id: "patient" as const, label: "Patient", hint: "Waits if the caller thinks mid-sentence" },
        ]).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p.id)}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left transition-all",
              activePreset === p.id
                ? "border-primary/40 bg-primary/10 ring-1 ring-primary/20"
                : "border-border bg-background hover:border-foreground/20 hover:bg-muted/30",
            )}
          >
            <span className={cn(
              "block text-[12.5px] font-semibold",
              activePreset === p.id ? "text-primary" : "text-foreground",
            )}>
              {p.label}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{p.hint}</span>
          </button>
        ))}
      </div>
      {asrProviderVal === "sarvam" && !realtime && (
        <p className="text-[11px] text-muted-foreground">
          This agent is on a legacy transcriber. Switch it to Saaras v3 in Transcriber.
        </p>
      )}
    </BuilderPanel>
  );
}


/* ── Tab: Tools ─────────────────────────────────────────────────────────────── */

function ToolsTab({ form, agentId }: { form: any; agentId: number | undefined }) {
  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: "tools" });
  const genderEnabled = form.watch("genderDetectionEnabled") ?? false;
  const voiceMemoryEnabled = form.watch("voiceMemoryEnabled") ?? false;
  const recordingEnabled = form.watch("recordingEnabled") ?? true;
  const summarizationEnabled = form.watch("summarizationEnabled") ?? false;
  const watchedTools  = (form.watch("tools") ?? []) as any[];
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [meetTogglePending, setMeetTogglePending] = useState(false);
  /** Local preference when no meeting/event type exists yet on the calendar. */
  const [meetEnabledFallback, setMeetEnabledFallback] = useState(true);

  const { data: calendarsData } = useListCalendars();
  const schedulingCalendarId = form.watch("schedulingCalendarId");
  const schedulingEventTypeId = form.watch("schedulingEventTypeId");
  const agentCalendar = schedulingCalendarId != null
    ? findBySchedulingId(calendarsData ?? [], schedulingCalendarId)
    : agentId
      ? ((calendarsData ?? []).find((cal: any) => cal.agentId === agentId) ?? (calendarsData ?? [])[0])
      : (calendarsData ?? [])[0];
  const calendarIdForEt = agentCalendar?.id;
  const { data: agentEventTypes, isLoading: eventTypesLoading } = useListEventTypes(
    calendarIdForEt ? { calendarId: calendarIdForEt } : undefined,
    { query: { enabled: !!calendarIdForEt, queryKey: ["agent-event-types", calendarIdForEt ?? null] } }
  );

  const preferredEventType = useMemo(() => {
    const ets = (agentEventTypes ?? []) as Array<{ id: number; enableGoogleMeet?: boolean }>;
    if (ets.length === 0) return null;
    if (schedulingEventTypeId != null) {
      return ets.find((e) => normalizeSchedulingId(e.id) === normalizeSchedulingId(schedulingEventTypeId)) ?? ets[0] ?? null;
    }
    return ets[0] ?? null;
  }, [agentEventTypes, schedulingEventTypeId]);

  const googleMeetEnabled = preferredEventType
    ? preferredEventType.enableGoogleMeet !== false
    : meetEnabledFallback;

  const setGoogleMeetEnabled = async (on: boolean) => {
    setMeetEnabledFallback(on);
    const ets = (agentEventTypes ?? []) as Array<{ id: number }>;
    if (ets.length === 0) {
      toast({
        title: on ? "Google Meet on" : "Google Meet off",
        description: on
          ? "Meet links will be added once a meeting exists on this calendar."
          : "Bookings won’t include Meet links until you turn this back on.",
      });
      return;
    }
    setMeetTogglePending(true);
    try {
      await Promise.all(
        ets.map((et) =>
          customFetch(`${DASH_API}/scheduling/event-types/${et.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enableGoogleMeet: on }),
          }),
        ),
      );
      await queryClient.invalidateQueries({ queryKey: ["agent-event-types", calendarIdForEt ?? null] });
      toast({
        title: on ? "Google Meet enabled" : "Google Meet disabled",
        description: on
          ? "New bookings will include a Meet link on the Google invite."
          : "New bookings stay on the calendar without a Meet link.",
      });
    } catch (err: any) {
      setMeetEnabledFallback(!on);
      toast({
        title: "Couldn’t update Meet setting",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    } finally {
      setMeetTogglePending(false);
    }
  };

  // ── Issue 1: Auto-link calendar when none is set ──────────────────────────
  // When the agent has no calendar linked yet, find a calendar whose name
  // case-insensitively contains the agent name (or vice versa). If exactly one
  // match is found it is auto-linked and the form is marked dirty so the user
  // sees the amber save dot and can persist it.
  const agentNameForAutoLink = (form.watch("name") as string | undefined) ?? "";
  useEffect(() => {
    if (!agentId || !agentNameForAutoLink.trim() || !calendarsData?.length) return;
    if (schedulingCalendarId != null) return; // already linked
    const normalized = agentNameForAutoLink.trim().toLowerCase();
    const matches = (calendarsData as any[]).filter((cal: any) => {
      const calName = (cal.name ?? "").toLowerCase();
      return calName.includes(normalized) || normalized.includes(calName);
    });
    if (matches.length === 1) {
      form.setValue("schedulingCalendarId", matches[0].id, { shouldDirty: true });
    }
  }, [agentId, agentNameForAutoLink, calendarsData, schedulingCalendarId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const BOOKING_TYPES = [
    "native_booking",
    "native_check_availability",
    "native_list_bookings",
    "native_reschedule",
    "native_cancel",
  ] as const;

  const hasNativeTool = (type: string) => watchedTools.some((t: any) => t.type === type);
  const nativeToolIndex = (type: string) => watchedTools.findIndex((t: any) => t.type === type);

  const NATIVE_DEFAULT_NAMES: Record<string, string> = {
    native_booking: "book_appointment",
    native_check_availability: "check_availability",
    native_list_bookings: "list_bookings",
    native_reschedule: "reschedule_booking",
    native_cancel: "cancel_booking",
    end_call: "end_call",
    send_email: "send_email",
    send_whatsapp: "send_whatsapp",
  };

  const bookingEnabled = BOOKING_TYPES.every((type) => hasNativeTool(type));
  const bookingPartial = !bookingEnabled && BOOKING_TYPES.some((type) => hasNativeTool(type));
  const bookingToolsOn = bookingEnabled || bookingPartial;

  // A calendar alone is not runnable: native scheduling requires an active
  // event type. Auto-select the first event type when possible, but never leave
  // the form looking ready when the selected calendar has none (call 13380).
  useEffect(() => {
    if (!bookingToolsOn || eventTypesLoading || !calendarIdForEt) return;
    const eventTypes = (agentEventTypes ?? []) as Array<{ id: number }>;
    const selectedIsValid = eventTypes.some(
      (eventType) => normalizeSchedulingId(eventType.id) === normalizeSchedulingId(schedulingEventTypeId),
    );
    if (selectedIsValid) return;
    // Empty list is loading/error — do not wipe a saved meeting type.
    if (eventTypes.length === 0) return;
    form.setValue("schedulingEventTypeId", eventTypes[0].id, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [
    agentEventTypes,
    bookingToolsOn,
    calendarIdForEt,
    eventTypesLoading,
    form,
    schedulingEventTypeId,
  ]);

  const toggleBookingSuite = (on: boolean) => {
    const current = (form.getValues("tools") ?? []) as any[];
    if (on) {
      const existing = new Set(current.map((t: any) => t.type));
      const next = [
        ...current,
        ...BOOKING_TYPES
          .filter((type) => !existing.has(type))
          .map((type) => ({
            type: type as any,
            name: NATIVE_DEFAULT_NAMES[type] ?? "",
            description: "",
          })),
      ];
      replace(next);
    } else {
      replace(current.filter((t: any) => !(BOOKING_TYPES as readonly string[]).includes(t.type)));
    }
  };

  const toggleNativeTool = (type: string) => {
    const idx = nativeToolIndex(type);
    if (idx >= 0) {
      remove(idx);
    } else {
      append({ type: type as any, name: NATIVE_DEFAULT_NAMES[type] ?? "", description: "" });
    }
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
    {
      type: "send_email",
      icon: <Mail className="h-4 w-4" />,
      color: "sky",
      label: "Send Email",
      description: "Lets the agent email mid-call using the workspace Brevo connection.",
      needsEventType: false,
    },
    {
      type: "send_whatsapp",
      icon: <MessageCircle className="h-4 w-4" />,
      color: "emerald",
      label: "Send WhatsApp",
      description: "Usually leave off. The agent would send before we know Interested vs Not Interested. Outcome templates go out after the call.",
      needsEventType: false,
    },
  ] as const;

  const canAttendMeetings = form.watch("agentSurfaces") === "phone_and_meet";

  const transferIdx = nativeToolIndex("call_transfer");
  const transferOn = transferIdx >= 0;

  const toggleCallTransfer = (on: boolean) => {
    const idx = nativeToolIndex("call_transfer");
    if (on) {
      if (idx < 0) {
        append({
          type: "call_transfer" as any,
          name: "transfer_to_human",
          description: "Transfer the call to a human agent when the caller requests it or the issue cannot be resolved automatically.",
          transferTo: "",
          warmHandoffMessage: "",
          transferMode: "cold",
        });
      }
    } else if (idx >= 0) {
      remove(idx);
    }
  };

  const colorMap: Record<string, { border: string; bg: string; iconBg: string; iconText: string; label: string; badge: string; badgeText: string; active: string }> = {
    emerald: { border: "border-emerald-500/40", bg: "bg-emerald-500/10", iconBg: "bg-emerald-500/15", iconText: "text-emerald-600 dark:text-emerald-400", label: "text-emerald-700 dark:text-emerald-300", badge: "bg-emerald-500/20", badgeText: "text-emerald-700 dark:text-emerald-300", active: "" },
    sky:     { border: "border-sky-500/40",     bg: "bg-sky-500/10",     iconBg: "bg-sky-500/15",     iconText: "text-sky-600 dark:text-sky-400",     label: "text-sky-700 dark:text-sky-300",     badge: "bg-sky-500/20",     badgeText: "text-sky-700 dark:text-sky-300",     active: "" },
    violet:  { border: "border-violet-500/40",  bg: "bg-violet-500/10",  iconBg: "bg-violet-500/15",  iconText: "text-violet-600 dark:text-violet-400",  label: "text-violet-700 dark:text-violet-300",  badge: "bg-violet-500/20",  badgeText: "text-violet-700 dark:text-violet-300",  active: "" },
    amber:   { border: "border-amber-500/40",   bg: "bg-amber-500/10",   iconBg: "bg-amber-500/15",   iconText: "text-amber-600 dark:text-amber-400",   label: "text-amber-700 dark:text-amber-300",   badge: "bg-amber-500/20",   badgeText: "text-amber-700 dark:text-amber-300",   active: "" },
    red:     { border: "border-red-500/40",     bg: "bg-red-500/10",     iconBg: "bg-red-500/15",     iconText: "text-red-600 dark:text-red-400",     label: "text-red-700 dark:text-red-300",     badge: "bg-red-500/20",     badgeText: "text-red-700 dark:text-red-300",     active: "" },
    slate:   { border: "border-slate-500/40",   bg: "bg-slate-500/10",   iconBg: "bg-slate-500/15",   iconText: "text-slate-600 dark:text-slate-400",   label: "text-slate-700 dark:text-slate-300",   badge: "bg-slate-500/20",   badgeText: "text-slate-700 dark:text-slate-300",   active: "" },
  };

  return (
    <div className={cn("relative flex min-h-full flex-col gap-6", BUILDER_TAB_PAD)}>

      {/* ── Platform Tools ─── */}
      <div>
        <BuilderTabHeader
          title="Actions"
          description="Turn on an action, then pick the calendar, WhatsApp template, or email already connected. Plug-in itself is under Connections."
        />

        <div className="mt-5 space-y-4">

        {/* ── Booking suite (one switch → all five tools) ── */}
        <BuilderPanel
          title="Bookings"
          icon={<Calendar />}
          bodyClassName="p-0"
        >
        <div>
          <div className="flex items-start gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-foreground">Book meetings on the call</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                Agent can check times and book. Caller gets a Google Meet link.
              </p>
            </div>
            <Switch
              checked={bookingEnabled || bookingPartial}
              onCheckedChange={(on) => toggleBookingSuite(on)}
            />
          </div>

          {(bookingEnabled || bookingPartial) && (() => {
            const calendars = calendarsData ?? [];
            const googleEmail = (agentCalendar as { connectedGoogleEmail?: string | null } | undefined)?.connectedGoogleEmail;
            const setupHref = agentId ? connectionsSetupHref("calendar", agentId) : "/app/connections?setup=calendar";
            return (
            <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-foreground">Calendar</p>
                <Select
                  value={
                    agentCalendar
                      ? String(agentCalendar.id)
                      : normalizeSchedulingId(schedulingCalendarId) != null
                        ? String(normalizeSchedulingId(schedulingCalendarId))
                        : "__none__"
                  }
                  onValueChange={(v) => {
                    form.setValue(
                      "schedulingCalendarId",
                      v === "__none__" || !Number.isFinite(Number(v)) ? null : Number(v),
                      { shouldDirty: true },
                    );
                    form.setValue("schedulingEventTypeId", null, { shouldDirty: true });
                  }}
                >
                  <SelectTrigger className="h-9 bg-background text-xs">
                    <SelectValue placeholder="Pick a calendar">
                      {agentCalendar
                        ? agentCalendar.name
                        : calendars.length === 0
                          ? "No calendars yet"
                          : normalizeSchedulingId(schedulingCalendarId) != null
                            ? "Saved calendar — pick it again"
                            : "Pick a calendar"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-xs text-muted-foreground">Pick a calendar</SelectItem>
                    {normalizeSchedulingId(schedulingCalendarId) != null && !agentCalendar && (
                      <SelectItem value={String(normalizeSchedulingId(schedulingCalendarId))} className="text-xs">
                        Saved calendar #{normalizeSchedulingId(schedulingCalendarId)}
                      </SelectItem>
                    )}
                    {calendars.map((cal: { id: number; name: string }) => (
                      <SelectItem key={cal.id} value={String(cal.id)} className="text-xs">{cal.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {calendars.length === 0 && (
                  <Link href={setupHref} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-foreground underline underline-offset-2">
                    Create a calendar
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>

              <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-foreground">Google Meet conferencing</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {googleMeetEnabled
                      ? "Add a Meet link on each booking invite. Pick the meeting type below."
                      : "Off — turn this on to add a Meet link and choose the meeting type."}
                  </p>
                </div>
                <Switch
                  className="mt-0.5 shrink-0"
                  checked={googleMeetEnabled}
                  disabled={meetTogglePending}
                  onCheckedChange={(on) => { void setGoogleMeetEnabled(on); }}
                />
              </div>

              {googleMeetEnabled && (
                <>
                  {googleEmail ? (
                    <p className="text-[11.5px] text-muted-foreground">
                      Meet links via <span className="font-medium text-foreground">{googleEmail}</span>
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[11.5px] text-muted-foreground">Connect Google so each booking gets a Meet link.</p>
                      <Button asChild type="button" size="sm" className="h-8 text-[11px]">
                        <Link href={setupHref}>Connect Google</Link>
                      </Button>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-foreground">Meeting type</p>
                    <Select
                      value={normalizeSchedulingId(schedulingEventTypeId) != null ? String(normalizeSchedulingId(schedulingEventTypeId)) : "__none__"}
                      onValueChange={(value) => {
                        form.setValue(
                          "schedulingEventTypeId",
                          value === "__none__" ? null : Number(value),
                          { shouldDirty: true, shouldValidate: true },
                        );
                      }}
                      disabled={!calendarIdForEt || eventTypesLoading || (agentEventTypes ?? []).length === 0}
                    >
                      <SelectTrigger className="h-9 bg-background text-xs">
                        <SelectValue placeholder={eventTypesLoading ? "Loading meeting types…" : "Pick a meeting type"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" disabled className="text-xs text-muted-foreground">
                          Pick a meeting type
                        </SelectItem>
                        {normalizeSchedulingId(schedulingEventTypeId) != null
                          && !(agentEventTypes ?? []).some(
                            (eventType: { id: number }) =>
                              normalizeSchedulingId(eventType.id) === normalizeSchedulingId(schedulingEventTypeId),
                          ) && (
                          <SelectItem value={String(normalizeSchedulingId(schedulingEventTypeId))} className="text-xs">
                            Saved meeting type #{normalizeSchedulingId(schedulingEventTypeId)}
                          </SelectItem>
                        )}
                        {(agentEventTypes ?? []).map((eventType: any) => (
                          <SelectItem key={eventType.id} value={String(eventType.id)} className="text-xs">
                            {eventType.title || eventType.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {/* Kept outside the Meet gate: a calendar with no meeting type cannot
                  book at all, so hiding the warning would repeat call 13380. */}
              {!eventTypesLoading && calendarIdForEt && (agentEventTypes ?? []).length === 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
                  <p className="text-[11.5px] font-medium text-amber-700 dark:text-amber-300">
                    Booking is not ready — this calendar has no meeting type.
                  </p>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
                    Create one before saving. Without it, the agent cannot check availability, book a meeting, or send a Meet link.
                  </p>
                  <Button asChild type="button" size="sm" variant="outline" className="mt-2 h-8 text-[11px]">
                    <Link href={setupHref}>Create meeting type</Link>
                  </Button>
                </div>
              )}
            </div>
            );
          })()}
        </div>
        </BuilderPanel>

        <BuilderPanel title="Meeting bots" icon={<Video />} bodyClassName="p-0">
          <div className="flex items-start gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-foreground">Phone + meetings</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                {canAttendMeetings
                  ? "On — this agent can join Meet / Zoom / Teams."
                  : "Off — phone only. Turn on when the agent should join meetings."}
              </p>
            </div>
            <Switch
              className="mt-0.5 shrink-0"
              checked={canAttendMeetings}
              onCheckedChange={(on) =>
                form.setValue("agentSurfaces", on ? "phone_and_meet" : "phone", { shouldDirty: true })
              }
            />
          </div>
          {canAttendMeetings && agentId ? (
            <div className="border-t border-border px-4 pb-4 pt-3">
              <Button asChild type="button" variant="outline" size="sm" className="h-8 text-[11px]">
                <Link href={`/app/meet?agentId=${agentId}`}>Open Meeting bots</Link>
              </Button>
            </div>
          ) : null}
        </BuilderPanel>

        <BuilderPanel
          title="Messaging"
          icon={<MessageCircle />}
          description="Mid-call is optional. WhatsApp by outcome sends after the call ends."
          bodyClassName="p-0 divide-y divide-border"
        >
        {CALL_CONTROL_TOOLS.filter((t) => t.type === "send_email" || t.type === "send_whatsapp").map(({ type, icon, label, description }) => {
          const isOn = hasNativeTool(type);
          return (
            <div key={type}>
              <div className="flex w-full items-start gap-3 p-4 text-left">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                  <span className={cn(isOn ? "text-foreground" : "text-muted-foreground/50")}>{icon}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-foreground">{label}</span>
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">{description}</p>
                </div>
                <div className="mt-1 shrink-0">
                  <Switch checked={isOn} onCheckedChange={() => toggleNativeTool(type)} />
                </div>
              </div>
              {type === "send_whatsapp" && isOn && agentId ? <ToolsWhatsappSetup agentId={agentId} /> : null}
              {type === "send_email" && isOn ? <ToolsEmailSetup agentId={agentId} /> : null}
            </div>
          );
        })}
        </BuilderPanel>

        <BuilderPanel
          title="Call control"
          icon={<PhoneOff />}
          bodyClassName="p-0 divide-y divide-border"
        >
        {CALL_CONTROL_TOOLS.filter((t) => t.type === "end_call").map(({ type, icon, label, description }) => {
          const isOn = hasNativeTool(type);
          return (
            <div key={type}>
              <div className="flex w-full items-start gap-3 p-4 text-left">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                  <span className={cn(isOn ? "text-foreground" : "text-muted-foreground/50")}>{icon}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-foreground">{label}</span>
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">{description}</p>
                </div>
                <div className="mt-1 shrink-0">
                  <Switch checked={isOn} onCheckedChange={() => toggleNativeTool(type)} />
                </div>
              </div>
            </div>
          );
        })}

        {/* Call Transfer — platform tool (not under Custom Tools) */}
        <div>
          <div className="flex w-full items-start gap-3 p-4 text-left">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
              <PhoneForwarded className={cn("h-4 w-4", transferOn ? "text-foreground" : "text-muted-foreground/50")} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-foreground">Call Transfer</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                Warm or cold transfer to a human number when the caller asks or the agent can’t resolve the issue.
              </p>
            </div>
            <div className="mt-1 shrink-0">
              <Switch checked={transferOn} onCheckedChange={(v) => toggleCallTransfer(v)} />
            </div>
          </div>
          {transferOn && transferIdx >= 0 && (
            <div className="space-y-3 border-t border-border bg-muted/20 px-4 pb-4 pt-3">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name={`tools.${transferIdx}.name`} render={({ field: f }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Function Name</FormLabel>
                    <FormControl><Input placeholder="transfer_to_human" className="h-8 text-xs" {...f} /></FormControl>
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )} />
                <FormField control={form.control} name={`tools.${transferIdx}.transferTo`} render={({ field: f }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Transfer To</FormLabel>
                    <FormControl><Input placeholder="+12125551234" className="h-8 text-xs" {...f} /></FormControl>
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name={`tools.${transferIdx}.description`} render={({ field: f }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground">Description (shown to LLM)</FormLabel>
                  <FormControl><Textarea className="min-h-[60px] text-xs resize-none" placeholder="When should the LLM transfer?" {...f} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name={`tools.${transferIdx}.warmHandoffMessage`} render={({ field: f }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground">Warm Handoff Message</FormLabel>
                  <FormControl><Input placeholder="Connecting you with a specialist now…" className="h-8 text-xs" {...f} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name={`tools.${transferIdx}.transferMode`} render={({ field: f }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground">Transfer Mode</FormLabel>
                  <Select value={f.value ?? "cold"} onValueChange={f.onChange}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cold" className="text-xs">Cold — connect immediately</SelectItem>
                      <SelectItem value="warm_summary" className="text-xs">Warm — brief the agent first (context-aware)</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              {form.watch(`tools.${transferIdx}.transferMode`) === "warm_summary" && (
                <FormField control={form.control} name={`tools.${transferIdx}.summaryPrompt`} render={({ field: f }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Briefing Prompt (optional)</FormLabel>
                    <FormControl><Textarea className="min-h-[60px] text-xs resize-none" placeholder="Default: customer name, core issue, urgency, and key context the agent needs." {...f} /></FormControl>
                  </FormItem>
                )} />
              )}
            </div>
          )}
        </div>
        </BuilderPanel>

        <BuilderPanel
          title="Recording & summaries"
          icon={<AudioLines />}
          bodyClassName="p-0 divide-y divide-border"
        >
        {/* Call Recording card */}
        <div>
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => { if (!e.nativeEvent.isTrusted) return; form.setValue("recordingEnabled", !recordingEnabled, { shouldDirty: true }); }}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); form.setValue("recordingEnabled", !recordingEnabled, { shouldDirty: true }); } }}
            className="flex w-full cursor-pointer items-start gap-3 p-4 text-left"
          >
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
              <Mic className={cn("h-4 w-4", recordingEnabled ? "text-foreground" : "text-muted-foreground/50")} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-foreground">Call Recording</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                Records the full audio of each call and stores it on the call, so you can play it back from the call detail page.
              </p>
            </div>
            <div className="mt-1 shrink-0">
              <Switch
                checked={recordingEnabled}
                onCheckedChange={(v) => form.setValue("recordingEnabled", v, { shouldDirty: true })}
                onClick={e => e.stopPropagation()}
              />
            </div>
          </div>
        </div>

        <div>
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => { if (!e.nativeEvent.isTrusted) return; form.setValue("summarizationEnabled", !summarizationEnabled, { shouldDirty: true }); }}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); form.setValue("summarizationEnabled", !summarizationEnabled, { shouldDirty: true }); } }}
            className="flex w-full cursor-pointer items-start gap-3 p-4 text-left"
          >
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
              <Sparkles className={cn("h-4 w-4", summarizationEnabled ? "text-foreground" : "text-muted-foreground/50")} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-foreground">Auto Summarization</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                After each completed call, write a short AI summary on the History → Summary tab.
              </p>
            </div>
            <div className="mt-1 shrink-0">
              <Switch
                checked={summarizationEnabled}
                onCheckedChange={(v) => form.setValue("summarizationEnabled", v, { shouldDirty: true })}
                onClick={e => e.stopPropagation()}
              />
            </div>
          </div>
        </div>
        </BuilderPanel>

        <BuilderPanel
          title="Caller intelligence"
          icon={<Users />}
          bodyClassName="p-0 divide-y divide-border"
        >
        {/* Gender Identification card */}
        <div>
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => { if (!e.nativeEvent.isTrusted) return; form.setValue("genderDetectionEnabled", !genderEnabled, { shouldDirty: true }); }}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); form.setValue("genderDetectionEnabled", !genderEnabled, { shouldDirty: true }); } }}
            className="flex w-full cursor-pointer items-start gap-3 p-4 text-left"
          >
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
              <User2 className={cn("h-4 w-4", genderEnabled ? "text-foreground" : "text-muted-foreground/50")} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-foreground">Gender Identification</span>
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">Beta</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                Detects caller gender from voice at the start of the call. When enabled, the agent uses gender-appropriate salutations — "Sir", "Ma'am", or a neutral fallback.
              </p>
              {genderEnabled && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed mt-1.5">
                  Beta feature — detection accuracy is roughly 80% and can occasionally misgender a caller. This also requires the voice-analysis service to be configured on your account; if it isn't reachable, calls fall back to a neutral greeting instead of failing.
                </p>
              )}
            </div>
            <div className="shrink-0 mt-1">
              <Switch
                checked={genderEnabled}
                onCheckedChange={(v) => form.setValue("genderDetectionEnabled", v, { shouldDirty: true })}
                onClick={e => e.stopPropagation()}
              />
            </div>
          </div>
        </div>

        {/* Voice Memory card */}
        <div>
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => { if (!e.nativeEvent.isTrusted) return; form.setValue("voiceMemoryEnabled", !voiceMemoryEnabled, { shouldDirty: true }); }}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); form.setValue("voiceMemoryEnabled", !voiceMemoryEnabled, { shouldDirty: true }); } }}
            className="flex w-full cursor-pointer items-start gap-3 p-4 text-left"
          >
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
              <AudioLines className={cn("h-4 w-4", voiceMemoryEnabled ? "text-foreground" : "text-muted-foreground/50")} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-foreground">Voice Memory</span>
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">Beta</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                Remembers the caller&apos;s voiceprint. When a match lands, the agent addresses them immediately (by name if known). Also detects mid-call handoffs and links the same voice across phone numbers. Phone-number memory stays primary.
              </p>
              {voiceMemoryEnabled && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed mt-1.5">
                  Soft signal only — not identity verification. Requires the voice-analysis service. On a match the agent greets them as soon as they pause; on handoff it asks who it&apos;s speaking with and stops using the previous person&apos;s name until confirmed.
                </p>
              )}
            </div>
            <div className="shrink-0 mt-1">
              <Switch
                checked={voiceMemoryEnabled}
                onCheckedChange={(v) => form.setValue("voiceMemoryEnabled", v, { shouldDirty: true })}
                onClick={e => e.stopPropagation()}
              />
            </div>
          </div>
        </div>
        </BuilderPanel>

      </div>
      </div>

      {/* ── Custom Tools (webhooks only — Call Transfer lives under Platform Tools) ─── */}
      <BuilderPanel
        title="Custom tools"
        icon={<Webhook />}
        description="Mid-call HTTP to your own API"
        action={
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2.5 text-[11px]"
            onClick={() => append({ type: "webhook", name: "custom_action", description: "Invoke when caller requests a specific action.", url: "", method: "POST", secret: "", preToolMessage: "One moment…", parameters: [] })}>
            <Plus className="size-3" /> Add
          </Button>
        }
        bodyClassName="p-0"
      >
        {(form.watch("tools") ?? []).filter((t: { type: string }) => t.type === "webhook").length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Wrench className="mx-auto mb-2 h-6 w-6 text-muted-foreground/30" />
            <p className="text-[12.5px] font-medium text-muted-foreground">No mid-call HTTP tools</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground/70">
              These call your API while the agent is talking — not the same as post-call notify.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {fields.flatMap((field, index) => {
              const toolType = form.watch(`tools.${index}.type`);
              if (toolType !== "webhook") return [];
              return (
                <div key={field.id} className="space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      <Webhook className="h-3 w-3" />Mid-call HTTP
                    </span>
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
                    <FormField control={form.control} name={`tools.${index}.preToolMessage`} render={({ field: f }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[10px] text-muted-foreground">Pre-call Message</FormLabel>
                        <FormControl><Input placeholder="One moment…" className="h-8 text-xs" {...f} /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name={`tools.${index}.description`} render={({ field: f }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-[10px] text-muted-foreground">Description (shown to LLM)</FormLabel>
                      <FormControl><Textarea className="min-h-[60px] text-xs resize-none" placeholder="When should the LLM call this tool?" {...f} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
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
                </div>
              );
            })}
          </div>
        )}
      </BuilderPanel>
    </div>
  );
}

/* ── Tab: Voicemail ─────────────────────────────────────────────────────────── */

function VoicemailTab({ form, embedded = false }: { form: any; embedded?: boolean }) {
  const mode   = form.watch("machineDetectionMode");
  const action = form.watch("voicemailAction");
  return (
    <BuilderPanel
      title="Voicemail"
      icon={<MicOff />}
      description="Outbound only — detect answering machines"
      className={embedded ? undefined : "mx-5 my-6 sm:mx-8"}
      bodyClassName="gap-4"
    >
      <FormField control={form.control} name="machineDetectionMode" render={({ field }) => (
        <FormItem>
          <FormLabel className="text-xs">Detection Mode</FormLabel>
          <Select value={field.value ?? "disabled"} onValueChange={field.onChange}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="disabled">Disabled</SelectItem>
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
                </SelectContent>
              </Select>
            </FormItem>
          )} />
          {action === "leave_message" && (
            <>
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
              <FormField control={form.control} name="voicemailLeadInSeconds" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Lead-in Pause (seconds)</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} max={15} step={1} className="h-9 text-sm"
                      value={field.value ?? 2}
                      onChange={e => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
                  </FormControl>
                  <FormDescription className="text-[10px]">Blind lead-in for Twilio/Plivo: wait this long before speaking so the machine's greeting and beep finish first. Vobiz ignores this — it listens for the greeting to end and speaks the full message automatically. Default 2s.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </>
          )}
        </>
      )}
    </BuilderPanel>
  );
}

/* ── Tab: Advanced ──────────────────────────────────────────────────────────── */

type AdvSection = "engine" | "limits" | "website" | "integrations" | "compliance";

function AdvSlider({ form, name, label, hint, min, max, step, fmt, onValueChange, disabled }: {
  form: any; name: string; label: string; hint?: string;
  min: number; max: number; step: number; fmt: (v: number) => string;
  onValueChange?: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <FormField control={form.control} name={name} render={({ field }) => {
      const val = field.value ?? min;
      const pct = ((val - min) / (max - min)) * 100;
      return (
        <FormItem className={disabled ? "space-y-0 opacity-50 pointer-events-none" : "space-y-0"}>
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
                disabled={disabled}
                onChange={e => {
                  const next = step % 1 !== 0 ? parseFloat(e.target.value) : parseInt(e.target.value);
                  field.onChange(next);
                  onValueChange?.(next);
                }}
                className={disabled ? "absolute inset-x-0 w-full opacity-0 h-5 cursor-not-allowed" : "absolute inset-x-0 w-full opacity-0 h-5 cursor-pointer"}
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
  const search = useSearch();
  const requested = new URLSearchParams(search).get("section");
  const [section, setSection] = useState<AdvSection>(
    requested === "website" || requested === "embed" ? "website" : "engine",
  );
  const [traiConfirmOpen, setTraiConfirmOpen] = useState(false);
  const [dpdpConfirmOpen, setDpdpConfirmOpen] = useState(false);
  const [irdaiConfirmOpen, setIrdaiConfirmOpen] = useState(false);

  // Surface webhook validation errors on the Integrations sub-tab
  useEffect(() => {
    if (form.formState.errors?.webhookUrl || form.formState.errors?.webhookSecret || form.formState.errors?.webhookPayloadTemplate) {
      setSection("integrations");
    }
  }, [form.formState.errors?.webhookUrl, form.formState.errors?.webhookSecret, form.formState.errors?.webhookPayloadTemplate]);

  const bargeIn = form.watch("bargeInEnabled");
  const notifyAgentName = String(form.watch("name") ?? agent?.name ?? "").trim() || "this agent";

  const nav: { id: AdvSection; icon: React.ReactNode; label: string }[] = [
    { id: "engine",       icon: <Timer className="h-3.5 w-3.5" />,       label: "Engine"     },
    { id: "limits",       icon: <Gauge className="h-3.5 w-3.5" />,       label: "Limits"     },
    { id: "website",      icon: <Globe className="h-3.5 w-3.5" />,       label: "Website"    },
    // Post-call notify for this agent — not Developers event subscriptions or campaign form intake.
    { id: "integrations", icon: <Webhook className="h-3.5 w-3.5" />,     label: "Post-call notify" },
    { id: "compliance",   icon: <ShieldCheck className="h-3.5 w-3.5" />, label: "Compliance" },
  ];

  return (
    <div className={cn("flex flex-col gap-5", BUILDER_TAB_PAD)}>
      <BuilderTabHeader
        title="Settings"
        description="Call limits, barge-in, hang-up, website embed, post-call notify URL, and compliance. How fast the agent replies is on Sound."
      />
      <div className="inline-flex flex-wrap items-center gap-1 self-start rounded-lg border border-border bg-card p-1">
        {nav.map(n => (
          <button
            key={n.id}
            type="button"
            onClick={() => setSection(n.id)}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[11.5px] font-medium transition-all",
              section === n.id
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {n.icon}
            {n.label}
          </button>
        ))}
      </div>

      <div className="space-y-4">

        {/* ── ENGINE ── */}
        {section === "engine" && (
          <BuilderPanel
            title="Call Engine"
            icon={<Timer />}
            description="Barge-in, extra pause, and silence hang-up"
          >
            <div className="space-y-5">
              <FormField control={form.control} name="bargeInEnabled" render={({ field }) => (
                <FormItem className="flex items-center justify-between space-y-0 pb-1">
                  <div>
                    <FormLabel className="text-[12px] font-medium text-foreground/90">Allow barge-in</FormLabel>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">Caller can interrupt the agent while it speaks</p>
                  </div>
                  <FormControl><Switch checked={field.value ?? true} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />

              {bargeIn && (
                <AdvSlider
                  form={form}
                  name="stopSpeakingNumWords"
                  label="Words before interrupt"
                  hint="Agent ignores interruptions until this many words are spoken (Stop / Wait / Hold on still cut immediately). Default 3."
                  min={1}
                  max={6}
                  step={1}
                  fmt={(v) => `${v}w`}
                  onValueChange={(v) => {
                    form.setValue("stopSpeakingVoiceSecs", voiceSecondsFromInterruptWords(v), { shouldDirty: true });
                  }}
                />
              )}

              <AdvSlider
                form={form}
                name="linearDelayMs"
                label="Extra pause before speaking"
                hint="Add a beat after the caller finishes. Off by default."
                min={0}
                max={1500}
                step={50}
                fmt={(v) => (v === 0 ? "off" : `${v}ms`)}
              />

              <details className="group pt-1">
                <summary className="cursor-pointer list-none text-[11.5px] font-medium text-muted-foreground hover:text-foreground transition-colors select-none">
                  <span className="inline-block transition-transform group-open:rotate-90 mr-1">›</span>
                  Advanced timing — rarely needed
                </summary>
                <div className="space-y-5 pt-4">
                  <AdvSlider
                    form={form}
                    name="fragmentCoalesceListeningMs"
                    label="Fragment hold (listening)"
                    hint="Hold short STT fragments while agent is silent. 0 = off (default — trust STT VAD)."
                    min={0}
                    max={2000}
                    step={50}
                    fmt={(v) => (v === 0 ? "off" : `${v}ms`)}
                  />

                  <AdvSlider
                    form={form}
                    name="fragmentCoalescePlayingMs"
                    label="Fragment hold (playing)"
                    hint="Hold short acks while agent is speaking. 0 = off (default — trust STT VAD)."
                    min={0}
                    max={3000}
                    step={50}
                    fmt={(v) => (v === 0 ? "off" : `${v}ms`)}
                  />

                  <AdvSlider
                    form={form}
                    name="telephonyTailDrainMs"
                    label="Tail drain"
                    hint="Silence after last TTS so carriers don't clip goodbye. Default 400ms."
                    min={0}
                    max={2000}
                    step={50}
                    fmt={(v) => (v === 0 ? "off" : `${v}ms`)}
                  />
                </div>
              </details>

              <FormField control={form.control} name="silenceTimeoutSeconds" render={({ field }) => {
                const val = field.value ?? 30;
                const pct = ((val - 5) / (120 - 5)) * 100;
                return (
                  <FormItem className="space-y-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <FormLabel className="text-[12px] font-medium text-foreground/90">Silence check-in</FormLabel>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                          After each turn: if they stay quiet this long, ask “are you there?” Stay silent another window and the call ends. How fast the agent replies is Fast / Balanced / Patient on Sound.
                        </p>
                      </div>
                      <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">{val}s</span>
                    </div>
                    <FormControl>
                      <div className="relative h-5 flex items-center">
                        <div className="absolute inset-x-0 h-1.5 rounded-full bg-border/60" />
                        <div className="absolute left-0 h-1.5 rounded-full bg-primary/70 pointer-events-none" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                        <input type="range" min={5} max={120} step={5} value={val}
                          onChange={e => field.onChange(parseInt(e.target.value))}
                          className="absolute inset-x-0 w-full opacity-0 h-5 cursor-pointer" />
                      </div>
                    </FormControl>
                  </FormItem>
                );
              }} />
            </div>
          </BuilderPanel>
        )}

        {/* ── LIMITS ── */}
        {section === "limits" && (
          <div className="flex flex-col gap-4">
            {/* ── Auto-Redial on Drop ── */}
            <BuilderPanel
              title="Auto-Redial on Drop"
              icon={<PhoneForwarded />}
              description="Call back after an unexpected disconnect"
            >
            <div className="space-y-4">
              <FormField control={form.control} name="autoRedialEnabled" render={({ field }) => (
                <FormItem className="flex items-center justify-between space-y-0">
                  <div>
                    <FormLabel className="text-[12px] font-medium text-foreground/90">Enable Auto-Redial</FormLabel>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">Call back automatically after any unexpected disconnect</p>
                  </div>
                  <FormControl>
                    <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="autoRedialMaxAttempts" render={({ field }) => {
                const val = field.value ?? 3;
                return (
                  <FormItem className="space-y-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <FormLabel className="text-[12px] font-medium text-foreground/90">Max Attempts per Day</FormLabel>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">Stop retrying after this many attempts in a single day</p>
                      </div>
                      <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">{val}×</span>
                    </div>
                    <FormControl>
                      <div className="relative h-5 flex items-center">
                        <div className="absolute inset-x-0 h-1.5 rounded-full bg-border/60" />
                        <div className="absolute left-0 h-1.5 rounded-full bg-primary/70 pointer-events-none" style={{ width: `${((val - 1) / (10 - 1)) * 100}%` }} />
                        <input type="range" min={1} max={10} step={1} value={val}
                          onChange={e => field.onChange(parseInt(e.target.value))}
                          className="absolute inset-x-0 w-full opacity-0 h-5 cursor-pointer" />
                      </div>
                    </FormControl>
                    <div className="flex justify-between mt-1">
                      <span className="text-[9px] text-muted-foreground/50">1</span>
                      <span className="text-[9px] text-muted-foreground/50">10</span>
                    </div>
                  </FormItem>
                );
              }} />
            </div>
            </BuilderPanel>

            <BuilderPanel
              title="Call Limits"
              icon={<Gauge />}
              description="Hard cut-off for call duration"
            >
            <div className="space-y-5">
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
              <FormField control={form.control} name="telephonyProvider" render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[12px] font-medium text-foreground/90">Telephony Provider</FormLabel>
                  <p className="text-[10px] text-muted-foreground/70">Which carrier this agent dials and receives calls on. Plivo/Twilio use your own account key from Settings → Voices and Providers (₹1/min cheaper).</p>
                  <SmallSelect value={field.value ?? "vobiz"} onChange={field.onChange}
                    options={[
                      { value: "vobiz", label: "VoBiz (platform / own number)" },
                      { value: "plivo", label: "Plivo — your own account" },
                      { value: "twilio", label: "Twilio — your own account" },
                    ]} />
                </FormItem>
              )} />
            </div>
            </BuilderPanel>
          </div>
        )}

        {/* ── COMPLIANCE ── */}
        {section === "compliance" && (
          <BuilderPanel
            title="Compliance frameworks"
            icon={<ShieldCheck />}
            description="Disclosures injected into the prompt at runtime"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([
                { name: "complianceIrdai", label: "IRDAI",    badge: "Insurance",   desc: "Insurance Regulatory and Development Authority of India — for insurance advisory calls"         },
                { name: "complianceDpdp",  label: "DPDP Act", badge: "Data Privacy", desc: "Digital Personal Data Protection Act 2023 — when collecting personal data from callers"       },
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
                    onClick={(e) => { if (!e.nativeEvent.isTrusted) return; setValue(!field.value); }}
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
                        <li>Dial flows using this agent require a <span className="font-medium text-foreground">documented consent basis</span> before launch.</li>
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
          </BuilderPanel>
        )}

        {/* ── WEBSITE EMBED ── */}
        {section === "website" && (
          <BuilderPanel
            title="Website webcall"
            icon={<Globe />}
            description="Embed this agent on your own site"
          >
            {agent?.id ? (
              <AgentWebsiteEmbedPanel agentId={agent.id} agentName={agent.name ?? ""} />
            ) : (
              <p className="text-[12px] text-muted-foreground">Save the agent first, then generate embed code.</p>
            )}
          </BuilderPanel>
        )}

        {/* ── INTEGRATIONS ── */}
        {section === "integrations" && (
          <BuilderPanel
            title="Post-call notify"
            icon={<Webhook />}
            description={`POST JSON to your CRM after each call on ${notifyAgentName}`}
          >
            <div className="space-y-3">
              <FormField control={form.control} name="webhookUrl" render={({ field }) => {
                const val = field.value ?? "";
                const isEmail = val.includes("@") && !val.startsWith("http");
                const isHttp  = val.length > 0 && val.startsWith("http://");
                return (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">Notify URL</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://your-server.com/voiceorch-webhook"
                        className="h-9 text-sm font-mono bg-background/50"
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    {isEmail && (
                      <p className="text-xs text-destructive flex items-start gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>That looks like an email address, not a URL. Enter an <code className="font-mono">https://</code> endpoint.</span>
                      </p>
                    )}
                    {isHttp && !isEmail && (
                      <p className="text-xs text-amber-500 flex items-start gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>HTTP is not allowed — must be <code className="font-mono">https://</code></span>
                      </p>
                    )}
                    <FormDescription className="text-[10px]">
                      Must be HTTPS. We send a JSON payload with <code className="font-mono bg-muted px-0.5 rounded">callId</code>, <code className="font-mono bg-muted px-0.5 rounded">status</code>, <code className="font-mono bg-muted px-0.5 rounded">transcript</code>, <code className="font-mono bg-muted px-0.5 rounded">disposition</code> and more.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                );
              }} />
              <FormField control={form.control} name="webhookSecret" render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">Signing Secret (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Shared HMAC secret for signature verification"
                      className="h-9 text-xs bg-background/50"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-[10px]">
                    Sent as <code className="font-mono bg-muted px-0.5 rounded">X-SnapServe-Signature</code> so you can verify the body we actually POST.
                  </FormDescription>
                </FormItem>
              )} />
              <FormField control={form.control} name="webhookPayloadTemplate" render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">JSON body template (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={WEBHOOK_PAYLOAD_TEMPLATE_PLACEHOLDER}
                      className="min-h-[140px] text-[11px] font-mono bg-background/50 resize-y"
                      spellCheck={false}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormDescription className="text-[10px] leading-relaxed">
                    Leave blank to send the default SnapServe payload. Use <code className="font-mono bg-muted px-0.5 rounded">{"{{callId}}"}</code>,{" "}
                    <code className="font-mono bg-muted px-0.5 rounded">{"{{status}}"}</code>,{" "}
                    <code className="font-mono bg-muted px-0.5 rounded">{"{{transcript}}"}</code>,{" "}
                    <code className="font-mono bg-muted px-0.5 rounded">{"{{dispositionResult}}"}</code> (quoted placeholders keep JSON types).
                    Applies only to this URL — not Developers event subscriptions. Invalid JSON falls back to the default body.
                    Header <code className="font-mono bg-muted px-0.5 rounded">X-SnapServe-Payload</code> is <code className="font-mono">custom</code> or <code className="font-mono">default</code>.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Outcome labels and after-call WhatsApp / email live on{" "}
              <span className="text-foreground/80">After the call</span>.
            </p>
          </BuilderPanel>
        )}

      </div>
    </div>
  );
}

/* ── Agent list panel ───────────────────────────────────────────────────────── */

function AgentListPanel({ selectedId, onSelect, className }: {
  selectedId: number | null;
  onSelect: (id: number) => void;
  rateMap?: Map<string, number>;
  className?: string;
}) {
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();
  const { isManagedWorkspace } = usePartnerManagedWorkspace();
  const { toast } = useToast();
  const { data: agents, isLoading } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });
  const { teamByAgentId } = useAgentTeamMap();
  const deleteAgent = useDeleteAgent();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDeleteItem = async (e: React.MouseEvent, agentId: number, name: string) => {
    e.stopPropagation();
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      setDeletingId(agentId);
      await deleteAgent.mutateAsync({ id: agentId });
      toast({ title: "Deleted", description: `Agent "${name}" deleted.` });
      if (selectedId === agentId) {
        const remaining = (agents ?? []).filter(a => a.id !== agentId);
        if (remaining.length > 0) {
          onSelect(remaining[0]!.id);
        } else {
          navigate("/app/agents");
        }
      }
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = sortAgentsByTeam(
    (agents ?? []).filter(a => {
      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }),
    teamByAgentId,
  );
  const liveCount = (agents ?? []).filter(a => a.status === "active").length;
  const totalCount = agents?.length ?? 0;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden bg-background", className)}>
      <div className="space-y-3 border-b border-border/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Agents</p>
            <p className="text-[12px] text-muted-foreground">
              {isLoading ? "…" : `${totalCount} total · ${liveCount} live`}
            </p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-8 border-border/60 bg-background pl-8 text-xs"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {isLoading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-2 py-2"><Skeleton className="mb-1.5 h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>
        ))}
        {!isLoading && filtered.length === 0 && (
          <EmptyState
            variant="inline"
            icon={<Bot />}
            title={search ? "No matches" : "No agents yet"}
            description={
              search
                ? "Try a different name or clear the search."
                : "Build the voice agent first, then attach it to a campaign."
            }
            action={
              search
                ? undefined
                : isManagedWorkspace
                  ? {
                      label: "New agent",
                      onClick: () => navigate("/app/agents?create=1"),
                    }
                  : {
                    label: "Build with AI",
                    icon: <Sparkles className="size-3" />,
                    onClick: () => navigate("/app/vibe"),
                  }
            }
            secondaryAction={
              search || isManagedWorkspace
                ? undefined
                : {
                    label: "Configure manually",
                    onClick: () => navigate("/app/agents?create=1"),
                  }
            }
          />
        )}
        {filtered.map((agent) => {
          const isSelected = agent.id === selectedId;
          const isLive = agent.status === "active";
          const team = teamByAgentId.get(agent.id);
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelect(agent.id)}
              className={cn(
                "group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
                isSelected ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.04]",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium">{agent.name}</span>
                  <span className="shrink-0 rounded bg-muted/80 px-1 py-0.5 text-[9px] font-mono font-medium text-muted-foreground">#{agent.id}</span>
                  <StatusDot tone={isLive ? "success" : "neutral"} />
                </div>
                {team ? (
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    <span className="inline-flex max-w-full items-center gap-1 rounded border border-border/60 bg-muted/40 px-1 py-px">
                      <Users className="size-2.5 shrink-0" />
                      <span className="truncate">Team · {team.squadName}</span>
                    </span>
                    {team.roleName ? <span className="ml-1 truncate">· {team.roleName}</span> : null}
                  </p>
                ) : (
                  <p className="truncate text-[10px] text-muted-foreground">
                    {agent.asrProvider} · {agent.ttsProvider}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => handleDeleteItem(e, agent.id, agent.name)}
                disabled={deletingId === agent.id}
                className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                title={`Delete ${agent.name}`}
                aria-label={`Delete ${agent.name}`}
              >
                <Trash2 className="size-3" />
              </button>
            </button>
          );
        })}
      </div>
      {!isManagedWorkspace && (
      <div className="border-t border-border/70 p-2">
        <button
          type="button"
          onClick={() => navigate("/app/vibe")}
          className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
        >
          <Sparkles className="size-3.5 shrink-0" />
          Create with Vibe
        </button>
      </div>
      )}
    </div>
  );
}

/* ── Tab: Analysis (Journey) ────────────────────────────────────────────────── */

type MeaningMapState = {
  interested: string[];
  callback: string[];
  dnc: string[];
};

type AfterCallMsgRule = {
  id: string;
  dispositions: string[];
  whatsapp: boolean;
  email: boolean;
  whatsappTemplate?: WaTplChoice | null;
};

type AfterCallMessagesState = {
  universal: { whatsapp: boolean; email: boolean; whatsappTemplate?: WaTplChoice | null };
  skipUniversalWhenMatched: boolean;
  rules: AfterCallMsgRule[];
};

const EMPTY_AFTER_CALL_MESSAGES: AfterCallMessagesState = {
  universal: { whatsapp: false, email: false },
  skipUniversalWhenMatched: true,
  rules: [],
};

function readWaTpl(raw: unknown): WaTplChoice | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const language = typeof o.language === "string" ? o.language.trim() : "";
  if (!name || !language) return null;
  return {
    name,
    language,
    paramCount: Number.isFinite(Number(o.paramCount)) ? Math.max(0, Number(o.paramCount)) : 0,
  };
}

function readAfterCallMessages(raw: unknown): AfterCallMessagesState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_AFTER_CALL_MESSAGES, rules: [] };
  const o = raw as Record<string, unknown>;
  const u = o["universal"] && typeof o["universal"] === "object"
    ? (o["universal"] as Record<string, unknown>)
    : {};
  const rules = Array.isArray(o["rules"])
    ? o["rules"]
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const r = item as Record<string, unknown>;
          const dispositions = Array.isArray(r["dispositions"])
            ? r["dispositions"].filter((d): d is string => typeof d === "string" && !!d.trim())
            : [];
          if (!dispositions.length) return null;
          return {
            id: typeof r["id"] === "string" && r["id"] ? r["id"] : crypto.randomUUID(),
            dispositions,
            whatsapp: !!r["whatsapp"],
            email: !!r["email"],
            whatsappTemplate: readWaTpl(r["whatsappTemplate"]),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
    : [];
  return {
    universal: {
      whatsapp: !!u["whatsapp"],
      email: !!u["email"],
      whatsappTemplate: readWaTpl(u["whatsappTemplate"]),
    },
    skipUniversalWhenMatched: o["skipUniversalWhenMatched"] !== false,
    rules,
  };
}

type DispConfigRow = {
  taxonomy: Record<string, string[]>;
  domainFields?: StoredDomainField[];
  rules?: unknown[];
  meaningMap?: MeaningMapState | null;
  afterCallMessages?: unknown;
  outcomeGuides?: Record<string, string> | null;
};

function DispositionSettingsPanel({ agentId }: { agentId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [categories, setCategories] = useState<DispositionCategory[]>([]);
  const [fields, setFields] = useState<UiDomainField[]>([]);
  const [rules, setRules] = useState<unknown[]>([]);
  const [meaningMap, setMeaningMap] = useState<MeaningMapState>({
    interested: [],
    callback: [],
    dnc: [],
  });
  const [outcomeGuides, setOutcomeGuides] = useState<Record<string, string>>({});
  const [afterCallMessages, setAfterCallMessages] = useState<AfterCallMessagesState>(EMPTY_AFTER_CALL_MESSAGES);
  const [dirty, setDirty] = useState(false);

  const { data: dispConfig, isLoading: dispLoading } = useQuery<DispConfigRow | null>({
    queryKey: ["disposition-config", agentId],
    queryFn: async () => {
      try {
        return await customFetch<DispConfigRow>(`${DASH_API}/disposition/config/${agentId}`);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
    enabled: agentId > 0,
  });

  const { data: waConnections } = useQuery({
    queryKey: ["builder-whatsapp-connections", agentId],
    queryFn: () =>
      customFetch<{
        connections: Array<{
          id: string;
          active: boolean;
          agentId: number | null;
          metaConnected?: boolean;
          metaPhoneNumberId?: string | null;
          templateCatalog?: WaCatalogEntry[];
        }>;
      }>(`${DASH_API}/whatsapp/connections`),
    staleTime: 60_000,
    enabled: agentId > 0,
  });
  const { data: waChannel } = useQuery({
    queryKey: ["builder-whatsapp-channel", agentId],
    queryFn: () =>
      customFetch<{ channel: { active?: boolean; status?: string | null; vobizChannelId?: string | null; phoneE164?: string | null; templateCatalog?: WaCatalogEntry[] } | null }>(`${DASH_API}/whatsapp/channel`),
    staleTime: 60_000,
    enabled: agentId > 0,
  });
  const { data: nativeTpl } = useQuery({
    queryKey: ["wa-agent-templates", agentId],
    queryFn: () =>
      customFetch<{ templateCatalog?: WaCatalogEntry[] }>(`${DASH_API}/whatsapp/agents/${agentId}/templates`),
    staleTime: 60_000,
    enabled: agentId > 0,
  });
  const { data: emailChannel } = useQuery({
    queryKey: ["email-channel"],
    queryFn: () =>
      customFetch<{ channel: { active?: boolean } | null }>(`${DASH_API}/email/channel`),
    staleTime: 60_000,
    enabled: agentId > 0,
  });

  const waConnList = Array.isArray(waConnections?.connections) ? waConnections.connections : [];
  const whatsappReady = !!(
    waConnList.some((c) => c.active && (c.metaConnected || c.metaPhoneNumberId))
    || (waChannel?.channel?.active && (waChannel.channel.status === "active" || waChannel.channel.vobizChannelId || waChannel.channel.phoneE164))
  );
  const emailReady = !!emailChannel?.channel?.active;
  const waCatalog = useMemo(() => {
    const map = new Map<string, WaCatalogEntry>();
    const piles = [
      waChannel?.channel?.templateCatalog,
      nativeTpl?.templateCatalog,
      ...waConnList.map((c) => c.templateCatalog),
    ];
    for (const list of piles) {
      for (const t of list ?? []) {
        if (!t?.name || !t.language) continue;
        map.set(`${t.name}|${t.language}`, t);
      }
    }
    return [...map.values()];
  }, [waChannel?.channel?.templateCatalog, nativeTpl?.templateCatalog, waConnList]);

  useEffect(() => {
    if (!dispConfig) return;
    setCategories(taxonomyToCategories(dispConfig.taxonomy ?? {}));
    setFields((dispConfig.domainFields ?? []).map(fromStoredDomainField));
    setRules(Array.isArray(dispConfig.rules) ? dispConfig.rules : []);
    setMeaningMap({
      interested: Array.isArray(dispConfig.meaningMap?.interested)
        ? [...dispConfig.meaningMap!.interested]
        : [],
      callback: Array.isArray(dispConfig.meaningMap?.callback)
        ? [...dispConfig.meaningMap!.callback]
        : [],
      dnc: Array.isArray(dispConfig.meaningMap?.dnc) ? [...dispConfig.meaningMap!.dnc] : [],
    });
    setOutcomeGuides(
      dispConfig.outcomeGuides && typeof dispConfig.outcomeGuides === "object"
        ? { ...dispConfig.outcomeGuides }
        : {},
    );
    setAfterCallMessages(readAfterCallMessages(dispConfig.afterCallMessages));
    setDirty(false);
  }, [dispConfig]);

  /** After-call rules: primary + primary:sub (matches dispositionMatchesAny). */
  const dispositionKeys = useMemo(() => {
    const tax = categoriesToTaxonomy(categories);
    const out: string[] = [];
    for (const [primary, subs] of Object.entries(tax)) {
      out.push(primary);
      for (const sub of subs ?? []) {
        if (sub && sub !== primary) out.push(`${primary}:${sub}`);
      }
    }
    return out;
  }, [categories]);

  /** Business-definition prompts: the labels AI actually picks (taxonomy values). */
  const outcomeGuideKeys = useMemo(() => {
    const tax = categoriesToTaxonomy(categories);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const vals of Object.values(tax)) {
      for (const v of vals ?? []) {
        const key = v.trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
      }
    }
    return out;
  }, [categories]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      let taxonomy = categoriesToTaxonomy(categories);
      // LLM disposeCall requires at least one outcome category; if user only
      // added data fields, seed a minimal Sales outcome set.
      if (Object.keys(taxonomy).length === 0 && fields.length > 0) {
        taxonomy = { ...OUTCOME_PRESETS.find((p) => p.id === "sales")!.taxonomy };
      }
      const domainFields = fields
        .map(toStoredDomainField)
        .filter((f): f is StoredDomainField => !!f);
      const allowed = new Set<string>();
      for (const [primary, vals] of Object.entries(taxonomy)) {
        for (const v of vals ?? []) {
          const t = v.trim();
          if (!t) continue;
          allowed.add(t);
          allowed.add(`${primary}:${t}`);
        }
      }
      const guides: Record<string, string> = {};
      for (const [k, v] of Object.entries(outcomeGuides)) {
        const key = k.trim();
        const text = (v ?? "").trim();
        if (key && text && allowed.has(key)) guides[key] = text;
      }
      await customFetch(`${DASH_API}/disposition/config/${agentId}`, {
        method: "PUT",
        body: JSON.stringify({
          taxonomy,
          domainFields,
          rules,
          meaningMap,
          outcomeGuides: guides,
          // Always persist the explicit toggle state. Omitting an all-off value
          // makes the server use the legacy always-on WhatsApp behaviour.
          afterCallMessages,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Outcomes saved" });
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ["disposition-config", agentId] });
    },
    onError: () => {
      toast({ title: "Failed to save", variant: "destructive" });
    },
  });

  function applyPreset(presetId: string) {
    const preset = OUTCOME_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setCategories(taxonomyToCategories(preset.taxonomy));
    setDirty(true);
  }

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

  function addField(partial?: Partial<UiDomainField>) {
    const label = partial?.label ?? "";
    const key = partial?.key ?? (label ? slugDispositionKey(label) : "");
    setFields((prev) => {
      if (key && prev.some((f) => f.key === key)) return prev;
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          label,
          key,
          uiType: partial?.uiType ?? "text",
          optionsText: partial?.optionsText ?? "",
        },
      ];
    });
    setDirty(true);
  }

  function removeField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
    setDirty(true);
  }

  function updateField(id: string, patch: Partial<UiDomainField>) {
    setFields((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const next = { ...f, ...patch };
        if (patch.label != null && (!f.key || f.key === slugDispositionKey(f.label))) {
          next.key = slugDispositionKey(patch.label);
        }
        return next;
      }),
    );
    setDirty(true);
  }

  if (agentId <= 0) {
    return (
      <BuilderPanel title="What happened" icon={<Tag />}>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Save the agent first to define outcomes and data fields.
        </p>
      </BuilderPanel>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {dispLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-muted/20 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* ── Outcomes ─────────────────────────────────────────────── */}
          <BuilderPanel
            title="Outcome labels"
            icon={<Tag />}
            description="AI picks one of these after each call"
            action={
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2.5 text-[11px]" onClick={addCategory}>
                <Plus className="size-3" /> Add category
              </Button>
            }
          >
            <div className="flex flex-wrap gap-1.5 mb-3">
              {OUTCOME_PRESETS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => applyPreset(p.id)}
                >
                  Use {p.name} preset
                </Button>
              ))}
            </div>
            {categories.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <p className="text-[12.5px] font-medium text-muted-foreground">No outcomes yet</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground/70">Pick a preset or add a category</p>
              </div>
            ) : (
              <div className="space-y-3">
                {categories.map((cat) => (
                  <div key={cat.id} className="rounded-lg border border-border bg-background p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Category</label>
                          <Input
                            className="h-8 text-xs"
                            placeholder="e.g. outcome"
                            value={cat.name}
                            onChange={(e) => updateCategory(cat.id, "name", e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            Labels <span className="normal-case">(comma-separated)</span>
                          </label>
                          <Input
                            className="h-8 text-xs"
                            placeholder="interested, callback, no_answer"
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
                  </div>
                ))}
              </div>
            )}
          </BuilderPanel>

          {/* ── Per-outcome business definitions ─────────────────────── */}
          {outcomeGuideKeys.length > 0 && (
            <BuilderPanel
              title="What each label means"
              icon={<BookOpen />}
              description="Your definitions are what the AI reads"
            >
              <p className="mb-3 text-[11.5px] leading-relaxed text-muted-foreground">
                Example for <span className="font-mono">interested</span>: “Asked for pricing, budget confirmed,
                or agreed to a site visit this week.”
              </p>
              <div className="space-y-2.5">
                {outcomeGuideKeys.map((key) => (
                  <div key={key} className="space-y-1.5 rounded-lg border border-border bg-background p-3">
                    <label className="text-[12px] font-medium text-foreground font-mono">{key}</label>
                    <Textarea
                      className="min-h-[72px] resize-y text-[12px] leading-relaxed"
                      placeholder={`When should AI pick “${key}” for your business? List the call signals…`}
                      value={outcomeGuides[key] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setOutcomeGuides((prev) => {
                          const next = { ...prev };
                          if (!v.trim()) delete next[key];
                          else next[key] = v;
                          return next;
                        });
                        setDirty(true);
                      }}
                    />
                  </div>
                ))}
              </div>
            </BuilderPanel>
          )}

          {/* ── After-call messages (agent-owned) ─────────────────────── */}
          <BuilderPanel
            title="After-call messages"
            icon={<MessageCircle />}
            description="Sends when the call ends and the outcome is known — Interested vs Not Interested cannot be decided mid-call"
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2.5 text-[11px]"
                disabled={dispositionKeys.length === 0}
                onClick={() => {
                  setAfterCallMessages((prev) => ({
                    ...prev,
                    rules: [
                      ...prev.rules,
                      {
                        id: crypto.randomUUID(),
                        dispositions: dispositionKeys[0] ? [dispositionKeys[0]] : [],
                        whatsapp: true,
                        email: false,
                      },
                    ],
                  }));
                  setDirty(true);
                }}
              >
                <Plus className="size-3" /> Add rule
              </Button>
            }
          >
            {(!whatsappReady || !emailReady) && (
              <div className="mb-3 space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
                <p className="text-[12px] font-medium text-foreground">
                  {!whatsappReady && !emailReady
                    ? "Connect WhatsApp or email first"
                    : !whatsappReady
                      ? "WhatsApp not connected yet"
                      : "Email not connected yet"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  You can still save rules now — messages only send after the workspace connection is live.
                </p>
                <div className="flex flex-wrap gap-2">
                  {!whatsappReady && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-[10px]"
                      onClick={() => navigate(connectionsSetupHref("whatsapp", agentId, "outcomes"))}
                    >
                      Connect WhatsApp
                    </Button>
                  )}
                  {!emailReady && (
                    <Button
                      type="button"
                      size="sm"
                      variant={whatsappReady ? "default" : "outline"}
                      className="h-7 text-[10px]"
                      onClick={() => navigate(connectionsSetupHref("email", agentId, "outcomes"))}
                    >
                      Connect email
                    </Button>
                  )}
                </div>
              </div>
            )}

            {(whatsappReady || emailReady) && (
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    whatsappReady
                      ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", whatsappReady ? "bg-emerald-500" : "bg-muted-foreground/50")} />
                  WhatsApp {whatsappReady ? "ready" : "not connected"}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    emailReady
                      ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", emailReady ? "bg-emerald-500" : "bg-muted-foreground/50")} />
                  Email {emailReady ? "ready" : "not connected"}
                </span>
                {!whatsappReady ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => navigate(connectionsSetupHref("whatsapp", agentId, "outcomes"))}
                  >
                    Connect WhatsApp
                  </Button>
                ) : null}
                {!emailReady ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => navigate(connectionsSetupHref("email", agentId, "outcomes"))}
                  >
                    Connect email
                  </Button>
                ) : null}
              </div>
            )}

            <div className="rounded-xl border border-border/60 bg-card/20 p-3 space-y-3 mb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] font-medium text-foreground">One template for all outcomes</p>
                  <p className="text-[10px] text-muted-foreground">
                    After the call, every lead gets this template. Add a rule below to send a different one for Interested, Not Interested, etc.
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Switch
                      checked={afterCallMessages.universal.whatsapp}
                      onCheckedChange={(v) => {
                        setAfterCallMessages((prev) => ({
                          ...prev,
                          universal: { ...prev.universal, whatsapp: v },
                        }));
                        setDirty(true);
                      }}
                    />
                    WhatsApp
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Switch
                      checked={afterCallMessages.universal.email}
                      onCheckedChange={(v) => {
                        setAfterCallMessages((prev) => ({
                          ...prev,
                          universal: { ...prev.universal, email: v },
                        }));
                        setDirty(true);
                      }}
                    />
                    Email
                  </label>
                </div>
              </div>
              {afterCallMessages.universal.whatsapp && whatsappReady && (
                <div>
                  <p className="text-[10px] text-muted-foreground">WhatsApp template</p>
                  <WhatsappTemplateSelect
                    catalog={waCatalog}
                    value={afterCallMessages.universal.whatsappTemplate}
                    emptyLabel="Select template"
                    onChange={(next) => {
                      setAfterCallMessages((prev) => ({
                        ...prev,
                        universal: { ...prev.universal, whatsappTemplate: next },
                      }));
                      setDirty(true);
                    }}
                  />
                </div>
              )}
              {afterCallMessages.rules.length > 0 && (
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Switch
                    checked={afterCallMessages.skipUniversalWhenMatched}
                    onCheckedChange={(v) => {
                      setAfterCallMessages((prev) => ({ ...prev, skipUniversalWhenMatched: v }));
                      setDirty(true);
                    }}
                  />
                  Skip universal when a disposition rule matches
                </label>
              )}
            </div>

            {afterCallMessages.rules.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center">
                <p className="text-[11.5px] text-muted-foreground">
                  {dispositionKeys.length === 0
                    ? "Add outcomes above, then Add rule to send a different template for one or more dispositions."
                    : "Same template for every outcome above — or Add rule to pick dispositions and a different template."}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {afterCallMessages.rules.map((rule) => (
                  <div key={rule.id} className="space-y-3 rounded-lg border border-border bg-background p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap gap-1.5 flex-1">
                        {dispositionKeys.map((d) => {
                          const on = rule.dispositions.includes(d);
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={() => {
                                setAfterCallMessages((prev) => ({
                                  ...prev,
                                  rules: prev.rules.map((r) => {
                                    if (r.id !== rule.id) return r;
                                    const next = on
                                      ? r.dispositions.filter((x) => x !== d)
                                      : [...r.dispositions, d];
                                    return { ...r, dispositions: next.length ? next : r.dispositions };
                                  }),
                                }));
                                setDirty(true);
                              }}
                              className={cn(
                                "rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors",
                                on
                                  ? "bg-foreground text-background border-foreground"
                                  : "bg-muted/40 text-muted-foreground border-border hover:border-foreground/30",
                              )}
                            >
                              {d}
                            </button>
                          );
                        })}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => {
                          setAfterCallMessages((prev) => ({
                            ...prev,
                            rules: prev.rules.filter((r) => r.id !== rule.id),
                          }));
                          setDirty(true);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Switch
                          checked={rule.whatsapp}
                          onCheckedChange={(v) => {
                            setAfterCallMessages((prev) => ({
                              ...prev,
                              rules: prev.rules.map((r) =>
                                r.id === rule.id ? { ...r, whatsapp: v } : r,
                              ),
                            }));
                            setDirty(true);
                          }}
                        />
                        WhatsApp
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Switch
                          checked={rule.email}
                          onCheckedChange={(v) => {
                            setAfterCallMessages((prev) => ({
                              ...prev,
                              rules: prev.rules.map((r) =>
                                r.id === rule.id ? { ...r, email: v } : r,
                              ),
                            }));
                            setDirty(true);
                          }}
                        />
                        Email
                      </label>
                    </div>
                    {rule.whatsapp && whatsappReady && (
                      <div>
                        <p className="text-[10px] text-muted-foreground">Template for the selected dispositions</p>
                        <WhatsappTemplateSelect
                          catalog={waCatalog}
                          value={rule.whatsappTemplate}
                          emptyLabel="Select template"
                          onChange={(next) => {
                            setAfterCallMessages((prev) => ({
                              ...prev,
                              rules: prev.rules.map((r) =>
                                r.id === rule.id ? { ...r, whatsappTemplate: next } : r,
                              ),
                            }));
                            setDirty(true);
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </BuilderPanel>

          {/* ── Data to collect ──────────────────────────────────────── */}
          <BuilderPanel
            title="Data to collect"
            icon={<List />}
            description="Structured fields pulled from the transcript"
            action={
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2.5 text-[11px]" onClick={() => addField()}>
                <Plus className="size-3" /> Add field
              </Button>
            }
          >
            <p className="mb-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Phone / WhatsApp / alternate number are saved as digits only — spoken “eight nine…” is converted.
            </p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {DOMAIN_FIELD_QUICK_ADDS.map((q) => (
                <Button
                  key={q.key}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={fields.some((f) => f.key === q.key)}
                  onClick={() => addField(q)}
                >
                  + {q.label}
                </Button>
              ))}
            </div>
            {fields.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <p className="text-[12.5px] font-medium text-muted-foreground">No data fields</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground/70">Quick-add WhatsApp, email, city…</p>
              </div>
            ) : (
              <div className="space-y-3">
                {fields.map((field) => (
                  <div key={field.id} className="space-y-3 rounded-lg border border-border bg-background p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Label</label>
                          <Input
                            className="h-8 text-xs"
                            placeholder="WhatsApp number"
                            value={field.label}
                            onChange={(e) => updateField(field.id, { label: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Key</label>
                          <Input
                            className="h-8 text-xs font-mono"
                            placeholder="whatsapp_number"
                            value={field.key}
                            onChange={(e) => updateField(field.id, { key: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Type</label>
                          <Select
                            value={field.uiType}
                            onValueChange={(v) => updateField(field.id, { uiType: v as UiDomainFieldType })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="phone">Phone / WhatsApp</SelectItem>
                              <SelectItem value="text">Short text</SelectItem>
                              <SelectItem value="number">Number</SelectItem>
                              <SelectItem value="yes_no">Yes / No</SelectItem>
                              <SelectItem value="choice">Choice</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 mt-5 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => removeField(field.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {field.uiType === "choice" && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          Options <span className="normal-case">(comma-separated)</span>
                        </label>
                        <Input
                          className="h-8 text-xs"
                          placeholder="yes, no, maybe"
                          value={field.optionsText ?? ""}
                          onChange={(e) => updateField(field.id, { optionsText: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </BuilderPanel>
        </>
      )}

      {(categories.length > 0 || fields.length > 0 || dirty || dispositionKeys.length > 0) && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={saveMutation.isPending || !dirty}
            onClick={() => saveMutation.mutate()}
          >
            <Save className="h-3.5 w-3.5" />
            {saveMutation.isPending ? "Saving…" : "Save Outcomes"}
          </Button>
        </div>
      )}
    </div>
  );
}

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
  { label: "Call Settings", keys: ["maxDuration", "silenceTimeoutSeconds", "language", "webhookUrl", "noiseCancellationEnabled", "backchannelingEnabled", "recordingEnabled", "summarizationEnabled"] },
  { label: "Tools",         keys: ["tools"] },
  { label: "Knowledge Base", keys: ["knowledgeSourceIds"] },
  { label: "Scheduling",    keys: ["schedulingCalendarId", "schedulingEventTypeId"] },
  { label: "Compliance",    keys: ["agentConfig.complianceDpdp", "agentConfig.complianceIrdai", "agentConfig.complianceTrai"] },
  { label: "Advanced",      keys: ["agentConfig"] },
];

const FIELD_LABELS: Record<string, string> = {
  systemPrompt: "System Prompt",
  greetingMessage: "Greeting Message",
  endCallPhrases: "End Call Phrases",
  asrProvider: "ASR Provider",
  asrModel: "ASR Model",
  asrLanguage: "ASR Language",
  asrBackgroundDenoising: "Background Denoising",
  asrConfidenceThreshold: "Confidence Threshold",
  asrKeyterms: "Key Terms",
  asrSmartEndpointing: "Smart Endpointing",
  llmProvider: "LLM Provider",
  llmModel: "LLM Model",
  temperature: "Temperature",
  ttsProvider: "TTS Provider",
  ttsVoice: "Voice Name",
  ttsModel: "TTS Model",
  telephonyProvider: "Telephony Provider",
  maxDuration: "Max Duration (s)",
  silenceTimeoutSeconds: "Silence Timeout (s)",
  language: "Language",
  webhookUrl: "Post-call notify URL",
  webhookPayloadTemplate: "Post-call JSON template",
  noiseCancellationEnabled: "Noise Cancellation",
  backchannelingEnabled: "Backchannel",
  recordingEnabled: "Call Recording",
  summarizationEnabled: "Auto Summarization",
  tools: "Tools",
  knowledgeSourceIds: "Knowledge Sources",
  schedulingCalendarId: "Scheduling Calendar",
  schedulingEventTypeId: "Meeting",
  "agentConfig.complianceDpdp": "DPDP Compliance",
  "agentConfig.complianceIrdai": "IRDAI Compliance",
  "agentConfig.complianceTrai": "TRAI Compliance",
  agentConfig: "Advanced Config",
};

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let val: unknown = obj;
  for (const part of parts) {
    if (val == null || typeof val !== "object") return undefined;
    val = (val as Record<string, unknown>)[part];
  }
  return val;
}

function formatVisualValue(key: string, val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "number") return String(val);
  if (Array.isArray(val)) {
    if (val.length === 0) return "None";
    if (key === "tools") return (val as any[]).map((t) => t?.name || t?.type || "Unknown Tool").join(", ");
    if (key === "knowledgeSourceIds") return val.map(String).join(", ");
    return val.map(String).join(", ");
  }
  if (typeof val === "object") return JSON.stringify(val, null, 2);
  return String(val);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function ToolsDiff({ oldTools, newTools }: { oldTools: unknown; newTools: unknown }) {
  const oldNames = Array.isArray(oldTools) ? (oldTools as any[]).map((t) => t?.name || t?.type || "Unknown") : [];
  const newNames = Array.isArray(newTools) ? (newTools as any[]).map((t) => t?.name || t?.type || "Unknown") : [];
  const removed = oldNames.filter((n) => !newNames.includes(n));
  const added = newNames.filter((n) => !oldNames.includes(n));
  const kept = oldNames.filter((n) => newNames.includes(n));
  return (
    <div className="flex gap-3 text-[11px]">
      <div className="flex-1 space-y-0.5">
        {kept.map((n) => <div key={`k-${n}`} className="text-foreground/70">{n}</div>)}
        {removed.map((n) => <div key={`r-${n}`} className="text-red-400 line-through opacity-70">{n}</div>)}
        {oldNames.length === 0 && <span className="text-muted-foreground/40 italic">None</span>}
      </div>
      <div className="flex-1 space-y-0.5">
        {kept.map((n) => <div key={`k-${n}`} className="text-foreground/70">{n}</div>)}
        {added.map((n) => <div key={`a-${n}`} className="text-green-400">{n}</div>)}
        {newNames.length === 0 && <span className="text-muted-foreground/40 italic">None</span>}
      </div>
    </div>
  );
}

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
  agentId, baseVersion, allVersions, initialCompareId,
  onClose,
}: {
  agentId: number;
  baseVersion: AgentVersion;
  allVersions: VersionSummary[];
  initialCompareId?: number | null;
  onClose: () => void;
}) {
  const [compareId, setCompareId] = useState<number | null>(initialCompareId ?? null);
  const [ignoreFormatting, setIgnoreFormatting] = useState(true);
  const [viewMode, setViewMode] = useState<"visual" | "technical">("visual");
  const [searchQuery, setSearchQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

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
  const otherPublished = otherVersions.filter(v => (v as any).snapshotType !== "draft");
  const otherDrafts = otherVersions.filter(v => (v as any).snapshotType === "draft");

  const versionLabel = (v: VersionSummary) =>
    (v as any).snapshotType === "draft"
      ? `${v.versionNumber} · ${v.versionName}`
      : `${v.versionNumber}: ${v.versionName}`;

  const a = useMemo(() => (baseSnap?.snapshot ?? {}) as Record<string, unknown>, [baseSnap]);
  const b = useMemo(() => (compareSnap?.snapshot ?? {}) as Record<string, unknown>, [compareSnap]);

  const renderValue = (val: unknown): string => {
    if (val === null || val === undefined) return "—";
    if (typeof val === "object") return JSON.stringify(val, null, 2);
    return String(val);
  };

  const sectionChangeCounts = useMemo(() => {
    if (!compareId) return {} as Record<string, number>;
    return Object.fromEntries(
      COMPARE_SECTIONS.map(section => {
        const n = section.keys.filter(key => {
          const aVal = renderValue(getNestedValue(a, key));
          const bVal = renderValue(getNestedValue(b, key));
          return aVal !== bVal;
        }).length;
        return [section.label, n];
      })
    );
  }, [a, b, compareId]);

  const totalChanges = useMemo(() => Object.values(sectionChangeCounts).reduce((s, n) => s + n, 0), [sectionChangeCounts]);
  const changedSections = useMemo(
    () => COMPARE_SECTIONS.filter(s => (sectionChangeCounts[s.label] ?? 0) > 0),
    [sectionChangeCounts],
  );

  // Diff summary: additions (present in current a, absent in old b),
  // removals (absent in current a, present in old b), modifications (changed in both)
  const diffSummary = useMemo(() => {
    if (!compareId) return { additions: 0, removals: 0, modifications: 0 };
    let additions = 0, removals = 0, modifications = 0;
    for (const section of COMPARE_SECTIONS) {
      for (const key of section.keys) {
        const aRaw = getNestedValue(a, key);
        const bRaw = getNestedValue(b, key);
        const aVal = renderValue(aRaw);
        const bVal = renderValue(bRaw);
        if (aVal === bVal) continue;
        const aAbsent = aRaw == null || aRaw === "" || (Array.isArray(aRaw) && aRaw.length === 0);
        const bAbsent = bRaw == null || bRaw === "" || (Array.isArray(bRaw) && bRaw.length === 0);
        if (!aAbsent && bAbsent) additions++;
        else if (aAbsent && !bAbsent) removals++;
        else modifications++;
      }
    }
    return { additions, removals, modifications };
  }, [a, b, compareId]);

  const scrollToSection = (label: string) => {
    const el = document.getElementById(`compare-section-${label.replace(/\s+/g, "-")}`);
    if (el && contentRef.current) {
      const containerTop = contentRef.current.getBoundingClientRect().top;
      const elTop = el.getBoundingClientRect().top;
      contentRef.current.scrollTop += elTop - containerTop - 16;
    }
  };

  const renderTechnicalDiff = (section: typeof COMPARE_SECTIONS[number]) => {
    const rows: React.ReactNode[] = [];

    for (const key of section.keys) {
      const aRaw = getNestedValue(a, key); // current (newer)
      const bRaw = getNestedValue(b, key); // old (compare target)
      const aVal = renderValue(aRaw);
      const bVal = renderValue(bRaw);
      const changed = aVal !== bVal;
      const displayKey = key.includes(".") ? key.split(".").pop()! : key;

      // Structural diff for plain objects (e.g. agentConfig)
      if (changed && isPlainObject(aRaw) && isPlainObject(bRaw)) {
        const allSubKeys = Array.from(new Set([...Object.keys(aRaw), ...Object.keys(bRaw)]));
        for (const subKey of allSubKeys) {
          const aSubVal = renderValue(aRaw[subKey]);
          const bSubVal = renderValue(bRaw[subKey]);
          const subChanged = aSubVal !== bSubVal;
          if (!subChanged) continue;
          const useSubWordDiff = isTextValue(aRaw[subKey], aSubVal) || isTextValue(bRaw[subKey], bSubVal);
          if (useSubWordDiff) {
            rows.push(
              <tr key={`${key}.${subKey}`} className="bg-yellow-500/5">
                <td className="py-1.5 pr-3 text-[10px] text-muted-foreground font-mono align-top w-32 shrink-0">{displayKey}.{subKey}</td>
                <td colSpan={2} className="py-1.5 pr-3 text-[11px] align-top">
                  <WordDiff oldText={bSubVal} newText={aSubVal} ignoreFormatting={ignoreFormatting} />
                </td>
              </tr>
            );
          } else {
            rows.push(
              <tr key={`${key}.${subKey}`} className="bg-yellow-500/5">
                <td className="py-1.5 pr-3 text-[10px] text-muted-foreground font-mono align-top w-32 shrink-0">{displayKey}.{subKey}</td>
                <td className="py-1.5 pr-3 text-[11px] align-top text-red-400 line-through opacity-60">
                  <pre className="whitespace-pre-wrap break-all font-mono">{bSubVal}</pre>
                </td>
                <td className="py-1.5 text-[11px] align-top text-green-400">
                  <pre className="whitespace-pre-wrap break-all font-mono">{aSubVal}</pre>
                </td>
              </tr>
            );
          }
        }
        continue;
      }

      const useWordDiff = changed && (isTextValue(aRaw, aVal) || isTextValue(bRaw, bVal));

      if (useWordDiff) {
        rows.push(
          <tr key={key} className="bg-yellow-500/5">
            <td className="py-1.5 pr-3 text-[10px] text-muted-foreground font-mono align-top w-32 shrink-0">{displayKey}</td>
            <td colSpan={2} className="py-1.5 pr-3 text-[11px] align-top">
              {/* oldText=bVal (previous), newText=aVal (current) */}
              <WordDiff oldText={compareSnap ? bVal : "—"} newText={aVal} ignoreFormatting={ignoreFormatting} />
            </td>
          </tr>
        );
        continue;
      }

      rows.push(
        <tr key={key} className={changed ? "bg-yellow-500/5" : ""}>
          <td className="py-1.5 pr-3 text-[10px] text-muted-foreground font-mono align-top w-32 shrink-0">{displayKey}</td>
          {/* Red = old value (bVal); Green = new/current value (aVal) */}
          <td className={cn("py-1.5 pr-3 text-[11px] align-top", changed && "text-red-400 line-through opacity-60")}>
            {compareSnap ? <pre className="whitespace-pre-wrap break-all font-mono">{bVal}</pre> : <span className="text-muted-foreground/40 italic">—</span>}
          </td>
          <td className={cn("py-1.5 text-[11px] align-top", changed && "text-green-400")}>
            <pre className="whitespace-pre-wrap break-all font-mono">{aVal}</pre>
          </td>
        </tr>
      );
    }

    return rows;
  };

  const renderVisualSection = (section: typeof COMPARE_SECTIONS[number]) => {
    const rows: React.ReactNode[] = [];

    const pushRow = (
      rowKey: string,
      label: string,
      aRawVal: unknown,
      bRawVal: unknown,
    ) => {
      const aV = renderValue(aRawVal); // current
      const bV = renderValue(bRawVal); // old

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const aDisplay = formatVisualValue(rowKey, aRawVal);
        const bDisplay = formatVisualValue(rowKey, bRawVal);
        if (!label.toLowerCase().includes(q) && !aDisplay.toLowerCase().includes(q) && !bDisplay.toLowerCase().includes(q)) return;
      }

      // isAdded = exists in current (a) but not in old (b)
      const isAdded = aRawVal != null && aRawVal !== "" && !(Array.isArray(aRawVal) && aRawVal.length === 0)
        && (bRawVal == null || bRawVal === "" || (Array.isArray(bRawVal) && bRawVal.length === 0));
      // isRemoved = exists in old (b) but not in current (a)
      const isRemoved = bRawVal != null && bRawVal !== "" && !(Array.isArray(bRawVal) && bRawVal.length === 0)
        && (aRawVal == null || aRawVal === "" || (Array.isArray(aRawVal) && aRawVal.length === 0));

      const rowColor = isAdded ? "bg-green-500/5 border-l-2 border-green-500/40" : isRemoved ? "bg-red-500/5 border-l-2 border-red-500/40" : "bg-yellow-500/5 border-l-2 border-yellow-500/30";

      const isToolsKey = rowKey === "tools";
      const isLongText = isTextValue(aRawVal, aV) || isTextValue(bRawVal, bV);

      rows.push(
        <div key={rowKey} className={cn("px-4 py-3 rounded-lg mb-2", rowColor)}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-semibold text-foreground/80">{label}</span>
            <span className={cn(
              "text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full",
              isAdded ? "bg-green-500/15 text-green-400" : isRemoved ? "bg-red-500/15 text-red-400" : "bg-yellow-500/15 text-yellow-400"
            )}>
              {isAdded ? "Added" : isRemoved ? "Removed" : "Modified"}
            </span>
          </div>
          {isToolsKey ? (
            // oldTools=bRaw (previous), newTools=aRaw (current)
            <ToolsDiff oldTools={bRawVal} newTools={aRawVal} />
          ) : isLongText ? (
            // oldText=bV (previous), newText=aV (current)
            <WordDiff oldText={bV} newText={aV} ignoreFormatting={ignoreFormatting} />
          ) : (
            <div className="flex gap-3 text-[11px]">
              {/* Left box = old value (red); Right box = current value (green) */}
              <div className={cn("flex-1 px-2 py-1.5 rounded bg-red-500/8 border border-red-500/15", isAdded && "opacity-40")}>
                <span className={cn("font-mono", isRemoved ? "text-red-400" : "text-foreground/70")}>{formatVisualValue(rowKey, bRawVal)}</span>
              </div>
              <div className={cn("flex-1 px-2 py-1.5 rounded bg-green-500/8 border border-green-500/15", isRemoved && "opacity-40")}>
                <span className={cn("font-mono", isAdded ? "text-green-400" : "text-green-300")}>{formatVisualValue(rowKey, aRawVal)}</span>
              </div>
            </div>
          )}
        </div>
      );
    };

    for (const key of section.keys) {
      const aRaw = getNestedValue(a, key); // current (newer)
      const bRaw = getNestedValue(b, key); // old (compare target)
      const aVal = renderValue(aRaw);
      const bVal = renderValue(bRaw);
      const changed = aVal !== bVal;
      if (!changed) continue;

      const label = FIELD_LABELS[key] ?? key;

      // Structural diff for plain objects (e.g. agentConfig)
      if (isPlainObject(aRaw) && isPlainObject(bRaw)) {
        const allSubKeys = Array.from(new Set([...Object.keys(aRaw), ...Object.keys(bRaw)]));
        for (const subKey of allSubKeys) {
          const aSubRaw = aRaw[subKey];
          const bSubRaw = bRaw[subKey];
          const aSubVal = renderValue(aSubRaw);
          const bSubVal = renderValue(bSubRaw);
          if (aSubVal === bSubVal) continue;
          const subLabel = `${label} › ${subKey}`;
          pushRow(`${key}.${subKey}`, subLabel, aSubRaw, bSubRaw);
        }
        continue;
      }

      pushRow(key, label, aRaw, bRaw);
    }
    return rows;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border/60 px-5 py-3 space-y-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
          <ArrowLeftRight className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Compare Versions</span>
          <div className="ml-auto flex items-center gap-1 p-0.5 rounded-lg bg-muted/40 border border-border/50">
            <button
              type="button"
              onClick={() => setViewMode("visual")}
              className={cn("px-3 py-1 rounded-md text-xs font-medium transition-colors", viewMode === "visual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              Visual
            </button>
            <button
              type="button"
              onClick={() => setViewMode("technical")}
              className={cn("px-3 py-1 rounded-md text-xs font-medium transition-colors", viewMode === "technical" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              Technical
            </button>
          </div>
        </div>

        {/* Version cards row */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
          <div className="space-y-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-green-400/80 px-0.5">Current Version</p>
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2 space-y-0.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-mono">{baseVersion.versionNumber}</Badge>
                <span className="text-xs font-semibold truncate">{baseVersion.versionName}</span>
              </div>
              {(baseVersion as any).publishedBy && (
                <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                  <User2 className="h-2.5 w-2.5" />{(baseVersion as any).publishedBy?.slice(0, 18)}
                </p>
              )}
              {(baseVersion as any).createdAt && (
                <p className="text-[10px] text-muted-foreground/50">{format(new Date((baseVersion as any).createdAt), "MMM d, yyyy · HH:mm")}</p>
              )}
            </div>
          </div>

          <div className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest px-1 mt-5">vs</div>

          <div className="space-y-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 px-0.5">Compared Against</p>
            <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2 space-y-1">
              <Select value={compareId != null ? String(compareId) : "__none__"} onValueChange={v => setCompareId(v === "__none__" ? null : parseInt(v, 10))}>
                <SelectTrigger className="h-6 w-full text-xs border-0 bg-transparent p-0 shadow-none focus:ring-0">
                  <SelectValue placeholder="Pick version to compare…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">Pick version…</SelectItem>
                  {otherVersions.map(v => (
                    <SelectItem key={v.id} value={String(v.id)} className="text-xs">{v.versionNumber}: {v.versionName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {compareTarget && (
                <>
                  {(compareTarget as any).publishedBy && (
                    <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                      <User2 className="h-2.5 w-2.5" />{(compareTarget as any).publishedBy?.slice(0, 18)}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground/50">{format(new Date(compareTarget.createdAt), "MMM d, yyyy · HH:mm")}</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Diff summary card */}
        {compareId && (diffSummary.additions > 0 || diffSummary.removals > 0 || diffSummary.modifications > 0) && (
          <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/10 px-3 py-2">
            <span className="text-[10px] font-semibold text-muted-foreground mr-1">Changes:</span>
            {diffSummary.additions > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-green-400 bg-green-500/10 border border-green-500/20 rounded-full px-2 py-0.5">
                <span className="font-bold">+{diffSummary.additions}</span> addition{diffSummary.additions !== 1 ? "s" : ""}
              </span>
            )}
            {diffSummary.removals > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5">
                <span className="font-bold">−{diffSummary.removals}</span> removal{diffSummary.removals !== 1 ? "s" : ""}
              </span>
            )}
            {diffSummary.modifications > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-full px-2 py-0.5">
                <span className="font-bold">~{diffSummary.modifications}</span> modification{diffSummary.modifications !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
        {compareId && diffSummary.additions === 0 && diffSummary.removals === 0 && diffSummary.modifications === 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/10 px-3 py-2">
            <span className="text-[10px] text-muted-foreground/60">Versions are identical — no changes detected.</span>
          </div>
        )}

        {/* Search bar (visual mode only) */}
        {viewMode === "visual" && compareId && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter changes…"
              className="w-full h-7 pl-7 pr-7 text-xs bg-muted/30 border border-border/50 rounded-md outline-none focus:ring-1 focus:ring-primary/40"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Ignore formatting (technical mode) */}
        {viewMode === "technical" && (
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <Switch checked={ignoreFormatting} onCheckedChange={setIgnoreFormatting} className="scale-75 origin-left" />
            <span className="text-[11px] text-muted-foreground">Ignore Formatting</span>
          </label>
        )}
      </div>

      {/* Summary chips */}
      {compareId && viewMode === "visual" && (
        <div className="shrink-0 px-5 py-2.5 border-b border-border/40 bg-muted/5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-semibold text-muted-foreground mr-1">
              {totalChanges === 0 ? "No changes detected" : `${totalChanges} change${totalChanges !== 1 ? "s" : ""} detected`}
            </span>
            {COMPARE_SECTIONS.map(section => {
              const count = sectionChangeCounts[section.label] ?? 0;
              return (
                <button
                  key={section.label}
                  type="button"
                  onClick={() => count > 0 && scrollToSection(section.label)}
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                    count > 0
                      ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer"
                      : "border-border/30 bg-transparent text-muted-foreground/40 cursor-default",
                  )}
                >
                  {section.label} {count > 0 && <span className="font-bold">· {count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Body */}
      {!compareId && (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Select a version to compare against
        </div>
      )}

      {compareId && viewMode === "visual" && (
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left section nav (only when there are changed sections) */}
          {changedSections.length > 0 && (
            <div className="w-36 shrink-0 border-r border-border/40 overflow-y-auto py-3 px-2 space-y-0.5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 px-2 mb-2">Sections</p>
              {changedSections.map(section => {
                const count = sectionChangeCounts[section.label] ?? 0;
                return (
                  <button
                    key={section.label}
                    type="button"
                    onClick={() => scrollToSection(section.label)}
                    className="w-full text-left px-2 py-1 rounded-md text-[11px] flex items-center justify-between gap-1 transition-colors text-foreground/80 hover:bg-muted/30"
                  >
                    <span className="truncate">{section.label}</span>
                    <span className="text-[9px] font-bold text-primary shrink-0">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Visual diff content */}
          <div ref={contentRef} className="flex-1 overflow-y-auto p-5 space-y-5">
            {COMPARE_SECTIONS.map(section => {
              const rows = renderVisualSection(section);
              if (rows.length === 0) return null;
              return (
                <div key={section.label} id={`compare-section-${section.label.replace(/\s+/g, "-")}`} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{section.label}</span>
                    <span className="text-[9px] text-primary font-semibold">{rows.length} change{rows.length !== 1 ? "s" : ""}</span>
                  </div>
                  {rows}
                </div>
              );
            })}
            {totalChanges === 0 && !searchQuery && (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
                <Check className="h-8 w-8 text-green-400/60" />
                <p className="text-sm font-medium text-foreground/70">No differences found</p>
                <p className="text-xs text-muted-foreground">These two versions are identical.</p>
              </div>
            )}
            {totalChanges > 0 && searchQuery && COMPARE_SECTIONS.every(s => renderVisualSection(s).length === 0) && (
              <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
                No matches for &ldquo;{searchQuery}&rdquo;
              </div>
            )}
          </div>
        </div>
      )}

      {compareId && viewMode === "technical" && (
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {COMPARE_SECTIONS.map(section => (
            <div key={section.label} id={`compare-section-${section.label.replace(/\s+/g, "-")}`} className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{section.label}</div>
              <div className="rounded-lg border border-border/50 overflow-hidden">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/20">
                      <th className="text-left py-1.5 px-3 font-medium text-[10px] text-muted-foreground w-32">Field</th>
                      {/* Left = old/previous (compareTarget), Right = current (baseVersion) */}
                      <th className="text-left py-1.5 px-3 font-medium text-[10px] w-[38%]">
                        <span className="text-red-400/70">Previous</span>
                        <span className="ml-1.5 text-muted-foreground/50 font-mono font-normal">{compareTarget?.versionNumber ?? "…"}</span>
                      </th>
                      <th className="text-left py-1.5 px-3 font-medium text-[10px] w-[38%]">
                        <span className="text-green-400/70">Current</span>
                        <span className="ml-1.5 text-muted-foreground/50 font-mono font-normal">{baseVersion.versionNumber}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {renderTechnicalDiff(section)}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
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
  selected,
  selectionDisabled,
  onSelect,
}: {
  v: VersionSummary;
  onCompare: () => void;
  onRestore: () => void;
  onArchive?: () => void;
  restorePending: boolean;
  archivePending: boolean;
  showArchiveAction: boolean;
  selected?: boolean;
  selectionDisabled?: boolean;
  onSelect?: (id: number, checked: boolean) => void;
}) {
  const isArchived = v.status === "archived";
  const changedFields = (v as any).changedFields as string[] | null | undefined;

  return (
    <div className={cn(
      "flex items-start gap-4 px-0 py-4 hover:bg-muted/10 transition-colors",
      isArchived && "opacity-60",
      selected && "bg-primary/5",
    )}>
      {/* Compare checkbox */}
      {onSelect && (
        <button
          type="button"
          disabled={selectionDisabled && !selected}
          onClick={() => onSelect(v.id, !selected)}
          className={cn(
            "shrink-0 mt-2 h-4 w-4 rounded border transition-colors flex items-center justify-center",
            selected ? "bg-primary border-primary text-primary-foreground" : "border-border/60 bg-transparent hover:border-primary/60",
            selectionDisabled && !selected && "opacity-30 cursor-not-allowed",
          )}
          title={selected ? "Deselect" : selectionDisabled ? "Max 2 selected" : "Select for compare"}
        >
          {selected && <Check className="h-2.5 w-2.5" />}
        </button>
      )}

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

/* ── Restore preview dialog ──────────────────────────────────────────────────── */

function RestorePreviewDialog({
  restoreTarget,
  restoreSnapshot,
  prodSnapshot,
  hasProductionVersion,
  onCancel,
  onConfirm,
  isPending,
}: {
  restoreTarget: VersionSummary;
  restoreSnapshot: Record<string, unknown> | null;
  prodSnapshot: Record<string, unknown> | null;
  hasProductionVersion: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const renderVal = (v: unknown) => {
    if (v == null) return "—";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  const sectionStatuses = useMemo(() => {
    if (!restoreSnapshot) return [];
    const base = restoreSnapshot;
    const prod = prodSnapshot ?? {};
    return COMPARE_SECTIONS.map(section => {
      const changed = section.keys.some(key => {
        return renderVal(getNestedValue(base, key)) !== renderVal(getNestedValue(prod, key));
      });
      return { label: section.label, changed };
    });
  }, [restoreSnapshot, prodSnapshot]);

  const willChange = sectionStatuses.filter(s => s.changed);
  const noChange = sectionStatuses.filter(s => !s.changed);
  const isLoading = !restoreSnapshot || (hasProductionVersion && !prodSnapshot);

  return (
    <Dialog open onOpenChange={open => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" /> Restore Snapshot Preview
          </DialogTitle>
          <DialogDescription>
            Restoring <strong>{restoreTarget.versionNumber}: {restoreTarget.versionName}</strong> will replace your current draft. Review what will change below.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-green-400 flex items-center gap-1.5">
                <Check className="h-3 w-3" /> Will be restored ({willChange.length})
              </p>
              <div className="space-y-1">
                {willChange.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60 italic">No sections will change</p>
                ) : willChange.map(s => (
                  <div key={s.label} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-green-500/8 border border-green-500/15">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0" />
                    <span className="text-[11px] text-green-300 font-medium">{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1.5">
                <Eye className="h-3 w-3" /> No changes ({noChange.length})
              </p>
              <div className="space-y-1">
                {noChange.map(s => (
                  <div key={s.label} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/10 border border-border/30">
                    <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
                    <span className="text-[11px] text-muted-foreground/50">{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/50 mt-1">Call logs and analytics are not affected.</p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="button" disabled={isPending || !!isLoading} onClick={onConfirm} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            {isPending ? "Restoring…" : "Restore Snapshot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Versions tab ────────────────────────────────────────────────────────────── */

function groupDraftsByDate(drafts: VersionSummary[]): Array<{ label: string; items: VersionSummary[] }> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const fmt = (d: Date) => d.toDateString();

  const groups: Map<string, VersionSummary[]> = new Map();
  for (const v of drafts) {
    const d = new Date(v.createdAt);
    let label: string;
    if (fmt(d) === fmt(today)) label = "Today";
    else if (fmt(d) === fmt(yesterday)) label = "Yesterday";
    else label = format(d, "MMMM d, yyyy");
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(v);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function VersionsTab({ agentId }: { agentId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [activeSubTab, setActiveSubTab] = useState<"published" | "drafts">("published");
  const [compareVersion, setCompareVersion] = useState<AgentVersion | null>(null);
  const [compareInitialId, setCompareInitialId] = useState<number | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<VersionSummary | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<VersionSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VersionSummary | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<Set<number>>(new Set());

  const { data: listData, isLoading } = useListAgentVersions(agentId);
  const versions: VersionSummary[] = listData?.versions ?? [];
  const publishedCount = listData?.publishedCount ?? 0;
  const limit = listData?.limit ?? VERSION_LIMIT;

  const restore = useRestoreAgentVersion();
  const archive = useArchiveAgentVersion();
  const deleteDraft = useDeleteAgentVersion();

  const publishedVersions = versions.filter(v => (v as any).snapshotType !== "draft");
  const draftVersions = [...versions.filter(v => (v as any).snapshotType === "draft")]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const activePublished = publishedVersions.filter(v => v.status !== "archived");
  const archivedVersions = publishedVersions.filter(v => v.status === "archived");
  const productionVersion = publishedVersions.find(v => v.status === "production");

  const draftGroups = groupDraftsByDate(draftVersions);

  const { data: previewRestoreSnap } = useGetAgentVersion(agentId, restoreTarget?.id ?? -1, {
    query: {
      queryKey: getGetAgentVersionQueryKey(agentId, restoreTarget?.id ?? -1),
      enabled: restoreTarget != null,
    },
  });
  const { data: previewProdSnap } = useGetAgentVersion(agentId, productionVersion?.id ?? -1, {
    query: {
      queryKey: getGetAgentVersionQueryKey(agentId, productionVersion?.id ?? -1),
      enabled: productionVersion != null,
    },
  });

  const handleSelectForCompare = (id: number, checked: boolean) => {
    setSelectedForCompare(prev => {
      const next = new Set(prev);
      if (checked) {
        if (next.size < 2) next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleQuickCompare = () => {
    const selectedIds = Array.from(selectedForCompare);
    if (selectedIds.length !== 2) return;
    const vA = versions.find(v => v.id === selectedIds[0]);
    const vB = versions.find(v => v.id === selectedIds[1]);
    if (!vA || !vB) return;
    const newer = (vA.id > vB.id) ? vA : vB;
    const older = (vA.id > vB.id) ? vB : vA;
    setCompareInitialId(older.id);
    setCompareVersion(newer as AgentVersion);
    setSelectedForCompare(new Set());
  };

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

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDraft.mutateAsync({ id: agentId, versionId: deleteTarget.id });
      queryClient.invalidateQueries({ queryKey: getListAgentVersionsQueryKey(agentId) });
      toast({ title: "Draft deleted", description: `${deleteTarget.versionNumber} has been permanently removed.` });
      setDeleteTarget(null);
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message ?? "Unknown error", variant: "destructive" });
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
        initialCompareId={compareInitialId}
        onClose={() => { setCompareVersion(null); setCompareInitialId(null); }}
      />
    );
  }

  const selectedArr = Array.from(selectedForCompare);
  const selectedV1 = versions.find(v => v.id === selectedArr[0]);
  const selectedV2 = versions.find(v => v.id === selectedArr[1]);

  return (
    <div className={cn("flex flex-col gap-4", BUILDER_TAB_PAD)}>
      <BuilderTabHeader
        title="Versions"
        description="Published snapshots you can restore. Drafts are auto-saved history."
        actions={productionVersion ? (
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setRestoreTarget(productionVersion)}>
            <RotateCcw className="h-3 w-3" /> Restore last working
          </Button>
        ) : undefined}
      />

      <div className="inline-flex flex-wrap items-center gap-1 self-start rounded-lg border border-border bg-card p-1">
        <button
          type="button"
          onClick={() => setActiveSubTab("published")}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[11.5px] font-medium transition-all",
            activeSubTab === "published"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Published
          <Badge variant="outline" className={cn("h-4 px-1 text-[10px]", activeSubTab === "published" && "border-background/30 text-background")}>{activePublished.length}</Badge>
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("drafts")}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[11.5px] font-medium transition-all",
            activeSubTab === "drafts"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Drafts
          <Badge variant="outline" className={cn("h-4 px-1 text-[10px]", activeSubTab === "drafts" && "border-background/30 text-background")}>{draftVersions.length}</Badge>
        </button>
      </div>

      {/* Published Versions sub-tab */}
      {activeSubTab === "published" && (
        <>
          {/* Usage indicator */}
          {!isLoading && publishedVersions.length > 0 && (
            <div className="space-y-2">
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
            <div className="mt-1 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3.5 py-2.5">
              <Info className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-400/90 leading-relaxed">
                <strong>Approaching limit:</strong> You have {publishedCount} of {limit} published versions used. Consider archiving older versions to keep publishing new ones.
              </p>
            </div>
          )}
          <div>
            {isLoading && (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!isLoading && publishedVersions.length === 0 && (
              <div className="flex flex-col items-center justify-center h-60 gap-3 text-center px-6">
                <div className="h-12 w-12 rounded-xl bg-muted/30 border border-border/50 flex items-center justify-center">
                  <History className="h-6 w-6 text-muted-foreground/40" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">No published versions yet</p>
                  <p className="text-xs text-muted-foreground">Click <strong>Publish</strong> in the toolbar to create your first stable snapshot.</p>
                </div>
              </div>
            )}
            {!isLoading && activePublished.length > 0 && (
              <div className="divide-y divide-border/40">
                {activePublished.map((v) => (
                  <VersionCard
                    key={v.id}
                    v={v}
                    onCompare={() => { setCompareInitialId(null); setCompareVersion(v as AgentVersion); }}
                    onRestore={() => setRestoreTarget(v)}
                    onArchive={() => setArchiveTarget(v)}
                    restorePending={restore.isPending}
                    archivePending={archive.isPending}
                    showArchiveAction={v.status !== "production"}
                    selected={selectedForCompare.has(v.id)}
                    selectionDisabled={selectedForCompare.size >= 2}
                    onSelect={handleSelectForCompare}
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
                  className="flex w-full items-center gap-2 border-t border-border/40 py-2.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/10 hover:text-foreground"
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
                        onCompare={() => { setCompareInitialId(null); setCompareVersion(v as AgentVersion); }}
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
        </>
      )}

      {/* Draft History sub-tab */}
      {activeSubTab === "drafts" && (
        <div>
          {isLoading && (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && draftVersions.length === 0 && (
            <div className="flex flex-col items-center justify-center h-60 gap-3 text-center px-6">
              <div className="h-12 w-12 rounded-xl bg-muted/30 border border-border/50 flex items-center justify-center">
                <GitBranch className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">No draft history yet</p>
                <p className="text-xs text-muted-foreground">Every time you save the agent, a draft snapshot is automatically created here.</p>
              </div>
            </div>
          )}
          {!isLoading && draftGroups.map(({ label, items }) => (
            <div key={label} className="mb-1">
              <div className="border-y border-border/30 bg-muted/10 px-0 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                {label}
              </div>
              <div className="divide-y divide-border/30">
                {items.map((v) => (
                  <div key={v.id} className="flex items-center gap-3 px-0 py-3 hover:bg-muted/10 transition-colors">
                    <div className="shrink-0 text-[10px] font-mono text-muted-foreground/60 w-10 text-right">
                      {format(new Date(v.createdAt), "HH:mm")}
                    </div>
                    <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium truncate">{v.versionName}</span>
                      {(v as any).changedFields && ((v as any).changedFields as string[]).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {((v as any).changedFields as string[]).slice(0, 3).map((label: string) => (
                            <span key={label} className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {label}
                            </span>
                          ))}
                          {((v as any).changedFields as string[]).length > 3 && (
                            <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              +{((v as any).changedFields as string[]).length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button" variant="ghost" size="sm"
                        className="h-6 text-[11px] gap-1 text-muted-foreground hover:text-foreground px-2"
                        onClick={() => setCompareVersion(v as AgentVersion)}
                      >
                        <ArrowLeftRight className="h-3 w-3" /> Compare
                      </Button>
                      <Button
                        type="button" variant="ghost" size="sm"
                        className="h-6 text-[11px] gap-1 text-muted-foreground hover:text-foreground px-2"
                        onClick={() => setRestoreTarget(v)}
                        disabled={restore.isPending}
                      >
                        <RotateCcw className="h-3 w-3" /> Restore
                      </Button>
                      <Button
                        type="button" variant="ghost" size="sm"
                        className="h-6 text-[11px] gap-1 text-muted-foreground hover:text-destructive px-2"
                        onClick={() => setDeleteTarget(v)}
                        disabled={deleteDraft.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!isLoading && draftVersions.length > 0 && (
            <p className="text-[10px] text-muted-foreground/40 text-center py-3 px-5">
              Up to 100 drafts kept · oldest auto-deleted when limit is reached
            </p>
          )}
        </div>
      )}

      {/* Quick compare sticky bar */}
      {selectedForCompare.size === 2 && selectedV1 && selectedV2 && (
        <div className="flex shrink-0 items-center gap-3 border-t border-primary/30 bg-primary/5 px-0 py-3">
          <ArrowLeftRight className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs text-foreground/80 flex-1 truncate">
            Compare <strong>{selectedV1.versionNumber}</strong> vs <strong>{selectedV2.versionNumber}</strong>
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setSelectedForCompare(new Set())}>
            <X className="h-3 w-3 mr-1" /> Clear
          </Button>
          <Button type="button" size="sm" className="h-7 text-xs gap-1.5" onClick={handleQuickCompare}>
            <ArrowLeftRight className="h-3 w-3" /> Compare
          </Button>
        </div>
      )}

      {/* Restore preview dialog */}
      {restoreTarget && (
        <RestorePreviewDialog
          restoreTarget={restoreTarget}
          restoreSnapshot={previewRestoreSnap ? (previewRestoreSnap.snapshot as Record<string, unknown>) : null}
          prodSnapshot={previewProdSnap ? (previewProdSnap.snapshot as Record<string, unknown>) : null}
          hasProductionVersion={productionVersion != null}
          onCancel={() => setRestoreTarget(null)}
          onConfirm={handleConfirmRestore}
          isPending={restore.isPending}
        />
      )}

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

      {/* Delete draft confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" /> Delete Draft Snapshot
            </DialogTitle>
            <DialogDescription>
              Permanently delete draft <strong>{deleteTarget?.versionNumber}</strong> ({deleteTarget?.versionName})? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={deleteDraft.isPending} onClick={handleConfirmDelete} className="gap-1.5">
              <Trash2 className="h-3.5 w-3.5" />
              {deleteDraft.isPending ? "Deleting…" : "Delete Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Agent editor panel ─────────────────────────────────────────────────────── */

export function AgentEditorPanel({ agentId, onOpenAgents, embedded }: { agentId: number; onOpenAgents?: () => void; embedded?: boolean }) {
  const [, navigate] = useLocation();
  const { isManagedWorkspace } = usePartnerManagedWorkspace();
  const search = useSearch();
  const [activeTab, setActiveTab] = useState<TabId>(() => sectionFromSearch(search));
  const tabContentRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Partial<Record<TabId, number>>>({});
  const agentResetSigRef = useRef<string | null>(null);

  useEffect(() => {
    setActiveTab(sectionFromSearch(search));
  }, [agentId, search]);

  const handleTabClick = (tabId: TabId) => {
    if (tabContentRef.current) {
      scrollPositions.current[activeTab] = tabContentRef.current.scrollTop;
    }
    setActiveTab(tabId);
    const next = new URL(window.location.href);
    next.searchParams.set("section", tabId);
    window.history.replaceState(window.history.state, "", `${next.pathname}${next.search}${next.hash}`);
  };

  useEffect(() => {
    const el = tabContentRef.current;
    if (!el) return;
    const saved = scrollPositions.current[activeTab] ?? 0;
    el.scrollTop = saved;
  }, [activeTab]);

  const [callDialog, setCallDialog] = useState(false);
  const [callNumber, setCallNumber] = useState("");
  const [otpOpen, setOtpOpen] = useState(false);
  const [pendingNumber, setPendingNumber] = useState("");
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const rateMap = useMinuteRatesMap();

  // Auto-open webcall when navigated from the guided wizard (?webcall=1)
  const _autoWebcall = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("webcall") === "1";
  }, []);
  const { recentNumbers, recordNumber, removeNumber } = useRecentNumbers();

  const { data: agent, isLoading } = useGetAgent(agentId, {
    query: { queryKey: getGetAgentQueryKey(agentId) },
  });

  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();
  const initiateOutbound = useInitiateOutboundCall();
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "pending" | "saving" | "saved" | "invalid" | "error">("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveHandlerRef = useRef<(() => Promise<void>) | null>(null);
  const autoSaveRequestRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const suppressAutoSaveRef = useRef(false);
  const editRevisionRef = useRef(0);

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: "", description: "", asrProvider: "sarvam", asrModel: "saaras:v3",
      llmProvider: "sarvam", llmModel: "sarvam-105b-conversations", ttsProvider: "cartesia",
      ttsVoice: DEFAULT_CARTESIA_VOICE_ID, ttsModel: "sonic-3.5", telephonyProvider: "vobiz",
      systemPrompt: "", temperature: 0.40, maxDuration: 480,
      greetingMessage: "Hello", firstSpeaker: "assistant", endCallPhrases: "", silenceTimeoutSeconds: 30,
      language: "en-IN", asrLanguage: "", backchannelingEnabled: true,
      backchannelingFrequency: 0.5, webhookUrl: "",
      webhookSecret: "", webhookPayloadTemplate: "", noiseCancellationEnabled: true,
      forceSoftwareNoiseGate: false,
      ambientNoiseEnabled: false, ambientNoiseTrack: "", ambientNoiseVolume: 1.0, promptVariables: [],
      vadSilenceMs: 350, bargeInEnabled: true, bargeInEnergyThreshold: 1800,
      bargeInMinFrames: 4, micSensitivity: "low", timezone: "", machineDetectionMode: "disabled",
      voicemailAction: "hangup",
      voicemailMessage: "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      voicemailLeadInSeconds: 2,
      tools: [], genderDetectionEnabled: false, voiceMemoryEnabled: false, recordingEnabled: true, languageAutoDetect: false,
      multilingualLanguages: [], sarvamIndicNumbers: true,
      autoSwitchToEnglish: false,
      startSpeakingWaitSecs: 0, startSpeakingOnPunctuationSecs: 0,
      startSpeakingOnNoPunctuationSecs: 0, startSpeakingOnNumberSecs: 0,
      stopSpeakingNumWords: 1, stopSpeakingVoiceSecs: 0.2, stopSpeakingBackOffSecs: 1,
      complianceIrdai: false, complianceDpdp: false, complianceTrai: false,
      knowledgeSourceIds: [],
      contextWindowTurns: undefined,
      summarizationEnabled: false,
      stagedPromptEnabled: false,
      stagedPromptStages: [],
      stagedPromptCoreIdentity: "",
      inboundPhoneNumberId: undefined,
      outboundPhoneNumberId: undefined,
      preferredManagedNumber: null,
      asrEndpointingSilenceMs: 150,
      llmMaxTokens: 500,
      ttsMinSentenceChars: 5,
      ttsSpeed: 1,
      linearDelayMs: 0,
      fragmentCoalesceListeningMs: 0,
      fragmentCoalescePlayingMs: 0,
      telephonyTailDrainMs: 400,
      sarvamHighVadSensitivity: true,
      sarvamSttStreamType: "fast",
      sarvamSttPrompt: "",
      sarvamEndOfSpeechSilenceMs: 300,
      sarvamFirstTurnMinSpeechMs: 200,
      sarvamVadThreshold: 0.3,
      sarvamSpeechEndFlushMs: 0,
      sarvamIncompleteHoldMs: 0,
      semanticTurnStopMs: 800,
      kbBakedOnly: false,
      autoRedialEnabled: true,
      autoRedialMaxAttempts: 3,
      schedulingCalendarId: null,
      schedulingEventTypeId: null,
      voiceStack: "classic",
      geminiLiveVoiceName: "Kore",
      geminiLiveThinkingLevel: "minimal",
      agentComposition: "single",
      agentSurfaces: "phone",
      meetingPrompt: "",
      meetingMaxDurationSeconds: 45 * 60,
      meetingSilenceTimeoutSeconds: 3 * 60,
      meetingSilenceHangupEnabled: true,
    },
  });

  const preferredManagedWatch = form.watch("preferredManagedNumber");
  const { data: managedPhoneData } = useQuery({
    queryKey: ["phone-numbers", "managed"],
    queryFn: () => customFetch<{ numbers: string[] }>(`${DASH_API}/phone-numbers/managed`),
    staleTime: 5 * 60 * 1000,
  });
  // Agent's own assigned number (phone_numbers.agentId) — the backend dials
  // from it when set (agent.outboundPhoneNumberId), so the dialog must show it
  // instead of the trial caller ID.
  const { data: builderPhoneNumbersRaw } = useListPhoneNumbers({
    query: { queryKey: getListPhoneNumbersQueryKey(), staleTime: 60_000 },
  });
  const assignedOutboundNumber = (() => {
    const list = Array.isArray(builderPhoneNumbersRaw) ? builderPhoneNumbersRaw : [];
    return list.find((p) => p.agentId === agentId)?.number ?? null;
  })();
  const outboundTestingFrom =
    (typeof preferredManagedWatch === "string" && preferredManagedWatch.trim())
      ? preferredManagedWatch.trim()
      : (managedPhoneData?.numbers?.[0] ?? null);

  // BYO telephony (own Plivo/Twilio account): calls go out from the user's own
  // saved fromNumber, so the dialog must show that instead of the trial caller ID.
  const telephonyProviderWatch = form.watch("telephonyProvider");
  const { data: byoProviderKeys } = useListProviders({ query: { queryKey: getListProvidersQueryKey(), staleTime: 60_000 } });
  const byoOutboundFrom = (() => {
    if (telephonyProviderWatch !== "plivo" && telephonyProviderWatch !== "twilio") return null;
    const row = (byoProviderKeys ?? []).find((p) => p.providerType === "telephony" && p.providerName === telephonyProviderWatch && p.isActive);
    if (!row) return null;
    try { return (JSON.parse(row.extraConfig ?? "{}") as Record<string, string>)["fromNumber"] ?? null; } catch { return null; }
  })();

  useEffect(() => {
    if (!agent) return;
    // Only reset when the agent's DATA actually changes (id + server updatedAt),
    // not on every render. `agent` from useGetAgent can be a fresh object
    // reference across renders; a bare `[agent]` dep made form.reset() run every
    // render → re-render → loop (React #185 "Maximum update depth exceeded").
    const resetSig = `${agent.id}:${(agent as any).updatedAt ?? ""}`;
    if (agentResetSigRef.current === resetSig) return;
    agentResetSigRef.current = resetSig;
    const sarvamVad = hydrateSarvamRealtimeVad((agent as any).agentConfig ?? {});
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
      temperature:              agent.temperature ?? 0.40,
      maxDuration:              agent.maxDuration ?? 300,
      greetingMessage:          agent.greetingMessage ?? "Hello",
      firstSpeaker:             ((agent as any).firstSpeaker === "user" ? "user" : "assistant") as AgentFormValues["firstSpeaker"],
      endCallPhrases:           agent.endCallPhrases ?? "",
      silenceTimeoutSeconds:    agent.silenceTimeoutSeconds ?? 30,
      language:                 agent.language ?? "en-IN",
      asrLanguage:              agent.asrLanguage ?? "",
      backchannelingEnabled:    agent.backchannelingEnabled ?? true,
      backchannelingFrequency:  agent.backchannelingFrequency ?? 0.5,
      webhookUrl:               (agent.webhookUrl && agent.webhookUrl.startsWith("https://")) ? agent.webhookUrl : "",
      webhookSecret:            (agent as any).agentConfig?.webhookSecret ?? "",
      webhookPayloadTemplate:   typeof (agent as any).agentConfig?.webhookPayloadTemplate === "string"
        ? (agent as any).agentConfig.webhookPayloadTemplate
        : "",
      noiseCancellationEnabled: agent.noiseCancellationEnabled ?? true,
      forceSoftwareNoiseGate:   (agent as any).agentConfig?.forceSoftwareNoiseGate ?? false,
      ambientNoiseEnabled:      (agent as any).agentConfig?.ambientNoiseEnabled ?? false,
      ambientNoiseTrack:        (agent as any).agentConfig?.ambientNoiseTrack ?? "",
      ambientNoiseVolume:       (agent as any).agentConfig?.ambientNoiseVolume ?? 1.0,
      promptVariables:          ((agent as any).agentConfig?.promptVariables ?? []) as AgentFormValues["promptVariables"],
      vadSilenceMs:             (agent as any).agentConfig?.vadSilenceMs ?? 350,
      bargeInEnabled:           (agent as any).agentConfig?.bargeInEnabled ?? true,
      bargeInEnergyThreshold:   clampBargeInEnergyThreshold((agent as any).agentConfig?.bargeInEnergyThreshold ?? 1800),
      bargeInMinFrames:         (agent as any).agentConfig?.bargeInMinFrames ?? 4,
      micSensitivity:           ((agent as any).agentConfig?.micSensitivity ?? "low") as AgentFormValues["micSensitivity"],
      timezone:                 (agent as any).agentConfig?.timezone ?? "",
      machineDetectionMode:     ((agent as any).agentConfig?.machineDetectionMode ?? "disabled") as AgentFormValues["machineDetectionMode"],
      voicemailAction:          ((agent as any).agentConfig?.voicemailAction ?? "hangup") as AgentFormValues["voicemailAction"],
      voicemailMessage:         (agent as any).agentConfig?.voicemailMessage ?? "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      voicemailLeadInSeconds:   (agent as any).agentConfig?.voicemailLeadInSeconds ?? 2,
      tools:                    hydrateToolsForForm(agent.tools ?? []),
      genderDetectionEnabled:   (agent as any).agentConfig?.genderDetectionEnabled ?? false,
      voiceMemoryEnabled:       (agent as any).agentConfig?.voiceMemoryEnabled ?? false,
      recordingEnabled:         (agent as any).agentConfig?.recordingEnabled ?? false,
      languageAutoDetect:       (agent as any).agentConfig?.languageAutoDetect ?? false,
      multilingualLanguages:    (agent as any).agentConfig?.multilingualLanguages
        ?? (agent as any).agentConfig?.secondaryLanguages
        ?? [],
      sarvamIndicNumbers:       (agent as any).agentConfig?.sarvamIndicNumbers !== false,
      autoSwitchToEnglish:      (agent as any).agentConfig?.autoSwitchToEnglish ?? false,
      startSpeakingWaitSecs:            (agent as any).agentConfig?.startSpeakingPlan?.waitSeconds            ?? 0,
      startSpeakingOnPunctuationSecs:   (agent as any).agentConfig?.startSpeakingPlan?.onPunctuationSeconds   ?? 0,
      startSpeakingOnNoPunctuationSecs: (agent as any).agentConfig?.startSpeakingPlan?.onNoPunctuationSeconds ?? 0,
      startSpeakingOnNumberSecs:        (agent as any).agentConfig?.startSpeakingPlan?.onNumberSeconds        ?? 0,
      stopSpeakingNumWords: (() => {
        const fromWords = (agent as any).agentConfig?.wordsForInterruption;
        const fromPlan = (agent as any).agentConfig?.stopSpeakingPlan?.numWords;
        return clampInterruptWords(fromWords ?? fromPlan ?? 3);
      })(),
      stopSpeakingVoiceSecs: (() => {
        const words = clampInterruptWords(
          (agent as any).agentConfig?.wordsForInterruption
            ?? (agent as any).agentConfig?.stopSpeakingPlan?.numWords
            ?? 3,
        );
        return voiceSecondsFromInterruptWords(words);
      })(),
      stopSpeakingBackOffSecs: (agent as any).agentConfig?.stopSpeakingPlan?.backOffSeconds ?? 1,
      complianceIrdai: (agent as any).agentConfig?.compliance?.irdai ?? false,
      complianceDpdp:  (agent as any).agentConfig?.compliance?.dpdp  ?? false,
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
      asrEndpointingSilenceMs:         clampEndpointingMs((agent as any).agentConfig?.asrEndpointingSilenceMs ?? 250),
      llmMaxTokens:                    (agent as any).agentConfig?.llmMaxTokens ?? null,
      ttsMinSentenceChars:             (agent as any).agentConfig?.ttsMinSentenceChars ?? 5,
      ttsSpeed:                        (agent as any).agentConfig?.ttsSpeed ?? 1,
      linearDelayMs:                   clampLinearDelayMs((agent as any).agentConfig?.incrementalDelay ?? 0),
      fragmentCoalesceListeningMs:     clampFragmentCoalesceListeningMs((agent as any).agentConfig?.fragmentCoalesceListeningMs),
      fragmentCoalescePlayingMs:       clampFragmentCoalescePlayingMs((agent as any).agentConfig?.fragmentCoalescePlayingMs),
      telephonyTailDrainMs:            clampTelephonyTailDrainMs((agent as any).agentConfig?.telephonyTailDrainMs),
      sarvamHighVadSensitivity:        ((agent as any).agentConfig?.sarvamHighVadSensitivity as boolean | undefined) !== false,
      sarvamSpeechEndFlushMs:          0,
      sarvamIncompleteHoldMs:          0,
      semanticTurnStopMs:              clampSemanticTurnStopMs((agent as any).agentConfig?.semanticTurnStopMs),
      kbBakedOnly:                     ((agent as any).agentConfig?.kbBakedOnly as boolean | undefined) ?? false,
      autoRedialEnabled:      (agent as any).agentConfig?.autoRedial?.enabled ?? false,
      autoRedialMaxAttempts:  (agent as any).agentConfig?.autoRedial?.maxAttempts  ?? 3,
      sarvamSttMode:          ((agent as any).agentConfig?.sarvamSttMode as AgentFormValues["sarvamSttMode"]) ?? undefined,
      sarvamSttStreamType:    ((agent as any).agentConfig?.sarvamSttStreamType as AgentFormValues["sarvamSttStreamType"]) ?? "fast",
      sarvamSttPrompt:        typeof (agent as any).agentConfig?.sarvamSttPrompt === "string"
        ? (agent as any).agentConfig.sarvamSttPrompt
        : "",
      sarvamEndOfSpeechSilenceMs: sarvamVad.silence,
      sarvamFirstTurnMinSpeechMs: sarvamVad.minSpeech,
      sarvamVadThreshold:         sarvamVad.threshold,
      schedulingCalendarId:   normalizeSchedulingId((agent as any).agentConfig?.calendarCapability?.defaultCalendarId),
      schedulingEventTypeId:  normalizeSchedulingId((agent as any).agentConfig?.calendarCapability?.defaultEventTypeId),
      voiceStack:               (((agent as any).agentConfig?.voiceStack as string | undefined) === "gemini_live" ? "gemini_live" : "classic") as AgentFormValues["voiceStack"],
      geminiLiveVoiceName:      ((agent as any).agentConfig?.geminiLive?.voiceName as string | undefined) ?? "Kore",
      geminiLiveThinkingLevel:  ((agent as any).agentConfig?.geminiLive?.thinkingLevel as AgentFormValues["geminiLiveThinkingLevel"] | undefined) ?? "minimal",
      agentComposition: "single",
      agentSurfaces: ((agent as any).agentConfig?.meetings?.enabled === true ? "phone_and_meet" : "phone") as AgentFormValues["agentSurfaces"],
      meetingPrompt: typeof (agent as any).agentConfig?.meetings?.meetingPrompt === "string"
        ? (agent as any).agentConfig.meetings.meetingPrompt
        : "",
      meetingMaxDurationSeconds:
        typeof (agent as any).agentConfig?.meetings?.maxDurationSeconds === "number"
          ? (agent as any).agentConfig.meetings.maxDurationSeconds
          : 45 * 60,
      meetingSilenceTimeoutSeconds:
        typeof (agent as any).agentConfig?.meetings?.silenceTimeoutSeconds === "number"
          ? (agent as any).agentConfig.meetings.silenceTimeoutSeconds
          : 3 * 60,
      meetingSilenceHangupEnabled:
        (agent as any).agentConfig?.meetings?.silenceHangupEnabled !== false,
    });
    if ((agent as any).agentConfig?.voiceStack === "gemini_live") {
      form.setValue("llmProvider", "google");
      form.setValue("llmModel", GEMINI_LIVE_LLM_MODEL);
    }
    if (agent.webhookUrl && !agent.webhookUrl.startsWith("https://")) {
      form.setError("webhookUrl", {
        type: "server",
        message: "This URL must be updated to https:// before saving.",
      });
    }
  }, [agent]);

  const onSave = form.handleSubmit(
    async (data) => {
      const isAutoSave = autoSaveRequestRef.current;
      const revisionAtStart = editRevisionRef.current;
      saveInFlightRef.current = true;
      if (isAutoSave) setAutoSaveStatus("saving");
      try {
        const payload = buildUpdateAgentPayload(data);
        const saved = await updateAgent.mutateAsync({ id: agentId, data: payload as any });
        suppressAutoSaveRef.current = true;
        form.setValue("languageAutoDetect", (saved as any)?.agentConfig?.languageAutoDetect ?? false, { shouldDirty: false });
        form.setValue(
          "multilingualLanguages",
          (saved as any)?.agentConfig?.multilingualLanguages
            ?? (saved as any)?.agentConfig?.secondaryLanguages
            ?? [],
          { shouldDirty: false },
        );
        form.setValue("sarvamIndicNumbers", (saved as any)?.agentConfig?.sarvamIndicNumbers !== false, { shouldDirty: false });
        // Sync scheduling fields immediately from the save response so the event-type
        // Select is not shown as "Any event type" while the background refetch is in-flight.
        const savedCal = normalizeSchedulingId((saved as any)?.agentConfig?.calendarCapability?.defaultCalendarId);
        const savedEt = normalizeSchedulingId((saved as any)?.agentConfig?.calendarCapability?.defaultEventTypeId);
        if (savedCal != null) form.setValue("schedulingCalendarId", savedCal, { shouldDirty: false });
        if (savedEt != null) form.setValue("schedulingEventTypeId", savedEt, { shouldDirty: false });
        const hasNewerEdits = editRevisionRef.current !== revisionAtStart;
        if (!hasNewerEdits) {
          form.reset(form.getValues(), { keepErrors: true });
          queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
        }
        suppressAutoSaveRef.current = false;
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        if (isAutoSave) {
          setAutoSaveStatus(hasNewerEdits ? "pending" : "saved");
        } else {
          toast({ title: "Saved", description: `${data.name} updated.` });
        }
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2500);
      } catch (err) {
        suppressAutoSaveRef.current = false;
        if (isAutoSave) setAutoSaveStatus("error");
        const mapped = mapApiErrors(err);
        if (Object.keys(mapped).length > 0) { Object.entries(mapped).forEach(([k, v]) => form.setError(k as any, { message: v })); }
        toast({ title: isAutoSave ? "Auto-save failed" : "Error", description: formatApiError(err), variant: "destructive" });
      } finally {
        saveInFlightRef.current = false;
      }
    },
    (errors) => {
      if (autoSaveRequestRef.current) {
        setAutoSaveStatus("invalid");
        return;
      }
      const fieldTabMap: Record<string, TabId> = {
        webhookUrl:               "settings",
        webhookSecret:            "settings",
        webhookPayloadTemplate:   "settings",
        schedulingCalendarId:     "tools",
        schedulingEventTypeId:    "tools",
        noiseCancellationEnabled: "voice",
        ambientNoiseEnabled:      "voice",
        ambientNoiseTrack:        "voice",
        ambientNoiseVolume:       "voice",
        asrEndpointingSilenceMs:  "voice",
        linearDelayMs:            "voice",
        fragmentCoalesceListeningMs: "voice",
        fragmentCoalescePlayingMs:   "voice",
        telephonyTailDrainMs:        "voice",
        sarvamHighVadSensitivity:    "voice",
        sarvamEndOfSpeechSilenceMs:  "voice",
        sarvamFirstTurnMinSpeechMs:  "voice",
        sarvamVadThreshold:          "voice",
        sarvamSpeechEndFlushMs:      "voice",
        sarvamIncompleteHoldMs:      "voice",
        stopSpeakingNumWords:     "voice",
        vadSilenceMs:             "settings",
        bargeInEnabled:           "settings",
        bargeInEnergyThreshold:   "settings",
        bargeInMinFrames:         "settings",
        micSensitivity:           "settings",
        timezone:                 "prompt",
        autoRedialEnabled:        "settings",
        autoRedialMaxAttempts:    "settings",
        summarizationEnabled:     "tools",
        machineDetectionMode:     "outcomes",
        voicemailAction:          "outcomes",
        voicemailMessage:         "outcomes",
        voicemailLeadInSeconds:   "outcomes",
        systemPrompt:             "prompt",
        meetingPrompt:            "prompt",
        temperature:              "prompt",
        greetingMessage:          "overview",
        name:                     "overview",
        asrProvider:              "voice",
        ttsProvider:              "voice",
        llmProvider:              "overview",
        tools:                    "tools",
      };
      const firstFieldName = Object.keys(errors)[0];
      const targetTab = firstFieldName ? (fieldTabMap[firstFieldName] ?? null) : null;
      if (targetTab) handleTabClick(targetTab);
      const firstError = Object.values(errors)[0];
      const msg = firstError && typeof firstError === "object" && "message" in firstError
        ? String((firstError as any).message)
        : "Please fix the highlighted fields before saving.";
      const tabLabel = targetTab ? ` (${targetTab.charAt(0).toUpperCase() + targetTab.slice(1)} tab)` : "";
      toast({ title: "Validation error", description: `${msg}${tabLabel}`, variant: "destructive" });
    }
  );

  autoSaveHandlerRef.current = async () => {
    autoSaveRequestRef.current = true;
    try {
      await onSave();
    } finally {
      autoSaveRequestRef.current = false;
    }
  };

  useEffect(() => {
    const runAutoSave = async () => {
      if (saveInFlightRef.current) {
        autoSaveTimerRef.current = setTimeout(runAutoSave, 300);
        return;
      }
      await autoSaveHandlerRef.current?.();
    };
    const subscription = form.watch(() => {
      if (suppressAutoSaveRef.current) return;
      queueMicrotask(() => {
        if (!form.formState.isDirty) return;
        editRevisionRef.current += 1;
        setAutoSaveStatus("pending");
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(runAutoSave, 1200);
      });
    });
    return () => {
      subscription.unsubscribe();
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [form]);

  const handleDelete = async () => {
    const agentName = form.getValues("name") || "this agent";
    if (!confirm(`Delete "${agentName}"? This cannot be undone.`)) return;
    try {
      await deleteAgent.mutateAsync({ id: agentId });
      try { localStorage.removeItem(LAST_AGENT_ID_KEY); } catch {}
      await queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      const nextList = (queryClient.getQueryData(getListAgentsQueryKey()) as any[])?.filter(a => a.id !== agentId) || [];
      if (embedded) {
        navigate("/app/vibe", { replace: true });
      } else if (nextList.length > 0) {
        navigate(`/app/agents/${nextList[0].id}`, { replace: true });
      } else {
        navigate("/app/agents", { replace: true });
      }
      toast({ title: "Agent deleted", description: `"${agentName}" has been deleted.` });
    } catch (err) {
      toast({ title: "Delete failed", description: formatApiError(err), variant: "destructive" });
    }
  };

  const handleOutbound = (e: React.FormEvent) => {
    e.preventDefault();
    if (!callNumber.trim()) return;
    recordNumber(callNumber);
    initiateOutbound.mutate(
      { data: { agentId, toNumber: callNumber } } as any,
      {
        onSuccess: () => {
          setCallDialog(false);
          setCallNumber("");
          toast({ title: "Calling…" });
          queryClient.invalidateQueries({ queryKey: ["phone-numbers", "managed-quota"] });
        },
        onError: (err: any) => {
          if (isDestinationUnverifiedError(err)) {
            setPendingNumber(callNumber); setCallDialog(false); setOtpOpen(true);
            return;
          }
          const code = err?.data?.code ?? err?.body?.code;
          if (code === "MANAGED_OUTBOUND_LIMIT") {
            setCallDialog(false);
            toast({
              title: "Trial calls used up",
              description: formatApiError(err),
              variant: "destructive",
            });
            navigate("/app/phone-numbers");
            return;
          }
          toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
        },
      }
    );
  };

  const [showWebcall, setShowWebcall] = useState(() => _autoWebcall);
  const [savedFlash, setSavedFlash] = useState(false);
  const isDirty   = form.formState.isDirty;

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [isDirty]);

  const watchedName = form.watch("name") as string | undefined;
  useEffect(() => {
    const label = (watchedName ?? agent?.name)?.trim();
    const product = hostProductName();
    document.title = label ? `${label} · Agent · ${product}` : `Agent · ${product}`;
    return () => {
      document.title = product;
    };
  }, [watchedName, agent?.name]);

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const handleRenameSave = () => {
    form.setValue("name", renameValue, { shouldDirty: true });
    setRenameDialogOpen(false);
    void onSave();
  };

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
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {/* Single toolbar — agent identity + actions */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-5 sm:h-16 sm:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          {!embedded && onOpenAgents && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-border/80 px-2.5 text-[11px]"
              onClick={onOpenAgents}
            >
              <List className="size-3.5" />
              <span className="hidden sm:inline">Agents</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </Button>
          )}
          {!embedded && onOpenAgents && <div className="h-4 w-px shrink-0 bg-border/80" />}
          <button
            type="button"
            onClick={() => { setRenameValue(agent.name ?? ""); setRenameDialogOpen(true); }}
            className="group inline-flex min-w-0 max-w-[min(420px,52vw)] items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left shadow-sm hover:border-foreground/25 hover:bg-muted/40"
            title="Rename agent"
          >
            <span className="truncate text-[15px] sm:text-[16px] font-semibold tracking-[-0.03em] text-foreground leading-tight">
              {agent.name}
            </span>
            <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-70 group-hover:opacity-100" />
          </button>
          {agent.id != null && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(String(agent.id));
                toast({ title: "Copied Agent ID", description: `Agent #${agent.id} copied to clipboard.` });
              }}
              className="group inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/40 px-2 py-1 text-[11px] font-mono text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground"
              title="Click to copy Agent ID"
            >
              <span className="text-[9px] font-sans font-semibold uppercase tracking-wider text-muted-foreground/70">ID</span>
              <span className="font-semibold text-foreground">#{agent.id}</span>
              <Copy className="size-2.5 opacity-50 group-hover:opacity-100" />
            </button>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
            <StatusDot tone={agent.status === "active" ? "success" : "neutral"} />
            {agent.status === "active" ? "Live" : "Draft"}
          </span>
          {isDirty && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {autoSaveStatus === "saving"
                ? "Auto-saving…"
                : autoSaveStatus === "invalid"
                  ? "Fix errors to save"
                  : autoSaveStatus === "error"
                    ? "Auto-save failed"
                    : "Auto-save pending"}
            </span>
          )}
          {!isDirty && autoSaveStatus === "saved" && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
              Auto-saved
            </span>
          )}
          <BuilderPipelineStatus form={form} />
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <AgentCostSummary form={form} rateMap={rateMap} variant="chip" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="hidden h-8 gap-1.5 px-2.5 text-[11px] sm:inline-flex"
            onClick={() => setCallDialog(true)}
          >
            <Phone className="size-3.5" />
            Call
          </Button>
          <Button
            type="button"
            size="sm"
            variant={showWebcall ? "default" : "outline"}
            className="hidden h-8 gap-1.5 px-2.5 text-[11px] sm:inline-flex"
            onClick={() => setShowWebcall((v) => !v)}
          >
            <Play className="size-3.5" />
            {showWebcall ? "Close test" : "Live test"}
          </Button>
          <Button
            type="button"
            size="sm"
            className={cn("h-8 gap-1.5 px-3.5 text-[11px] font-medium", savedFlash && "bg-emerald-600 text-white hover:bg-emerald-600")}
            onClick={onSave}
            disabled={updateAgent.isPending}
          >
            {savedFlash ? <Check className="size-3.5" /> : <Save className="size-3.5" />}
            {updateAgent.isPending ? "Saving…" : savedFlash ? "Saved" : "Save now"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon" variant="ghost" className="size-8">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="sm:hidden" onClick={() => setCallDialog(true)}>
                <Phone className="mr-2 size-3.5" /> Phone test
              </DropdownMenuItem>
              <DropdownMenuItem className="sm:hidden" onClick={() => setShowWebcall((v) => !v)}>
                <Mic className="mr-2 size-3.5" /> Live test
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                if (isDirty) {
                  toast({
                    title: "Save changes first",
                    description: "Publish snapshots the saved agent configuration.",
                    variant: "destructive",
                  });
                  return;
                }
                setPublishModalOpen(true);
              }}>
                <Upload className="mr-2 size-3.5" /> Publish version
              </DropdownMenuItem>
              {!isManagedWorkspace && !embedded && (
              <DropdownMenuItem onClick={() => navigate(`/app/vibe?refine=${agentId}`)}>
                <Sparkles className="mr-2 size-3.5" /> Refine with AI
              </DropdownMenuItem>
              )}
              {!isManagedWorkspace && (
              <DropdownMenuItem onClick={() => navigate("/app/providers?tab=provider-keys")}>
                <Star className="mr-2 size-3.5" /> API keys
              </DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-destructive" onClick={handleDelete}>
                <Trash2 className="mr-2 size-3.5" /> Delete agent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <AgentTeamChromeBar agentId={agentId} section={activeTab} />

      {/* Rename Agent dialog — Overview still has Add-to-team for solos */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Rename Agent</DialogTitle>
            <DialogDescription>
              Internal label only — not spoken as your company brand. Put the brand in the greeting or prompt IDENTITY.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-agent-input" className="text-xs text-muted-foreground">Agent Name</Label>
            <Input
              id="rename-agent-input"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleRenameSave(); } }}
              className="h-9"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
            <Button type="button" onClick={handleRenameSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showWebcall && (
        <div
          className={cn(
            "pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center bg-transparent pb-safe",
            "md:inset-auto md:bottom-10 md:right-10 md:justify-end",
          )}
        >
          {/* Frameless float — wave + controls only (close via Live test toggle / Esc) */}
          <div className="pointer-events-auto">
            <WebcallPanel
              agentId={agent.id}
              agentName={agent.name ?? "Agent"}
              compact
              onClose={() => setShowWebcall(false)}
            />
          </div>
        </div>
      )}

      {/* Focused single-column editor */}
      <Form {...form}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <WorkspaceSegmentNav
            items={BUILDER_SEGMENTS}
            activeId={activeTab}
            onSelect={handleTabClick}
          />

          <div ref={tabContentRef} className="min-h-0 flex-1 overflow-y-auto bg-muted/40">
            <div className="builder-workspace-shell mx-auto flex min-h-full w-full border-border bg-background xl:border-x">
              <form
                onSubmit={(e) => e.preventDefault()}
                className={cn(
                  "builder-workspace-content min-h-full min-w-0 flex-1",
                  activeTab === "prompt" && "lg:max-w-[calc(100%-296px)]",
                )}
              >
                {activeTab === "overview"  && (
                  <OverviewTab
                    form={form}
                    agent={agent}
                    rateMap={rateMap}
                    onGoToPrompt={() => handleTabClick("prompt")}
                    onGoToAnalytics={() => handleTabClick("analytics")}
                  />
                )}
                {activeTab === "prompt"    && <PromptTab form={form} agentId={agentId} />}
                {activeTab === "voice"     && <VoiceTab form={form} />}
                {activeTab === "tools"     && <ToolsTab form={form} agentId={agentId} />}
                {activeTab === "outcomes"  && (
                  <div className={cn("flex flex-col gap-6", BUILDER_TAB_PAD)}>
                    <BuilderTabHeader
                      title="After the call"
                      description="Label what happened, pick the WhatsApp template for each outcome, and decide what to do with voicemail."
                    />
                    <DispositionSettingsPanel agentId={agent?.id ?? 0} />
                    <VoicemailTab form={form} embedded />
                  </div>
                )}
                {activeTab === "analytics" && (
                  <AgentAnalyticsPanel agentId={agent?.id ?? 0} embedded />
                )}
                {activeTab === "settings"  && <AdvancedTab form={form} agent={agent} />}
                {activeTab === "versions"  && <VersionsTab agentId={agent.id} />}
              </form>

              {activeTab === "prompt" && (
                <div className="sticky top-0 hidden h-[calc(100vh-7.5rem)] shrink-0 self-start lg:block">
                  <PromptReadinessAside form={form} agent={agent} onLiveTest={() => setShowWebcall(true)} />
                </div>
              )}
            </div>
          </div>

          {/* Mobile-only sticky actions */}
          <div className="shrink-0 border-t border-border/70 bg-background/95 px-5 py-2 pb-safe backdrop-blur-md sm:hidden">
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-1.5 text-xs font-medium"
                onClick={() => setCallDialog(true)}
              >
                <Phone className="h-4 w-4 shrink-0" />
                Phone
              </Button>
              <Button
                type="button"
                variant={showWebcall ? "default" : "outline"}
                className="h-10 gap-1.5 text-xs font-medium"
                onClick={() => setShowWebcall((v) => !v)}
              >
                <Mic className="h-4 w-4 shrink-0" />
                {showWebcall ? "Close" : "Web"}
              </Button>
              <Button
                type="button"
                className={cn("relative h-10 gap-1.5 text-xs font-medium", savedFlash && "bg-emerald-600 hover:bg-emerald-600")}
                onClick={onSave}
                disabled={updateAgent.isPending}
              >
                {savedFlash ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {updateAgent.isPending ? "…" : savedFlash ? "Saved" : "Save now"}
                {isDirty && !updateAgent.isPending && !savedFlash && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </Form>

      {/* Outbound call dialog */}
      <Dialog open={callDialog} onOpenChange={setCallDialog}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-2xl sm:rounded-lg bottom-4 top-auto translate-y-0 data-[state=open]:slide-in-from-bottom-4 sm:bottom-auto sm:top-[50%] sm:translate-y-[-50%] sm:data-[state=open]:slide-in-from-top-[48%]">
          <DialogHeader>
            <DialogTitle>Make Outbound Call</DialogTitle>
            <DialogDescription>
              Agent <strong>{agent.name}</strong> will call this number
              {byoOutboundFrom ? (
                <>
                  {" "}from your own {telephonyProviderWatch === "plivo" ? "Plivo" : "Twilio"} number{" "}
                  <span className="font-medium tabular-nums text-foreground">{byoOutboundFrom}</span>.
                </>
              ) : assignedOutboundNumber ? (
                <>
                  {" "}from your number{" "}
                  <span className="font-medium tabular-nums text-foreground">{assignedOutboundNumber}</span>.
                </>
              ) : outboundTestingFrom ? (
                <>
                  {" "}using trial platform caller ID{" "}
                  <span className="font-medium tabular-nums text-foreground">{outboundTestingFrom}</span>
                  {" "}(capped daily · buy your own number for unlimited + inbound).
                </>
              ) : (
                "."
              )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleOutbound} className="space-y-4">
            <Input value={callNumber} onChange={e => setCallNumber(e.target.value)}
              placeholder="+12125551234" className="h-12 text-base" autoFocus inputMode="tel" />
            <RecentNumbersList numbers={recentNumbers} onSelect={setCallNumber} onRemove={removeNumber} />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" className="h-11 min-h-11" onClick={() => setCallDialog(false)}>Cancel</Button>
              <Button type="submit" className="h-11 min-h-11" disabled={initiateOutbound.isPending}>
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
          handleTabClick("versions");
        }}
      />
    </div>
  );
}

/* ── Empty state ────────────────────────────────────────────────────────────── */

function PromptReadinessAside({
  form,
  agent,
  onLiveTest,
}: {
  form: any;
  agent: any;
  onLiveTest?: () => void;
}) {
  const systemPrompt = String(form.watch("systemPrompt") ?? "").trim();
  const greeting = String(form.watch("greetingMessage") ?? "").trim();
  const meetingPrompt = String(form.watch("meetingPrompt") ?? "").trim();
  const firstSpeaker = form.watch("firstSpeaker") === "user" ? "User first" : "Assistant first";
  const ttsVoice = form.watch("ttsVoice");
  const isGeminiLive = isGeminiLiveAgent({
    llmModel: form.watch("llmModel"),
    voiceStack: form.watch("voiceStack"),
  });
  const voiceOk = isGeminiLive || Boolean(ttsVoice && ttsVoice !== "__custom__");

  const canAttendMeetings = form.watch("agentSurfaces") === "phone_and_meet";
  const rows = [
    { label: "Welcome", ready: greeting.length >= 4, detail: firstSpeaker },
    { label: "Call prompt", ready: systemPrompt.length >= 40, detail: `${systemPrompt.length.toLocaleString()} chars` },
    ...(canAttendMeetings
      ? [{ label: "Meeting prompt", ready: meetingPrompt.length > 0, detail: meetingPrompt ? `${meetingPrompt.length.toLocaleString()} chars` : "Uses call prompt", optional: true as const }]
      : []),
    { label: "Sound", ready: voiceOk, detail: voiceOk ? "Set" : "Missing" },
  ];

  return (
    <WorkspaceInspector title="At a glance" className="h-full bg-muted/25">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
          <p className="truncate text-[13px] font-semibold">{agent?.name ?? "Agent"}</p>
          <p className="inline-flex shrink-0 items-center gap-1.5 text-[11px] capitalize text-muted-foreground">
            <StatusDot tone={agent?.status === "active" ? "success" : "neutral"} />
            {agent?.status === "active" ? "Live" : "Draft"}
          </p>
        </div>
        <ul className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
          {rows.map((row) => (
            <li key={row.label} className="flex items-start gap-2.5 px-3 py-2.5">
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                  row.ready
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : row.optional
                      ? "bg-muted text-muted-foreground"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                )}
              >
                {row.ready ? <Check className="size-3" /> : <AlertCircle className="size-3" />}
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-medium">{row.label}</p>
                <p className="truncate text-[10.5px] text-muted-foreground">{row.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        {onLiveTest && (
          <Button type="button" size="sm" className="h-9 w-full gap-1.5 text-[12px]" onClick={onLiveTest}>
            <Play className="size-3.5" />
            Live test
          </Button>
        )}
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          Changes auto-save after you pause typing. Overview shows phone, pipeline, and knowledge readiness.
        </p>
      </div>
    </WorkspaceInspector>
  );
}

function TeammateChips({
  agentId,
  membership,
  section,
}: {
  agentId: number;
  membership: AgentTeamMembership;
  section?: string | null;
}) {
  const [, navigate] = useLocation();
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {membership.members.map((m) => {
        const active = m.agentId === agentId;
        return (
          <button
            key={m.agentId}
            type="button"
            disabled={active}
            onClick={() => navigate(agentPathWithSection(m.agentId, section))}
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors",
              active
                ? "border-foreground/25 bg-background font-medium text-foreground"
                : "border-border/70 bg-background/70 text-muted-foreground hover:border-foreground/20 hover:text-foreground",
            )}
            title={active ? `${m.agentName} (editing)` : `Switch to ${m.agentName}`}
          >
            <span className="truncate">{m.agentName}</span>
            <span className="truncate text-muted-foreground">· {m.roleName}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Always-on chrome bar when this agent is on a team (above section tabs). */
function AgentTeamChromeBar({ agentId, section }: { agentId: number; section: string }) {
  const [, navigate] = useLocation();
  const { teamByAgentId, isLoading } = useAgentTeamMap();
  const membership = teamByAgentId.get(agentId);

  if (isLoading || !membership) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 bg-muted/15 px-5 py-1.5 sm:px-8">
      <Users className="size-3.5 shrink-0 text-muted-foreground" />
      <button
        type="button"
        onClick={() => navigate(`/app/squads/${membership.squadId}`)}
        className="inline-flex max-w-[160px] items-center gap-1 truncate text-[11px] font-medium hover:underline"
        title={membership.squadName}
      >
        <GitBranch className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{membership.squadName}</span>
      </button>
      <TeammateChips agentId={agentId} membership={membership} section={section} />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 gap-1 px-2 text-[11px] text-muted-foreground"
        onClick={() => navigate(`/app/squads/${membership.squadId}`)}
      >
        Manage
      </Button>
    </div>
  );
}

/** Overview card: team detail or quiet “Add to team” for solos. */
function AgentTeamStrip({ agentId, compact }: { agentId: number; compact?: boolean }) {
  const [, navigate] = useLocation();
  const { teamByAgentId, isLoading } = useAgentTeamMap();
  const membership = teamByAgentId.get(agentId);

  if (isLoading) return null;

  const shell = cn(
    compact
      ? "flex flex-wrap items-center gap-2"
      : "flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 bg-muted/15 px-5 py-1.5 sm:px-8",
  );

  if (!membership) {
    return (
      <div className={shell}>
        <Users className="size-3.5 shrink-0 text-muted-foreground/70" />
        <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          Solo agent
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 gap-1 px-2.5 text-[11px]"
          onClick={() => navigate(`/app/squads?seedAgent=${agentId}`)}
        >
          <Plus className="size-3" />
          Add to team
        </Button>
      </div>
    );
  }

  return (
    <div className={shell}>
      <Users className="size-3.5 shrink-0 text-muted-foreground" />
      <button
        type="button"
        onClick={() => navigate(`/app/squads/${membership.squadId}`)}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 py-0.5 text-[11px] hover:bg-muted/40"
        title={membership.mates.length ? `With ${membership.mates.map((m) => m.agentName).join(", ")}` : membership.squadName}
      >
        <GitBranch className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{membership.squadName}</span>
        {membership.roleName ? <span className="truncate text-muted-foreground">· {membership.roleName}</span> : null}
      </button>
      <TeammateChips agentId={agentId} membership={membership} section="overview" />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 gap-1 px-2 text-[11px] text-muted-foreground"
        onClick={() => navigate(`/app/squads/${membership.squadId}`)}
      >
        Manage
      </Button>
    </div>
  );
}

function CreateAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const { isManagedWorkspace } = usePartnerManagedWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [step, setStep] = useState<"compose" | "surfaces" | "name">("compose");
  const [composition, setComposition] = useState<"single" | "team">("single");
  const [surfaces, setSurfaces] = useState<"phone" | "phone_and_meet">("phone");
  const [agentName, setAgentName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [agent1Name, setAgent1Name] = useState("");
  const [agent1Role, setAgent1Role] = useState("Lead Qualifier");
  const [agent2Name, setAgent2Name] = useState("");
  const [agent2Role, setAgent2Role] = useState("Meeting Scheduler");
  const [handoffMessage, setHandoffMessage] = useState(
    "Just a second — connecting you now.",
  );
  const [handoffGreeting, setHandoffGreeting] = useState(
    "Hi — I have what you just said. How can I help?",
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const buildAgentBody = (name: string): Record<string, unknown> => ({
    name,
    asrProvider: "sarvam",
    asrModel: "saaras:v3",
    asrLanguage: "",
    language: "en-IN",
    telephonyProvider: "vobiz",
    systemPrompt: "You are a helpful AI voice assistant.",
    greetingMessage: "Hello! How can I help you today?",
    tools: [
      { type: "end_call", name: "end_call", description: "End the call when the conversation is complete." },
    ],
    llmProvider: "sarvam",
    llmModel: "sarvam-105b-conversations",
    ttsProvider: "cartesia",
    ttsModel: "sonic-3.5",
    ttsVoice: DEFAULT_CARTESIA_VOICE_ID,
    ttsVoiceName: DEFAULT_CARTESIA_VOICE_NAME,
    // Attendance capacity is fixed by agent type:
    // phone+meet → can join Meet (paste-link or booking); phone-only → book only, never join.
    agentConfig: {
      meetings: {
        enabled: surfaces === "phone_and_meet",
        whoJoins: "self",
        meetingPrompt: "",
        passMemory: true,
        passCallContext: true,
        maxDurationSeconds: 45 * 60,
        silenceTimeoutSeconds: 3 * 60,
        silenceHangupEnabled: true,
        presentationUrl: "",
        presentationAutoStart: false,
      },
    },
  });

  const handleClose = () => {
    if (creating) return;
    setStep("compose");
    setComposition("single");
    setSurfaces("phone");
    setAgentName("");
    setTeamName("");
    setAgent1Name("");
    setAgent1Role("Lead Qualifier");
    setAgent2Name("");
    setAgent2Role("Meeting Scheduler");
    setHandoffMessage("Just a second — connecting you now.");
    setHandoffGreeting("Hi — I have what you just said. How can I help?");
    setCreateError(null);
    onClose();
  };

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      if (composition === "team") {
        const resolvedTeam = teamName.trim() || "New team";
        const name1 = agent1Name.trim() || "Lead Qualifier";
        const name2 = agent2Name.trim() || "Meeting Scheduler";
        const role1 = agent1Role.trim() || "Lead Qualifier";
        const role2 = agent2Role.trim() || "Meeting Scheduler";

        const agent1 = await customFetch<{ id: number }>(`${DASH_API}/agents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildAgentBody(name1)),
        });

        let agent2: { id: number };
        try {
          agent2 = await customFetch<{ id: number }>(`${DASH_API}/agents`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildAgentBody(name2)),
          });
        } catch (err: any) {
          await queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          const issueMsg = Array.isArray(err?.issues) ? err.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join(", ") : "";
          setCreateError(
            issueMsg
              ? `Created “${name1}”, but agent 2 failed: ${issueMsg}`
              : `Created “${name1}”, but agent 2 failed: ${err?.message ?? "Please try again from the agents list."}`,
          );
          return;
        }

        try {
          await customFetch(`${DASH_API}/squads`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: resolvedTeam,
              description: null,
              status: "active",
              handoffMessage:
                handoffMessage.trim() ||
                "Just a second — connecting you now.",
              handoffGreeting:
                handoffGreeting.trim() ||
                "Hi — I have what you just said. How can I help?",
              members: [
                {
                  agentId: agent1.id,
                  roleName: role1,
                  roleType: "specialist",
                  instructions: "Entry point — hand off when a specialist should take over",
                  handoffEnabled: true,
                  sortOrder: 0,
                },
                {
                  agentId: agent2.id,
                  roleName: role2,
                  roleType: "specialist",
                  instructions: null,
                  handoffEnabled: true,
                  sortOrder: 1,
                },
              ],
            }),
          });
        } catch (err: any) {
          await queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          setCreateError(
            `Both agents were created, but the team failed: ${err?.message ?? "Open Squads to assemble them manually."}`,
          );
          return;
        }

        await queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        await queryClient.invalidateQueries({ queryKey: ["squads"] });
        handleClose();
        toast({
          title: "Team ready",
          description: "Edit each agent’s prompt from the Team bar — handoffs use each specialist’s own prompt.",
        });
        navigate(agentPathWithSection(agent1.id, "prompt"));
        return;
      }

      const name = agentName.trim() || "New Voice Agent";
      const result = await customFetch<{ id: number }>(`${DASH_API}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAgentBody(name)),
      });
      await queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      handleClose();
      navigate(`/app/agents/${result.id}`);
    } catch (err: any) {
      const issueMsg = Array.isArray(err?.issues) ? err.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join(", ") : "";
      setCreateError(issueMsg ? `Validation failed: ${issueMsg}` : (err?.message ?? "Failed to create agent. Please try again."));
    } finally {
      setCreating(false);
    }
  };

  const stepTitle =
    step === "compose" ? "Who is this for?"
      : step === "surfaces" ? "Where will they talk?"
        : composition === "team" ? "Name your team"
          : "Name your agent";
  const stepDesc =
    step === "compose" ? "Start with one agent, or create two that hand off mid-call."
      : step === "surfaces" ? "Phone only (calendar bookings + Meet links for humans; AI never joins), or phone + meetings (AI can join Meet)."
        : composition === "team"
          ? "We’ll create both agents and wire handoffs automatically."
          : "You can edit prompts, tools, and settings anytime.";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className={cn("sm:max-w-md", composition === "team" && step === "name" && "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle>{stepTitle}</DialogTitle>
          <DialogDescription>{stepDesc}</DialogDescription>
        </DialogHeader>

        {step === "compose" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <button
              type="button"
              onClick={() => { setComposition("single"); setStep("surfaces"); }}
              className={cn(
                "group flex flex-col items-center gap-2 rounded-xl border p-5 text-center transition-colors",
                composition === "single"
                  ? "border-primary/40 bg-primary/5 hover:border-primary"
                  : "border-border/60 bg-card hover:border-primary/50 hover:bg-primary/5",
              )}
            >
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <User2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">One agent</p>
                <p className="text-xs text-muted-foreground mt-0.5">Single voice personality</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => { setComposition("team"); setStep("surfaces"); }}
              className={cn(
                "group flex flex-col items-center gap-2 rounded-xl border p-5 text-center transition-colors",
                composition === "team"
                  ? "border-primary/40 bg-primary/5 hover:border-primary"
                  : "border-border/60 bg-card hover:border-primary/50 hover:bg-primary/5",
              )}
            >
              <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center group-hover:bg-muted/80">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold">Team</p>
                <p className="text-xs text-muted-foreground mt-0.5">Create two agents that hand off mid-call</p>
              </div>
            </button>
            {!isManagedWorkspace && (
            <button
              type="button"
              onClick={() => { handleClose(); navigate("/app/vibe"); }}
              className="sm:col-span-2 flex items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Or build with AI (guided)
            </button>
            )}
          </div>
        )}

        {step === "surfaces" && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSurfaces("phone")}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition-colors",
                  surfaces === "phone"
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/60 hover:border-primary/40 hover:bg-primary/5",
                )}
              >
                <Phone className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">Phone</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Voice calls. Can book calendar — does not join Meet.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setSurfaces("phone_and_meet")}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition-colors",
                  surfaces === "phone_and_meet"
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/60 hover:border-primary/40 hover:bg-primary/5",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Phone className="h-4 w-4 text-primary" />
                  <Video className="h-4 w-4 text-primary" />
                </div>
                <p className="text-sm font-semibold">Phone + meetings</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Voice calls, plus join Meet/Zoom/Teams from Meeting bots. Booking a slot is separate.
                </p>
              </button>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep("compose")}>Back</Button>
              <Button onClick={() => setStep("name")}>Continue</Button>
            </DialogFooter>
          </div>
        )}

        {step === "name" && composition === "single" && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="scratch-name">Agent name</Label>
              <Input
                id="scratch-name"
                placeholder="e.g. Support Representative"
                value={agentName}
                onChange={e => setAgentName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && void handleCreate()}
                autoFocus
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              One agent
              {" · "}
              {surfaces === "phone" ? "Phone" : "Phone + meetings"}
            </p>
            {createError && <p className="text-xs text-destructive">{createError}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep("surfaces")} disabled={creating}>Back</Button>
              <Button onClick={() => void handleCreate()} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create agent"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "name" && composition === "team" && (
          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label htmlFor="team-name">Team name</Label>
              <Input
                id="team-name"
                placeholder="e.g. Sales team"
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="rounded-lg border border-border/60 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Agent 1</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="agent1-name" className="text-[11px]">Name</Label>
                  <Input
                    id="agent1-name"
                    placeholder="e.g. Lead Qualifier"
                    value={agent1Name}
                    onChange={e => setAgent1Name(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="agent1-role" className="text-[11px]">Role</Label>
                  <Input
                    id="agent1-role"
                    placeholder="Lead Qualifier"
                    value={agent1Role}
                    onChange={e => setAgent1Role(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5 pt-1 border-t border-border/50">
                <Label htmlFor="handoff-message" className="text-[11px]">Handoff announcement</Label>
                <Textarea
                  id="handoff-message"
                  className="min-h-[60px] text-xs resize-none"
                  value={handoffMessage}
                  onChange={e => setHandoffMessage(e.target.value)}
                  placeholder="Just a second — connecting you now."
                />
                <p className="text-[11px] text-muted-foreground">
                  Spoken by Agent 1 every time before connecting Agent 2.
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-border/60 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Agent 2</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="agent2-name" className="text-[11px]">Name</Label>
                  <Input
                    id="agent2-name"
                    placeholder="e.g. Meeting Scheduler"
                    value={agent2Name}
                    onChange={e => setAgent2Name(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="agent2-role" className="text-[11px]">Role</Label>
                  <Input
                    id="agent2-role"
                    placeholder="Meeting Scheduler"
                    value={agent2Role}
                    onChange={e => setAgent2Role(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5 pt-1 border-t border-border/50">
                <Label htmlFor="handoff-greeting" className="text-[11px]">Receiving agent greeting</Label>
                <Textarea
                  id="handoff-greeting"
                  className="min-h-[60px] text-xs resize-none"
                  value={handoffGreeting}
                  onChange={e => setHandoffGreeting(e.target.value)}
                  placeholder="Hi — I have what you just said. How can I help?"
                />
                <p className="text-[11px] text-muted-foreground">
                  Spoken by Agent 2 after they take over the call.
                </p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Two agents · {surfaces === "phone" ? "Phone" : "Phone + meetings"} · handoffs wired automatically
            </p>
            {createError && <p className="text-xs text-destructive">{createError}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep("surfaces")} disabled={creating}>Back</Button>
              <Button onClick={() => void handleCreate()} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create team"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StudioEmptyCanvas({ onCreate }: { onCreate: () => void }) {
  const [, navigate] = useLocation();
  const { isManagedWorkspace } = usePartnerManagedWorkspace();
  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-background">
      <div className="text-center max-w-sm space-y-4">
        <div className="mx-auto h-12 w-12 rounded-2xl border border-border/50 bg-muted/30 flex items-center justify-center">
          <SnapServeAgentIcon size={20} className="text-muted-foreground" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight">Select an agent</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Pick one from the list, or create a new agent for phone — or phone plus meetings.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2 pt-1 w-full max-w-sm mx-auto">
          <Button className="h-11 min-h-11 rounded-xl gap-1.5 text-xs w-full sm:w-auto" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" /> New agent
          </Button>
          {!isManagedWorkspace && (
          <Button variant="outline" className="h-11 min-h-11 rounded-xl gap-1.5 text-xs w-full sm:w-auto" onClick={() => navigate("/app/vibe")}>
            <Sparkles className="h-3.5 w-3.5" /> Build with AI
          </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────────── */

const LAST_AGENT_ID_KEY = "voiceorch:lastAgentId";

export default function AgentBuilder() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const rateMap = useMinuteRatesMap();
  const isMobile = useIsMobile();
  const { data: agents, isLoading: agentsLoading } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });

  const selectedId = params.id ? parseInt(params.id, 10) : null;
  const [agentsSheetOpen, setAgentsSheetOpen] = useState(false);

  const handleSelect = (id: number) => {
    try { localStorage.setItem(LAST_AGENT_ID_KEY, String(id)); } catch { /* ignore */ }
    setAgentsSheetOpen(false);
    navigate(`/app/agents/${id}`);
  };

  useEffect(() => {
    if (selectedId == null) return;
    try { localStorage.setItem(LAST_AGENT_ID_KEY, String(selectedId)); } catch { /* ignore */ }
  }, [selectedId]);

  // Create-agent dialog. Opened by StudioEmptyCanvas, or requested via
  // ?create=1 (sidebar / mobile bottom-nav "New agent" → Manual Build).
  const searchString = useSearch();
  const [showCreate, setShowCreate] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("create") === "1";
    } catch {
      return false;
    }
  });
  const handleCreate = () => setShowCreate(true);

  // Honor ?create=1 that arrives while this instance is already mounted
  // (e.g. user is already on /app/agents), then strip it from the URL so
  // refresh / tab switches don't re-open the dialog.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(searchString);
      if (sp.get("create") !== "1") return;
      setShowCreate(true);
      sp.delete("create");
      const next = sp.toString() ? `?${sp.toString()}` : window.location.pathname;
      window.history.replaceState(null, "", next);
    } catch { /* ignore */ }
  }, [searchString]);

  // /app/agents opens Studio and lands on last (or first) agent — no gallery hub.
  // Deferred while the create dialog is open: the redirect swaps route
  // components (/app/agents → /app/agents/:id) and would unmount the dialog.
  useEffect(() => {
    if (agentsLoading) return;
    const list = Array.isArray(agents) ? agents : [];
    if (selectedId != null && list.length > 0 && !list.some(a => a.id === selectedId)) {
      try { localStorage.removeItem(LAST_AGENT_ID_KEY); } catch {}
      navigate(`/app/agents/${list[0]!.id}`, { replace: true });
      return;
    }
    if (selectedId != null) return;
    if (showCreate) return;
    if (list.length === 0) return;
    let target: number | null = null;
    try {
      const last = localStorage.getItem(LAST_AGENT_ID_KEY);
      if (last) {
        const id = parseInt(last, 10);
        if (list.some(a => a.id === id)) target = id;
      }
    } catch { /* ignore */ }
    if (target == null) target = list[0]!.id;
    navigate(`/app/agents/${target}`, { replace: true });
  }, [selectedId, agents, agentsLoading, navigate, showCreate]);

  // On mobile with no selection yet, open agents sheet so list is reachable
  // (skipped while the create dialog is open so the sheet doesn't cover it)
  useEffect(() => {
    if (isMobile && selectedId == null && !agentsLoading && !showCreate) {
      const list = Array.isArray(agents) ? agents : [];
      if (list.length === 0) setAgentsSheetOpen(true);
    }
  }, [isMobile, selectedId, agentsLoading, agents, showCreate]);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <CreateAgentDialog open={showCreate} onClose={() => setShowCreate(false)} />
      <Sheet open={agentsSheetOpen} onOpenChange={setAgentsSheetOpen}>
        <SheetContent side="left" className="w-[min(100vw,300px)] p-0 [&>button]:hidden">
          <SheetTitle className="sr-only">Agents</SheetTitle>
          <AgentListPanel
            selectedId={selectedId}
            onSelect={handleSelect}
            rateMap={rateMap}
            className="h-full"
          />
        </SheetContent>
      </Sheet>
      {selectedId != null ? (
        <AgentEditorPanel agentId={selectedId} onOpenAgents={() => setAgentsSheetOpen(true)} />
      ) : (
        <StudioEmptyCanvas onCreate={handleCreate} />
      )}
    </div>
  );
}
