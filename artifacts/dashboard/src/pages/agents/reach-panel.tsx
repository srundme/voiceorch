/**
 * Reach — how work gets to this agent (Phase 2).
 *
 * Presets deep-link into existing engines (campaigns, sheet dial, meet, journey).
 * Nothing is rewritten here yet — this is the agent-bound shell so users stop
 * hunting Campaigns / Automatic Calls as separate products.
 */

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, Clock, FileSpreadsheet, Globe, List, Loader2, MessageCircle,
  Phone, Video, Zap,
} from "lucide-react";
import {
  customFetch,
  useListCampaigns,
  getListCampaignsQueryKey,
  type Campaign,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { JourneyPanel } from "./journey-panel";
import { CallRulesPanel } from "./call-rules-panel";

type AutoPipeline = {
  id: string;
  name: string;
  status: string;
  agentId: number;
  dialedCount: number;
  enqueuedCount: number;
  spreadsheetTitle: string | null;
};

type Preset = {
  id: string;
  title: string;
  desc: string;
  href: string;
  icon: React.ElementType;
  tone: string;
};

function statusTone(status: string) {
  const s = status.toLowerCase();
  if (s === "active" || s === "running" || s === "completed") return "bg-emerald-500/10 text-emerald-600";
  if (s === "paused" || s === "draft") return "bg-amber-500/10 text-amber-700";
  if (s === "failed" || s === "stopped" || s === "error") return "bg-rose-500/10 text-rose-600";
  return "bg-muted text-muted-foreground";
}

export function ReachPanel({
  agentId,
  agentName,
  webhookUrl,
  onConfigureEmail,
  onOpenChannels,
}: {
  agentId: number;
  agentName?: string;
  webhookUrl?: string | null;
  onConfigureEmail?: () => void;
  onOpenChannels?: () => void;
}) {
  const campaignsQ = useListCampaigns({
    query: { queryKey: getListCampaignsQueryKey(), staleTime: 20_000 },
  });
  const pipelinesQ = useQuery({
    queryKey: ["automatic-calls"],
    queryFn: () => customFetch<AutoPipeline[]>("/api/automatic-calls"),
    staleTime: 20_000,
  });

  const campaigns = (Array.isArray(campaignsQ.data) ? campaignsQ.data : []).filter(
    (c: Campaign) => c.agentId === agentId,
  ) as Campaign[];
  const pipelines = (pipelinesQ.data ?? []).filter((p) => p.agentId === agentId);

  const websiteCampaigns = campaigns.filter(
    (c) => c.leadSource === "webhook" || c.leadSource === "meta_ads" || c.triggerMode === "instant",
  );
  const listCampaigns = campaigns.filter(
    (c) => c.leadSource === "csv" || c.leadSource === "crm" || c.triggerMode === "batch",
  );

  const presets: Preset[] = [
    {
      id: "website",
      title: "Website form → Call",
      desc: "Webhook on form submit dials this agent",
      href: `/app/campaigns?tab=lead-sources&agentId=${agentId}`,
      icon: Globe,
      tone: "bg-sky-500/10 text-sky-600",
    },
    {
      id: "sheet",
      title: "Google Sheet → Call",
      desc: "New row dials this agent automatically",
      href: `/app/automatic-calls/new?agentId=${agentId}`,
      icon: FileSpreadsheet,
      tone: "bg-emerald-500/10 text-emerald-600",
    },
    {
      id: "list",
      title: "Upload list → Call",
      desc: "CSV / batch outbound with this agent",
      href: `/app/campaigns?agentId=${agentId}`,
      icon: List,
      tone: "bg-violet-500/10 text-violet-600",
    },
    {
      id: "meeting",
      title: "Join a meeting",
      desc: "Send this agent into Meet / Zoom / Teams",
      href: `/app/meet?agentId=${agentId}`,
      icon: Video,
      tone: "bg-rose-500/10 text-rose-600",
    },
    {
      id: "rules",
      title: "Call rules",
      desc: "Retries, quiet hours, parallel caps",
      href: "#reach-call-rules",
      icon: Clock,
      tone: "bg-slate-500/10 text-slate-600",
    },
    {
      id: "journey",
      title: "After-call sequence",
      desc: "Call → WhatsApp / email / callback",
      href: "#reach-journey",
      icon: MessageCircle,
      tone: "bg-amber-500/10 text-amber-700",
    },
    {
      id: "custom",
      title: "Custom sequence",
      desc: "Build your own steps on this agent",
      href: "#reach-custom-steps",
      icon: Zap,
      tone: "bg-indigo-500/10 text-indigo-600",
    },
  ];

  const loading = campaignsQ.isLoading || pipelinesQ.isLoading;

  return (
    <div className="relative p-6 space-y-8">
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">Reach</h2>
        <p className="text-[12px] text-muted-foreground max-w-3xl">
          How work gets to {agentName ? <span className="font-medium text-foreground">{agentName}</span> : "this agent"}.
          Start from a preset, or manage what’s already armed. Phone, WhatsApp, and email setup stay under{" "}
          <button type="button" onClick={onOpenChannels} className="underline underline-offset-2 hover:text-foreground">
            Channels
          </button>
          .
        </p>
      </section>

      {/* Presets */}
      <section className="space-y-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Add how work reaches this agent
        </h3>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {presets.map((p) => {
            const Icon = p.icon;
            const inner = (
              <>
                <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", p.tone)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight">{p.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{p.desc}</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
              </>
            );
            if (p.href.startsWith("#")) {
              return (
                <a
                  key={p.id}
                  href={p.href}
                  className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/40 px-3 py-3 hover:border-border hover:bg-card/70 transition-colors text-left"
                >
                  {inner}
                </a>
              );
            }
            return (
              <Link
                key={p.id}
                href={p.href}
                className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/40 px-3 py-3 hover:border-border hover:bg-card/70 transition-colors"
              >
                {inner}
              </Link>
            );
          })}
        </div>
      </section>

      {/* Armed for this agent */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Armed for this agent
          </h3>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>

        {!loading && campaigns.length === 0 && pipelines.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center">
            <Phone className="h-7 w-7 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm font-medium">Nothing dialing this agent yet</p>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-sm mx-auto">
              Pick a preset above — form, sheet, or list — to start reaching contacts with this voice.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {pipelines.map((p) => (
            <Link
              key={p.id}
              href={`/app/automatic-calls/${p.id}`}
              className="flex items-center gap-3 rounded-xl border border-border/50 px-3 py-2.5 hover:bg-muted/30 transition-colors"
            >
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{p.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Sheet dial · {p.spreadsheetTitle ?? "Google Sheet"} · {p.dialedCount} dialed
                </p>
              </div>
              <Badge variant="outline" className={cn("text-[10px] h-5 capitalize", statusTone(p.status))}>
                {p.status}
              </Badge>
            </Link>
          ))}

          {websiteCampaigns.map((c) => (
            <Link
              key={`web-${c.id}`}
              href={`/app/campaigns/${c.id}`}
              className="flex items-center gap-3 rounded-xl border border-border/50 px-3 py-2.5 hover:bg-muted/30 transition-colors"
            >
              <div className="h-8 w-8 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
                <Globe className="h-3.5 w-3.5 text-sky-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{c.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Website / instant · {c.totalLeads ?? 0} leads · {c.calledLeads ?? 0} called
                </p>
              </div>
              <Badge variant="outline" className={cn("text-[10px] h-5 capitalize", statusTone(c.status ?? "active"))}>
                {c.isActive === false ? "paused" : (c.status ?? "active")}
              </Badge>
            </Link>
          ))}

          {listCampaigns
            .filter((c) => !websiteCampaigns.some((w) => w.id === c.id))
            .map((c) => (
              <Link
                key={`list-${c.id}`}
                href={`/app/campaigns/${c.id}`}
                className="flex items-center gap-3 rounded-xl border border-border/50 px-3 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                  <Zap className="h-3.5 w-3.5 text-violet-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    List / batch · {c.totalLeads ?? 0} leads · {c.calledLeads ?? 0} called
                  </p>
                </div>
                <Badge variant="outline" className={cn("text-[10px] h-5 capitalize", statusTone(c.status ?? "active"))}>
                  {c.isActive === false ? "paused" : (c.status ?? "active")}
                </Badge>
              </Link>
            ))}
        </div>

        {(campaigns.length > 0 || pipelines.length > 0) && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild size="sm" variant="outline" className="h-8 text-xs">
              <Link href={`/app/campaigns?agentId=${agentId}`}>All list dials</Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8 text-xs">
              <Link href="/app/campaigns?tab=scheduled">All sheet dials</Link>
            </Button>
          </div>
        )}
      </section>

      {/* Call rules — retries, quiet hours, caps */}
      <CallRulesPanel agentId={agentId} campaigns={campaigns} />

      {/* Journey stays the in-agent sequence engine */}
      <section id="reach-journey" className="scroll-mt-4 space-y-2 border-t border-border/40 pt-6">
        <div className="space-y-1 mb-2">
          <h3 className="text-sm font-semibold tracking-tight">After-call journey</h3>
          <p className="text-[12px] text-muted-foreground max-w-3xl">
            Auto-pilot after a lead arrives or a call ends: WhatsApp, email, callback, wait —
            or <a href="#reach-custom-steps" className="underline underline-offset-2 hover:text-foreground">customize the steps</a>.
            Channel credentials live under Channels.
          </p>
        </div>
        <JourneyPanel
          agentId={agentId}
          webhookUrl={webhookUrl}
          onConfigureEmail={onConfigureEmail}
          onOpenChannels={onOpenChannels}
        />
      </section>
    </div>
  );
}
