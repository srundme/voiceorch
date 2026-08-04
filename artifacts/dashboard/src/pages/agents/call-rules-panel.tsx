/**
 * Call rules — Phase 3.
 *
 * Agent-level dial defaults (stored in agentConfig.callDefaults) plus per-flow
 * editors for campaigns bound to this agent. Uses existing campaign update
 * fields — no engine rewrite.
 */

import { useEffect, useState } from "react";
import {
  useGetAgent,
  useUpdateAgent,
  useUpdateCampaign,
  getGetAgentQueryKey,
  getListCampaignsQueryKey,
  type Campaign,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import { ChevronDown, Clock, Loader2, Save, Settings2 } from "lucide-react";

export type CallDefaults = {
  maxAttempts: number;
  retryDelayMinutes: number;
  callDelaySeconds: number;
  concurrentCallLimit: number;
  isCallingHoursEnabled: boolean;
  businessHoursStart: number | null;
  businessHoursEnd: number | null;
  timezone: string;
  autoRedialEnabled: boolean;
  autoRedialMaxAttempts: number;
};

const DEFAULTS: CallDefaults = {
  maxAttempts: 2,
  retryDelayMinutes: 60,
  callDelaySeconds: 5,
  concurrentCallLimit: 3,
  isCallingHoursEnabled: true,
  businessHoursStart: 9,
  businessHoursEnd: 19,
  timezone: "Asia/Kolkata",
  autoRedialEnabled: true,
  autoRedialMaxAttempts: 3,
};

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "UTC",
];

