/**
 * Automation sources for an agent — forms, sheets, lists, call rules, journeys.
 * Used by the standalone Automation page (agent builder stays agent-only).
 */

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Clock,
  FileSpreadsheet,
  Globe,
  List,
  Loader2,
  MessageCircle,
  Plus,
  Video,
  Zap,
} from "lucide-react";
import {
  customFetch,
  useListCampaigns,
  getListCampaignsQueryKey,
  type Campaign,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/workspace/workspace";
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
};

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  const s = status.toLowerCase();
  if (s === "active" || s === "running" || s === "completed") return "success";
  if (s === "paused" || s === "draft") return "warning";
  if (s === "failed" || s === "stopped" || s === "error") return "danger";
  return "neutral";
}

function RowLink({
  href,
  title,
  detail,
  icon: Icon,
  trailing,
  onClick,
}: {
  href?: string;
  title: string;
  detail: string;
  icon: React.ElementType;
  trailing?: React.ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium">{title}</p>
        <p className="truncate text-[10px] text-muted-foreground">{detail}</p>
      </div>
      {trailing}
      <ArrowUpRight className="size-3 shrink-0 text-muted-foreground/50" />
    </>
  );

  const className =
    "flex min-h-11 items-center gap-3 border-b border-border/60 px-1 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/30";

  if (href?.startsWith("#")) {
    return (
      <a href={href} className={className}>
        {body}
      </a>
    );
  }
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cn(className, "w-full")}>
      {body}
    </button>
  );
}

export function ReachPanel({
  agentId,
  agentName,
  webhookUrl,
  onConfigureEmail,
  onOpenChannels,
  heading = "Automation",
}: {
  agentId: number;
  agentName?: string;
  webhookUrl?: string | null;
  onConfigureEmail?: () => void;
  onOpenChannels?: () => void;
  /** Page / panel title — defaults to Automation (standalone builder). */
  heading?: string;
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
    },
    {
      id: "sheet",
      title: "Google Sheet → Call",
      desc: "New row dials this agent automatically",
      href: `/app/automatic-calls/new?agentId=${agentId}`,
      icon: FileSpreadsheet,
    },
    {
      id: "list",
      title: "Upload list → Call",
      desc: "CSV / batch outbound with this agent",
      href: `/app/campaigns?agentId=${agentId}`,
      icon: List,
    },
    {
      id: "meeting",
      title: "Join a meeting",
      desc: "Send this agent into Meet / Zoom / Teams",
      href: `/app/meet?agentId=${agentId}`,
      icon: Video,
    },
    {
      id: "rules",
      title: "Call rules",
      desc: "Retries, quiet hours, parallel caps",
      href: "#reach-call-rules",
      icon: Clock,
    },
    {
      id: "journey",
      title: "After-call sequence",
      desc: "Call → WhatsApp / email / callback",
      href: "#reach-journey",
      icon: MessageCircle,
    },
    {
      id: "custom",
      title: "Custom sequence",
      desc: "Build your own steps on this agent",
      href: "#reach-custom-steps",
      icon: Zap,
    },
  ];

  const loading = campaignsQ.isLoading || pipelinesQ.isLoading;
  const armedCount = campaigns.length + pipelines.length;

  return (
    <div className="space-y-8 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.02em]">{heading}</h2>
          <p className="mt-0.5 max-w-xl text-[12px] leading-5 text-muted-foreground">
            Sources and sequences that feed{" "}
            {agentName ? <span className="text-foreground">{agentName}</span> : "this agent"}.
            Phone, WhatsApp, and email credentials stay on the agent under{" "}
            {onOpenChannels ? (
              <button
                type="button"
                onClick={onOpenChannels}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Channels
              </button>
            ) : (
              <Link
                href={`/app/channels?agentId=${agentId}`}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Channels
              </Link>
            )}
            .
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-[10px] tabular-nums text-muted-foreground">
          {armedCount} armed
        </span>
      </header>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex h-10 items-center justify-between border-b border-border/70 px-3.5">
          <h3 className="text-[11px] font-semibold">Add source</h3>
          <Plus className="size-3.5 text-muted-foreground" />
        </div>
        <div className="px-2">
          {presets.map((preset) => (
            <RowLink
              key={preset.id}
              href={preset.href}
              title={preset.title}
              detail={preset.desc}
              icon={preset.icon}
            />
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex h-10 items-center justify-between border-b border-border/70 px-3.5">
          <h3 className="text-[11px] font-semibold">Armed</h3>
          {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>

        {!loading && armedCount === 0 ? (
          <p className="px-3.5 py-6 text-[12px] text-muted-foreground">
            Nothing dialing this agent yet. Add a form, sheet, or list source above.
          </p>
        ) : (
          <div className="px-2">
            {pipelines.map((p) => (
              <RowLink
                key={p.id}
                href={`/app/automatic-calls/${p.id}`}
                title={p.name}
                detail={`Sheet dial · ${p.spreadsheetTitle ?? "Google Sheet"} · ${p.dialedCount} dialed`}
                icon={FileSpreadsheet}
                trailing={
                  <span className="inline-flex items-center gap-1 text-[9px] capitalize text-muted-foreground">
                    <StatusDot tone={statusTone(p.status)} />
                    {p.status}
                  </span>
                }
              />
            ))}
            {websiteCampaigns.map((c) => (
              <RowLink
                key={`web-${c.id}`}
                href={`/app/campaigns/${c.id}`}
                title={c.name}
                detail={`Website / instant · ${c.totalLeads ?? 0} leads · ${c.calledLeads ?? 0} called`}
                icon={Globe}
                trailing={
                  <span className="inline-flex items-center gap-1 text-[9px] capitalize text-muted-foreground">
                    <StatusDot tone={statusTone(c.isActive === false ? "paused" : (c.status ?? "active"))} />
                    {c.isActive === false ? "paused" : (c.status ?? "active")}
                  </span>
                }
              />
            ))}
            {listCampaigns
              .filter((c) => !websiteCampaigns.some((w) => w.id === c.id))
              .map((c) => (
                <RowLink
                  key={`list-${c.id}`}
                  href={`/app/campaigns/${c.id}`}
                  title={c.name}
                  detail={`List / batch · ${c.totalLeads ?? 0} leads · ${c.calledLeads ?? 0} called`}
                  icon={Zap}
                  trailing={
                    <span className="inline-flex items-center gap-1 text-[9px] capitalize text-muted-foreground">
                      <StatusDot tone={statusTone(c.isActive === false ? "paused" : (c.status ?? "active"))} />
                      {c.isActive === false ? "paused" : (c.status ?? "active")}
                    </span>
                  }
                />
              ))}
          </div>
        )}

        {armedCount > 0 && (
          <div className="flex flex-wrap gap-1 border-t border-border/70 px-2 py-2">
            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-[11px]">
              <Link href={`/app/campaigns?agentId=${agentId}`}>All list dials</Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-[11px]">
              <Link href="/app/campaigns?tab=scheduled">All sheet dials</Link>
            </Button>
          </div>
        )}
      </section>

      <div id="reach-call-rules" className="scroll-mt-4">
        <CallRulesPanel agentId={agentId} campaigns={campaigns} />
      </div>

      <section id="reach-journey" className="scroll-mt-4 space-y-3">
        <div>
          <h3 className="text-[13px] font-semibold tracking-[-0.01em]">After-call journey</h3>
          <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted-foreground">
            Auto-pilot after a lead arrives or a call ends. On a Call step you can attach a{" "}
            <Link href="/app/squads" className="underline underline-offset-2 hover:text-foreground">
              squad
            </Link>
            . Channel credentials live under Channels.
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
