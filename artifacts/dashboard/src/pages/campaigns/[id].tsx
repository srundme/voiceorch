import { useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetCampaign,
  useListCampaignLeads,
  useUpdateCampaign,
  useRetryCampaignLead,
  getListCampaignLeadsQueryKey,
  getGetCampaignQueryKey,
} from "@workspace/api-client-react";
import type { CampaignLead } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Copy, Check, RefreshCw, Phone, User, Mail,
  Clock, RotateCcw, Megaphone, ExternalLink,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending:   "bg-gray-50 text-gray-600 border-gray-200",
    calling:   "bg-blue-50 text-blue-700 border-blue-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    failed:    "bg-red-50 text-red-700 border-red-200",
    skipped:   "bg-amber-50 text-amber-700 border-amber-200",
  };
  return map[status] ?? "bg-gray-50 text-gray-500 border-gray-200";
}

function WebhookUrlBox({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${BASE}/api/webhooks/lead/${token}`;
  function copy() {
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="border border-dashed border-violet-200 rounded-xl bg-violet-50/50 p-4">
      <p className="text-xs font-semibold text-violet-700 mb-2 flex items-center gap-1.5">
        <Megaphone className="h-3.5 w-3.5" /> Webhook URL
      </p>
      <div className="flex items-center gap-2">
        <code className="text-xs font-mono text-violet-900 flex-1 truncate">{url}</code>
        <button
          onClick={copy}
          className="shrink-0 p-1.5 rounded-lg hover:bg-violet-100 text-violet-600 transition-colors"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className="text-[11px] text-violet-600/70 mt-2">
        POST JSON leads here — or use as Meta Lead Ads webhook URL (GET for verification, POST for leads).
      </p>
    </div>
  );
}

function LeadRow({ lead, onRetry }: { lead: CampaignLead; onRetry: () => void }) {
  const [open, setOpen] = useState(false);
  const canRetry = lead.callStatus === "failed" || lead.callStatus === "skipped";

  return (
    <>
      <tr
        className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <span className="text-sm font-mono font-medium text-gray-800">{lead.phone}</span>
          </div>
          {lead.name && <p className="text-xs text-gray-400 mt-0.5 ml-5.5">{lead.name}</p>}
        </td>
        <td className="py-3 px-4">
          <Badge variant="outline" className={`text-[10px] ${statusBadge(lead.callStatus)}`}>
            {lead.callStatus}
          </Badge>
        </td>
        <td className="py-3 px-4 text-xs text-gray-400">{lead.callAttempts}</td>
        <td className="py-3 px-4 text-xs text-gray-400">
          {lead.source === "instagram_ads" ? "Instagram" : "Webhook"}
        </td>
        <td className="py-3 px-4 text-xs text-gray-400">
          {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}
        </td>
        <td className="py-3 px-4">
          {canRetry && (
            <Button
              variant="ghost" size="sm"
              className="h-6 text-xs gap-1"
              onClick={e => { e.stopPropagation(); onRetry(); }}
            >
              <RotateCcw className="h-3 w-3" /> Retry
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-violet-50/30">
          <td colSpan={6} className="px-4 py-3">
            <div className="grid grid-cols-2 gap-4 text-xs">
              {lead.email && (
                <div className="flex items-center gap-1.5 text-gray-500">
                  <Mail className="h-3.5 w-3.5" /> {lead.email}
                </div>
              )}
              {lead.lastAttemptAt && (
                <div className="flex items-center gap-1.5 text-gray-500">
                  <Clock className="h-3.5 w-3.5" /> Last attempt: {format(new Date(lead.lastAttemptAt), "MMM d, HH:mm")}
                </div>
              )}
              {lead.externalLeadId && (
                <div className="text-gray-400">Lead ID: <code className="font-mono">{lead.externalLeadId}</code></div>
              )}
              {lead.notes && (
                <div className="col-span-2 text-red-500">{lead.notes}</div>
              )}
              {Object.keys(lead.leadData ?? {}).length > 0 && (
                <div className="col-span-2">
                  <p className="font-medium text-gray-500 mb-1">Form data</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(lead.leadData as Record<string,string>).map(([k, v]) => (
                      <div key={k} className="flex gap-1">
                        <span className="text-gray-400 font-mono">{k}:</span>
                        <span className="text-gray-600 truncate">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function CampaignDetailPage() {
  const [, params] = useRoute("/app/campaigns/:id");
  const id = parseInt(params?.id ?? "0", 10);
  const qc = useQueryClient();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const { data: campaign, isLoading: loadingCampaign } = useGetCampaign(id);
  const { data: leadsData, isLoading: loadingLeads, refetch } = useListCampaignLeads(id, {
    status: statusFilter === "all" ? undefined : statusFilter,
    limit:  PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const upd   = useUpdateCampaign();
  const retry = useRetryCampaignLead();

  async function toggleActive() {
    if (!campaign) return;
    await upd.mutateAsync({ id: campaign.id, data: { isActive: !campaign.isActive } });
    await qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
  }

  async function handleRetry(leadId: number) {
    try {
      await retry.mutateAsync({ id, leadId });
      await qc.invalidateQueries({ queryKey: getListCampaignLeadsQueryKey(id) });
      toast({ title: "Retry queued" });
    } catch {
      toast({ title: "Retry failed", variant: "destructive" });
    }
  }

  if (loadingCampaign) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="h-40 bg-gray-50 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Campaign not found.</p>
        <Link href="/app/campaigns"><Button variant="ghost" className="mt-2">Back to campaigns</Button></Link>
      </div>
    );
  }

  const leads = leadsData?.leads ?? [];
  const total = leadsData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Back */}
      <Link href="/app/campaigns">
        <button className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 mb-4 transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Campaigns
        </button>
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-violet-50 text-violet-600">
            <Megaphone className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{campaign.name}</h1>
            {campaign.description && <p className="text-sm text-gray-400">{campaign.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{campaign.isActive ? "Active" : "Inactive"}</span>
          <Switch checked={campaign.isActive} onCheckedChange={() => void toggleActive()} />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total leads",  value: campaign.totalLeads  },
          { label: "Calls made",   value: campaign.calledLeads  },
          { label: "Max attempts", value: campaign.maxAttempts  },
          { label: "Delay (s)",    value: campaign.callDelaySeconds },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-3 text-center">
            <p className="text-[11px] text-gray-400">{s.label}</p>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Webhook URL */}
      <div className="mb-6">
        <WebhookUrlBox token={campaign.webhookToken} />
      </div>

      {/* Field mappings */}
      <div className="mb-6 bg-white border border-gray-100 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Field Mappings</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(campaign.fieldMappings as Record<string, string>).map(([role, field]) => (
            <div key={role} className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-3 py-1.5 text-xs">
              <span className="font-medium text-gray-700">{role}</span>
              <span className="text-gray-300">←</span>
              <code className="font-mono text-violet-700">{field}</code>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          Use <code className="font-mono">{"{{name}}"}</code>, <code className="font-mono">{"{{phone}}"}</code>, etc. as variables in your agent's system prompt.
        </p>
      </div>

      {/* Leads table */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
          <p className="text-sm font-semibold text-gray-700">
            Leads <span className="text-gray-400 font-normal">({total})</span>
          </p>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="h-7 text-xs w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="calling">Calling</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => void refetch()}>
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
          </div>
        </div>

        {loadingLeads ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading leads…</div>
        ) : !leads.length ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-sm">No leads yet.</p>
            <p className="text-xs text-gray-300 mt-1">
              POST lead data to the webhook URL above to start auto-calling.
            </p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-50">
                {["Phone / Name", "Status", "Attempts", "Source", "Received", ""].map(h => (
                  <th key={h} className="py-2 px-4 text-[11px] font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map(lead => (
                <LeadRow key={lead.id} lead={lead} onRetry={() => void handleRetry(lead.id)} />
              ))}
            </tbody>
          </table>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
            <p className="text-xs text-gray-400">Page {page + 1} of {totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