function clampInt(n: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function readDefaults(agent: any): CallDefaults {
  const cfg = (agent?.agentConfig ?? {}) as Record<string, any>;
  const d = (cfg.callDefaults ?? {}) as Partial<CallDefaults>;
  const redial = (cfg.autoRedial ?? {}) as { enabled?: boolean; maxAttempts?: number };
  return {
    maxAttempts: clampInt(Number(d.maxAttempts ?? DEFAULTS.maxAttempts), 1, 10, DEFAULTS.maxAttempts),
    retryDelayMinutes: clampInt(Number(d.retryDelayMinutes ?? DEFAULTS.retryDelayMinutes), 1, 24 * 60, DEFAULTS.retryDelayMinutes),
    callDelaySeconds: clampInt(Number(d.callDelaySeconds ?? DEFAULTS.callDelaySeconds), 0, 120, DEFAULTS.callDelaySeconds),
    concurrentCallLimit: clampInt(Number(d.concurrentCallLimit ?? DEFAULTS.concurrentCallLimit), 1, 10, DEFAULTS.concurrentCallLimit),
    isCallingHoursEnabled: d.isCallingHoursEnabled ?? DEFAULTS.isCallingHoursEnabled,
    businessHoursStart: d.businessHoursStart == null ? DEFAULTS.businessHoursStart : clampInt(Number(d.businessHoursStart), 0, 23, 9),
    businessHoursEnd: d.businessHoursEnd == null ? DEFAULTS.businessHoursEnd : clampInt(Number(d.businessHoursEnd), 0, 23, 19),
    timezone: typeof d.timezone === "string" && d.timezone ? d.timezone : DEFAULTS.timezone,
    autoRedialEnabled: redial.enabled ?? d.autoRedialEnabled ?? DEFAULTS.autoRedialEnabled,
    autoRedialMaxAttempts: clampInt(Number(redial.maxAttempts ?? d.autoRedialMaxAttempts ?? DEFAULTS.autoRedialMaxAttempts), 1, 10, 3),
  };
}

function hourOptions() {
  return Array.from({ length: 24 }, (_, h) => ({
    value: String(h),
    label: `${String(h).padStart(2, "0")}:00`,
  }));
}

function CallRulesFields({
  value,
  onChange,
  showAutoRedial,
}: {
  value: CallDefaults;
  onChange: (next: CallDefaults) => void;
  showAutoRedial?: boolean;
}) {
  const set = (patch: Partial<CallDefaults>) => onChange({ ...value, ...patch });
  const hours = hourOptions();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[11px]">Max attempts</Label>
          <Input
            type="number"
            min={1}
            max={10}
            className="h-8 text-xs"
            value={value.maxAttempts}
            onChange={(e) => set({ maxAttempts: clampInt(Number(e.target.value), 1, 10, 2) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px]">Retry delay (min)</Label>
          <Input
            type="number"
            min={1}
            max={1440}
            className="h-8 text-xs"
            value={value.retryDelayMinutes}
            onChange={(e) => set({ retryDelayMinutes: clampInt(Number(e.target.value), 1, 1440, 60) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px]">Pace between dials (sec)</Label>
          <Input
            type="number"
            min={0}
            max={120}
            className="h-8 text-xs"
            value={value.callDelaySeconds}
            onChange={(e) => set({ callDelaySeconds: clampInt(Number(e.target.value), 0, 120, 5) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px]">Max parallel calls</Label>
          <Input
            type="number"
            min={1}
            max={10}
            className="h-8 text-xs"
            value={value.concurrentCallLimit}
            onChange={(e) => set({ concurrentCallLimit: clampInt(Number(e.target.value), 1, 10, 3) })}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium">Quiet hours</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Only dial inside this window</p>
          </div>
          <Switch
            checked={value.isCallingHoursEnabled}
            onCheckedChange={(v) => set({ isCallingHoursEnabled: v })}
          />
        </div>
        {value.isCallingHoursEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px]">Start</Label>
              <Select
                value={String(value.businessHoursStart ?? 9)}
                onValueChange={(v) => set({ businessHoursStart: Number(v) })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {hours.map((h) => <SelectItem key={h.value} value={h.value} className="text-xs">{h.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]">End</Label>
              <Select
                value={String(value.businessHoursEnd ?? 19)}
                onValueChange={(v) => set({ businessHoursEnd: Number(v) })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {hours.map((h) => <SelectItem key={h.value} value={h.value} className="text-xs">{h.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]">Timezone</Label>
              <Select value={value.timezone} onValueChange={(v) => set({ timezone: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => <SelectItem key={tz} value={tz} className="text-xs">{tz}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {showAutoRedial && (
        <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium">Auto-redial on drop</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Mid-call disconnects (non-campaign). Same setting as Advanced.
              </p>
            </div>
            <Switch
              checked={value.autoRedialEnabled}
              onCheckedChange={(v) => set({ autoRedialEnabled: v })}
            />
          </div>
          {value.autoRedialEnabled && (
            <div className="space-y-1.5 max-w-[160px]">
              <Label className="text-[11px]">Max redials / day</Label>
              <Input
                type="number"
                min={1}
                max={10}
                className="h-8 text-xs"
                value={value.autoRedialMaxAttempts}
                onChange={(e) => set({ autoRedialMaxAttempts: clampInt(Number(e.target.value), 1, 10, 3) })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function campaignToRules(c: Campaign): CallDefaults {
  return {
    maxAttempts: c.maxAttempts ?? 2,
    retryDelayMinutes: c.retryDelayMinutes ?? 60,
    callDelaySeconds: c.callDelaySeconds ?? 5,
    concurrentCallLimit: c.concurrentCallLimit ?? 3,
    isCallingHoursEnabled: c.isCallingHoursEnabled !== false,
    businessHoursStart: c.businessHoursStart ?? 9,
    businessHoursEnd: c.businessHoursEnd ?? 19,
    timezone: c.timezone ?? "Asia/Kolkata",
    autoRedialEnabled: false,
    autoRedialMaxAttempts: 3,
  };
}

function FlowRulesCard({ campaign }: { campaign: Campaign }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const update = useUpdateCampaign();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<CallDefaults>(() => campaignToRules(campaign));

  useEffect(() => {
    setRules(campaignToRules(campaign));
  }, [campaign.id, campaign.updatedAt]);

  const save = async () => {
    try {
      await update.mutateAsync({
        id: campaign.id,
        data: {
          maxAttempts: rules.maxAttempts,
          retryDelayMinutes: rules.retryDelayMinutes,
          callDelaySeconds: rules.callDelaySeconds,
          concurrentCallLimit: rules.concurrentCallLimit,
          isCallingHoursEnabled: rules.isCallingHoursEnabled,
          businessHoursStart: rules.isCallingHoursEnabled ? rules.businessHoursStart : null,
          businessHoursEnd: rules.isCallingHoursEnabled ? rules.businessHoursEnd : null,
          timezone: rules.timezone,
        },
      });
      qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      toast({ title: "Call rules saved", description: campaign.name });
    } catch (err) {
      toast({ title: "Could not save call rules", description: formatApiError(err), variant: "destructive" });
    }
  };

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        <Settings2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{campaign.name}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {rules.maxAttempts}× attempts · {rules.retryDelayMinutes}m retry · {rules.concurrentCallLimit} parallel
            {rules.isCallingHoursEnabled
              ? ` · ${String(rules.businessHoursStart).padStart(2, "0")}:00–${String(rules.businessHoursEnd).padStart(2, "0")}:00`
              : " · 24/7"}
          </p>
        </div>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-border/40 px-3 py-3 space-y-3 bg-card/30">
          <CallRulesFields value={rules} onChange={setRules} />
          <div className="flex justify-end">
            <Button size="sm" className="h-8 text-xs gap-1.5" disabled={update.isPending} onClick={() => void save()}>
              {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save flow rules
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CallRulesPanel({
  agentId,
  campaigns,
}: {
  agentId: number;
  campaigns: Campaign[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const agentQ = useGetAgent(agentId, {
    query: { queryKey: getGetAgentQueryKey(agentId), staleTime: 15_000 },
  });
  const updateAgent = useUpdateAgent();
  const updateCampaign = useUpdateCampaign();

  const [defaults, setDefaults] = useState<CallDefaults>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!agentQ.data) return;
    setDefaults(readDefaults(agentQ.data));
    setLoaded(true);
  }, [agentQ.data]);

  const saveDefaults = async () => {
    try {
      await updateAgent.mutateAsync({
        id: agentId,
        data: {
          agentConfig: {
            callDefaults: {
              maxAttempts: defaults.maxAttempts,
              retryDelayMinutes: defaults.retryDelayMinutes,
              callDelaySeconds: defaults.callDelaySeconds,
              concurrentCallLimit: defaults.concurrentCallLimit,
              isCallingHoursEnabled: defaults.isCallingHoursEnabled,
              businessHoursStart: defaults.businessHoursStart,
              businessHoursEnd: defaults.businessHoursEnd,
              timezone: defaults.timezone,
            },
            autoRedial: {
              enabled: defaults.autoRedialEnabled,
              maxAttempts: defaults.autoRedialMaxAttempts,
            },
          } as any,
        },
      });
      qc.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
      toast({ title: "Agent call defaults saved" });
    } catch (err) {
      toast({ title: "Could not save defaults", description: formatApiError(err), variant: "destructive" });
    }
  };

  const applyToAll = async () => {
    if (campaigns.length === 0) {
      toast({ title: "No campaign studios yet", description: "Create a form, sheet, or list flow first." });
      return;
    }
    try {
      await saveDefaults();
      await Promise.all(
        campaigns.map((c) =>
          updateCampaign.mutateAsync({
            id: c.id,
            data: {
              maxAttempts: defaults.maxAttempts,
              retryDelayMinutes: defaults.retryDelayMinutes,
              callDelaySeconds: defaults.callDelaySeconds,
              concurrentCallLimit: defaults.concurrentCallLimit,
              isCallingHoursEnabled: defaults.isCallingHoursEnabled,
              businessHoursStart: defaults.isCallingHoursEnabled ? defaults.businessHoursStart : null,
              businessHoursEnd: defaults.isCallingHoursEnabled ? defaults.businessHoursEnd : null,
              timezone: defaults.timezone,
            },
          }),
        ),
      );
      qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      toast({
        title: "Applied to all flows",
        description: `Updated ${campaigns.length} campaign studio${campaigns.length === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      toast({ title: "Apply failed", description: formatApiError(err), variant: "destructive" });
    }
  };

  const busy = updateAgent.isPending || updateCampaign.isPending;

  return (
    <section id="reach-call-rules" className="scroll-mt-4 space-y-4 border-t border-border/40 pt-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold tracking-tight">Call rules</h3>
        </div>
        <p className="text-[12px] text-muted-foreground max-w-3xl">
          Retries, pacing, parallel caps, and quiet hours for how this agent dials.
          Defaults apply to new flows; edit a flow below to override.
        </p>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium">Agent defaults</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Saved on this agent · used as the baseline</p>
          </div>
          {agentQ.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>

        {loaded ? (
          <CallRulesFields value={defaults} onChange={setDefaults} showAutoRedial />
        ) : (
          <div className="h-24 rounded-lg bg-muted/30 animate-pulse" />
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={busy || campaigns.length === 0}
            onClick={() => void applyToAll()}
          >
            Apply to all flows
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={busy || !loaded}
            onClick={() => void saveDefaults()}
          >
            {updateAgent.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save defaults
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Per-flow overrides
        </p>
        {campaigns.length === 0 ? (
          <p className="text-[12px] text-muted-foreground rounded-xl border border-dashed border-border/60 px-3 py-6 text-center">
            No form / list campaign studios on this agent yet. Create one from the presets above, then tune rules here.
          </p>
        ) : (
          campaigns.map((c) => <FlowRulesCard key={c.id} campaign={c} />)
        )}
      </div>
    </section>
  );
}
