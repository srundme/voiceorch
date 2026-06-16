import React, { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  Bot, Plus, Search, Phone, Mic, Brain, Zap, Webhook, PhoneForwarded,
  Save, MoreHorizontal, Power, Trash2, Settings, FileText, Wrench,
  GitBranch, VoicemailIcon, SlidersHorizontal, TestTube2, ChevronRight,
  Volume2, Check, X,
} from "lucide-react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAgents, useGetAgent, useUpdateAgent, useToggleAgent, useDeleteAgent,
  useInitiateOutboundCall, getListAgentsQueryKey, getGetAgentQueryKey,
} from "@workspace/api-client-react";
import { agentFormSchema, buildUpdateAgentPayload } from "./edit";
import type { AgentFormValues } from "./edit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
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
import { CreateAgentWizard } from "@/components/create-agent-wizard";
import {
  ASR_PROVIDERS, LLM_PROVIDERS, TTS_PROVIDERS, TELEPHONY_PROVIDERS,
  LANGUAGES, ASR_MODELS, LLM_MODELS, TTS_MODELS, TTS_VOICES, AGENT_TIMEZONES,
} from "@/lib/agent-providers";
import { useMinuteRatesMap, computeAgentRateCents } from "@/hooks/use-minute-rates";
import { DestinationOtpDialog } from "@/components/destination-otp-dialog";
import { WebCallPanel } from "@/components/webcall-panel";

/* ── Types ──────────────────────────────────────────────────────────────────── */

type TabId = "overview" | "prompt" | "voice" | "tools" | "pipeline" | "voicemail" | "advanced";

interface TabDef { id: TabId; label: string; icon: React.ReactNode }

