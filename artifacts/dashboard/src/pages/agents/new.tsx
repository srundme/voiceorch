import React, { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Save, Bot, Plus, Trash2, PhoneForwarded } from "lucide-react";
import { useCreateAgent, getListAgentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm, useWatch, useFieldArray } from "react-hook-form";
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
import { useToast } from "@/hooks/use-toast";

/* ── Provider → model/voice catalogue ────────────────────────────────────── */

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

const LANGUAGES = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-IN", label: "English (India)" },
  { value: "es",    label: "Spanish" },
  { value: "es-MX", label: "Spanish (Mexico)" },
  { value: "fr",    label: "French" },
  { value: "de",    label: "German" },
  { value: "it",    label: "Italian" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "hi",    label: "Hindi" },
  { value: "ja",    label: "Japanese" },
  { value: "ko",    label: "Korean" },
  { value: "zh",    label: "Chinese (Mandarin)" },
  { value: "ar",    label: "Arabic" },
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
    { value: "sonic-3",    label: "Sonic 3 (latest)" },
    { value: "sonic-2",    label: "Sonic 2 (stable)" },
    { value: "sonic-turbo",label: "Sonic Turbo (fast, low-latency)" },
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

const DEFAULT_ASR_MODEL = (p: string) => ASR_MODELS[p]?.[0]?.value ?? "";
const DEFAULT_LLM_MODEL = (p: string) => LLM_MODELS[p]?.[0]?.value ?? "";
const DEFAULT_TTS_VOICE = (p: string) => TTS_VOICES[p]?.[0]?.value ?? "";

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
  // Conversation Behavior
  greetingMessage:          z.string().optional(),
  endCallPhrases:           z.string().optional(),
  silenceTimeoutSeconds:    z.number().min(5).max(300).optional(),
  language:                 z.string().optional(),
  backchannelingEnabled:    z.boolean().optional(),
  backchannelingFrequency:  z.number().min(0).max(1).optional(),
  webhookUrl:               z.string().optional(),
  noiseCancellationEnabled: z.boolean().optional(),
  tools: z.array(z.object({
    type: z.literal("call_transfer"),
    name: z.string().min(1, "Function name required"),
    description: z.string().min(1, "Description required"),
    transferTo: z.string().min(1, "Phone number required"),
    warmHandoffMessage: z.string().optional(),
  })).optional(),
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

