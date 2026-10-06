import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { partnerFetch, type PartnerPermissions, type NavVisibility } from "@/hooks/use-partner";
import { PlanLimitModal } from "@/components/plan-limit-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Handshake, Users, UserPlus, User, Wallet, TrendingUp, Clock, Mail,
  Trash2, IndianRupee, ArrowRightLeft, Upload, X, Settings2, Globe, Link2, CheckCircle2, Copy, LifeBuoy, PhoneCall,
  Shield, Eye, Lock, Sparkles, ShieldAlert, MoreHorizontal,
} from "lucide-react";
import { useLocation } from "wouter";

/* ─── Types (mirror routes/partner.ts responses) ─────────────────────────── */

interface PartnerMe {
  companyName: string;
  status: string;
  baseRateCentsPerMin: number;
  defaultClientRateCentsPerMin: number;
  concurrentLimit?: number;
  allocatedConcurrency?: number;
  referralCode: string | null;
  referralLink: string;
  referredUsersCount: number;
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
  customDns?: {
    zone: string;
    host: string;
    isApex: boolean;
    records: Array<{ type: "CNAME" | "TXT"; host: string; value: string; required: boolean; purpose: string }>;
  } | null;
  mailFromName: string | null;
  mailFromEmail: string | null;
  mailDomainStatus: "none" | "pending" | "verified" | "failed";
  mailDnsRecords: Array<{ key: string; host: string; type: string; value: string; ok: boolean }>;
  supportEmail: string | null;
  supportUrl: string | null;
  docsUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  defaultClientPermissions?: PartnerPermissions | null;
  walletBalanceCents: number;
  clientCount: number;
  pendingInvites: number;
  monthEarningsCents: number;
  monthClientSeconds: number;
  monthClientCalls: number;
}

interface PartnerReferral {
  id: number;
  referralCode: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  status: string;
  createdAt: string;
}

