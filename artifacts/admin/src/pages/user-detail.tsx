import { useState } from "react";
import { format } from "date-fns";
import { useParams, Link, useLocation } from "wouter";
import {
  useUserDetail,
  useSetConcurrentLimit,
  useSetUserStatus,
  useEditUserProfile,
  useUserProviders,
  useUserCalls,
  useUserWalletTransactions,
  useUserAgents,
  useCreditWallet,
  useDebitWallet,
  useRefundWallet,
  useAdminDeleteAgent,
  useAdminCreateAgent,
  useImpersonateUser,
  useUserAuditLogs,
  useSendEmailToUser,
  usePlatformEmails,
} from "@/hooks/use-admin-api";
import { formatCentsToDollars, formatDuration } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, Wallet, PhoneCall, Bot, Activity, Zap, ShieldAlert, LogIn,
  ClipboardList, Key, ChevronLeft, ChevronRight, Trash2, AlertTriangle, Pencil, Plus, Mail,
  CheckCircle2, XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";

type Tab = "overview" | "agents" | "providers" | "calls" | "wallet" | "audit" | "emails";

function StatusBadge({ status }: { status?: string }) {
  if (status === "suspended") return <Badge variant="destructive">Suspended</Badge>;
  if (status === "deleted") return <Badge variant="outline" className="text-muted-foreground">Deleted</Badge>;
  return <Badge variant="default" className="bg-emerald-600">Active</Badge>;
}

