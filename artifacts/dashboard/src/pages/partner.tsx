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
  Trash2, IndianRupee, ArrowRightLeft, Upload, X, Settings2,
} from "lucide-react";
import { useLocation } from "wouter";

/* ─── Types (mirror routes/partner.ts responses) ─────────────────────────── */

interface PartnerMe {
  companyName: string;
  status: string;
  baseRateCentsPerMin: number;
  defaultClientRateCentsPerMin: number;
  logoUrl: string | null;
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

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Your clients</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Open Control panel to manage each client&apos;s agents, numbers, rate, and wallet.
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">Base {inr(baseRate)}/min</span>
      </div>
      {isLoading ? (
        <div className="p-4 space-y-2 animate-pulse">{[0, 1, 2].map(i => <div key={i} className="h-10 rounded bg-muted" />)}</div>
      ) : clients.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <Users className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground mt-2">No clients yet. Send an invite from the Invites tab.</p>
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
                        title="Open client control panel in Partner Hub"
                        onClick={() => navigate(`/app/partner/clients/${encodeURIComponent(c.clerkId)}`)}
                      >
                        <Settings2 className="w-3 h-3 mr-1" /> Control panel
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
  const [defaultRateText, setDefaultRateText] = useState((me.defaultClientRateCentsPerMin / 100).toFixed(2));
  const [uploading, setUploading] = useState(false);

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
          ...(paise !== null ? { defaultClientRateCentsPerMin: paise } : {}),
        }),
      });
    },
    onSuccess: () => { toast({ title: "Settings saved" }); invalidate(); },
    onError: (err: Error) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
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
