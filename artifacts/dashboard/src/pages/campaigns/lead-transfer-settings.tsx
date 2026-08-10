/**
 * Campaign lead transfer: pick dispositions + webhook or Google Sheets destination.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, type CampaignLeadTransfer } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Loader2, Webhook, Sheet } from "lucide-react";

export type LeadTransferForm = {
  enabled: boolean;
  dispositions: string[];
  destination: "webhook" | "google_sheets";
  webhookUrl: string;
  webhookSecret: string;
  connectionId: string;
  spreadsheetId: string;
  sheetName: string;
};

export const EMPTY_LEAD_TRANSFER: LeadTransferForm = {
  enabled: false,
  dispositions: [],
  destination: "webhook",
  webhookUrl: "",
  webhookSecret: "",
  connectionId: "",
  spreadsheetId: "",
  sheetName: "Sheet1",
};

export function readLeadTransfer(raw: CampaignLeadTransfer | null | undefined): LeadTransferForm {
  if (!raw) return { ...EMPTY_LEAD_TRANSFER };
  return {
    enabled: raw.enabled === true,
    dispositions: Array.isArray(raw.dispositions) ? [...raw.dispositions] : [],
    destination: raw.destination === "google_sheets" ? "google_sheets" : "webhook",
    webhookUrl: typeof raw.webhookUrl === "string" ? raw.webhookUrl : "",
    webhookSecret: typeof raw.webhookSecret === "string" ? raw.webhookSecret : "",
    connectionId: typeof raw.connectionId === "string" ? raw.connectionId : "",
    spreadsheetId: typeof raw.spreadsheetId === "string" ? raw.spreadsheetId : "",
    sheetName: typeof raw.sheetName === "string" && raw.sheetName.trim() ? raw.sheetName : "Sheet1",
  };
}

export function toLeadTransferPayload(form: LeadTransferForm): CampaignLeadTransfer | null {
  if (!form.enabled) {
    return { enabled: false, dispositions: [], destination: "webhook" };
  }
  const dispositions = form.dispositions.map((d) => d.trim()).filter(Boolean);
  if (!dispositions.length) return null;
  if (form.destination === "webhook") {
    if (!form.webhookUrl.trim().startsWith("https://")) return null;
    return {
      enabled: true,
      dispositions,
      destination: "webhook",
      webhookUrl: form.webhookUrl.trim(),
      ...(form.webhookSecret.trim() ? { webhookSecret: form.webhookSecret.trim() } : {}),
    };
  }
  if (!form.connectionId.trim() || !form.spreadsheetId.trim()) return null;
  return {
    enabled: true,
    dispositions,
    destination: "google_sheets",
    connectionId: form.connectionId.trim(),
    spreadsheetId: form.spreadsheetId.trim(),
    sheetName: form.sheetName.trim() || "Sheet1",
  };
}

export function leadTransferReady(form: LeadTransferForm): boolean {
  if (!form.enabled) return true;
  return toLeadTransferPayload(form) != null;
}

type SheetConn = { id: string; email: string };
type Spreadsheet = { id: string; name: string };
type SheetTab = { title: string };

export function LeadTransferSettings({
  agentId,
  value,
  onChange,
  compact,
}: {
  agentId: number | null;
  value: LeadTransferForm;
  onChange: (next: LeadTransferForm) => void;
  compact?: boolean;
}) {
  const set = (patch: Partial<LeadTransferForm>) => onChange({ ...value, ...patch });

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

  const { data: connections = [], isLoading: connLoading } = useQuery({
    queryKey: ["sheets-connections"],
    queryFn: () =>
      customFetch<SheetConn[]>("/api/sheets/google/connections"),
    enabled: value.enabled && value.destination === "google_sheets",
    staleTime: 30_000,
  });

  const { data: spreadsheets = [], isLoading: ssLoading } = useQuery({
    queryKey: ["sheets-spreadsheets", value.connectionId],
    queryFn: () =>
      customFetch<Spreadsheet[]>(
        `/api/sheets/google/connections/${value.connectionId}/spreadsheets`,
      ),
    enabled:
      value.enabled &&
      value.destination === "google_sheets" &&
      !!value.connectionId,
    staleTime: 30_000,
  });

  const { data: tabs = [] } = useQuery({
    queryKey: ["sheets-tabs", value.connectionId, value.spreadsheetId],
    queryFn: () =>
      customFetch<SheetTab[]>(
        `/api/sheets/google/connections/${value.connectionId}/spreadsheets/${value.spreadsheetId}/tabs`,
      ),
    enabled:
      value.enabled &&
      value.destination === "google_sheets" &&
      !!value.connectionId &&
      !!value.spreadsheetId,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!value.enabled) return;
    // Drop selected dispositions that no longer exist on the agent.
    if (!dispositionOptions.length) return;
    const next = value.dispositions.filter((d) => dispositionOptions.includes(d));
    if (next.length !== value.dispositions.length) set({ dispositions: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync when taxonomy changes
  }, [dispositionOptions.join("|")]);

  function toggleDisposition(key: string) {
    const has = value.dispositions.includes(key);
    set({
      dispositions: has
        ? value.dispositions.filter((d) => d !== key)
        : [...value.dispositions, key],
    });
  }

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      <div>
        <h3 className="text-sm font-semibold mb-0.5">Transfer leads</h3>
        <p className="text-xs text-muted-foreground/60 leading-relaxed">
          After each campaign call, send matching dispositions to your CRM webhook or a Google Sheet.
        </p>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5">
        <span>
          <span className="block text-[13px] font-medium">Enable lead transfer</span>
          <span className="block text-[11px] text-muted-foreground">
            Only campaign calls — not inbound/webcall
          </span>
        </span>
        <Switch
          checked={value.enabled}
          onCheckedChange={(v) => set({ enabled: v })}
        />
      </label>

      {value.enabled && (
        <>
          <div className="space-y-2">
            <Label className="text-xs">Which dispositions to transfer</Label>
            {!agentId ? (
              <p className="text-[11px] text-muted-foreground">Pick an agent first.</p>
            ) : dispLoading ? (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading dispositions…
              </div>
            ) : dispositionOptions.length === 0 ? (
              <p className="text-[11px] text-amber-600">
                This agent has no dispositions yet. Configure them in the Agent Builder → Outcomes.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto rounded-lg border border-border/50 p-2">
                {dispositionOptions.map((d) => {
                  const on = value.dispositions.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDisposition(d)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors",
                        on
                          ? "bg-foreground text-background border-foreground"
                          : "bg-muted/40 text-muted-foreground border-border hover:border-foreground/30",
                      )}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            )}
            {value.enabled && value.dispositions.length === 0 && dispositionOptions.length > 0 && (
              <p className="text-[10px] text-destructive">Select at least one disposition.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Destination</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => set({ destination: "webhook" })}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-3 text-left transition-all",
                  value.destination === "webhook"
                    ? "border-foreground bg-foreground/5 ring-1 ring-foreground"
                    : "border-border hover:bg-muted/30",
                )}
              >
                <Webhook className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  <span className="block text-[12px] font-medium">CRM webhook</span>
                  <span className="block text-[10px] text-muted-foreground mt-0.5">
                    Zapier, Make, n8n, or any CRM URL
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => set({ destination: "google_sheets" })}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-3 text-left transition-all",
                  value.destination === "google_sheets"
                    ? "border-foreground bg-foreground/5 ring-1 ring-foreground"
                    : "border-border hover:bg-muted/30",
                )}
              >
                <Sheet className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  <span className="block text-[12px] font-medium">Google Sheets</span>
                  <span className="block text-[10px] text-muted-foreground mt-0.5">
                    Append a row per matching lead
                  </span>
                </span>
              </button>
            </div>
          </div>

          {value.destination === "webhook" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Webhook URL (HTTPS)</Label>
                <Input
                  type="url"
                  placeholder="https://hooks.zapier.com/…"
                  value={value.webhookUrl}
                  onChange={(e) => set({ webhookUrl: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Signing secret <span className="text-muted-foreground/50">(optional)</span>
                </Label>
                <Input
                  type="text"
                  placeholder="HMAC secret for X-SnapServe-Signature"
                  value={value.webhookSecret}
                  onChange={(e) => set({ webhookSecret: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Google account</Label>
                {connLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : connections.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Connect Google Sheets under Connections first.
                  </p>
                ) : (
                  <Select
                    value={value.connectionId || undefined}
                    onValueChange={(v) =>
                      set({ connectionId: v, spreadsheetId: "", sheetName: "Sheet1" })
                    }
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Choose connection…" />
                    </SelectTrigger>
                    <SelectContent>
                      {connections.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {value.connectionId && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Spreadsheet</Label>
                  {ssLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : (
                    <Select
                      value={value.spreadsheetId || undefined}
                      onValueChange={(v) => set({ spreadsheetId: v, sheetName: "Sheet1" })}
                    >
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Choose spreadsheet…" />
                      </SelectTrigger>
                      <SelectContent>
                        {spreadsheets.map((s) => (
                          <SelectItem key={s.id} value={s.id} className="text-xs">
                            {s.name || s.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
              {value.spreadsheetId && tabs.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Sheet tab</Label>
                  <Select
                    value={value.sheetName || "Sheet1"}
                    onValueChange={(v) => set({ sheetName: v })}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {tabs.map((t) => (
                        <SelectItem key={t.title} value={t.title} className="text-xs">
                          {t.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