export default function UserDetail() {
  const { clerkId } = useParams<{ clerkId: string }>();
  const { data, isLoading } = useUserDetail(clerkId || "");
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("overview");

  // Mutations
  const setConcurrentLimit = useSetConcurrentLimit(clerkId || "");
  const setStatus = useSetUserStatus(clerkId || "");
  const editProfile = useEditUserProfile(clerkId || "");
  const creditWallet = useCreditWallet(clerkId || "");
  const debitWallet = useDebitWallet(clerkId || "");
  const refundWallet = useRefundWallet(clerkId || "");
  const deleteAgent = useAdminDeleteAgent(clerkId || "");
  const createAgent = useAdminCreateAgent(clerkId || "");
  const impersonate = useImpersonateUser();
  const sendEmailToUser = useSendEmailToUser(clerkId || "");
  const [, setLocation] = useLocation();

  // Email state
  const [emailModal, setEmailModal] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailsPage, setEmailsPage] = useState(1);
  const userEmails = usePlatformEmails({ userId: clerkId || "", page: emailsPage });

  // Dialog states
  const [concurrentModal, setConcurrentModal] = useState(false);
  const [newConcurrentLimit, setNewConcurrentLimit] = useState("");

  const [suspendModal, setSuspendModal] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");

  const [deleteUserModal, setDeleteUserModal] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");

  const [profileModal, setProfileModal] = useState(false);
  const [profileEmail, setProfileEmail] = useState("");
  const [profileName, setProfileName] = useState("");

  const [walletModal, setWalletModal] = useState<"credit" | "debit" | "refund" | null>(null);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletDesc, setWalletDesc] = useState("");
  const [walletCallId, setWalletCallId] = useState("");

  // Pagination
  const [callsPage, setCallsPage] = useState(1);
  const [txPage, setTxPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);

  // Sub-resource data
  const providers = useUserProviders(clerkId || "");
  const calls = useUserCalls(clerkId || "", callsPage);
  const transactions = useUserWalletTransactions(clerkId || "", txPage);
  const agents = useUserAgents(clerkId || "");
  const auditLogs = useUserAuditLogs(clerkId || "", auditPage);

  const handleConcurrentLimit = () => {
    const limit = parseInt(newConcurrentLimit, 10);
    if (isNaN(limit) || limit < 1) { toast({ title: "Invalid limit", variant: "destructive" }); return; }
    setConcurrentLimit.mutate({ concurrentLimit: limit }, {
      onSuccess: () => { toast({ title: "Concurrent limit updated" }); setConcurrentModal(false); },
      onError: (e) => toast({ title: "Failed", description: formatApiError(e), variant: "destructive" }),
    });
  };

  const handleSuspend = () => {
    setStatus.mutate({ status: "suspended", reason: suspendReason || undefined }, {
      onSuccess: () => { toast({ title: "User suspended" }); setSuspendModal(false); },
      onError: (e) => toast({ title: "Failed", description: formatApiError(e), variant: "destructive" }),
    });
  };

  const handleReactivate = () => {
    setStatus.mutate({ status: "active" }, {
      onSuccess: () => toast({ title: "User reactivated" }),
      onError: (e) => toast({ title: "Failed", description: formatApiError(e), variant: "destructive" }),
    });
  };

  const handleDelete = () => {
    if (deleteConfirmEmail.trim() !== (user.email || "")) {
      toast({ title: "Email doesn't match", description: "Type the user's exact email to confirm.", variant: "destructive" });
      return;
    }
    setStatus.mutate({ status: "deleted" }, {
      onSuccess: () => { toast({ title: "User deleted (soft)" }); setDeleteUserModal(false); setDeleteConfirmEmail(""); },
      onError: (e) => toast({ title: "Failed", description: formatApiError(e), variant: "destructive" }),
    });
  };

  const handleEditProfile = () => {
    const patch: Record<string, string> = {};
    if (profileEmail) patch["email"] = profileEmail;
    if (profileName) patch["name"] = profileName;
    if (!Object.keys(patch).length) { toast({ title: "Nothing to update", variant: "destructive" }); return; }
    editProfile.mutate(patch, {
      onSuccess: () => { toast({ title: "Profile updated" }); setProfileModal(false); },
      onError: (e) => toast({ title: "Failed", description: formatApiError(e), variant: "destructive" }),
    });
  };

  const handleWallet = () => {
    const cents = Math.round(parseFloat(walletAmount) * 100);
    if (isNaN(cents) || cents <= 0) { toast({ title: "Invalid amount", variant: "destructive" }); return; }
    const opts = { amountCents: cents, description: walletDesc || undefined };
    const mutation = walletModal === "credit" ? creditWallet : walletModal === "debit" ? debitWallet : refundWallet;
    const payload = walletModal === "refund" && walletCallId
      ? { ...opts, callId: parseInt(walletCallId, 10) }
      : opts;
    mutation.mutate(payload as any, {
      onSuccess: () => { toast({ title: "Wallet updated" }); setWalletModal(null); setWalletAmount(""); setWalletDesc(""); setWalletCallId(""); },
      onError: (e) => toast({ title: "Failed", description: formatApiError(e), variant: "destructive" }),
    });
  };

  const handleImpersonate = () => {
    impersonate.mutate(clerkId || "", {
      onSuccess: (result) => {
        const base = window.location.origin;
        const name = encodeURIComponent(result.userName || "");
        const email = encodeURIComponent(result.userEmail || "");
        const returnTo = encodeURIComponent(window.location.href);
        const url = `${base}/impersonate?code=${result.exchangeCode}&imp_token=${result.sessionToken}&imp_name=${name}&imp_email=${email}&return_to=${returnTo}`;
        window.open(url, "_blank");
        toast({ title: "Impersonation session started", description: "Dashboard opened in a new tab" });
      },
      onError: (e) => toast({ title: "Impersonation failed", description: formatApiError(e), variant: "destructive" }),
    });
  };

  if (isLoading) return <div className="p-8 text-muted-foreground animate-pulse">Loading user details…</div>;
  if (!data?.user) return <div className="p-8 text-destructive">User not found.</div>;

  const { user } = data;
  const isSuspended = user.status === "suspended";
  const isDeleted = user.status === "deleted";

  const handleSendEmail = () => {
    if (!emailSubject || !emailBody) {
      toast({ title: "Subject and body required", variant: "destructive" }); return;
    }
    const htmlBody = emailBody.includes("<") ? emailBody : emailBody.split("\n").map(l => `<p>${l}</p>`).join("");
    sendEmailToUser.mutate(
      { subject: emailSubject, htmlBody, emailType: "manual" },
      {
        onSuccess: () => {
          toast({ title: "Email sent successfully" });
          setEmailModal(false);
          setEmailSubject("");
          setEmailBody("");
          userEmails.refetch();
        },
        onError: (e) => toast({ title: "Failed to send email", description: formatApiError(e), variant: "destructive" }),
      },
    );
  };

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: "overview", label: "Overview", icon: Activity },
    { key: "agents", label: "Agents", icon: Bot },
    { key: "providers", label: "Providers", icon: Key },
    { key: "calls", label: "Calls", icon: PhoneCall },
    { key: "wallet", label: "Wallet", icon: Wallet },
    { key: "audit", label: "Audit", icon: ClipboardList },
    { key: "emails", label: "Emails", icon: Mail },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <Button variant="outline" size="icon" asChild className="shrink-0">
          <Link href="/users"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight truncate">{user.email}</h1>
            <StatusBadge status={user.status} />
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-1">{user.clerkId}</p>
          <p className="text-sm text-muted-foreground">{user.name || "No name"}</p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={handleImpersonate}
            disabled={impersonate.isPending || isDeleted}
            className="gap-1.5"
          >
            <LogIn className="h-3.5 w-3.5" />
            {impersonate.isPending ? "Starting…" : "Login As User"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setProfileEmail(user.email || ""); setProfileName(user.name || ""); setProfileModal(true); }}>
            Edit Profile
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setEmailSubject(""); setEmailBody(""); setEmailModal(true); }}
            disabled={!user.email}
            className="gap-1.5"
          >
            <Mail className="h-3.5 w-3.5" />
            Send Email
          </Button>
          {!isSuspended && !isDeleted && (
            <Button size="sm" variant="destructive" onClick={() => setSuspendModal(true)} className="gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5" /> Suspend
            </Button>
          )}
          {isSuspended && (
            <Button size="sm" variant="default" onClick={handleReactivate} disabled={setStatus.isPending} className="bg-emerald-600 hover:bg-emerald-700">
              Reactivate
            </Button>
          )}
          {!isDeleted && (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteUserModal(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab === key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ─────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5" /> Wallet
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold font-mono ${user.walletBalanceCents < 0 ? "text-destructive" : ""}`}>
                  {formatCentsToDollars(user.walletBalanceCents || 0)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" /> Concurrent Limit
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono">{user.concurrentLimit ?? 10}</div>
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => { setNewConcurrentLimit(String(user.concurrentLimit ?? 10)); setConcurrentModal(true); }}>
                  Set Limit
                </Button>
              </CardContent>
            </Card>
            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Profile</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="block text-xs text-muted-foreground mb-0.5">Name</span><span className="font-medium">{user.name || "N/A"}</span></div>
                <div><span className="block text-xs text-muted-foreground mb-0.5">Email</span><span className="font-medium truncate">{user.email || "N/A"}</span></div>
                <div><span className="block text-xs text-muted-foreground mb-0.5">Joined</span><span className="font-mono text-xs">{user.createdAt ? format(new Date(user.createdAt), "yyyy-MM-dd") : "—"}</span></div>
                <div><span className="block text-xs text-muted-foreground mb-0.5">Onboarding</span><Badge variant={user.onboardingCompleted ? "outline" : "secondary"} className="text-[10px]">{user.onboardingCompleted ? "Complete" : "Pending"}</Badge></div>
                {user.status === "suspended" && (
                  <div className="col-span-2">
                    <span className="block text-xs text-muted-foreground mb-0.5">Suspend reason</span>
                    <span className="text-destructive text-xs">{user.suspendedReason || "No reason given"}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {user.onboardingData && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Signup Details
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <span className="block text-xs text-muted-foreground mb-0.5">Role</span>
                  <span className="font-medium capitalize">{user.onboardingData.role || "—"}</span>
                </div>
                <div>
                  <span className="block text-xs text-muted-foreground mb-0.5">Referral Source</span>
                  <span className="font-medium capitalize">{user.onboardingData.referralSource?.replace(/_/g, " ") || "—"}</span>
                </div>
                <div>
                  <span className="block text-xs text-muted-foreground mb-0.5">Used Voice Agents Before</span>
                  <span className="font-medium">
                    {user.onboardingData.usedVoiceAgents === true
                      ? "Yes"
                      : user.onboardingData.usedVoiceAgents === false
                      ? "No"
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="block text-xs text-muted-foreground mb-0.5">Prior Platforms</span>
                  <span className="font-medium">
                    {Array.isArray(user.onboardingData.priorPlatforms) && user.onboardingData.priorPlatforms.length > 0
                      ? user.onboardingData.priorPlatforms.join(", ")
                      : "—"}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Agents Tab ───────────────────────────────────────────── */}
      {tab === "agents" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={createAgent.isPending}
              onClick={() => {
                createAgent.mutate({
                  name: "New Agent",
                  asrProvider: "azure",
                  llmProvider: "openai",
                  ttsProvider: "cartesia",
                  telephonyProvider: "twilio",
                  systemPrompt: "You are a helpful assistant.",
                  status: "inactive",
                }, {
                  onSuccess: (newAgent: any) => {
                    toast({ title: "Agent created" });
                    setLocation(`/users/${clerkId}/agents/${newAgent.id}`);
                  },
                  onError: (e) => toast({ title: "Failed", description: formatApiError(e), variant: "destructive" }),
                });
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {createAgent.isPending ? "Creating…" : "Create Agent"}
            </Button>
          </div>
          <div className="border border-border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>ASR</TableHead>
                  <TableHead>LLM</TableHead>
                  <TableHead>TTS</TableHead>
                  <TableHead>Calls</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center h-20 text-muted-foreground animate-pulse">Loading…</TableCell></TableRow>
                ) : (agents.data ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center h-20 text-muted-foreground">No agents</TableCell></TableRow>
                ) : (
                  (agents.data ?? []).map((agent: any) => (
                    <TableRow key={agent.id}>
                      <TableCell className="font-medium">{agent.name}</TableCell>
                      <TableCell>
                        <Badge variant={agent.status === "active" ? "default" : "secondary"} className="text-[10px] uppercase">{agent.status || "inactive"}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{agent.asrProvider || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{agent.llmProvider || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{agent.ttsProvider || "—"}</TableCell>
                      <TableCell className="text-xs font-mono">{agent.totalCalls ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-muted-foreground hover:text-foreground"
                            onClick={() => setLocation(`/users/${clerkId}/agents/${agent.id}`)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive h-7 px-2"
                            disabled={deleteAgent.isPending}
                            onClick={() => {
                              if (!confirm(`Delete agent "${agent.name}"?`)) return;
                              deleteAgent.mutate(agent.id, {
                                onSuccess: () => toast({ title: "Agent deleted" }),
                                onError: (e) => toast({ title: "Failed", description: formatApiError(e), variant: "destructive" }),
                              });
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* ── Providers Tab ────────────────────────────────────────── */}
      {tab === "providers" && (
        <div className="border border-border rounded-lg bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Type</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>API Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center h-20 text-muted-foreground animate-pulse">Loading…</TableCell></TableRow>
              ) : (providers.data ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center h-20 text-muted-foreground">No providers configured</TableCell></TableRow>
              ) : (
                (providers.data ?? []).map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell><Badge variant="outline" className="text-[10px] uppercase">{p.providerType}</Badge></TableCell>
                    <TableCell className="font-medium capitalize">{p.providerName}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.apiKeyHint}</TableCell>
                    <TableCell>
                      <Badge variant={p.isActive ? "default" : "secondary"} className="text-[10px]">{p.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.createdAt ? format(new Date(p.createdAt), "MMM d, yyyy") : "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Calls Tab ────────────────────────────────────────────── */}
      {tab === "calls" && (
        <div className="space-y-3">
          <div className="border border-border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center h-20 animate-pulse text-muted-foreground">Loading…</TableCell></TableRow>
                ) : (calls.data?.data ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center h-20 text-muted-foreground">No calls found</TableCell></TableRow>
                ) : (
                  (calls.data?.data ?? []).map((call: any) => (
                    <TableRow key={call.id}>
                      <TableCell>
                        <Badge variant={call.status === "completed" ? "default" : call.status === "failed" ? "destructive" : "secondary"} className="text-[10px] uppercase">{call.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{format(new Date(call.createdAt), "MMM d HH:mm")}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{call.agentId ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs font-mono">{formatDuration(call.durationSeconds || 0)}</TableCell>
                      <TableCell className="text-right text-xs font-mono">{formatCentsToDollars(call.costCents || 0)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <PaginationBar
            page={callsPage}
            total={calls.data?.total ?? 0}
            pageSize={calls.data?.pageSize ?? 50}
            onPage={setCallsPage}
          />
        </div>
      )}

      {/* ── Wallet Tab ───────────────────────────────────────────── */}
      {tab === "wallet" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <Card className="flex-1 min-w-[160px]">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground uppercase mb-1">Balance</p>
                <p className={`text-2xl font-bold font-mono ${user.walletBalanceCents < 0 ? "text-destructive" : ""}`}>
                  {formatCentsToDollars(user.walletBalanceCents || 0)}
                </p>
              </CardContent>
            </Card>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="default" className="bg-emerald-600 hover:bg-emerald-700 gap-1.5" onClick={() => { setWalletAmount(""); setWalletDesc(""); setWalletModal("credit"); }}>
                + Credit
              </Button>
              <Button size="sm" variant="destructive" onClick={() => { setWalletAmount(""); setWalletDesc(""); setWalletModal("debit"); }}>
                – Debit
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setWalletAmount(""); setWalletDesc(""); setWalletCallId(""); setWalletModal("refund"); }}>
                Refund
              </Button>
            </div>
          </div>

          <div className="border border-border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.isLoading ? (
                  <TableRow><TableCell colSpan={4} className="text-center h-20 animate-pulse text-muted-foreground">Loading…</TableCell></TableRow>
                ) : (transactions.data?.data ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center h-20 text-muted-foreground">No transactions</TableCell></TableRow>
                ) : (
                  (transactions.data?.data ?? []).map((tx: any) => (
                    <TableRow key={tx.id}>
                      <TableCell className="text-xs font-mono text-muted-foreground">{format(new Date(tx.createdAt), "MMM d HH:mm")}</TableCell>
                      <TableCell className="text-xs capitalize">{tx.type}</TableCell>
                      <TableCell className="text-xs truncate max-w-[200px]" title={tx.description}>{tx.description}</TableCell>
                      <TableCell className={`text-right text-xs font-mono tabular-nums ${tx.amountCents > 0 ? "text-emerald-500" : "text-destructive"}`}>
                        {tx.amountCents > 0 ? "+" : ""}{formatCentsToDollars(tx.amountCents)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <PaginationBar
            page={txPage}
            total={transactions.data?.total ?? 0}
            pageSize={transactions.data?.pageSize ?? 100}
            onPage={setTxPage}
          />
        </div>
      )}

      {/* ── Audit Tab ────────────────────────────────────────────── */}
      {tab === "audit" && (
        <div className="space-y-3">
          <div className="border border-border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[160px]">Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Before</TableHead>
                  <TableHead>After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center h-20 animate-pulse text-muted-foreground">Loading…</TableCell></TableRow>
                ) : (auditLogs.data?.data ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center h-20 text-muted-foreground">No admin actions on this account</TableCell></TableRow>
                ) : (
                  (auditLogs.data?.data ?? []).map((row: any) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs font-mono text-muted-foreground">{format(new Date(row.createdAt), "MMM d HH:mm:ss")}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] font-mono">{row.action}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">{row.targetResourceType ?? "—"}</TableCell>
                      <TableCell className="text-xs"><pre className="font-mono text-[10px] text-muted-foreground truncate max-w-[140px]">{row.beforeValue ? JSON.stringify(row.beforeValue) : "—"}</pre></TableCell>
                      <TableCell className="text-xs"><pre className="font-mono text-[10px] text-muted-foreground truncate max-w-[140px]">{row.afterValue ? JSON.stringify(row.afterValue) : "—"}</pre></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <PaginationBar
            page={auditPage}
            total={auditLogs.data?.total ?? 0}
            pageSize={auditLogs.data?.pageSize ?? 50}
            onPage={setAuditPage}
          />
        </div>
      )}

      {/* ── Emails Tab ────────────────────────────────────────────── */}
      {tab === "emails" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{userEmails.data?.total ?? 0} emails sent to this user</span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setEmailSubject(""); setEmailBody(""); setEmailModal(true); }}>
              <Mail className="h-3.5 w-3.5" /> Send Email
            </Button>
          </div>
          <div className="border border-border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[140px]">Date</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userEmails.isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center h-20 animate-pulse text-muted-foreground">Loading…</TableCell></TableRow>
                ) : (userEmails.data?.data ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center h-20 text-muted-foreground">No emails sent to this user yet.</TableCell></TableRow>
                ) : (
                  (userEmails.data?.data ?? []).map((row: any) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">{format(new Date(row.sentAt), "MMM d HH:mm")}</TableCell>
                      <TableCell className="text-sm">{row.subject}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{row.emailType}</Badge></TableCell>
                      <TableCell>
                        {row.status === "sent"
                          ? <span className="text-emerald-400 text-xs inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 shrink-0" />Sent</span>
                          : <span className="text-destructive text-xs inline-flex items-center gap-1"><XCircle className="h-3 w-3 shrink-0" />Failed</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.sentBy}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <PaginationBar
            page={emailsPage}
            total={userEmails.data?.total ?? 0}
            pageSize={userEmails.data?.pageSize ?? 50}
            onPage={setEmailsPage}
          />
        </div>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────── */}

      {/* Send Email */}
      <Dialog open={emailModal} onOpenChange={setEmailModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Send Email to {user.email}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label>Subject</Label>
              <Input placeholder="Subject…" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Body <span className="text-muted-foreground text-xs">(plain text or HTML)</span></Label>
              <Textarea
                placeholder={`Hi ${user.name ?? "there"},\n\nYour message here…`}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                className="min-h-[160px] font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailModal(false)}>Cancel</Button>
            <Button onClick={handleSendEmail} disabled={sendEmailToUser.isPending} className="gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              {sendEmailToUser.isPending ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Concurrent limit */}
      <Dialog open={concurrentModal} onOpenChange={setConcurrentModal}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader><DialogTitle>Set Concurrent Call Limit</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-3">
            <Label>Limit</Label>
            <Input type="number" min="1" value={newConcurrentLimit} onChange={(e) => setNewConcurrentLimit(e.target.value)} className="font-mono" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConcurrentModal(false)}>Cancel</Button>
            <Button onClick={handleConcurrentLimit} disabled={setConcurrentLimit.isPending}>{setConcurrentLimit.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend */}
      <Dialog open={suspendModal} onOpenChange={setSuspendModal}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-destructive" /> Suspend User</DialogTitle>
            <DialogDescription>The user will lose access to their dashboard immediately.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-3">
            <Label>Reason (optional)</Label>
            <Textarea placeholder="Reason for suspension…" value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendModal(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleSuspend} disabled={setStatus.isPending}>{setStatus.isPending ? "Suspending…" : "Suspend User"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete user */}
      <Dialog
        open={deleteUserModal}
        onOpenChange={(o) => { setDeleteUserModal(o); if (!o) setDeleteConfirmEmail(""); }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> Delete User</DialogTitle>
            <DialogDescription>
              This soft-deletes the account — the data is retained but the user can no longer log in.
              This action cannot be undone from this screen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-1">
            <Label>
              Type <span className="font-mono font-semibold text-foreground">{user.email}</span> to confirm
            </Label>
            <Input
              value={deleteConfirmEmail}
              onChange={(e) => setDeleteConfirmEmail(e.target.value)}
              placeholder={user.email || ""}
              autoComplete="off"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && deleteConfirmEmail.trim() === (user.email || "") && !setStatus.isPending) {
                  handleDelete();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteUserModal(false); setDeleteConfirmEmail(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={setStatus.isPending || deleteConfirmEmail.trim() !== (user.email || "")}
            >
              {setStatus.isPending ? "Deleting…" : "Delete User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit profile */}
      <Dialog open={profileModal} onOpenChange={setProfileModal}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>Edit Profile</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-3">
            <div className="grid gap-1.5"><Label>Email</Label><Input value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Name</Label><Input value={profileName} onChange={(e) => setProfileName(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileModal(false)}>Cancel</Button>
            <Button onClick={handleEditProfile} disabled={editProfile.isPending}>{editProfile.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wallet credit/debit/refund */}
      <Dialog open={walletModal !== null} onOpenChange={(o) => !o && setWalletModal(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {walletModal === "credit" && "Credit Wallet"}
              {walletModal === "debit" && "Debit Wallet"}
              {walletModal === "refund" && "Issue Refund"}
            </DialogTitle>
            <DialogDescription>
              Current balance: <strong>{formatCentsToDollars(user.walletBalanceCents || 0)}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-3">
            <div className="grid gap-1.5">
              <Label>Amount (INR)</Label>
              <Input type="number" min="0.01" step="0.01" placeholder="e.g. 10.00" value={walletAmount} onChange={(e) => setWalletAmount(e.target.value)} className="font-mono" />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Textarea placeholder="Reason…" value={walletDesc} onChange={(e) => setWalletDesc(e.target.value)} />
            </div>
            {walletModal === "refund" && (
              <div className="grid gap-1.5">
                <Label>Call ID (optional)</Label>
                <Input type="number" placeholder="e.g. 1234" value={walletCallId} onChange={(e) => setWalletCallId(e.target.value)} className="font-mono" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWalletModal(null)}>Cancel</Button>
            <Button
              variant={walletModal === "debit" ? "destructive" : "default"}
              onClick={handleWallet}
              disabled={creditWallet.isPending || debitWallet.isPending || refundWallet.isPending}
            >
              {walletModal === "credit" && "Add Credits"}
              {walletModal === "debit" && "Deduct Credits"}
              {walletModal === "refund" && "Issue Refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaginationBar({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>Page {page} of {totalPages} ({total.toLocaleString()} total)</span>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => onPage(page + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}
