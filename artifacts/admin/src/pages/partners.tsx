import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, formatCentsToDollars } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Handshake, Users, Mail, Clock, X, ExternalLink, Eye, Copy, Check, Gift, Lock, Unlock, TrendingUp, PhoneCall, Wallet, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatAdminError } from "@/lib/api";

/* ── Types (mirror routes/admin-partners.ts) ─────────────────────────────── */

interface AdminPartner {
  id: number;
  userId: string;
  companyName: string;
  status: string;
  baseRateCentsPerMin: number;
  defaultClientRateCentsPerMin: number;
  concurrentLimit?: number;
  allocatedConcurrency?: number;
  referralCode?: string | null;
  referredCount?: number;
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
  walletBalanceCents: number | null;
  clientCount: number;
  slug?: string | null;
  customDomain?: string | null;
  customDomainStatus?: string | null;
  /** Client login URL (custom domain if active, else subdomain). */
  portalUrl?: string | null;
  maxAgents?: number | null;
  maxClients?: number | null;
  referralAttributionDays?: number;
  referralCommissionPercent?: number;
  referralCommissionMonths?: number;
  referralMinRechargedUsers?: number;
  referralTargetMinutes?: number;
  referralRewardMinutes?: number;
  referralCompletedCycles?: number;
  referralAudienceBonusPercent?: number;
  referralAudienceFreeMinutes?: number;
}

interface PartnerClientRow {
  clerkId: string;
  name: string | null;
  email: string | null;
  status: string;
  walletBalanceCents: number;
  rateCentsPerMin: number;
  concurrentLimit?: number;
  referredByCode?: string | null;
  signupSource?: string | null;
  createdAt: string;
}

interface PartnerInviteRow {
  id: number;
  email: string;
  status: string;
  invitedAt: string;
}

interface PartnerReferralRow {
  id: number;
  referralCode: string;
  userId: string;
  userEmail?: string | null;
  userName?: string | null;
  status: string;
  firstRechargeAt?: string | null;
  rechargeCount?: number;
  totalRechargedPaise?: number;
  totalEarnedPaise?: number;
  minutesPurchased?: number;
  createdAt: string;
}

/** Admin-created partner setup for an email that hasn't signed up yet. */
interface PendingPromotion {
  id: number;
  email: string;
  companyName: string;
  baseRateCentsPerMin: number;
  defaultClientRateCentsPerMin: number;
  referralCode?: string | null;
  createdAt: string;
  /** Email now has an account (password signup) — needs explicit approval. */
  hasAccount?: boolean;
}

