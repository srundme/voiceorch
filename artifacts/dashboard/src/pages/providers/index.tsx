import React, { useState } from "react";
import {
  Plus, Lock, Trash2, ExternalLink, Mic, Brain, AudioLines, Phone,
  KeyRound, ShieldCheck, ArrowRight,
} from "lucide-react";
import {
  useListProviders,
  useCreateProvider,
  useDeleteProvider,
  getListProvidersQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatApiError, mapApiErrors } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";

/* ── Provider definitions ────────────────────────────────────────────────── */
interface ExtraField {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
}

interface ProviderDef {
  label: string;
  value: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  docsUrl: string;
  docsLabel: string;
  extraFields?: ExtraField[];
}

const SUPPORTED_PROVIDERS: Record<string, ProviderDef[]> = {
  asr: [
    { label: "Deepgram", value: "deepgram", apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your Deepgram key…", docsUrl: "https://console.deepgram.com", docsLabel: "console.deepgram.com" },
    { label: "Azure Speech", value: "azure", apiKeyLabel: "Speech Key", apiKeyPlaceholder: "Paste your Azure Speech key…", docsUrl: "https://portal.azure.com", docsLabel: "portal.azure.com", extraFields: [{ key: "region", label: "Region", placeholder: "e.g. eastus", hint: "Azure region where your speech resource is deployed" }] },
    { label: "AssemblyAI", value: "assemblyai", apiKeyLabel: "API Key", apiKeyPlaceholder: "v2-…", docsUrl: "https://www.assemblyai.com/app", docsLabel: "assemblyai.com" },
    { label: "Sarvam AI", value: "sarvam", apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your Sarvam key…", docsUrl: "https://dashboard.sarvam.ai", docsLabel: "dashboard.sarvam.ai" },
    { label: "Cartesia", value: "cartesia", apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your Cartesia key…", docsUrl: "https://play.cartesia.ai/keys", docsLabel: "play.cartesia.ai" },
  ],
  llm: [
    { label: "OpenAI", value: "openai", apiKeyLabel: "API Key", apiKeyPlaceholder: "sk-…", docsUrl: "https://platform.openai.com/api-keys", docsLabel: "platform.openai.com" },
    { label: "Anthropic", value: "anthropic", apiKeyLabel: "API Key", apiKeyPlaceholder: "sk-ant-…", docsUrl: "https://console.anthropic.com", docsLabel: "console.anthropic.com" },
    { label: "Qwen (via Groq)", value: "qwen", apiKeyLabel: "API Key", apiKeyPlaceholder: "gsk_…", docsUrl: "https://console.groq.com/keys", docsLabel: "console.groq.com" },
    { label: "Groq", value: "groq", apiKeyLabel: "API Key", apiKeyPlaceholder: "gsk_…", docsUrl: "https://console.groq.com/keys", docsLabel: "console.groq.com" },
    { label: "DeepSeek", value: "deepseek", apiKeyLabel: "API Key", apiKeyPlaceholder: "sk-…", docsUrl: "https://platform.deepseek.com", docsLabel: "platform.deepseek.com" },
    { label: "Mistral", value: "mistral", apiKeyLabel: "API Key", apiKeyPlaceholder: "…", docsUrl: "https://console.mistral.ai", docsLabel: "console.mistral.ai" },
    { label: "Sarvam AI", value: "sarvam", apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your Sarvam key…", docsUrl: "https://dashboard.sarvam.ai", docsLabel: "dashboard.sarvam.ai" },
  ],
  tts: [
    { label: "ElevenLabs", value: "elevenlabs", apiKeyLabel: "API Key", apiKeyPlaceholder: "sk_…", docsUrl: "https://elevenlabs.io/app/settings/api-keys", docsLabel: "elevenlabs.io" },
    { label: "Cartesia (Sonic)", value: "cartesia", apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your Cartesia key…", docsUrl: "https://play.cartesia.ai/keys", docsLabel: "play.cartesia.ai" },
    { label: "OpenAI TTS", value: "openai", apiKeyLabel: "API Key", apiKeyPlaceholder: "sk-…", docsUrl: "https://platform.openai.com/api-keys", docsLabel: "platform.openai.com" },
    { label: "AWS Polly", value: "aws_polly", apiKeyLabel: "Access Key", apiKeyPlaceholder: "AKIA…", docsUrl: "https://console.aws.amazon.com/iam", docsLabel: "console.aws.amazon.com" },
    { label: "Azure TTS", value: "azure", apiKeyLabel: "Speech Key", apiKeyPlaceholder: "Paste your Azure Speech key…", docsUrl: "https://portal.azure.com", docsLabel: "portal.azure.com" },
    { label: "Sarvam AI", value: "sarvam", apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your Sarvam key…", docsUrl: "https://dashboard.sarvam.ai", docsLabel: "dashboard.sarvam.ai" },
  ],
  telephony: [
    { label: "Twilio", value: "twilio", apiKeyLabel: "Auth Token", apiKeyPlaceholder: "Paste your Twilio Auth Token…", docsUrl: "https://console.twilio.com", docsLabel: "console.twilio.com", extraFields: [{ key: "accountSid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", hint: "Found on your Twilio console home page" }, { key: "fromNumber", label: "Twilio Phone Number", placeholder: "+1234567890", hint: "The phone number you bought on Twilio (E.164 format)" }] },
    { label: "Plivo", value: "plivo", apiKeyLabel: "Auth Token", apiKeyPlaceholder: "Paste your Plivo Auth Token…", docsUrl: "https://console.plivo.com", docsLabel: "console.plivo.com", extraFields: [{ key: "authId", label: "Auth ID", placeholder: "MAXXXXXXXXXXXXXXXXXX", hint: "Found on your Plivo console dashboard" }, { key: "fromNumber", label: "Plivo Phone Number", placeholder: "+1234567890", hint: "The phone number you bought on Plivo (E.164 format)" }] },
    { label: "Vobiz", value: "vobiz", apiKeyLabel: "Auth Token", apiKeyPlaceholder: "Paste your Vobiz Auth Token…", docsUrl: "https://docs.vobiz.ai", docsLabel: "docs.vobiz.ai", extraFields: [{ key: "authId", label: "Auth ID", placeholder: "MA_XXXXXXXX", hint: "Found in Vobiz Console → API Credentials" }, { key: "fromNumber", label: "Vobiz Phone Number", placeholder: "+1234567890", hint: "The DID number you have on Vobiz (E.164 format)" }] },
  ],
};

const TYPE_LABELS: Record<string, string> = {
  asr:           "Speech-to-Text",
  llm:           "Language Model",
  tts:           "Text-to-Speech",
  telephony:     "Telephony",
};

const TYPE_DESC: Record<string, string> = {
  asr:           "Transcribe caller speech",
  llm:           "Drive conversation logic",
  tts:           "Synthesize agent voice",
  telephony:     "Handle call infrastructure",
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  asr:       Mic,
  llm:       Brain,
  tts:       AudioLines,
  telephony: Phone,
};

/* Category icon container — monochrome, no colorful backgrounds */
const TYPE_ACCENT: Record<string, string> = {
  asr:       "bg-muted text-foreground/70",
  llm:       "bg-muted text-foreground/70",
  tts:       "bg-muted text-foreground/70",
  telephony: "bg-muted text-foreground/70",
};

/* Deterministic accent palette per provider, keyed by first letter of the value */
const AVATAR_PALETTE = [
  "bg-blue-500/15 text-blue-500",
  "bg-violet-500/15 text-violet-500",
  "bg-emerald-500/15 text-emerald-500",
  "bg-amber-500/15 text-amber-500",
  "bg-rose-500/15 text-rose-500",
  "bg-cyan-500/15 text-cyan-500",
  "bg-fuchsia-500/15 text-fuchsia-500",
  "bg-orange-500/15 text-orange-500",
];

function avatarClasses(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function providerInitials(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9 ]/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

/* Small ring showing configured/total completion for a category */
function CompletionRing({ value, total }: { value: number; total: number }) {
  const size = 34;
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  const offset = circumference * (1 - pct);
  const complete = total > 0 && value >= total;

  return (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" className="stroke-border" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn("transition-all duration-500", complete ? "stroke-emerald-500" : value > 0 ? "stroke-primary" : "stroke-transparent")}
        />
      </svg>
      <span className="absolute text-[9px] font-semibold tabular-nums text-foreground/70">{value}/{total}</span>
    </div>
  );
}

/* ── Form schema ──────────────────────────────────────────────────────────── */
const providerFormSchema = z.object({
  providerType: z.enum(["asr", "llm", "tts", "telephony"]),
  providerName: z.string().min(1, "Please select a provider"),
  apiKey:       z.string().min(1, "API key is required"),
  extraFields:  z.record(z.string()).optional(),
});

type ProviderFormValues = z.infer<typeof providerFormSchema>;

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function ProvidersList() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [extraFieldValues, setExtraFieldValues] = useState<Record<string, string>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const { data: providers, isLoading } = useListProviders({ query: { queryKey: getListProvidersQueryKey() } });
  const createProvider = useCreateProvider();
  const deleteProvider = useDeleteProvider();

  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerFormSchema),
    defaultValues: { providerType: "asr", providerName: "", apiKey: "" },
  });

  const selectedType          = form.watch("providerType");
  const selectedProviderValue = form.watch("providerName");
  const availableProviders    = SUPPORTED_PROVIDERS[selectedType] ?? [];
  const selectedDef           = availableProviders.find(p => p.value === selectedProviderValue);

  const openDialog = (type?: string) => {
    const t = (type ?? "llm") as ProviderFormValues["providerType"];
    form.reset({ providerType: t, providerName: "", apiKey: "" });
    setExtraFieldValues({});
    setIsAddOpen(true);
  };

  const onSubmit = (data: ProviderFormValues) => {
    const extraConfig = selectedDef?.extraFields?.length
      ? JSON.stringify(Object.fromEntries(selectedDef.extraFields.map(f => [f.key, extraFieldValues[f.key] ?? ""]).filter(([, v]) => v)))
      : undefined;

    createProvider.mutate(
      { data: { providerType: data.providerType, providerName: data.providerName, apiKey: data.apiKey, extraConfig } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
          setIsAddOpen(false);
          form.reset();
          setExtraFieldValues({});
          toast({ title: "Provider added", description: "Your credentials have been securely saved." });
        },
        onError: (err: unknown) => {
          const fieldErrors = mapApiErrors(err);
          const fieldKeys   = Object.keys(fieldErrors);
          if (fieldKeys.length > 0) {
            for (const [field, message] of Object.entries(fieldErrors)) {
              form.setError(field as Parameters<typeof form.setError>[0], { type: "server", message });
            }
            toast({ title: "Validation error", description: "Please fix the highlighted fields.", variant: "destructive" });
          } else {
            toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
          }
        }
      }
    );
  };

  const confirmDelete = () => {
    if (pendingDeleteId == null) return;
    const id = pendingDeleteId;
    deleteProvider.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
          toast({ title: "Provider removed" });
        },
        onError: (err: unknown) => {
          toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
        },
        onSettled: () => setPendingDeleteId(null),
      }
    );
  };

  const groupedProviders = providers?.reduce((acc, p) => {
    if (!acc[p.providerType]) acc[p.providerType] = [];
    acc[p.providerType]!.push(p);
    return acc;
  }, {} as Record<string, typeof providers>) ?? {};

  return (
    <div className="flex-1 overflow-y-auto animate-fade-in">
    <div className="max-w-[1400px] mx-auto px-10 py-10 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50 mb-1.5">Build</p>
          <h1 className="text-[18px] font-semibold tracking-tight text-foreground leading-none">Providers</h1>
          <p className="text-[13px] mt-1.5 text-muted-foreground/60 max-w-[520px]">API keys for your voice AI services. Stored encrypted, never exposed.</p>
        </div>
        <button
          onClick={() => openDialog()}
          className="flex items-center gap-1.5 text-[13px] font-medium rounded-xl px-3.5 h-[38px] border border-border bg-transparent text-foreground/85 hover:bg-accent/40 hover:border-border active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background shrink-0"
          data-testid="button-add-provider"
        >
          <Plus className="h-3.5 w-3.5" /> Add Provider
        </button>
      </div>

      {/* Add Provider Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/70 bg-gradient-to-b from-accent/40 to-transparent">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <KeyRound className="h-4 w-4" />
              </div>
              <DialogTitle className="text-[15px] font-semibold">Add Provider Key</DialogTitle>
            </div>
            <DialogDescription className="text-[12.5px] flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              Credentials are encrypted at rest and used at call time only.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="px-6 pt-5 pb-6 space-y-5">

              {/* Step 1 — category & provider */}
              <div className="space-y-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">1 · Choose service</p>

                <FormField control={form.control} name="providerType" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[12.5px]">Service Category</FormLabel>
                    <Select onValueChange={(val) => { field.onChange(val); form.setValue("providerName", ""); form.setValue("apiKey", ""); setExtraFieldValues({}); }} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="asr">Speech-to-Text (ASR)</SelectItem>
                        <SelectItem value="llm">Language Model (LLM)</SelectItem>
                        <SelectItem value="tts">Text-to-Speech (TTS)</SelectItem>
                        <SelectItem value="telephony">Telephony</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="providerName" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[12.5px]">Provider</FormLabel>
                    <Select onValueChange={(val) => { field.onChange(val); form.setValue("apiKey", ""); setExtraFieldValues({}); }} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {availableProviders.map(p => (<SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    {selectedDef && (
                      <FormDescription className="text-[11px] flex items-center gap-1">
                        <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40" />
                        Get credentials at{" "}
                        <a href={selectedDef.docsUrl} target="_blank" rel="noopener noreferrer" className="text-primary/90 hover:text-primary inline-flex items-center gap-0.5 font-medium hover:underline">
                          {selectedDef.docsLabel}<ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Step 2 — credentials */}
              {selectedDef && (
                <div className="space-y-3.5 pt-1 border-t border-border/60">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50 pt-3.5">2 · Enter credentials</p>

                  {selectedDef.extraFields && selectedDef.extraFields.length > 0 && (
                    <div className="space-y-3">
                      {selectedDef.extraFields.map(f => (
                        <div key={f.key} className="space-y-1.5">
                          <label className="text-[12.5px] font-medium leading-none">{f.label}</label>
                          <Input placeholder={f.placeholder} value={extraFieldValues[f.key] ?? ""} onChange={e => setExtraFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))} />
                          {f.hint && <p className="text-[11px] text-muted-foreground/60">{f.hint}</p>}
                        </div>
                      ))}
                    </div>
                  )}

                  <FormField control={form.control} name="apiKey" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[12.5px]">{selectedDef.apiKeyLabel}</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder={selectedDef.apiKeyPlaceholder} className="font-mono" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              )}

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createProvider.isPending} data-testid="button-save-provider">
                  {createProvider.isPending ? "Saving…" : "Save Provider"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={pendingDeleteId != null} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this provider?</AlertDialogTitle>
            <AlertDialogDescription>
              Agents currently using this provider will stop working until a replacement key is added. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Provider Grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-card rounded-xl border border-border/60 overflow-hidden">
              <div className="px-5 py-4 border-b border-border/50 flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-2.5 w-36" />
                </div>
                <Skeleton className="h-8 w-8 rounded-full" />
              </div>
              <div className="p-3.5 space-y-2">
                <Skeleton className="h-11 w-full rounded-lg" />
                <Skeleton className="h-11 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(["asr", "llm", "tts", "telephony"] as const).map(type => {
            const typeProviders = groupedProviders[type] ?? [];
            const supported     = SUPPORTED_PROVIDERS[type]!;
            const Icon          = TYPE_ICONS[type]!;
            const isEmpty       = typeProviders.length === 0;
            return (
              <div
                key={type}
                className="group/card flex flex-col h-full bg-card rounded-xl border border-border/60 overflow-hidden hover:border-border transition-colors duration-150"
              >
                {/* Header */}
                <div className="px-5 py-4 border-b border-border/50 flex items-center gap-3">
                  <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", TYPE_ACCENT[type])}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[16px] font-semibold text-foreground leading-tight">{TYPE_LABELS[type]}</p>
                    <p className="text-[13px] text-muted-foreground/60 truncate">{TYPE_DESC[type]}</p>
                  </div>
                  <CompletionRing value={typeProviders.length} total={supported.length} />
                </div>

                {/* Provider entries */}
                <div className="p-3.5 flex-1 flex flex-col gap-1.5">
                  {isEmpty ? (
                    <div className="flex flex-1 flex-col items-center justify-center text-center gap-2.5 py-7 px-5 rounded-lg border border-dashed border-border/50 bg-accent/10">
                      <div className={cn("h-9 w-9 rounded-full flex items-center justify-center", TYPE_ACCENT[type])}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-[13.5px] font-medium text-foreground/80">No {TYPE_LABELS[type]} provider yet</p>
                        <p className="text-[12px] text-muted-foreground/50 max-w-[240px] mx-auto">
                          Connect a key to enable {TYPE_DESC[type].toLowerCase()} for your agents.
                        </p>
                      </div>
                      <button
                        className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium rounded-xl px-3.5 h-9 border border-border bg-transparent text-foreground/85 hover:bg-accent/40 active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        onClick={() => openDialog(type)}
                      >
                        <Plus className="h-3.5 w-3.5" /> Connect {TYPE_LABELS[type]}
                      </button>
                    </div>
                  ) : (
                    <>
                      {typeProviders.map(provider => {
                        const def = supported.find(p => p.value === provider.providerName);
                        const displayName = def?.label ?? provider.providerName;
                        return (
                          <div
                            key={provider.id}
                            className="group flex items-center justify-between px-3 py-2.5 rounded-lg bg-elevated/50 border border-border/50 hover:border-border/80 hover:bg-elevated transition-colors duration-150"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center text-[10.5px] font-bold shrink-0", avatarClasses(provider.providerName))}>
                                {providerInitials(displayName)}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[13px] font-medium text-foreground/85 truncate">{displayName}</span>
                                  {provider.isActive && (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                      ACTIVE
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center text-[11px] text-muted-foreground/45 gap-1 font-mono mt-0.5">
                                  <Lock className="h-2.5 w-2.5" />
                                  •••• {provider.apiKeyHint ?? "••••"}
                                </div>
                              </div>
                            </div>
                            <button
                              className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground/25 opacity-60 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-colors duration-150 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                              onClick={() => setPendingDeleteId(provider.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}

                      {/* Add button */}
                      <button
                        className="w-full flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed border-border/50 text-[12.5px] font-medium text-muted-foreground/45 hover:text-muted-foreground/80 hover:border-border hover:bg-accent/25 transition-colors duration-150 mt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        onClick={() => openDialog(type)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add {TYPE_LABELS[type]}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
    </div>
  );
}