interface PartnerClient {
  clerkId: string;
  name: string | null;
  email: string | null;
  status: string;
  walletBalanceCents: number;
  rateCentsPerMin: number;
  concurrentLimit?: number;
  allowAgentEdit?: boolean;
  partnerPermissions?: PartnerPermissions | null;
  loginLocked?: boolean;
  portalLoginFailedAttempts?: number;
  portalLoginLockedAt?: string | null;
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

/* ─── Client Feature Access & Permission Dialog ──────────────────────────── */

export const DEFAULT_FULL_PERMISSIONS: PartnerPermissions = {
  navVisibility: {
    agents: true,
    knowledge: true,
    squads: true,
    phoneNumbers: true,
    campaigns: true,
    flows: true,
    connections: true,
    bookings: true,
    callLogs: true,
    analytics: true,
    developers: true,
    settings: true,
    billing: true,
  },
  mode: "full",
};

const CAMPAIGN_ONLY_NAV: NavVisibility = {
  agents: false,
  knowledge: false,
  squads: false,
  phoneNumbers: false,
  campaigns: true,
  flows: false,
  connections: false,
  bookings: false,
  callLogs: true,
  analytics: true,
  developers: false,
  settings: false,
  billing: false,
};

const REPORTING_ONLY_NAV: NavVisibility = {
  agents: false,
  knowledge: false,
  squads: false,
  phoneNumbers: false,
  campaigns: false,
  flows: false,
  connections: false,
  bookings: false,
  callLogs: true,
  analytics: true,
  developers: false,
  settings: false,
  billing: false,
};

interface ClientPermissionsDialogProps {
  open: boolean;
  clientName: string;
  permissions: PartnerPermissions | null;
  onClose: () => void;
  onSave: (permissions: PartnerPermissions) => void;
  isSaving?: boolean;
}

function ClientPermissionsDialog({
  open, clientName, permissions, onClose, onSave, isSaving,
}: ClientPermissionsDialogProps) {
  const initialVis: NavVisibility = permissions?.navVisibility ?? DEFAULT_FULL_PERMISSIONS.navVisibility!;
  const [vis, setVis] = useState<NavVisibility>(initialVis);
  const [mode, setMode] = useState<"full" | "read_only">(permissions?.mode ?? "full");

  React.useEffect(() => {
    if (open) {
      setVis(permissions?.navVisibility ?? DEFAULT_FULL_PERMISSIONS.navVisibility!);
      setMode(permissions?.mode ?? "full");
    }
  }, [open, permissions]);

  const toggleVis = (key: keyof NavVisibility) => {
    setVis(prev => ({ ...prev, [key]: !(prev[key] !== false) }));
  };

  const applyPreset = (preset: "full" | "campaign" | "reporting" | "readonly") => {
    if (preset === "full") {
      setVis(DEFAULT_FULL_PERMISSIONS.navVisibility!);
      setMode("full");
    } else if (preset === "campaign") {
      setVis(CAMPAIGN_ONLY_NAV);
      setMode("full");
    } else if (preset === "reporting") {
      setVis(REPORTING_ONLY_NAV);
      setMode("read_only");
    } else if (preset === "readonly") {
      setVis(DEFAULT_FULL_PERMISSIONS.navVisibility!);
      setMode("read_only");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Shield className="w-5 h-5 text-primary shrink-0" />
            Client Access & Permissions
          </DialogTitle>
          <DialogDescription className="text-xs">
            Configure section visibility and edit rights for <span className="font-semibold text-foreground">{clientName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Quick Presets */}
          <div>
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
              Quick Presets
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" size="sm" className="h-8 justify-start text-xs" onClick={() => applyPreset("full")}>
                <Sparkles className="w-3.5 h-3.5 mr-1.5 text-amber-500 shrink-0" /> Full Access
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 justify-start text-xs" onClick={() => applyPreset("campaign")}>
                <PhoneCall className="w-3.5 h-3.5 mr-1.5 text-blue-500 shrink-0" /> Campaign Only
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 justify-start text-xs" onClick={() => applyPreset("reporting")}>
                <TrendingUp className="w-3.5 h-3.5 mr-1.5 text-emerald-500 shrink-0" /> Reporting Only
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 justify-start text-xs" onClick={() => applyPreset("readonly")}>
                <Eye className="w-3.5 h-3.5 mr-1.5 text-purple-500 shrink-0" /> Read-Only Mode
              </Button>
            </div>
          </div>

          {/* Access Rights Mode */}
          <div className="rounded-lg border border-border p-3 space-y-2 bg-card">
            <Label className="text-xs font-semibold text-foreground">Editing Permissions</Label>
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => setMode("full")}
                className={`flex items-center gap-2 p-2 rounded-md border text-left transition-colors cursor-pointer text-xs ${
                  mode === "full" ? "border-primary bg-primary/5 font-medium text-foreground" : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                <CheckCircle2 className={`w-4 h-4 shrink-0 ${mode === "full" ? "text-primary" : "text-muted-foreground/30"}`} />
                <div>
                  <p className="font-medium text-[12px]">Full Access</p>
                  <p className="text-[10px] text-muted-foreground">Can create & edit</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode("read_only")}
                className={`flex items-center gap-2 p-2 rounded-md border text-left transition-colors cursor-pointer text-xs ${
                  mode === "read_only" ? "border-primary bg-primary/5 font-medium text-foreground" : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                <Lock className={`w-4 h-4 shrink-0 ${mode === "read_only" ? "text-primary" : "text-muted-foreground/30"}`} />
                <div>
                  <p className="font-medium text-[12px]">Read-Only Mode</p>
                  <p className="text-[10px] text-muted-foreground">Can view only</p>
                </div>
              </button>
            </div>
          </div>

          {/* Section Visibility Switches */}
          <div className="space-y-2">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Section Visibility
            </Label>

            <div className="space-y-1 rounded-lg border border-border p-3 bg-card divide-y divide-border/40">
              {[
                { key: "agents", label: "Agents & Knowledge Base", desc: "Agent builder, prompts & knowledge files" },
                { key: "campaigns", label: "Campaigns & Outbound Dialing", desc: "Batch campaigns and lead lists" },
                { key: "callLogs", label: "Call Logs & Analytics", desc: "Transcripts, recordings & analytics" },
                { key: "phoneNumbers", label: "Phone Numbers", desc: "Assigned phone numbers & caller ID" },
                { key: "flows", label: "Flows & Connections", desc: "Multi-agent workflows & webhooks" },
                { key: "bookings", label: "Bookings & Scheduling", desc: "Meetings & scheduling calendar" },
                { key: "developers", label: "Developer API Keys", desc: "API keys & developer docs" },
                { key: "settings", label: "Workspace Settings", desc: "General workspace preferences" },
              ].map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                  <div className="pr-3">
                    <p className="text-xs font-medium text-foreground leading-snug">{label}</p>
                    <p className="text-[10px] text-muted-foreground leading-none mt-0.5">{desc}</p>
                  </div>
                  <Switch
                    checked={vis[key as keyof NavVisibility] !== false}
                    onCheckedChange={() => toggleVis(key as keyof NavVisibility)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={isSaving}
            onClick={() => onSave({ navVisibility: vis, mode })}
          >
            {isSaving ? "Saving…" : "Save Access Rights"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** DNS panels want Host relative to the zone, not the full hostname. */
function splitCustomDomain(fqdn: string): { host: string; zone: string } {
  const parts = fqdn.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (parts.length <= 2) return { host: "@", zone: fqdn };
  return { host: parts.slice(0, -2).join("."), zone: parts.slice(-2).join(".") };
}

function DnsCopyCell({ value }: { value: string }) {
  const { toast } = useToast();
  return (
    <button
      type="button"
      className="inline-flex items-start gap-1 text-left font-mono break-all hover:underline"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        toast({ title: "Copied" });
      }}
    >
      <Copy className="h-3 w-3 mt-0.5 shrink-0" />
      {value}
    </button>
  );
}

function CustomDomainDnsCard({
  domain,
  cnameTarget,
  verifyToken,
  dns,
  status,
  verifying,
  removing,
  onVerify,
  onRemove,
}: {
  domain: string;
  cnameTarget: string;
  verifyToken: string | null;
  dns: PartnerMe["customDns"];
  status: PartnerMe["customDomainStatus"];
  verifying: boolean;
  removing: boolean;
  onVerify: () => void;
  onRemove: () => void;
}) {
  const split = splitCustomDomain(domain);
  const zone = dns?.zone ?? split.zone;
  const host = dns?.host ?? split.host;
  const isApex = dns?.isApex ?? host === "@";
  const records = dns?.records ?? [
    ...(!isApex
      ? [{ type: "CNAME" as const, host, value: cnameTarget, required: true, purpose: "Sends visitors to your branded login" }]
      : []),
    ...(verifyToken
      ? [{
          type: "TXT" as const,
          host: isApex ? "_snapserve-verify" : `_snapserve-verify.${host}`,
          value: `snapserve-verify=${verifyToken}`,
          required: isApex,
          purpose: isApex ? "Proves you own the domain" : "Optional if the CNAME is already live",
        }]
      : []),
  ];

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3 text-[11px] text-muted-foreground">
      <div className="space-y-1">
        <p className="font-medium text-foreground">Add these records in DNS for <span className="font-mono">{zone}</span></p>
        <p>
          Open your domain registrar (GoDaddy, Cloudflare, Namecheap, Google Domains, etc.) and edit DNS for{" "}
          <span className="font-mono text-foreground">{zone}</span>. Put only the Host column in the Host/Name field — not the full website address.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-border bg-background">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="px-2 py-1.5 font-medium">Type</th>
              <th className="px-2 py-1.5 font-medium">Host</th>
              <th className="px-2 py-1.5 font-medium">Value / Points to</th>
              <th className="px-2 py-1.5 font-medium">Need this?</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec) => (
              <tr key={`${rec.type}-${rec.host}`} className="border-b border-border/60 last:border-0 align-top">
                <td className="px-2 py-1.5 font-mono text-foreground">{rec.type}</td>
                <td className="px-2 py-1.5 text-foreground"><DnsCopyCell value={rec.host} /></td>
                <td className="px-2 py-1.5 text-foreground"><DnsCopyCell value={rec.value} /></td>
                <td className="px-2 py-1.5">
                  {rec.required ? <span className="text-foreground font-medium">Required</span> : "Optional"}
                  <span className="block text-[10px] leading-snug mt-0.5">{rec.purpose}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="list-disc pl-4 space-y-1 leading-relaxed">
        <li>
          Host is <span className="font-mono text-foreground">{host}</span>
          {host !== "@" && <> — never <span className="font-mono">{domain}</span></>}.
        </li>
        {!isApex && (
          <li>Delete any A or AAAA record on that same Host first. A CNAME cannot share the name.</li>
        )}
        {isApex && (
          <li>
            Root domains cannot use a CNAME. Add the TXT row, then an ALIAS / ANAME / flattened CNAME to{" "}
            <span className="font-mono text-foreground">{cnameTarget}</span> if your DNS host supports it.
          </li>
        )}
        <li>Cloudflare: Proxy status must be DNS only (grey cloud), not Proxied.</li>
        <li>TTL can stay Auto or 300. Wait a few minutes, then click Verify DNS.</li>
        <li>
          Verify means this hostname has an address on the public internet — not only that a CNAME/TXT row exists.
          If the browser still says NXDOMAIN, the target <span className="font-mono text-foreground">{cnameTarget}</span> is not live yet.
        </li>
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          disabled={verifying || status === "active"}
          onClick={onVerify}
        >
          {status === "active"
            ? <><CheckCircle2 className="h-3 w-3" /> Verified</>
            : verifying ? "Checking DNS…" : "Verify DNS"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground"
          disabled={removing}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </div>
  );
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

function ReferralLinkCard({ me, description }: { me: PartnerMe; description?: string }) {
  const { toast } = useToast();
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-medium">Your Affiliate / Referral Link</h2>
        </div>
        {me.referralCode && (
          <Badge variant="outline" className="font-mono text-xs uppercase px-2 py-0.5">
            Code: {me.referralCode}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {description || "Share your referral link or code with prospective clients. When they sign up on SnapServe, they are automatically tracked as your referred users."}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          readOnly
          value={me.referralLink || ""}
          placeholder="Configure your referral code in Settings to activate your link"
          className="font-mono text-xs bg-muted/30"
        />
        <div className="flex gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            disabled={!me.referralLink}
            onClick={async () => {
              if (!me.referralLink) return;
              try {
                await navigator.clipboard.writeText(me.referralLink);
                toast({ title: "Referral link copied!", description: me.referralLink });
              } catch {
                toast({ title: "Failed to copy link" });
              }
            }}
          >
            <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy Link
          </Button>
          {me.referralCode && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(me.referralCode!);
                  toast({ title: "Referral code copied!", description: me.referralCode! });
                } catch {
                  toast({ title: "Failed to copy code" });
                }
              }}
            >
              Copy Code
            </Button>
          )}
        </div>
      </div>
    </div>
  );
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
      <div className="p-6 w-full max-w-5xl mx-auto space-y-4 animate-pulse">
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
    <div className="p-6 w-full max-w-5xl mx-auto">
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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard icon={<TrendingUp className="w-3.5 h-3.5" />} label="Earnings this month" value={inr(me.monthEarningsCents)} sub="Spread over your base rate" />
        <StatCard icon={<Users className="w-3.5 h-3.5" />} label="Clients" value={String(me.clientCount)} sub={me.pendingInvites > 0 ? `${me.pendingInvites} invite${me.pendingInvites > 1 ? "s" : ""} pending` : undefined} />
        <StatCard icon={<PhoneCall className="w-3.5 h-3.5" />} label="Concurrency pool" value={`${me.allocatedConcurrency ?? 0} / ${me.concurrentLimit ?? 10}`} sub={`${Math.max(0, (me.concurrentLimit ?? 10) - (me.allocatedConcurrency ?? 0))} lines free`} />
        <StatCard icon={<UserPlus className="w-3.5 h-3.5" />} label="Referral signups" value={String(me.referredUsersCount ?? 0)} sub={me.referralCode ? `Code: ${me.referralCode}` : "Affiliate walk-ins"} />
        <StatCard icon={<Wallet className="w-3.5 h-3.5" />} label="Your wallet" value={inr(me.walletBalanceCents)} sub="Earnings land here" />
      </div>

      {/* Referral & Affiliate Share Card */}
      <ReferralLinkCard me={me} />

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
  const [concurrencyClient, setConcurrencyClient] = useState<PartnerClient | null>(null);
  const [permissionsClient, setPermissionsClient] = useState<PartnerClient | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRateText, setCreateRateText] = useState((me.defaultClientRateCentsPerMin / 100).toFixed(2));
  const [createConcurrencyText, setCreateConcurrencyText] = useState("5");
  const [sendCredentials, setSendCredentials] = useState(true);
  const [rateText, setRateText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [concurrencyText, setConcurrencyText] = useState("");
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [clientLimit, setClientLimit] = useState<number | null>(null);

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
      const concurrency = Number.parseInt(createConcurrencyText, 10);
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
          ...(Number.isFinite(concurrency) && concurrency > 0 ? { concurrentLimit: concurrency } : {}),
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
      setCreateConcurrencyText("5");
      invalidate();
    },
    onError: (err: any) => {
      const errorCode = err?.errorCode || err?.data?.errorCode;
      const limitVal = err?.limit ?? err?.data?.limit;
      if (errorCode === "CLIENT_LIMIT_REACHED" || String(err?.message || "").includes("Client limit reached")) {
        setClientLimit(limitVal ?? null);
        setLimitModalOpen(true);
        setCreateOpen(false);
        return;
      }
      toast({ title: "Could not create client", description: err.message, variant: "destructive" });
    },
  });

  const concurrencyMutation = useMutation({
    mutationFn: async ({ clerkId, concurrentLimit }: { clerkId: string; concurrentLimit: number }) =>
      partnerFetch(getToken, `/api/partner/clients/${encodeURIComponent(clerkId)}`, {
        method: "PATCH",
        body: JSON.stringify({ concurrentLimit }),
      }),
    onSuccess: () => {
      toast({ title: "Concurrency limit updated" });
      setConcurrencyClient(null);
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Could not update concurrency", description: err.message, variant: "destructive" }),
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

  const unlockMutation = useMutation({
    mutationFn: async (clerkId: string) =>
      partnerFetch(getToken, `/api/partner/clients/${encodeURIComponent(clerkId)}/unlock-login`, {
        method: "POST",
      }),
    onSuccess: () => {
      toast({ title: "Client login unlocked" });
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Unlock failed", description: err.message, variant: "destructive" }),
  });

  const permissionsMutation = useMutation({
    mutationFn: async ({ clerkId, partnerPermissions }: { clerkId: string; partnerPermissions: PartnerPermissions }) =>
      partnerFetch(getToken, `/api/partner/clients/${encodeURIComponent(clerkId)}`, {
        method: "PATCH",
        body: JSON.stringify({ partnerPermissions }),
      }),
    onSuccess: () => {
      toast({ title: "Feature access permissions updated" });
      setPermissionsClient(null);
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Could not update permissions", description: err.message, variant: "destructive" }),
  });

  const createRatePaise = parseRupees(createRateText);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold text-foreground">Your clients</h2>
          <p className="text-xs text-muted-foreground">
            Create accounts with email + password. Clients sign in on your branded login page.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <div className="h-8 px-3 rounded-md bg-muted/50 border border-border text-xs text-muted-foreground flex items-center gap-1.5 font-medium">
            <span className="size-1.5 rounded-full bg-primary shrink-0" />
            <span className="text-foreground font-semibold tabular-nums">{me.allocatedConcurrency ?? 0}/{me.concurrentLimit ?? 10}</span>
            <span>Lines Used</span>
            {Math.max(0, (me.concurrentLimit ?? 10) - (me.allocatedConcurrency ?? 0)) > 0 && (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold ml-0.5">
                ({Math.max(0, (me.concurrentLimit ?? 10) - (me.allocatedConcurrency ?? 0))} free)
              </span>
            )}
          </div>
          <div className="h-8 px-3 rounded-md bg-muted/50 border border-border text-xs text-muted-foreground flex items-center gap-1 font-medium">
            <span>Base</span>
            <span className="font-semibold text-foreground tabular-nums">{inr(baseRate)}/min</span>
          </div>
          <Button size="sm" className="h-8 text-xs gap-1.5 shadow-sm" onClick={() => {
            const available = Math.max(1, (me.concurrentLimit ?? 10) - (me.allocatedConcurrency ?? 0));
            setCreateConcurrencyText(String(Math.min(5, available)));
            setCreateOpen(true);
          }}>
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
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-3 py-3 font-medium">Balance</th>
                <th className="px-3 py-3 font-medium">Rate</th>
                <th className="px-3 py-3 font-medium">Concurrency</th>
                <th className="px-3 py-3 font-medium">This month</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clients.map(c => {
                const marginCents = c.rateCentsPerMin - baseRate;
                const displayName = c.name || c.email || c.clerkId;

                return (
                  <tr key={c.clerkId} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/20">
                          <User className="size-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate max-w-[200px]">
                            {displayName}
                          </p>
                          {c.email && (
                            <p className="text-[11px] text-muted-foreground truncate max-w-[200px] mt-0.5">
                              {c.email}
                            </p>
                          )}
                        </div>
                        {c.loginLocked && (
                          <Badge variant="destructive" className="shrink-0 text-[10px] font-normal">Locked</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums font-semibold text-foreground">
                      {inr(c.walletBalanceCents)}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-foreground">{inr(c.rateCentsPerMin)}/min</span>
                        {marginCents > 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            +{inr(marginCents)} margin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      <Badge variant="outline" className="font-mono text-[11px] font-normal bg-background">
                        {c.concurrentLimit ?? 10} lines
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium tabular-nums text-foreground">{toMins(c.monthSeconds)} min</p>
                      <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                        {c.monthCalls} calls · {inr(c.monthSpendCents)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-3 text-xs font-medium border-border/80 hover:bg-muted"
                          title="Open client ops — rate, fund, numbers"
                          onClick={() => navigate(`/app/partner/clients/${encodeURIComponent(c.clerkId)}`)}
                        >
                          Manage
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                            >
                              <MoreHorizontal className="w-4 h-4" />
                              <span className="sr-only">Client actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => { setTransferClient(c); setAmountText(""); }}>
                              <ArrowRightLeft className="w-3.5 h-3.5 mr-2" />
                              Transfer funds
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setRateClient(c); setRateText((c.rateCentsPerMin / 100).toFixed(2)); }}>
                              <IndianRupee className="w-3.5 h-3.5 mr-2" />
                              Edit rate
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setConcurrencyClient(c); setConcurrencyText(String(c.concurrentLimit ?? 10)); }}>
                              <PhoneCall className="w-3.5 h-3.5 mr-2" />
                              Adjust lines
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setPermissionsClient(c)}>
                              <Shield className="w-3.5 h-3.5 mr-2" />
                              Access & features
                            </DropdownMenuItem>
                            {c.loginLocked && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-amber-600 focus:text-amber-600"
                                  disabled={unlockMutation.isPending}
                                  onClick={() => unlockMutation.mutate(c.clerkId)}
                                >
                                  <Lock className="w-3.5 h-3.5 mr-2" />
                                  Unlock login
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
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

      {/* Set concurrency dialog */}
      <Dialog open={!!concurrencyClient} onOpenChange={(o) => !o && setConcurrencyClient(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set client concurrency</DialogTitle>
            <DialogDescription>
              {concurrencyClient?.name || concurrencyClient?.email} — max concurrent calls this client can run simultaneously.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 text-xs space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>Partner Total Pool:</span>
                <span className="font-semibold text-foreground">{me.concurrentLimit ?? 10} lines</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Used by Other Clients:</span>
                <span className="font-semibold text-foreground">
                  {Math.max(0, (me.allocatedConcurrency ?? 0) - (concurrencyClient?.concurrentLimit ?? 10))} lines
                </span>
              </div>
              <div className="flex justify-between text-emerald-500 font-medium pt-1 border-t border-border/40">
                <span>Max Available for this Client:</span>
                <span>
                  {Math.max(1, (me.concurrentLimit ?? 10) - Math.max(0, (me.allocatedConcurrency ?? 0) - (concurrencyClient?.concurrentLimit ?? 10)))} lines
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="concurrency">Concurrent Call Lines</Label>
              <Input
                id="concurrency"
                type="number"
                min="1"
                max={Math.max(1, (me.concurrentLimit ?? 10) - Math.max(0, (me.allocatedConcurrency ?? 0) - (concurrencyClient?.concurrentLimit ?? 10)))}
                value={concurrencyText}
                onChange={e => setConcurrencyText(e.target.value)}
                placeholder="10"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConcurrencyClient(null)}>Cancel</Button>
            <Button
              disabled={
                concurrencyMutation.isPending ||
                !Number.parseInt(concurrencyText, 10) ||
                Number.parseInt(concurrencyText, 10) < 1 ||
                Number.parseInt(concurrencyText, 10) > Math.max(1, (me.concurrentLimit ?? 10) - Math.max(0, (me.allocatedConcurrency ?? 0) - (concurrencyClient?.concurrentLimit ?? 10)))
              }
              onClick={() => {
                const limit = Number.parseInt(concurrencyText, 10);
                if (concurrencyClient && limit > 0) {
                  concurrencyMutation.mutate({ clerkId: concurrencyClient.clerkId, concurrentLimit: limit });
                }
              }}>
              {concurrencyMutation.isPending ? "Saving…" : "Save lines"}
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
            <div className="space-y-1.5">
              <Label htmlFor="create-concurrency">Concurrent call lines</Label>
              <Input
                id="create-concurrency"
                type="number"
                min="1"
                max={Math.max(1, (me.concurrentLimit ?? 10) - (me.allocatedConcurrency ?? 0))}
                value={createConcurrencyText}
                onChange={e => setCreateConcurrencyText(e.target.value)}
                placeholder="5"
              />
              <p className="text-[11px] text-muted-foreground">
                Available in your pool: {Math.max(0, (me.concurrentLimit ?? 10) - (me.allocatedConcurrency ?? 0))} lines
              </p>
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
      <PlanLimitModal
        open={limitModalOpen}
        onClose={() => setLimitModalOpen(false)}
        type="client"
        limit={clientLimit}
        partnerSupportEmail={me.supportEmail}
      />
      <ClientPermissionsDialog
        open={!!permissionsClient}
        clientName={permissionsClient?.name || permissionsClient?.email || "Client"}
        permissions={permissionsClient?.partnerPermissions ?? null}
        onClose={() => setPermissionsClient(null)}
        isSaving={permissionsMutation.isPending}
        onSave={(partnerPermissions) => {
          if (permissionsClient) {
            permissionsMutation.mutate({ clerkId: permissionsClient.clerkId, partnerPermissions });
          }
        }}
      />
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
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [clientLimit, setClientLimit] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ invites: PartnerInvite[] }>({
    queryKey: ["partner-invites"],
    queryFn: () => partnerFetch<{ invites: PartnerInvite[] }>(getToken, "/api/partner/invites"),
  });
  const invites = data?.invites ?? [];

  const { data: refData, isLoading: refLoading } = useQuery<{ referrals: PartnerReferral[] }>({
    queryKey: ["partner-referrals"],
    queryFn: () => partnerFetch<{ referrals: PartnerReferral[] }>(getToken, "/api/partner/referrals"),
  });
  const referrals = refData?.referrals ?? [];

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
    onError: (err: any) => {
      const errorCode = err?.errorCode || err?.data?.errorCode;
      const limitVal = err?.limit ?? err?.data?.limit;
      if (errorCode === "CLIENT_LIMIT_REACHED" || String(err?.message || "").includes("Client limit reached")) {
        setClientLimit(limitVal ?? null);
        setLimitModalOpen(true);
        setOpen(false);
        return;
      }
      toast({ title: "Could not send invite", description: err.message, variant: "destructive" });
    },
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
    <div className="space-y-5">
      {/* Referral Link Quick Banner */}
      <ReferralLinkCard
        me={me}
        description="Clients who sign up via your link or enter your referral code will appear below under Referral Signups."
      />

      {/* Direct Invitations */}
      <div className="rounded-xl border border-border bg-card">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">Direct Invitations</h2>
            <p className="text-[11px] text-muted-foreground">Email invitations sent directly to specific clients</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}>
            <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Invite client
          </Button>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2 animate-pulse">{[0, 1].map(i => <div key={i} className="h-10 rounded bg-muted" />)}</div>
        ) : invites.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Mail className="w-8 h-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground mt-2">No direct invitations yet.</p>
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
      </div>

      {/* Referral / Walk-in Signups */}
      <div className="rounded-xl border border-border bg-card">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium">Referral Signups (Walk-ins)</h2>
          <p className="text-[11px] text-muted-foreground">Users who signed up using your link or referral code</p>
        </div>
        {refLoading ? (
          <div className="p-4 space-y-2 animate-pulse">{[0, 1].map(i => <div key={i} className="h-10 rounded bg-muted" />)}</div>
        ) : referrals.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">No referral walk-in signups yet. Share your code to get started.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {referrals.map(r => (
              <div key={r.id} className="flex items-center justify-between px-4 py-2.5 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.userName || r.userEmail || "Signed up user"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.userEmail && `${r.userEmail} · `}Signed up {fmtDate(r.createdAt)} via code <span className="font-mono font-semibold">{r.referralCode}</span>
                  </p>
                </div>
                <Badge variant="outline" className="text-xs text-emerald-500 border-emerald-500/30">
                  {r.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

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
      <PlanLimitModal
        open={limitModalOpen}
        onClose={() => setLimitModalOpen(false)}
        type="client"
        limit={clientLimit}
        partnerSupportEmail={me.supportEmail}
      />
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
  const [referralCodeDraft, setReferralCodeDraft] = useState(me.referralCode ?? "");
  const [uploading, setUploading] = useState(false);
  const [slugDraft, setSlugDraft] = useState(me.slug ?? "");
  const [customDraft, setCustomDraft] = useState(me.customDomain ?? "");
  const [mailName, setMailName] = useState(me.mailFromName ?? me.companyName);
  const [mailEmail, setMailEmail] = useState(me.mailFromEmail ?? "");
  const [supportEmail, setSupportEmail] = useState(me.supportEmail ?? "");
  const [supportUrl, setSupportUrl] = useState(me.supportUrl ?? "");
  const [docsUrl, setDocsUrl] = useState(me.docsUrl ?? "");
  const [termsUrl, setTermsUrl] = useState(me.termsUrl ?? "");
  const [privacyUrl, setPrivacyUrl] = useState(me.privacyUrl ?? "");
  const [defaultPermsOpen, setDefaultPermsOpen] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["partner-me"] });
    queryClient.invalidateQueries({ queryKey: ["partner-context"] });
  };

  const defaultPermsMutation = useMutation({
    mutationFn: (defaultClientPermissions: PartnerPermissions) =>
      partnerFetch(getToken, "/api/partner/default-permissions", {
        method: "PUT",
        body: JSON.stringify({ defaultClientPermissions }),
      }),
    onSuccess: () => {
      toast({ title: "Default client access rights updated" });
      setDefaultPermsOpen(false);
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Could not update defaults", description: err.message, variant: "destructive" }),
  });

  const referralCodeMutation = useMutation({
    mutationFn: () =>
      partnerFetch<{ referralCode: string; referralLink: string }>(getToken, "/api/partner/referral-code", {
        method: "PUT",
        body: JSON.stringify({ referralCode: referralCodeDraft.trim().toUpperCase() }),
      }),
    onSuccess: (data) => {
      toast({ title: "Referral code saved", description: `Your referral code is ${data.referralCode}` });
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Could not save referral code", description: err.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const paise = parseRupees(defaultRateText);
      return partnerFetch(getToken, "/api/partner/me", {
        method: "PATCH",
        body: JSON.stringify({
          companyName: companyName.trim(),
          loginTitle: loginTitle.trim() || null,
          loginSubtitle: loginSubtitle.trim() || null,
          supportEmail: supportEmail.trim() || null,
          supportUrl: supportUrl.trim() || null,
          docsUrl: docsUrl.trim() || null,
          termsUrl: termsUrl.trim() || null,
          privacyUrl: privacyUrl.trim() || null,
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

      {/* Referral & Affiliate Code */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-medium">Referral &amp; Affiliate Code</h2>
        </div>
        <p className="text-[11px] text-muted-foreground -mt-1">
          Set your custom referral code (e.g. <span className="font-mono text-foreground font-semibold">SANJAY</span>). Clients who sign up with your code or link will be attributed to your account.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="referral-code">Your Referral Code</Label>
          <div className="flex gap-2">
            <Input
              id="referral-code"
              placeholder="SANJAY"
              value={referralCodeDraft}
              onChange={e => setReferralCodeDraft(e.target.value.toUpperCase())}
              className="font-mono text-sm uppercase"
            />
            <Button
              size="sm"
              className="shrink-0"
              disabled={referralCodeMutation.isPending || referralCodeDraft.trim().length < 2}
              onClick={() => referralCodeMutation.mutate()}
            >
              {referralCodeMutation.isPending ? "Saving…" : "Save Code"}
            </Button>
          </div>
          {me.referralLink && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1">
              <Link2 className="h-3 w-3" />
              Referral Link:{" "}
              <span className="font-mono select-all text-foreground">{me.referralLink}</span>
            </p>
          )}
        </div>
      </div>

      {/* Default Client Access Permissions Template */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-medium">Default Client Access Rights</h2>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => setDefaultPermsOpen(true)}
          >
            Configure Defaults
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground -mt-1">
          Set the default section visibility and edit rights template automatically assigned to newly onboarded clients.
        </p>
      </div>

      <ClientPermissionsDialog
        open={defaultPermsOpen}
        clientName="Default New Clients"
        permissions={me.defaultClientPermissions ?? null}
        onClose={() => setDefaultPermsOpen(false)}
        isSaving={defaultPermsMutation.isPending}
        onSave={(defaultClientPermissions) => {
          defaultPermsMutation.mutate(defaultClientPermissions);
        }}
      />

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
            <CustomDomainDnsCard
              domain={me.customDomain}
              cnameTarget={me.cnameTarget}
              verifyToken={me.domainVerifyToken}
              dns={me.customDns}
              status={me.customDomainStatus}
              verifying={verifyMutation.isPending}
              removing={clearCustomMutation.isPending}
              onVerify={() => verifyMutation.mutate()}
              onRemove={() => clearCustomMutation.mutate()}
            />
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
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Help &amp; legal for clients</h2>
        </div>
        <p className="text-[11px] text-muted-foreground -mt-1">
          Clients never see SnapServe support or docs. Point them at your own help desk, docs, terms, and privacy pages.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="support-email">Support email</Label>
          <Input id="support-email" type="email" value={supportEmail} onChange={e => setSupportEmail(e.target.value)} placeholder="help@yourcompany.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="support-url">Support URL</Label>
          <Input id="support-url" value={supportUrl} onChange={e => setSupportUrl(e.target.value)} placeholder="https://yourcompany.com/support" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="docs-url">Documentation URL</Label>
          <Input id="docs-url" value={docsUrl} onChange={e => setDocsUrl(e.target.value)} placeholder="https://docs.yourcompany.com" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="terms-url">Terms URL</Label>
            <Input id="terms-url" value={termsUrl} onChange={e => setTermsUrl(e.target.value)} placeholder="https://yourcompany.com/terms" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="privacy-url">Privacy URL</Label>
            <Input id="privacy-url" value={privacyUrl} onChange={e => setPrivacyUrl(e.target.value)} placeholder="https://yourcompany.com/privacy" />
          </div>
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