interface PartnerDetail {
  clients: PartnerClientRow[];
  invites: PartnerInviteRow[];
  referrals?: PartnerReferralRow[];
  rechargedUsersCount?: number;
  targetMinutes?: number;
  rewardMinutes?: number;
  completedCycles?: number;
  totalAudienceMinutes?: number;
  currentCycleMinutes?: number;
  minutesRemainingInCycle?: number;
  pendingEarningsCents?: number;
  unlockedEarningsCents?: number;
  monthEarningsCents: number;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const rupeesToPaise = (text: string): number | null => {
  const v = Number.parseFloat(text);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100);
};
const paiseToRupeesText = (paise: number) => (paise / 100).toFixed(2);
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function statusBadge(status: string) {
  return status === "active"
    ? <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/20">active</Badge>
    : <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/20">{status}</Badge>;
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function PartnersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ partners: AdminPartner[]; pending?: PendingPromotion[] }>({
    queryKey: ["admin", "partners"],
    queryFn: () => adminFetch("/partners"),
  });
  const partners = data?.partners ?? [];
  const pendingList = data?.pending ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminPartner | null>(null);
  const [detailTarget, setDetailTarget] = useState<AdminPartner | null>(null);

  // Create form state
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [baseRateText, setBaseRateText] = useState("5.00");
  const [concurrency, setConcurrency] = useState("10");
  const [referralCode, setReferralCode] = useState("");

  // Edit form state
  const [editCompany, setEditCompany] = useState("");
  const [editBaseText, setEditBaseText] = useState("");
  const [editConcurrency, setEditConcurrency] = useState("10");
  const [editReferralCode, setEditReferralCode] = useState("");
  const [editStatus, setEditStatus] = useState("active");
  const [editMaxAgents, setEditMaxAgents] = useState("");
  const [editMaxClients, setEditMaxClients] = useState("");
  const [editReferralAttributionDays, setEditReferralAttributionDays] = useState("60");
  const [editReferralCommissionPercent, setEditReferralCommissionPercent] = useState("10");
  const [editReferralCommissionMonths, setEditReferralCommissionMonths] = useState("6");
  const [editReferralMinRechargedUsers, setEditReferralMinRechargedUsers] = useState("10");
  const [editReferralTargetMinutes, setEditReferralTargetMinutes] = useState("5000");
  const [editReferralRewardMinutes, setEditReferralRewardMinutes] = useState("500");
  const [editReferralAudienceBonusPercent, setEditReferralAudienceBonusPercent] = useState("10");
  const [editReferralAudienceFreeMinutes, setEditReferralAudienceFreeMinutes] = useState("100");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "partners"] });

  const createMutation = useMutation({
    mutationFn: () =>
      adminFetch("/partners", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          companyName: company.trim(),
          baseRateCentsPerMin: rupeesToPaise(baseRateText),
          concurrentLimit: parseInt(concurrency, 10) || 10,
          referralCode: referralCode.trim() ? referralCode.trim().toUpperCase() : undefined,
          // Client pricing is the partner's own setting (their panel);
          // the server starts it at max(base, ₹5) until they change it.
        }),
      }),
    onSuccess: (resp: { partner?: unknown; pending?: unknown }) => {
      if (resp?.pending) {
        toast({
          title: "Partner saved — awaiting signup",
          description: "No account with that email yet. It becomes a partner automatically the moment they sign up.",
        });
      } else {
        toast({ title: "Partner created" });
      }
      setCreateOpen(false);
      setEmail(""); setCompany(""); setReferralCode(""); setConcurrency("10");
      invalidate();
    },
    onError: (err) => toast({ title: "Could not create partner", description: formatAdminError(err), variant: "destructive" }),
  });

  const applyPendingMutation = useMutation({
    mutationFn: (id: number) => adminFetch(`/partners/pending/${id}/apply`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Partner approved", description: "The account is now an active partner." });
      invalidate();
    },
    onError: (err) => toast({ title: "Could not approve", description: formatAdminError(err), variant: "destructive" }),
  });

  const cancelPendingMutation = useMutation({
    mutationFn: (id: number) => adminFetch(`/partners/pending/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Pending partner cancelled" });
      invalidate();
    },
    onError: (err) => toast({ title: "Could not cancel", description: formatAdminError(err), variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: () => {
      const parsedAgents = editMaxAgents.trim() === "" ? null : parseInt(editMaxAgents.trim(), 10);
      const parsedClients = editMaxClients.trim() === "" ? null : parseInt(editMaxClients.trim(), 10);
      return adminFetch(`/partners/${editTarget!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          companyName: editCompany.trim(),
          baseRateCentsPerMin: rupeesToPaise(editBaseText),
          concurrentLimit: parseInt(editConcurrency, 10) || 10,
          referralCode: editReferralCode.trim() ? editReferralCode.trim().toUpperCase() : null,
          status: editStatus,
          maxAgents: isNaN(parsedAgents as number) ? null : parsedAgents,
          maxClients: isNaN(parsedClients as number) ? null : parsedClients,
          referralAttributionDays: parseInt(editReferralAttributionDays, 10) || 60,
          referralCommissionPercent: parseInt(editReferralCommissionPercent, 10) || 10,
          referralCommissionMonths: parseInt(editReferralCommissionMonths, 10) || 6,
          referralMinRechargedUsers: parseInt(editReferralMinRechargedUsers, 10) || 10,
          referralTargetMinutes: parseInt(editReferralTargetMinutes, 10) || 5000,
          referralRewardMinutes: parseInt(editReferralRewardMinutes, 10) || 500,
          referralAudienceBonusPercent: parseInt(editReferralAudienceBonusPercent, 10) || 10,
          referralAudienceFreeMinutes: parseInt(editReferralAudienceFreeMinutes, 10) || 100,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Partner updated" });
      setEditTarget(null);
      invalidate();
    },
    onError: (err) => toast({ title: "Could not update partner", description: formatAdminError(err), variant: "destructive" }),
  });

  const openEdit = (p: AdminPartner) => {
    setEditTarget(p);
    setEditCompany(p.companyName);
    setEditBaseText(paiseToRupeesText(p.baseRateCentsPerMin));
    setEditConcurrency(String(p.concurrentLimit ?? 10));
    setEditReferralCode(p.referralCode ?? "");
    setEditStatus(p.status);
    setEditMaxAgents(p.maxAgents != null ? String(p.maxAgents) : "");
    setEditMaxClients(p.maxClients != null ? String(p.maxClients) : "");
    setEditReferralAttributionDays(String(p.referralAttributionDays ?? 60));
    setEditReferralCommissionPercent(String(p.referralCommissionPercent ?? 10));
    setEditReferralCommissionMonths(String(p.referralCommissionMonths ?? 6));
    setEditReferralMinRechargedUsers(String(p.referralMinRechargedUsers ?? 10));
    setEditReferralTargetMinutes(String(p.referralTargetMinutes ?? 5000));
    setEditReferralRewardMinutes(String(p.referralRewardMinutes ?? 500));
    setEditReferralAudienceBonusPercent(String(p.referralAudienceBonusPercent ?? 10));
    setEditReferralAudienceFreeMinutes(String(p.referralAudienceFreeMinutes ?? 100));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Handshake className="w-5 h-5" /> Partners</h1>
          <p className="text-sm text-muted-foreground">
            Resellers who onboard clients. The base rate is what the platform charges the partner per client-minute; the spread above it is the partner's margin.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1.5" /> New partner</Button>
      </div>

      {pendingList.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-500" /> Awaiting signup ({pendingList.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Google signups become partners automatically. Password signups can't verify email ownership, so once the account appears here, approve it with one click.
            </p>
            {pendingList.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-sm border border-border rounded-md px-3 py-2">
                <div className="leading-tight min-w-0">
                  <p className="font-medium truncate">{p.companyName}</p>
                  <p className="text-xs text-muted-foreground truncate">{p.email}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs tabular-nums text-muted-foreground hidden sm:inline">
                    base {formatCentsToDollars(p.baseRateCentsPerMin)}/min
                  </span>
                  <span className="text-xs text-muted-foreground hidden md:inline">{fmtDate(p.createdAt)}</span>
                  {p.hasAccount ? (
                    <Button
                      size="sm" className="h-7"
                      disabled={applyPendingMutation.isPending}
                      onClick={() => applyPendingMutation.mutate(p.id)}>
                      Approve
                    </Button>
                  ) : (
                    <span className="text-[11px] rounded-full border border-border px-2 py-0.5 text-muted-foreground whitespace-nowrap">awaiting signup</span>
                  )}
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 px-2 text-destructive hover:text-destructive"
                    disabled={cancelPendingMutation.isPending}
                    onClick={() => cancelPendingMutation.mutate(p.id)}
                    title="Cancel pending partner">
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">All partners ({partners.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : partners.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No partners yet. "New partner" upgrades an existing user — or pre-creates one for an email that hasn't signed up.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Base rate</TableHead>
                  <TableHead className="text-right">Concurrency</TableHead>
                  <TableHead className="text-right">Clients</TableHead>
                  <TableHead className="text-right">Wallet</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.map(p => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-semibold text-foreground">{p.companyName}</div>
                      {p.referralCode ? (
                        <Badge variant="outline" className="font-mono text-[10px] uppercase mt-0.5 px-1.5 py-0">
                          {p.referralCode}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="leading-tight">
                        <p className="font-medium text-xs">{p.userName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{p.userEmail ?? p.userId}</p>
                      </div>
                    </TableCell>
                    <TableCell>{statusBadge(p.status)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCentsToDollars(p.baseRateCentsPerMin)}/min</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="font-semibold">{p.concurrentLimit ?? 10} lines</div>
                      {p.allocatedConcurrency != null && p.allocatedConcurrency > 0 ? (
                        <div className="text-[11px] text-muted-foreground">{p.allocatedConcurrency} allocated</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.clientCount}
                      {p.maxClients != null ? <span className="text-muted-foreground text-xs font-normal"> / {p.maxClients}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.walletBalanceCents != null ? formatCentsToDollars(p.walletBalanceCents) : "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setDetailTarget(p)} title="View partner details, portal URL, and clients">
                          <Eye className="w-3.5 h-3.5 mr-1" /> View
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
                          <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New partner</DialogTitle>
            <DialogDescription>
              Existing users are upgraded to a partner immediately. If the email has no account yet, the partner is activated automatically when they sign up.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>User email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="partner@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Company name</Label>
              <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Acme Communications" />
            </div>
            <div className="space-y-1.5">
              <Label>Referral code (optional)</Label>
              <Input
                value={referralCode}
                onChange={e => setReferralCode(e.target.value.toUpperCase())}
                placeholder="Create Your Referral Code"
                className="font-mono text-sm uppercase placeholder:normal-case"
              />
              <p className="text-[11px] text-muted-foreground">
                Affiliate code for walk-in signups without direct invites.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Concurrent Call Limit (Pool)</Label>
              <Input
                type="number"
                min="1"
                max="10000"
                value={concurrency}
                onChange={e => setConcurrency(e.target.value)}
                placeholder="10"
              />
              <p className="text-[11px] text-muted-foreground">
                Total simultaneous active calls allowed across all client accounts of this partner.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Base rate (₹/min)</Label>
              <Input inputMode="decimal" value={baseRateText} onChange={e => setBaseRateText(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">
                Platform's share per client-minute. What the partner charges their clients is set by the partner in their own panel.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={createMutation.isPending || !email.includes("@") || company.trim().length < 2 || rupeesToPaise(baseRateText) === null}
              onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Creating…" : "Create partner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-w-lg max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden shadow-2xl">
          <DialogHeader className="p-5 pb-3 border-b shrink-0">
            <DialogTitle>Edit partner</DialogTitle>
            <DialogDescription>
              {editTarget?.userEmail}
              {editTarget?.portalUrl ? (
                <>
                  {" · "}
                  <a href={editTarget.portalUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {editTarget.portalUrl.replace(/^https:\/\//, "")}
                  </a>
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="p-5 overflow-y-auto space-y-4 flex-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Company name</Label>
                <Input value={editCompany} onChange={e => setEditCompany(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Referral code</Label>
                <Input
                  value={editReferralCode}
                  onChange={e => setEditReferralCode(e.target.value.toUpperCase())}
                  placeholder="Create Your Referral Code"
                  className="font-mono text-sm uppercase placeholder:normal-case"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Concurrent Call Limit (Pool)</Label>
              <Input
                type="number"
                min="1"
                max="10000"
                value={editConcurrency}
                onChange={e => setEditConcurrency(e.target.value)}
                placeholder="10"
              />
              <p className="text-[11px] text-muted-foreground">
                Total simultaneous active calls allowed across all client accounts of this partner.
                {editTarget?.allocatedConcurrency != null && editTarget.allocatedConcurrency > 0 && (
                  <span className={`block font-medium mt-0.5 ${(parseInt(editConcurrency, 10) || 0) < editTarget.allocatedConcurrency ? "text-amber-500" : "text-emerald-500"}`}>
                    Currently allocated across clients: {editTarget.allocatedConcurrency} lines.
                    {(parseInt(editConcurrency, 10) || 0) < editTarget.allocatedConcurrency && (
                      <> Set to at least {editTarget.allocatedConcurrency} so the partner has pool headroom.</>
                    )}
                  </span>
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Base rate (₹/min)</Label>
                <Input inputMode="decimal" value={editBaseText} onChange={e => setEditBaseText(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">
                  Client pricing base rate.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Suspended: clients bill standard rate.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Agent limit (max agents)</Label>
                <Input
                  type="number"
                  min="0"
                  value={editMaxAgents}
                  onChange={e => setEditMaxAgents(e.target.value)}
                  placeholder="Unlimited (leave blank)"
                />
                <p className="text-[11px] text-muted-foreground">
                  Max agents per account.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Client limit (max clients)</Label>
                <Input
                  type="number"
                  min="0"
                  value={editMaxClients}
                  onChange={e => setEditMaxClients(e.target.value)}
                  placeholder="Unlimited (leave blank)"
                />
                <p className="text-[11px] text-muted-foreground">
                  Max clients per account.
                </p>
              </div>
            </div>

            {/* Affiliate & Referral Program Configuration */}
            <div className="rounded-lg border border-primary/25 bg-primary/5 p-3.5 space-y-3 mt-2">
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold text-foreground tracking-wide">
                  Affiliate &amp; Referral Program Settings
                </span>
                <Badge variant="outline" className="text-[10px] ml-auto border-primary/30 text-primary">
                  Option A: 10-User Unlock
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Configure commission share, click attribution window, and Option A milestone rules for this partner.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Attribution Window (Days)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="365"
                    value={editReferralAttributionDays}
                    onChange={e => setEditReferralAttributionDays(e.target.value)}
                    placeholder="60"
                  />
                  <p className="text-[10px] text-muted-foreground">Cookie/click validity until signup.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Commission Share (%)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={editReferralCommissionPercent}
                    onChange={e => setEditReferralCommissionPercent(e.target.value)}
                    placeholder="10"
                  />
                  <p className="text-[10px] text-muted-foreground">% of each user wallet recharge.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Earning Duration (Months)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="60"
                    value={editReferralCommissionMonths}
                    onChange={e => setEditReferralCommissionMonths(e.target.value)}
                    placeholder="6"
                  />
                  <p className="text-[10px] text-muted-foreground">Months from user signup to earn.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Milestone Target Minutes</Label>
                  <Input
                    type="number"
                    min="100"
                    max="1000000"
                    value={editReferralTargetMinutes}
                    onChange={e => setEditReferralTargetMinutes(e.target.value)}
                    placeholder="5000"
                  />
                  <p className="text-[10px] text-muted-foreground">Target minutes purchased by audience (0/5000).</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Reward Free Minutes</Label>
                  <Input
                    type="number"
                    min="10"
                    max="100000"
                    value={editReferralRewardMinutes}
                    onChange={e => setEditReferralRewardMinutes(e.target.value)}
                    placeholder="500"
                  />
                  <p className="text-[10px] text-muted-foreground">Free minutes credited to partner wallet per cycle.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Legacy User Threshold (Optional)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="1000"
                    value={editReferralMinRechargedUsers}
                    onChange={e => setEditReferralMinRechargedUsers(e.target.value)}
                    placeholder="10"
                  />
                  <p className="text-[10px] text-muted-foreground">Fallback user count threshold.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-border/50 pt-2.5">
                <div className="space-y-1.5">
                  <Label className="text-xs">Audience Signup Free Minutes</Label>
                  <Input
                    type="number"
                    min="0"
                    max="1000"
                    value={editReferralAudienceFreeMinutes}
                    onChange={e => setEditReferralAudienceFreeMinutes(e.target.value)}
                    placeholder="100"
                  />
                  <p className="text-[10px] text-muted-foreground">Gifted calling minutes at signup.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Audience 1st Recharge Bonus (%)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={editReferralAudienceBonusPercent}
                    onChange={e => setEditReferralAudienceBonusPercent(e.target.value)}
                    placeholder="10"
                  />
                  <p className="text-[10px] text-muted-foreground">Extra wallet credit on 1st top-up.</p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="p-4 border-t bg-muted/20 shrink-0">
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button
              disabled={editMutation.isPending || editCompany.trim().length < 2 || rupeesToPaise(editBaseText) === null}
              onClick={() => editMutation.mutate()}>
              {editMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <PartnerDetailDialog partner={detailTarget} onClose={() => setDetailTarget(null)} onEdit={openEdit} />
    </div>
  );
}

function PartnerDetailDialog({
  partner,
  onClose,
  onEdit,
}: {
  partner: AdminPartner | null;
  onClose: () => void;
  onEdit?: (p: AdminPartner) => void;
}) {
  const { toast } = useToast();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery<PartnerDetail>({
    queryKey: ["admin", "partner-detail", partner?.id],
    enabled: !!partner,
    queryFn: () => adminFetch(`/partners/${partner!.id}/clients`),
  });

  const copyToClipboard = async (text: string, label: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast({ title: `${label} copied!`, description: text });
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  if (!partner) return null;

  const appBaseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const referralLink = partner.referralCode ? `${appBaseUrl}/signup?ref=${encodeURIComponent(partner.referralCode)}` : null;

  return (
    <Dialog open={!!partner} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader className="border-b border-border pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-lg font-semibold">{partner.companyName}</DialogTitle>
                {statusBadge(partner.status)}
              </div>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Partner ID #{partner.id} · Created {fmtDate(partner.createdAt)}
              </DialogDescription>
            </div>
            {onEdit && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { onClose(); onEdit(partner); }}>
                <Pencil className="w-3.5 h-3.5 mr-1" /> Edit Partner
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-y-auto flex-1 pr-1">
          {/* Top Row: 3 High-Impact KPI Stat Cards */}
          {(() => {
            const poolTotal = partner.concurrentLimit ?? 10;
            const poolAllocated = partner.allocatedConcurrency ?? 0;
            const poolFree = Math.max(0, poolTotal - poolAllocated);
            const poolPct = poolTotal > 0 ? Math.min(100, Math.round((poolAllocated / poolTotal) * 100)) : 0;
            const marginCents = Math.max(0, partner.defaultClientRateCentsPerMin - partner.baseRateCentsPerMin);

            return (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* 1. Concurrency Pool */}
                <div className="rounded-xl border border-border/70 bg-card/60 p-3.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-muted-foreground mb-1">
                    <span className="text-[11px] font-medium uppercase tracking-wider">Concurrency Pool</span>
                    <PhoneCall className="w-3.5 h-3.5 text-muted-foreground/70" />
                  </div>
                  <div className="my-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xl font-bold font-mono tracking-tight text-foreground">{poolFree}</span>
                      <span className="text-xs text-muted-foreground font-medium">/ {poolTotal} free lines</span>
                    </div>
                  </div>
                  <div className="space-y-1.5 pt-1.5 border-t border-border/40">
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${poolPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                      <span>{poolAllocated} allocated</span>
                      <span>{data?.clients.length ?? partner.clientCount} clients</span>
                    </div>
                  </div>
                </div>

                {/* 2. Economics & Margins */}
                <div className="rounded-xl border border-border/70 bg-card/60 p-3.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-muted-foreground mb-1">
                    <span className="text-[11px] font-medium uppercase tracking-wider">Economics</span>
                    <TrendingUp className="w-3.5 h-3.5 text-muted-foreground/70" />
                  </div>
                  <div className="my-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-base font-bold font-mono text-foreground">{formatCentsToDollars(partner.baseRateCentsPerMin)}</span>
                      <span className="text-xs text-muted-foreground">→</span>
                      <span className="text-base font-bold font-mono text-emerald-500">{formatCentsToDollars(partner.defaultClientRateCentsPerMin)}</span>
                      <span className="text-[10px] text-muted-foreground">/min</span>
                    </div>
                  </div>
                  <div className="pt-1.5 border-t border-border/40 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground text-[10px]">Client Margin</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-500/30 text-emerald-600 bg-emerald-500/10 font-mono font-medium">
                      +{formatCentsToDollars(marginCents)}/min
                    </Badge>
                  </div>
                </div>

                {/* 3. Wallet & Month Earnings */}
                <div className="rounded-xl border border-border/70 bg-card/60 p-3.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-muted-foreground mb-1">
                    <span className="text-[11px] font-medium uppercase tracking-wider">Financials</span>
                    <Wallet className="w-3.5 h-3.5 text-muted-foreground/70" />
                  </div>
                  <div className="my-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xl font-bold font-mono tracking-tight text-foreground">{formatCentsToDollars(partner.walletBalanceCents ?? 0)}</span>
                      <span className="text-[10px] text-muted-foreground">wallet</span>
                    </div>
                  </div>
                  <div className="pt-1.5 border-t border-border/40 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground text-[10px]">This Month</span>
                    <span className="font-semibold text-emerald-500 font-mono text-xs">
                      +{data ? formatCentsToDollars(data.monthEarningsCents) : "—"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Middle Row: 2 Clean Profile Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Card 1: Partner Account */}
            <div className="rounded-xl border border-border/70 bg-card/60 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Partner Account</span>
                <span className="text-[10px] font-mono text-muted-foreground/70">ID #{partner.id}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs uppercase shrink-0">
                  {partner.userName ? partner.userName.charAt(0) : partner.companyName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground text-sm truncate">{partner.userName || partner.companyName}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">{partner.userEmail ?? "No email set"}</p>
                </div>
                {partner.userEmail && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0 rounded-lg"
                    onClick={() => copyToClipboard(partner.userEmail!, "User Gmail", "userEmail")}
                  >
                    {copiedKey === "userEmail" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                )}
              </div>
            </div>

            {/* Card 2: Branded Portal & Referral */}
            <div className="rounded-xl border border-border/70 bg-card/60 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Portal & Referral</span>
                {partner.referralCode && (
                  <Badge variant="outline" className="font-mono text-[10px] uppercase px-1.5 py-0 font-bold bg-muted/40">
                    {partner.referralCode}
                  </Badge>
                )}
              </div>
              <div className="space-y-1.5">
                {partner.portalUrl ? (
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-muted/40 border border-border/50 text-xs">
                    <a
                      href={partner.portalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-primary hover:underline truncate inline-flex items-center gap-1.5"
                    >
                      <Globe className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="truncate">{partner.portalUrl}</span>
                      <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
                    </a>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground shrink-0"
                      onClick={() => copyToClipboard(partner.portalUrl!, "Portal URL", "portalUrl")}
                    >
                      {copiedKey === "portalUrl" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground italic px-2 py-1">No custom portal URL</div>
                )}
                {referralLink && (
                  <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground px-1">
                    <span className="truncate">{partner.referredCount ?? 0} referred walk-ins</span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                      onClick={() => copyToClipboard(referralLink, "Referral Link", "referralLink")}
                    >
                      {copiedKey === "referralLink" ? "Copied Link!" : "Copy Referral Link"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sub-sections: Tabs for Clients, Invites, and Referrals */}
          <Tabs defaultValue="clients" className="pt-2">
            <TabsList className="h-8">
              <TabsTrigger value="clients" className="text-xs">
                Clients ({data?.clients.length ?? partner.clientCount})
              </TabsTrigger>
              <TabsTrigger value="invites" className="text-xs">
                Invites ({data?.invites.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="referrals" className="text-xs">
                Referral Walk-ins ({data?.referrals?.length ?? partner.referredCount ?? 0})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="clients" className="mt-3">
              {isLoading ? (
                <p className="text-xs text-muted-foreground py-6 text-center">Loading clients…</p>
              ) : !data?.clients.length ? (
                <div className="p-6 text-center border border-dashed border-border rounded-lg text-xs text-muted-foreground">
                  No sub-clients created under this partner yet.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client Name</TableHead>
                        <TableHead>Client Gmail</TableHead>
                        <TableHead className="text-right">Concurrency</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Wallet</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Joined</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.clients.map((c, idx) => (
                        <TableRow key={c.clerkId}>
                          <TableCell className="font-medium">{c.name ?? "—"}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 font-mono text-[11px]">
                              <span className="font-medium text-foreground">{c.email ?? "—"}</span>
                              {c.email && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                                  onClick={() => copyToClipboard(c.email!, "Client Email", `clientEmail-${idx}`)}
                                >
                                  {copiedKey === `clientEmail-${idx}` ? <Check className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{c.concurrentLimit ?? 10} lines</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCentsToDollars(c.rateCentsPerMin)}/min</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCentsToDollars(c.walletBalanceCents)}</TableCell>
                          <TableCell>{statusBadge(c.status)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{fmtDate(c.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="invites" className="mt-3">
              {isLoading ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Loading invites…</p>
              ) : !data?.invites.length ? (
                <div className="p-6 text-center border border-dashed border-border rounded-lg text-xs text-muted-foreground">
                  No direct email invites sent.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {data.invites.map((i) => (
                    <div key={i.id} className="flex items-center justify-between text-xs border border-border rounded-md px-3 py-2 bg-card">
                      <span className="font-mono">{i.email}</span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        {fmtDate(i.invitedAt)} {statusBadge(i.status)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="referrals" className="mt-3 space-y-3">
              {isLoading ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Loading referrals…</p>
              ) : !data?.referrals?.length ? (
                <div className="p-6 text-center border border-dashed border-border rounded-lg text-xs text-muted-foreground">
                  No walk-in referral signups yet.
                </div>
              ) : (
                <>
                  {/* 5,000-Minute Cycle Milestone KPI Summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-2.5 rounded-lg border border-border bg-card">
                      <span className="text-[10px] text-muted-foreground uppercase font-medium block">Total Referrals</span>
                      <span className="text-base font-semibold text-foreground">{data.referrals.length}</span>
                      <span className="text-[10px] text-muted-foreground block">60d click attribution</span>
                    </div>

                    <div className="p-2.5 rounded-lg border border-border bg-card">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground uppercase font-medium">Cycle Progress</span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0 text-primary border-primary/30">
                          Cycle #{(data.completedCycles ?? 0) + 1}
                        </Badge>
                      </div>
                      <span className="text-base font-semibold text-foreground">
                        {(data.currentCycleMinutes ?? 0).toLocaleString()} <span className="text-xs text-muted-foreground font-normal">/ {(data.targetMinutes ?? 5000).toLocaleString()} mins</span>
                      </span>
                      <div className="w-full bg-muted rounded-full h-1 mt-1 overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${Math.min(100, Math.round(((data.currentCycleMinutes ?? 0) / ((data.targetMinutes ?? 5000) || 1)) * 100))}%` }}
                        />
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg border border-border bg-card">
                      <span className="text-[10px] text-muted-foreground uppercase font-medium block">Completed Cycles</span>
                      <span className="text-base font-semibold text-emerald-500">
                        {data.completedCycles ?? 0} <span className="text-xs text-muted-foreground font-normal">cycles</span>
                      </span>
                      <span className="text-[10px] text-muted-foreground block">
                        {(data.completedCycles ?? 0) * (data.rewardMinutes ?? 500)} mins rewarded
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg border border-border bg-card">
                      <span className="text-[10px] text-muted-foreground uppercase font-medium block">Total Paid Credits</span>
                      <span className="text-base font-semibold text-emerald-500">
                        {formatCentsToDollars(data.unlockedEarningsCents ?? 0)}
                      </span>
                      <span className="text-[10px] text-muted-foreground block">Credited to wallet</span>
                    </div>
                  </div>

                  {/* Referrals Breakdown Table */}
                  <div className="overflow-x-auto rounded-md border border-border">
                    <Table className="text-xs">
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Code</TableHead>
                          <TableHead className="text-right">Recharges</TableHead>
                          <TableHead className="text-right">Minutes Purchased</TableHead>
                          <TableHead className="text-right">Total Recharged</TableHead>
                          <TableHead className="text-right">Joined</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.referrals.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium text-foreground">{r.userName || "Referred user"}</p>
                                <p className="text-[11px] font-mono text-muted-foreground">{r.userEmail ?? r.userId}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                                {r.referralCode}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.rechargeCount ?? 0}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold text-primary">
                              {(r.minutesPurchased ?? 0).toLocaleString()} mins
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {formatCentsToDollars(r.totalRechargedPaise ?? 0)}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {fmtDate(r.createdAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
