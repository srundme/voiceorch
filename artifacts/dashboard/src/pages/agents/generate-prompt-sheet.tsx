import { useState } from "react";
import { Sparkles, RotateCcw, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LANGUAGES } from "@/lib/agent-providers";
import { customFetch } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const USE_CASES = [
  { value: "lead_qualification",  label: "Lead Qualification" },
  { value: "appointment_booking", label: "Appointment Booking" },
  { value: "customer_support",    label: "Customer Support" },
  { value: "outbound_sales",      label: "Outbound Sales" },
  { value: "survey_collection",   label: "Survey / Feedback" },
  { value: "collections",         label: "Collections / Payment Reminder" },
  { value: "custom",              label: "Custom / Other" },
];

interface GeneratePromptSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultAgentName?: string;
  defaultLanguage?: string;
  onApply: (prompt: string) => void;
}

interface FormState {
  agentName: string;
  companyName: string;
  useCase: string;
  agentDirection: "inbound" | "outbound";
  language: string;
  callFlowDescription: string;
  keyKnowledge: string;
}

type SheetPhase = "form" | "generating" | "preview" | "error";

export function GeneratePromptSheet({
  open,
  onOpenChange,
  defaultAgentName = "",
  defaultLanguage = "en-US",
  onApply,
}: GeneratePromptSheetProps) {
  const [phase, setPhase]               = useState<SheetPhase>("form");
  const [generatedPrompt, setGenerated] = useState("");
  const [errorMsg, setErrorMsg]         = useState("");
  const [showKnowledge, setShowKnowledge] = useState(false);

  const languageLabel = LANGUAGES.find(l => l.value === defaultLanguage)?.label ?? defaultLanguage;

  const [form, setForm] = useState<FormState>({
    agentName:           defaultAgentName,
    companyName:         "",
    useCase:             "custom",
    agentDirection:      "inbound",
    language:            languageLabel,
    callFlowDescription: "",
    keyKnowledge:        "",
  });

  const setField = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  const canGenerate = form.callFlowDescription.trim().length > 15;

  async function runGeneration() {
    setPhase("generating");
    setErrorMsg("");
    try {
      const res = await customFetch<{ systemPrompt: string }>(
        `${BASE}/api/wizard/generate-master-prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentName:           form.agentName.trim() || undefined,
            companyName:         form.companyName.trim() || undefined,
            useCase:             form.useCase,
            agentDirection:      form.agentDirection,
            selectedLanguages:   [form.language].filter(Boolean),
            serviceDescription:  form.keyKnowledge.trim() || undefined,
            callFlowDescription: [
              form.callFlowDescription.trim(),
              form.keyKnowledge.trim() ? `\n\nKey knowledge:\n${form.keyKnowledge.trim()}` : "",
            ].join(""),
          }),
        },
      );
      setGenerated(res.systemPrompt);
      setPhase("preview");
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? "Generation failed";
      const isNoTemplate = msg.includes("No active master prompt template");
      setErrorMsg(
        isNoTemplate
          ? "No active prompt template is set up yet. Ask your admin to upload and activate a master template in the Admin panel."
          : msg,
      );
      setPhase("error");
    }
  }

  function handleClose() {
    setPhase("form");
    setGenerated("");
    setErrorMsg("");
    onOpenChange(false);
  }

  function handleApply() {
    onApply(generatedPrompt);
    handleClose();
  }

  // Sync defaultAgentName when it changes (agent loaded asynchronously)
  // but only if user hasn't touched it
  if (defaultAgentName && form.agentName === "" && phase === "form") {
    setForm(f => ({ ...f, agentName: defaultAgentName }));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[520px] flex flex-col gap-0 p-0 overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-4 h-4 text-primary" />
            Generate System Prompt
          </SheetTitle>
          <SheetDescription className="text-xs">
            Describe what your agent should do and we'll write a production-quality prompt using AI.
          </SheetDescription>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── Phase: form ─────────────────────────────────────────────── */}
          {(phase === "form" || phase === "generating") && (
            <>
              {/* Row 1: Agent name + Company name */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Agent name</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="Alex"
                    value={form.agentName}
                    onChange={e => setField("agentName", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Company name</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="Acme Corp"
                    value={form.companyName}
                    onChange={e => setField("companyName", e.target.value)}
                  />
                </div>
              </div>

              {/* Row 2: Use case + Direction */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Use case</Label>
                  <Select value={form.useCase} onValueChange={v => setField("useCase", v)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {USE_CASES.map(u => (
                        <SelectItem key={u.value} value={u.value} className="text-xs">
                          {u.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Call direction</Label>
                  <Select
                    value={form.agentDirection}
                    onValueChange={v => setField("agentDirection", v as "inbound" | "outbound")}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inbound"  className="text-xs">Inbound</SelectItem>
                      <SelectItem value="outbound" className="text-xs">Outbound</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Language hint */}
              <div className="space-y-1.5">
                <Label className="text-xs">Language</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="e.g. English, Hindi"
                  value={form.language}
                  onChange={e => setField("language", e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">
                  Pre-filled from your agent's ASR language. You can type multiple languages.
                </p>
              </div>

              {/* Call flow — the key field */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">
                    Call flow description <span className="text-red-400">*</span>
                  </Label>
                  <span className={cn(
                    "text-[10px]",
                    form.callFlowDescription.length > 15 ? "text-muted-foreground" : "text-amber-400",
                  )}>
                    {form.callFlowDescription.length > 15 ? "✓ enough detail" : "describe more to generate"}
                  </span>
                </div>
                <Textarea
                  className="min-h-[130px] text-sm resize-none"
                  placeholder={
                    "Describe what the agent should do on each call.\n\n" +
                    "Examples:\n" +
                    "• Greet callers, ask for name & interest, qualify budget, book a demo if qualified\n" +
                    "• Call leads from our CRM, introduce our insurance product, handle objections, and transfer hot leads to a human agent\n" +
                    "• Answer questions about our software product, troubleshoot basic issues, escalate complex ones"
                  }
                  value={form.callFlowDescription}
                  onChange={e => setField("callFlowDescription", e.target.value)}
                />
              </div>

              {/* Optional: Key knowledge */}
              <div className="border border-border rounded-lg overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  onClick={() => setShowKnowledge(v => !v)}
                >
                  <span>Key knowledge / FAQs (optional)</span>
                  {showKnowledge
                    ? <ChevronUp className="w-3.5 h-3.5" />
                    : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {showKnowledge && (
                  <div className="px-3 pb-3 border-t border-border">
                    <Textarea
                      className="min-h-[100px] text-xs resize-none mt-2"
                      placeholder={"Pricing, FAQs, escalation rules, product details…\n\nThis is injected into the prompt so the agent has the right context during calls."}
                      value={form.keyKnowledge}
                      onChange={e => setField("keyKnowledge", e.target.value)}
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Phase: generating ───────────────────────────────────────── */}
          {phase === "generating" && (
            <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
              <div className="relative">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-primary animate-pulse" />
                </div>
                <Loader2 className="w-14 h-14 absolute -top-1 -left-1 text-primary/30 animate-spin" />
              </div>
              <div>
                <p className="text-sm font-medium">Generating your prompt…</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Qwen is crafting a production-quality system prompt. This takes 3–5 seconds.
                </p>
              </div>
            </div>
          )}

          {/* ── Phase: preview ──────────────────────────────────────────── */}
          {phase === "preview" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-medium">Prompt generated</span>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {generatedPrompt.length.toLocaleString()} chars
                </Badge>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
                <div className="max-h-[420px] overflow-y-auto p-4">
                  <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed text-foreground/90">
                    {generatedPrompt}
                  </pre>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Review the prompt above. Click <strong>Use this prompt</strong> to insert it into the editor, or <strong>Regenerate</strong> to try again with different inputs.
              </p>
            </div>
          )}

          {/* ── Phase: error ────────────────────────────────────────────── */}
          {phase === "error" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-red-400">Generation failed</p>
                  <p className="text-xs text-muted-foreground">{errorMsg}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                You can adjust your inputs and try again, or write the prompt manually.
              </p>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={handleClose} className="text-muted-foreground">
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            {/* Regenerate — shown in preview or error */}
            {(phase === "preview" || phase === "error") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setPhase("form"); }}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                Adjust & Regenerate
              </Button>
            )}

            {/* Generate — shown in form */}
            {(phase === "form" || phase === "error") && (
              <Button
                size="sm"
                disabled={!canGenerate}
                onClick={runGeneration}
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                Generate
              </Button>
            )}

            {/* Use this prompt — shown in preview */}
            {phase === "preview" && (
              <Button size="sm" onClick={handleApply}>
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                Use this prompt
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
