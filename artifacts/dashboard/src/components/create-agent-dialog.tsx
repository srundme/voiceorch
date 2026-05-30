import React, { useState } from "react";
import { Bot, ChevronRight, Loader2, Sparkles, Check } from "lucide-react";
import { useCreateAgent, getListAgentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";

/* ── Catalogues ─────────────────────────────────────────────────────────── */

const LANGUAGES = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-IN", label: "English (India)" },
  { value: "hi-IN", label: "Hindi" },
  { value: "es",    label: "Spanish" },
  { value: "fr",    label: "French" },
  { value: "de",    label: "German" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "ja",    label: "Japanese" },
  { value: "zh",    label: "Chinese (Mandarin)" },
  { value: "ar",    label: "Arabic" },
  { value: "ko",    label: "Korean" },
];

const ASR_PROVIDERS = [
  { value: "deepgram",   label: "Deepgram" },
  { value: "azure",      label: "Azure Speech" },
  { value: "assemblyai", label: "AssemblyAI" },
  { value: "sarvam",     label: "Sarvam" },
  { value: "cartesia",   label: "Cartesia" },
];

const LLM_PROVIDERS = [
  { value: "google",    label: "Google Gemini" },
  { value: "openai",    label: "OpenAI" },
  { value: "anthropic", label: "Anthropic Claude" },
  { value: "groq",      label: "Groq" },
  { value: "deepseek",  label: "DeepSeek" },
  { value: "mistral",   label: "Mistral" },
  { value: "sarvam",    label: "Sarvam" },
];

