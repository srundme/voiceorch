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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

/* ── Provider definitions ─────────────────────────────────────────────────── */

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
    {
      label: "Azure Speech", value: "azure",
      apiKeyLabel: "Speech Key", apiKeyPlaceholder: "Paste your Azure Speech key…",
      docsUrl: "https://portal.azure.com", docsLabel: "portal.azure.com",
      extraFields: [{ key: "region", label: "Region", placeholder: "e.g. eastus", hint: "Azure region where your speech resource is deployed" }],
    },
    {
      label: "AssemblyAI", value: "assemblyai",
      apiKeyLabel: "API Key", apiKeyPlaceholder: "v2-…",
      docsUrl: "https://www.assemblyai.com/app", docsLabel: "assemblyai.com",
    },
    {
      label: "Sarvam AI", value: "sarvam",
      apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your Sarvam key…",
      docsUrl: "https://dashboard.sarvam.ai", docsLabel: "dashboard.sarvam.ai",
    },
    {
      label: "Cartesia", value: "cartesia",
      apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your Cartesia key…",
      docsUrl: "https://play.cartesia.ai/keys", docsLabel: "play.cartesia.ai",
    },
  ],
  llm: [
    {
      label: "OpenAI", value: "openai",
      apiKeyLabel: "API Key", apiKeyPlaceholder: "sk-…",
      docsUrl: "https://platform.openai.com/api-keys", docsLabel: "platform.openai.com",
    },
    {
      label: "Google Gemini", value: "google",
      apiKeyLabel: "API Key", apiKeyPlaceholder: "AIza…",
      docsUrl: "https://aistudio.google.com/app/apikey", docsLabel: "aistudio.google.com",
    },
    {
      label: "Groq", value: "groq",
      apiKeyLabel: "API Key", apiKeyPlaceholder: "gsk_…",
      docsUrl: "https://console.groq.com/keys", docsLabel: "console.groq.com",
    },
    {
      label: "Sarvam AI", value: "sarvam",
      apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your Sarvam key…",
      docsUrl: "https://dashboard.sarvam.ai", docsLabel: "dashboard.sarvam.ai",
    },
  ],
  tts: [
    {
      label: "ElevenLabs", value: "elevenlabs",
      apiKeyLabel: "API Key", apiKeyPlaceholder: "sk_…",
      docsUrl: "https://elevenlabs.io/app/settings/api-keys", docsLabel: "elevenlabs.io",
    },
    {
      label: "Cartesia (Sonic)", value: "cartesia",
      apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your Cartesia key…",
      docsUrl: "https://play.cartesia.ai/keys", docsLabel: "play.cartesia.ai",
    },
    {
      label: "Sarvam AI (Bulbul)", value: "sarvam",
      apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your Sarvam key…",
      docsUrl: "https://dashboard.sarvam.ai", docsLabel: "dashboard.sarvam.ai",
    },
  ],
  telephony: [
    {
      label: "Twilio", value: "twilio",
      apiKeyLabel: "Auth Token", apiKeyPlaceholder: "Paste your Twilio Auth Token…",
      docsUrl: "https://console.twilio.com", docsLabel: "console.twilio.com",
      extraFields: [
        { key: "accountSid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", hint: "Found on your Twilio console home page" },
        { key: "fromNumber", label: "Your Twilio Phone Number", placeholder: "+1234567890", hint: "The phone number you bought on Twilio (E.164 format)" },
      ],
    },
    {
      label: "Plivo", value: "plivo",
      apiKeyLabel: "Auth Token", apiKeyPlaceholder: "Paste your Plivo Auth Token…",
      docsUrl: "https://console.plivo.com", docsLabel: "console.plivo.com",
      extraFields: [
        { key: "authId", label: "Auth ID", placeholder: "MAXXXXXXXXXXXXXXXXXX", hint: "Found on your Plivo console dashboard" },
        { key: "fromNumber", label: "Your Plivo Phone Number", placeholder: "+1234567890", hint: "The phone number you bought on Plivo (E.164 format)" },
      ],
    },
    {
      label: "Vobiz", value: "vobiz",
      apiKeyLabel: "Auth Token", apiKeyPlaceholder: "Paste your Vobiz Auth Token…",
      docsUrl: "https://docs.vobiz.ai", docsLabel: "docs.vobiz.ai",
      extraFields: [
        { key: "authId", label: "Auth ID", placeholder: "MA_XXXXXXXX", hint: "Found in Vobiz Console → API Credentials" },
        { key: "fromNumber", label: "Your Vobiz Phone Number", placeholder: "+1234567890", hint: "The DID number you have on Vobiz (E.164 format)" },
      ],
    },
  ],
};

