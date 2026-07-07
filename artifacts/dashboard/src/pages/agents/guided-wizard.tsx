import { useState } from "react";
import { useLocation } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Wand2, Settings2, Globe, Languages, Bot, Mic2, User, Building2,
  PhoneIncoming, PhoneOutgoing, BookOpen, Sparkles, Loader2, CheckCircle2,
  Phone, ArrowRight, ArrowLeft,
} from "lucide-react";
import {
  useCreateAgent,
  useGenerateSystemPrompt,
  getListAgentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatApiError } from "@/lib/format-api-error";
import { useToast } from "@/hooks/use-toast";

const KARTHIKEYAN_VOICE_ID = "2344e62d-2b68-4873-9ede-9fa64f6ec889";
const GAYATHRI_VOICE_ID    = "a8adc74b-c9c1-45e0-aae7-9a60ba64bbee";

const SINGLE_LANGS = [
  { value: "ta-IN", label: "Tamil",           gemini: true  },
  { value: "en-IN", label: "English (India)",  gemini: false },
  { value: "hi-IN", label: "Hindi",            gemini: false },
  { value: "te-IN", label: "Telugu",           gemini: false },
  { value: "kn-IN", label: "Kannada",          gemini: false },
  { value: "ml-IN", label: "Malayalam",        gemini: false },
  { value: "en-US", label: "English (US)",     gemini: false },
];

type Step = "choice" | "name" | "language" | "voice" | "callflow" | "creating" | "done";

interface WizardState {
  agentName:    string;
  langMode:     "single" | "multi";
  singleLang:   string;
  hasTamil:     boolean;
  gender:       "male" | "female";
  companyName:  string;
  direction:    "inbound" | "outbound";
  description:  string;
  knowledge:    string;
}

function deriveConfig(s: WizardState) {
  const isTamil =
    (s.langMode === "single" && s.singleLang === "ta-IN") ||
    (s.langMode === "multi"  && s.hasTamil);

  const lang        = s.langMode === "multi" ? "en-IN" : s.singleLang;
  const langLabel   = SINGLE_LANGS.find(l => l.value === lang)?.label ?? "English (India)";
  const multiLabel  = "English, Tamil, Hindi and other Indian languages";

  return {
    isTamil,
    lang,
    langLabel:       s.langMode === "multi" ? multiLabel : langLabel,
    llmProvider:     isTamil ? "google" : "groq",
    llmModel:        isTamil ? "gemini-2.5-flash" : "llama-3.3-70b-versatile",
    voiceId:         s.gender === "male" ? KARTHIKEYAN_VOICE_ID : GAYATHRI_VOICE_ID,
    voiceName:       s.gender === "male" ? "Karthikeyan" : "Gayathri",
    multiLingual:    s.langMode === "multi",
  };
}

interface Props {
  open:          boolean;
  onOpenChange:  (v: boolean) => void;
}

