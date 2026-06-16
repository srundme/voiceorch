import React, { useEffect, useState, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import {
  Bot, Plus, Search, Phone, Mic, Brain, Zap, Webhook, PhoneForwarded,
  Save, MoreHorizontal, Power, Trash2, Settings, FileText, Wrench,
  GitBranch, VoicemailIcon, SlidersHorizontal, TestTube2, ChevronRight,
  Volume2, Check, X, Pencil, ChevronDown, List, Globe, BarChart3,
  User2, Sparkles, BookOpen, ToggleLeft, ToggleRight, Tag,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import {
  useListAgents, useGetAgent, useUpdateAgent, useToggleAgent, useDeleteAgent,
  useCreateAgent, useInitiateOutboundCall, getListAgentsQueryKey, getGetAgentQueryKey,
  useListCalls, getListCallsQueryKey, useListEventTypes, useListCalendars, customFetch,
  useListKnowledgeSources,
} from "@workspace/api-client-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { agentFormSchema, buildUpdateAgentPayload } from "./edit";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatApiError, mapApiErrors, isDestinationUnverifiedError } from "@/lib/format-api-error";
import {
  ASR_PROVIDERS, LLM_PROVIDERS, TTS_PROVIDERS,
  LANGUAGES, ASR_MODELS, LLM_MODELS, TTS_MODELS, TTS_VOICES, AGENT_TIMEZONES,
} from "@/lib/agent-providers";
import { useMinuteRatesMap, computeAgentRateCents } from "@/hooks/use-minute-rates";
import { DestinationOtpDialog } from "@/components/destination-otp-dialog";
import { WebCallPanel } from "@/components/webcall-panel";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API   = `${_DASH_BASE}/api`;

/* ── Types ──────────────────────────────────────────────────────────────────── */

type TabId = "overview" | "prompt" | "voice" | "tools" | "analysis" | "pipeline" | "voicemail" | "advanced" | "logs";

interface TabDef { id: TabId; label: string; icon: React.ReactNode }

const TABS: TabDef[] = [
  { id: "overview",   label: "Overview",   icon: <Bot className="h-3.5 w-3.5" /> },
  { id: "prompt",     label: "Prompt",     icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "voice",      label: "Voice",      icon: <Mic className="h-3.5 w-3.5" /> },
  { id: "tools",      label: "Tools",      icon: <Wrench className="h-3.5 w-3.5" /> },
  { id: "analysis",   label: "Analysis",   icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: "pipeline",   label: "Pipeline",   icon: <GitBranch className="h-3.5 w-3.5" /> },
  { id: "voicemail",  label: "Voicemail",  icon: <VoicemailIcon className="h-3.5 w-3.5" /> },
  { id: "advanced",   label: "Advanced",   icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
  { id: "logs",       label: "Logs",       icon: <List className="h-3.5 w-3.5" /> },
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

  const asrProvider = form.watch("asrProvider");
  const llmProvider = form.watch("llmProvider");
  const ttsProvider = form.watch("ttsProvider");
  const asrModel    = form.watch("asrModel");
  const llmModel    = form.watch("llmModel");
  const ttsVoice    = form.watch("ttsVoice");
  const ttsModel    = form.watch("ttsModel");
  const language    = form.watch("language");
  const temperature = form.watch("temperature") ?? 0.1;

  const llmOptions    = LLM_MODELS[llmProvider]  ?? [];
  const ttsModelOpts  = TTS_MODELS[ttsProvider]  ?? [];
  const asrModelOpts  = ASR_MODELS[asrProvider]  ?? [];

  // Fetch admin-whitelisted voices (shared cache with VoiceTab)
  const { data: whitelistedData } = useQuery({
    queryKey: ["voices", "whitelisted"],
    queryFn: () => customFetch<{ voices: Array<{ id: string; name: string; language: string }> }>(`${DASH_API}/voices/whitelisted`),
    staleTime: 5 * 60 * 1000,
  });

  const cartesiaOverviewOpts = useMemo(() => {
    const baseLang = (language ?? "en-US").split("-")[0];
    const all = whitelistedData?.voices ?? [];
    const filtered = all.filter(v => v.language === baseLang || v.language === language);
    const opts = filtered.map(v => ({ value: v.id, label: v.name }));
    opts.push({ value: "__custom__", label: "✎ Paste custom Voice ID…" });
    return opts;
  }, [whitelistedData, language]);

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

  const costCents = agent ? computeAgentRateCents(rateMap, agent as any) : null;

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
                <FormField control={form.control} name="ttsProvider" render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Provider</FormLabel>
                    <SmallSelect value={field.value} onChange={(v) => { field.onChange(v); form.setValue("ttsVoice", ""); form.setValue("ttsModel", ""); }}
                      options={TTS_PROVIDERS.map(p => ({ value: p.value, label: p.label }))} />
                  </FormItem>
                )} />
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
              <Select defaultValue="assistant">
                <SelectTrigger className="h-8 w-48 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="assistant" className="text-xs">Assistant speaks first</SelectItem>
                  <SelectItem value="user" className="text-xs">User speaks first</SelectItem>
                </SelectContent>
              </Select>
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

  // For Cartesia: build dropdown options from whitelisted voices filtered by the agent's language
  const cartesiaVoiceOpts = useMemo(() => {
    const baseLang = agentLanguage.split("-")[0]; // "en-US" → "en", "hi-IN" → "hi"
    const all = whitelistedData?.voices ?? [];
    const filtered = all.filter(v => v.language === baseLang || v.language === agentLanguage);
    const opts = filtered.map(v => ({ value: v.id, label: v.name }));
    opts.push({ value: "__custom__", label: "✎ Paste custom Voice ID…" });
    return opts;
  }, [whitelistedData, agentLanguage]);

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

  return (
    <div className="relative p-6 overflow-y-auto h-full space-y-6">

      {/* ── Provider & Voice ── */}
      <div className="space-y-3">
        <SectionDivider label="Text-to-Speech — Provider & Voice" />
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="ttsProvider" render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-xs text-muted-foreground">Provider</FormLabel>
              <Select value={field.value} onValueChange={(v) => {
                field.onChange(v);
                form.setValue("ttsVoice", "");
                form.setValue("ttsModel", "");
              }}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-sm">{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormItem>
          )} />

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
              </FormItem>
            )} />
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
        </div>
      </div>
    </div>
  );
}

