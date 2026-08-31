import { useRef, useState } from "react";
import { useManagedKeys, useSaveManagedKeys, useAzureSpeakerCheck, useManagedKeysStatus, useTestManagedKey, useRotateManagedKey } from "@/hooks/use-admin-api";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Save,
  RefreshCw,
  Loader2,
  Info,
  Plus,
  ChevronDown,
  Brain,
  Mic,
  Volume2,
  Phone,
  CheckCircle2,
  XCircle,
  FlaskConical,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import { SectionSubNav } from "@/components/section-subnav";
import { PRODUCT_TABS } from "@/lib/nav-config";

type KeyField = {
  key: string;
  label: string;
  description: string;
  placeholder: string;
};

type CategoryId = "llm" | "stt" | "tts" | "telephony" | "integrations";

type Category = {
  id: CategoryId;
  title: string;
  description: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  itemLabel: string;
  fields: KeyField[];
};

const CATEGORIES: Category[] = [
  {
    id: "llm",
    title: "LLM Keys",
    description: "Keys used for Large Language Models and AI prompt generation",
    icon: Brain,
    iconBg: "bg-purple-500/15",
    iconColor: "text-purple-400",
    itemLabel: "New LLM Key",
    fields: [
      {
        key: "managed_qwen_key",
        label: "Qwen / Groq API Key",
        description: "Primary managed LLM key — Qwen models served via Groq. Also used for AI prompt generation.",
        placeholder: "gsk_...",
      },
      {
        key: "managed_groq_key",
        label: "Groq API Key",
        description: "Groq-hosted models: Llama 3.3 70B, Llama 3.1 8B, Mixtral 8x7B, Gemma 2 9B.",
        placeholder: "gsk_...",
      },
      {
        key: "managed_jina_key",
        label: "Jina Embeddings API Key",
        description: "Used for Knowledge Base semantic search (jina-embeddings-v3). Free tier at jina.ai — no OpenAI/Gemini needed.",
        placeholder: "jina_...",
      },
      {
        key: "managed_gemini_key",
        label: "Google / Gemini API Key",
        description: "Only needed for Gemini Live native audio (optional). Chat LLMs use Sarvam.",
        placeholder: "AIza...",
      },
      {
        key: "managed_openai_key",
        label: "OpenAI API Key",
        description: "Optional — GPT models / OpenAI TTS if selected. Not required for KB embeddings.",
        placeholder: "sk-...",
      },
      {
        key: "managed_anthropic_key",
        label: "Anthropic API Key",
        description: "Claude Opus 4, Claude Sonnet 4, Claude 3.5 Haiku.",
        placeholder: "sk-ant-...",
      },
      {
        key: "managed_mistral_key",
        label: "Mistral API Key",
        description: "Mistral Large, Mistral Small, Codestral.",
        placeholder: "...",
      },
      {
        key: "managed_cohere_key",
        label: "Cohere API Key",
        description: "Command R+, Command R.",
        placeholder: "...",
      },
      {
        key: "managed_deepseek_key",
        label: "DeepSeek API Key",
        description: "DeepSeek Chat, DeepSeek Reasoner.",
        placeholder: "sk-...",
      },
      {
        key: "managed_together_key",
        label: "Together AI API Key",
        description: "Qwen3.6 35B-A3B (fast), Qwen3.5 397B-A17B (quality). Get from api.together.xyz.",
        placeholder: "...",
      },
      {
        key: "managed_openrouter_key",
        label: "OpenRouter API Key",
        description: "Qwen3.6 35B-A3B, Qwen3.5 397B-A17B via OpenRouter. Get from openrouter.ai.",
        placeholder: "sk-or-...",
      },
      {
        key: "managed_krutrim_key",
        label: "Krutrim API Key",
        description: "GPT-OSS 20B / 120B (tool-capable) — Bangalore-hosted, lowest latency for India. Get from cloud.olakrutrim.com.",
        placeholder: "...",
      },
    ],
  },
  {
    id: "stt",
    title: "STT Keys",
    description: "Keys used for Speech-to-Text conversion",
    icon: Mic,
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-400",
    itemLabel: "New STT Key",
    fields: [
      {
        key: "managed_deepgram_key",
        label: "Deepgram API Key",
        description: "Nova-3, Nova-2 streaming + batch STT. Also used for Deepgram Aura TTS.",
        placeholder: "Token ...",
      },
      {
        key: "managed_sarvam_key",
        label: "Sarvam API Key",
        description:
          "One key for Sarvam STT (Saaras), TTS (Bulbul), and LLM. Catalog speakers (priya, shubh, …) work here; personal Creative Studio clones need the account that owns them.",
        placeholder: "...",
      },
      {
        key: "managed_assemblyai_key",
        label: "AssemblyAI API Key",
        description: "AssemblyAI Nano and Best batch STT models.",
        placeholder: "...",
      },
      {
        key: "managed_azure_speech_key",
        label: "Azure Speech Key",
        description: "Azure Cognitive Services key for Azure STT, TTS, and Speaker Recognition (voice prints). Must be a multi-service Cognitive Services key — a single-service Speech key will NOT work for voice prints (401 on Speaker Recognition API).",
        placeholder: "...",
      },
      {
        key: "managed_azure_speech_region",
        label: "Azure Speech Region",
        description: "Azure region for Speech-to-Text transcription (e.g. centralindia, eastus). Required with Azure Speech Key.",
        placeholder: "eastus",
      },
      {
        key: "managed_azure_speaker_region",
        label: "Speaker Recognition Region (unused)",
        description: "Legacy field — speaker recognition now runs locally via the ECAPA-TDNN model (SpeechBrain). No cloud key or region required. This field is kept for reference only.",
        placeholder: "local",
      },
    ],
  },
  {
    id: "tts",
    title: "TTS Keys",
    description: "Keys used for Text-to-Speech synthesis",
    icon: Volume2,
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-400",
    itemLabel: "New TTS Key",
    fields: [
      {
        key: "managed_cartesia_key",
        label: "Cartesia API Key",
        description: "Primary managed TTS. Also used for Cartesia STT.",
        placeholder: "sk-...",
      },
      {
        key: "managed_elevenlabs_key",
        label: "ElevenLabs API Key",
        description: "ElevenLabs TTS — high-quality multilingual voices.",
        placeholder: "sk_...",
      },
    ],
  },
  {
    id: "telephony",
    title: "Telephony Keys",
    description: "Keys used for Telephony and Voice services",
    icon: Phone,
    iconBg: "bg-sky-500/15",
    iconColor: "text-sky-400",
    itemLabel: "New Telephony Key",
    fields: [
      {
        key: "managed_vobiz_auth_id",
        label: "VoBiz Auth ID",
        description: "Platform VoBiz account ID used for managed telephony.",
        placeholder: "vobiz-auth-id",
      },
      {
        key: "managed_vobiz_auth_token",
        label: "VoBiz Auth Token",
        description: "Platform VoBiz auth token used for managed telephony.",
        placeholder: "vobiz-auth-token",
      },
    ],
  },
  {
    id: "integrations",
    title: "Integrations",
    description: "Third-party monitoring and analytics integrations",
    icon: Activity,
    iconBg: "bg-rose-500/15",
    iconColor: "text-rose-400",
    itemLabel: "New Integration Key",
    fields: [
      {
        key: "zelto_api_key",
        label: "Zelto API Key",
        description: "Zelto call monitoring — transcript and metadata are pushed to Zelto after each call ends. Rotate here without redeploying.",
        placeholder: "zelto_...",
      },
      {
        key: "recall_api_key",
        label: "Recall API Key",
        description: "Primary Recall.ai key for Meet / Zoom / Teams meeting bots. Same as Railway RECALL_API_KEY.",
        placeholder: "recall_...",
      },
      {
        key: "recall_api_key_fallback",
        label: "Recall API Key (fallback)",
        description: "Used automatically if the primary key is rejected (401/403), out of credit (402), or rate-limited (429). Set Railway RECALL_API_KEY_FALLBACK or paste here.",
        placeholder: "recall_...",
      },
    ],
  },
];

