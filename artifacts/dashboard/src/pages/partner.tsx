import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { partnerFetch } from "@/hooks/use-partner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Handshake, Users, UserPlus, Wallet, TrendingUp, Clock, Mail,
  Trash2, IndianRupee, ArrowRightLeft, Upload, X, Settings2, Globe, Link2, CheckCircle2, Copy,
} from "lucide-react";
import { useLocation } from "wouter";

/* ─── Types (mirror routes/partner.ts responses) ─────────────────────────── */

interface PartnerMe {
  companyName: string;
  status: string;
  baseRateCentsPerMin: number;
  defaultClientRateCentsPerMin: number;
  logoUrl: string | null;
  loginTitle: string | null;
  loginSubtitle: string | null;
  loginUrl: string;
  slug: string | null;
  subdomainHost: string | null;
  subdomainRoot: string;
  customDomain: string | null;
  customDomainStatus: "none" | "pending" | "active" | "failed";
  domainVerifyToken: string | null;
  cnameTarget: string;
  mailFromName: string | null;
  mailFromEmail: string | null;
  mailDomainStatus: "none" | "pending" | "verified" | "failed";
  mailDnsRecords: Array<{ key: string; host: string; type: string; value: string; ok: boolean }>;
  walletBalanceCents: number;
  clientCount: number;
  pendingInvites: number;
  monthEarningsCents: number;
  monthClientSeconds: number;
  monthClientCalls: number;
}

interface PartnerClient {
  clerkId: string;
  name: string | null;
  email: string | null;
  status: string;
  walletBalanceCents: number;
  rateCentsPerMin: number;
  allowAgentEdit?: boolean;
  joinedAt: string;
  monthSeconds: number;
  monthSpendCents: number;
  monthCalls: number;
}

interface PartnerInvite {
  id: number;
  email: string;
  name: string | null;
  rateCentsPerMin: number | null;
  status: string;
  invitedAt: string;
  acceptedAt: string | null;
}