export function GuidedAgentWizard({ open, onOpenChange }: Props) {
  const [step, setStep]       = useState<Step>("choice");
  const [state, setState]     = useState<WizardState>({
    agentName:   "",
    langMode:    "single",
    singleLang:  "ta-IN",
    hasTamil:    true,
    gender:      "male",
    companyName: "",
    direction:   "inbound",
    description: "",
    knowledge:   "",
  });
  const [errorMsg,      setErrorMsg]      = useState("");
  const [createdId,     setCreatedId]     = useState<number | null>(null);

  const [, navigate]  = useLocation();
  const { toast }     = useToast();
  const queryClient   = useQueryClient();
  const createAgent   = useCreateAgent();
  const generatePrompt = useGenerateSystemPrompt();

  function set<K extends keyof WizardState>(k: K, v: WizardState[K]) {
    setState(s => ({ ...s, [k]: v }));
  }

  function reset() {
    setStep("choice");
    setErrorMsg("");
    setCreatedId(null);
    setState({
      agentName: "", langMode: "single", singleLang: "ta-IN",
      hasTamil: true, gender: "male", companyName: "",
      direction: "inbound", description: "", knowledge: "",
    });
  }

  function close() {
    onOpenChange(false);
    setTimeout(reset, 300);
  }

  async function handleCreate() {
    setStep("creating");
    setErrorMsg("");
    const cfg = deriveConfig(state);
    try {
      const genRes = await generatePrompt.mutateAsync({
        data: {
          agentName:           state.agentName,
          companyName:         state.companyName,
          isCustom:            true,
          domainId:            null,
          useCaseLabel:        "Custom / Other",
          agentDirection:      state.direction,
          language:            cfg.langLabel,
          selectedLanguages:   [cfg.langLabel],
          callFlowDescription: state.description,
          keyKnowledge:        state.knowledge || undefined,
        },
      });

      const systemPrompt = genRes.systemPrompt;

      const agent = await createAgent.mutateAsync({
        data: {
          name:            state.agentName,
          asrProvider:     "sarvam",
          asrModel:        "saaras:v3",
          asrLanguage:     cfg.lang,
          language:        cfg.lang,
          llmProvider:     cfg.llmProvider,
          llmModel:        cfg.llmModel,
          ttsProvider:     "cartesia",
          ttsModel:        "sonic-3.5",
          ttsVoice:        cfg.voiceId,
          telephonyProvider: "vobiz",
          systemPrompt,
          greetingMessage: "Hello",
          recordingEnabled: true,
          agentConfig: {
            languageAutoDetect: cfg.multiLingual,
            autoRedial: { enabled: true, maxAttempts: 3 },
          },
        } as any,
      });

      queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      setCreatedId(agent.id);
      setStep("done");
    } catch (err: unknown) {
      setErrorMsg(formatApiError(err));
      setStep("callflow");
      toast({ title: "Setup failed", description: formatApiError(err), variant: "destructive" });
    }
  }

  const STEPS: Step[] = ["name", "language", "voice", "callflow"];
  const stepIdx       = STEPS.indexOf(step as Step);
  const progress      = stepIdx >= 0 ? ((stepIdx + 1) / STEPS.length) * 100 : 0;

  const cfg = deriveConfig(state);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent
        className={cn(
          "max-w-lg w-full transition-all duration-200",
          step === "choice" && "max-w-xl",
        )}
      >
        {step === "choice" && <ChoiceStep onGuided={() => setStep("name")} onExpert={() => { close(); navigate("/app/agents"); }} />}

        {step === "name" && (
          <WizardShell step={1} total={4} title="What's your agent's name?" progress={progress}
            onBack={() => setStep("choice")}
            onNext={() => setStep("language")}
            nextDisabled={!state.agentName.trim()}
          >
            <div className="space-y-2">
              <Label className="text-sm">Agent name</Label>
              <Input
                autoFocus
                placeholder="e.g. Karthik, Priya, Riya…"
                value={state.agentName}
                onChange={e => set("agentName", e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && state.agentName.trim()) setStep("language"); }}
                className="text-base"
              />
              <p className="text-xs text-muted-foreground">This is the name the agent will use to introduce itself.</p>
            </div>
          </WizardShell>
        )}

        {step === "language" && (
          <WizardShell step={2} total={4} title="What language will your agent speak?" progress={progress}
            onBack={() => setStep("name")}
            onNext={() => setStep("voice")}
          >
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <OptionCard
                  icon={<Globe className="h-5 w-5" />}
                  title="Single language"
                  desc="Agent always speaks one language"
                  selected={state.langMode === "single"}
                  onClick={() => set("langMode", "single")}
                />
                <OptionCard
                  icon={<Languages className="h-5 w-5" />}
                  title="Multi-language"
                  desc="Switches with the caller's language"
                  selected={state.langMode === "multi"}
                  onClick={() => set("langMode", "multi")}
                />
              </div>

              {state.langMode === "single" && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Select language</Label>
                  <Select value={state.singleLang} onValueChange={v => set("singleLang", v)}>
                    <SelectTrigger className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SINGLE_LANGS.map(l => (
                        <SelectItem key={l.value} value={l.value} className="text-sm">
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {cfg.isTamil && (
                    <p className="text-xs text-primary/80 flex items-center gap-1.5 mt-1">
                      <Sparkles className="h-3 w-3" />
                      Gemini 2.5 Flash selected — best model for Tamil voice calls
                    </p>
                  )}
                </div>
              )}

              {state.langMode === "multi" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Auto-detect is enabled — the agent will match whatever language the caller uses mid-call.
                  </p>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Does your agent need to speak Tamil?</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <OptionCard
                        title="Yes — includes Tamil"
                        desc="Gemini 2.5 Flash (best for Tamil)"
                        selected={state.hasTamil}
                        onClick={() => set("hasTamil", true)}
                        compact
                      />
                      <OptionCard
                        title="No — other languages"
                        desc="Groq Llama 70B (fast, multilingual)"
                        selected={!state.hasTamil}
                        onClick={() => set("hasTamil", false)}
                        compact
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-lg bg-elevated border border-border px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p><span className="text-foreground font-medium">STT:</span> Sarvam Saaras v3 — best Indian language transcription</p>
                <p><span className="text-foreground font-medium">TTS:</span> Cartesia Sonic 3.5 — lowest latency voice synthesis</p>
                <p><span className="text-foreground font-medium">LLM:</span> {cfg.isTamil ? "Gemini 2.5 Flash" : "Groq Llama 3.3 70B"}</p>
              </div>
            </div>
          </WizardShell>
        )}

        {step === "voice" && (
          <WizardShell step={3} total={4} title="Choose your agent's voice" progress={progress}
            onBack={() => setStep("language")}
            onNext={() => setStep("callflow")}
          >
            <div className="grid grid-cols-2 gap-3">
              <OptionCard
                icon={<User className="h-5 w-5" />}
                title="Male"
                desc="Karthikeyan — natural Tamil/Indian male voice"
                selected={state.gender === "male"}
                onClick={() => set("gender", "male")}
              />
              <OptionCard
                icon={<User className="h-5 w-5" />}
                title="Female"
                desc="Gayathri — natural Tamil/Indian female voice"
                selected={state.gender === "female"}
                onClick={() => set("gender", "female")}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Both voices are native Indian voices from Cartesia. You can switch any time in the agent settings.
            </p>
          </WizardShell>
        )}

        {step === "callflow" && (
          <WizardShell step={4} total={4} title="Tell us about the call" progress={progress}
            onBack={() => setStep("voice")}
            onNext={handleCreate}
            nextLabel="Generate & Create Agent"
            nextIcon={<Sparkles className="h-3.5 w-3.5" />}
            nextDisabled={!state.companyName.trim() || state.description.trim().length < 12}
            loading={createAgent.isPending || generatePrompt.isPending}
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Company / brand name <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="e.g. Galaxy Health Insurance"
                  value={state.companyName}
                  onChange={e => set("companyName", e.target.value)}
                  className="text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Call direction</Label>
                <div className="grid grid-cols-2 gap-2">
                  <OptionCard
                    icon={<PhoneIncoming className="h-4 w-4" />}
                    title="Inbound"
                    desc="Customers call your agent"
                    selected={state.direction === "inbound"}
                    onClick={() => set("direction", "inbound")}
                    compact
                  />
                  <OptionCard
                    icon={<PhoneOutgoing className="h-4 w-4" />}
                    title="Outbound"
                    desc="Agent calls your customers"
                    selected={state.direction === "outbound"}
                    onClick={() => set("direction", "outbound")}
                    compact
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">What does the agent talk about? <span className="text-destructive">*</span></Label>
                <Textarea
                  placeholder="e.g. This agent calls existing health insurance customers to explain their Gala Fit wellness benefit program, answer questions about how to earn Wellness Coins, and encourage them to download the Galaxy Health app…"
                  rows={4}
                  value={state.description}
                  onChange={e => set("description", e.target.value)}
                  className="text-sm resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Be specific — include the goal, what the agent should say, and any objection handling needed.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <BookOpen className="h-3 w-3" /> Knowledge base
                  <Badge variant="outline" className="text-[10px] px-1 py-0">Optional</Badge>
                </Label>
                <Textarea
                  placeholder="Paste FAQs, product details, pricing, or any reference material the agent should know…"
                  rows={3}
                  value={state.knowledge}
                  onChange={e => set("knowledge", e.target.value)}
                  className="text-sm resize-none"
                />
              </div>

              {errorMsg && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{errorMsg}</p>
              )}
            </div>
          </WizardShell>
        )}

        {step === "creating" && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Loader2 className="h-7 w-7 text-primary animate-spin" />
            </div>
            <div>
              <p className="font-semibold text-base">Setting up your agent…</p>
              <p className="text-sm text-muted-foreground mt-1">Generating system prompt and configuring all settings</p>
            </div>
          </div>
        )}

        {step === "done" && createdId !== null && (
          <div className="flex flex-col items-center text-center gap-5 py-6">
            <div className="h-16 w-16 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
            <div>
              <p className="font-semibold text-lg">Your agent is ready! 🎉</p>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
                <span className="font-medium text-foreground">{state.agentName}</span> has been created with a
                custom system prompt, {cfg.langLabel} language support, and {cfg.voiceName}'s voice.
              </p>
            </div>

            <div className="w-full rounded-xl border border-border bg-elevated p-4 text-left space-y-2 text-xs text-muted-foreground">
              <p className="text-foreground font-medium text-sm mb-2">What's been set up for you</p>
              <p>✅ System prompt generated from your description</p>
              <p>✅ Sarvam Saaras v3 STT — best for Indian languages</p>
              <p>✅ {cfg.isTamil ? "Gemini 2.5 Flash" : "Groq Llama 3.3 70B"} LLM</p>
              <p>✅ Cartesia Sonic 3.5 TTS · {cfg.voiceName} voice</p>
              {cfg.multiLingual && <p>✅ Auto-detect language ON — switches with caller</p>}
              <p>✅ Call recording ON · Auto-redial ON</p>
            </div>

            <div className="flex flex-col gap-2 w-full">
              <Button
                className="w-full gap-2"
                onClick={() => {
                  close();
                  navigate(`/app/agents/${createdId}?webcall=1`);
                }}
              >
                <Phone className="h-4 w-4" />
                Make a Demo Web Call
              </Button>
              <Button variant="outline" className="w-full gap-2" onClick={() => { close(); navigate(`/app/agents/${createdId}`); }}>
                Open Agent Settings
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChoiceStep({ onGuided, onExpert }: { onGuided: () => void; onExpert: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-xl">Create a new agent</DialogTitle>
        <DialogDescription>How would you like to get started?</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-3 mt-2 sm:grid-cols-2">
        <button
          onClick={onGuided}
          className="group flex flex-col items-start gap-3 rounded-xl border-2 border-primary/30 bg-primary/5 p-5 text-left hover:border-primary/60 hover:bg-primary/10 transition-all"
        >
          <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center group-hover:bg-primary/25 transition-colors">
            <Wand2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm">Set it up for me</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Answer a few simple questions and we'll configure your agent, generate a system prompt, and get it ready to call.
            </p>
          </div>
          <Badge className="text-[10px] bg-primary/15 text-primary border-0">Recommended for new users</Badge>
        </button>

        <button
          onClick={onExpert}
          className="group flex flex-col items-start gap-3 rounded-xl border-2 border-border bg-card p-5 text-left hover:border-border/80 hover:bg-elevated transition-all"
        >
          <div className="h-10 w-10 rounded-xl bg-elevated flex items-center justify-center group-hover:bg-muted transition-colors">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-sm">I'll configure it myself</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Full control over every setting — ASR, LLM, TTS, voice, prompts, and advanced options.
            </p>
          </div>
          <Badge variant="outline" className="text-[10px]">Expert mode</Badge>
        </button>
      </div>
    </>
  );
}

function WizardShell({
  step, total, title, progress, children, onBack, onNext,
  nextDisabled = false, nextLabel = "Continue", nextIcon, loading = false,
}: {
  step:          number;
  total:         number;
  title:         string;
  progress:      number;
  children:      React.ReactNode;
  onBack?:       () => void;
  onNext?:       () => void;
  nextDisabled?: boolean;
  nextLabel?:    string;
  nextIcon?:     React.ReactNode;
  loading?:      boolean;
}) {
  return (
    <>
      <DialogHeader className="pb-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">Step {step} of {total}</span>
          <div className="h-1.5 flex-1 mx-4 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
      </DialogHeader>

      <div className="mt-3 space-y-4">
        {children}
      </div>

      <div className="flex gap-2 mt-4">
        {onBack && (
          <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        )}
        {onNext && (
          <Button
            size="sm"
            className="ml-auto gap-1.5"
            onClick={onNext}
            disabled={nextDisabled || loading}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : nextIcon}
            {nextLabel}
            {!loading && !nextIcon && <ArrowRight className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>
    </>
  );
}

function OptionCard({
  icon, title, desc, selected, onClick, compact = false,
}: {
  icon?:     React.ReactNode;
  title:     string;
  desc:      string;
  selected:  boolean;
  onClick:   () => void;
  compact?:  boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-lg border-2 text-left transition-all",
        compact ? "px-3 py-2.5" : "p-4",
        selected
          ? "border-primary bg-primary/8"
          : "border-border bg-card hover:border-border/70 hover:bg-elevated",
      )}
    >
      {icon && !compact && (
        <div className={cn("rounded-lg p-1.5", selected ? "bg-primary/15 text-primary" : "bg-elevated text-muted-foreground")}>
          {icon}
        </div>
      )}
      <p className={cn("font-medium leading-tight", compact ? "text-xs" : "text-sm", selected && "text-primary")}>
        {title}
      </p>
      <p className="text-xs text-muted-foreground leading-snug">{desc}</p>
    </button>
  );
}
