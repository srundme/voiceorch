import React, { useEffect } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Save, Bot } from "lucide-react";
import {
  useGetAgent,
  useUpdateAgent,
  getGetAgentQueryKey,
  getListAgentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

/* ── Provider → model/voice catalogue (kept in sync with new.tsx) ─────────── */

const ASR_PROVIDERS = [
  { value: "azure",      label: "Azure Speech" },
  { value: "assemblyai", label: "AssemblyAI" },
  { value: "sarvam",     label: "Sarvam (Saarika)" },
  { value: "cartesia",   label: "Cartesia" },
];

const LLM_PROVIDERS = [
  { value: "openai",  label: "OpenAI" },
  { value: "google",  label: "Google Gemini" },
  { value: "groq",    label: "Groq" },
  { value: "sarvam",  label: "Sarvam" },
];

const TTS_PROVIDERS = [
  { value: "elevenlabs", label: "ElevenLabs" },
  { value: "cartesia",   label: "Cartesia (Sonic)" },
  { value: "sarvam",     label: "Sarvam (Bulbul)" },
];

const TELEPHONY_PROVIDERS = [
  { value: "twilio", label: "Twilio" },
  { value: "plivo",  label: "Plivo" },
  { value: "vobiz",  label: "Vobiz" },
];

const ASR_MODELS: Record<string, { value: string; label: string }[]> = {
  azure:      [{ value: "en-US-standard", label: "en-US-standard" }, { value: "en-US-enhanced", label: "en-US-enhanced" }, { value: "en-IN-standard", label: "en-IN-standard" }],
  assemblyai: [{ value: "best", label: "Best (default)" }, { value: "nano", label: "Nano (fast)" }],
  sarvam:     [
    { value: "saarika:v2.5", label: "Saarika v2.5 (latest)" },
    { value: "saarika:v2",   label: "Saarika v2" },
    { value: "saarika:v1",   label: "Saarika v1" },
    { value: "saarika:flash",label: "Saarika Flash (fast)" },
    { value: "saaras:v3",    label: "Saaras v3" },
    { value: "saaras:v3-realtime", label: "Saaras v3 Realtime" },
  ],
  cartesia:   [{ value: "sonic-english", label: "Sonic English" }, { value: "sonic-multilingual", label: "Sonic Multilingual" }],
};

const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openai:  [{ value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "gpt-4o", label: "GPT-4o" }, { value: "gpt-4-turbo", label: "GPT-4 Turbo" }, { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" }],
  google:  [{ value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }, { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" }, { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" }],
  groq:    [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (recommended)" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" }, { value: "gemma2-9b-it", label: "Gemma 2 9B" }],
  sarvam:  [{ value: "sarvam-2b-v0.5", label: "Sarvam 2B v0.5" }],
};

const TTS_MODELS: Record<string, { value: string; label: string }[]> = {
  cartesia: [
    { value: "sonic-2",     label: "Sonic 2 (standard)" },
    { value: "sonic-turbo", label: "Sonic Turbo (fast)" },
  ],
};

const TTS_VOICES: Record<string, { value: string; label: string }[] | null> = {
  elevenlabs: null,
  cartesia:   null,
  sarvam: [
    { value: "meera",    label: "Meera (female)" },
    { value: "pavithra", label: "Pavithra (female)" },
    { value: "maitreyi", label: "Maitreyi (female)" },
    { value: "arvind",   label: "Arvind (male)" },
    { value: "amol",     label: "Amol (male)" },
    { value: "amartya",  label: "Amartya (male)" },
    { value: "neel",     label: "Neel (male)" },
    { value: "misha",    label: "Misha (female)" },
    { value: "arjun",    label: "Arjun (male)" },
    { value: "maya",     label: "Maya (female)" },
  ],
};

/* ── Form schema ──────────────────────────────────────────────────────────── */

const agentFormSchema = z.object({
  name:              z.string().min(1, "Name is required"),
  description:       z.string().optional(),
  asrProvider:       z.string().min(1, "ASR Provider is required"),
  asrModel:          z.string().optional(),
  llmProvider:       z.string().min(1, "LLM Provider is required"),
  llmModel:          z.string().optional(),
  ttsProvider:       z.string().min(1, "TTS Provider is required"),
  ttsVoice:          z.string().optional(),
  ttsModel:          z.string().optional(),
  telephonyProvider: z.string().min(1, "Telephony Provider is required"),
  systemPrompt:      z.string().min(1, "System prompt is required"),
  temperature:       z.number().min(0).max(2).optional(),
  maxDuration:       z.number().min(10).max(3600).optional(),
});

type AgentFormValues = z.infer<typeof agentFormSchema>;

/* ── Smart model select ───────────────────────────────────────────────────── */

function ModelSelect({
  options, value, onChange, placeholder,
}: {
  options: { value: string; label: string }[];
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder ?? "Select model"} />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function AgentEdit() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: agent, isLoading } = useGetAgent(id, {
    query: { enabled: !!id, queryKey: getGetAgentQueryKey(id) }
  });

  const updateAgent = useUpdateAgent();

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: "", description: "", asrProvider: "azure", asrModel: "",
      llmProvider: "openai", llmModel: "", ttsProvider: "elevenlabs",
      ttsVoice: "", ttsModel: "", telephonyProvider: "twilio",
      systemPrompt: "", temperature: 0.7, maxDuration: 600,
    },
  });

  // Pre-fill form once agent data loads
  useEffect(() => {
    if (!agent) return;
    form.reset({
      name:              agent.name,
      description:       agent.description ?? "",
      asrProvider:       agent.asrProvider,
      asrModel:          agent.asrModel ?? "",
      llmProvider:       agent.llmProvider,
      llmModel:          agent.llmModel ?? "",
      ttsProvider:       agent.ttsProvider,
      ttsVoice:          agent.ttsVoice ?? "",
      ttsModel:          agent.ttsModel ?? "",
      telephonyProvider: agent.telephonyProvider,
      systemPrompt:      agent.systemPrompt,
      temperature:       agent.temperature ?? 0.7,
      maxDuration:       agent.maxDuration ?? 600,
    });
  }, [agent]);

  const asrProvider = useWatch({ control: form.control, name: "asrProvider" });
  const llmProvider = useWatch({ control: form.control, name: "llmProvider" });
  const ttsProvider = useWatch({ control: form.control, name: "ttsProvider" });

  const onSubmit = (data: AgentFormValues) => {
    updateAgent.mutate(
      { id, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(id) });
          toast({ title: "Agent updated", description: "Changes saved successfully." });
          setLocation(`/agents/${id}`);
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to save changes.", variant: "destructive" });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-[200px]" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  if (!agent) {
    return <div className="p-8 text-center text-muted-foreground">Agent not found.</div>;
  }

  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 max-w-5xl mx-auto h-full flex flex-col">
      <div className="flex items-center gap-4">
        <Link href={`/agents/${id}`}>
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Edit Agent
          </h2>
          <p className="text-muted-foreground">Update the configuration for <strong>{agent.name}</strong>.</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* ── General ── */}
            <Card>
              <CardHeader>
                <CardTitle>General Information</CardTitle>
                <CardDescription>Basic details about your agent.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agent Name</FormLabel>
                    <FormControl><Input placeholder="e.g. Sales Assistant" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl><Input placeholder="e.g. Handles inbound sales inquiries" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            {/* ── AI Behavior ── */}
            <Card>
              <CardHeader>
                <CardTitle>AI Behavior</CardTitle>
                <CardDescription>Configure how the agent responds.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="systemPrompt" render={({ field }) => (
                  <FormItem>
                    <FormLabel>System Prompt</FormLabel>
                    <FormControl>
                      <Textarea placeholder="You are a helpful assistant..." className="min-h-[150px] font-mono text-sm" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="temperature" render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-center mb-2">
                      <FormLabel>Temperature: {field.value}</FormLabel>
                    </div>
                    <FormControl>
                      <Slider min={0} max={2} step={0.1} value={[field.value ?? 0.7]}
                        onValueChange={(vals) => field.onChange(vals[0])} />
                    </FormControl>
                    <FormDescription>Higher = more creative. Lower = more deterministic.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            {/* ── Pipeline ── */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Pipeline Configuration</CardTitle>
                <CardDescription>Select providers and models for each stage.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

                  {/* Step 1 — ASR */}
                  <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                    <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 1</div>
                    <h4 className="font-medium border-b pb-2">Speech-to-Text</h4>
                    <FormField control={form.control} name="asrProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select ASR" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {ASR_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="asrModel" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Model</FormLabel>
                        <FormControl>
                          {ASR_MODELS[asrProvider] ? (
                            <ModelSelect options={ASR_MODELS[asrProvider]!} value={field.value} onChange={field.onChange} placeholder="Select model" />
                          ) : (
                            <Input placeholder="Enter model name" {...field} />
                          )}
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {/* Step 2 — LLM */}
                  <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                    <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 2</div>
                    <h4 className="font-medium border-b pb-2">Language Model</h4>
                    <FormField control={form.control} name="llmProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select LLM" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {LLM_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="llmModel" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Model</FormLabel>
                        <FormControl>
                          {LLM_MODELS[llmProvider] ? (
                            <ModelSelect options={LLM_MODELS[llmProvider]!} value={field.value} onChange={field.onChange} placeholder="Select model" />
                          ) : (
                            <Input placeholder="Enter model name" {...field} />
                          )}
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {/* Step 3 — TTS */}
                  <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                    <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 3</div>
                    <h4 className="font-medium border-b pb-2">Text-to-Speech</h4>
                    <FormField control={form.control} name="ttsProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select TTS" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {TTS_MODELS[ttsProvider] && (
                      <FormField control={form.control} name="ttsModel" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Model</FormLabel>
                          <FormControl>
                            <ModelSelect options={TTS_MODELS[ttsProvider]!} value={field.value} onChange={field.onChange} placeholder="Select model" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                    <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">
                          {TTS_VOICES[ttsProvider] ? "Voice" : "Voice ID"}
                        </FormLabel>
                        <FormControl>
                          {TTS_VOICES[ttsProvider] ? (
                            <ModelSelect options={TTS_VOICES[ttsProvider]!} value={field.value} onChange={field.onChange} placeholder="Select voice" />
                          ) : (
                            <Input
                              placeholder={ttsProvider === "elevenlabs" ? "e.g. 21m00Tcm4TlvDq8ikWAM" : "e.g. 694f9389-aac1-45b6-b726-9d9369183238"}
                              {...field}
                            />
                          )}
                        </FormControl>
                        <FormDescription className="text-[10px]">
                          {ttsProvider === "elevenlabs" && "Voice ID from your ElevenLabs account"}
                          {ttsProvider === "cartesia"   && "Voice ID from your Cartesia account"}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {/* Step 4 — Telephony */}
                  <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                    <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 4</div>
                    <h4 className="font-medium border-b pb-2">Telephony</h4>
                    <FormField control={form.control} name="telephonyProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select Telephony" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {TELEPHONY_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="maxDuration" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Max Duration (seconds)</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="e.g. 600" {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Footer ── */}
          <div className="fixed bottom-0 left-0 md:left-64 right-0 p-4 bg-background/80 backdrop-blur-sm border-t border-border flex justify-end z-10">
            <div className="max-w-5xl mx-auto w-full flex justify-end gap-4">
              <Link href={`/agents/${id}`}><Button type="button" variant="outline">Cancel</Button></Link>
              <Button type="submit" disabled={updateAgent.isPending}>
                <Save className="mr-2 h-4 w-4" />
                {updateAgent.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