const TABS: TabDef[] = [
  { id: "overview",   label: "Overview",   icon: <Bot className="h-3.5 w-3.5" /> },
  { id: "prompt",     label: "Prompt",     icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "voice",      label: "Voice",      icon: <Mic className="h-3.5 w-3.5" /> },
  { id: "tools",      label: "Tools",      icon: <Wrench className="h-3.5 w-3.5" /> },
  { id: "pipeline",   label: "Pipeline",   icon: <GitBranch className="h-3.5 w-3.5" /> },
  { id: "voicemail",  label: "Voicemail",  icon: <VoicemailIcon className="h-3.5 w-3.5" /> },
  { id: "advanced",   label: "Advanced",   icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
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
      <SelectContent>
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

/* ── Tab: Overview ──────────────────────────────────────────────────────────── */

function OverviewTab({ form, rateMap, agent }: { form: any; rateMap: Map<string, number>; agent: any }) {
  const asrProvider = form.watch("asrProvider");
  const llmProvider = form.watch("llmProvider");
  const ttsProvider = form.watch("ttsProvider");
  const telephony   = form.watch("telephonyProvider");
  const temperature = form.watch("temperature") ?? 0.1;

  const llmOptions   = LLM_MODELS[llmProvider]  ?? [];
  const ttsModelOpts = TTS_MODELS[ttsProvider]  ?? [];
  const ttsVoiceOpts = TTS_VOICES[ttsProvider]  ?? [];
  const asrModelOpts = ASR_MODELS[asrProvider]  ?? [];

  const costCents = agent ? computeAgentRateCents(rateMap, agent as any) : null;

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: Configuration ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-w-0 border-r border-border/50">
        <div className="p-5 space-y-5">

          {/* IDENTITY */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-foreground/70">
              <Bot className="h-3 w-3" /> Identity
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="col-span-2 space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground">Name</FormLabel>
                  <FormControl><Input className="h-8 text-sm font-medium" {...field} /></FormControl>
                  <FormMessage className="text-[10px]" />
                </FormItem>
              )} />
              <FormField control={form.control} name="language" render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground">Language</FormLabel>
                  <SmallSelect value={field.value} onChange={field.onChange}
                    options={LANGUAGES.map(l => ({ value: l.value, label: l.label }))} placeholder="Select language" />
                </FormItem>
              )} />
              <FormField control={form.control} name="telephonyProvider" render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground">Telephony</FormLabel>
                  <SmallSelect value={field.value} onChange={field.onChange}
                    options={TELEPHONY_PROVIDERS.map(p => ({ value: p.value, label: p.label }))} />
                </FormItem>
              )} />
            </div>
          </div>

          <div className="h-px bg-border/40" />

          {/* BRAIN */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-foreground/70">
              <Brain className="h-3 w-3" /> Brain
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="llmProvider" render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground">LLM Provider</FormLabel>
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
                  <span className="text-xs font-mono text-foreground">{temperature.toFixed(2)}</span>
                </div>
                <input type="range" min={0} max={2} step={0.01} value={temperature}
                  onChange={e => field.onChange(parseFloat(e.target.value))}
                  className="w-full h-1.5 accent-primary cursor-pointer" />
                <div className="flex justify-between text-[9px] text-muted-foreground"><span>0</span><span>2</span></div>
              </FormItem>
            )} />
          </div>

          <div className="h-px bg-border/40" />

          {/* VOICE & SPEECH — merged */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-foreground/70">
              <Volume2 className="h-3 w-3" /> Voice &amp; Speech
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="ttsProvider" render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground">TTS Provider</FormLabel>
                  <SmallSelect value={field.value} onChange={(v) => { field.onChange(v); form.setValue("ttsVoice", ""); form.setValue("ttsModel", ""); }}
                    options={TTS_PROVIDERS.map(p => ({ value: p.value, label: p.label }))} />
                </FormItem>
              )} />
              <FormField control={form.control} name="asrProvider" render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormLabel className="text-[10px] text-muted-foreground">STT Provider</FormLabel>
                  <SmallSelect value={field.value} onChange={(v) => { field.onChange(v); form.setValue("asrModel", ""); }}
                    options={ASR_PROVIDERS.map(p => ({ value: p.value, label: p.label }))} />
                </FormItem>
              )} />
              {ttsVoiceOpts.length > 0 && (
                <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">Voice</FormLabel>
                    <SmallSelect value={field.value ?? ""} onChange={field.onChange}
                      options={ttsVoiceOpts.map((v: any) => ({ value: v.value, label: v.label }))} placeholder="Default" />
                  </FormItem>
                )} />
              )}
              {asrModelOpts.length > 0 && (
                <FormField control={form.control} name="asrModel" render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">STT Model</FormLabel>
                    <SmallSelect value={field.value ?? ""} onChange={field.onChange}
                      options={asrModelOpts.map((m: any) => ({ value: m.value, label: m.label }))} placeholder="Default" />
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )} />
              )}
              {ttsModelOpts.length > 0 && (
                <FormField control={form.control} name="ttsModel" render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel className="text-[10px] text-muted-foreground">TTS Model</FormLabel>
                    <SmallSelect value={field.value ?? ""} onChange={field.onChange}
                      options={ttsModelOpts.map((m: any) => ({ value: m.value, label: m.label }))} placeholder="Default" />
                  </FormItem>
                )} />
              )}
            </div>
          </div>

          {/* Cost strip */}
          <div className="flex items-center justify-between rounded-lg bg-muted/30 border border-border/40 px-4 py-2.5">
            <div className="flex items-center gap-3 flex-wrap">
              {[
                { label: "ASR", val: asrProvider },
                { label: "LLM", val: llmProvider },
                { label: "TTS", val: ttsProvider },
                { label: "Tel", val: telephony },
              ].map(({ label, val }) => (
                <span key={label} className="text-[10px] text-muted-foreground">
                  {label} <span className="text-foreground/70 font-medium">{val || "—"}</span>
                </span>
              ))}
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-bold text-foreground">
                {costCents != null ? `~$${(costCents / 100).toFixed(3)}` : "—"}
              </span>
              <span className="text-[10px] text-muted-foreground">/min</span>
            </div>
          </div>

        </div>
      </div>

      {/* ── Right: Live Test panel ───────────────────────────────────────────── */}
      <div className="w-[280px] shrink-0 flex flex-col min-h-0 bg-background/20">
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
    <div className="flex flex-col h-full p-6 gap-4 overflow-y-auto">
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
  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <SectionDivider label="Speech-to-Text" />
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
          <SectionDivider label="Text-to-Speech" />
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
  return (
    <div className="p-6 overflow-y-auto h-full space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Tools</h3>
          <p className="text-xs text-muted-foreground">Functions the LLM can call mid-conversation</p>
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
      {fields.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/60 p-8 text-center">
          <Wrench className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No tools configured</p>
          <p className="text-xs text-muted-foreground mt-1">Add Call Transfer or Custom Function tools above</p>
        </div>
      )}
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
  );
}