export default function ManagedKeys() {
  const { data: currentKeys, isLoading, refetch } = useManagedKeys();
  const { data: statusData, refetch: refetchStatus } = useManagedKeysStatus();
  const { mutate: saveKeys, isPending } = useSaveManagedKeys();
  const testKey = useTestManagedKey();
  const rotateKey = useRotateManagedKey();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<string[]>(["llm"]);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [runSpeakerCheck, setRunSpeakerCheck] = useState(false);
  const { data: speakerCheckResult, isFetching: speakerCheckFetching } = useAzureSpeakerCheck(runSpeakerCheck);

  const statusByKey = Object.fromEntries((statusData?.credentials ?? []).map((c) => [c.key, c]));
  const kpis = statusData?.kpis;

  function handleTestSpeakerRecognition() {
    queryClient.removeQueries({ queryKey: ["admin", "azure-speaker-check"] });
    setRunSpeakerCheck(true);
  }

  function handleChange(key: string, value: string) {
    setFormValues(prev => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveKeys(formValues, {
      onSuccess: (data) => {
        toast({ title: `Saved ${(data as any).saved} key(s) successfully` });
        setFormValues({});
        refetch();
        refetchStatus();
      },
      onError: (err) =>
        toast({ title: "Save failed", description: formatApiError(err), variant: "destructive" }),
    });
  }

  function handleTest(key: string) {
    setTestingKey(key);
    testKey.mutate(key, {
      onSuccess: (res) => {
        toast({
          title: res.status === "healthy" || res.status === "skipped" ? "Health check OK" : "Health check failed",
          description: res.errorMessageSafe ?? `Status: ${res.status}${res.latencyMs != null ? ` · ${res.latencyMs} ms` : ""}`,
          variant: res.status === "failed" ? "destructive" : "default",
        });
        setTestingKey(null);
      },
      onError: (err) => {
        toast({ title: "Test failed", description: formatApiError(err), variant: "destructive" });
        setTestingKey(null);
      },
    });
  }

  function handleRotate(key: string) {
    const value = formValues[key]?.trim();
    if (!value) {
      toast({ title: "Enter a new key value first", variant: "destructive" });
      return;
    }
    rotateKey.mutate(
      { key, value },
      {
        onSuccess: (res) => {
          toast({ title: "Key rotated", description: res.message });
          setFormValues((prev) => ({ ...prev, [key]: "" }));
          refetch();
        },
        onError: (err) => toast({ title: "Rotate failed", description: formatApiError(err), variant: "destructive" }),
      },
    );
  }

  function openCategory(categoryId: CategoryId) {
    setOpenSections(prev => (prev.includes(categoryId) ? prev : [...prev, categoryId]));
    setTimeout(() => {
      const section = sectionRefs.current[categoryId];
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
      const category = CATEGORIES.find(c => c.id === categoryId);
      if (category) {
        const empty = category.fields.find(
          f => !(formValues[f.key] && formValues[f.key].trim()),
        );
        const target = empty ?? category.fields[0];
        if (target) {
          setTimeout(() => inputRefs.current[target.key]?.focus(), 250);
        }
      }
    }, 50);
  }

  const hasChanges = Object.values(formValues).some(v => v?.trim());

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={PRODUCT_TABS} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Managed Keys</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            First-class platform credentials for ASR / LLM / TTS / telephony.
            Secrets are masked after save. Use Test / Rotate for safe updates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refetch(); refetchStatus(); }}
            className="gap-2"
            data-testid="button-refresh-keys"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-2" data-testid="button-new-key">
                <Plus className="h-4 w-4" />
                New Key
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {CATEGORIES.map((c) => (
                <DropdownMenuItem key={c.id} onClick={() => openCategory(c.id)}>
                  {c.itemLabel}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" disabled={!hasChanges || isPending} onClick={handleSave} className="gap-2">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        {[
          { label: "Total", value: kpis?.total },
          { label: "Configured", value: kpis?.configured },
          { label: "Healthy", value: kpis?.healthy },
          { label: "Warning", value: kpis?.warning },
          { label: "Failed", value: kpis?.failed },
          { label: "Missing", value: kpis?.missing },
        ].map((c) => (
          <Card key={c.label} className="shadow-none">
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-xl font-bold font-mono tabular-nums">{c.value ?? "—"}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 flex gap-2 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          Changing a managed key affects user calls, agent STT/TTS/LLM fallbacks, and managed routing.
          Rotate validates testable keys before activation. Never paste secrets into chat logs.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm rounded-xl border bg-card p-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading current keys...
        </div>
      ) : (
        <Accordion
          type="multiple"
          value={openSections}
          onValueChange={setOpenSections}
          className="space-y-3"
        >
          {CATEGORIES.map(category => {
            const Icon = category.icon;
            return (
              <AccordionItem
                key={category.id}
                value={category.id}
                ref={(el) => { sectionRefs.current[category.id] = el; }}
                className="rounded-xl border bg-card shadow-sm overflow-hidden border-b"
                data-testid={`accordion-${category.id}`}
              >
                <AccordionTrigger className="px-5 py-4 hover:no-underline">
                  <div className="flex items-center gap-4 flex-1">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
                        category.iconBg,
                      )}
                    >
                      <Icon className={cn("h-5 w-5", category.iconColor)} />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-semibold">{category.title}</h2>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {category.fields.length} {category.fields.length === 1 ? "Key" : "Keys"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {category.description}
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-5 pb-5 pt-0">
                  {category.id === "stt" && (
                    <div className="mb-3 rounded-lg border bg-muted/10 p-4 flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">Azure Speaker Recognition</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Voice prints use the Speaker Recognition API — requires a multi-service Cognitive Services key, not a single-service Speech key.
                        </p>
                      </div>
                      {speakerCheckResult && !speakerCheckFetching && (
                        <div className={cn(
                          "flex items-center gap-1.5 text-xs rounded-md px-2.5 py-1.5 border",
                          speakerCheckResult.ok
                            ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                            : "bg-red-500/10 text-red-600 border-red-500/30"
                        )}>
                          {speakerCheckResult.ok
                            ? <><CheckCircle2 className="h-3.5 w-3.5" /> OK ({speakerCheckResult.region})</>
                            : <><XCircle className="h-3.5 w-3.5" /> {(speakerCheckResult as any).status ? `HTTP ${(speakerCheckResult as any).status}` : "Error"}</>
                          }
                        </div>
                      )}
                      {speakerCheckResult && !speakerCheckResult.ok && !speakerCheckFetching && (
                        <p className="w-full text-xs text-red-600/80 font-mono break-all">{(speakerCheckResult as any).error}</p>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 shrink-0"
                        onClick={handleTestSpeakerRecognition}
                        disabled={speakerCheckFetching}
                      >
                        {speakerCheckFetching
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <FlaskConical className="h-3.5 w-3.5" />
                        }
                        Test Speaker Recognition
                      </Button>
                    </div>
                  )}
                  <div className="rounded-lg border bg-muted/10 divide-y divide-border">
                    <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <div className="col-span-3">Provider</div>
                      <div className="col-span-2">Status</div>
                      <div className="col-span-3">Current (Masked)</div>
                      <div className="col-span-4">New value / actions</div>
                    </div>
                    {category.fields.map(field => {
                      const masked = currentKeys?.[field.key];
                      const st = statusByKey[field.key];
                      const status = st?.status ?? (masked ? "active" : "missing");
                      return (
                        <div
                          key={field.key}
                          className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 px-4 py-3.5 items-start md:items-center"
                          data-testid={`row-key-${field.key}`}
                        >
                          <div className="md:col-span-3">
                            <div className="text-sm font-medium text-foreground">{field.label}</div>
                            <p className="text-xs text-muted-foreground mt-0.5">{field.description}</p>
                            {st?.affects?.length ? (
                              <p className="text-[10px] text-muted-foreground mt-1">Affects: {st.affects.join(" · ")}</p>
                            ) : null}
                          </div>
                          <div className="md:col-span-2">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] capitalize",
                                status === "healthy" && "border-emerald-500/40 text-emerald-500",
                                status === "failed" && "border-red-500/40 text-red-500",
                                status === "warning" && "border-amber-500/40 text-amber-500",
                                status === "missing" && "text-muted-foreground",
                              )}
                            >
                              {status}
                            </Badge>
                            {st?.lastLatencyMs != null && (
                              <p className="text-[10px] text-muted-foreground mt-1">{st.lastLatencyMs} ms</p>
                            )}
                          </div>
                          <div className="md:col-span-3">
                            {masked ? (
                              <div className="font-mono text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-2.5 py-1.5 truncate" data-testid={`text-masked-${field.key}`}>
                                {masked}
                              </div>
                            ) : (
                              <div className="font-mono text-xs text-muted-foreground/50 italic px-2.5 py-1.5">
                                not set
                              </div>
                            )}
                          </div>
                          <div className="md:col-span-4 space-y-2">
                            <Input
                              ref={(el) => { inputRefs.current[field.key] = el; }}
                              type="password"
                              placeholder={masked ? "Enter new value to replace" : field.placeholder}
                              value={formValues[field.key] ?? ""}
                              onChange={e => handleChange(field.key, e.target.value)}
                              className="font-mono text-xs bg-background/60 border-border"
                              data-testid={`input-key-${field.key}`}
                            />
                            <div className="flex flex-wrap gap-1.5">
                              {st?.testable !== false && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs gap-1"
                                  disabled={testingKey === field.key || !masked}
                                  onClick={() => handleTest(field.key)}
                                >
                                  {testingKey === field.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
                                  Test
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                disabled={!formValues[field.key]?.trim() || rotateKey.isPending}
                                onClick={() => handleRotate(field.key)}
                              >
                                <Activity className="h-3 w-3" />
                                Rotate
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={isPending || !hasChanges}
          className="gap-2"
          data-testid="button-save-keys"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Keys
        </Button>
      </div>
    </div>
  );
}
