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
  embedded = false,
}: {
  agentId: number;
  agentName?: string;
  webhookUrl?: string | null;
  onConfigureEmail?: () => void;
  onOpenChannels?: () => void;
  /** Page / panel title — defaults to Automation (standalone builder). */
  heading?: string;
  /** When true, skip duplicate title (parent page already has AppPageHeader). */
  embedded?: boolean;
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
    <div className={cn("space-y-4", !embedded && "px-4 py-5 sm:px-6 lg:px-8")}>
      {!embedded ? (
        <header className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em]">{heading}</h2>
            <p className="mt-0.5 max-w-xl text-[12px] leading-5 text-muted-foreground">
              Sources and sequences that feed{" "}
              {agentName ? <span className="text-foreground">{agentName}</span> : "this agent"}.
              Phone, WhatsApp, and email credentials stay under{" "}
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
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Credentials live in{" "}
            {onOpenChannels ? (
              <button type="button" onClick={onOpenChannels} className="underline underline-offset-2 hover:text-foreground">
                Channels
              </button>
            ) : (
              <Link href={`/app/channels?agentId=${agentId}`} className="underline underline-offset-2 hover:text-foreground">
                Channels
              </Link>
            )}
            .
          </p>
          <span className="shrink-0 rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-[10px] tabular-nums text-muted-foreground">
            {armedCount} armed
          </span>
        </div>
      )}

      <div id="reach-call-rules" className="scroll-mt-4">
        <CallRulesPanel agentId={agentId} campaigns={campaigns} />
      </div>
    </div>
  );
}
