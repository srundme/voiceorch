import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import { customFetch, useListCampaigns, getListCampaignsQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { errorMessage, flowsApi, type FlowSettings, type FlowStep } from "./api";
import { STEP_META } from "./nodes";

// ── Test on one number ───────────────────────────────────────────────────────

export function TestRunDialog({ open, onOpenChange, flowId, onStarted }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  flowId: number;
  onStarted: () => void;
}) {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const run = useMutation({
    mutationFn: () => flowsApi.test(flowId, {
      phone: phone.trim(),
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
    }),
    onSuccess: () => {
      toast({ title: "Test started", description: "Follow it in the People panel." });
      onOpenChange(false);
      onStarted();
    },
    onError: (err) => toast({ title: "Couldn't start test", description: errorMessage(err), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Test this flow</DialogTitle>
          <DialogDescription>Runs every step for real on one person — calls, messages and webhooks included.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Phone (with country code)</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!phone.trim() || run.isPending} onClick={() => run.mutate()}>
            {run.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Start test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Run on a list of people ──────────────────────────────────────────────────

type SheetPipeline = { id: string; name: string };

function parsePhones(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => /\d{6,}/.test(s)))];
}

export function RunOnPeopleDialog({ open, onOpenChange, flowId, settings, onStarted }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  flowId: number;
  settings: FlowSettings;
  onStarted: () => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"paste" | "campaign" | "sheet">(
    settings.sheetPipelineId ? "sheet" : settings.campaignId ? "campaign" : "paste",
  );
  const [text, setText] = useState("");
  const [campaignId, setCampaignId] = useState<string>(settings.campaignId ? String(settings.campaignId) : "");
  const [sheetId, setSheetId] = useState<string>(settings.sheetPipelineId ?? "");
  const [keepLive, setKeepLive] = useState(settings.runMode === "live");
  const [force, setForce] = useState(false);

  const campaignsQ = useListCampaigns({ query: { queryKey: getListCampaignsQueryKey(), enabled: open } });
  const campaigns = useMemo(
    () => (Array.isArray(campaignsQ.data) ? campaignsQ.data : []).filter((c) => !c.name.startsWith("__")),
    [campaignsQ.data],
  );
  const sheetsQ = useQuery({
    queryKey: ["automatic-calls"],
    queryFn: () => customFetch<SheetPipeline[]>("/api/automatic-calls"),
    enabled: open,
  });
  const phones = parsePhones(text);

  const start = useMutation({
    mutationFn: () => flowsApi.start(flowId, {
      ...(tab === "paste" ? { phones } : {}),
      ...(tab === "campaign" ? { campaignId: Number(campaignId) } : {}),
      ...(tab === "sheet" ? { sheetPipelineId: sheetId, runMode: keepLive ? "live" : "once" } : {}),
      ...(force ? { force: true } : {}),
    }),
    onSuccess: (r) => {
      toast({
        title: `Started ${r.started} ${r.started === 1 ? "person" : "people"}`,
        description: r.skipped ? `${r.skipped} skipped (already in this flow).` : r.hasMore ? "The rest are fed in automatically." : undefined,
      });
      onOpenChange(false);
      onStarted();
    },
    onError: (err) => toast({ title: "Couldn't start", description: errorMessage(err), variant: "destructive" }),
  });

  const canStart = tab === "paste" ? phones.length > 0 : tab === "campaign" ? !!campaignId : !!sheetId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run on people</DialogTitle>
          <DialogDescription>Each person starts at the first step. Calls respect your account's parallel-call limit and the flow's calling hours.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="paste">Paste numbers</TabsTrigger>
            <TabsTrigger value="campaign">Campaign list</TabsTrigger>
            <TabsTrigger value="sheet">Google Sheet</TabsTrigger>
          </TabsList>
          <TabsContent value="paste" className="space-y-1.5 pt-2">
            <Textarea
              className="min-h-[140px] font-mono text-xs"
              placeholder={"+919876543210\n+919812345678"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">{phones.length} number(s) found. One per line, or comma-separated.</p>
          </TabsContent>
          <TabsContent value="campaign" className="space-y-1.5 pt-2">
            <Select value={campaignId || undefined} onValueChange={setCampaignId}>
              <SelectTrigger><SelectValue placeholder={campaignsQ.isLoading ? "Loading…" : "Pick a campaign"} /></SelectTrigger>
              <SelectContent>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name} · {c.totalLeads} people</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Uses the people already uploaded to that campaign.</p>
          </TabsContent>
          <TabsContent value="sheet" className="space-y-3 pt-2">
            <Select value={sheetId || undefined} onValueChange={setSheetId}>
              <SelectTrigger><SelectValue placeholder={sheetsQ.isLoading ? "Loading…" : "Pick a connected sheet"} /></SelectTrigger>
              <SelectContent>
                {(sheetsQ.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {!sheetsQ.isLoading && (sheetsQ.data ?? []).length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                No sheets yet. <Link href="/app/automatic-calls/new" className="underline">Connect a Google Sheet</Link> first.
              </p>
            )}
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-xs font-medium">Keep watching for new rows</p>
                <p className="text-[11px] text-muted-foreground">New rows enter the flow automatically.</p>
              </div>
              <Switch checked={keepLive} onCheckedChange={setKeepLive} />
            </div>
          </TabsContent>
        </Tabs>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={force} onCheckedChange={setForce} />
          Include people who already went through this flow
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canStart || start.isPending} onClick={() => start.mutate()}>
            {start.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── People in this flow ──────────────────────────────────────────────────────

const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  running: { label: "Running", cls: "text-sky-700 dark:text-sky-300" },
  pending: { label: "Queued", cls: "text-muted-foreground" },
  waiting_call: { label: "On call / queued", cls: "text-sky-700 dark:text-sky-300" },
  waiting_delay: { label: "Waiting", cls: "text-amber-700 dark:text-amber-300" },
  completed: { label: "Done", cls: "text-emerald-700 dark:text-emerald-300" },
  failed: { label: "Failed", cls: "text-red-700 dark:text-red-300" },
};

export function RunsSheet({ open, onOpenChange, flowId, steps }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  flowId: number;
  steps: FlowStep[];
}) {
  const runsQ = useQuery({
    queryKey: ["flow-runs", flowId],
    queryFn: () => flowsApi.runs(flowId, 50),
    enabled: open,
    refetchInterval: open ? 4000 : false,
  });
  const [expanded, setExpanded] = useState<number | null>(null);
  const stepLabel = (idx?: number, type?: string) => {
    const s = idx != null ? steps[idx] : undefined;
    if (s) return s.label || STEP_META[s.type]?.label || s.type;
    return type ? (STEP_META[type as keyof typeof STEP_META]?.label ?? type.replace(/_/g, " ")) : "Step";
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>People in this flow</SheetTitle>
          <SheetDescription>{runsQ.data ? `${runsQ.data.total} total · latest 50` : "Loading…"}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          {runsQ.isLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
          {runsQ.data?.runs.length === 0 && <p className="text-sm text-muted-foreground">Nobody yet. Use Test or Run on people.</p>}
          {runsQ.data?.runs.map((r) => {
            const st = RUN_STATUS[r.status] ?? { label: r.status, cls: "text-muted-foreground" };
            const isOpen = expanded === r.id;
            return (
              <div key={r.id} className="rounded-lg border border-border">
                <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left" onClick={() => setExpanded(isOpen ? null : r.id)}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{r.name || r.phone || `Run #${r.id}`}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{r.name ? r.phone : r.triggeredBy}</p>
                  </div>
                  <span className={cn("text-[11px] font-medium", st.cls)}>{st.label}</span>
                </button>
                {isOpen && (
                  <div className="space-y-1.5 border-t border-border px-3 py-2">
                    {r.error && <p className="text-[11px] text-red-700 dark:text-red-300">{r.error}</p>}
                    {r.stepTrail.length === 0 && <p className="text-[11px] text-muted-foreground">No steps yet.</p>}
                    {r.stepTrail.map((s, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px]">
                        <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px] uppercase">{s.status ?? "—"}</Badge>
                        <div className="min-w-0 flex-1">
                          <span className="font-medium">{stepLabel(s.stepIndex, s.type)}</span>
                          {s.reason && <span className="text-muted-foreground"> · {s.reason}</span>}
                        </div>
                        {s.at && <span className="shrink-0 text-muted-foreground">{new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                      </div>
                    ))}
                    {r.call?.callId && (
                      <Link href={`/app/calls/${r.call.callId}`} className="inline-block pt-1 text-[11px] font-medium text-primary underline">
                        Open call
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