/* ── Tab: Pipeline ──────────────────────────────────────────────────────────── */

function PipelineTab({ form }: { form: any }) {
  return (
    <div className="p-6 overflow-y-auto h-full space-y-5">
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
    <div className="p-6 overflow-y-auto h-full space-y-5 max-w-xl">
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

function AdvancedTab({ form }: { form: any }) {
  const bargeIn = form.watch("bargeInEnabled");
  const { fields: dsFields, append: dsAppend, remove: dsRemove } = useFieldArray({ control: form.control, name: "dispositionSchema" });
  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <SectionDivider label="Barge-in" />
          <FormField control={form.control} name="bargeInEnabled" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
              <div><FormLabel className="text-sm">Allow Barge-in</FormLabel>
                <FormDescription className="text-[10px]">Caller can interrupt agent while it speaks</FormDescription></div>
              <FormControl><Switch checked={field.value ?? true} onCheckedChange={field.onChange} /></FormControl>
            </FormItem>
          )} />
          {bargeIn && (
            <>
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
              <FormField control={form.control} name="bargeInMinFrames" render={({ field }) => (
                <FormItem>
                  <div className="flex justify-between"><FormLabel className="text-xs">Min Frames</FormLabel>
                    <span className="text-xs font-mono">{field.value ?? 4} (~{((field.value ?? 4) * 20)}ms)</span></div>
                  <FormControl>
                    <input type="range" min={1} max={20} step={1} value={field.value ?? 4}
                      onChange={e => field.onChange(parseInt(e.target.value))}
                      className="w-full h-1.5 accent-primary cursor-pointer" />
                  </FormControl>
                </FormItem>
              )} />
            </>
          )}
        </div>
        <div className="space-y-4">
          <SectionDivider label="Description" />
          <FormField control={form.control} name="description" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Agent Description</FormLabel>
              <FormControl><Textarea className="min-h-[80px] text-sm resize-none" placeholder="What does this agent do?" {...field} /></FormControl>
            </FormItem>
          )} />
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionDivider label="Disposition Schema" />
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs ml-4"
            onClick={() => dsAppend({ key: "", label: "", type: "text", required: false, options: "" })}>
            <Plus className="h-3 w-3 mr-1" /> Add Field
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">Fields extracted from the call automatically by the LLM.</p>
        {dsFields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-[1fr_1fr_100px_60px_28px] gap-2 items-start">
            <FormField control={form.control} name={`dispositionSchema.${i}.key`} render={({ field: ff }) => (
              <FormItem className="space-y-0"><FormControl><Input placeholder="field_key" className="h-7 text-xs" {...ff} /></FormControl><FormMessage className="text-[10px]" /></FormItem>
            )} />
            <FormField control={form.control} name={`dispositionSchema.${i}.label`} render={({ field: ff }) => (
              <FormItem className="space-y-0"><FormControl><Input placeholder="Display Label" className="h-7 text-xs" {...ff} /></FormControl><FormMessage className="text-[10px]" /></FormItem>
            )} />
            <FormField control={form.control} name={`dispositionSchema.${i}.type`} render={({ field: ff }) => (
              <FormItem className="space-y-0">
                <Select value={ff.value} onValueChange={ff.onChange}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["text","number","boolean","choice"].map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
            <FormField control={form.control} name={`dispositionSchema.${i}.required`} render={({ field: ff }) => (
              <FormItem className="space-y-0 flex items-center gap-1 pt-1">
                <FormControl><Switch checked={!!ff.value} onCheckedChange={ff.onChange} className="scale-75 origin-left" /></FormControl>
                <span className="text-[9px] text-muted-foreground">req</span>
              </FormItem>
            )} />
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => dsRemove(i)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
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
  const [wizardOpen, setWizardOpen] = useState(false);
  const { data: agents, isLoading } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });

  const filtered = (agents ?? []).filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="w-[240px] shrink-0 border-r border-border/60 flex flex-col h-full bg-background/40">
      <div className="p-3 border-b border-border/60 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agents</span>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setWizardOpen(true)}>
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
            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => setWizardOpen(true)}>
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
      <CreateAgentWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreated={(id) => { setWizardOpen(false); onSelect(id); }} />
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
      ttsVoice: "", ttsModel: "", telephonyProvider: "twilio",
      systemPrompt: "", temperature: 0.10, maxDuration: 300,
      greetingMessage: "Hello", endCallPhrases: "", silenceTimeoutSeconds: 30,
      language: "en-US", asrLanguage: "", backchannelingEnabled: true,
      backchannelingFrequency: 0.5, backchannelPhrases: "", webhookUrl: "",
      webhookSecret: "", noiseCancellationEnabled: true, promptVariables: [],
      vadSilenceMs: 250, bargeInEnabled: true, bargeInEnergyThreshold: 1200,
      bargeInMinFrames: 4, timezone: "", machineDetectionMode: "disabled",
      voicemailAction: "hangup",
      voicemailMessage: "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      tools: [], dispositionSchema: [],
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
      dispositionSchema:        ((agent as any).dispositionSchema ?? []).map((f: any) => ({
        ...f, options: Array.isArray(f.options) ? f.options.join(", ") : (f.options ?? ""),
      })) as AgentFormValues["dispositionSchema"],
    });
  }, [agent]);

  const onSave = form.handleSubmit(async (data) => {
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
  });

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
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-3">
          <div className={`h-2 w-2 rounded-full ${agent.status === "active" ? "bg-green-400" : "bg-muted-foreground/40"}`} />
          <span className="text-base font-semibold">{agent.name}</span>
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-mono">#{String(agent.id).padStart(4, "0")}</Badge>
          <span className="text-xs text-muted-foreground">{(agent as any).totalCalls ?? 0} calls</span>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Button size="sm" className="h-7 text-xs gap-1.5" onClick={onSave} disabled={updateAgent.isPending}>
              <Save className="h-3.5 w-3.5" />
              {updateAgent.isPending ? "Saving…" : "Save"}
            </Button>
          )}
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
      <Form {...form}>
        <form onSubmit={e => e.preventDefault()} className="flex-1 min-h-0 overflow-hidden">
          {activeTab === "overview"  && <OverviewTab form={form} rateMap={rateMap} agent={agent} />}
          {activeTab === "prompt"    && <PromptTab form={form} />}
          {activeTab === "voice"     && <VoiceTab form={form} />}
          {activeTab === "tools"     && <ToolsTab form={form} />}
          {activeTab === "pipeline"  && <PipelineTab form={form} />}
          {activeTab === "voicemail" && <VoicemailTab form={form} />}
          {activeTab === "advanced"  && <AdvancedTab form={form} />}
        </form>
      </Form>

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
  const [wizardOpen, setWizardOpen] = useState(false);
  const rateMap = useMinuteRatesMap();

  const selectedId = params.id ? parseInt(params.id, 10) : null;

  const handleSelect = (id: number) => navigate(`/app/agents/${id}`);

  return (
    <div className="flex h-full overflow-hidden">
      <AgentListPanel selectedId={selectedId} onSelect={handleSelect} rateMap={rateMap} />
      {selectedId
        ? <AgentEditorPanel agentId={selectedId} />
        : <EmptyState onCreate={() => setWizardOpen(true)} />
      }
      <CreateAgentWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreated={(id) => { setWizardOpen(false); handleSelect(id); }} />
    </div>
  );
}
