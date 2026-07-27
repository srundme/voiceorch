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
import { Plus, Pencil, Handshake, Users, Mail } from "lucide-react";
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
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
  walletBalanceCents: number | null;
  clientCount: number;
}

interface PartnerClientRow {
  clerkId: string;
  name: string | null;
  email: string | null;
  status: string;
  walletBalanceCents: number;
  rateCentsPerMin: number;
  createdAt: string;
}

interface PartnerInviteRow {
  id: number;
  email: string;
  status: string;
  invitedAt: string;
}

interface PartnerDetail {
  clients: PartnerClientRow[];
  invites: PartnerInviteRow[];
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

  const { data, isLoading } = useQuery<{ partners: AdminPartner[] }>({
    queryKey: ["admin", "partners"],
    queryFn: () => adminFetch("/partners"),
  });
  const partners = data?.partners ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminPartner | null>(null);
  const [detailTarget, setDetailTarget] = useState<AdminPartner | null>(null);

  // Create form state
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [baseRateText, setBaseRateText] = useState("5.00");
  const [defaultRateText, setDefaultRateText] = useState("6.00");

  // Edit form state
  const [editCompany, setEditCompany] = useState("");
  const [editBaseText, setEditBaseText] = useState("");
  const [editDefaultText, setEditDefaultText] = useState("");
  const [editStatus, setEditStatus] = useState("active");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "partners"] });

  const createMutation = useMutation({
    mutationFn: () =>
      adminFetch("/partners", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          companyName: company.trim(),
          baseRateCentsPerMin: rupeesToPaise(baseRateText),
          defaultClientRateCentsPerMin: rupeesToPaise(defaultRateText),
        }),
      }),
    onSuccess: () => {
      toast({ title: "Partner created" });
      setCreateOpen(false);
      setEmail(""); setCompany("");
      invalidate();
    },
    onError: (err) => toast({ title: "Could not create partner", description: formatAdminError(err), variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      adminFetch(`/partners/${editTarget!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          companyName: editCompany.trim(),
          baseRateCentsPerMin: rupeesToPaise(editBaseText),
          defaultClientRateCentsPerMin: rupeesToPaise(editDefaultText),
          status: editStatus,
        }),
      }),
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
    setEditDefaultText(paiseToRupeesText(p.defaultClientRateCentsPerMin));
    setEditStatus(p.status);
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">All partners ({partners.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : partners.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No partners yet. Create one from an existing user account.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Base rate</TableHead>
                  <TableHead className="text-right">Default rate</TableHead>
                  <TableHead className="text-right">Clients</TableHead>
                  <TableHead className="text-right">Wallet</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.companyName}</TableCell>
                    <TableCell>
                      <div className="leading-tight">
                        <p>{p.userName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{p.userEmail ?? p.userId}</p>
                      </div>
                    </TableCell>
                    <TableCell>{statusBadge(p.status)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCentsToDollars(p.baseRateCentsPerMin)}/min</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCentsToDollars(p.defaultClientRateCentsPerMin)}/min</TableCell>
                    <TableCell className="text-right tabular-nums">{p.clientCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.walletBalanceCents != null ? formatCentsToDollars(p.walletBalanceCents) : "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setDetailTarget(p)}>
                          <Users className="w-3.5 h-3.5 mr-1" /> Clients
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
            <DialogDescription>Upgrades an existing user account to a partner. The user must have signed up already.</DialogDescription>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Base rate (₹/min)</Label>
                <Input inputMode="decimal" value={baseRateText} onChange={e => setBaseRateText(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">Platform's share per client-minute.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Default client rate (₹/min)</Label>
                <Input inputMode="decimal" value={defaultRateText} onChange={e => setDefaultRateText(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={createMutation.isPending || !email.includes("@") || company.trim().length < 2 || rupeesToPaise(baseRateText) === null || rupeesToPaise(defaultRateText) === null}
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
            <DialogDescription>{editTarget?.userEmail}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Company name</Label>
              <Input value={editCompany} onChange={e => setEditCompany(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Base rate (₹/min)</Label>
                <Input inputMode="decimal" value={editBaseText} onChange={e => setEditBaseText(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Default client rate (₹/min)</Label>
                <Input inputMode="decimal" value={editDefaultText} onChange={e => setEditDefaultText(e.target.value)} />
              </div>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button
              disabled={editMutation.isPending || editCompany.trim().length < 2 || rupeesToPaise(editBaseText) === null || rupeesToPaise(editDefaultText) === null}
              onClick={() => editMutation.mutate()}>
              {editMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <PartnerDetailDialog partner={detailTarget} onClose={() => setDetailTarget(null)} />
    </div>
  );
}

function PartnerDetailDialog({ partner, onClose }: { partner: AdminPartner | null; onClose: () => void }) {
  const { data, isLoading } = useQuery<PartnerDetail>({
    queryKey: ["admin", "partner-detail", partner?.id],
    enabled: !!partner,
    queryFn: () => adminFetch(`/partners/${partner!.id}/clients`),
  });

  return (
    <Dialog open={!!partner} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{partner?.companyName} — clients</DialogTitle>
          <DialogDescription>
            {data ? <>Earnings this month: {formatCentsToDollars(data.monthEarningsCents)}</> : "…"}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Clients ({data?.clients.length ?? 0})
              </h3>
              {data?.clients.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Wallet</TableHead>
                      <TableHead className="text-right">Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.clients.map(c => (
                      <TableRow key={c.clerkId}>
                        <TableCell>
                          <p className="leading-tight">{c.name ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">{c.email}</p>
                        </TableCell>
                        <TableCell>{statusBadge(c.status)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCentsToDollars(c.rateCentsPerMin)}/min</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCentsToDollars(c.walletBalanceCents)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{fmtDate(c.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No clients yet.</p>
              )}
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Invites ({data?.invites.length ?? 0})
              </h3>
              {data?.invites.length ? (
                <div className="space-y-1">
                  {data.invites.map(i => (
                    <div key={i.id} className="flex items-center justify-between text-sm border border-border rounded-md px-3 py-1.5">
                      <span>{i.email}</span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {fmtDate(i.invitedAt)} {statusBadge(i.status)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No invites.</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