interface EarningEntry {
  id: number;
  type: string;
  amountCents: number;
  description: string | null;
  callId: number | null;
  createdAt: string;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const inr = (cents: number) => `₹${(cents / 100).toFixed(2)}`;
const toMins = (seconds: number) => Math.round(seconds / 60);
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Parse a ₹ text input into integer paise; null when invalid. */
function parseRupees(text: string): number | null {
  const v = Number.parseFloat(text);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100);
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">{icon}<span>{label}</span></div>
      <p className="text-xl font-semibold tabular-nums mt-1.5">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function statusBadge(status: string) {
  switch (status) {
    case "active":   return <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">Active</Badge>;
    case "pending":  return <Badge variant="outline" className="text-amber-400 border-amber-500/30">Pending</Badge>;
    case "accepted": return <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">Accepted</Badge>;
    case "revoked":  return <Badge variant="outline" className="text-muted-foreground">Revoked</Badge>;
    default:         return <Badge variant="outline" className="text-muted-foreground">{status}</Badge>;
  }
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function PartnerPage() {
  const { getToken } = useAuth();

  const { data: me, isLoading, error } = useQuery<PartnerMe>({
    queryKey: ["partner-me"],
    retry: false,
    queryFn: () => partnerFetch<PartnerMe>(getToken, "/api/partner/me"),
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4 animate-pulse">
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-muted" />)}
        </div>
      </div>
    );
  }

  if (error || !me) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <Handshake className="w-10 h-10 text-muted-foreground/50" />
        <h1 className="text-lg font-semibold mt-3">Partner Hub</h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-sm">
          This area is for SnapServe resale partners. If you'd like to resell AI voice agents
          under your own brand, contact us to get set up.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Handshake className="w-5 h-5 text-primary" /> {me.companyName}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Partner Hub — your platform rate is {inr(me.baseRateCentsPerMin)}/min; anything you charge clients above that is yours.
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="clients">Clients</TabsTrigger>
          <TabsTrigger value="invites">Invites</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab me={me} />
        </TabsContent>
        <TabsContent value="clients" className="mt-4">
          <ClientsTab me={me} />
        </TabsContent>
        <TabsContent value="invites" className="mt-4">
          <InvitesTab me={me} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab me={me} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Overview ───────────────────────────────────────────────────────────── */

function OverviewTab({ me }: { me: PartnerMe }) {
  const { getToken } = useAuth();
  const { data } = useQuery<{ entries: EarningEntry[] }>({
    queryKey: ["partner-earnings"],
    queryFn: () => partnerFetch<{ entries: EarningEntry[] }>(getToken, "/api/partner/earnings"),
  });
  const entries = data?.entries ?? [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<TrendingUp className="w-3.5 h-3.5" />} label="Earnings this month" value={inr(me.monthEarningsCents)} sub="Spread over your base rate" />
        <StatCard icon={<Users className="w-3.5 h-3.5" />} label="Clients" value={String(me.clientCount)} sub={me.pendingInvites > 0 ? `${me.pendingInvites} invite${me.pendingInvites > 1 ? "s" : ""} pending` : undefined} />
        <StatCard icon={<Clock className="w-3.5 h-3.5" />} label="Client minutes this month" value={String(toMins(me.monthClientSeconds))} sub={`${me.monthClientCalls} calls`} />
        <StatCard icon={<Wallet className="w-3.5 h-3.5" />} label="Your wallet" value={inr(me.walletBalanceCents)} sub="Earnings land here" />
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium">Recent earnings & transfers</h2>
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground px-4 py-8 text-center">
            No earnings yet — they appear here as your clients make calls.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {entries.slice(0, 30).map(e => (
              <div key={e.id} className="flex items-center justify-between px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm truncate">{e.description || (e.type === "partner_earning" ? "Call spread" : "Transfer to client")}</p>
                  <p className="text-[11px] text-muted-foreground">{fmtDate(e.createdAt)}</p>
                </div>
                <span className={`text-sm font-medium tabular-nums shrink-0 ${e.amountCents >= 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {e.amountCents >= 0 ? "+" : ""}{inr(e.amountCents)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Clients ────────────────────────────────────────────────────────────── */

function ClientsTab({ me }: { me: PartnerMe }) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [rateClient, setRateClient] = useState<PartnerClient | null>(null);
  const [transferClient, setTransferClient] = useState<PartnerClient | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRateText, setCreateRateText] = useState((me.defaultClientRateCentsPerMin / 100).toFixed(2));
  const [sendCredentials, setSendCredentials] = useState(true);
  const [rateText, setRateText] = useState("");
  const [amountText, setAmountText] = useState("");

  const { data, isLoading } = useQuery<{ clients: PartnerClient[]; baseRateCentsPerMin: number }>({
    queryKey: ["partner-clients"],
    queryFn: () => partnerFetch<{ clients: PartnerClient[]; baseRateCentsPerMin: number }>(getToken, "/api/partner/clients"),
  });
  const clients = data?.clients ?? [];
  const baseRate = data?.baseRateCentsPerMin ?? me.baseRateCentsPerMin;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["partner-clients"] });
    queryClient.invalidateQueries({ queryKey: ["partner-me"] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const ratePaise = parseRupees(createRateText);
      return partnerFetch<{
        client: { clerkId: string; email: string | null };
        loginUrl: string;
        emailSent: boolean;
      }>(getToken, "/api/partner/clients", {
        method: "POST",
        body: JSON.stringify({
          email: createEmail.trim(),
          password: createPassword,
          name: createName.trim() || undefined,
          ...(ratePaise !== null ? { rateCentsPerMin: ratePaise } : {}),
          sendCredentials,
        }),
      });
    },
    onSuccess: (resp) => {
      toast({
        title: "Client created",
        description: resp.emailSent
          ? `Credentials emailed. They sign in at ${resp.loginUrl}`
          : `Share login URL ${resp.loginUrl} and the password you set.`,
      });
      setCreateOpen(false);
      setCreateEmail("");
      setCreateName("");
      setCreatePassword("");
      setCreateRateText((me.defaultClientRateCentsPerMin / 100).toFixed(2));
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Could not create client", description: err.message, variant: "destructive" }),
  });

  const rateMutation = useMutation({
    mutationFn: async ({ clerkId, rateCentsPerMin }: { clerkId: string; rateCentsPerMin: number }) =>
      partnerFetch(getToken, `/api/partner/clients/${encodeURIComponent(clerkId)}`, {
        method: "PATCH",
        body: JSON.stringify({ rateCentsPerMin }),
      }),
    onSuccess: () => {
      toast({ title: "Rate updated" });
      setRateClient(null);
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Could not update rate", description: err.message, variant: "destructive" }),
  });

  const transferMutation = useMutation({
    mutationFn: async ({ clerkId, amountCents }: { clerkId: string; amountCents: number }) =>
      partnerFetch(getToken, `/api/partner/clients/${encodeURIComponent(clerkId)}/transfer`, {
        method: "POST",
        body: JSON.stringify({ amountCents }),
      }),
    onSuccess: () => {
      toast({ title: "Balance transferred" });
      setTransferClient(null);
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Transfer failed", description: err.message, variant: "destructive" }),
  });

  const createRatePaise = parseRupees(createRateText);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Your clients</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Create accounts with email + password. Clients sign in on your branded login page (no Google).
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground">Base {inr(baseRate)}/min</span>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
            <UserPlus className="w-3.5 h-3.5" /> Create client
          </Button>
        </div>
      </div>
      {isLoading ? (
        <div className="p-4 space-y-2 animate-pulse">{[0, 1, 2].map(i => <div key={i} className="h-10 rounded bg-muted" />)}</div>
      ) : clients.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <Users className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground mt-2">No clients yet. Create one with email and password.</p>
          <Button size="sm" className="mt-3 gap-1.5" onClick={() => setCreateOpen(true)}>
            <UserPlus className="w-3.5 h-3.5" /> Create client
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Balance</th>
                <th className="px-3 py-2 font-medium">Rate</th>
                <th className="px-3 py-2 font-medium">This month</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clients.map(c => (
                <tr key={c.clerkId}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium truncate max-w-[220px]">{c.name || c.email || c.clerkId}</p>
                    {c.email && <p className="text-[11px] text-muted-foreground truncate max-w-[220px]">{c.email}</p>}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{inr(c.walletBalanceCents)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{inr(c.rateCentsPerMin)}/min</td>
                  <td className="px-3 py-2.5">
                    <span className="tabular-nums">{toMins(c.monthSeconds)} min</span>
                    <span className="text-muted-foreground text-[11px]"> · {c.monthCalls} calls · {inr(c.monthSpendCents)}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 justify-end">
                      <Button
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        title="Open client ops — rate, fund, numbers"
                        onClick={() => navigate(`/app/partner/clients/${encodeURIComponent(c.clerkId)}`)}
                      >
                        <Settings2 className="w-3 h-3 mr-1" /> Client ops
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                        onClick={() => { setRateClient(c); setRateText((c.rateCentsPerMin / 100).toFixed(2)); }}>
                        <IndianRupee className="w-3 h-3 mr-1" /> Rate
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                        onClick={() => { setTransferClient(c); setAmountText(""); }}>
                        <ArrowRightLeft className="w-3 h-3 mr-1" /> Transfer
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Client configuration dialog */}
      {/* Set rate dialog */}
      <Dialog open={!!rateClient} onOpenChange={(o) => !o && setRateClient(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set calling rate</DialogTitle>
            <DialogDescription>
              {rateClient?.name || rateClient?.email} — must be at least your base rate ({inr(baseRate)}/min).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="rate">Rate (₹ per minute)</Label>
            <Input id="rate" inputMode="decimal" value={rateText} onChange={e => setRateText(e.target.value)} placeholder="6.00" />
            {(() => {
              const paise = parseRupees(rateText);
              if (paise !== null && paise >= baseRate) {
                return <p className="text-[11px] text-muted-foreground">You earn {inr(paise - baseRate)} per client minute.</p>;
              }
              return null;
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRateClient(null)}>Cancel</Button>
            <Button
              disabled={rateMutation.isPending || parseRupees(rateText) === null || (parseRupees(rateText) as number) < baseRate}
              onClick={() => {
                const paise = parseRupees(rateText);
                if (rateClient && paise !== null) rateMutation.mutate({ clerkId: rateClient.clerkId, rateCentsPerMin: paise });
              }}>
              {rateMutation.isPending ? "Saving…" : "Save rate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer dialog */}
      <Dialog open={!!transferClient} onOpenChange={(o) => !o && setTransferClient(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Transfer balance</DialogTitle>
            <DialogDescription>
              Move money from your wallet ({inr(me.walletBalanceCents)}) to {transferClient?.name || transferClient?.email}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount (₹)</Label>
            <Input id="amount" inputMode="decimal" value={amountText} onChange={e => setAmountText(e.target.value)} placeholder="500.00" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferClient(null)}>Cancel</Button>
            <Button
              disabled={transferMutation.isPending || !parseRupees(amountText)}
              onClick={() => {
                const paise = parseRupees(amountText);
                if (transferClient && paise) transferMutation.mutate({ clerkId: transferClient.clerkId, amountCents: paise });
              }}>
              {transferMutation.isPending ? "Transferring…" : "Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create client account</DialogTitle>
            <DialogDescription>
              Sets email + password. They sign in at{" "}
              <a className="underline underline-offset-2" href={me.loginUrl} target="_blank" rel="noreferrer">{me.loginUrl}</a>
              {" "}— Google is disabled on your portal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="create-email">Email</Label>
              <Input id="create-email" type="email" value={createEmail} onChange={e => setCreateEmail(e.target.value)} placeholder="client@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-name">Name (optional)</Label>
              <Input id="create-name" value={createName} onChange={e => setCreateName(e.target.value)} placeholder="Acme Ops" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-password">Temporary password</Label>
              <Input id="create-password" type="text" value={createPassword} onChange={e => setCreatePassword(e.target.value)} placeholder="Min. 8 characters" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-rate">Rate (₹ per minute)</Label>
              <Input id="create-rate" inputMode="decimal" value={createRateText} onChange={e => setCreateRateText(e.target.value)} />
              {createRatePaise !== null && createRatePaise >= me.baseRateCentsPerMin ? (
                <p className="text-[11px] text-muted-foreground">You earn {inr(createRatePaise - me.baseRateCentsPerMin)}/min at this rate.</p>
              ) : (
                <p className="text-[11px] text-amber-500">Must be at least {inr(me.baseRateCentsPerMin)}/min.</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={sendCredentials} onChange={e => setSendCredentials(e.target.checked)} className="rounded border-border" />
              Email credentials to the client
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={
                createMutation.isPending
                || !createEmail.includes("@")
                || createPassword.length < 8
                || createRatePaise === null
                || createRatePaise < me.baseRateCentsPerMin
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Creating…" : "Create client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Invites ────────────────────────────────────────────────────────────── */

function InvitesTab({ me }: { me: PartnerMe }) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [rateText, setRateText] = useState((me.defaultClientRateCentsPerMin / 100).toFixed(2));

  const { data, isLoading } = useQuery<{ invites: PartnerInvite[] }>({
    queryKey: ["partner-invites"],
    queryFn: () => partnerFetch<{ invites: PartnerInvite[] }>(getToken, "/api/partner/invites"),
  });
  const invites = data?.invites ?? [];

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const paise = parseRupees(rateText);
      return partnerFetch<{ inviteUrl: string; emailSent: boolean }>(getToken, "/api/partner/invites", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          rateCentsPerMin: paise ?? undefined,
        }),
      });
    },
    onSuccess: async (resp) => {
      setOpen(false);
      setEmail(""); setName("");
      queryClient.invalidateQueries({ queryKey: ["partner-invites"] });
      queryClient.invalidateQueries({ queryKey: ["partner-me"] });
      if (resp.emailSent) {
        toast({ title: "Invitation sent", description: "Your client will receive an email with the join link." });
      } else {
        try { await navigator.clipboard.writeText(resp.inviteUrl); } catch { /* ignore */ }
        toast({ title: "Invite created — email could not be sent", description: "The invite link was copied to your clipboard; share it directly." });
      }
    },
    onError: (err: Error) => toast({ title: "Could not send invite", description: err.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => partnerFetch(getToken, `/api/partner/invites/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Invite revoked" });
      queryClient.invalidateQueries({ queryKey: ["partner-invites"] });
    },
    onError: (err: Error) => toast({ title: "Could not revoke invite", description: err.message, variant: "destructive" }),
  });

  const ratePaise = parseRupees(rateText);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-medium">Client invitations</h2>
        <Button size="sm" onClick={() => setOpen(true)}>
          <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Invite client
        </Button>
      </div>
      {isLoading ? (
        <div className="p-4 space-y-2 animate-pulse">{[0, 1].map(i => <div key={i} className="h-10 rounded bg-muted" />)}</div>
      ) : invites.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <Mail className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground mt-2">No invitations yet. Invite your first client to get started.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {invites.map(inv => (
            <div key={inv.id} className="flex items-center justify-between px-4 py-2.5 gap-3">
              <div className="min-w-0">
                <p className="text-sm truncate">{inv.name ? `${inv.name} — ${inv.email}` : inv.email}</p>
                <p className="text-[11px] text-muted-foreground">
                  Invited {fmtDate(inv.invitedAt)}
                  {inv.rateCentsPerMin != null && <> · {inr(inv.rateCentsPerMin)}/min</>}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {statusBadge(inv.status)}
                {inv.status === "pending" && (
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                    onClick={() => revokeMutation.mutate(inv.id)} title="Revoke invite">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Invite a client</DialogTitle>
            <DialogDescription>They'll get an email with a link to join under your partnership.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="inv-email">Email</Label>
              <Input id="inv-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="client@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-name">Name (optional)</Label>
              <Input id="inv-name" value={name} onChange={e => setName(e.target.value)} placeholder="Priya Sharma" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-rate">Calling rate (₹ per minute)</Label>
              <Input id="inv-rate" inputMode="decimal" value={rateText} onChange={e => setRateText(e.target.value)} />
              {ratePaise !== null && ratePaise >= me.baseRateCentsPerMin ? (
                <p className="text-[11px] text-muted-foreground">You earn {inr(ratePaise - me.baseRateCentsPerMin)} per minute.</p>
              ) : (
                <p className="text-[11px] text-amber-400">Must be at least your base rate ({inr(me.baseRateCentsPerMin)}/min).</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={inviteMutation.isPending || !email.includes("@") || ratePaise === null || ratePaise < me.baseRateCentsPerMin}
              onClick={() => inviteMutation.mutate()}>
              {inviteMutation.isPending ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Settings ───────────────────────────────────────────────────────────── */

function SettingsTab({ me }: { me: PartnerMe }) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [companyName, setCompanyName] = useState(me.companyName);
  const [loginTitle, setLoginTitle] = useState(me.loginTitle ?? "");
  const [loginSubtitle, setLoginSubtitle] = useState(me.loginSubtitle ?? "");
  const [defaultRateText, setDefaultRateText] = useState((me.defaultClientRateCentsPerMin / 100).toFixed(2));
  const [uploading, setUploading] = useState(false);
  const [slugDraft, setSlugDraft] = useState(me.slug ?? "");
  const [customDraft, setCustomDraft] = useState(me.customDomain ?? "");
  const [mailName, setMailName] = useState(me.mailFromName ?? me.companyName);
  const [mailEmail, setMailEmail] = useState(me.mailFromEmail ?? "");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["partner-me"] });
    queryClient.invalidateQueries({ queryKey: ["partner-context"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const paise = parseRupees(defaultRateText);
      return partnerFetch(getToken, "/api/partner/me", {
        method: "PATCH",
        body: JSON.stringify({
          companyName: companyName.trim(),
          loginTitle: loginTitle.trim() || null,
          loginSubtitle: loginSubtitle.trim() || null,
          ...(paise !== null ? { defaultClientRateCentsPerMin: paise } : {}),
        }),
      });
    },
    onSuccess: () => { toast({ title: "Settings saved" }); invalidate(); },
    onError: (err: Error) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  const slugMutation = useMutation({
    mutationFn: () =>
      partnerFetch<{ url: string }>(getToken, "/api/partner/domain/slug", {
        method: "PUT",
        body: JSON.stringify({ slug: slugDraft.trim() }),
      }),
    onSuccess: (data) => {
      toast({ title: "Subdomain saved", description: data.url });
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Could not save subdomain", description: err.message, variant: "destructive" }),
  });

  const clearSlugMutation = useMutation({
    mutationFn: () => partnerFetch(getToken, "/api/partner/domain/slug", { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Subdomain removed" }); setSlugDraft(""); invalidate(); },
    onError: (err: Error) => toast({ title: "Could not remove subdomain", description: err.message, variant: "destructive" }),
  });

  const customMutation = useMutation({
    mutationFn: () =>
      partnerFetch<{
        customDomain: string;
        txtHost: string;
        txtValue: string;
        cnameTarget: string;
      }>(getToken, "/api/partner/domain/custom", {
        method: "PUT",
        body: JSON.stringify({ domain: customDraft.trim() }),
      }),
    onSuccess: () => {
      toast({ title: "Custom domain saved", description: "Add the DNS records below, then click Verify." });
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Could not save domain", description: err.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      partnerFetch<{ url: string }>(getToken, "/api/partner/domain/custom/verify", { method: "POST" }),
    onSuccess: (data) => {
      toast({ title: "Domain verified", description: data.url });
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Verification failed", description: err.message, variant: "destructive" }),
  });

  const clearCustomMutation = useMutation({
    mutationFn: () => partnerFetch(getToken, "/api/partner/domain/custom", { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Custom domain removed" }); setCustomDraft(""); invalidate(); },
    onError: (err: Error) => toast({ title: "Could not remove domain", description: err.message, variant: "destructive" }),
  });

  const saveMailMutation = useMutation({
    mutationFn: () =>
      partnerFetch(getToken, "/api/partner/mail", {
        method: "PUT",
        body: JSON.stringify({ fromName: mailName.trim(), fromEmail: mailEmail.trim() }),
      }),
    onSuccess: () => {
      toast({ title: "Sending domain saved", description: "Add the DNS records below, then click Check DNS." });
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Could not save mail domain", description: err.message, variant: "destructive" }),
  });

  const verifyMailMutation = useMutation({
    mutationFn: () =>
      partnerFetch<{ mailDomainStatus: string }>(getToken, "/api/partner/mail/verify", { method: "POST" }),
    onSuccess: (data) => {
      toast({
        title: data.mailDomainStatus === "verified" ? "Mail domain verified" : "DNS not complete yet",
        description: data.mailDomainStatus === "verified"
          ? "Client emails will send from your address."
          : "Wait a few minutes after adding the records, then check again.",
      });
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Could not verify mail domain", description: err.message, variant: "destructive" }),
  });

  const clearMailMutation = useMutation({
    mutationFn: () => partnerFetch(getToken, "/api/partner/mail", { method: "DELETE" }),
    onSuccess: () => {
      setMailEmail("");
      toast({ title: "Sending domain removed" });
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Could not remove mail domain", description: err.message, variant: "destructive" }),
  });

  async function onLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast({ title: "Unsupported file", description: "Use a PNG, JPEG or WebP image.", variant: "destructive" });
      return;
    }
    if (file.size > 512 * 1024) {
      toast({ title: "File too large", description: "Logo must be under 512KB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read file"));
        reader.readAsDataURL(file);
      });
      await partnerFetch(getToken, "/api/partner/logo", {
        method: "POST",
        body: JSON.stringify({ mime: file.type, dataBase64 }),
      });
      toast({ title: "Logo updated" });
      invalidate();
    } catch (err) {
      toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  const removeLogoMutation = useMutation({
    mutationFn: () => partnerFetch(getToken, "/api/partner/logo", { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Logo removed" }); invalidate(); },
    onError: (err: Error) => toast({ title: "Could not remove logo", description: err.message, variant: "destructive" }),
  });

  const ratePaise = parseRupees(defaultRateText);
  const subdomainPreview = slugDraft.trim()
    ? `${slugDraft.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "")}.${me.subdomainRoot}`
    : null;
  const statusBadge =
    me.customDomainStatus === "active"
      ? { label: "Active", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" }
      : me.customDomainStatus === "pending"
        ? { label: "Pending DNS", cls: "bg-amber-500/10 text-amber-600 border-amber-500/20" }
        : me.customDomainStatus === "failed"
          ? { label: "Failed", cls: "bg-red-500/10 text-red-600 border-red-500/20" }
          : null;

  return (
    <div className="space-y-4 max-w-lg">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Brand</h2>
        <div className="space-y-1.5">
          <Label htmlFor="company">Company name</Label>
          <Input id="company" value={companyName} onChange={e => setCompanyName(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">Shown to your clients as "Powered by {companyName.trim() || "…"}" in their dashboard.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Logo</Label>
          <div className="flex items-center gap-3">
            {me.logoUrl ? (
              <img src={me.logoUrl} alt="Partner logo" className="h-10 w-10 rounded-lg object-contain bg-elevated border border-border p-1" />
            ) : (
              <div className="h-10 w-10 rounded-lg bg-elevated border border-border flex items-center justify-center text-muted-foreground">
                <Handshake className="w-4 h-4" />
              </div>
            )}
            <label className="inline-flex">
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogoChange} />
              <Button size="sm" variant="outline" asChild disabled={uploading}>
                <span className="cursor-pointer"><Upload className="w-3.5 h-3.5 mr-1.5" />{uploading ? "Uploading…" : me.logoUrl ? "Replace" : "Upload"}</span>
              </Button>
            </label>
            {me.logoUrl && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={removeLogoMutation.isPending}
                onClick={() => removeLogoMutation.mutate()}>
                <X className="w-3.5 h-3.5 mr-1" /> Remove
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">PNG, JPEG or WebP, up to 512KB.</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Login page</h2>
        <p className="text-[11px] text-muted-foreground -mt-1">
          One universal gateway for your clients. They use email + password only — Google is hidden on your domain.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="login-title">Headline</Label>
          <Input
            id="login-title"
            value={loginTitle}
            onChange={e => setLoginTitle(e.target.value)}
            placeholder={`Sign in to ${companyName.trim() || "your company"}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="login-subtitle">Supporting text</Label>
          <Input
            id="login-subtitle"
            value={loginSubtitle}
            onChange={e => setLoginSubtitle(e.target.value)}
            placeholder={`Use the email and password provided by ${companyName.trim() || "your company"}.`}
          />
        </div>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Link2 className="h-3 w-3" />
          Client login URL:{" "}
          <a className="underline underline-offset-2" href={me.loginUrl} target="_blank" rel="noreferrer">
            {me.loginUrl}
          </a>
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Your domain</h2>
        </div>
        <p className="text-[11px] text-muted-foreground -mt-2">
          Give clients a branded login URL. Start with a SnapServe subdomain; add your own domain when DNS is ready.
        </p>

        <div className="space-y-2">
          <Label htmlFor="slug">SnapServe subdomain</Label>
          <div className="flex gap-2">
            <Input
              id="slug"
              placeholder="acme"
              value={slugDraft}
              onChange={e => setSlugDraft(e.target.value.toLowerCase())}
              className="font-mono text-sm"
            />
            <Button
              size="sm"
              className="shrink-0"
              disabled={slugMutation.isPending || slugDraft.trim().length < 2}
              onClick={() => slugMutation.mutate()}
            >
              {slugMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
          {subdomainPreview && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Link2 className="h-3 w-3" />
              <a className="underline underline-offset-2" href={`https://${subdomainPreview}`} target="_blank" rel="noreferrer">
                https://{subdomainPreview}
              </a>
            </p>
          )}
          {me.slug && (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground px-0"
              disabled={clearSlugMutation.isPending}
              onClick={() => clearSlugMutation.mutate()}>
              Remove subdomain
            </Button>
          )}
        </div>

        <div className="border-t border-border/60 pt-3 space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="custom-domain">Custom domain</Label>
            {statusBadge && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${statusBadge.cls}`}>
                {statusBadge.label}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              id="custom-domain"
              placeholder="app.yourbrand.com"
              value={customDraft}
              onChange={e => setCustomDraft(e.target.value)}
              className="font-mono text-sm"
            />
            <Button
              size="sm"
              className="shrink-0"
              disabled={customMutation.isPending || customDraft.trim().length < 4}
              onClick={() => customMutation.mutate()}
            >
              {customMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
          {(me.customDomainStatus === "pending" || me.customDomainStatus === "failed" || me.customDomainStatus === "active") && me.customDomain && (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2 text-[11px] text-muted-foreground">
              <p className="font-medium text-foreground/80">DNS setup</p>
              <p>1. CNAME <code className="text-foreground">{me.customDomain}</code> → <code className="text-foreground">{me.cnameTarget}</code></p>
              {me.domainVerifyToken && (
                <p>
                  2. Or TXT <code className="text-foreground">_snapserve-verify.{me.customDomain}</code> ={" "}
                  <code className="text-foreground">snapserve-verify={me.domainVerifyToken}</code>
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  disabled={verifyMutation.isPending || me.customDomainStatus === "active"}
                  onClick={() => verifyMutation.mutate()}
                >
                  {me.customDomainStatus === "active"
                    ? <><CheckCircle2 className="h-3 w-3" /> Verified</>
                    : verifyMutation.isPending ? "Checking DNS…" : "Verify DNS"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  disabled={clearCustomMutation.isPending}
                  onClick={() => clearCustomMutation.mutate()}
                >
                  Remove
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Client emails</h2>
          {me.mailDomainStatus === "verified" && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
              Sending from your domain
            </span>
          )}
          {me.mailDomainStatus === "pending" && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-600 border-amber-500/20">
              Add DNS
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground -mt-1">
          Invites, passwords, and reset codes should come from your company — not SnapServe.
          Use an address on a domain you control (for example noreply@yourcompany.com), then add the DNS records.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="mail-name">From name</Label>
          <Input id="mail-name" value={mailName} onChange={e => setMailName(e.target.value)} placeholder={companyName.trim() || "Acme"} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mail-email">From email</Label>
          <Input
            id="mail-email"
            type="email"
            value={mailEmail}
            onChange={e => setMailEmail(e.target.value)}
            placeholder="noreply@yourcompany.com"
            className="font-mono text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={saveMailMutation.isPending || !mailEmail.includes("@")}
            onClick={() => saveMailMutation.mutate()}
          >
            {saveMailMutation.isPending ? "Saving…" : "Save sending domain"}
          </Button>
          {me.mailFromEmail && me.mailDomainStatus !== "verified" && (
            <Button
              size="sm"
              variant="outline"
              disabled={verifyMailMutation.isPending}
              onClick={() => verifyMailMutation.mutate()}
            >
              {verifyMailMutation.isPending ? "Checking…" : "Check DNS"}
            </Button>
          )}
          {me.mailFromEmail && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={clearMailMutation.isPending}
              onClick={() => clearMailMutation.mutate()}
            >
              Remove
            </Button>
          )}
        </div>
        {(me.mailDnsRecords?.length ?? 0) > 0 && me.mailDomainStatus !== "verified" && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="px-2 py-1.5 font-medium">Type</th>
                  <th className="px-2 py-1.5 font-medium">Host</th>
                  <th className="px-2 py-1.5 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {me.mailDnsRecords.map((rec) => (
                  <tr key={rec.key} className="border-b border-border/60 last:border-0 align-top">
                    <td className="px-2 py-1.5 font-mono">{rec.type}</td>
                    <td className="px-2 py-1.5 font-mono break-all">{rec.host}</td>
                    <td className="px-2 py-1.5 font-mono break-all">
                      <button
                        type="button"
                        className="inline-flex items-start gap-1 text-left hover:underline"
                        onClick={() => {
                          void navigator.clipboard.writeText(rec.value);
                          toast({ title: "Copied DNS value" });
                        }}
                      >
                        <Copy className="h-3 w-3 mt-0.5 shrink-0" />
                        {rec.value}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Default client rate</h2>
        <div className="space-y-1.5">
          <Label htmlFor="default-rate">Rate for new clients (₹ per minute)</Label>
          <Input id="default-rate" inputMode="decimal" value={defaultRateText} onChange={e => setDefaultRateText(e.target.value)} />
          {ratePaise !== null && ratePaise >= me.baseRateCentsPerMin ? (
            <p className="text-[11px] text-muted-foreground">
              You earn {inr(ratePaise - me.baseRateCentsPerMin)} per minute at this rate (base {inr(me.baseRateCentsPerMin)}/min).
            </p>
          ) : (
            <p className="text-[11px] text-amber-400">Must be at least your base rate ({inr(me.baseRateCentsPerMin)}/min).</p>
          )}
        </div>
      </div>

      <Button
        disabled={saveMutation.isPending || companyName.trim().length < 2 || ratePaise === null || ratePaise < me.baseRateCentsPerMin}
        onClick={() => saveMutation.mutate()}>
        {saveMutation.isPending ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}
