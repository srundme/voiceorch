/**
 * Campaign lead transfer: multi-rule dispositions → webhook / Google Sheets,
 * optional field map, and replay of past matches.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, type CampaignLeadTransfer, type CampaignLeadTransferRule } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Loader2, Webhook, Sheet, Plus, Trash2, RefreshCw } from "lucide-react";

export type LeadTransferRuleForm = {
  id: string;
  name: string;
  dispositions: string[];
  destination: "webhook" | "google_sheets";
  webhookUrl: string;
  webhookSecret: string;
  connectionId: string;
  spreadsheetId: string;
  sheetName: string;
  /** SnapServe field → destination key/column */
  fieldMapText: string;
};

export type LeadTransferForm = {
  enabled: boolean;
  rules: LeadTransferRuleForm[];
};

function newRule(): LeadTransferRuleForm {
  return {
    id: crypto.randomUUID(),
    name: "",
    dispositions: [],
    destination: "webhook",
    webhookUrl: "",
    webhookSecret: "",
    connectionId: "",
    spreadsheetId: "",
    sheetName: "Sheet1",
    fieldMapText: "",
  };
}

export const EMPTY_LEAD_TRANSFER: LeadTransferForm = {
  enabled: false,
  rules: [newRule()],
};

function parseFieldMapText(text: string): Record<string, string> | undefined {
  const fm: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const eq = t.indexOf("=");
    const colon = t.indexOf(":");
    const sep = eq >= 0 ? eq : colon;
    if (sep < 0) continue;
    const k = t.slice(0, sep).trim();
    const v = t.slice(sep + 1).trim();
    if (k && v) fm[k] = v;
  }
  return Object.keys(fm).length ? fm : undefined;
}

