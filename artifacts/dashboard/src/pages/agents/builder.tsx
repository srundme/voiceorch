import React, { useEffect, useState, useMemo, useRef } from "react";
import { diffWords, diffWordsWithSpace } from "diff";
import { useLocation, useParams, useSearch } from "wouter";
import {
  Bot, Plus, Search, Phone, Mic, Brain, Webhook, PhoneForwarded,
  Save, MoreHorizontal, Trash2, Settings, FileText, Wrench,
  VoicemailIcon, SlidersHorizontal, TestTube2, ChevronRight,
  Volume2, Check, X, Pencil, ChevronDown, List, Globe, BarChart3,
  User2, Sparkles, BookOpen, ToggleLeft, ToggleRight, Tag, Loader2, Square, AudioLines,
  Play, Pause,
  Timer, ShieldCheck, Layers, Gauge, MicOff, HelpCircle, PhoneOff, Mail, MessageCircle,
  History, GitBranch, Eye, RotateCcw, ChevronUp, AlertTriangle, ArrowLeftRight,
  Upload, Archive, Info, AlertCircle, Calendar, Star,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
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
  useListKnowledgeSources, useRunToolTest, useListAmbientSounds, useListEventTypes,
  useListAgentVersions, usePublishAgentVersion, useGetAgentVersion, useRestoreAgentVersion,
  useArchiveAgentVersion, useDeleteAgentVersion,
  getListAgentVersionsQueryKey, getGetAgentVersionQueryKey,
  useListPhoneNumbers, useAssignPhoneNumber, getListPhoneNumbersQueryKey,
} from "@workspace/api-client-react";
import type { AgentVersion } from "@workspace/api-client-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { agentFormSchema, hydrateToolsForForm, CALL_ENGINE_PRESETS, type CallEnginePreset, clampBargeInEnergyThreshold, clampEndpointingMs, clampLinearDelayMs, clampFragmentCoalesceListeningMs, clampFragmentCoalescePlayingMs, clampTelephonyTailDrainMs, clampSarvamSpeechEndFlushMs, clampSarvamIncompleteHoldMs, clampInterruptWords, voiceSecondsFromInterruptWords } from "./edit.schema";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { formatApiError, mapApiErrors, isDestinationUnverifiedError } from "@/lib/format-api-error";
import {
  ASR_PROVIDERS, LLM_PROVIDERS, TTS_PROVIDERS,
  LANGUAGES, SARVAM_PERSONALISATION_LANGUAGES, ASR_MODELS, LLM_MODELS, TTS_MODELS, TTS_VOICES, AGENT_TIMEZONES,
  filterVoicesForLanguage, isVoiceCompatibleWithLanguage,
  getSarvamTtsVoices, isSarvamVoiceCompatible,
  GEMINI_LIVE_LLM_MODEL, GEMINI_LIVE_THINKING_LEVELS,
  geminiLiveModelLabel, isGeminiLiveAgent, isGeminiLiveLlmModel, voiceStackForLlmModel,
  languagesForAgent, isGeminiLiveLanguage,
} from "@/lib/agent-providers";
import { useMinuteRatesMap, useUserProviderNames, computeAgentRateCents } from "@/hooks/use-minute-rates";
import { DestinationOtpDialog } from "@/components/destination-otp-dialog";
import { RecentNumbersList } from "@/components/recent-numbers-list";
import { useRecentNumbers } from "@/hooks/use-recent-numbers";
import { GeneratePromptSheet } from "./generate-prompt-sheet";
import { JourneyPanel } from "./journey-panel";
import { EmailChannelCard, useEmailChannelReady } from "./email-channel-card";
const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API   = `${_DASH_BASE}/api`;

/* ── Types ──────────────────────────────────────────────────────────────────── */

type TabId = "overview" | "channels" | "prompt" | "voice" | "tools" | "analysis" | "voicemail" | "advanced" | "versions";

interface TabDef { id: TabId; label: string; icon: React.ReactNode }