export default function AgentNew() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createAgent = useCreateAgent();

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name:              "",
      description:       "",
      asrProvider:       "azure",
      asrModel:          "en-US-standard",
      llmProvider:       "openai",
      llmModel:          "gpt-4o-mini",
      ttsProvider:       "elevenlabs",
      ttsVoice:          "",
      ttsModel:          "",
      telephonyProvider: "twilio",
      systemPrompt:      "You are a helpful AI voice assistant.",
      temperature:       0.7,
      maxDuration:       600,
      greetingMessage:          "",
      endCallPhrases:           "",
      silenceTimeoutSeconds:    30,
      language:                 "en-US",
      backchannelingEnabled:    false,
      backchannelingFrequency:  0.5,
      webhookUrl:               "",
      noiseCancellationEnabled: false,
      tools: [],
    },
  });

  const { fields: toolFields, append: appendTool, remove: removeTool } = useFieldArray({
    control: form.control,
    name: "tools",
  });

  const asrProvider = useWatch({ control: form.control, name: "asrProvider" });
  const llmProvider = useWatch({ control: form.control, name: "llmProvider" });
  const ttsProvider = useWatch({ control: form.control, name: "ttsProvider" });
  const backchannelingEnabled = useWatch({ control: form.control, name: "backchannelingEnabled" });
  const backchannelingFrequency = useWatch({ control: form.control, name: "backchannelingFrequency" });

  useEffect(() => { form.setValue("asrModel", DEFAULT_ASR_MODEL(asrProvider)); }, [asrProvider]);
  useEffect(() => { form.setValue("llmModel", DEFAULT_LLM_MODEL(llmProvider)); }, [llmProvider]);
  useEffect(() => { form.setValue("ttsVoice", DEFAULT_TTS_VOICE(ttsProvider)); }, [ttsProvider]);
  useEffect(() => { form.setValue("ttsModel", TTS_MODELS[ttsProvider]?.[0]?.value ?? ""); }, [ttsProvider]);

  const onSubmit = (data: AgentFormValues) => {
    createAgent.mutate({ data }, {
      onSuccess: (agent) => {
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        toast({ title: "Agent Created", description: "Your new voice agent has been created." });
        setLocation(`/agents/${agent.id}`);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to create agent. Please try again.", variant: "destructive" });
      },
    });
  };

  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 max-w-5xl mx-auto h-full flex flex-col">
      <div className="flex items-center gap-4">
        <Link href="/agents">
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Create Agent
          </h2>
          <p className="text-muted-foreground">Configure a new AI voice agent pipeline.</p>
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
                      <Textarea placeholder="You are a helpful assistant..." className="min-h-[120px] font-mono text-sm" {...field} />
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
                      <Slider min={0} max={2} step={0.1} defaultValue={[field.value || 0.7]}
                        onValueChange={(vals) => field.onChange(vals[0])} />
                    </FormControl>
                    <FormDescription>Higher = more creative. Lower = more deterministic.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            {/* ── Conversation Behavior ── */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Conversation Behavior</CardTitle>
                <CardDescription>Control how the agent opens, responds, and ends calls — just like Vapi and Retell do.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                  {/* Greeting + End-call phrases */}
                  <div className="space-y-4">
                    <FormField control={form.control} name="greetingMessage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Greeting Message</FormLabel>
                        <FormControl>
                          <Textarea placeholder="e.g. Hello! Thanks for calling. How can I help you today?" className="min-h-[80px]" {...field} />
                        </FormControl>
                        <FormDescription>First thing the agent says when a call connects. Leave blank to let the LLM generate one from the system prompt.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="endCallPhrases" render={({ field }) => (
                      <FormItem>
                        <FormLabel>End-Call Phrases</FormLabel>
                        <FormControl>
                          <Input placeholder="goodbye, bye, have a great day, thank you for calling" {...field} />
                        </FormControl>
                        <FormDescription>Comma-separated. If the caller says any of these, the call ends automatically.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {/* Language + Silence timeout + Backchanneling */}
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="language" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Language</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value ?? ""}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select language" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormDescription>Passed to ASR + TTS.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={form.control} name="silenceTimeoutSeconds" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Silence Timeout (s)</FormLabel>
                          <FormControl>
                            <Input type="number" min={5} max={300} placeholder="30" {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value, 10))} />
                          </FormControl>
                          <FormDescription>Hang up after N seconds of caller silence.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    <div className="space-y-3 p-4 border rounded-md bg-muted/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium leading-none">Noise Cancellation</p>
                          <p className="text-xs text-muted-foreground mt-1">Request noise reduction from the ASR provider</p>
                        </div>
                        <FormField control={form.control} name="noiseCancellationEnabled" render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={(v) => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                              <FormControl><SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="false">Off</SelectItem>
                                <SelectItem value="true">On</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )} />
                      </div>
                    </div>

                    <div className="space-y-3 p-4 border rounded-md bg-muted/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium leading-none">Backchanneling</p>
                          <p className="text-xs text-muted-foreground mt-1">Agent says "I see", "Got it" etc. while thinking</p>
                        </div>
                        <FormField control={form.control} name="backchannelingEnabled" render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={(v) => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                              <FormControl><SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="false">Off</SelectItem>
                                <SelectItem value="true">On</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )} />
                      </div>
                      {backchannelingEnabled && (
                        <FormField control={form.control} name="backchannelingFrequency" render={({ field }) => (
                          <FormItem>
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>Frequency</span>
                              <span>{Math.round((backchannelingFrequency ?? 0.5) * 100)}% of turns</span>
                            </div>
                            <FormControl>
                              <Slider min={0} max={1} step={0.05} value={[field.value ?? 0.5]}
                                onValueChange={(vals) => field.onChange(vals[0])} />
                            </FormControl>
                          </FormItem>
                        )} />
                      )}
                    </div>

                    <FormField control={form.control} name="webhookUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Post-Call Webhook URL</FormLabel>
                        <FormControl>
                          <Input placeholder="https://your-server.com/webhook/calls" {...field} />
                        </FormControl>
                        <FormDescription>Receives a JSON summary when each call ends.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Pipeline ── */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Pipeline Configuration</CardTitle>
                <CardDescription>Select providers and models for each stage. Model options update automatically when you change a provider.</CardDescription>
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
                        <FormLabel className="text-xs">{TTS_VOICES[ttsProvider] ? "Voice" : "Voice ID"}</FormLabel>
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
                          {ttsProvider === "cartesia" && "Voice ID from your Cartesia account"}
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

          {/* ── Tools ── */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><PhoneForwarded className="h-4 w-4" /> Tools</CardTitle>
                  <CardDescription>Actions the LLM can trigger mid-call. The agent decides when to use them based on the conversation.</CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => appendTool({ type: "call_transfer", name: "transfer_to_human", description: "Transfer the call to a human agent when the caller requests it or the issue cannot be resolved automatically.", transferTo: "", warmHandoffMessage: "" })}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Tool
                </Button>
              </div>
            </CardHeader>
            {toolFields.length > 0 && (
              <CardContent className="space-y-4">
                {toolFields.map((field, index) => (
                  <div key={field.id} className="border rounded-md p-4 bg-muted/20 space-y-3 relative">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Call Transfer</span>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeTool(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <FormField control={form.control} name={`tools.${index}.name`} render={({ field: f }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Function Name</FormLabel>
                          <FormControl><Input placeholder="e.g. transfer_to_human" {...f} /></FormControl>
                          <FormDescription className="text-[10px]">snake_case, no spaces — used by the LLM to call this tool</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`tools.${index}.transferTo`} render={({ field: f }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Transfer To (phone number)</FormLabel>
                          <FormControl><Input placeholder="+12125551234" {...f} /></FormControl>
                          <FormDescription className="text-[10px]">E.164 format — the human agent's number</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name={`tools.${index}.description`} render={({ field: f }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Description (shown to LLM)</FormLabel>
                        <FormControl><Textarea className="min-h-[60px] text-sm" placeholder="Transfer the call to a human agent when the caller is frustrated or the issue cannot be resolved automatically." {...f} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name={`tools.${index}.warmHandoffMessage`} render={({ field: f }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Warm Handoff Message (optional)</FormLabel>
                        <FormControl><Input placeholder="e.g. I'm connecting you with a specialist now. Please hold for a moment." {...f} /></FormControl>
                        <FormDescription className="text-[10px]">Spoken to the caller before the transfer happens</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                ))}
              </CardContent>
            )}
          </Card>

          <div className="fixed bottom-0 left-0 md:left-64 right-0 p-4 bg-background/80 backdrop-blur-sm border-t border-border flex justify-end z-10">
            <div className="max-w-5xl mx-auto w-full flex justify-end gap-4">
              <Link href="/agents"><Button type="button" variant="outline">Cancel</Button></Link>
              <Button type="submit" disabled={createAgent.isPending} data-testid="button-save-agent">
                <Save className="mr-2 h-4 w-4" />
                {createAgent.isPending ? "Creating…" : "Create Agent"}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