const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openai:    [{ value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "gpt-4o", label: "GPT-4o" }],
  anthropic: [{ value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" }, { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }],
  google:    [{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }],
  groq:      [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B" }],
  deepseek:  [{ value: "deepseek-chat", label: "DeepSeek Chat" }],
  mistral:   [{ value: "mistral-large-latest", label: "Mistral Large" }, { value: "mistral-small-latest", label: "Mistral Small" }],
  sarvam:    [{ value: "sarvam-m", label: "Sarvam M" }],
};

const TTS_PROVIDERS = [
  { value: "cartesia",   label: "Cartesia" },
  { value: "elevenlabs", label: "ElevenLabs" },
  { value: "openai",     label: "OpenAI TTS" },
  { value: "deepgram",   label: "Deepgram Aura" },
  { value: "sarvam",     label: "Sarvam" },
];

const TTS_MODELS: Record<string, { value: string; label: string }[]> = {
  cartesia: [{ value: "sonic-3", label: "Sonic 3" }, { value: "sonic-turbo", label: "Sonic Turbo" }],
  openai:   [{ value: "tts-1", label: "TTS-1" }, { value: "tts-1-hd", label: "TTS-1 HD" }],
};

const TELEPHONY_PROVIDERS = [
  { value: "twilio", label: "Twilio" },
  { value: "plivo",  label: "Plivo" },
  { value: "vonage", label: "Vonage" },
  { value: "vobiz",  label: "Vobiz" },
];

/* ── Component ───────────────────────────────────────────────────────────── */

type Mode = "managed" | "byop";
type Step = 1 | 2;

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}

export function CreateAgentDialog({ open, onClose, onCreated }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createAgent = useCreateAgent();

  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<Mode>("managed");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en-US");
  const [asr, setAsr] = useState("deepgram");
  const [llm, setLlm] = useState("google");
  const [llmModel, setLlmModel] = useState("gemini-2.5-flash");
  const [tts, setTts] = useState("cartesia");
  const [ttsModel, setTtsModel] = useState("sonic-3");
  const [telephony, setTelephony] = useState("twilio");

  function reset() {
    setStep(1);
    setMode("managed");
    setName("");
    setLanguage("en-US");
    setAsr("deepgram");
    setLlm("google");
    setLlmModel("gemini-2.5-flash");
    setTts("cartesia");
    setTtsModel("sonic-3");
    setTelephony("twilio");
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleNext() {
    if (!name.trim()) return;
    if (mode === "byop") {
      setStep(2);
    } else {
      handleCreate();
    }
  }

  function handleCreate() {
    const isManaged = mode === "managed";
    createAgent.mutate(
      {
        data: {
          name: name.trim(),
          language,
          agentMode: mode,
          asrProvider:       isManaged ? "deepgram"        : asr,
          asrModel:          isManaged ? "nova-3"          : (LLM_MODELS[asr]?.[0]?.value ?? undefined),
          llmProvider:       isManaged ? "google"          : llm,
          llmModel:          isManaged ? "gemini-2.5-flash": llmModel || undefined,
          ttsProvider:       isManaged ? "cartesia"        : tts,
          ttsModel:          isManaged ? "sonic-3"         : (TTS_MODELS[tts]?.[0]?.value ?? undefined),
          telephonyProvider: telephony,
          systemPrompt:      "You are a helpful AI voice assistant.",
          maxDuration:       600,
        } as any,
      },
      {
        onSuccess: (agent) => {
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          toast({ title: `"${agent.name}" created`, description: "Write your system prompt to get started." });
          handleClose();
          onCreated(agent.id);
        },
        onError: (err: unknown) => {
          toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
        },
      }
    );
  }

  const canNext = name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0">

        {/* ── Header ── */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Bot className="h-4.5 w-4.5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold leading-none">
                {step === 1 ? "Create Assistant" : "Configure Providers"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {step === 1
                  ? "Pick a mode, name your assistant, and choose a language."
                  : "Select the ASR, LLM, TTS, and telephony providers for your agent."}
              </DialogDescription>
            </div>
          </div>

          {/* Step dots */}
          {mode === "byop" && (
            <div className="flex items-center gap-1.5 mt-3">
              {([1, 2] as Step[]).map((s) => (
                <div
                  key={s}
                  className={`h-1.5 rounded-full transition-all ${
                    s === step ? "w-5 bg-primary" : s < step ? "w-1.5 bg-primary/40" : "w-1.5 bg-border"
                  }`}
                />
              ))}
            </div>
          )}
        </DialogHeader>

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div className="px-6 py-5 space-y-5">

            {/* Mode cards */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setMode("managed")}
                className={`relative text-left p-3.5 rounded-xl border-2 transition-all ${
                  mode === "managed"
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-muted-foreground/30"
                }`}
              >
                {mode === "managed" && (
                  <span className="absolute top-2.5 right-2.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-2.5 w-2.5 text-primary-foreground" />
                  </span>
                )}
                <Sparkles className={`h-4 w-4 mb-2 ${mode === "managed" ? "text-primary" : "text-muted-foreground"}`} />
                <p className="text-[13px] font-semibold text-foreground leading-none mb-1">Managed</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">Platform handles ASR, LLM & TTS for you.</p>
              </button>

              <button
                type="button"
                onClick={() => setMode("byop")}
                className={`relative text-left p-3.5 rounded-xl border-2 transition-all ${
                  mode === "byop"
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-muted-foreground/30"
                }`}
              >
                {mode === "byop" && (
                  <span className="absolute top-2.5 right-2.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-2.5 w-2.5 text-primary-foreground" />
                  </span>
                )}
                <Bot className={`h-4 w-4 mb-2 ${mode === "byop" ? "text-primary" : "text-muted-foreground"}`} />
                <p className="text-[13px] font-semibold text-foreground leading-none mb-1">Custom</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">Bring your own provider API keys.</p>
              </button>
            </div>

            {/* Managed stack pill */}
            {mode === "managed" && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border border-border">
                <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                <p className="text-[11px] text-muted-foreground font-mono">
                  Deepgram Nova-3 · Gemini 2.5 Flash · Cartesia Sonic-3
                </p>
              </div>
            )}

            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Assistant Name</label>
              <Input
                placeholder="e.g. Sales Assistant"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && canNext) handleNext(); }}
                autoFocus
              />
            </div>

            {/* Language */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Language</label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Telephony — always needed */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Telephony</label>
              <Select value={telephony} onValueChange={setTelephony}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TELEPHONY_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* ── Step 2 (BYOP only) ── */}
        {step === 2 && (
          <div className="px-6 py-5 space-y-4">

            {/* ASR */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Transcriber (ASR)</label>
              <Select value={asr} onValueChange={setAsr}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASR_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* LLM */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Language Model (LLM)</label>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={llm}
                  onValueChange={v => { setLlm(v); setLlmModel(LLM_MODELS[v]?.[0]?.value ?? ""); }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LLM_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {LLM_MODELS[llm] && (
                  <Select value={llmModel} onValueChange={setLlmModel}>
                    <SelectTrigger><SelectValue placeholder="Model" /></SelectTrigger>
                    <SelectContent>
                      {LLM_MODELS[llm]!.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            {/* TTS */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Voice (TTS)</label>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={tts}
                  onValueChange={v => { setTts(v); setTtsModel(TTS_MODELS[v]?.[0]?.value ?? ""); }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {TTS_MODELS[tts] && (
                  <Select value={ttsModel} onValueChange={setTtsModel}>
                    <SelectTrigger><SelectValue placeholder="Model" /></SelectTrigger>
                    <SelectContent>
                      {TTS_MODELS[tts]!.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {(tts === "elevenlabs" || tts === "cartesia") && (
                <p className="text-[10px] text-muted-foreground">You can set a specific voice ID in the assistant settings after creation.</p>
              )}
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="px-6 pb-6 flex items-center gap-3">
          {step === 2 && (
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setStep(1)}
              disabled={createAgent.isPending}
            >
              Back
            </Button>
          )}
          <Button
            type="button"
            className="flex-1 gap-2"
            onClick={step === 1 ? handleNext : handleCreate}
            disabled={!canNext || createAgent.isPending}
          >
            {createAgent.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : step === 1 && mode === "byop" ? (
              <>Next <ChevronRight className="h-4 w-4" /></>
            ) : (
              "Create Assistant"
            )}
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  );
}
