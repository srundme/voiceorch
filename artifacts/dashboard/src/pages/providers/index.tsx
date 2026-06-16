import React, { useState } from "react";
import { Plus, Lock, Trash2, ExternalLink } from "lucide-react";
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
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatApiError, mapApiErrors } from "@/lib/format-api-error";

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
  orchestration: [
    { label: "Bolna", value: "bolna", apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your Bolna API key…", docsUrl: "https://app.bolna.ai", docsLabel: "app.bolna.ai" },
  ],
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
  orchestration: "Orchestration",
  asr:           "Speech-to-Text",
  llm:           "Language Model",
  tts:           "Text-to-Speech",
  telephony:     "Telephony",
};

const TYPE_DESC: Record<string, string> = {
  orchestration: "Platform integrations (e.g. Bolna)",
  asr:           "Transcribe caller speech",
  llm:           "Drive conversation logic",
  tts:           "Synthesize agent voice",
  telephony:     "Handle call infrastructure",
};

/* ── Form schema ──────────────────────────────────────────────────────────── */
const providerFormSchema = z.object({
  providerType: z.enum(["orchestration", "asr", "llm", "tts", "telephony"]),
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

  const { data: providers, isLoading } = useListProviders({ query: { queryKey: getListProvidersQueryKey() } });
  const createProvider = useCreateProvider();
  const deleteProvider = useDeleteProvider();

  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerFormSchema),
    defaultValues: { providerType: "orchestration", providerName: "", apiKey: "" },
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

  const handleDelete = (id: number) => {
    if (confirm("Remove this provider? Agents using it will stop working.")) {
      deleteProvider.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
            toast({ title: "Provider removed" });
          },
          onError: (err: unknown) => {
            toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
          }
        }
      );
    }
  };

  const groupedProviders = providers?.reduce((acc, p) => {
    if (!acc[p.providerType]) acc[p.providerType] = [];
    acc[p.providerType]!.push(p);
    return acc;
  }, {} as Record<string, typeof providers>) ?? {};

  return (
    <div className="flex-1 overflow-y-auto animate-fade-in">
    <div className="max-w-5xl mx-auto px-8 py-8 space-y-7">

      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50 mb-1.5">Build</p>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground leading-none">Providers</h1>
          <p className="text-[12.5px] mt-1.5 text-muted-foreground/60">API keys for your voice AI services. Stored encrypted, never exposed.</p>
        </div>
        <button
          onClick={() => openDialog()}
          className="flex items-center gap-2 text-[12.5px] font-medium border border-border rounded-lg px-4 py-2 hover:bg-accent text-foreground/80 hover:text-foreground transition-colors"
          data-testid="button-add-provider"
        >
          <Plus className="h-3.5 w-3.5" /> Add Provider
        </button>
      </div>

      {/* Add Provider Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-semibold">Add Provider Key</DialogTitle>
            <DialogDescription className="text-[12.5px]">
              Credentials are stored server-side and used at call time.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-1">
              <FormField control={form.control} name="providerType" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[12.5px]">Service Category</FormLabel>
                  <Select onValueChange={(val) => { field.onChange(val); form.setValue("providerName", ""); form.setValue("apiKey", ""); setExtraFieldValues({}); }} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="orchestration">Orchestration</SelectItem>
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
                      Get credentials at{" "}
                      <a href={selectedDef.docsUrl} target="_blank" rel="noopener noreferrer" className="text-foreground/70 hover:text-foreground inline-flex items-center gap-0.5 hover:underline">
                        {selectedDef.docsLabel}<ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )} />

              {selectedDef?.extraFields && selectedDef.extraFields.length > 0 && (
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

              {selectedDef && (
                <FormField control={form.control} name="apiKey" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[12.5px]">{selectedDef.apiKeyLabel}</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder={selectedDef.apiKeyPlaceholder} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createProvider.isPending} data-testid="button-save-provider">
                  {createProvider.isPending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Provider Grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-card rounded-2xl border border-border p-6">
              <Skeleton className="h-4 w-32 mb-4" />
              <Skeleton className="h-16 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(["orchestration", "asr", "llm", "tts", "telephony"] as const).map(type => {
            const typeProviders = groupedProviders[type] ?? [];
            const supported     = SUPPORTED_PROVIDERS[type]!;
            return (
              <div key={type} className="bg-card rounded-2xl border border-border overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-foreground">{TYPE_LABELS[type]}</p>
                    <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/40 px-2 py-0.5 rounded border border-border">
                      {typeProviders.length} / {supported.length}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground/50 mt-0.5">{TYPE_DESC[type]}</p>
                </div>

                {/* Provider entries */}
                <div className="p-3 flex flex-col gap-1.5">
                  {typeProviders.map(provider => (
                    <div key={provider.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-elevated/60 border border-border/60">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] font-medium text-foreground/80 capitalize">{provider.providerName}</span>
                          {provider.isActive && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded border border-foreground/[0.07] bg-foreground/[0.04] text-foreground/40">ACTIVE</span>
                          )}
                        </div>
                        <div className="flex items-center text-[11px] text-muted-foreground/40 gap-1 font-mono mt-0.5">
                          <Lock className="h-2.5 w-2.5" />
                          •••• {provider.apiKeyHint ?? "••••"}
                        </div>
                      </div>
                      <button
                        className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground/30 hover:text-muted-foreground/70 hover:bg-accent transition-colors"
                        onClick={() => handleDelete(provider.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}

                  {/* Add button */}
                  <button
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-border/50 text-[12px] text-muted-foreground/40 hover:text-muted-foreground/70 hover:border-border hover:bg-accent/30 transition-colors mt-0.5"
                    onClick={() => openDialog(type)}
                  >
                    <Plus className="h-3 w-3" />
                    Add {TYPE_LABELS[type]}
                  </button>
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
