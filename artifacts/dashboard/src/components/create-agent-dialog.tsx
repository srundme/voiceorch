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

/* ── Provider catalogues ─────────────────────────────────────────────────── */

const ASR_PROVIDERS = [
  { value: "deepgram",   label: "Deepgram" },
  { value: "azure",      label: "Azure Speech" },
  { value: "assemblyai", label: "AssemblyAI" },
  { value: "sarvam",     label: "Sarvam" },
];

const LLM_PROVIDERS = [
  { value: "google",    label: "Google Gemini" },
  { value: "openai",    label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "groq",      label: "Groq" },
  { value: "deepseek",  label: "DeepSeek" },
  { value: "sarvam",    label: "Sarvam" },
];

const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  google:    [{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }],
  openai:    [{ value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "gpt-4o", label: "GPT-4o" }],
  anthropic: [{ value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" }, { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }],
  groq:      [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B" }],
  deepseek:  [{ value: "deepseek-chat", label: "DeepSeek Chat" }],
  sarvam:    [{ value: "sarvam-m", label: "Sarvam M" }],
};

const TTS_PROVIDERS = [
  { value: "cartesia",   label: "Cartesia" },
  { value: "elevenlabs", label: "ElevenLabs" },
  { value: "sarvam",     label: "Sarvam" },
  { value: "deepgram",   label: "Deepgram Aura" },
];

const TTS_MODELS: Record<string, { value: string; label: string }[]> = {
  cartesia: [{ value: "sonic-3", label: "Sonic 3" }, { value: "sonic-turbo", label: "Sonic Turbo (fast)" }],
};

type Mode = "managed" | "byop";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}

export function CreateAgentDialog({ open, onClose, onCreated }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createAgent = useCreateAgent();

  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<Mode>("managed");
  const [name, setName] = useState("");
  const [asr, setAsr] = useState("deepgram");
  const [llm, setLlm] = useState("google");
  const [llmModel, setLlmModel] = useState("gemini-2.5-flash");
  const [tts, setTts] = useState("cartesia");
  const [ttsModel, setTtsModel] = useState("sonic-3");

  function reset() {
    setStep(1);
    setMode("managed");
    setName("");
    setAsr("deepgram");
    setLlm("google");
    setLlmModel("gemini-2.5-flash");
    setTts("cartesia");
    setTtsModel("sonic-3");
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handlePrimary() {
    if (!name.trim()) return;
    if (mode === "byop" && step === 1) {
      setStep(2);
      return;
    }
    const isManaged = mode === "managed";
    createAgent.mutate(
      {
        data: {
          name: name.trim(),
          agentMode:         mode,
          asrProvider:       isManaged ? "deepgram"         : asr,
          asrModel:          isManaged ? "nova-3"           : undefined,
          llmProvider:       isManaged ? "google"           : llm,
          llmModel:          isManaged ? "gemini-2.5-flash" : (llmModel || undefined),
          ttsProvider:       isManaged ? "cartesia"         : tts,
          ttsModel:          isManaged ? "sonic-3"          : (TTS_MODELS[tts]?.[0]?.value ?? undefined),
          telephonyProvider: "vobiz",
          systemPrompt:      "You are a helpful AI voice assistant.",
          maxDuration:       600,
        } as any,
      },
      {
        onSuccess: (agent) => {
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          toast({ title: `"${agent.name}" created`, description: "Set up your system prompt to get started." });
          handleClose();
          onCreated(agent.id);
        },
        onError: (err: unknown) => {
          toast({ title: "Failed to create assistant", description: formatApiError(err), variant: "destructive" });
        },
      }
    );
  }

  const canProceed = name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">

        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle className="text-[15px] font-semibold">
            {step === 2 ? "Choose providers" : "New assistant"}
          </DialogTitle>
          <DialogDescription className="text-[12px] text-muted-foreground">
            {step === 2
              ? "Pick the ASR, LLM, and TTS stack for your agent."
              : "Give your assistant a name and choose how it's powered."}
          </DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="px-5 pb-5 space-y-4">

          {step === 1 && (
            <>
              {/* Mode selector */}
              <div className="grid grid-cols-2 gap-2">
                {(["managed", "byop"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`relative text-left px-3.5 py-3 rounded-xl border-2 transition-all ${
                      mode === m
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/30"
                    }`}
                  >
                    {mode === m && (
                      <span className="absolute top-2 right-2 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-2.5 w-2.5 text-primary-foreground" />
                      </span>
                    )}
                    {m === "managed"
                      ? <Sparkles className={`h-3.5 w-3.5 mb-1.5 ${mode === m ? "text-primary" : "text-muted-foreground"}`} />
                      : <Bot className={`h-3.5 w-3.5 mb-1.5 ${mode === m ? "text-primary" : "text-muted-foreground"}`} />
                    }
                    <p className="text-[12.5px] font-semibold text-foreground leading-none">
                      {m === "managed" ? "Managed" : "Custom"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {m === "managed"
                        ? "We handle the AI stack"
                        : "Bring your own providers"}
                    </p>
                  </button>
                ))}
              </div>

              {/* Managed stack hint */}
              {mode === "managed" && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted border border-border/60">
                  <Sparkles className="h-3 w-3 text-primary shrink-0" />
                  <p className="text-[10.5px] text-muted-foreground font-mono tracking-tight">
                    Deepgram · Gemini 2.5 Flash · Cartesia
                  </p>
                </div>
              )}

              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-foreground">Name</label>
                <Input
                  placeholder="e.g. Sales Assistant"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && canProceed) handlePrimary(); }}
                  autoFocus
                  className="h-9 text-sm"
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {/* ASR */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Transcriber</label>
                <Select value={asr} onValueChange={setAsr}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASR_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* LLM */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Language Model</label>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={llm} onValueChange={v => { setLlm(v); setLlmModel(LLM_MODELS[v]?.[0]?.value ?? ""); }}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LLM_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {LLM_MODELS[llm] && (
                    <Select value={llmModel} onValueChange={setLlmModel}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Model" /></SelectTrigger>
                      <SelectContent>
                        {LLM_MODELS[llm]!.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {/* TTS */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Voice</label>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={tts} onValueChange={v => { setTts(v); setTtsModel(TTS_MODELS[v]?.[0]?.value ?? ""); }}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {TTS_MODELS[tts] && (
                    <Select value={ttsModel} onValueChange={setTtsModel}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Model" /></SelectTrigger>
                      <SelectContent>
                        {TTS_MODELS[tts]!.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {step === 2 && (
              <Button
                type="button"
                variant="outline"
                className="flex-1 h-9"
                onClick={() => setStep(1)}
                disabled={createAgent.isPending}
              >
                Back
              </Button>
            )}
            <Button
              type="button"
              className="flex-1 h-9 gap-1.5"
              onClick={handlePrimary}
              disabled={!canProceed || createAgent.isPending}
            >
              {createAgent.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : mode === "byop" && step === 1 ? (
                <>Next <ChevronRight className="h-3.5 w-3.5" /></>
              ) : (
                "Create"
              )}
            </Button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
