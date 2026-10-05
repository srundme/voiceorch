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
import { Plus, Pencil, Handshake, Users, Mail, Clock, X, ExternalLink, Eye, Copy, Check } from "lucide-react";
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
                placeholder="SANJAY"
                className="font-mono text-sm uppercase"
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
        <DialogContent className="max-w-md">
          <DialogHeader>
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
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Company name</Label>
              <Input value={editCompany} onChange={e => setEditCompany(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Referral code</Label>
              <Input
                value={editReferralCode}
                onChange={e => setEditReferralCode(e.target.value.toUpperCase())}
                placeholder="SANJAY"
                className="font-mono text-sm uppercase"
              />
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
            <div className="space-y-1.5">
              <Label>Base rate (₹/min)</Label>
              <Input inputMode="decimal" value={editBaseText} onChange={e => setEditBaseText(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">
                Client pricing is managed by the partner. Raising the base rate above their current client rate lifts that rate to match.
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
                Suspended: clients bill at the standard platform rate and the partner earns no spread.
              </p>
            </div>
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
                Max number of agents that can be created in that account. Leave blank for unlimited.
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
                Max number of clients that can be added in that account. Leave blank for unlimited.
              </p>
            </div>
          </div>
          <DialogFooter>
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
          {/* Top Info Grid: Partner credentials, portal URL, referral, concurrency */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* User Gmail & Account */}
            <div className="rounded-lg border border-border bg-card p-3 space-y-1 text-xs">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Partner User (User Gmail)</span>
              <p className="font-semibold text-foreground text-sm">{partner.userName || "—"}</p>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="font-mono text-xs text-muted-foreground truncate">{partner.userEmail ?? partner.userId}</span>
                {partner.userEmail && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => copyToClipboard(partner.userEmail!, "User Gmail", "userEmail")}
                  >
                    {copiedKey === "userEmail" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  </Button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">Clerk ID: <span className="font-mono">{partner.userId}</span></p>
            </div>

            {/* Portal URL */}
            <div className="rounded-lg border border-border bg-card p-3 space-y-1 text-xs">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Branded Portal URL (Users URL)</span>
              {partner.portalUrl ? (
                <>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <a
                      href={partner.portalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-primary hover:underline truncate inline-flex items-center gap-1"
                    >
                      {partner.portalUrl}
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
                      onClick={() => copyToClipboard(partner.portalUrl!, "Portal URL", "portalUrl")}
                    >
                      {copiedKey === "portalUrl" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Custom Domain: {partner.customDomain ?? "None"} · Subdomain: {partner.slug ? `${partner.slug}.snapserve.ai` : "None"}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground pt-1 italic">No branded portal URL set</p>
              )}
            </div>

            {/* Referral Code & Link */}
            <div className="rounded-lg border border-border bg-card p-3 space-y-1 text-xs">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Referral Code & Link</span>
              <div className="flex items-center gap-2 pt-0.5">
                {partner.referralCode ? (
                  <Badge variant="outline" className="font-mono text-xs uppercase px-2 py-0.5 font-bold">
                    {partner.referralCode}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground italic">No code set</span>
                )}
                <span className="text-[11px] text-muted-foreground ml-auto">{partner.referredCount ?? 0} referred walk-ins</span>
              </div>
              {referralLink && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="font-mono text-[11px] text-muted-foreground truncate">{referralLink}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => copyToClipboard(referralLink, "Referral Link", "referralLink")}
                  >
                    {copiedKey === "referralLink" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </div>
              )}
            </div>

            {/* Concurrency & Rates */}
            <div className="rounded-lg border border-border bg-card p-3 space-y-1 text-xs">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Concurrency & Economics</span>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Concurrency Pool:</span>
                  <span className="font-semibold text-foreground">{partner.concurrentLimit ?? 10} lines</span>
                  <span className="text-[10px] text-muted-foreground block">{partner.allocatedConcurrency ?? 0} allocated</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Base / Default Rate:</span>
                  <span className="font-semibold text-foreground">
                    {formatCentsToDollars(partner.baseRateCentsPerMin)} / {formatCentsToDollars(partner.defaultClientRateCentsPerMin)}
                  </span>
                </div>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-border/50 text-[11px]">
                <span className="text-muted-foreground">Wallet: <span className="font-medium text-foreground">{formatCentsToDollars(partner.walletBalanceCents ?? 0)}</span></span>
                <span className="text-muted-foreground">Month Earnings: <span className="font-medium text-emerald-500">{data ? formatCentsToDollars(data.monthEarningsCents) : "—"}</span></span>
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

            <TabsContent value="referrals" className="mt-3">
              {isLoading ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Loading referrals…</p>
              ) : !data?.referrals?.length ? (
                <div className="p-6 text-center border border-dashed border-border rounded-lg text-xs text-muted-foreground">
                  No walk-in referral signups yet.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {data.referrals.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-xs border border-border rounded-md px-3 py-2 bg-card">
                      <div>
                        <p className="font-medium">{r.userName || r.userEmail || "Signed up user"}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">{r.userEmail ?? r.userId} · Code: {r.referralCode}</p>
                      </div>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        {fmtDate(r.createdAt)} {statusBadge(r.status)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
