import { useRef, useState } from "react";
import { useManagedKeys, useSaveManagedKeys } from "@/hooks/use-admin-api";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  type LucideIcon,
} from "lucide-react";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";

type KeyField = {
  key: string;
  label: string;
  description: string;
  placeholder: string;
};

type CategoryId = "llm" | "stt" | "tts" | "telephony";

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
        key: "managed_gemini_key",
        label: "Google / Gemini API Key",
        description: "Gemini 2.5 Flash, Gemini 2.0 Flash, Gemini 1.5 Pro. Get from Google AI Studio (AIza... format).",
        placeholder: "AIza...",
      },
      {
        key: "managed_openai_key",
        label: "OpenAI API Key",
        description: "GPT-4o, GPT-4o Mini, GPT-4 Turbo. Also used for OpenAI TTS.",
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
        description: "Saaras:v3 streaming STT and Saarika batch STT for Indian languages. Also used for Sarvam LLM and TTS.",
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
        description: "Azure Cognitive Services key for Azure STT and Azure TTS.",
        placeholder: "...",
      },
      {
        key: "managed_azure_speech_region",
        label: "Azure Speech Region",
        description: "Azure region for Speech Services (e.g. eastus, westeurope). Required with Azure Speech Key.",
        placeholder: "eastus",
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
];

export default function ManagedKeys() {
  const { data: currentKeys, isLoading, refetch } = useManagedKeys();
  const { mutate: saveKeys, isPending } = useSaveManagedKeys();
  const { toast } = useToast();
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<string[]>(["llm"]);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function handleChange(key: string, value: string) {
    setFormValues(prev => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveKeys(formValues, {
      onSuccess: (data) => {
        toast({ title: `Saved ${(data as any).saved} key(s) successfully` });
        setFormValues({});
        refetch();
      },
      onError: (err) =>
        toast({ title: "Save failed", description: formatApiError(err), variant: "destructive" }),
    });
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Managed Stack Keys</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Master API keys used when customers choose the Managed AI stack.
            <br />
            Keys are stored encrypted and never exposed to users.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2" data-testid="button-refresh-keys">
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
            <DropdownMenuContent align="end" className="w-52">
              {CATEGORIES.map(cat => {
                const Icon = cat.icon;
                return (
                  <DropdownMenuItem
                    key={cat.id}
                    onSelect={() => openCategory(cat.id)}
                    data-testid={`menuitem-new-${cat.id}`}
                  >
                    <Icon className={cn("h-4 w-4", cat.iconColor)} />
                    {cat.itemLabel}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="rounded-md border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground">
          <strong className="text-foreground">Managed Stack Keys:</strong> Store master API keys for every provider the platform supports — LLM, STT, TTS, and Telephony. Keys shared across categories (e.g. Sarvam covers STT + LLM + TTS; OpenAI covers LLM + TTS) only need to be entered once. To update a key, type the new value and click Save. Masked values (showing ••••) are already stored.
        </div>
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
                  <div className="rounded-lg border bg-muted/10 divide-y divide-border">
                    <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <div className="col-span-3">Provider</div>
                      <div className="col-span-3">Current (Masked)</div>
                      <div className="col-span-6">New Value</div>
                    </div>
                    {category.fields.map(field => {
                      const masked = currentKeys?.[field.key];
                      return (
                        <div
                          key={field.key}
                          className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 px-4 py-3.5 items-start md:items-center"
                          data-testid={`row-key-${field.key}`}
                        >
                          <div className="md:col-span-3">
                            <div className="text-sm font-medium text-foreground">{field.label}</div>
                            <p className="text-xs text-muted-foreground mt-0.5">{field.description}</p>
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
                          <div className="md:col-span-6">
                            <Input
                              ref={(el) => { inputRefs.current[field.key] = el; }}
                              type="password"
                              placeholder={masked ? "Enter new value to replace" : field.placeholder}
                              value={formValues[field.key] ?? ""}
                              onChange={e => handleChange(field.key, e.target.value)}
                              className="font-mono text-xs bg-background/60 border-border"
                              data-testid={`input-key-${field.key}`}
                            />
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
