/**
 * Partner Client Control Panel — manage one client from the partner account.
 * Stays in Partner Hub; optional “Edit in workspace” uses acting-as for deep builder/campaigns.
 */

import { useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { partnerFetch } from "@/hooks/use-partner";
import { startActingAs } from "@/lib/acting-as";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, ArrowRightLeft, Bot, IndianRupee, LogIn, Wallet, Send, ChevronRight,
} from "lucide-react";
import { getListAgentsQueryKey, getListPhoneNumbersQueryKey } from "@workspace/api-client-react";

interface PartnerClient {
  clerkId: string;
  name: string | null;
  email: string | null;
  status: string;
  walletBalanceCents: number;
  rateCentsPerMin: number;
  joinedAt: string;
  monthSeconds: number;
  monthSpendCents: number;
  monthCalls: number;
}

interface ClientConfigAgent {
  id: number;
  name: string;
  status: string;
  inboundNumber: string | null;
  inboundNumberOwnedByPartner: boolean;
}

interface ClientConfigNumber {
  id: number;
  number: string;
  assignedAgentId: number | null;
  assignedAgentName: string | null;
  assignment: "unassigned" | "this_client" | "own" | "other_client";
}

interface PartnerOwnAgent {
  id: number;
  name: string;
  status: string;
}

interface ClientCall {
  id: number;
  status: string;
  durationSeconds: number | null;
  costCents: number | null;
  createdAt: string;
}