function fieldMapToText(fm?: Record<string, string> | null): string {
  if (!fm) return "";
  return Object.entries(fm)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function ruleFromApi(r: CampaignLeadTransferRule): LeadTransferRuleForm {
  return {
    id: r.id || crypto.randomUUID(),
    name: typeof r.name === "string" ? r.name : "",
    dispositions: Array.isArray(r.dispositions) ? [...r.dispositions] : [],
    destination: r.destination === "google_sheets" ? "google_sheets" : "webhook",
    webhookUrl: typeof r.webhookUrl === "string" ? r.webhookUrl : "",
    webhookSecret: typeof r.webhookSecret === "string" ? r.webhookSecret : "",
    connectionId: typeof r.connectionId === "string" ? r.connectionId : "",
    spreadsheetId: typeof r.spreadsheetId === "string" ? r.spreadsheetId : "",
    sheetName: typeof r.sheetName === "string" && r.sheetName.trim() ? r.sheetName : "Sheet1",
    fieldMapText: fieldMapToText(r.fieldMap as Record<string, string> | undefined),
  };
}

export function readLeadTransfer(raw: CampaignLeadTransfer | null | undefined): LeadTransferForm {
  if (!raw) return { ...EMPTY_LEAD_TRANSFER, rules: [newRule()] };
  if (Array.isArray(raw.rules) && raw.rules.length) {
    return {
      enabled: raw.enabled === true,
      rules: raw.rules.map(ruleFromApi),
    };
  }
  // Legacy single-rule
  return {
    enabled: raw.enabled === true,
    rules: [
      ruleFromApi({
        id: "default",
        dispositions: Array.isArray(raw.dispositions) ? raw.dispositions : [],
        destination: raw.destination === "google_sheets" ? "google_sheets" : "webhook",
        webhookUrl: raw.webhookUrl,
        webhookSecret: raw.webhookSecret,
        connectionId: raw.connectionId,
        spreadsheetId: raw.spreadsheetId,
        sheetName: raw.sheetName,
        fieldMap: raw.fieldMap as Record<string, string> | undefined,
      }),
    ],
  };
}

function ruleReady(rule: LeadTransferRuleForm): boolean {
  if (!rule.dispositions.length) return false;
  if (rule.destination === "webhook") return rule.webhookUrl.trim().startsWith("https://");
  return !!rule.connectionId.trim() && !!rule.spreadsheetId.trim();
}

export function toLeadTransferPayload(form: LeadTransferForm): CampaignLeadTransfer | null {
  if (!form.enabled) {
    return { enabled: false, dispositions: [], destination: "webhook", rules: [] };
  }
  const rules: CampaignLeadTransferRule[] = [];
  for (const r of form.rules) {
    if (!ruleReady(r)) return null;
    const fieldMap = parseFieldMapText(r.fieldMapText);
    const rule: CampaignLeadTransferRule = {
      id: r.id || crypto.randomUUID(),
      dispositions: r.dispositions.map((d) => d.trim()).filter(Boolean),
      destination: r.destination,
      ...(r.name.trim() ? { name: r.name.trim() } : {}),
      ...(fieldMap ? { fieldMap } : {}),
    };
    if (r.destination === "webhook") {
      rule.webhookUrl = r.webhookUrl.trim();
      if (r.webhookSecret.trim()) rule.webhookSecret = r.webhookSecret.trim();
    } else {
      rule.connectionId = r.connectionId.trim();
      rule.spreadsheetId = r.spreadsheetId.trim();
      rule.sheetName = r.sheetName.trim() || "Sheet1";
    }
    rules.push(rule);
  }
  if (!rules.length) return null;
  // Keep legacy top-level fields from first rule for older readers
  const first = rules[0]!;
  return {
    enabled: true,
    rules,
    dispositions: first.dispositions,
    destination: first.destination,
    webhookUrl: first.webhookUrl,
    webhookSecret: first.webhookSecret,
    connectionId: first.connectionId,
    spreadsheetId: first.spreadsheetId,
    sheetName: first.sheetName,
    fieldMap: first.fieldMap,
  };
}

export function leadTransferReady(form: LeadTransferForm): boolean {
  if (!form.enabled) return true;
  return toLeadTransferPayload(form) != null;
}

type SheetConn = { id: string; email: string };
type Spreadsheet = { id: string; name: string };
type SheetTab = { title: string };

function DispositionChips({
  options,
  selected,
  onToggle,
  loading,
  agentId,
}: {
  options: string[];
  selected: string[];
  onToggle: (key: string) => void;
  loading: boolean;
  agentId: number | null;
}) {
  if (!agentId) return <p className="text-[11px] text-muted-foreground">Pick an agent first.</p>;
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading dispositions…
      </div>
    );
  }
  if (!options.length) {
    return (
      <p className="text-[11px] text-amber-600">
        This agent has no dispositions yet. Configure them in the Agent Builder → Outcomes.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto rounded-lg border border-border/50 p-2">
      {options.map((d) => {
        const on = selected.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => onToggle(d)}
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
  );
}

function RuleEditor({
  rule,
  onChange,
  onRemove,
  canRemove,
  dispositionOptions,
  dispLoading,
  agentId,
}: {
  rule: LeadTransferRuleForm;
  onChange: (next: LeadTransferRuleForm) => void;
  onRemove: () => void;
  canRemove: boolean;
  dispositionOptions: string[];
  dispLoading: boolean;
  agentId: number | null;
}) {
  const set = (patch: Partial<LeadTransferRuleForm>) => onChange({ ...rule, ...patch });

  const { data: connections = [], isLoading: connLoading } = useQuery({
    queryKey: ["sheets-connections"],
    queryFn: () => customFetch<SheetConn[]>("/api/sheets/google/connections"),
    enabled: rule.destination === "google_sheets",
    staleTime: 30_000,
  });

  const { data: spreadsheets = [], isLoading: ssLoading } = useQuery({
    queryKey: ["sheets-spreadsheets", rule.connectionId],
    queryFn: () =>
      customFetch<Spreadsheet[]>(
        `/api/sheets/google/connections/${rule.connectionId}/spreadsheets`,
      ),
    enabled: rule.destination === "google_sheets" && !!rule.connectionId,
    staleTime: 30_000,
  });

  const { data: tabs = [] } = useQuery({
    queryKey: ["sheets-tabs", rule.connectionId, rule.spreadsheetId],
    queryFn: () =>
      customFetch<SheetTab[]>(
        `/api/sheets/google/connections/${rule.connectionId}/spreadsheets/${rule.spreadsheetId}/tabs`,
      ),
    enabled:
      rule.destination === "google_sheets" &&
      !!rule.connectionId &&
      !!rule.spreadsheetId,
    staleTime: 30_000,
  });

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Input
          className="h-8 text-xs flex-1"
          placeholder="Rule name (optional)"
          value={rule.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        {canRemove && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Dispositions</Label>
        <DispositionChips
          options={dispositionOptions}
          selected={rule.dispositions}
          loading={dispLoading}
          agentId={agentId}
          onToggle={(key) => {
            const has = rule.dispositions.includes(key);
            set({
              dispositions: has
                ? rule.dispositions.filter((d) => d !== key)
                : [...rule.dispositions, key],
            });
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => set({ destination: "webhook" })}
          className={cn(
            "flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all",
            rule.destination === "webhook"
              ? "border-foreground bg-foreground/5 ring-1 ring-foreground"
              : "border-border hover:bg-muted/30",
          )}
        >
          <Webhook className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="block text-[12px] font-medium">CRM webhook</span>
        </button>
        <button
          type="button"
          onClick={() => set({ destination: "google_sheets" })}
          className={cn(
            "flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all",
            rule.destination === "google_sheets"
              ? "border-foreground bg-foreground/5 ring-1 ring-foreground"
              : "border-border hover:bg-muted/30",
          )}
        >
          <Sheet className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="block text-[12px] font-medium">Google Sheets</span>
        </button>
      </div>

      {rule.destination === "webhook" ? (
        <div className="space-y-2">
          <Input
            type="url"
            placeholder="https://hooks.zapier.com/…"
            value={rule.webhookUrl}
            onChange={(e) => set({ webhookUrl: e.target.value })}
            className="h-9 text-xs"
          />
          <Input
            type="text"
            placeholder="HMAC secret (optional)"
            value={rule.webhookSecret}
            onChange={(e) => set({ webhookSecret: e.target.value })}
            className="h-9 text-xs"
          />
        </div>
      ) : (
        <div className="space-y-2">
          {connLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : connections.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Connect Google Sheets under Connections first.</p>
          ) : (
            <Select
              value={rule.connectionId || undefined}
              onValueChange={(v) => set({ connectionId: v, spreadsheetId: "", sheetName: "Sheet1" })}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Choose connection…" />
              </SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">{c.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {rule.connectionId && (
            ssLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <Select
                value={rule.spreadsheetId || undefined}
                onValueChange={(v) => set({ spreadsheetId: v, sheetName: "Sheet1" })}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Choose spreadsheet…" />
                </SelectTrigger>
                <SelectContent>
                  {spreadsheets.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">{s.name || s.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          )}
          {rule.spreadsheetId && tabs.length > 0 && (
            <Select value={rule.sheetName || "Sheet1"} onValueChange={(v) => set({ sheetName: v })}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tabs.map((t) => (
                  <SelectItem key={t.title} value={t.title} className="text-xs">{t.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">
          Field map <span className="text-muted-foreground/50">(optional, one per line: phone=Phone)</span>
        </Label>
        <textarea
          className="w-full min-h-[64px] rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-mono"
          placeholder={"phone=Phone\nname=Full Name\ndisposition=Status"}
          value={rule.fieldMapText}
          onChange={(e) => set({ fieldMapText: e.target.value })}
        />
      </div>
    </div>
  );
}

export function LeadTransferSettings({
  agentId,
  campaignId,
  value,
  onChange,
  compact,
}: {
  agentId: number | null;
  campaignId?: number | null;
  value: LeadTransferForm;
  onChange: (next: LeadTransferForm) => void;
  compact?: boolean;
}) {
  const set = (patch: Partial<LeadTransferForm>) => onChange({ ...value, ...patch });
  const [replaying, setReplaying] = useState(false);
  const [replayMsg, setReplayMsg] = useState<string | null>(null);

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

  useEffect(() => {
    if (!value.enabled || !dispositionOptions.length) return;
    let changed = false;
    const nextRules = value.rules.map((r) => {
      const next = r.dispositions.filter((d) => dispositionOptions.includes(d));
      if (next.length !== r.dispositions.length) {
        changed = true;
        return { ...r, dispositions: next };
      }
      return r;
    });
    if (changed) set({ rules: nextRules });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispositionOptions.join("|")]);

  async function handleReplay() {
    if (!campaignId) return;
    setReplaying(true);
    setReplayMsg(null);
    try {
      const result = await customFetch<{
        scanned: number;
        transferred: number;
        skipped: number;
        errors: number;
      }>(`/api/campaigns/${campaignId}/lead-transfer/replay`, {
        method: "POST",
        body: JSON.stringify({ force: false }),
      });
      setReplayMsg(
        `Scanned ${result.scanned}: transferred ${result.transferred}, skipped ${result.skipped}, errors ${result.errors}`,
      );
    } catch {
      setReplayMsg("Replay failed");
    } finally {
      setReplaying(false);
    }
  }

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      <div>
        <h3 className="text-sm font-semibold mb-0.5">Transfer leads</h3>
        <p className="text-xs text-muted-foreground/60 leading-relaxed">
          After each campaign call, send matching dispositions to one or more CRM webhooks or Sheets.
        </p>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5">
        <span>
          <span className="block text-[13px] font-medium">Enable lead transfer</span>
          <span className="block text-[11px] text-muted-foreground">
            Only campaign calls — not inbound/webcall
          </span>
        </span>
        <Switch checked={value.enabled} onCheckedChange={(v) => set({ enabled: v })} />
      </label>

      {value.enabled && (
        <>
          <div className="space-y-3">
            {value.rules.map((rule, idx) => (
              <RuleEditor
                key={rule.id}
                rule={rule}
                agentId={agentId}
                dispositionOptions={dispositionOptions}
                dispLoading={dispLoading}
                canRemove={value.rules.length > 1}
                onRemove={() => set({ rules: value.rules.filter((_, i) => i !== idx) })}
                onChange={(next) => {
                  const rules = [...value.rules];
                  rules[idx] = next;
                  set({ rules });
                }}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => set({ rules: [...value.rules, newRule()] })}
          >
            <Plus className="h-3.5 w-3.5" /> Add rule
          </Button>

          {campaignId ? (
            <div className="flex flex-col gap-1.5 pt-1 border-t border-border/40">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 text-xs gap-1.5 w-fit"
                disabled={replaying}
                onClick={() => void handleReplay()}
              >
                {replaying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Sync past matches
              </Button>
              {replayMsg && <p className="text-[11px] text-muted-foreground">{replayMsg}</p>}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