const TABS: TabDef[] = [
  { id: "overview",    label: "Agent",       icon: <Bot className="h-3.5 w-3.5" /> },
  { id: "channels",    label: "Channels",    icon: <Phone className="h-3.5 w-3.5" /> },
  { id: "prompt",      label: "Prompt",      icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "voice",       label: "Voice",       icon: <Mic className="h-3.5 w-3.5" /> },
  { id: "tools",       label: "Tools",       icon: <Wrench className="h-3.5 w-3.5" /> },
  { id: "analysis",    label: "Journey",     icon: <GitBranch className="h-3.5 w-3.5" /> },
  { id: "voicemail",   label: "Voicemail",   icon: <VoicemailIcon className="h-3.5 w-3.5" /> },
  { id: "advanced",    label: "Advanced",    icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
  { id: "versions",    label: "Versions",    icon: <History className="h-3.5 w-3.5" /> },
];

/* ── Small helpers ──────────────────────────────────────────────────────────── */

function SmallSelect({ value, onChange, options, placeholder }: {
  value: string | undefined;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
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
          <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
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
            className="w-full h-12 flex items-center justify-between rounded-lg border border-border/60 bg-card/30 px-4 text-sm text-muted-foreground hover:border-border hover:text-foreground transition-colors"
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

function AgentCostSummary({ form, rateMap, compact = false }: { form: any; rateMap: Map<string, number>; agent?: any; compact?: boolean }) {
  const userProviderNames = useUserProviderNames();

  const asrProvider = form.watch("asrProvider");
  const llmProvider = form.watch("llmProvider");
  const ttsProvider = form.watch("ttsProvider");

  const agentProviders = [asrProvider, llmProvider, ttsProvider].filter(Boolean).map((p: string) => p.toLowerCase());
  const isByop = agentProviders.some(p => userProviderNames.has(p));
  const platformCents = rateMap.get(isByop ? "byop" : "managed") ?? 500;
  const totalPerMin = platformCents / 100; // paise → INR (map already reflects account-level partner rates)

  const segments = [
    { key: "platform", label: "Platform", provider: "SnapServe", cost: totalPerMin, color: "#6366f1" },
  ];
  const breakdown = segments.filter(s => s.cost > 0);
  const barTotal = Math.max(breakdown.reduce((s, x) => s + x.cost, 0), 0.0001);

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-muted/20 px-3 py-1.5 text-[12px] text-muted-foreground cursor-default">
            <span className="text-muted-foreground/70">Est. cost</span>
            <span className="font-semibold tabular-nums text-foreground">₹{totalPerMin.toFixed(2)}</span>
            <span className="text-muted-foreground/50">/min</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs space-y-1">
          {breakdown.map(seg => (
            <div key={seg.key} className="flex items-center justify-between gap-3">
              <span className="font-medium">{seg.label}</span>
              <span className="tabular-nums">₹{seg.cost.toFixed(2)}/min</span>
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
            <span className="font-semibold tabular-nums text-foreground cursor-default">
              ₹{totalPerMin.toFixed(2)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs space-y-1">
            {breakdown.map(seg => (
              <div key={seg.key} className="flex items-center justify-between gap-3">
                <span className="font-medium">
                  {seg.label}
                  {seg.provider && seg.provider !== "SnapServe" && (
                    <span className="text-muted-foreground ml-1 capitalize">({seg.provider})</span>
                  )}
                </span>
                <span className="tabular-nums">₹{seg.cost.toFixed(2)}/min</span>
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
  transcriber: ["language", "asrProvider", "asrModel", "sarvamSttMode", "languageAutoDetect", "multilingualLanguages", "sarvamIndicNumbers"],
  model: ["llmProvider", "llmModel", "temperature"],
  voice: ["voiceStack", "ttsProvider", "ttsModel", "ttsVoice", "ttsSpeed", "geminiLiveVoiceName", "geminiLiveThinkingLevel"],
};

/* ── Inbound number card (same assign API as Phone Numbers) ─────────────────── */

function AgentInboundPanel({
  agentId,
  preferredManagedNumber,
  className,
}: {
  agentId: number;
  preferredManagedNumber?: string | null;
  className?: string;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: phoneNumbersRaw, isLoading } = useListPhoneNumbers({
    query: { queryKey: getListPhoneNumbersQueryKey(), staleTime: 60_000 },
  });
  const { data: agents } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });
  const { data: managedData } = useQuery({
    queryKey: ["phone-numbers", "managed"],
    queryFn: () => customFetch<{ numbers: string[] }>(`${DASH_API}/phone-numbers/managed`),
    staleTime: 5 * 60 * 1000,
  });
  const { data: quota, refetch: refetchQuota } = useQuery({
    queryKey: ["phone-numbers", "managed-quota"],
    queryFn: () => customFetch<{
      limit: number;
      used: number;
      remaining: number;
      hasOwnNumber: boolean;
      limited: boolean;
      unlimitedTrial?: boolean;
      resetsAt: string;
    }>(`${DASH_API}/phone-numbers/managed-quota`),
    staleTime: 15_000,
  });
  const assign = useAssignPhoneNumber();
  const phoneNumbers = Array.isArray(phoneNumbersRaw) ? phoneNumbersRaw : [];
  const assigned = phoneNumbers.find(p => p.agentId === agentId);
  const ownedCount = phoneNumbers.length;
  const managedNumbers = managedData?.numbers ?? [];
  const testingFromNumber =
    preferredManagedNumber
    ?? (assigned?.number ?? null)
    ?? managedNumbers[0]
    ?? null;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("none");

  const openDialog = () => {
    setSelectedId(assigned ? String(assigned.id) : "none");
    setDialogOpen(true);
  };

  const configureWebhook = async (numberId: number) => {
    try {
      const token = localStorage.getItem("voiceorch:session");
      await fetch(`/api/phone-numbers/${numberId}/configure-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch {
      // Non-fatal — number is assigned; webhook can be repaired from Phone Numbers.
    }
  };

  const handleSave = async () => {
    const nextId = selectedId === "none" ? null : parseInt(selectedId, 10);
    try {
      // Agent-centric: clear previous number on this agent if switching/unassigning
      if (assigned && assigned.id !== nextId) {
        await assign.mutateAsync({ id: assigned.id, data: { agentId: null } });
      }
      if (nextId != null) {
        await assign.mutateAsync({ id: nextId, data: { agentId } });
        await configureWebhook(nextId);
      }
      queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
      void refetchQuota();
      toast({
        title: nextId ? "Your number is live on this agent" : "Number cleared",
        description: nextId
          ? "Inbound rings this agent. Outbound caller ID uses your number — unlimited calls."
          : "Assign a purchased number to go live.",
      });
      setDialogOpen(false);
    } catch (err) {
      toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
    }
  };

  const trialRemaining = quota?.limited ? quota.remaining : null;
  const trialLimit = quota?.limit ?? 3;
  const trialExhausted = quota?.limited && quota.remaining <= 0;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Primary path: own number — buy / assign */}
      <div className={cn(
        "rounded-xl border p-3 space-y-2.5",
        assigned
          ? "border-emerald-500/25 bg-emerald-500/5"
          : "border-amber-500/30 bg-amber-500/5",
      )}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <PhoneForwarded className={cn("h-3.5 w-3.5 shrink-0", assigned ? "text-emerald-500" : "text-amber-500")} />
            <span className={cn(
              "text-[10px] font-semibold uppercase tracking-wider",
              assigned ? "text-emerald-600/90 dark:text-emerald-400/90" : "text-amber-600/90 dark:text-amber-400/90",
            )}>
              Your phone number
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate("/app/phone-numbers")}
            className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {ownedCount === 0 ? "Buy →" : "Numbers →"}
          </button>
        </div>

        {isLoading ? (
          <Skeleton className="h-9 w-full rounded-lg" />
        ) : assigned ? (
          <button
            type="button"
            onClick={openDialog}
            className="w-full flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/50 px-2.5 py-2 text-left hover:border-border hover:bg-background/70 transition-colors"
          >
            <div className="min-w-0">
              <p className="text-[12px] font-medium truncate tabular-nums text-foreground">{assigned.number}</p>
              <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
                Live — inbound + outbound caller ID · unlimited tests
              </p>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </button>
        ) : ownedCount === 0 ? (
          <div className="space-y-2">
            <p className="text-[12px] font-medium text-foreground">Required to go live</p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Buy your own number for inbound calls, your caller ID on outbound, and unlimited testing. The platform number below is only a short trial.
            </p>
            <Button
              type="button"
              size="sm"
              className="h-8 w-full text-xs gap-1.5"
              onClick={() => navigate("/app/phone-numbers")}
            >
              <Plus className="h-3.5 w-3.5" /> Buy a phone number
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openDialog}
            className="w-full flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-background/50 px-2.5 py-2 text-left hover:border-amber-500/50 transition-colors"
          >
            <div className="min-w-0">
              <p className="text-[12px] font-medium truncate text-foreground">Number purchased — assign it</p>
              <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
                Click to attach your number for inbound + outbound
              </p>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </button>
        )}
      </div>

      {/* Trial outbound — demoted, capped */}
      {!assigned && (
      <div className={cn(
        "rounded-xl border p-3 space-y-1.5",
        trialExhausted
          ? "border-border/40 bg-muted/20 opacity-90"
          : "border-border/50 bg-card/40",
      )}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Trial outbound
            </span>
          </div>
          <span className={cn(
            "text-[9px] font-medium uppercase tracking-wide shrink-0 rounded-full border px-1.5 py-0.5",
            quota?.unlimitedTrial
              ? "border-emerald-500/30 text-emerald-500"
              : trialExhausted
                ? "border-border/50 text-muted-foreground"
                : "border-amber-500/30 text-amber-500",
          )}>
            {quota?.unlimitedTrial
              ? "Unlimited trial"
              : quota?.limited
                ? (trialExhausted ? "Limit reached" : `${trialRemaining}/${trialLimit} left today`)
                : "Trial"}
          </span>
        </div>
        {testingFromNumber ? (
          <>
            <p className="text-[12px] font-medium tabular-nums text-muted-foreground tracking-tight">
              {testingFromNumber}
            </p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {quota?.unlimitedTrial
                ? "Shared platform trial line — unlimited for your account (admin grant). Still not your number; inbound will not ring this agent. Buy a number to go live."
                : trialExhausted
                  ? "Free trial calls are used up for today. Buy a number to keep testing and to receive inbound calls."
                  : `Shared platform line for a quick listen — ${trialLimit} outbound tests/day. Not your number; inbound will not ring this agent.`}
            </p>
            {trialExhausted && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 w-full text-[11px] gap-1.5 mt-1"
                onClick={() => navigate("/app/phone-numbers")}
              >
                <Plus className="h-3 w-3" /> Buy number to continue
              </Button>
            )}
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            No trial line configured. Buy your own number to place outbound calls.
          </p>
        )}
      </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Attach your phone number</DialogTitle>
            <DialogDescription>
              Your purchased number handles inbound routing and outbound caller ID. Trial platform lines are shared and capped — buy a number to go live.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {phoneNumbers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-4 text-center space-y-2">
                <p className="text-sm text-muted-foreground">You don’t have a purchased number yet.</p>
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => { setDialogOpen(false); navigate("/app/phone-numbers"); }}>
                  <Plus className="h-3.5 w-3.5" /> Buy a number
                </Button>
              </div>
            ) : (
              <>
                <Label className="text-sm">Phone number</Label>
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a number…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Unassigned —</SelectItem>
                    {phoneNumbers.map(n => {
                      const owner = n.agentId && n.agentId !== agentId
                        ? agents?.find(a => a.id === n.agentId)?.name
                        : null;
                      return (
                        <SelectItem key={n.id} value={String(n.id)}>
                          {n.number}{owner ? ` · ${owner}` : n.agentId === agentId ? " · current" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Reassigning a number in use by another agent moves inbound and outbound to this agent.
                </p>
              </>
            )}
          </div>
          {phoneNumbers.length > 0 && (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="button" onClick={handleSave} disabled={assign.isPending}>
                {assign.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                Save
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type BuilderWhatsappChannel = {
  mode: "shared" | "own";
  businessName: string;
  phoneE164: string | null;
  status: string;
  active: boolean;
};

type BuilderWhatsappResponse = {
  channel: BuilderWhatsappChannel | null;
  sharedTierAvailable: boolean;
  usage: { used24h: number; cap: number } | null;
};

function StatusBadge({
  ready,
  readyLabel = "Ready",
  emptyLabel = "Needs setup",
}: {
  ready: boolean;
  readyLabel?: string;
  emptyLabel?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        ready
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
          : "border-amber-500/25 bg-amber-500/10 text-amber-400",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", ready ? "bg-emerald-400" : "bg-amber-400")} />
      {ready ? readyLabel : emptyLabel}
    </span>
  );
}

function JourneyReadinessPanel({ form, agent }: { form: any; agent: any }) {
  const knowledgeIds = (form.watch("knowledgeSourceIds") ?? []) as number[];
  const schedulingCalendarId = form.watch("schedulingCalendarId");
  const schedulingEventTypeId = form.watch("schedulingEventTypeId");
  const webhookUrl = (form.watch("webhookUrl") ?? "").trim();
  const [hasInboundPhone, setHasInboundPhone] = useState(false);
  const emailReady = useEmailChannelReady();

  const { data: phoneNumbersRaw } = useListPhoneNumbers({
    query: { queryKey: getListPhoneNumbersQueryKey(), staleTime: 60_000 },
  });

  const { data: waData } = useQuery({
    queryKey: ["builder-whatsapp-channel", agent?.id],
    enabled: !!agent?.id,
    queryFn: () => customFetch<BuilderWhatsappResponse>(`${DASH_API}/whatsapp/channel`),
    staleTime: 60_000,
  });

  useEffect(() => {
    const phoneNumbers = Array.isArray(phoneNumbersRaw) ? phoneNumbersRaw : [];
    setHasInboundPhone(phoneNumbers.some((p: any) => p.agentId === agent?.id));
  }, [phoneNumbersRaw, agent?.id]);

  const checks = [
    { label: "Voice + prompt", ready: !!(form.watch("name") ?? "").trim() && !!(form.watch("systemPrompt") ?? "").trim() },
    { label: "Knowledge attached", ready: knowledgeIds.length > 0 },
    { label: "Phone channel", ready: hasInboundPhone },
    { label: "WhatsApp channel", ready: !!waData?.channel?.active },
    { label: "Email channel", ready: emailReady },
    { label: "Booking channel", ready: !!schedulingCalendarId && !!schedulingEventTypeId },
    { label: "Follow-up output", ready: !!waData?.channel?.active || emailReady || !!webhookUrl },
  ];

  const readyCount = checks.filter((c) => c.ready).length;

  return (
    <div className="rounded-xl border border-border/60 bg-card/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Journey readiness</p>
          <h3 className="text-sm font-semibold mt-1">Build a complete agent, not just a voice bot</h3>
        </div>
        <span className="text-xs font-semibold text-muted-foreground">{readyCount}/{checks.length}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2">
            <span className="text-xs">{check.label}</span>
            <StatusBadge ready={check.ready} readyLabel="Connected" emptyLabel="Pending" />
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Messaging channels are Email + WhatsApp only (managed SnapServe or your own Brevo / Vobiz-BSP). SMS is not a messaging channel.
      </p>
    </div>
  );
}

function ChannelsTab({ form, agent, forceExpandEmail = false }: { form: any; agent: any; forceExpandEmail?: boolean }) {
  const [, navigate] = useLocation();
  const schedulingCalendarId = form.watch("schedulingCalendarId");
  const schedulingEventTypeId = form.watch("schedulingEventTypeId");

  const { data: waData, isLoading: waLoading } = useQuery({
    queryKey: ["builder-whatsapp-channel", agent?.id],
    enabled: !!agent?.id,
    queryFn: () => customFetch<BuilderWhatsappResponse>(`${DASH_API}/whatsapp/channel`),
    staleTime: 60_000,
  });

  return (
    <div className="p-6 space-y-8">
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">Communication channels</h2>
        <p className="text-[12px] text-muted-foreground max-w-3xl">
          This is where the agent becomes real. Attach the channels customers use to reach you and the channels SnapServe uses for follow-ups.
        </p>
      </section>

      <JourneyReadinessPanel form={form} agent={agent} />

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-card/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Phone</h3>
              <p className="text-[11px] text-muted-foreground">Inbound routing, outbound caller ID, and test calls.</p>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate("/app/phone-numbers")}>
              Manage numbers
            </Button>
          </div>
          {agent?.id ? (
            <AgentInboundPanel agentId={agent.id} preferredManagedNumber={form.watch("preferredManagedNumber")} />
          ) : (
            <p className="text-[11px] text-muted-foreground">Save the agent first to attach inbound phone numbers.</p>
          )}
        </div>

        <div className="rounded-xl border border-border/60 bg-card/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">WhatsApp</h3>
              <p className="text-[11px] text-muted-foreground">
                SnapServe managed, your own VoBiz number, or BYO BSP — post-call messages and chatbot replies.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate("/app/whatsapp")}>
              Configure WhatsApp
            </Button>
          </div>
          {waLoading ? (
            <Skeleton className="h-20 w-full rounded-xl" />
          ) : waData?.channel ? (
            <div className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{waData.channel.businessName || "WhatsApp channel"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {waData.channel.mode === "own" ? "Own number" : "Shared SnapServe channel"}
                    {waData.channel.phoneE164 ? ` · ${waData.channel.phoneE164}` : ""}
                  </p>
                </div>
                <StatusBadge ready={waData.channel.active} readyLabel={waData.channel.status || "Active"} emptyLabel="Inactive" />
              </div>
              {waData.usage && (
                <p className="text-[11px] text-muted-foreground">
                  Usage: {waData.usage.used24h}/{waData.usage.cap} messages in the last 24h.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/50 p-4">
              <p className="text-sm font-medium">No WhatsApp channel yet</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Connect WhatsApp if this agent should send summaries, callback reminders, or chat with leads after calls.
              </p>
            </div>
          )}
        </div>

        <EmailChannelCard forceExpanded={forceExpandEmail} />

        <div className="rounded-xl border border-border/60 bg-card/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Booking</h3>
              <p className="text-[11px] text-muted-foreground">Calendar, event type, meeting links, and booking notifications.</p>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate("/app/scheduling")}>
              Open scheduling
            </Button>
          </div>
          <div className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Calendar + event type</p>
                <p className="text-[11px] text-muted-foreground">
                  {schedulingCalendarId && schedulingEventTypeId
                    ? "Booking tools and notifications are linked."
                    : "Link scheduling before promising bookings over voice or WhatsApp."}
                </p>
              </div>
              <StatusBadge ready={!!schedulingCalendarId && !!schedulingEventTypeId} readyLabel="Linked" emptyLabel="Unlinked" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function OverviewTab({ form, agent }: { form: any; agent: any }) {
  const [openSection, setOpenSection] = useState<CardSection | null>(null);
  const [confirmDiscardSection, setConfirmDiscardSection] = useState<CardSection | null>(null);
  const sectionSnapshotRef = useRef<{ values: Record<string, any>; voiceCustomMode: boolean }>({ values: {}, voiceCustomMode: false });
  const [generateOpen, setGenerateOpen] = useState(false);
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
  const llmOptions    = LLM_MODELS[llmProvider]  ?? [];
  const ttsModelOpts  = TTS_MODELS[ttsProvider]  ?? [];
  const asrModelOpts  = ASR_MODELS[asrProvider]  ?? [];

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

  // Curated Cartesia voice list: prefer admin whitelist (language-filtered),
  // fall back to the static catalog when whitelist is empty so "Choose voice"
  // always has options. Always append the current voice if it's missing so the
  // select can display it. Always end with Paste-custom.
  const cartesiaOverviewOpts = useMemo(() => {
    const all = whitelistedData?.voices ?? [];
    const filtered = filterVoicesForLanguage(all, language);
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [];
    for (const c of myCartesiaClones) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      opts.push({ value: c.id, label: `✦ ${c.name}` });
    }
    for (const v of filtered) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      opts.push({ value: v.id, label: v.name });
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
  // selected curated voice that no longer supports the language — using the
  // SAME shared compatibility rule as the list filter, so a voice visible in
  // either section is never wiped by this effect. User-pasted custom IDs
  // (not present in the whitelist) are left untouched.
  useEffect(() => {
    if (ttsProvider !== "cartesia") return;
    const all = whitelistedData?.voices ?? [];
    if (all.length === 0) return;
    if (!ttsVoice || ttsVoice === "__custom__") return;
    const known = all.find(v => v.id === ttsVoice);
    if (!known) return; // user-pasted custom ID — leave it alone
    if (!isVoiceCompatibleWithLanguage(known.language, language)) {
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

  const ttsVoiceOpts: { value: string; label: string }[] =
    ttsProvider === "cartesia"
      ? cartesiaOverviewOpts
      : ttsProvider === "sarvam"
      ? sarvamOverviewOpts
      : ((ttsVoiceRaw ?? []) as { value: string; label: string }[]);

  const asrLabel       = ASR_PROVIDERS.find(p => p.value === asrProvider)?.label ?? asrProvider;
  const llmLabel       = LLM_PROVIDERS.find(p => p.value === llmProvider)?.label ?? llmProvider;
  const ttsLabel       = TTS_PROVIDERS.find(p => p.value === ttsProvider)?.label ?? ttsProvider;
  const langLabel      = LANGUAGES.find(l => l.value === language)?.label ?? language;
  const llmModelLabel  = llmOptions.find((m: any) => m.value === llmModel)?.label ?? llmModel;
  const curatedVoiceOpts = ttsVoiceOpts.filter(v => v.value !== "__custom__");
  const inCuratedList    = curatedVoiceOpts.some(v => v.value === ttsVoice);
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

  const agentName = form.watch("name") as string | undefined;

  return (
    <div className="flex flex-col">
      <GeneratePromptSheet
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        defaultAgentName={agentName ?? agent?.name ?? ""}
        defaultLanguage={language ?? "en-US"}
        currentPrompt={form.watch("systemPrompt") ?? ""}
        onApply={(prompt, meta) => {
          form.setValue("systemPrompt", prompt, { shouldDirty: true });
          form.setValue("systemPromptGenMeta", meta, { shouldDirty: true });
        }}
      />

      {/* ── Studio overview: pipeline → welcome → canvas ─────────────────────── */}
      <div className="relative min-w-0">
        <div className="p-5 sm:p-6 space-y-6 max-w-3xl">
          {/* Pipeline chips — top of Overview */}
          <section className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/55">Pipeline</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <AgentConfigCard
                icon={isGeminiLive ? <Globe /> : <Mic />}
                label={isGeminiLive ? "Language" : "Transcriber"}
                value={langLabel}
                subtext={isGeminiLive ? "Gemini Live conversation language" : <>{asrLabel}{asrModel ? ` · ${asrModel}` : ""}</>}
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
          </section>

          {/* Welcome / first message */}
          <section className="space-y-3">
            <div className="space-y-0.5">
              <h3 className="text-base font-semibold tracking-tight text-foreground">Agent Welcome Message</h3>
              <p className="text-[12px] text-muted-foreground">What callers hear at the start of the call.</p>
            </div>
            <div className="space-y-3 rounded-xl border border-border/50 bg-card/30 p-4">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-[12px] font-medium text-foreground/90">Who speaks first</Label>
                <FormField control={form.control} name="firstSpeaker" render={({ field }) => (
                  <Select value={field.value === "user" ? "user" : "assistant"} onValueChange={field.onChange}>
                    <SelectTrigger className="h-8 w-48 rounded-lg text-[12px] shrink-0 border-border/50">
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
                      className="min-h-[64px] max-h-[88px] text-[13px] leading-relaxed resize-none rounded-lg border-border/40 bg-background/50 px-3.5 py-2.5 shadow-none focus-visible:ring-0 focus-visible:border-foreground/20"
                      placeholder="Hello, how can I help?"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-[10px]" />
                </FormItem>
              )} />
            </div>
          </section>

          {/* Canvas — system prompt */}
          <section className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold tracking-tight text-foreground">Canvas</h3>
                  <Badge variant="secondary" className="text-[10px] font-medium px-1.5 py-0 h-5 rounded-md">
                    {langLabel}
                  </Badge>
                </div>
                <p className="text-[12px] text-muted-foreground max-w-lg">
                  How the agent talks, what it sells, and the rules it never breaks.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 text-xs gap-1.5 rounded-lg"
                onClick={() => setGenerateOpen(true)}
              >
                <Sparkles className="w-3 h-3" />
                Generate
              </Button>
            </div>
            <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden shadow-sm">
              <FormField control={form.control} name="systemPrompt" render={({ field }) => (
                <FormItem className="space-y-0">
                  <FormControl>
                    <Textarea
                      className="min-h-[320px] text-[13px] resize-none font-mono leading-[1.75] rounded-none border-0 bg-transparent px-4 pt-4 pb-3 shadow-none focus-visible:ring-0"
                      placeholder="You are a helpful voice assistant…"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-[10px] px-4 pb-2" />
                </FormItem>
              )} />
            </div>
          </section>

          {/* Phone assign — mobile/tablet only; desktop uses the action rail */}
          {agent?.id != null && (
            <AgentInboundPanel
              agentId={agent.id}
              preferredManagedNumber={form.watch("preferredManagedNumber")}
              className="xl:hidden"
            />
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
                : "Choose the speech-to-text provider, model, and language used to transcribe caller audio."
            }
          >
            {isGeminiLive && (
              <p className="text-[11px] text-muted-foreground rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                Gemini Live supports ~97 languages. Pick the primary language callers should hear and speak.
              </p>
            )}
            <div className={isGeminiLive ? "space-y-3" : "grid grid-cols-2 gap-3"}>
              <FormField control={form.control} name="language" render={({ field }) => {
                const langOpts = languagesForAgent(isGeminiLive);
                const current = field.value ?? "";
                // Keep current selection visible even if it isn't in the Live catalog.
                const options = (!isGeminiLive || !current || isGeminiLiveLanguage(current) || langOpts.some(l => l.value === current))
                  ? langOpts
                  : [{ value: current, label: LANGUAGES.find(l => l.value === current)?.label ?? current }, ...langOpts];
                return (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground">Language</FormLabel>
                  <SmallSelect value={field.value} onChange={(v) => {
                    field.onChange(v);
                    // Language alone must never force Gemini Live / swap the LLM.
                    // Users pick model + voice stack explicitly in the Model / Voice cards.
                  }}
                    options={options.map(l => ({ value: l.value, label: l.label }))} placeholder="Select language" />
                </FormItem>
                );
              }} />
              {!isGeminiLive && (
              <FormField control={form.control} name="asrProvider" render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground">Provider</FormLabel>
                  <SmallSelect value={field.value} onChange={(v) => { field.onChange(v); form.setValue("asrModel", ""); }}
                    options={ASR_PROVIDERS.map(p => ({ value: p.value, label: p.label }))} />
                </FormItem>
              )} />
              )}
              {!isGeminiLive && asrModelOpts.length > 0 && (
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
                  // Must match resolveSarvamSttMode: en → codemix, Indic → transcribe
                  const lang = form.watch("language") ?? "";
                  const autoDefault = lang.toLowerCase().startsWith("en") ? "codemix" : "transcribe";
                  const currentValue = field.value ?? autoDefault;
                  return (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] font-medium text-foreground/80">Speech Mode</FormLabel>
                    <SmallSelect value={currentValue} onChange={field.onChange}
                      options={[
                        { value: "codemix", label: "Code-mix (English + regional, e.g. Hinglish)" },
                        { value: "transcribe", label: "Transcribe (native script, e.g. हिंदी / தமிழ்)" },
                        { value: "verbatim", label: "Verbatim (exact as spoken, incl. fillers)" },
                        { value: "translit", label: "Translit (Indic speech → Roman script)" },
                        { value: "translate", label: "Translate (speech → English text)" },
                      ]} />
                    <p className="text-[9.5px] text-muted-foreground leading-snug mt-1">
                      {currentValue === "transcribe"
                        ? "Clean native-script transcript. Recommended for Indic languages."
                        : currentValue === "codemix"
                        ? "English words stay Latin; regional words stay native. Recommended for en-IN / mixed speech."
                        : currentValue === "verbatim"
                        ? "Keeps fillers and exact phrasing as spoken."
                        : currentValue === "translit"
                        ? "Writes Indic speech in Roman/Latin script."
                        : currentValue === "translate"
                        ? "Speech-to-English: any language spoken → English text."
                        : "Auto: English → code-mix, Indic → native-script transcribe."}
                    </p>
                  </FormItem>
                  );
                }} />
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
                      : "Follow along when the caller switches languages (Sarvam STT + TTS)."}
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
                      <p className="text-[9px] text-muted-foreground">Languages the agent can understand and reply in.</p>
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
            description="Choose the language model that powers the agent's responses."
          >
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
                      form.setValue("voiceStack", voiceStackForLlmModel(v));
                      if (isGeminiLiveLlmModel(v)) form.setValue("llmProvider", "google");
                    }}
                      options={llmOptions.map((m: any) => ({ value: m.value, label: m.label }))} placeholder="Default" />
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
                        <Sparkles className="h-3 w-3" />
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
                        <Sparkles className="h-3 w-3" />
                        Add Sarvam clone
                      </Button>
                    )}
                  </div>
                  {ttsProvider === "sarvam" && (
                    <p className="text-[10px] text-muted-foreground/90 leading-relaxed">
                      Default SnapServe stack · Powered by Sarvam
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
                            options={ttsVoiceOpts.map(v => ({ value: v.value, label: v.label }))}
                            placeholder="Select a voice…"
                          />
                        </FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )} />
                  )}
                  {ttsProvider === "cartesia" && (whitelistedData?.voices ?? []).length > 0 && curatedVoiceOpts.length === 0 && myCartesiaClones.length === 0 && (
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

          {/* Knowledge */}
          <section className="space-y-3 pb-4">
            <div className="space-y-0.5">
              <h3 className="text-base font-semibold tracking-tight text-foreground">Knowledge</h3>
              <p className="text-[12px] text-muted-foreground">
                Documents the agent can search during conversations.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-medium text-foreground/90">Sources</Label>
              <FormField control={form.control} name="knowledgeSourceIds" render={({ field }) => (
                <FormItem className="space-y-0">
                  <FormControl>
                    <KnowledgeSourceMultiSelect
                      value={(field.value ?? []) as number[]}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormDescription className="text-[11px] text-muted-foreground/70 mt-2 leading-relaxed">
                    Attached sources are searched during live calls and relevant entries are injected into the agent's context.
                  </FormDescription>
                  <FormMessage className="text-[10px]" />
                </FormItem>
              )} />
            </div>
          </section>

        </div>
      </div>


    </div>
  );
}

/* ── Tab: Prompt ────────────────────────────────────────────────────────────── */

function PromptTab({ form }: { form: any }) {
  const { fields: pvFields, append: pvAppend, remove: pvRemove } = useFieldArray({ control: form.control, name: "promptVariables" });
  const [generateOpen, setGenerateOpen] = useState(false);
  const agentName  = form.watch("name")     as string | undefined;
  const agentLang  = form.watch("language") as string | undefined;

  return (
    <div className="relative flex flex-col p-6 gap-4">
      <GeneratePromptSheet
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        defaultAgentName={agentName ?? ""}
        defaultLanguage={agentLang ?? "en-US"}
        currentPrompt={form.watch("systemPrompt") ?? ""}
        onApply={(prompt, meta) => {
          form.setValue("systemPrompt", prompt, { shouldDirty: true });
          form.setValue("systemPromptGenMeta", meta, { shouldDirty: true });
        }}
      />
      <FormField control={form.control} name="systemPrompt" render={({ field }) => (
        <FormItem className="flex-1 flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <FormLabel className="text-sm font-semibold">System Prompt</FormLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
              onClick={() => setGenerateOpen(true)}
            >
              <Sparkles className="w-3 h-3" />
              Generate with AI
            </Button>
          </div>
          <FormControl>
            <Textarea className="flex-1 min-h-[320px] font-mono text-sm resize-none leading-relaxed" placeholder="You are a helpful voice assistant…" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )} />
      <div className="space-y-4">
        <SectionDivider label="Call Behaviour" />
        <FormField control={form.control} name="timezone" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Agent Timezone</FormLabel>
            <SmallSelect value={field.value ?? ""} onChange={field.onChange}
              options={[{ value: "", label: "Not set" }, ...AGENT_TIMEZONES]}
              placeholder="Not set" />
            <FormDescription className="text-[10px]">Injected as current-time context</FormDescription>
          </FormItem>
        )} />
        <FormField control={form.control} name="endCallPhrases" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">End-Call Phrases (comma-separated)</FormLabel>
            <FormControl><Input placeholder="goodbye, bye, see you" className="h-8 text-xs" {...field} /></FormControl>
            <FormDescription className="text-[10px]">Agent hangs up after it says any of these phrases</FormDescription>
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

  // Shared language filter (single source of truth in agent-providers.ts):
  // English agents see ALL whitelisted voices; non-English agents see only
  // their language's voices. Identical to the Overview section's list.
  const cartesiaVoiceOpts = useMemo(() => {
    const all = whitelistedData?.voices ?? [];
    const filtered = filterVoicesForLanguage(all, agentLanguage);
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [];
    for (const c of myCartesiaClonesV) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      opts.push({ value: c.id, label: `✦ ${c.name}` });
    }
    for (const v of filtered) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      opts.push({ value: v.id, label: v.name });
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

  // When the language changes (or the whitelist finishes loading), clear a
  // selected curated voice that no longer supports the language — using the
  // SAME shared compatibility rule as the Overview section, so mounting either
  // section never wipes a compatible voice. User-pasted custom IDs (not
  // present in the whitelist) are left untouched.
  useEffect(() => {
    if (ttsProvider !== "cartesia") return;
    const all = whitelistedData?.voices ?? [];
    if (all.length === 0) return;
    if (!ttsVoice || ttsVoice === "__custom__") return;
    const known = all.find(v => v.id === ttsVoice);
    if (!known) return; // user-pasted custom ID — leave it alone
    if (!isVoiceCompatibleWithLanguage(known.language, agentLanguage)) {
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
  const ttsVoiceOptsV: { value: string; label: string }[] =
    ttsProvider === "cartesia"
      ? cartesiaVoiceOpts
      : ttsProvider === "sarvam"
      ? sarvamVoiceOptsV
      : ((ttsVoiceRawV ?? []) as { value: string; label: string }[]);

  const ttsModelOptsV = TTS_MODELS[ttsProvider] ?? [];
  const curatedVoiceOptsV = ttsVoiceOptsV.filter(v => v.value !== "__custom__");
  const inCuratedV        = curatedVoiceOptsV.some(v => v.value === ttsVoice);
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
    <div className="relative p-6 space-y-8 max-w-3xl">

      {/* ── SPEAKING ── */}
      <section className="space-y-4">
        <div>
          <h3 className="text-[13px] font-semibold text-foreground tracking-tight">Speaking</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            How the agent sounds on the call — provider, voice, speed, and model.
          </p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-3">
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
                        <Sparkles className="h-3 w-3" />
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
                        <Sparkles className="h-3 w-3" />
                        Add Sarvam clone
                      </Button>
                    )}
                  </div>
                  {ttsProvider === "sarvam" && (
                    <p className="text-[10px] text-muted-foreground leading-relaxed -mt-0.5 mb-1">
                      Default SnapServe stack · Powered by Sarvam
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
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {previewVoiceControl}
                </FormItem>
              )} />
            )}

            {ttsProvider === "cartesia" && (whitelistedData?.voices ?? []).length > 0 && curatedVoiceOptsV.length === 0 && myCartesiaClonesV.length === 0 && (
              <p className="text-xs text-amber-400/80 leading-relaxed rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 col-span-2">
                No voices available for the selected language.
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
                  <Sparkles className="h-3.5 w-3.5" />
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
      </section>

      {/* ── LISTEN ── */}
      <section className="space-y-4">
        <div>
          <h3 className="text-[13px] font-semibold text-foreground tracking-tight">Listening</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            How the agent hears the caller — noise cancel, backchannels, and ambient bed.
          </p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-3">
          <FormField control={form.control} name="noiseCancellationEnabled" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2.5">
              <div>
                <FormLabel className="text-sm">Noise Cancellation</FormLabel>
                <FormDescription className="text-[10px]">Software noise filter — VoBiz &amp; web calls are denoised upstream automatically</FormDescription>
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
      </section>

      {/* ── CALL FEEL (same fields as Advanced → Engine presets) ── */}
      <VoiceCallFeelPresets form={form} />
    </div>
  );
}

/** Voice-tab Call Engine presets — writes the same form keys as Advanced → Engine. */
function VoiceCallFeelPresets({ form }: { form: any }) {
  const asrProviderVal = form.watch("asrProvider") as string | undefined;
  const endpointMs = form.watch("asrEndpointingSilenceMs") ?? 250;
  const linearMs = form.watch("linearDelayMs") ?? 0;
  const interruptWords = form.watch("stopSpeakingNumWords") ?? 3;

  const activePreset: CallEnginePreset | "custom" = (() => {
    for (const key of Object.keys(CALL_ENGINE_PRESETS) as CallEnginePreset[]) {
      const p = CALL_ENGINE_PRESETS[key];
      if (
        endpointMs === p.asrEndpointingSilenceMs
        && linearMs === p.linearDelayMs
        && interruptWords === p.stopSpeakingNumWords
      ) return key;
    }
    return "custom";
  })();

  const applyPreset = (key: CallEnginePreset) => {
    const p = CALL_ENGINE_PRESETS[key];
    form.setValue("asrEndpointingSilenceMs", p.asrEndpointingSilenceMs, { shouldDirty: true });
    form.setValue("linearDelayMs", p.linearDelayMs, { shouldDirty: true });
    form.setValue("stopSpeakingNumWords", p.stopSpeakingNumWords, { shouldDirty: true });
    form.setValue("stopSpeakingVoiceSecs", voiceSecondsFromInterruptWords(p.stopSpeakingNumWords), { shouldDirty: true });
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[13px] font-semibold text-foreground tracking-tight">Phone feel</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          How quickly the agent takes the turn — same Call Engine knobs as Advanced → Engine.
        </p>
        {asrProviderVal === "sarvam" && (
          <p className="text-[11px] text-muted-foreground mt-1">
            Note: the silence-window part of these presets applies to Azure STT only — Sarvam&apos;s
            server-side VAD is fixed at ~0.5s. Pacing delay and interruption sensitivity still apply.
          </p>
        )}
      </div>
      <div className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {([
            { id: "fast" as const, label: "Fast", hint: "Snappy barge / short silence" },
            { id: "balanced" as const, label: "Balanced", hint: "Default natural pace" },
            { id: "patient" as const, label: "Patient", hint: "Lets callers pause longer" },
          ]).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              title={p.hint}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[11.5px] font-medium border transition-all",
                activePreset === p.id
                  ? "bg-primary/15 text-primary border-primary/40"
                  : "border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              {p.label}
            </button>
          ))}
          {activePreset === "custom" && (
            <span className="px-2.5 py-1.5 rounded-lg text-[11px] text-muted-foreground/80 border border-dashed border-border/50">
              Custom
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Fine-tune endpointing, linear delay, and interrupt words on{" "}
          <span className="text-foreground/80">Advanced → Engine</span>.
        </p>
      </div>
    </section>
  );
}


/* ── Tab: Tools ─────────────────────────────────────────────────────────────── */

function ToolsTab({ form, agentId }: { form: any; agentId: number | undefined }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "tools" });
  const genderEnabled = form.watch("genderDetectionEnabled") ?? false;
  const voiceMemoryEnabled = form.watch("voiceMemoryEnabled") ?? false;
  const recordingEnabled = form.watch("recordingEnabled") ?? true;
  const watchedTools  = (form.watch("tools") ?? []) as any[];
  const { toast } = useToast();

  const { data: calendarsData } = useListCalendars();
  const schedulingCalendarId = form.watch("schedulingCalendarId");
  const schedulingEventTypeId = form.watch("schedulingEventTypeId");
  const agentCalendar = schedulingCalendarId != null
    ? (calendarsData ?? []).find((cal: any) => cal.id === schedulingCalendarId)
    : agentId ? (calendarsData ?? []).find((cal: any) => cal.agentId === agentId) : undefined;
  const calendarIdForEt = agentCalendar?.id;
  const { data: agentEventTypes } = useListEventTypes(
    calendarIdForEt ? { calendarId: calendarIdForEt } : undefined,
    { query: { enabled: !!calendarIdForEt, queryKey: ["agent-event-types", calendarIdForEt ?? null] } }
  );

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
    end_call: "end_call",
    send_email: "send_email",
    send_whatsapp: "send_whatsapp",
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


  const BOOKING_TOOLS_ICONS: Record<string, React.ReactElement> = {
    native_booking:            <BookOpen className="h-4 w-4" />,
    native_check_availability: <Sparkles className="h-4 w-4" />,
    native_list_bookings:      <List className="h-4 w-4" />,
    native_reschedule:         <Pencil className="h-4 w-4" />,
    native_cancel:             <X className="h-4 w-4" />,
  };
  const BOOKING_TOOLS = [
    { type: "native_booking",           fnName: "book_appointment",   color: "emerald", label: "Book Appointment",    description: "Lets the agent book a meeting slot for the caller. Agent collects name, email, and preferred time, then confirms the booking live.",    icon: BOOKING_TOOLS_ICONS["native_booking"] },
    { type: "native_check_availability", fnName: "check_availability", color: "sky",     label: "Check Availability", description: "Enables the agent to look up open slots before suggesting a time. Use alongside Book Appointment for a natural booking flow.",             icon: BOOKING_TOOLS_ICONS["native_check_availability"] },
    { type: "native_list_bookings",      fnName: "list_bookings",      color: "violet",  label: "List Bookings",      description: "Allows the agent to retrieve existing bookings for the caller — useful for reschedule or cancellation flows.",                           icon: BOOKING_TOOLS_ICONS["native_list_bookings"] },
    { type: "native_reschedule",         fnName: "reschedule_booking", color: "amber",   label: "Reschedule Booking", description: "Lets the agent reschedule an existing booking to a new time slot chosen by the caller.",                                                icon: BOOKING_TOOLS_ICONS["native_reschedule"] },
    { type: "native_cancel",             fnName: "cancel_booking",     color: "red",     label: "Cancel Booking",     description: "Allows the agent to cancel an upcoming booking on the caller's request.",                                                               icon: BOOKING_TOOLS_ICONS["native_cancel"] },
  ];

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
    {
      type: "send_email",
      icon: <Mail className="h-4 w-4" />,
      color: "sky",
      label: "Send Email",
      description: "Lets the agent email the caller mid-call using Channels → Email (SnapServe managed or your Brevo). Asks for their address, then sends the channel template.",
      needsEventType: false,
    },
    {
      type: "send_whatsapp",
      icon: <MessageCircle className="h-4 w-4" />,
      color: "emerald",
      label: "Send WhatsApp",
      description: "Lets the agent send a WhatsApp template mid-call via Instant/Business or your BSP webhook. Uses the caller’s phone unless they give another number.",
      needsEventType: false,
    },
  ] as const;

  const colorMap: Record<string, { border: string; bg: string; iconBg: string; iconText: string; label: string; badge: string; badgeText: string; active: string }> = {
    emerald: { border: "border-emerald-500/40", bg: "bg-emerald-500/10", iconBg: "bg-emerald-500/15", iconText: "text-emerald-600 dark:text-emerald-400", label: "text-emerald-700 dark:text-emerald-300", badge: "bg-emerald-500/20", badgeText: "text-emerald-700 dark:text-emerald-300", active: "" },
    sky:     { border: "border-sky-500/40",     bg: "bg-sky-500/10",     iconBg: "bg-sky-500/15",     iconText: "text-sky-600 dark:text-sky-400",     label: "text-sky-700 dark:text-sky-300",     badge: "bg-sky-500/20",     badgeText: "text-sky-700 dark:text-sky-300",     active: "" },
    violet:  { border: "border-violet-500/40",  bg: "bg-violet-500/10",  iconBg: "bg-violet-500/15",  iconText: "text-violet-600 dark:text-violet-400",  label: "text-violet-700 dark:text-violet-300",  badge: "bg-violet-500/20",  badgeText: "text-violet-700 dark:text-violet-300",  active: "" },
    amber:   { border: "border-amber-500/40",   bg: "bg-amber-500/10",   iconBg: "bg-amber-500/15",   iconText: "text-amber-600 dark:text-amber-400",   label: "text-amber-700 dark:text-amber-300",   badge: "bg-amber-500/20",   badgeText: "text-amber-700 dark:text-amber-300",   active: "" },
    red:     { border: "border-red-500/40",     bg: "bg-red-500/10",     iconBg: "bg-red-500/15",     iconText: "text-red-600 dark:text-red-400",     label: "text-red-700 dark:text-red-300",     badge: "bg-red-500/20",     badgeText: "text-red-700 dark:text-red-300",     active: "" },
    slate:   { border: "border-slate-500/40",   bg: "bg-slate-500/10",   iconBg: "bg-slate-500/15",   iconText: "text-slate-600 dark:text-slate-400",   label: "text-slate-700 dark:text-slate-300",   badge: "bg-slate-500/20",   badgeText: "text-slate-700 dark:text-slate-300",   active: "" },
  };

  return (
    <div className="relative p-6 space-y-6">

      {/* ── Platform Tools ─── */}
      <div>
        <h3 className="text-sm font-semibold mb-0.5">Platform Tools</h3>
        <p className="text-xs text-muted-foreground mb-3">Built-in capabilities you can enable for this agent</p>

        <div className="space-y-2">

        {/* ── Booking Tools ── */}
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 px-0.5 mb-1 mt-3">Scheduling & Bookings</p>
        {/* Event type picker — shared across all booking tools */}
        <div className="rounded-xl border border-border/40 bg-card/20 px-4 py-3 flex items-center gap-3 mb-2">
          <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-[11px] text-muted-foreground/70">
              {agentCalendar ? (
                <>Calendar: <span className="font-medium text-foreground/80">{agentCalendar.name}</span></>
              ) : "Event type used by booking tools"}
            </p>
            <Select
              value={schedulingEventTypeId != null ? String(schedulingEventTypeId) : "__none__"}
              onValueChange={v => form.setValue("schedulingEventTypeId", v === "__none__" ? null : Number(v), { shouldDirty: true })}
              disabled={!calendarIdForEt}
            >
              <SelectTrigger className="h-7 text-xs bg-background/50">
                <SelectValue placeholder="Any event type">
                  {schedulingEventTypeId != null
                    ? agentEventTypes == null
                      ? "Loading…"
                      : ((agentEventTypes as any[]).find((e: any) => e.id === schedulingEventTypeId)?.title
                         || (agentEventTypes as any[]).find((e: any) => e.id === schedulingEventTypeId)?.name
                         || undefined)
                    : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs text-muted-foreground">Any event type</SelectItem>
                {(agentEventTypes ?? []).map((et: any) => (
                  <SelectItem key={et.id} value={String(et.id)} className="text-xs">{et.title || et.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {calendarIdForEt && (agentEventTypes ?? []).length === 0 && (
              <p className="text-[10px] text-amber-400/80">No event types yet. Create one in Scheduling → Event Types.</p>
            )}
          </div>
        </div>
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
              <div className="w-full text-left p-4 flex items-start gap-3">
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
                  <Switch checked={isOn} onCheckedChange={() => toggleNativeTool(type)} />
                </div>
              </div>
              {isOn && (
                <div className="px-4 pb-4 -mt-1">
                  <div className="border-t border-border/30 pt-3 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      {!agentId ? (
                        <p className="text-[10px] text-amber-400/80">Save agent first to link calendar tools.</p>
                      ) : !agentCalendar ? (
                        <p className="text-[10px] text-amber-400/80">No calendar found for this agent.</p>
                      ) : !(agentCalendar as any).connectedGoogleEmail ? (
                        <>
                          <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded", c.badge, c.badgeText)}>{agentCalendar.name || "Calendar"}</span>
                          <span className="text-[10px] text-amber-400/80">No Google account connected.</span>
                        </>
                      ) : (
                        <>
                          <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded", c.badge, c.badgeText)}>{agentCalendar.name || "Calendar"}</span>
                          <span className="text-[10px] text-muted-foreground/60">
                            {(agentCalendar as any).connectedGoogleAccountsCount > 1
                              ? `${(agentCalendar as any).connectedGoogleAccountsCount} accounts`
                              : (agentCalendar as any).connectedGoogleEmail}
                          </span>
                        </>
                      )}
                    </div>
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
              <div className="w-full text-left p-4 flex items-start gap-3">
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
                  <Switch checked={isOn} onCheckedChange={() => toggleNativeTool(type)} />
                </div>
              </div>
            </div>
          );
        })}

        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 px-0.5 mb-1 mt-4">Recording</p>
        {/* Call Recording card */}
        <div className={cn("rounded-xl border transition-all duration-150", recordingEnabled ? "border-border/70 bg-card/40" : "border-border/40 bg-card/20")}>
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => { if (!e.nativeEvent.isTrusted) return; form.setValue("recordingEnabled", !recordingEnabled, { shouldDirty: true }); }}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); form.setValue("recordingEnabled", !recordingEnabled, { shouldDirty: true }); } }}
            className="w-full text-left p-4 flex items-start gap-3 cursor-pointer"
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
          </div>
        </div>

        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 px-0.5 mb-1 mt-4">Caller Intelligence</p>
        {/* Gender Identification card */}
        <div className={cn("rounded-xl border transition-all duration-150", genderEnabled ? "border-border/70 bg-card/40" : "border-border/40 bg-card/20")}>
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => { if (!e.nativeEvent.isTrusted) return; form.setValue("genderDetectionEnabled", !genderEnabled, { shouldDirty: true }); }}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); form.setValue("genderDetectionEnabled", !genderEnabled, { shouldDirty: true }); } }}
            className="w-full text-left p-4 flex items-start gap-3 cursor-pointer"
          >
            <div className="mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-muted/30">
              <User2 className={cn("h-4 w-4", genderEnabled ? "text-foreground/70" : "text-muted-foreground/35")} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-foreground/80">Gender Identification</span>
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">Beta</span>
              </div>
              <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
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
        <div className={cn("rounded-xl border transition-all duration-150", voiceMemoryEnabled ? "border-border/70 bg-card/40" : "border-border/40 bg-card/20")}>
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => { if (!e.nativeEvent.isTrusted) return; form.setValue("voiceMemoryEnabled", !voiceMemoryEnabled, { shouldDirty: true }); }}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); form.setValue("voiceMemoryEnabled", !voiceMemoryEnabled, { shouldDirty: true }); } }}
            className="w-full text-left p-4 flex items-start gap-3 cursor-pointer"
          >
            <div className="mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-muted/30">
              <AudioLines className={cn("h-4 w-4", voiceMemoryEnabled ? "text-foreground/70" : "text-muted-foreground/35")} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-foreground/80">Voice Memory</span>
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">Beta</span>
              </div>
              <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                Remembers the caller&apos;s voiceprint. Detects mid-call handoffs (phone given to someone else) and can link the same voice across different phone numbers. Phone-number memory stays primary.
              </p>
              {voiceMemoryEnabled && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed mt-1.5">
                  Soft signal only — not identity verification. Requires the voice-analysis service. On handoff the agent asks who it&apos;s speaking with and stops using the previous person&apos;s name/salutation until confirmed.
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
                        ? <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"><Webhook className="h-3 w-3" />Custom Function</span>
                        : <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"><PhoneForwarded className="h-3 w-3" />Call Transfer</span>
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
                    <div className="space-y-3">
                      <FormField control={form.control} name={`tools.${index}.warmHandoffMessage`} render={({ field: f }) => (
                        <FormItem className="space-y-1">
                          <FormLabel className="text-[10px] text-muted-foreground">Warm Handoff Message</FormLabel>
                          <FormControl><Input placeholder="Connecting you with a specialist now…" className="h-8 text-xs" {...f} /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`tools.${index}.transferMode`} render={({ field: f }) => (
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
                      {form.watch(`tools.${index}.transferMode`) === "warm_summary" && (
                        <FormField control={form.control} name={`tools.${index}.summaryPrompt`} render={({ field: f }) => (
                          <FormItem className="space-y-1">
                            <FormLabel className="text-[10px] text-muted-foreground">Briefing Prompt (optional)</FormLabel>
                            <FormControl><Textarea className="min-h-[60px] text-xs resize-none" placeholder="Default: customer name, core issue, urgency, and key context the agent needs." {...f} /></FormControl>
                          </FormItem>
                        )} />
                      )}
                    </div>
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
    <div className="relative p-6 space-y-5 max-w-xl">
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
    </div>
  );
}

/* ── Tab: Advanced ──────────────────────────────────────────────────────────── */

type AdvSection = "engine" | "limits" | "compliance" | "integrations";

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
  const [section, setSection] = useState<AdvSection>("engine");
  const [traiConfirmOpen, setTraiConfirmOpen] = useState(false);
  const [dpdpConfirmOpen, setDpdpConfirmOpen] = useState(false);
  const [irdaiConfirmOpen, setIrdaiConfirmOpen] = useState(false);

  // Surface webhook validation errors on the Integrations sub-tab
  useEffect(() => {
    if (form.formState.errors?.webhookUrl || form.formState.errors?.webhookSecret) {
      setSection("integrations");
    }
  }, [form.formState.errors?.webhookUrl, form.formState.errors?.webhookSecret]);

  const bargeIn = form.watch("bargeInEnabled");
  const asrProviderVal = form.watch("asrProvider") as string | undefined;
  const endpointMs = form.watch("asrEndpointingSilenceMs") ?? 250;
  const linearMs = form.watch("linearDelayMs") ?? 0;
  const interruptWords = form.watch("stopSpeakingNumWords") ?? 3;

  const activePreset: CallEnginePreset | "custom" = (() => {
    for (const key of Object.keys(CALL_ENGINE_PRESETS) as CallEnginePreset[]) {
      const p = CALL_ENGINE_PRESETS[key];
      if (
        endpointMs === p.asrEndpointingSilenceMs
        && linearMs === p.linearDelayMs
        && interruptWords === p.stopSpeakingNumWords
      ) return key;
    }
    return "custom";
  })();

  const applyPreset = (key: CallEnginePreset) => {
    const p = CALL_ENGINE_PRESETS[key];
    form.setValue("asrEndpointingSilenceMs", p.asrEndpointingSilenceMs, { shouldDirty: true });
    form.setValue("linearDelayMs", p.linearDelayMs, { shouldDirty: true });
    form.setValue("stopSpeakingNumWords", p.stopSpeakingNumWords, { shouldDirty: true });
    form.setValue("stopSpeakingVoiceSecs", voiceSecondsFromInterruptWords(p.stopSpeakingNumWords), { shouldDirty: true });
  };

  const nav: { id: AdvSection; icon: React.ReactNode; label: string }[] = [
    { id: "engine",       icon: <Timer className="h-3.5 w-3.5" />,       label: "Engine"       },
    { id: "limits",       icon: <Gauge className="h-3.5 w-3.5" />,       label: "Limits"       },
    { id: "integrations", icon: <Webhook className="h-3.5 w-3.5" />,     label: "Integrations" },
    { id: "compliance",   icon: <ShieldCheck className="h-3.5 w-3.5" />, label: "Compliance"   },
  ];

  return (
    <div className="flex flex-col">
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
      <div className="px-5 py-5 space-y-4">

        {/* ── ENGINE ── */}
        {section === "engine" && (
          <>
            <div>
              <h3 className="text-[13px] font-semibold text-foreground">Call Engine</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                The few knobs that actually drive live calls — interrupt words, when the turn ends, and how long to wait before the agent speaks.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {([
                { id: "fast" as const, label: "Fast" },
                { id: "balanced" as const, label: "Balanced" },
                { id: "patient" as const, label: "Patient" },
              ]).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[11.5px] font-medium border transition-all",
                    activePreset === p.id
                      ? "bg-primary/15 text-primary border-primary/30"
                      : "border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent/40",
                  )}
                >
                  {p.label}
                </button>
              ))}
              {activePreset === "custom" && (
                <span className="px-2 py-1.5 text-[11px] text-muted-foreground/70">Custom</span>
              )}
            </div>

            <div className="space-y-5 rounded-xl border border-border/50 bg-card/40 p-4">
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
                name="asrEndpointingSilenceMs"
                label="Endpointing"
                hint={asrProviderVal === "sarvam"
                  ? "Not used with Sarvam — use the pause-detection controls below."
                  : "Milliseconds of silence after the caller stops before we finalize the turn (Azure + Deepgram). Fast 150 · Balanced 250 · Patient 500."}
                min={100}
                max={800}
                step={25}
                fmt={(v) => `${v}ms`}
                disabled={asrProviderVal === "sarvam"}
              />

              {asrProviderVal === "sarvam" && (
                <>
                  <FormField control={form.control} name="sarvamHighVadSensitivity" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between gap-3 py-1">
                      <div>
                        <FormLabel className="text-[12px] font-medium text-foreground/90">Detect pauses quickly</FormLabel>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                          Default off — avoids cutting callers mid-sentence on phone audio. Turn on only if replies feel too slow.
                        </p>
                      </div>
                      <FormControl>
                        <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <AdvSlider
                    form={form}
                    name="sarvamSpeechEndFlushMs"
                    label="Reply kickoff delay"
                    hint="Tiny pause after the caller finishes before the agent starts thinking. Default 80ms."
                    min={0}
                    max={200}
                    step={10}
                    fmt={(v) => `${v}ms`}
                  />
                  <AdvSlider
                    form={form}
                    name="sarvamIncompleteHoldMs"
                    label="Wait for unfinished thoughts"
                    hint="Extra wait when someone seems mid-sentence (e.g. “I want…”). Default 700ms."
                    min={50}
                    max={1000}
                    step={10}
                    fmt={(v) => `${v}ms`}
                  />
                </>
              )}

              <AdvSlider
                form={form}
                name="linearDelayMs"
                label="Linear delay"
                hint="Extra wait after end-of-turn before the agent speaks — covers mid-sentence pauses. Default off (0)."
                min={0}
                max={1500}
                step={50}
                fmt={(v) => (v === 0 ? "off" : `${v}ms`)}
              />

              <AdvSlider
                form={form}
                name="fragmentCoalesceListeningMs"
                label="Fragment hold (listening)"
                hint="Hold short STT fragments while agent is silent. 0 = off. Default 500ms."
                min={0}
                max={2000}
                step={50}
                fmt={(v) => (v === 0 ? "off" : `${v}ms`)}
              />

              <AdvSlider
                form={form}
                name="fragmentCoalescePlayingMs"
                label="Fragment hold (playing)"
                hint="Hold short acks while agent is speaking. 0 = off. Default 1000ms."
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

              <FormField control={form.control} name="silenceTimeoutSeconds" render={({ field }) => {
                const val = field.value ?? 30;
                const pct = ((val - 5) / (120 - 5)) * 100;
                return (
                  <FormItem className="space-y-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <FormLabel className="text-[12px] font-medium text-foreground/90">Silence check-in</FormLabel>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                          If the caller is silent this long, play a check-in / end the call.
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
          </>
        )}

        {/* ── LIMITS ── */}
        {section === "limits" && (
          <>
            {/* ── Auto-Redial on Drop ── */}
            <div>
              <h3 className="text-[13px] font-semibold text-foreground">Auto-Redial on Drop</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                When a call ends unexpectedly (network drop, accidental hang-up), automatically schedule a callback to the same number.
              </p>
            </div>
            <div className="space-y-4 rounded-xl border border-border/50 bg-card/40 p-4">
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

            <div>
              <h3 className="text-[13px] font-semibold text-foreground">Call Limits</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Hard cut-off for call duration. Silence check-in lives on Engine.
              </p>
            </div>
            <div className="space-y-5 rounded-xl border border-border/50 bg-card/40 p-4">
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

        {/* ── INTEGRATIONS ── */}
        {section === "integrations" && (
          <>
            <div>
              <h3 className="text-[13px] font-semibold text-foreground">CRM / post-call webhook</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Notify your CRM or Zap after a call ends. Separate from Journey lead intake — leave blank if you only need intake.
              </p>
            </div>
            <div className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-4">
              <FormField control={form.control} name="webhookUrl" render={({ field }) => {
                const val = field.value ?? "";
                const isEmail = val.includes("@") && !val.startsWith("http");
                const isHttp  = val.length > 0 && val.startsWith("http://");
                return (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">Webhook URL</FormLabel>
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
                    Sent as <code className="font-mono bg-muted px-0.5 rounded">X-Webhook-Signature</code> header so you can verify the payload wasn't tampered with.
                  </FormDescription>
                </FormItem>
              )} />
            </div>

            <DispositionSettingsPanel agentId={agent?.id ?? 0} />
          </>
        )}

      </div>
    </div>
  );
}

/* ── Agent list panel ───────────────────────────────────────────────────────── */

function AgentListPanel({ selectedId, onSelect, rateMap, className }: {
  selectedId: number | null;
  onSelect: (id: number) => void;
  rateMap: Map<string, number>;
  className?: string;
}) {
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: agents, isLoading } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });
  const deleteAgent = useDeleteAgent();
  const userProviderNames = useUserProviderNames();
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

  const filtered = (agents ?? [])
    .filter(a => {
      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
  const liveCount = (agents ?? []).filter(a => a.status === "active").length;
  const totalCount = agents?.length ?? 0;

  return (
    <div className={cn("w-[260px] shrink-0 border-r border-border/40 flex flex-col h-full bg-background/30 backdrop-blur-sm", className)}>
      <div className="p-4 border-b border-border/40 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-left min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">Agents</p>
            <p className="text-sm font-semibold text-foreground truncate">
              {isLoading ? "…" : `${totalCount} agent${totalCount === 1 ? "" : "s"}`}
              {!isLoading && totalCount > 0 && (
                <span className="text-muted-foreground font-normal"> · {liveCount} live</span>
              )}
            </p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search agents…" className="h-8 pl-8 text-xs rounded-full bg-muted/20 border-border/40" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-3 py-3 rounded-xl"><Skeleton className="h-4 w-3/4 mb-1.5" /><Skeleton className="h-3 w-1/2" /></div>
        ))}
        {!isLoading && filtered.length === 0 && (
          <div className="px-3 py-10 text-center space-y-2">
            {search ? (
              <>
                <p className="text-xs font-medium text-foreground">No matches</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">Try a different filter or clear the search.</p>
              </>
            ) : (
              <>
                <p className="text-xs font-medium text-foreground">No agents yet</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">Create one manually or build with Vibe.</p>
                <Button size="sm" className="h-8 rounded-full text-xs gap-1" onClick={() => navigate("/app/vibe")}>
                  <Sparkles className="h-3 w-3" /> Build with AI
                </Button>
              </>
            )}
          </div>
        )}
        {filtered.map(agent => {
          const isSelected = agent.id === selectedId;
          const isLive = agent.status === "active";
          const costCents = computeAgentRateCents(rateMap, agent as any, userProviderNames);
          return (
            <div
              key={agent.id}
              onClick={() => onSelect(agent.id)}
              className={cn(
                "group relative w-full text-left rounded-xl px-3 py-2.5 transition-all border cursor-pointer",
                isSelected
                  ? "bg-card/80 border-border/60 shadow-sm"
                  : "border-transparent hover:bg-muted/30 hover:border-border/30",
              )}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[13px] font-medium truncate flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="truncate">{agent.name}</span>
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={cn(
                    "rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide border",
                    isLive
                      ? "bg-emerald-500/12 text-emerald-400 border-emerald-500/25"
                      : "bg-muted/40 text-muted-foreground border-border/50",
                  )}>
                    {isLive ? "Live" : "Draft"}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteItem(e, agent.id, agent.name)}
                    disabled={deletingId === agent.id}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-all"
                    title={`Delete ${agent.name}`}
                    aria-label={`Delete ${agent.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 bg-muted/30 text-muted-foreground border-border/40">
                  Voice
                </span>
                <span className="text-[10px] text-muted-foreground/75 truncate">{agent.asrProvider} · {agent.ttsProvider}</span>
                {costCents ? <span className="text-[10px] text-muted-foreground/55 ml-auto shrink-0">₹{(costCents / 100).toFixed(2)}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="p-3 border-t border-border/40">
        <button
          type="button"
          onClick={() => navigate("/app/vibe")}
          className="w-full flex items-center gap-2 rounded-xl border border-border/40 bg-primary/5 hover:bg-primary/10 px-3 py-2.5 text-left transition-colors"
        >
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-foreground">Vibe Build</p>
            <p className="text-[10px] text-muted-foreground truncate">Create with AI in minutes</p>
          </div>
        </button>
      </div>
    </div>
  );
}

/* ── Tab: Analysis (Journey) ────────────────────────────────────────────────── */

type DispositionCategory = { id: string; name: string; values: string };

function DispositionSettingsPanel({ agentId }: { agentId: number }) {
  const { toast } = useToast();
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

  if (agentId <= 0) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Tag className="h-4 w-4 text-amber-400" />
          <h3 className="text-[13px] font-semibold text-foreground">Call Disposition</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Save the agent first to define disposition categories.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-amber-400" />
          <h3 className="text-[13px] font-semibold text-foreground">Call Disposition</h3>
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
      <p className="text-[11px] text-muted-foreground mb-4">
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
  );
}

function AnalysisTab({
  form,
  agentId,
  onConfigureEmail,
  onOpenChannels,
}: {
  form: any;
  agentId: number;
  onConfigureEmail?: () => void;
  onOpenChannels?: () => void;
}) {
  return (
    <div className="relative p-6 space-y-8">
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">Journey</h2>
        <p className="text-[12px] text-muted-foreground max-w-3xl">
          Attach one auto-pilot sequence to this agent: lead in → call → WhatsApp/email/callback. Channels hold WhatsApp &amp; Email; CRM webhook and disposition live under Advanced → Integrations.
        </p>
      </section>

      <JourneyPanel
        agentId={agentId}
        webhookUrl={form.watch("webhookUrl")}
        onConfigureEmail={onConfigureEmail}
        onOpenChannels={onOpenChannels}
      />
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
  { label: "Call Settings", keys: ["maxDuration", "silenceTimeoutSeconds", "language", "webhookUrl", "noiseCancellationEnabled", "backchannelingEnabled"] },
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
  webhookUrl: "Webhook URL",
  noiseCancellationEnabled: "Noise Cancellation",
  backchannelingEnabled: "Backchannel",
  tools: "Tools",
  knowledgeSourceIds: "Knowledge Sources",
  schedulingCalendarId: "Scheduling Calendar",
  schedulingEventTypeId: "Event Type",
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
      "flex items-start gap-4 px-5 py-4 hover:bg-muted/10 transition-colors",
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
    <div className="flex flex-col">
      {/* Header strip */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-primary" />
          Version History
        </div>
        {productionVersion && (
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setRestoreTarget(productionVersion)}>
            <RotateCcw className="h-3 w-3" /> Restore Last Working Version
          </Button>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b border-border/60 shrink-0 px-1">
        <button
          type="button"
          onClick={() => setActiveSubTab("published")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors",
            activeSubTab === "published"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Published Versions
          <Badge variant="outline" className="text-[10px] h-4 px-1">{activePublished.length}</Badge>
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("drafts")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors",
            activeSubTab === "drafts"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Draft History
          <Badge variant="outline" className="text-[10px] h-4 px-1">{draftVersions.length}</Badge>
        </button>
      </div>

      {/* Published Versions sub-tab */}
      {activeSubTab === "published" && (
        <>
          {/* Usage indicator */}
          {!isLoading && publishedVersions.length > 0 && (
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
              <div className="px-5 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 bg-muted/10 border-y border-border/30">
                {label}
              </div>
              <div className="divide-y divide-border/30">
                {items.map((v) => (
                  <div key={v.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/10 transition-colors">
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
        <div className="shrink-0 border-t border-primary/30 bg-primary/5 px-5 py-3 flex items-center gap-3">
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

function AgentEditorPanel({ agentId, onOpenAgents }: { agentId: number; onOpenAgents?: () => void }) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [forceExpandEmail, setForceExpandEmail] = useState(false);
  const tabContentRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Partial<Record<TabId, number>>>({});
  const agentResetSigRef = useRef<string | null>(null);

  const handleTabClick = (tabId: TabId) => {
    if (tabContentRef.current) {
      scrollPositions.current[activeTab] = tabContentRef.current.scrollTop;
    }
    if (tabId !== "channels") setForceExpandEmail(false);
    setActiveTab(tabId);
  };

  const openEmailChannel = () => {
    setForceExpandEmail(true);
    handleTabClick("channels");
  };

  const openChannels = () => {
    handleTabClick("channels");
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
  const [, navigate] = useLocation();

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

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: "", description: "", asrProvider: "sarvam", asrModel: "saaras:v3",
      llmProvider: "groq", llmModel: "llama-3.3-70b-versatile", ttsProvider: "sarvam",
      ttsVoice: "priya", ttsModel: "bulbul:v3", telephonyProvider: "vobiz",
      systemPrompt: "", temperature: 0.40, maxDuration: 480,
      greetingMessage: "Hello", firstSpeaker: "assistant", endCallPhrases: "", silenceTimeoutSeconds: 30,
      language: "en-US", asrLanguage: "", backchannelingEnabled: true,
      backchannelingFrequency: 0.5, webhookUrl: "",
      webhookSecret: "", noiseCancellationEnabled: true,
      ambientNoiseEnabled: false, ambientNoiseTrack: "", ambientNoiseVolume: 1.0, promptVariables: [],
      vadSilenceMs: 350, bargeInEnabled: true, bargeInEnergyThreshold: 1200,
      bargeInMinFrames: 4, micSensitivity: "normal", timezone: "", machineDetectionMode: "disabled",
      voicemailAction: "hangup",
      voicemailMessage: "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      voicemailLeadInSeconds: 2,
      tools: [], genderDetectionEnabled: false, voiceMemoryEnabled: false, recordingEnabled: true, languageAutoDetect: false,
      multilingualLanguages: [], sarvamIndicNumbers: true,
      autoSwitchToEnglish: false,
      startSpeakingWaitSecs: 0, startSpeakingOnPunctuationSecs: 0.1,
      startSpeakingOnNoPunctuationSecs: 0.1, startSpeakingOnNumberSecs: 0.1,
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
      asrEndpointingSilenceMs: 250,
      llmMaxTokens: 200,
      ttsMinSentenceChars: 18,
      ttsSpeed: 1,
      linearDelayMs: 0,
      fragmentCoalesceListeningMs: 500,
      fragmentCoalescePlayingMs: 1000,
      telephonyTailDrainMs: 400,
      sarvamHighVadSensitivity: false,
      sarvamSpeechEndFlushMs: 80,
      sarvamIncompleteHoldMs: 700,
      kbBakedOnly: false,
      autoRedialEnabled: true,
      autoRedialMaxAttempts: 3,
      schedulingCalendarId: null,
      schedulingEventTypeId: null,
      voiceStack: "classic",
      geminiLiveVoiceName: "Kore",
      geminiLiveThinkingLevel: "minimal",
    },
  });

  const preferredManagedWatch = form.watch("preferredManagedNumber");
  const { data: managedPhoneData } = useQuery({
    queryKey: ["phone-numbers", "managed"],
    queryFn: () => customFetch<{ numbers: string[] }>(`${DASH_API}/phone-numbers/managed`),
    staleTime: 5 * 60 * 1000,
  });
  const outboundTestingFrom =
    (typeof preferredManagedWatch === "string" && preferredManagedWatch.trim())
      ? preferredManagedWatch.trim()
      : (managedPhoneData?.numbers?.[0] ?? null);

  useEffect(() => {
    if (!agent) return;
    // Only reset when the agent's DATA actually changes (id + server updatedAt),
    // not on every render. `agent` from useGetAgent can be a fresh object
    // reference across renders; a bare `[agent]` dep made form.reset() run every
    // render → re-render → loop (React #185 "Maximum update depth exceeded").
    const resetSig = `${agent.id}:${(agent as any).updatedAt ?? ""}`;
    if (agentResetSigRef.current === resetSig) return;
    agentResetSigRef.current = resetSig;
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
      language:                 agent.language ?? "en-US",
      asrLanguage:              agent.asrLanguage ?? "",
      backchannelingEnabled:    agent.backchannelingEnabled ?? true,
      backchannelingFrequency:  agent.backchannelingFrequency ?? 0.5,
      webhookUrl:               (agent.webhookUrl && agent.webhookUrl.startsWith("https://")) ? agent.webhookUrl : "",
      webhookSecret:            (agent as any).agentConfig?.webhookSecret ?? "",
      noiseCancellationEnabled: agent.noiseCancellationEnabled ?? true,
      ambientNoiseEnabled:      (agent as any).agentConfig?.ambientNoiseEnabled ?? false,
      ambientNoiseTrack:        (agent as any).agentConfig?.ambientNoiseTrack ?? "",
      ambientNoiseVolume:       (agent as any).agentConfig?.ambientNoiseVolume ?? 1.0,
      promptVariables:          ((agent as any).agentConfig?.promptVariables ?? []) as AgentFormValues["promptVariables"],
      vadSilenceMs:             (agent as any).agentConfig?.vadSilenceMs ?? 350,
      bargeInEnabled:           (agent as any).agentConfig?.bargeInEnabled ?? true,
      bargeInEnergyThreshold:   clampBargeInEnergyThreshold((agent as any).agentConfig?.bargeInEnergyThreshold ?? 1200),
      bargeInMinFrames:         (agent as any).agentConfig?.bargeInMinFrames ?? 4,
      micSensitivity:           ((agent as any).agentConfig?.micSensitivity ?? "normal") as AgentFormValues["micSensitivity"],
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
      startSpeakingOnPunctuationSecs:   (agent as any).agentConfig?.startSpeakingPlan?.onPunctuationSeconds   ?? 0.1,
      startSpeakingOnNoPunctuationSecs: (agent as any).agentConfig?.startSpeakingPlan?.onNoPunctuationSeconds ?? 0.1,
      startSpeakingOnNumberSecs:        (agent as any).agentConfig?.startSpeakingPlan?.onNumberSeconds        ?? 0.1,
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
      ttsMinSentenceChars:             (agent as any).agentConfig?.ttsMinSentenceChars ?? 15,
      ttsSpeed:                        (agent as any).agentConfig?.ttsSpeed ?? 1,
      linearDelayMs:                   clampLinearDelayMs((agent as any).agentConfig?.incrementalDelay ?? 0),
      fragmentCoalesceListeningMs:     clampFragmentCoalesceListeningMs((agent as any).agentConfig?.fragmentCoalesceListeningMs),
      fragmentCoalescePlayingMs:       clampFragmentCoalescePlayingMs((agent as any).agentConfig?.fragmentCoalescePlayingMs),
      telephonyTailDrainMs:            clampTelephonyTailDrainMs((agent as any).agentConfig?.telephonyTailDrainMs),
      sarvamHighVadSensitivity:        ((agent as any).agentConfig?.sarvamHighVadSensitivity as boolean | undefined) === true,
      sarvamSpeechEndFlushMs:          clampSarvamSpeechEndFlushMs((agent as any).agentConfig?.sarvamSpeechEndFlushMs),
      sarvamIncompleteHoldMs:          clampSarvamIncompleteHoldMs((agent as any).agentConfig?.sarvamIncompleteHoldMs),
      kbBakedOnly:                     ((agent as any).agentConfig?.kbBakedOnly as boolean | undefined) ?? false,
      autoRedialEnabled:      (agent as any).agentConfig?.autoRedial?.enabled ?? false,
      autoRedialMaxAttempts:  (agent as any).agentConfig?.autoRedial?.maxAttempts  ?? 3,
      sarvamSttMode:          ((agent as any).agentConfig?.sarvamSttMode as AgentFormValues["sarvamSttMode"]) ?? undefined,
      schedulingCalendarId:   ((agent as any).agentConfig?.calendarCapability?.defaultCalendarId as number | null | undefined) ?? null,
      schedulingEventTypeId:  ((agent as any).agentConfig?.calendarCapability?.defaultEventTypeId as number | null | undefined) ?? null,
      voiceStack:               (((agent as any).agentConfig?.voiceStack as string | undefined) === "gemini_live" ? "gemini_live" : "classic") as AgentFormValues["voiceStack"],
      geminiLiveVoiceName:      ((agent as any).agentConfig?.geminiLive?.voiceName as string | undefined) ?? "Kore",
      geminiLiveThinkingLevel:  ((agent as any).agentConfig?.geminiLive?.thinkingLevel as AgentFormValues["geminiLiveThinkingLevel"] | undefined) ?? "minimal",
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
      try {
        const payload = buildUpdateAgentPayload(data);
        const saved = await updateAgent.mutateAsync({ id: agentId, data: payload as any });
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
        form.setValue("schedulingCalendarId", (saved as any)?.agentConfig?.calendarCapability?.defaultCalendarId ?? null, { shouldDirty: false });
        form.setValue("schedulingEventTypeId", (saved as any)?.agentConfig?.calendarCapability?.defaultEventTypeId ?? null, { shouldDirty: false });
        queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        toast({ title: "Saved", description: `${data.name} updated.` });
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2500);
      } catch (err) {
        const mapped = mapApiErrors(err);
        if (Object.keys(mapped).length > 0) { Object.entries(mapped).forEach(([k, v]) => form.setError(k as any, { message: v })); }
        toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
      }
    },
    (errors) => {
      const fieldTabMap: Record<string, TabId> = {
        webhookUrl:               "advanced",
        webhookSecret:            "advanced",
        schedulingCalendarId:     "overview",
        schedulingEventTypeId:    "overview",
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
        sarvamSpeechEndFlushMs:      "voice",
        sarvamIncompleteHoldMs:      "voice",
        stopSpeakingNumWords:     "voice",
        vadSilenceMs:             "advanced",
        bargeInEnabled:           "advanced",
        bargeInEnergyThreshold:   "advanced",
        bargeInMinFrames:         "advanced",
        micSensitivity:           "advanced",
        timezone:                 "advanced",
        autoRedialEnabled:        "advanced",
        autoRedialMaxAttempts:    "advanced",
        machineDetectionMode:     "voicemail",
        voicemailAction:          "voicemail",
        voicemailMessage:         "voicemail",
        voicemailLeadInSeconds:   "voicemail",
        systemPrompt:             "prompt",
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

  const handleDelete = async () => {
    const agentName = form.getValues("name") || "this agent";
    if (!confirm(`Delete "${agentName}"? This cannot be undone.`)) return;
    try {
      await deleteAgent.mutateAsync({ id: agentId });
      try { localStorage.removeItem(LAST_AGENT_ID_KEY); } catch {}
      await queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      const nextList = (queryClient.getQueryData(getListAgentsQueryKey()) as any[])?.filter(a => a.id !== agentId) || [];
      if (nextList.length > 0) {
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

  const visibleTabs = TABS;
  const webTestLabel = "Live Test";

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
    <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header — identity + cost strip */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="flex flex-col gap-3 px-5 sm:px-6 py-3.5 border-b border-border/40 shrink-0"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col min-w-0 gap-1.5 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              {onOpenAgents && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="md:hidden h-10 min-h-10 shrink-0 gap-1.5 rounded-lg text-xs px-3"
                  onClick={onOpenAgents}
                >
                  <List className="h-3.5 w-3.5" />
                  Agents
                </Button>
              )}
              <h1
                className="text-xl sm:text-2xl font-semibold leading-tight tracking-tight truncate max-w-[420px]"
                title={agent.name}
              >
                {agent.name}
              </h1>
              <button
                type="button"
                onClick={() => { setRenameValue(agent.name ?? ""); setRenameDialogOpen(true); }}
                className="shrink-0 rounded-full p-1.5 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
                title="Rename agent"
                aria-label="Rename agent"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <span className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] shrink-0",
                agent.status === "active"
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                  : "border-border/50 bg-muted/30 text-muted-foreground",
              )}>
                <span className={cn("h-1.5 w-1.5 rounded-full", agent.status === "active" ? "bg-emerald-400" : "bg-muted-foreground/50")} />
                {agent.status === "active" ? "Live" : "Draft"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                <Mic className="h-3 w-3" />
                Voice
              </span>
              <span className="text-[11px] text-muted-foreground/50 tabular-nums shrink-0">#{String(agent.id).padStart(4, "0")}</span>
            </div>
            <p className="text-[12px] text-muted-foreground/80 max-w-3xl">
              Build the agent, connect its channels, and shape the journey it should run across calls, WhatsApp, booking, follow-ups, and memory.
            </p>
            <AgentCostSummary form={form} rateMap={rateMap} agent={agent} />
          </div>

          {/* Compact header actions when rail is hidden — desktop tablet only; phone uses sticky bar */}
          <div className="hidden sm:flex xl:hidden items-center gap-1.5 shrink-0">
            <Button size="sm" variant="outline" className="h-10 min-h-10 text-xs gap-1 rounded-lg" onClick={() => setCallDialog(true)}>
              <Phone className="h-3.5 w-3.5" /> Call
            </Button>
            <div className="relative">
              <Button
                size="sm"
                className={cn("h-10 min-h-10 text-xs gap-1 rounded-lg px-3", savedFlash && "bg-green-600 hover:bg-green-700 text-white")}
                onClick={onSave}
                disabled={updateAgent.isPending}
              >
                {savedFlash ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                {updateAgent.isPending ? "…" : savedFlash ? "Saved" : "Save"}
              </Button>
              {isDirty && !updateAgent.isPending && !savedFlash && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 pointer-events-none" />
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-10 w-10 rounded-lg"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowWebcall(v => !v)}>
                  <Mic className="h-3.5 w-3.5 mr-2" />
                  {webTestLabel}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPublishModalOpen(true)}>
                  <Upload className="h-3.5 w-3.5 mr-2" /> Publish
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/app/vibe?refine=${agentId}`)}>
                  <Sparkles className="h-3.5 w-3.5 mr-2" /> Refine
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={handleDelete}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </motion.div>

      {/* Rename Agent dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Rename Agent</DialogTitle>
            <DialogDescription>Update the display name of this agent.</DialogDescription>
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
            "fixed z-50 flex flex-col shadow-2xl overflow-hidden bg-background",
            "inset-0 rounded-none",
            "md:inset-auto md:bottom-4 md:right-4 md:w-[420px] md:h-[560px] md:rounded-2xl",
          )}
        >
          <WebcallPanel
            agentId={agent.id}
            agentName={agent.name ?? "Agent"}
            compact
            onClose={() => setShowWebcall(false)}
          />
        </div>
      )}

      {/* Main + right action rail */}
      <div className="flex flex-1 min-h-0">
        <Form {...form}>
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <div className="flex items-center gap-1 px-5 sm:px-6 border-b border-border/40 overflow-x-auto shrink-0 bg-background/80 backdrop-blur-sm">
              {visibleTabs.map(tab => (
                <button key={tab.id} onClick={() => handleTabClick(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                    activeTab === tab.id
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}>
                  {tab.icon}{tab.label}
                </button>
              ))}
            </div>

            <div ref={tabContentRef} className="flex-1 min-h-0 overflow-y-auto">
              <form onSubmit={e => e.preventDefault()}>
                {activeTab === "overview"  && <OverviewTab form={form} agent={agent} />}
                {activeTab === "channels"  && <ChannelsTab form={form} agent={agent} forceExpandEmail={forceExpandEmail} />}
                {activeTab === "prompt"    && <PromptTab form={form} />}
                {activeTab === "voice"     && <VoiceTab form={form} />}
                {activeTab === "tools"     && <ToolsTab form={form} agentId={agentId} />}
                {activeTab === "analysis"  && <AnalysisTab form={form} agentId={agentId} onConfigureEmail={openEmailChannel} onOpenChannels={openChannels} />}
                {activeTab === "voicemail" && <VoicemailTab form={form} />}
                {activeTab === "advanced"  && <AdvancedTab form={form} agent={agent} />}
                {activeTab === "versions"  && <VersionsTab agentId={agent.id} />}
              </form>
            </div>

            {/* Sticky Phone / Web / Save — below xl (rail hidden) */}
            <div className="xl:hidden shrink-0 border-t border-border/40 bg-background/95 backdrop-blur-md px-3 py-2.5 pb-safe">
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 min-h-11 text-xs font-medium gap-1.5 rounded-xl"
                  onClick={() => setCallDialog(true)}
                >
                  <Phone className="h-4 w-4 shrink-0" />
                  Phone
                </Button>
                <Button
                  type="button"
                  variant={showWebcall ? "default" : "outline"}
                  className="h-11 min-h-11 text-xs font-medium gap-1.5 rounded-xl"
                  onClick={() => setShowWebcall(v => !v)}
                >
                  <Mic className="h-4 w-4 shrink-0" />
                  {showWebcall ? "Close" : "Web"}
                </Button>
                <Button
                  type="button"
                  className={cn("h-11 min-h-11 text-xs font-medium gap-1.5 rounded-xl relative", savedFlash && "bg-green-600 hover:bg-green-700")}
                  onClick={onSave}
                  disabled={updateAgent.isPending}
                >
                  {savedFlash ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                  {updateAgent.isPending ? "…" : savedFlash ? "Saved" : "Save"}
                  {isDirty && !updateAgent.isPending && !savedFlash && (
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-400" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </Form>

        {/* Studio action rail — Test vs Publish */}
        <aside className="hidden xl:flex w-[272px] shrink-0 flex-col border-l border-border/40 bg-muted/[0.15] overflow-y-auto">
          <div className="flex flex-col gap-4 px-3.5 py-4 flex-1">
            {/* Test — phone + web; soft save hint when dirty */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/55 px-0.5">
                Test
              </p>
              {isDirty && (
                <p className="text-[10px] text-amber-400/90 leading-snug rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1.5">
                  Unsaved changes — save before testing so the call uses the latest config.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 text-[12px] font-medium gap-1.5 rounded-xl border-border/60 bg-card/40 hover:bg-card/70"
                  onClick={() => setCallDialog(true)}
                >
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  Phone
                </Button>
                <Button
                  type="button"
                  variant={showWebcall ? "default" : "outline"}
                  className={cn(
                    "h-10 text-[12px] font-medium gap-1.5 rounded-xl",
                    !showWebcall && "border-border/60 bg-card/40 hover:bg-card/70",
                  )}
                  onClick={() => setShowWebcall(v => !v)}
                >
                  <Mic className="h-3.5 w-3.5 shrink-0" />
                  {showWebcall ? "Close" : webTestLabel}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground/65 leading-snug px-0.5">
                Phone uses your number when assigned — otherwise a capped trial line ({3} calls/day). Live Test = in-browser.
              </p>
            </div>

            {/* Inbound assign — same APIs as Phone Numbers */}
            <div className="space-y-2">
              <AgentInboundPanel
                agentId={agentId}
                preferredManagedNumber={form.watch("preferredManagedNumber")}
              />
              <button
                type="button"
                onClick={() => navigate("/app/calls")}
                className="text-left text-[12px] text-sky-500/90 hover:text-sky-400 transition-colors px-0.5"
              >
                See all call logs →
              </button>
            </div>

            <div className="h-px bg-border/40" />

            {/* Publish — Save primary, Refine next, Publish version */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/55 px-0.5">
                Publish
              </p>
              <div className="relative">
                <Button
                  type="button"
                  className={cn(
                    "w-full h-10 text-[12.5px] font-semibold gap-2 rounded-xl",
                    savedFlash && "bg-green-600 hover:bg-green-700 text-white",
                  )}
                  onClick={onSave}
                  disabled={updateAgent.isPending}
                >
                  {savedFlash ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                  {updateAgent.isPending ? "Saving…" : savedFlash ? "Saved" : isDirty ? "Save changes" : "Save agent"}
                </Button>
                {isDirty && !updateAgent.isPending && !savedFlash && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-400 pointer-events-none" />
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full h-9 text-[12px] font-medium gap-2 rounded-xl border-border/60"
                onClick={() => navigate(`/app/vibe?refine=${agentId}`)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Refine with AI
              </Button>
              <button
                type="button"
                onClick={() => setPublishModalOpen(true)}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <Upload className="h-3 w-3" />
                Publish version
              </button>
              <Button
                type="button"
                variant="outline"
                className="w-full h-9 text-[12px] font-medium gap-2 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive transition-colors mt-1"
                onClick={handleDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Agent
              </Button>
            </div>

            <div className="mt-auto space-y-2.5 pt-2">
              <button
                type="button"
                onClick={() => navigate("/app/providers")}
                className="flex items-center gap-2 w-full text-left text-[11px] text-muted-foreground/80 hover:text-foreground transition-colors"
              >
                <Star className="h-3 w-3 shrink-0 opacity-70" />
                <span>Add your own API keys</span>
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Outbound call dialog */}
      <Dialog open={callDialog} onOpenChange={setCallDialog}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-2xl sm:rounded-lg bottom-4 top-auto translate-y-0 data-[state=open]:slide-in-from-bottom-4 sm:bottom-auto sm:top-[50%] sm:translate-y-[-50%] sm:data-[state=open]:slide-in-from-top-[48%]">
          <DialogHeader>
            <DialogTitle>Make Outbound Call</DialogTitle>
            <DialogDescription>
              Agent <strong>{agent.name}</strong> will call this number
              {outboundTestingFrom ? (
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

function CreateAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"pick" | "scratch">("pick");
  const [agentName, setAgentName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleClose = () => {
    if (creating) return;
    setStep("pick");
    setAgentName("");
    setCreateError(null);
    onClose();
  };

  const handleVibe = () => {
    handleClose();
    navigate("/app/vibe");
  };

  const handleScratch = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const name = agentName.trim() || "New Voice Agent";
      const body: Record<string, unknown> = {
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
        llmProvider: "google",
        llmModel: "gemini-3.6-flash",
        ttsProvider: "sarvam",
        ttsModel: "bulbul:v3",
        ttsVoice: "priya",
      };

      const result = await customFetch<{ id: number }>(`${DASH_API}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "pick" && "Create a new agent"}
            {step === "scratch" && "Configure new agent"}
          </DialogTitle>
          <DialogDescription>
            {step === "pick" && "Build with AI for a guided setup, or configure manually from scratch."}
            {step === "scratch" && "Name your agent. You can edit settings anytime."}
          </DialogDescription>
        </DialogHeader>

        {step === "pick" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <button
              onClick={handleVibe}
              className="group relative flex flex-col items-center gap-2 rounded-xl border-2 border-primary/40 bg-primary/5 p-5 text-center hover:border-primary hover:bg-primary/10 transition-colors"
            >
              <span className="absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                Recommended
              </span>
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">Build with AI</p>
                <p className="text-xs text-muted-foreground mt-0.5">Guided conversational setup</p>
              </div>
            </button>
            <button
              onClick={() => setStep("scratch")}
              className="group flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card p-5 text-center hover:border-primary/50 hover:bg-primary/5 transition-colors"
            >
              <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center group-hover:bg-muted/80 transition-colors">
                <Settings className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold">Build from scratch</p>
                <p className="text-xs text-muted-foreground mt-0.5">Full manual configuration</p>
              </div>
            </button>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="scratch-name">Agent name</Label>
              <Input
                id="scratch-name"
                placeholder="e.g. Support Representative"
                value={agentName}
                onChange={e => setAgentName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && void handleScratch()}
                autoFocus
              />
            </div>

            {createError && <p className="text-xs text-destructive">{createError}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep("pick")} disabled={creating}>Back</Button>
              <Button onClick={() => void handleScratch()} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create agent"}
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
  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-background">
      <div className="text-center max-w-sm space-y-4">
        <div className="mx-auto h-12 w-12 rounded-2xl border border-border/50 bg-muted/30 flex items-center justify-center">
          <Bot className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight">Select an agent</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Pick one from the list, or create a new agent with AI or manual setup.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2 pt-1 w-full max-w-sm mx-auto">
          <Button className="h-11 min-h-11 rounded-xl gap-1.5 text-xs w-full sm:w-auto" onClick={() => navigate("/app/vibe")}>
            <Sparkles className="h-3.5 w-3.5" /> Build with AI
          </Button>
          <Button variant="outline" className="h-11 min-h-11 rounded-xl gap-1.5 text-xs w-full sm:w-auto" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" /> Manual setup
          </Button>
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
    <div className="flex h-full overflow-hidden">
      <CreateAgentDialog open={showCreate} onClose={() => setShowCreate(false)} />
      <AgentListPanel
        selectedId={selectedId}
        onSelect={handleSelect}
        rateMap={rateMap}
        className="hidden md:flex"
      />
      <Sheet open={agentsSheetOpen} onOpenChange={setAgentsSheetOpen}>
        <SheetContent side="left" className="p-0 w-[min(100vw,280px)] md:hidden [&>button]:hidden">
          <SheetTitle className="sr-only">Agents</SheetTitle>
          <AgentListPanel
            selectedId={selectedId}
            onSelect={handleSelect}
            rateMap={rateMap}
            className="w-full border-0"
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