const TYPE_LABELS: Record<string, string> = {
  asr: "Speech-to-Text (ASR)",
  llm: "Language Models (LLM)",
  tts: "Text-to-Speech (TTS)",
  telephony: "Telephony",
};

const TYPE_ICONS: Record<string, string> = {
  asr: "🎙️",
  llm: "🤖",
  tts: "🔊",
  telephony: "📞",
};

/* ── Form schema ──────────────────────────────────────────────────────────── */

const providerFormSchema = z.object({
  providerType: z.enum(["asr", "llm", "tts", "telephony"]),
  providerName: z.string().min(1, "Please select a provider"),
  apiKey: z.string().min(1, "API key is required"),
  extraFields: z.record(z.string()).optional(),
});

type ProviderFormValues = z.infer<typeof providerFormSchema>;

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function ProvidersList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [initialType, setInitialType] = useState<string>("llm");
  const [extraFieldValues, setExtraFieldValues] = useState<Record<string, string>>({});

  const { data: providers, isLoading } = useListProviders({
    query: { queryKey: getListProvidersQueryKey() }
  });

  const createProvider = useCreateProvider();
  const deleteProvider = useDeleteProvider();

  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerFormSchema),
    defaultValues: { providerType: "llm", providerName: "", apiKey: "" },
  });

  const selectedType = form.watch("providerType");
  const selectedProviderValue = form.watch("providerName");
  const availableProviders = SUPPORTED_PROVIDERS[selectedType] ?? [];
  const selectedDef = availableProviders.find(p => p.value === selectedProviderValue);

  const openDialog = (type?: string) => {
    const t = (type ?? "llm") as ProviderFormValues["providerType"];
    form.reset({ providerType: t, providerName: "", apiKey: "" });
    setExtraFieldValues({});
    setInitialType(t);
    setIsAddOpen(true);
  };

  const onSubmit = (data: ProviderFormValues) => {
    const extraConfig = selectedDef?.extraFields && selectedDef.extraFields.length > 0
      ? JSON.stringify(
          Object.fromEntries(
            selectedDef.extraFields
              .map(f => [f.key, extraFieldValues[f.key] ?? ""])
              .filter(([, v]) => v)
          )
        )
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
        onError: () => {
          toast({ title: "Error", description: "Failed to save provider.", variant: "destructive" });
        }
      }
    );
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure? Agents using this key will stop working.")) {
      deleteProvider.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
            toast({ title: "Provider deleted" });
          },
          onError: () => {
            toast({ title: "Error", description: "Failed to delete provider.", variant: "destructive" });
          }
        }
      );
    }
  };

  const groupedProviders = providers?.reduce((acc, provider) => {
    if (!acc[provider.providerType]) acc[provider.providerType] = [];
    acc[provider.providerType]!.push(provider);
    return acc;
  }, {} as Record<string, typeof providers>) ?? {};

  return (
    <div className="h-full overflow-y-auto">
    <div className="space-y-8 p-6 md:p-8 pt-6 max-w-6xl mx-auto flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Providers</h2>
          <p className="text-muted-foreground">Add your API keys for voice AI services. Keys are stored securely and never exposed in full.</p>
        </div>
        <Button onClick={() => openDialog()} data-testid="button-add-provider">
          <Plus className="mr-2 h-4 w-4" /> Add Provider Key
        </Button>
      </div>

      {/* Add Provider Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Add Provider Key</DialogTitle>
            <DialogDescription>
              Fill in your credentials below. They are stored on the server and used at call time.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-1">

              {/* Service Category */}
              <FormField
                control={form.control}
                name="providerType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Category</FormLabel>
                    <Select
                      onValueChange={(val) => {
                        field.onChange(val);
                        form.setValue("providerName", "");
                        form.setValue("apiKey", "");
                        setExtraFieldValues({});
                      }}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="asr">🎙️ Speech-to-Text (ASR)</SelectItem>
                        <SelectItem value="llm">🤖 Language Model (LLM)</SelectItem>
                        <SelectItem value="tts">🔊 Text-to-Speech (TTS)</SelectItem>
                        <SelectItem value="telephony">📞 Telephony</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Provider */}
              <FormField
                control={form.control}
                name="providerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider</FormLabel>
                    <Select
                      onValueChange={(val) => {
                        field.onChange(val);
                        form.setValue("apiKey", "");
                        setExtraFieldValues({});
                      }}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableProviders.map(p => (
                          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedDef && (
                      <FormDescription className="flex items-center gap-1">
                        Get credentials at{" "}
                        <a
                          href={selectedDef.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary inline-flex items-center gap-0.5 hover:underline"
                        >
                          {selectedDef.docsLabel}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Dynamic extra fields — shown BEFORE API key for telephony so it reads naturally */}
              {selectedDef?.extraFields && selectedDef.extraFields.length > 0 && (
                <div className="space-y-3">
                  {selectedDef.extraFields.map(f => (
                    <div key={f.key} className="space-y-1.5">
                      <label className="text-sm font-medium leading-none">{f.label}</label>
                      <Input
                        placeholder={f.placeholder}
                        value={extraFieldValues[f.key] ?? ""}
                        onChange={e => setExtraFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      />
                      {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* API Key / Auth Token */}
              {selectedDef && (
                <FormField
                  control={form.control}
                  name="apiKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{selectedDef.apiKeyLabel}</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder={selectedDef.apiKeyPlaceholder}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2">
            {[1, 2, 3, 4].map(i => (
              <Card key={i}>
                <CardHeader><Skeleton className="h-6 w-[200px]" /></CardHeader>
                <CardContent><Skeleton className="h-20 w-full" /></CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {(["asr", "llm", "tts", "telephony"] as const).map(type => {
              const typeProviders = groupedProviders[type] ?? [];
              const supported = SUPPORTED_PROVIDERS[type]!;
              return (
                <Card key={type} className="flex flex-col">
                  <CardHeader className="pb-3 border-b border-border/50">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <span>{TYPE_ICONS[type]}</span>
                      {TYPE_LABELS[type]}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Supported: {supported.map(p => p.label).join(", ")}
                    </p>
                  </CardHeader>
                  <CardContent className="pt-4 flex-1 flex flex-col gap-2">
                    {typeProviders.length > 0 ? (
                      typeProviders.map(provider => (
                        <div key={provider.id} className="flex items-center justify-between px-3 py-2.5 rounded-md bg-muted/40 border border-border/50">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm capitalize">{provider.providerName}</span>
                              {provider.isActive && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-gray-50 text-gray-700 border-gray-200">Active</Badge>
                              )}
                            </div>
                            <div className="flex items-center text-xs text-muted-foreground gap-1 font-mono">
                              <Lock className="h-3 w-3" />
                              •••• {provider.apiKeyHint ?? "••••"}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDelete(provider.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full border border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 mt-auto"
                      onClick={() => openDialog(type)}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1.5" /> Add {TYPE_LABELS[type]} key
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
