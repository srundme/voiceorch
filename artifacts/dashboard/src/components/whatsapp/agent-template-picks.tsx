/**
 * Per-agent WhatsApp template pickers (default + three outcomes).
 * Used in agent WhatsApp template picks and can share option JSON with /app/whatsapp.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${_DASH_BASE}/api`;

/** Where one {{n}} placeholder gets its value (mirrors AfterCallTemplateParam in @workspace/db). */
export type WaTplParamSource =
  | "auto" | "caller_name" | "agent_name" | "summary" | "phone" | "outcome"
  | "meeting_time" | "meet_link" | "field" | "text";
export type WaTplParam = { source: WaTplParamSource; key?: string; text?: string; fallback?: string };

/** params[i] fills {{i+1}}; only after-call messages use it today. */
export type WaTplChoice = { name: string; language: string; paramCount: number; params?: WaTplParam[] };
export type WaCatalogEntry = {
  name: string;
  language: string;
  status: string;
  paramCount: number;
  category?: string | null;
  bodyPreview?: string;
};
export type AgentWaTemplates = {
  default?: WaTplChoice;
  call_summary?: WaTplChoice;
  booking_confirmed?: WaTplChoice;
  callback_scheduled?: WaTplChoice;
};

/** SnapServe send-moments — each dropdown lists ANY approved template from your WABA. */
const SLOTS: Array<{ key: keyof AgentWaTemplates; label: string; hint: string }> = [
  { key: "default", label: "Default (any template)", hint: "Used when no other moment is mapped" },
  { key: "call_summary", label: "After a call", hint: "SnapServe moment — pick any of your Meta templates" },
  { key: "booking_confirmed", label: "After a booking", hint: "SnapServe moment — pick any of your Meta templates" },
  { key: "callback_scheduled", label: "After a callback is set", hint: "SnapServe moment — pick any of your Meta templates" },
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

type Props = {
  agentId: number;
  /** Meta connection path — save via PATCH connection */
  connectionId?: string | null;
  initialTemplates?: AgentWaTemplates;
  initialCatalog?: WaCatalogEntry[];
  /** Native channel — save via PUT /whatsapp/agents/:id/templates */
  nativeMode?: boolean;
  /** Limit which send-moments appear. Default: all four. */
  visibleSlots?: Array<keyof AgentWaTemplates>;
};

export function WhatsappTemplateSelect({
  catalog,
  value,
  onChange,
  emptyLabel = "— none —",
}: {
  catalog: WaCatalogEntry[];
  value: WaTplChoice | null | undefined;
  onChange: (next: WaTplChoice | null) => void;
  emptyLabel?: string;
}) {
  const selected = choiceValue(value ?? undefined);
  const inList = selected && catalog.some(
    (t) => choiceValue({ name: t.name, language: t.language, paramCount: t.paramCount }) === selected,
  );
  let savedLabel = "";
  if (selected && !inList) {
    const v = parseChoice(selected);
    if (v) savedLabel = `${v.name} (${v.language}, saved)`;
  }
  return (
    <select
      className="mt-1 w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
      value={selected}
      onChange={(e) => onChange(parseChoice(e.target.value))}
    >
      <option value="">{emptyLabel}</option>
      {savedLabel && <option value={selected}>{savedLabel}</option>}
      {catalog.map((t) => {
        const opt = choiceValue({ name: t.name, language: t.language, paramCount: t.paramCount });
        return (
          <option key={`${t.name}|${t.language}`} value={opt}>
            {t.name} ({t.language})
          </option>
        );
      })}
    </select>
  );
}

export function AgentWhatsappTemplatePicks({
  agentId,
  connectionId,
  initialTemplates,
  initialCatalog,
  nativeMode,
  visibleSlots,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const slotDefs = visibleSlots?.length
    ? SLOTS.filter((s) => visibleSlots.includes(s.key))
    : SLOTS;
  const [slots, setSlots] = useState<Record<string, string>>(() => {
    const t = initialTemplates ?? {};
    return Object.fromEntries(SLOTS.map(({ key }) => [key, choiceValue(t[key])]));
  });
  const [refreshedCatalog, setRefreshedCatalog] = useState<WaCatalogEntry[] | null>(null);

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
    const raw = refreshedCatalog && refreshedCatalog.length
      ? refreshedCatalog
      : nativeMode
        ? (nativeQ.data?.templateCatalog ?? initialCatalog ?? [])
        : (initialCatalog ?? []);
    return raw.filter((t) => t?.name && t.language);
  }, [nativeMode, nativeQ.data?.templateCatalog, initialCatalog, refreshedCatalog]);

  useEffect(() => {
    const t = nativeMode ? (nativeQ.data?.templates ?? {}) : (initialTemplates ?? {});
    setSlots(Object.fromEntries(SLOTS.map(({ key }) => [key, choiceValue(t[key])])));
  }, [nativeMode, nativeQ.data?.templates, initialTemplates]);

  const payloadFrom = (nextSlots: Record<string, string>): AgentWaTemplates => {
    const out: AgentWaTemplates = {};
    for (const { key } of SLOTS) {
      const c = parseChoice(nextSlots[key] ?? "");
      if (c) out[key] = c;
    }
    return out;
  };

  const save = useMutation({
    mutationFn: async (vars: { templates: AgentWaTemplates; silent?: boolean }) => {
      const templates = vars.templates;
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
    onSuccess: (_data, vars) => {
      if (!vars.silent) toast({ title: "Template saved" });
      void qc.invalidateQueries({ queryKey: ["builder-whatsapp-connections", agentId] });
      void qc.invalidateQueries({ queryKey: ["wa-agent-templates", agentId] });
    },
    onError: (err) => {
      toast({ title: "Couldn’t save templates", description: formatApiError(err), variant: "destructive" });
    },
  });

  const refresh = useMutation({
    mutationFn: async (): Promise<{ templateCatalog?: WaCatalogEntry[] }> => {
      if (nativeMode) {
        const syncErr = await customFetch(`${API}/whatsapp/templates/sync`, { method: "POST" })
          .then(() => null)
          .catch((err: unknown) => err);
        const listed = await customFetch<{ templateCatalog?: WaCatalogEntry[] }>(`${API}/whatsapp/templates`);
        const catalog = Array.isArray(listed.templateCatalog) ? listed.templateCatalog : [];
        if (!catalog.length && syncErr) throw syncErr;
        return listed;
      }
      if (!connectionId) throw new Error("Save the Meta connection first, then refresh templates");
      return customFetch<{ templateCatalog?: WaCatalogEntry[] }>(`${API}/whatsapp/meta/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
    },
    onSuccess: (data) => {
      const next = Array.isArray(data?.templateCatalog) ? data.templateCatalog : [];
      setRefreshedCatalog(next);
      toast({
        title: next.length
          ? `Loaded ${next.length} template${next.length === 1 ? "" : "s"}`
          : "No sendable templates found",
        description: next.length
          ? undefined
          : "They must be APPROVED in Meta. Recheck Phone Number ID + token (and WABA ID if you have it) on Connections, then Refresh.",
      });
      void qc.invalidateQueries({ queryKey: ["builder-whatsapp-connections", agentId] });
      void qc.invalidateQueries({ queryKey: ["builder-whatsapp-channel", agentId] });
      void qc.invalidateQueries({ queryKey: ["wa-agent-templates", agentId] });
    },
    onError: (err) => {
      toast({ title: "Refresh failed", description: formatApiError(err), variant: "destructive" });
    },
  });

  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current) return;
    if (nativeMode && nativeQ.isLoading) return;
    const existing = (nativeMode ? nativeQ.data?.templateCatalog : initialCatalog) ?? [];
    if (existing.length > 0) return;
    if (!nativeMode && !connectionId) return;
    autoTried.current = true;
    refresh.mutate();
    // Intentionally once on first empty catalog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeMode, nativeQ.isLoading, nativeQ.data?.templateCatalog, initialCatalog, connectionId]);

  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || !catalog.length) return;
    const current = parseChoice(slots.default ?? "");
    if (current?.name) {
      autoPicked.current = true;
      return;
    }
    const first = catalog[0]!;
    const next = choiceValue({ name: first.name, language: first.language, paramCount: first.paramCount });
    autoPicked.current = true;
    const nextSlots = { ...slots, default: next };
    setSlots(nextSlots);
    if (!nativeMode && !connectionId) return;
    save.mutate({ templates: payloadFrom(nextSlots), silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  const compact = visibleSlots?.length === 1 && visibleSlots[0] === "default";
  const defaultChoice = parseChoice(slots.default ?? "");

  const applySlot = (key: string, raw: string) => {
    setSlots((s) => ({ ...s, [key]: raw }));
  };

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {!compact && (
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[13px] font-medium">Templates for this agent</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Pick any approved Meta template into each send moment.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 text-[11px]"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? <Loader2 className="size-3 animate-spin" /> : "Refresh"}
          </Button>
        </div>
      )}

      {catalog.length === 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-muted-foreground">
            {refresh.isPending
              ? "Loading approved templates…"
              : "No approved templates yet. They must be APPROVED in Meta, then Refresh."}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 text-[11px]"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? <Loader2 className="size-3 animate-spin" /> : "Refresh"}
          </Button>
        </div>
      ) : compact ? (
        <div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-[11px] text-muted-foreground">Mid-call template</Label>
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              {refresh.isPending ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-[12px]"
            value={slots.default ?? ""}
            onChange={(e) => {
              const nextSlots = { ...slots, default: e.target.value };
              setSlots(nextSlots);
              save.mutate({ templates: payloadFrom(nextSlots) });
            }}
          >
            <option value="">Select a template</option>
            {defaultChoice && !catalog.some((t) => choiceValue({ name: t.name, language: t.language, paramCount: t.paramCount }) === (slots.default ?? "")) && (
              <option value={slots.default}>{defaultChoice.name} ({defaultChoice.language}, saved)</option>
            )}
            {catalog.map((t) => {
              const opt = choiceValue({ name: t.name, language: t.language, paramCount: t.paramCount });
              return (
                <option key={`${t.name}|${t.language}`} value={opt}>
                  {t.name} ({t.language})
                </option>
              );
            })}
          </select>
          {save.isPending && (
            <p className="mt-1 text-[10px] text-muted-foreground">Saving…</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {slotDefs.map(({ key, label, hint }) => {
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
                <p className="mb-0.5 text-[9px] text-muted-foreground/80">{hint}</p>
                <select
                  className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  value={value}
                  onChange={(e) => applySlot(key, e.target.value)}
                >
                  <option value="">— none —</option>
                  {savedLabel && <option value={value}>{savedLabel}</option>}
                  {catalog.map((t) => {
                    const opt = choiceValue({ name: t.name, language: t.language, paramCount: t.paramCount });
                    return (
                      <option key={`${t.name}|${t.language}`} value={opt}>
                        {t.name} ({t.language})
                      </option>
                    );
                  })}
                </select>
              </div>
            );
          })}
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            disabled={save.isPending}
            onClick={() => save.mutate({ templates: payloadFrom(slots) })}
          >
            {save.isPending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Save templates
          </Button>
        </div>
      )}
    </div>
  );
}