const inr = (cents: number) => `₹${(cents / 100).toFixed(2)}`;
const toMins = (seconds: number) => Math.round(seconds / 60);
const fmtDate = (d: string) =>
  new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function parseRupees(text: string): number | null {
  const v = Number.parseFloat(text);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100);
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default function PartnerClientPage() {
  const [, params] = useRoute("/app/partner/clients/:clerkId");
  const clerkId = params?.clerkId ? decodeURIComponent(params.clerkId) : "";
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const [rateText, setRateText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [sendAgentId, setSendAgentId] = useState<string>("");

  const clientsQ = useQuery<{ clients: PartnerClient[]; baseRateCentsPerMin: number }>({
    queryKey: ["partner-clients"],
    queryFn: () => partnerFetch(getToken, "/api/partner/clients"),
    enabled: !!clerkId,
  });

  const client = useMemo(
    () => clientsQ.data?.clients.find((c) => c.clerkId === clerkId) ?? null,
    [clientsQ.data, clerkId],
  );
  const baseRate = clientsQ.data?.baseRateCentsPerMin ?? 500;

  const configQ = useQuery<{
    agents: ClientConfigAgent[];
    partnerNumbers: ClientConfigNumber[];
    partnerAgents: PartnerOwnAgent[];
  }>({
    queryKey: ["partner-client-config", clerkId],
    queryFn: () => partnerFetch(getToken, `/api/partner/clients/${encodeURIComponent(clerkId)}/config`),
    enabled: !!clerkId && !!client,
  });

  const callsQ = useQuery<{ calls: ClientCall[] }>({
    queryKey: ["partner-client-calls", clerkId],
    queryFn: () => partnerFetch(getToken, `/api/partner/clients/${encodeURIComponent(clerkId)}/calls`),
    enabled: !!clerkId && !!client,
  });

  const displayName = client?.name || client?.email || "Client";

  const openWorkspace = (path = "/app/home") => {
    if (!client) return;
    startActingAs({ clientId: client.clerkId, clientName: displayName });
    qc.clear();
    navigate(path);
  };

  const rateMutation = useMutation({
    mutationFn: (rateCentsPerMin: number) =>
      partnerFetch(getToken, `/api/partner/clients/${encodeURIComponent(clerkId)}`, {
        method: "PATCH",
        body: JSON.stringify({ rateCentsPerMin }),
      }),
    onSuccess: () => {
      toast({ title: "Client rate updated" });
      void qc.invalidateQueries({ queryKey: ["partner-clients"] });
      void qc.invalidateQueries({ queryKey: ["partner-me"] });
    },
    onError: (err: Error) =>
      toast({ title: "Could not update rate", description: err.message, variant: "destructive" }),
  });

  const transferMutation = useMutation({
    mutationFn: (amountCents: number) =>
      partnerFetch(getToken, `/api/partner/clients/${encodeURIComponent(clerkId)}/transfer`, {
        method: "POST",
        body: JSON.stringify({ amountCents }),
      }),
    onSuccess: () => {
      toast({ title: "Balance transferred to client" });
      setAmountText("");
      void qc.invalidateQueries({ queryKey: ["partner-clients"] });
      void qc.invalidateQueries({ queryKey: ["partner-me"] });
    },
    onError: (err: Error) =>
      toast({ title: "Transfer failed", description: err.message, variant: "destructive" }),
  });

  const assign = useMutation({
    mutationFn: ({ numberId, agentId }: { numberId: number; agentId: number | null }) =>
      partnerFetch(getToken, `/api/phone-numbers/${numberId}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ agentId }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["partner-client-config", clerkId] });
      void qc.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
      toast({ title: "Number assignment updated" });
    },
    onError: (err: Error) =>
      toast({ title: "Could not update assignment", description: err.message, variant: "destructive" }),
  });

  const sendAgent = useMutation({
    mutationFn: (sourceAgentId: number) =>
      partnerFetch<{ id: number; name: string }>(
        getToken,
        `/api/partner/clients/${encodeURIComponent(clerkId)}/agents`,
        { method: "POST", body: JSON.stringify({ sourceAgentId }) },
      ),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ["partner-client-config", clerkId] });
      void qc.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      setSendAgentId("");
      toast({ title: "Agent copied to client", description: `"${created.name}" is in their account.` });
    },
    onError: (err: Error) =>
      toast({ title: "Could not send agent", description: err.message, variant: "destructive" }),
  });

  if (!clerkId) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Missing client.</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href="/app/partner">Back to Partner Hub</Link>
        </Button>
      </div>
    );
  }

  if (clientsQ.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6 animate-pulse">
        <div className="h-8 w-64 rounded bg-muted" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-muted" />)}
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center space-y-3">
        <p className="text-sm font-medium">Client not found</p>
        <p className="text-xs text-muted-foreground">They may not be linked to your partner account.</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/partner">Back to Partner Hub</Link>
        </Button>
      </div>
    );
  }

  const agents = configQ.data?.agents ?? [];
  const numbers = configQ.data?.partnerNumbers ?? [];
  const partnerAgents = configQ.data?.partnerAgents ?? [];
  const calls = callsQ.data?.calls ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            href="/app/partner"
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Partner Hub
          </Link>
          <h1 className="mt-1.5 text-xl font-semibold tracking-[-0.02em] truncate">
            Control panel
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground truncate">
            {displayName}
            {client.email && client.name ? ` · ${client.email}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="h-9 text-xs gap-1.5" onClick={() => openWorkspace("/app/agents")}>
            <Bot className="size-3.5" /> Edit agents
          </Button>
          <Button size="sm" variant="outline" className="h-9 text-xs gap-1.5" onClick={() => openWorkspace("/app/campaigns")}>
            Campaigns
          </Button>
          <Button size="sm" variant="outline" className="h-9 text-xs gap-1.5" onClick={() => openWorkspace("/app/home")}>
            <LogIn className="size-3.5" /> Full workspace
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-[12px] text-muted-foreground leading-relaxed">
        You are managing this client from <span className="font-medium text-foreground">your partner account</span>.
        Rate, wallet top-ups, agent copies, and number assignment stay here.
        Use <span className="font-medium text-foreground">Edit agents / Full workspace</span> when you need their builder or campaigns (amber bar = client mode).
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Wallet" value={inr(client.walletBalanceCents)} />
        <Stat label="Rate" value={`${inr(client.rateCentsPerMin)}/min`} sub={`Base ${inr(baseRate)}/min`} />
        <Stat label="This month" value={`${toMins(client.monthSeconds)} min`} sub={`${client.monthCalls} calls`} />
        <Stat label="Spend" value={inr(client.monthSpendCents)} sub="Client wallet this month" />
      </div>

      <Tabs defaultValue="agents" className="space-y-4">
        <TabsList className="h-9">
          <TabsTrigger value="agents" className="text-xs">Agents</TabsTrigger>
          <TabsTrigger value="numbers" className="text-xs">Numbers</TabsTrigger>
          <TabsTrigger value="calls" className="text-xs">Calls</TabsTrigger>
          <TabsTrigger value="billing" className="text-xs">Billing</TabsTrigger>
        </TabsList>

        <TabsContent value="agents" className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Client agents ({agents.length})</h2>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openWorkspace("/app/agents")}>
                <Bot className="size-3.5 mr-1" /> Open builder
              </Button>
            </div>
            {configQ.isLoading ? (
              <div className="h-20 animate-pulse rounded bg-muted" />
            ) : agents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
                No agents yet — copy one of yours below, or open the builder.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {agents.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => openWorkspace(`/app/agents/${a.id}`)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{a.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {a.status}
                          {a.inboundNumber ? ` · ${a.inboundNumber}` : " · No number"}
                        </p>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold">Copy agent from your account</h2>
            <p className="text-[12px] text-muted-foreground">
              Sends a config snapshot into this client. Numbers and integrations must be re-linked.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={sendAgentId || undefined} onValueChange={setSendAgentId}>
                <SelectTrigger className="h-9 text-xs flex-1">
                  <SelectValue placeholder={partnerAgents.length ? "Choose your agent…" : "No agents in your account"} />
                </SelectTrigger>
                <SelectContent>
                  {partnerAgents.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-9 text-xs gap-1.5"
                disabled={!sendAgentId || sendAgent.isPending}
                onClick={() => sendAgent.mutate(Number(sendAgentId))}
              >
                <Send className="size-3.5" /> Send to client
              </Button>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="numbers" className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold">Your numbers → this client</h2>
            <p className="text-[12px] text-muted-foreground">
              Assign partner-owned voice numbers to this client&apos;s agents.
            </p>
            {configQ.isLoading ? (
              <div className="h-20 animate-pulse rounded bg-muted" />
            ) : numbers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-lg">
                No active voice numbers on your partner account.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {numbers.map((n) => (
                  <li key={n.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-mono text-sm">{n.number}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {n.assignment === "this_client" && n.assignedAgentName
                          ? `On ${n.assignedAgentName}`
                          : n.assignment === "own" && n.assignedAgentName
                            ? `On your agent ${n.assignedAgentName}`
                            : n.assignment === "other_client"
                              ? "Assigned to another client"
                              : "Unassigned"}
                      </p>
                    </div>
                    <Select
                      value={n.assignedAgentId && n.assignment === "this_client" ? String(n.assignedAgentId) : "none"}
                      onValueChange={(v) => {
                        assign.mutate({
                          numberId: n.id,
                          agentId: v === "none" ? null : Number(v),
                        });
                      }}
                      disabled={assign.isPending || (n.assignment === "other_client")}
                    >
                      <SelectTrigger className="h-8 w-full sm:w-[200px] text-xs">
                        <SelectValue placeholder="Assign…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-xs">Unassigned</SelectItem>
                        {agents.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>

        <TabsContent value="calls" className="space-y-3">
          <section className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">Recent calls</h2>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => openWorkspace("/app/history")}>
                Open history
              </Button>
            </div>
            {callsQ.isLoading ? (
              <div className="p-4 h-24 animate-pulse bg-muted/40" />
            ) : calls.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No calls yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-muted-foreground border-b border-border">
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Duration</th>
                    <th className="px-3 py-2 font-medium text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {calls.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2.5 text-[12px]">{fmtDate(c.createdAt)}</td>
                      <td className="px-3 py-2.5">
                        <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-[12px]">
                        {c.durationSeconds != null ? `${c.durationSeconds}s` : "—"}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-[12px] text-right">
                        {c.costCents != null ? inr(c.costCents) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </TabsContent>

        <TabsContent value="billing" className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <IndianRupee className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Per-minute rate</h2>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Must be at least your base rate ({inr(baseRate)}/min). Client is billed at this rate; you earn the spread.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">Rate (₹ / min)</Label>
                <Input
                  className="h-9 text-xs"
                  inputMode="decimal"
                  placeholder={(client.rateCentsPerMin / 100).toFixed(2)}
                  value={rateText}
                  onChange={(e) => setRateText(e.target.value)}
                  onFocus={() => {
                    if (!rateText) setRateText((client.rateCentsPerMin / 100).toFixed(2));
                  }}
                />
              </div>
              <Button
                size="sm"
                className="h-9 text-xs"
                disabled={rateMutation.isPending}
                onClick={() => {
                  const paise = parseRupees(rateText || String(client.rateCentsPerMin / 100));
                  if (paise == null) {
                    toast({ title: "Enter a valid rate", variant: "destructive" });
                    return;
                  }
                  if (paise < baseRate) {
                    toast({ title: `Rate must be ≥ ${inr(baseRate)}/min`, variant: "destructive" });
                    return;
                  }
                  rateMutation.mutate(paise);
                }}
              >
                Save rate
              </Button>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Transfer wallet credit</h2>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Move balance from your partner wallet → this client. Client balance: {inr(client.walletBalanceCents)}.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">Amount (₹)</Label>
                <Input
                  className="h-9 text-xs"
                  inputMode="decimal"
                  placeholder="1000"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                className="h-9 text-xs gap-1.5"
                disabled={transferMutation.isPending}
                onClick={() => {
                  const paise = parseRupees(amountText);
                  if (paise == null || paise <= 0) {
                    toast({ title: "Enter a valid amount", variant: "destructive" });
                    return;
                  }
                  transferMutation.mutate(paise);
                }}
              >
                <Wallet className="size-3.5" /> Transfer
              </Button>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