/* ── Tab: Tools ─────────────────────────────────────────────────────────────── */

function ToolsTab({ form }: { form: any }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "tools" });
  const genderEnabled = form.watch("genderDetectionEnabled") ?? false;
  const watchedTools  = (form.watch("tools") ?? []) as any[];

  const { data: eventTypesData } = useListEventTypes();
  const { data: calendarsData } = useListCalendars();
  const calendarOptions = (calendarsData ?? []).map((cal: any) => ({ value: String(cal.id), label: cal.name ?? cal.slug }));
  const eventTypeOptions = (eventTypesData ?? []).map((et: any) => ({ value: String(et.id), label: et.name ?? et.slug, calendarId: String(et.calendarId) }));

  const hasNativeTool = (type: string) => watchedTools.some((t: any) => t.type === type);
  const nativeToolIndex = (type: string) => fields.findIndex((f: any) => f.type === type);

  const toggleNativeTool = (type: string) => {
    const idx = nativeToolIndex(type);
    if (idx >= 0) {
      remove(idx);
    } else {
      append({ type: type as any, name: "", description: "" });
    }
  };

  const getNativeField = (type: string, fieldName: string) => {
    const idx = nativeToolIndex(type);
    return idx >= 0 ? form.watch(`tools.${idx}.${fieldName}`) : undefined;
  };
  const setNativeField = (type: string, fieldName: string, value: any) => {
    const idx = nativeToolIndex(type);
    if (idx >= 0) form.setValue(`tools.${idx}.${fieldName}`, value, { shouldDirty: true });
  };

  const BOOKING_TOOLS = [
    {
      type: "native_booking",
      icon: <BookOpen className="h-4 w-4" />,
      color: "emerald",
      label: "Book Appointment",
      description: "Lets the agent book a meeting slot for the caller. Agent collects name, email, and preferred time, then confirms the booking live.",
      needsEventType: true,
    },
    {
      type: "native_check_availability",
      icon: <Sparkles className="h-4 w-4" />,
      color: "sky",
      label: "Check Availability",
      description: "Enables the agent to look up open slots before suggesting a time. Use alongside Book Appointment for a natural booking flow.",
      needsEventType: true,
    },
    {
      type: "native_list_bookings",
      icon: <List className="h-4 w-4" />,
      color: "violet",
      label: "List Bookings",
      description: "Allows the agent to retrieve existing bookings for the caller — useful for reschedule or cancellation flows.",
      needsEventType: false,
    },
    {
      type: "native_reschedule",
      icon: <Pencil className="h-4 w-4" />,
      color: "amber",
      label: "Reschedule Booking",
      description: "Lets the agent reschedule an existing booking to a new time slot chosen by the caller.",
      needsEventType: false,
    },
    {
      type: "native_cancel",
      icon: <X className="h-4 w-4" />,
      color: "red",
      label: "Cancel Booking",
      description: "Allows the agent to cancel an upcoming booking on the caller's request.",
      needsEventType: false,
    },
  ] as const;

  const colorMap: Record<string, { border: string; bg: string; iconBg: string; iconText: string; label: string; badge: string; badgeText: string; active: string }> = {
    emerald: { border: "border-emerald-400/40", bg: "bg-emerald-950/10", iconBg: "bg-emerald-500/15", iconText: "text-emerald-400", label: "text-emerald-300", badge: "bg-emerald-500/20", badgeText: "text-emerald-300", active: "" },
    sky:     { border: "border-sky-400/40",     bg: "bg-sky-950/10",     iconBg: "bg-sky-500/15",     iconText: "text-sky-400",     label: "text-sky-300",     badge: "bg-sky-500/20",     badgeText: "text-sky-300",     active: "" },
    violet:  { border: "border-violet-400/40",  bg: "bg-violet-950/10",  iconBg: "bg-violet-500/15",  iconText: "text-violet-400",  label: "text-violet-300",  badge: "bg-violet-500/20",  badgeText: "text-violet-300",  active: "" },
    amber:   { border: "border-amber-400/40",   bg: "bg-amber-950/10",   iconBg: "bg-amber-500/15",   iconText: "text-amber-400",   label: "text-amber-300",   badge: "bg-amber-500/20",   badgeText: "text-amber-300",   active: "" },
    red:     { border: "border-red-400/40",     bg: "bg-red-950/10",     iconBg: "bg-red-500/15",     iconText: "text-red-400",     label: "text-red-300",     badge: "bg-red-500/20",     badgeText: "text-red-300",     active: "" },
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
        {BOOKING_TOOLS.map(({ type, icon, color, label, description, needsEventType }) => {
          const isOn = hasNativeTool(type);
          const c = colorMap[color];
          const calendarId = isOn && needsEventType ? getNativeField(type, "calendarId") : undefined;
          const eventTypeId = isOn && needsEventType ? getNativeField(type, "eventTypeId") : undefined;
          const filteredEventTypes = calendarId
            ? eventTypeOptions.filter((et: any) => et.calendarId === calendarId)
            : eventTypeOptions;
          return (
            <div key={type} className={cn("rounded-xl border transition-all duration-150", isOn ? `${c.border} ${c.bg}` : "border-border/60 bg-card/20")}>
              <button
                type="button"
                onClick={() => toggleNativeTool(type)}
                className="w-full text-left p-4 flex items-start gap-3"
              >
                <div className={cn("mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0", isOn ? c.iconBg : "bg-muted/30")}>
                  <span className={cn(isOn ? c.iconText : "text-muted-foreground/40")}>{icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn("text-xs font-semibold", isOn ? c.label : "text-foreground/80")}>{label}</span>
                    <span className={cn("text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded", isOn ? `${c.badge} ${c.badgeText}` : "bg-muted/40 text-muted-foreground/40")}>
                      {isOn ? "ON" : "OFF"}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{description}</p>
                </div>
                <div className="shrink-0 mt-0.5">
                  {isOn ? <ToggleRight className={cn("h-5 w-5", c.iconText)} /> : <ToggleLeft className="h-5 w-5 text-muted-foreground/30" />}
                </div>
              </button>
              {isOn && needsEventType && (
                <div className="px-4 pb-4 -mt-1">
                  <div className="border-t border-border/30 pt-3 space-y-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">Calendar</label>
                      <Select
                        value={calendarId ?? ""}
                        onValueChange={(v) => {
                          setNativeField(type, "calendarId", v);
                          setNativeField(type, "eventTypeId", "");
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select calendar…" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {calendarOptions.map((cal: any) => (
                            <SelectItem key={cal.value} value={cal.value} className="text-xs">{cal.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">Event Type</label>
                      <Select
                        value={eventTypeId ?? ""}
                        onValueChange={(v) => setNativeField(type, "eventTypeId", v)}
                        disabled={!calendarId}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder={calendarId ? "Select event type…" : "Pick a calendar first"} />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {filteredEventTypes.map((et: any) => (
                            <SelectItem key={et.value} value={et.value} className="text-xs">{et.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 px-0.5 mb-1 mt-4">Caller Intelligence</p>
        {/* Gender Identification card */}
        <button
          type="button"
          onClick={() => form.setValue("genderDetectionEnabled", !genderEnabled, { shouldDirty: true })}
          className={cn(
            "w-full text-left rounded-xl border p-4 transition-all duration-150 flex items-start gap-3",
            genderEnabled
              ? "border-pink-400/40 bg-pink-950/10"
              : "border-border/60 bg-card/20 hover:bg-card/40"
          )}
        >
          <div className={cn(
            "mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
            genderEnabled ? "bg-pink-500/15" : "bg-muted/30"
          )}>
            <User2 className={cn("h-4 w-4", genderEnabled ? "text-pink-400" : "text-muted-foreground/40")} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={cn("text-xs font-semibold", genderEnabled ? "text-pink-300" : "text-foreground/80")}>
                Gender Identification
              </span>
              <span className={cn(
                "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                genderEnabled ? "bg-pink-500/20 text-pink-300" : "bg-muted/40 text-muted-foreground/40"
              )}>
                {genderEnabled ? "ON" : "OFF"}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
              Detects caller gender from voice at the start of the call. When enabled, the agent uses gender-appropriate salutations — "Sir", "Ma'am", or a neutral fallback.
            </p>
            {genderEnabled && (
              <p className="text-[10px] text-pink-400/70 mt-1.5 flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Active — gender salutation will be applied on every call
              </p>
            )}
          </div>
          <div className="shrink-0 mt-0.5">
            {genderEnabled
              ? <ToggleRight className="h-5 w-5 text-pink-400" />
              : <ToggleLeft className="h-5 w-5 text-muted-foreground/30" />
            }
          </div>
        </button>
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

        {fields.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
            <Wrench className="h-7 w-7 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm font-medium text-muted-foreground/50">No custom tools</p>
            <p className="text-xs text-muted-foreground/30 mt-0.5">Add a Call Transfer or Custom Function above</p>
          </div>
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => {
              const toolType = form.watch(`tools.${index}.type`);
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

/* ── Tab: Pipeline ──────────────────────────────────────────────────────────── */

function PipelineTab({ form }: { form: any }) {
  return (
    <div className="relative p-6 overflow-y-auto h-full space-y-5">
      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-4">
          <SectionDivider label="Conversation" />
          <FormField control={form.control} name="greetingMessage" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Greeting Message</FormLabel>
              <FormControl><Input placeholder="Hello! How can I help you today?" className="h-8 text-xs" {...field} /></FormControl>
            </FormItem>
          )} />
          <FormField control={form.control} name="endCallPhrases" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">End-Call Phrases (comma-separated)</FormLabel>
              <FormControl><Input placeholder="goodbye, bye, see you" className="h-8 text-xs" {...field} /></FormControl>
              <FormDescription className="text-[10px]">Agent hangs up when caller says any of these</FormDescription>
            </FormItem>
          )} />
          <FormField control={form.control} name="silenceTimeoutSeconds" render={({ field }) => (
            <FormItem>
              <div className="flex justify-between"><FormLabel className="text-xs">Silence Timeout</FormLabel>
                <span className="text-xs font-mono">{field.value ?? 30}s</span></div>
              <FormControl>
                <input type="range" min={5} max={300} step={5} value={field.value ?? 30}
                  onChange={e => field.onChange(parseInt(e.target.value))}
                  className="w-full h-1.5 accent-primary cursor-pointer" />
              </FormControl>
              <FormDescription className="text-[10px]">Hang up if caller is silent for this duration</FormDescription>
            </FormItem>
          )} />
          <FormField control={form.control} name="maxDuration" render={({ field }) => (
            <FormItem>
              <div className="flex justify-between"><FormLabel className="text-xs">Max Call Duration</FormLabel>
                <span className="text-xs font-mono">{Math.floor((field.value ?? 300) / 60)}m {(field.value ?? 300) % 60}s</span></div>
              <FormControl>
                <input type="range" min={10} max={3600} step={30} value={field.value ?? 300}
                  onChange={e => field.onChange(parseInt(e.target.value))}
                  className="w-full h-1.5 accent-primary cursor-pointer" />
              </FormControl>
            </FormItem>
          )} />
          <FormField control={form.control} name="timezone" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Agent Timezone</FormLabel>
              <SmallSelect value={field.value ?? ""} onChange={field.onChange}
                options={[{ value: "", label: "Not set" }, ...AGENT_TIMEZONES]}
                placeholder="Not set" />
              <FormDescription className="text-[10px]">Injected into the system prompt as current time context</FormDescription>
            </FormItem>
          )} />
        </div>
        <div className="space-y-4">
          <SectionDivider label="Webhooks" />
          <FormField control={form.control} name="webhookUrl" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Call Event Webhook URL</FormLabel>
              <FormControl><Input placeholder="https://your-api.com/call-events" className="h-8 text-xs" {...field} /></FormControl>
              <FormDescription className="text-[10px]">Receives call start, end, transcript events</FormDescription>
            </FormItem>
          )} />
          <FormField control={form.control} name="webhookSecret" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Webhook Secret</FormLabel>
              <FormControl><Input type="password" placeholder="optional-shared-secret" className="h-8 text-xs" {...field} /></FormControl>
            </FormItem>
          )} />
        </div>
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

function SliderField({ form, name, label, description, min, max, step, format }: {
  form: any; name: string; label: string; description?: string;
  min: number; max: number; step: number; format?: (v: number) => string;
}) {
  return (
    <FormField control={form.control} name={name} render={({ field }) => (
      <FormItem>
        <div className="flex justify-between items-center">
          <FormLabel className="text-xs">{label}</FormLabel>
          <span className="text-xs font-mono text-muted-foreground">
            {format ? format(field.value ?? min) : (field.value ?? min)}
          </span>
        </div>
        <FormControl>
          <input type="range" min={min} max={max} step={step} value={field.value ?? min}
            onChange={e => field.onChange(parseFloat(e.target.value))}
            className="w-full h-1.5 accent-primary cursor-pointer" />
        </FormControl>
        {description && <FormDescription className="text-[10px]">{description}</FormDescription>}
      </FormItem>
    )} />
  );
}

function AdvancedTab({ form }: { form: any }) {
  const bargeIn = form.watch("bargeInEnabled");
  return (
    <div className="relative p-6 overflow-y-auto h-full space-y-6">
      <div className="grid grid-cols-2 gap-6">
        {/* ── Left column ── */}
        <div className="space-y-4">
          {/* Start Speaking Plan */}
          <SectionDivider label="Start Speaking Plan" />
          <p className="text-[10px] text-muted-foreground -mt-2">
            How long the agent waits after detecting end-of-turn before responding, based on transcript content.
          </p>
          <SliderField form={form} name="startSpeakingWaitSecs" label="Wait Seconds"
            description="Base extra wait before any response (0 = off)" min={0} max={5} step={0.1}
            format={v => `${v.toFixed(1)}s`} />
          <SliderField form={form} name="startSpeakingOnPunctuationSecs" label="After Punctuation"
            description="Delay when utterance ends with . ? !" min={0} max={3} step={0.05}
            format={v => `${v.toFixed(2)}s`} />
          <SliderField form={form} name="startSpeakingOnNoPunctuationSecs" label="After No Punctuation"
            description="Delay when utterance has no terminal punctuation" min={0} max={3} step={0.1}
            format={v => `${v.toFixed(1)}s`} />
          <SliderField form={form} name="startSpeakingOnNumberSecs" label="After Number"
            description="Delay when utterance ends with a digit" min={0} max={3} step={0.05}
            format={v => `${v.toFixed(2)}s`} />

          {/* Stop Speaking Plan */}
          <SectionDivider label="Stop Speaking Plan" />
          <p className="text-[10px] text-muted-foreground -mt-2">
            How much speech from the caller triggers agent interruption (barge-in).
          </p>
          <FormField control={form.control} name="bargeInEnabled" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
              <div><FormLabel className="text-sm">Allow Barge-in</FormLabel>
                <FormDescription className="text-[10px]">Caller can interrupt agent while it speaks</FormDescription></div>
              <FormControl><Switch checked={field.value ?? true} onCheckedChange={field.onChange} /></FormControl>
            </FormItem>
          )} />
          {bargeIn && (
            <>
              <SliderField form={form} name="stopSpeakingNumWords" label="Number of Words"
                description="Min caller words before barge-in fires (0 = use frames setting)" min={0} max={10} step={1}
                format={v => v === 0 ? "off" : `${v} word${v !== 1 ? "s" : ""}`} />
              <SliderField form={form} name="stopSpeakingVoiceSecs" label="Voice Seconds"
                description="Min caller voice duration to trigger interruption" min={0} max={0.5} step={0.02}
                format={v => `${v.toFixed(2)}s`} />
              <SliderField form={form} name="stopSpeakingBackOffSecs" label="Back-off Seconds"
                description="Silence after TTS starts before barge-in can fire" min={0} max={10} step={0.1}
                format={v => `${v.toFixed(1)}s`} />
              <FormField control={form.control} name="bargeInEnergyThreshold" render={({ field }) => (
                <FormItem>
                  <div className="flex justify-between"><FormLabel className="text-xs">Energy Threshold</FormLabel>
                    <span className="text-xs font-mono">{field.value ?? 1200}</span></div>
                  <FormControl>
                    <input type="range" min={100} max={5000} step={100} value={field.value ?? 1200}
                      onChange={e => field.onChange(parseInt(e.target.value))}
                      className="w-full h-1.5 accent-primary cursor-pointer" />
                  </FormControl>
                  <FormDescription className="text-[10px]">Min RMS energy to count as speech</FormDescription>
                </FormItem>
              )} />
            </>
          )}
        </div>

        {/* ── Right column ── */}
        <div className="space-y-4">
          {/* Compliance */}
          <SectionDivider label="Compliance" />
          <p className="text-[10px] text-muted-foreground -mt-2">
            Regulatory disclosures injected into the agent's system prompt at runtime. Enable the frameworks that apply to your use-case.
          </p>
          {([
            { name: "complianceIrdai", label: "IRDAI", desc: "Insurance Regulatory and Development Authority of India — required for insurance advisory calls" },
            { name: "complianceDpdp",  label: "DPDP Act", desc: "Digital Personal Data Protection Act 2023 — required when collecting personal data from callers" },
            { name: "complianceHipaa", label: "HIPAA",   desc: "Health Insurance Portability and Accountability Act — required for healthcare-related calls" },
            { name: "complianceTrai",  label: "TRAI",    desc: "Telecom Regulatory Authority of India — required for commercial communications; includes opt-out" },
          ] as const).map(({ name, label, desc }) => (
            <FormField key={name} control={form.control} name={name} render={({ field }) => (
              <FormItem className="flex items-start justify-between rounded-lg border border-border/50 px-3 py-2 gap-3">
                <div className="flex-1 min-w-0">
                  <FormLabel className="text-sm font-medium">{label}</FormLabel>
                  <FormDescription className="text-[10px] leading-relaxed">{desc}</FormDescription>
                </div>
                <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} className="shrink-0 mt-0.5" /></FormControl>
              </FormItem>
            )} />
          ))}

          <div className="pt-2 space-y-4">
            <SectionDivider label="Description" />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Agent Description</FormLabel>
                <FormControl><Textarea className="min-h-[80px] text-sm resize-none" placeholder="What does this agent do?" {...field} /></FormControl>
              </FormItem>
            )} />
          </div>
        </div>
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

  const handleCreate = () => {
    createAgent.mutate(
      { data: { name: "New Agent", asrProvider: "azure", asrModel: "en-US-standard", llmProvider: "openai", llmModel: "gpt-4o-mini", ttsProvider: "elevenlabs", ttsVoice: "", ttsModel: "", telephonyProvider: "vobiz", systemPrompt: "You are a helpful AI voice assistant.", greetingMessage: "Hello", language: "en-US" } as any },
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
          const costCents = computeAgentRateCents(rateMap, agent as any);
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

/* ── Agent editor panel ─────────────────────────────────────────────────────── */

function AgentEditorPanel({ agentId }: { agentId: number }) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [callDialog, setCallDialog] = useState(false);
  const [callNumber, setCallNumber] = useState("");
  const [otpOpen, setOtpOpen] = useState(false);
  const [pendingNumber, setPendingNumber] = useState("");
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
      llmProvider: "openai", llmModel: "", ttsProvider: "elevenlabs",
      ttsVoice: "", ttsModel: "", telephonyProvider: "vobiz",
      systemPrompt: "", temperature: 0.10, maxDuration: 300,
      greetingMessage: "Hello", endCallPhrases: "", silenceTimeoutSeconds: 30,
      language: "en-US", asrLanguage: "", backchannelingEnabled: true,
      backchannelingFrequency: 0.5, backchannelPhrases: "", webhookUrl: "",
      webhookSecret: "", noiseCancellationEnabled: true, promptVariables: [],
      vadSilenceMs: 250, bargeInEnabled: true, bargeInEnergyThreshold: 1200,
      bargeInMinFrames: 4, timezone: "", machineDetectionMode: "disabled",
      voicemailAction: "hangup",
      voicemailMessage: "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      tools: [], genderDetectionEnabled: false,
      startSpeakingWaitSecs: 0, startSpeakingOnPunctuationSecs: 0.1,
      startSpeakingOnNoPunctuationSecs: 1.5, startSpeakingOnNumberSecs: 0.5,
      stopSpeakingNumWords: 0, stopSpeakingVoiceSecs: 0.2, stopSpeakingBackOffSecs: 1,
      complianceIrdai: false, complianceDpdp: false, complianceHipaa: false, complianceTrai: false,
      knowledgeSourceIds: [],
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

  const isDirty = form.formState.isDirty;

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
          <div className={`h-2 w-2 rounded-full ${agent.status === "active" ? "bg-green-400" : "bg-muted-foreground/40"}`} />
          <span className="text-base font-semibold">{agent.name}</span>
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-mono">#{String(agent.id).padStart(4, "0")}</Badge>
          <span className="text-xs text-muted-foreground">{(agent as any).totalCalls ?? 0} calls</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-7 text-xs gap-1.5" onClick={onSave} disabled={updateAgent.isPending} title={!isDirty ? "No unsaved changes" : undefined}>
            <Save className="h-3.5 w-3.5" />
            {updateAgent.isPending ? "Saving…" : "Save"}
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
      ) : (
        <Form {...form}>
          <form onSubmit={e => e.preventDefault()} className="flex-1 min-h-0 overflow-hidden">
            {activeTab === "overview"  && <OverviewTab form={form} rateMap={rateMap} agent={agent} />}
            {activeTab === "prompt"    && <PromptTab form={form} />}
            {activeTab === "voice"     && <VoiceTab form={form} />}
            {activeTab === "tools"     && <ToolsTab form={form} />}
            {activeTab === "analysis"  && <AnalysisTab form={form} agentId={agentId} />}
            {activeTab === "pipeline"  && <PipelineTab form={form} />}
            {activeTab === "voicemail" && <VoicemailTab form={form} />}
            {activeTab === "advanced"  && <AdvancedTab form={form} />}
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

export default function AgentBuilder() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const createAgent = useCreateAgent();
  const { toast } = useToast();
  const rateMap = useMinuteRatesMap();

  const selectedId = params.id ? parseInt(params.id, 10) : null;

  const handleSelect = (id: number) => navigate(`/app/agents/${id}`);

  const handleCreate = () => {
    createAgent.mutate(
      { data: { name: "New Agent", asrProvider: "azure", asrModel: "en-US-standard", llmProvider: "openai", llmModel: "gpt-4o-mini", ttsProvider: "elevenlabs", ttsVoice: "", ttsModel: "", telephonyProvider: "vobiz", systemPrompt: "You are a helpful AI voice assistant.", greetingMessage: "Hello", language: "en-US" } as any },
      { onSuccess: (agent) => handleSelect(agent.id), onError: (err: unknown) => toast({ title: "Error", description: formatApiError(err), variant: "destructive" }) }
    );
  };

  return (
    <div className="flex h-full overflow-hidden">
      <AgentListPanel selectedId={selectedId} onSelect={handleSelect} rateMap={rateMap} />
      {selectedId
        ? <AgentEditorPanel agentId={selectedId} />
        : <EmptyState onCreate={handleCreate} />
      }
    </div>
  );
}
