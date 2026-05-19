import React, { useState } from "react";
import { Plus, Key, Lock, Settings2, Trash2, AlertCircle, ExternalLink } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

// Providers supported by the orchestration engine
const SUPPORTED_PROVIDERS: Record<string, { label: string; value: string; hint: string; docsUrl: string; extraConfigHint?: string }[]> = {
  asr: [
    { label: "Azure Speech", value: "azure", hint: "Azure Cognitive Services speech key", docsUrl: "https://portal.azure.com", extraConfigHint: '{"region": "eastus"}' },
    { label: "AssemblyAI", value: "assemblyai", hint: "AssemblyAI API key (v2-...)", docsUrl: "https://www.assemblyai.com/app" },
    { label: "Sarvam AI (Saarika)", value: "sarvam", hint: "Sarvam API key", docsUrl: "https://dashboard.sarvam.ai" },
    { label: "Cartesia", value: "cartesia", hint: "Cartesia API key", docsUrl: "https://play.cartesia.ai/keys" },
  ],
  llm: [
    { label: "OpenAI", value: "openai", hint: "OpenAI API key (sk-...)", docsUrl: "https://platform.openai.com/api-keys" },
    { label: "Google Gemini", value: "google", hint: "Google AI Studio API key (AIza...)", docsUrl: "https://aistudio.google.com/app/apikey" },
    { label: "Groq", value: "groq", hint: "Groq API key (gsk_...)", docsUrl: "https://console.groq.com/keys" },
    { label: "Sarvam AI", value: "sarvam", hint: "Sarvam API key", docsUrl: "https://dashboard.sarvam.ai" },
  ],
  tts: [
    { label: "ElevenLabs", value: "elevenlabs", hint: "ElevenLabs API key (sk_...)", docsUrl: "https://elevenlabs.io/app/settings/api-keys" },
    { label: "Cartesia (Sonic)", value: "cartesia", hint: "Cartesia API key", docsUrl: "https://play.cartesia.ai/keys" },
    { label: "Sarvam AI (Bulbul)", value: "sarvam", hint: "Sarvam API key", docsUrl: "https://dashboard.sarvam.ai" },
  ],
  telephony: [
    { label: "Twilio", value: "twilio", hint: "Twilio Auth Token", docsUrl: "https://console.twilio.com", extraConfigHint: '{"accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}' },
    { label: "Plivo", value: "plivo", hint: "Plivo Auth Token", docsUrl: "https://console.plivo.com", extraConfigHint: '{"authId": "MAXXXXXXXXXXXXXXXXXX"}' },
    { label: "Vobiz", value: "vobiz", hint: "Vobiz API key", docsUrl: "https://vobiz.in" },
  ],
};

const providerFormSchema = z.object({
  providerType: z.enum(["asr", "llm", "tts", "telephony"]),
  providerName: z.string().min(1, "Provider is required"),
  apiKey: z.string().min(1, "API key is required"),
  extraConfig: z.string().optional(),
});

type ProviderFormValues = z.infer<typeof providerFormSchema>;

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

export default function ProvidersList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [initialType, setInitialType] = useState<string>("llm");

  const { data: providers, isLoading } = useListProviders({
    query: { queryKey: getListProvidersQueryKey() }
  });

  const createProvider = useCreateProvider();
  const deleteProvider = useDeleteProvider();

  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerFormSchema),
    defaultValues: {
      providerType: "llm",
      providerName: "",
      apiKey: "",
      extraConfig: "",
    },
  });

  const selectedType = form.watch("providerType");
  const selectedProviderValue = form.watch("providerName");
  const availableProviders = SUPPORTED_PROVIDERS[selectedType] ?? [];
  const selectedProviderMeta = availableProviders.find(p => p.value === selectedProviderValue);

  const openDialog = (type?: string) => {
    const t = (type ?? "llm") as ProviderFormValues["providerType"];
    form.reset({ providerType: t, providerName: "", apiKey: "", extraConfig: "" });
    setInitialType(t);
    setIsAddOpen(true);
  };

  const onSubmit = (data: ProviderFormValues) => {
    createProvider.mutate(
      { data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
          setIsAddOpen(false);
          form.reset();
          toast({ title: "Provider added", description: "Your API key has been securely saved." });
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to save provider.", variant: "destructive" });
        }
      }
    );
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure? Any agents using this key will fail to connect.")) {
      deleteProvider.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
            toast({ title: "Provider deleted", description: "The provider key has been removed." });
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
    <div className="flex-1 space-y-8 p-6 md:p-8 pt-6 max-w-6xl mx-auto flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Providers</h2>
          <p className="text-muted-foreground">Manage your API keys for voice AI services. Keys are stored securely and never exposed in full.</p>
        </div>
        <Button onClick={() => openDialog()} data-testid="button-add-provider">
          <Plus className="mr-2 h-4 w-4" /> Add Provider Key
        </Button>
      </div>

      {/* Add Provider Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Add Provider Key</DialogTitle>
            <DialogDescription>
              Select a provider and paste in your API key. Keys are stored on the server and used at call time.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
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
                        form.setValue("extraConfig", "");
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

              <FormField
                control={form.control}
                name="providerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider</FormLabel>
                    <Select onValueChange={(val) => {
                      field.onChange(val);
                      const meta = availableProviders.find(p => p.value === val);
                      if (meta?.extraConfigHint) {
                        form.setValue("extraConfig", meta.extraConfigHint);
                      } else {
                        form.setValue("extraConfig", "");
                      }
                    }} value={field.value}>
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
                    {selectedProviderMeta && (
                      <FormDescription className="flex items-center gap-1">
                        Get your key at{" "}
                        <a
                          href={selectedProviderMeta.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary inline-flex items-center gap-0.5 hover:underline"
                        >
                          {selectedProviderMeta.docsUrl.replace("https://", "")}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="apiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Key</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder={selectedProviderMeta?.hint ?? "Paste your API key..."}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="extraConfig"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Extra Config <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder='{"region": "eastus"}'
                        className="font-mono text-xs resize-none"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>JSON extras required by some providers (e.g. region, account SID).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createProvider.isPending} data-testid="button-save-provider">
                  {createProvider.isPending ? "Saving..." : "Save Key"}
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
                                <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Active</Badge>
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
  );
}
