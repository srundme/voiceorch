/**
 * Disposition-branched after-call actions: WhatsApp / email / webhook.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, type AfterCallBranch } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, Plus, Trash2 } from "lucide-react";

export type AfterCallBranchForm = {
  id: string;
  dispositions: string[];
  actions: Array<"whatsapp" | "email" | "webhook">;
  webhookUrl: string;
};

export function readAfterCallBranches(raw: AfterCallBranch[] | null | undefined): AfterCallBranchForm[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => ({
    id: b.id || crypto.randomUUID(),
    dispositions: Array.isArray(b.dispositions) ? [...b.dispositions] : [],
    actions: (b.actions ?? []).filter(
      (a): a is "whatsapp" | "email" | "webhook" =>
        a === "whatsapp" || a === "email" || a === "webhook",
    ),
    webhookUrl: typeof b.webhookUrl === "string" ? b.webhookUrl : "",
  }));
}

export function toAfterCallBranchesPayload(forms: AfterCallBranchForm[]): AfterCallBranch[] | null {
  if (!forms.length) return null;
  const out: AfterCallBranch[] = [];
  for (const f of forms) {
    if (!f.dispositions.length || !f.actions.length) continue;
    if (f.actions.includes("webhook") && !f.webhookUrl.trim().startsWith("https://")) continue;
    out.push({
      id: f.id || crypto.randomUUID(),
      dispositions: f.dispositions,
      actions: f.actions,
      ...(f.actions.includes("webhook") ? { webhookUrl: f.webhookUrl.trim() } : {}),
    });
  }
  return out.length ? out : null;
}

export function afterCallBranchesReady(forms: AfterCallBranchForm[]): boolean {
  if (!forms.length) return true;
  return toAfterCallBranchesPayload(forms) != null && forms.every((f) => {
    if (!f.dispositions.length || !f.actions.length) return false;
    if (f.actions.includes("webhook") && !f.webhookUrl.trim().startsWith("https://")) return false;
    return true;
  });
}

function newBranch(): AfterCallBranchForm {
  return {
    id: crypto.randomUUID(),
    dispositions: [],
    actions: ["whatsapp"],
    webhookUrl: "",
  };
}

const ACTION_OPTS: Array<{ id: "whatsapp" | "email" | "webhook"; label: string }> = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "Email" },
  { id: "webhook", label: "Webhook" },
];

export function AfterCallBranchesSettings({
  agentId,
  value,
  onChange,
}: {
  agentId: number | null;
  value: AfterCallBranchForm[];
  onChange: (next: AfterCallBranchForm[]) => void;
}) {
  const { data: dispCfg, isLoading: dispLoading } = useQuery({
    queryKey: ["disposition-config", agentId],
    queryFn: async () => {
      try {
        return await customFetch<{ taxonomy: Record<string, string[]> }>(
          `/api/disposition/config/${agentId}`,
        );
      } catch {
        return null;
      }
    },
    enabled: !!agentId,
    staleTime: 60_000,
  });

  const dispositionOptions = useMemo(() => {
    const tax = dispCfg?.taxonomy;
    if (!tax) return [] as string[];
    const out: string[] = [];
    for (const [primary, subs] of Object.entries(tax)) {
      out.push(primary);
      for (const sub of subs ?? []) {
        if (sub && sub !== primary) out.push(`${primary}:${sub}`);
      }
    }
    return out;
  }, [dispCfg]);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold mb-0.5">After-call branches</h3>
        <p className="text-xs text-muted-foreground/60 leading-relaxed">
          If disposition matches, run WhatsApp, email, and/or a webhook. When empty, WhatsApp post-call stays always-on (if configured).
        </p>
      </div>

      {value.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No branches — legacy WhatsApp notify still runs when enabled on the channel.</p>
      ) : (
        value.map((branch, idx) => (
          <div key={branch.id} className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Branch {idx + 1}</Label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onChange(value.filter((_, i) => i !== idx))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">When disposition is</Label>
              {!agentId ? (
                <p className="text-[11px] text-muted-foreground">Pick an agent first.</p>
              ) : dispLoading ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto rounded-lg border border-border/50 p-2">
                  {dispositionOptions.map((d) => {
                    const on = branch.dispositions.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          const next = [...value];
                          const dispositions = on
                            ? branch.dispositions.filter((x) => x !== d)
                            : [...branch.dispositions, d];
                          next[idx] = { ...branch, dispositions };
                          onChange(next);
                        }}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors",
                          on
                            ? "bg-foreground text-background border-foreground"
                            : "bg-muted/40 text-muted-foreground border-border",
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {ACTION_OPTS.map((a) => {
                const on = branch.actions.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      const next = [...value];
                      const actions = on
                        ? branch.actions.filter((x) => x !== a.id)
                        : [...branch.actions, a.id];
                      next[idx] = { ...branch, actions };
                      onChange(next);
                    }}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-medium border",
                      on
                        ? "bg-foreground text-background border-foreground"
                        : "bg-muted/40 text-muted-foreground border-border",
                    )}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>

            {branch.actions.includes("webhook") && (
              <Input
                type="url"
                className="h-9 text-xs"
                placeholder="https://…"
                value={branch.webhookUrl}
                onChange={(e) => {
                  const next = [...value];
                  next[idx] = { ...branch, webhookUrl: e.target.value };
                  onChange(next);
                }}
              />
            )}
          </div>
        ))
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 text-xs gap-1.5"
        onClick={() => onChange([...value, newBranch()])}
      >
        <Plus className="h-3.5 w-3.5" /> Add branch
      </Button>
    </div>
  );
}
