/**
 * Per-agent WhatsApp template pickers (default + three outcomes).
 * Used in Builder Channels and can share option JSON with /app/whatsapp.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${_DASH_BASE}/api`;

export type WaTplChoice = { name: string; language: string; paramCount: number };
export type WaCatalogEntry = {
  name: string;
  language: string;
  status: string;
  paramCount: number;
  category?: string | null;
};
export type AgentWaTemplates = {
  default?: WaTplChoice;
  call_summary?: WaTplChoice;
  booking_confirmed?: WaTplChoice;
  callback_scheduled?: WaTplChoice;
};

const SLOTS: Array<{ key: keyof AgentWaTemplates; label: string }> = [
  { key: "default", label: "Default (fallback)" },
  { key: "call_summary", label: "Call summary" },
  { key: "booking_confirmed", label: "Booking confirmed" },
  { key: "callback_scheduled", label: "Callback scheduled" },
];

function choiceValue(c: WaTplChoice | undefined): string {
  if (!c?.name || !c.language) return "";
  return JSON.stringify({ name: c.name, language: c.language, paramCount: c.paramCount ?? 0 });
}

function parseChoice(s: string): WaTplChoice | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s) as WaTplChoice;
    if (v?.name && v.language) return { name: v.name, language: v.language, paramCount: v.paramCount ?? 0 };
  } catch { /* ignore */ }
  return null;
}

function hasPicks(t: AgentWaTemplates): boolean {
  return SLOTS.some(({ key }) => {
    const v = t[key];
    return !!(v?.name && v.language);
  });
}

type Props = {
  agentId: number;
  /** Meta connection path — save via PATCH connection */
  connectionId?: string | null;
  initialTemplates?: AgentWaTemplates;
  initialCatalog?: WaCatalogEntry[];
  /** Native channel — save via PUT /whatsapp/agents/:id/templates */
  nativeMode?: boolean;
};

export function AgentWhatsappTemplatePicks({
  agentId,
  connectionId,
  initialTemplates,
  initialCatalog,
  nativeMode,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [slots, setSlots] = useState<Record<string, string>>(() => {
    const t = initialTemplates ?? {};
    return Object.fromEntries(SLOTS.map(({ key }) => [key, choiceValue(t[key])]));
  });

  const nativeQ = useQuery({
    queryKey: ["wa-agent-templates", agentId],
    enabled: !!nativeMode && !!agentId,
    queryFn: () => customFetch<{
      templates: AgentWaTemplates;
      templateCatalog: WaCatalogEntry[];
      needsTemplates: boolean;
    }>(`${API}/whatsapp/agents/${agentId}/templates`),
  });

  const catalog = useMemo(() => {
    if (nativeMode) return nativeQ.data?.templateCatalog ?? initialCatalog ?? [];
    return initialCatalog ?? [];
  }, [nativeMode, nativeQ.data?.templateCatalog, initialCatalog]);

  useEffect(() => {
    const t = nativeMode ? (nativeQ.data?.templates ?? {}) : (initialTemplates ?? {});
    setSlots(Object.fromEntries(SLOTS.map(({ key }) => [key, choiceValue(t[key])])));
  }, [nativeMode, nativeQ.data?.templates, initialTemplates]);

  const payload = (): AgentWaTemplates => {
    const out: AgentWaTemplates = {};
    for (const { key } of SLOTS) {
      const c = parseChoice(slots[key] ?? "");
      if (c) out[key] = c;
    }
    return out;
  };

  const save = useMutation({
    mutationFn: async () => {
      const templates = payload();
      if (nativeMode) {
        return customFetch(`${API}/whatsapp/agents/${agentId}/templates`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templates }),
        });
      }
      if (!connectionId) throw new Error("No WhatsApp connection for this agent");
      return customFetch(`${API}/whatsapp/connections/${connectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metaTemplates: templates }),
      });
    },
    onSuccess: () => {
      toast({ title: "Templates saved for this agent" });
      void qc.invalidateQueries({ queryKey: ["builder-whatsapp-connections", agentId] });
      void qc.invalidateQueries({ queryKey: ["wa-agent-templates", agentId] });
    },
    onError: (err) => {
      toast({ title: "Couldn’t save templates", description: formatApiError(err), variant: "destructive" });
    },
  });

  const refresh = useMutation({
    mutationFn: async () => {
      if (nativeMode) {
        await customFetch(`${API}/whatsapp/templates/sync`, { method: "POST" }).catch(() => null);
        return customFetch(`${API}/whatsapp/templates`);
      }
      if (!connectionId) throw new Error("Save the Meta connection first, then refresh templates");
      return customFetch(`${API}/whatsapp/meta/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
    },
    onSuccess: () => {
      toast({ title: "Templates refreshed" });
      void qc.invalidateQueries({ queryKey: ["builder-whatsapp-connections", agentId] });
      void qc.invalidateQueries({ queryKey: ["builder-whatsapp-channel", agentId] });
      void qc.invalidateQueries({ queryKey: ["wa-agent-templates", agentId] });
    },
    onError: (err) => {
      toast({ title: "Refresh failed", description: formatApiError(err), variant: "destructive" });
    },
  });

  const picks = payload();
  const needsTemplates = !hasPicks(picks);

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-medium">Templates for this agent</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Choose which approved WhatsApp templates this agent sends.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[11px] shrink-0"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          {refresh.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {needsTemplates && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
          Needs templates — pick at least a Default or Call summary before relying on WhatsApp sends.
        </div>
      )}

      {catalog.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No approved templates saved yet. Click Refresh, or finish connect on the WhatsApp page.
        </p>
      ) : (
        <div className="space-y-2">
          {SLOTS.map(({ key, label }) => {
            const value = slots[key] ?? "";
            const inList = value && catalog.some(
              (t) => choiceValue({ name: t.name, language: t.language, paramCount: t.paramCount }) === value,
            );
            let savedLabel = "";
            if (value && !inList) {
              const v = parseChoice(value);
              if (v) savedLabel = `${v.name} (${v.language}, saved)`;
            }
            return (
              <div key={key}>
                <Label className="text-[10px] text-muted-foreground">{label}</Label>
                <select
                  className="mt-1 w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={value}
                  onChange={(e) => setSlots((s) => ({ ...s, [key]: e.target.value }))}
                >
                  <option value="">— none —</option>
                  {savedLabel && <option value={value}>{savedLabel}</option>}
                  {catalog.map((t) => {
                    const opt = choiceValue({ name: t.name, language: t.language, paramCount: t.paramCount });
                    return (
                      <option key={`${t.name}|${t.language}`} value={opt}>
                        {t.name} ({t.language}, {t.paramCount} var{t.paramCount === 1 ? "" : "s"})
                      </option>
                    );
                  })}
                </select>
              </div>
            );
          })}
        </div>
      )}

      <Button
        type="button"
        size="sm"
        className="h-8 text-xs"
        disabled={save.isPending || catalog.length === 0}
        onClick={() => save.mutate()}
      >
        {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
        Save templates
      </Button>
    </div>
  );
}
