import { useMemo, useState } from "react";
import { Sparkles, RotateCcw, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Loader2, XCircle, ShieldCheck } from "lucide-react";
import { diffWords } from "diff";
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
import {
  useGetSystemPromptStore,
  useGenerateSystemPrompt,
  type SystemPromptGenerationMeta,
  type SystemPromptGuardrailResult,
} from "@workspace/api-client-react";

const CUSTOM_VALUE = "custom";

interface GeneratePromptSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultAgentName?: string;
  defaultLanguage?: string;
  /** Current System Prompt field content — drives the diff/overwrite gating. */
  currentPrompt?: string;
  onApply: (prompt: string, meta: SystemPromptGenerationMeta | null) => void;
}

interface FormState {
  agentName: string;
  companyName: string;
  useCase: string; // domain id as string, or CUSTOM_VALUE
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
  currentPrompt = "",
  onApply,
}: GeneratePromptSheetProps) {
  const [phase, setPhase]               = useState<SheetPhase>("form");
  const [generatedPrompt, setGenerated] = useState("");
  const [genMeta, setGenMeta]           = useState<SystemPromptGenerationMeta | null>(null);
  const [guardrail, setGuardrail]       = useState<SystemPromptGuardrailResult | null>(null);
  // Failed checks from the last generation attempt — threaded back into the
  // next generation so "Adjust & Regenerate" doesn't reproduce the same issue.
  const [prevFailures, setPrevFailures] = useState<Array<{ label: string; detail: string; snippet?: string | null }>>([]);
  const [warnings, setWarnings]         = useState<string[]>([]);
  const [errorMsg, setErrorMsg]         = useState("");
  const [errorReason, setErrorReason]   = useState<string>("");
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [showDiff, setShowDiff]         = useState(false);

  const languageLabel = LANGUAGES.find(l => l.value === defaultLanguage)?.label ?? defaultLanguage;

  const [form, setForm] = useState<FormState>({
    agentName:           defaultAgentName,
    companyName:         "",
    useCase:             CUSTOM_VALUE,
    agentDirection:      "inbound",
    language:            languageLabel,
    callFlowDescription: "",
    keyKnowledge:        "",
  });

  // Fetch the layered store (Foundation status + domain dropdown) when the sheet opens.
  const storeQuery = useGetSystemPromptStore({ query: { enabled: open, queryKey: ["wizard", "system-prompt-store"] } });
  const store = storeQuery.data;

  const generateMutation = useGenerateSystemPrompt();

  const setField = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  const hasExistingPrompt = currentPrompt.trim().length > 0;
  const foundationMissing = !!store && !store.foundation.available;

  // Required fields for a valid generation.
  const missingFields = useMemo(() => {
    const m: string[] = [];
    if (!form.agentName.trim())   m.push("Agent name");
    if (!form.companyName.trim()) m.push("Company name");
    if (form.callFlowDescription.trim().length < 12) m.push("Call flow description");
    return m;
  }, [form.agentName, form.companyName, form.callFlowDescription]);

  const canGenerate = missingFields.length === 0 && !foundationMissing && !storeQuery.isLoading;

  const isCustom = form.useCase === CUSTOM_VALUE;
  const selectedDomainId = isCustom ? null : Number(form.useCase);
  const selectedDomain = store?.domains.find(d => String(d.id) === form.useCase);

  async function runGeneration() {
    setPhase("generating");
    setErrorMsg("");
    setErrorReason("");
    try {
      const res = await generateMutation.mutateAsync({
        data: {
          agentName:      form.agentName.trim(),
          companyName:    form.companyName.trim(),
          isCustom,
          domainId:       selectedDomainId,
          useCaseLabel:   isCustom ? "Custom / Other" : (selectedDomain?.name ?? "Custom / Other"),
          agentDirection: form.agentDirection,
          language:       form.language.trim(),
          selectedLanguages: [form.language.trim()].filter(Boolean),
          callFlowDescription: form.callFlowDescription.trim(),
          keyKnowledge:   form.keyKnowledge.trim() || undefined,
          // Carry the last attempt's failed checks so the generator is told
          // exactly what to avoid this time.
          previousFailures: prevFailures.length > 0 ? prevFailures : undefined,
        },
      });
      setGenerated(res.systemPrompt);
      setGenMeta(res.generationMeta);
      setGuardrail(res.guardrail);
      setPrevFailures(
        res.guardrail.checks
          .filter(c => !c.passed)
          .map(c => ({ label: c.label, detail: c.detail, snippet: c.snippet ?? null })),
      );
      setWarnings(res.warnings ?? []);
      // When the field already holds a prompt, surface the diff by default rather
      // than silently overwriting — the user must see what changes.
      setShowDiff(currentPrompt.trim().length > 0);
      setPhase("preview");
    } catch (err: unknown) {
      // customFetch throws with the parsed body attached when available.
      const anyErr = err as { reason?: string; error?: string; message?: string; body?: { reason?: string; error?: string } };
      const reason = anyErr?.reason ?? anyErr?.body?.reason ?? "";
      const msg = anyErr?.error ?? anyErr?.body?.error ?? anyErr?.message ?? "Generation failed";
      setErrorReason(reason);
      setErrorMsg(msg);
      setPhase("error");
    }
  }

  function handleClose() {
    setPhase("form");
    setGenerated("");
    setGenMeta(null);
    setGuardrail(null);
    setPrevFailures([]);
    setWarnings([]);
    setErrorMsg("");
    setErrorReason("");
    setShowDiff(false);
    onOpenChange(false);
  }

  function handleApply() {
    onApply(generatedPrompt, genMeta);
    handleClose();
  }

  // Sync defaultAgentName when it changes (agent loaded asynchronously)
  // but only if user hasn't touched it
  if (defaultAgentName && form.agentName === "" && phase === "form") {
    setForm(f => ({ ...f, agentName: defaultAgentName }));
  }

  // Apply is blocked while any Foundation guardrail fails — a failed prompt must
  // never be inserted into the agent's System Prompt field.
  const applyBlocked = !!guardrail && !guardrail.passed;

  const diffParts = useMemo(() => {
    if (!showDiff) return null;
    return diffWords(currentPrompt, generatedPrompt);
  }, [showDiff, currentPrompt, generatedPrompt]);

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
            Describe what your agent should do — we layer your company's Foundation, the use-case template, and your inputs into a production-quality prompt.
          </SheetDescription>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Foundation-missing hard block */}
          {(phase === "form" || phase === "generating") && foundationMissing && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-400">Foundation template not configured</p>
                <p className="text-xs text-muted-foreground">
                  Your admin needs to upload and activate a Foundation template in the System Prompt Templates page before prompts can be generated.
                </p>
              </div>
            </div>
          )}

          {/* ── Phase: form ─────────────────────────────────────────────── */}
          {(phase === "form" || phase === "generating") && (
            <>
              {/* Row 1: Agent name + Company name */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Agent name <span className="text-red-400">*</span></Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="Alex"
                    value={form.agentName}
                    onChange={e => setField("agentName", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Company name <span className="text-red-400">*</span></Label>
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
                      <SelectValue placeholder={storeQuery.isLoading ? "Loading…" : "Select a use case"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(store?.domains ?? []).map(d => (
                        <SelectItem key={d.id} value={String(d.id)} className="text-xs">
                          {d.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_VALUE} className="text-xs">
                        Custom / Other
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {!isCustom && selectedDomain && (
                    <p className="text-[10px] text-muted-foreground">
                      Template v{selectedDomain.version}
                    </p>
                  )}
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
                    "text-[10px] inline-flex items-center gap-0.5",
                    form.callFlowDescription.trim().length >= 12 ? "text-muted-foreground" : "text-amber-400",
                  )}>
                    {form.callFlowDescription.trim().length >= 12
                      ? <><CheckCircle2 className="h-3 w-3 shrink-0" />enough detail</>
                      : "describe more to generate"}
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

              {/* Missing-field hint */}
              {phase === "form" && missingFields.length > 0 && !foundationMissing && (
                <p className="text-[10px] text-amber-400">
                  Fill in: {missingFields.join(", ")}
                </p>
              )}
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
                  Layering Foundation → {isCustom ? "Custom" : (selectedDomain?.name ?? "use case")} → your inputs. This takes 3–5 seconds.
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

              {/* Version traceability */}
              {genMeta && (
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    Foundation v{genMeta.foundationVersion}
                  </Badge>
                  {genMeta.domain
                    ? <Badge variant="outline" className="text-[10px]">{genMeta.domain.name} v{genMeta.domain.version}</Badge>
                    : <Badge variant="outline" className="text-[10px]">Custom / Other</Badge>}
                  {genMeta.clientDetailsVersion != null && (
                    <Badge variant="outline" className="text-[10px]">Client Details v{genMeta.clientDetailsVersion}</Badge>
                  )}
                </div>
              )}

              {/* Guardrail pass/fail list */}
              {guardrail && (
                <div className={cn(
                  "rounded-lg border p-3 space-y-2",
                  guardrail.passed ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5",
                )}>
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className={cn("w-3.5 h-3.5", guardrail.passed ? "text-emerald-400" : "text-red-400")} />
                    <span className="text-xs font-medium">
                      {guardrail.passed ? "All checks passed" : "Some checks failed"}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {guardrail.checks.map(c => (
                      <li key={c.name} className="flex items-start gap-1.5 text-[10px]">
                        {c.passed
                          ? <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                          : <XCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />}
                        <span className={c.passed ? "text-muted-foreground" : "text-red-300"}>
                          <span className={cn(
                            "inline-block mr-1 rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide align-middle",
                            c.source === "domain"
                              ? "bg-violet-500/15 text-violet-300"
                              : c.source === "structure"
                                ? "bg-sky-500/15 text-sky-300"
                                : "bg-emerald-500/10 text-emerald-300/80",
                          )}>
                            {c.source === "domain" ? "Domain" : c.source === "structure" ? "Structure" : "Foundation"}
                          </span>
                          <span className="font-medium">{c.label}</span>
                          {!c.passed && <> — {c.detail}</>}
                          {!c.passed && c.snippet && (
                            <span className="block mt-0.5 rounded bg-red-500/10 px-1.5 py-1 font-mono text-[9px] leading-snug text-red-200/90">
                              “{c.snippet}”
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!guardrail.passed && (
                    <p className="text-[10px] font-medium text-red-300">
                      These issues come from the generated text — not your inputs. An automatic fix was already attempted.
                      Click <strong>Adjust &amp; Regenerate</strong>: the next generation is told exactly which checks failed
                      (and the offending text) so it can produce a compliant prompt.
                    </p>
                  )}
                </div>
              )}

              {/* Non-blocking jurisdiction / language mismatch warnings */}
              {warnings.length > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-medium text-amber-300">Check your use case &amp; language</span>
                  </div>
                  <ul className="space-y-1">
                    {warnings.map((w, i) => (
                      <li key={i} className="text-[10px] text-amber-200/90">{w}</li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-muted-foreground">
                    This doesn't block applying the prompt, but a mismatched use case is a common cause of wrong-domain generations.
                  </p>
                </div>
              )}

              {/* Overwrite / diff gating */}
              {hasExistingPrompt && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-medium text-amber-300">Your System Prompt already has content</span>
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setShowDiff(v => !v)}>
                      {showDiff ? "Hide diff" : "Show diff"}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Using this prompt will replace the existing content.
                  </p>
                </div>
              )}

              <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
                <div className="max-h-[420px] overflow-y-auto p-4">
                  {showDiff && diffParts ? (
                    <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed">
                      {diffParts.map((part, i) => (
                        <span
                          key={i}
                          className={cn(
                            part.added && "bg-emerald-500/20 text-emerald-300",
                            part.removed && "bg-red-500/20 text-red-300 line-through",
                            !part.added && !part.removed && "text-foreground/60",
                          )}
                        >
                          {part.value}
                        </span>
                      ))}
                    </pre>
                  ) : (
                    <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed text-foreground/90">
                      {generatedPrompt}
                    </pre>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Review the prompt above. Click <strong>Use this prompt</strong> to insert it into the editor, or <strong>Adjust &amp; Regenerate</strong> to try again.
              </p>
            </div>
          )}

          {/* ── Phase: error ────────────────────────────────────────────── */}
          {phase === "error" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-red-400">
                    {errorReason === "no_foundation"
                      ? "Foundation template not configured"
                      : errorReason === "no_domain"
                        ? "Use case template unavailable"
                        : "Generation failed"}
                  </p>
                  <p className="text-xs text-muted-foreground">{errorMsg}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                This was a generation error on our side — your inputs are fine. You can try again, or write the prompt manually.
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
                Adjust &amp; Regenerate
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

            {/* Use this prompt — shown in preview; blocked until guardrails pass */}
            {phase === "preview" && (
              <Button size="sm" onClick={handleApply} disabled={applyBlocked}>
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                {applyBlocked
                  ? "Fix guardrails to continue"
                  : hasExistingPrompt ? "Replace & use prompt" : "Use this prompt"}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
