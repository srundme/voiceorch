/**
 * Suggest a starter — NL → draft lead source + starter steps (not a full plan compiler).
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Loader2, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import { LEAD_SOURCES, leadSourceById, type LeadSourceId } from "./lead-sources";
import {
  CALL_PLAN_TEMPLATES,
  stepsForTemplate,
  type CallPlanTemplateId,
} from "./step-editor";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API = `${_DASH_BASE}/api`;

type Agent = { id: number; name: string };

type VibeDraft = {
  name: string;
  leadSource: LeadSourceId;
  templateId: CallPlanTemplateId;
  sheetRunMode: "once" | "live";
  summary: string;
  usedModel?: boolean;
};

type CallPlan = {
  id: number;
  agentId: number;
  name: string;
};

const EXAMPLES = [
  "Call unanswered sheet leads, WhatsApp, wait a day, call again",
  "Website form leads — call, then callback if they miss",
  "Soft nudge on pasted numbers with WhatsApp follow-up",
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: Agent[];
  defaultAgentId?: string;
  onCreated: (plan: CallPlan) => void;
};

export function PlanVibeDialog({ open, onOpenChange, agents, defaultAgentId, onCreated }: Props) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState(defaultAgentId ?? "");
  const [draft, setDraft] = useState<VibeDraft | null>(null);

  const draftMut = useMutation({
    mutationFn: (text: string) =>
      customFetch<VibeDraft>(`${DASH_API}/journeys/vibe-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      }),
    onSuccess: (d) => setDraft(d),
    onError: (err) => {
      toast({ title: "Could not draft", description: formatApiError(err), variant: "destructive" });
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Draft first");
      const aid = Number(agentId);
      if (!Number.isFinite(aid) || aid <= 0) throw new Error("Pick an agent who will talk");
      const src = leadSourceById(draft.leadSource);
      const tpl = CALL_PLAN_TEMPLATES.find((t) => t.id === draft.templateId) ?? CALL_PLAN_TEMPLATES[0]!;
      return customFetch<CallPlan>(`${DASH_API}/journeys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: aid,
          presetId: "custom",
          name: draft.name.trim() || `${src.title} plan`,
          description: draft.summary || tpl.blurb,
          trigger: { type: src.triggerType },
          steps: stepsForTemplate(draft.templateId, aid),
          settings: {
            peopleSource: src.peopleSource,
            runMode: src.id === "sheet" ? draft.sheetRunMode : src.runMode,
            leadSource: src.id,
          },
        }),
      });
    },
    onSuccess: (plan) => {
      setPrompt("");
      setDraft(null);
      onOpenChange(false);
      onCreated(plan);
    },
    onError: (err) => {
      toast({ title: "Could not create plan", description: formatApiError(err), variant: "destructive" });
    },
  });

  function resetAndClose(next: boolean) {
    if (!next) {
      setPrompt("");
      setDraft(null);
    } else if (!agentId && (defaultAgentId || agents[0])) {
      setAgentId(defaultAgentId || String(agents[0]!.id));
    }
    onOpenChange(next);
  }

  const tplTitle = CALL_PLAN_TEMPLATES.find((t) => t.id === draft?.templateId)?.title;
  const srcTitle = draft ? leadSourceById(draft.leadSource).title : "";

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            Suggest a starter
          </DialogTitle>
          <DialogDescription>
            Describe who to reach and what should happen. We pick a starter timeline you can edit on the plan — not a free-form compiler.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Agent who talks</Label>
            <Select value={agentId || undefined} onValueChange={setAgentId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Choose agent…" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!draft ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="plan-vibe-prompt">What should happen?</Label>
                <Textarea
                  id="plan-vibe-prompt"
                  rows={4}
                  className="text-sm resize-none"
                  placeholder="e.g. Call my Google Sheet leads. If no answer, WhatsApp and try again tomorrow."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) {
                      draftMut.mutate(prompt.trim());
                    }
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setPrompt(ex)}
                    className="rounded-full border border-border/60 px-2.5 py-1 text-[10px] text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3.5">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                I’ll set this up as <span className="font-medium text-foreground">{tplTitle}</span>
                {" "}and you can adjust steps and branches on the plan after.
              </p>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Plan name</Label>
                <Input
                  className="h-9"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed">{draft.summary}</p>
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-md border border-border/60 bg-background px-2 py-1">
                  Leads: {srcTitle}
                </span>
                <span className="rounded-md border border-border/60 bg-background px-2 py-1">
                  Starter: {tplTitle}
                </span>
                {draft.leadSource === "sheet" && (
                  <span className="rounded-md border border-border/60 bg-background px-2 py-1">
                    {draft.sheetRunMode === "live" ? "Drip new rows" : "Drain this list"}
                  </span>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Lead source</Label>
                  <Select
                    value={draft.leadSource}
                    onValueChange={(v) => {
                      const id = v as LeadSourceId;
                      const src = leadSourceById(id);
                      setDraft({
                        ...draft,
                        leadSource: id,
                        templateId: src.defaultTemplate,
                        sheetRunMode: id === "sheet" ? draft.sheetRunMode : "once",
                      });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LEAD_SOURCES.map((s) => (
                        <SelectItem key={s.id} value={s.id} className="text-xs">{s.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Starter</Label>
                  <Select
                    value={draft.templateId}
                    onValueChange={(v) => setDraft({ ...draft, templateId: v as CallPlanTemplateId })}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CALL_PLAN_TEMPLATES.map((t) => (
                        <SelectItem key={t.id} value={t.id} className="text-xs">{t.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {draft.leadSource === "sheet" && (
                <div className="grid grid-cols-2 gap-2">
                  {(["once", "live"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setDraft({ ...draft, sheetRunMode: mode })}
                      className={cn(
                        "rounded-lg border px-2.5 py-2 text-left text-[11px]",
                        draft.sheetRunMode === mode
                          ? "border-primary/40 bg-primary/5 font-medium"
                          : "border-border/50 hover:bg-muted/30",
                      )}
                    >
                      {mode === "once" ? "Drain this list" : "Drip new rows"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {draft ? (
            <>
              <Button
                variant="ghost"
                disabled={createMut.isPending}
                onClick={() => setDraft(null)}
              >
                Edit prompt
              </Button>
              <Button
                className="gap-1.5"
                disabled={createMut.isPending || !agentId}
                onClick={() => createMut.mutate()}
              >
                {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                Open plan
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => resetAndClose(false)} disabled={draftMut.isPending}>
                Cancel
              </Button>
              <Button
                className="gap-1.5"
                disabled={draftMut.isPending || !prompt.trim() || !agentId}
                onClick={() => draftMut.mutate(prompt.trim())}
              >
                {draftMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Suggest
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
