/**
 * Connections — wires used by call plans.
 * Only: Google Sheets · WhatsApp · Brevo email · Website form · Meta Lead Ads.
 * Phone numbers live on the Agent Builder.
 */

import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useListConnections } from "@workspace/api-client-react";
import { StripePage } from "@/components/stripe-page";
import { BrandLogo, BrandLogoBadge, type BrandSlug } from "@/components/brand-logos";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ArrowRight, Check, Globe, Loader2, Calendar } from "lucide-react";
import { EmailChannelCard, useEmailChannelReady } from "@/pages/agents/email-channel-card";
import FromWebsitePage from "@/pages/campaigns/from-website";
import MetaLeadsPage from "@/pages/meta-leads";
import { ConnectionsCalendarSetup } from "@/pages/connections/calendar-setup";
import { useListCalendars, useListEventTypes } from "@workspace/api-client-react";

type SetupId = "sheets" | "whatsapp" | "email" | "website" | "meta" | "calendar" | null;

type ConnCard = {
  id: Exclude<SetupId, null>;
  brand?: BrandSlug;
  icon?: "globe" | "calendar";
  title: string;
  blurb: string;
  href?: string;
};

const CARDS: ConnCard[] = [
  {
    id: "sheets",
    brand: "googleSheets",
    title: "Google Sheets",
    blurb: "Watch a sheet and feed people into a call plan.",
  },
  {
    id: "calendar",
    icon: "calendar",
    title: "Calendar & booking",
    blurb: "Google Calendar setup for mid-call appointments.",
  },
  {
    id: "whatsapp",
    brand: "whatsapp",
    title: "WhatsApp",
    blurb: "Send follow-ups after calls from your call plan.",
    href: "/app/whatsapp",
  },
  {
    id: "email",
    brand: "brevo",
    title: "Email (Brevo)",
    blurb: "Bring your Brevo key to email people mid-plan.",
  },
  {
    id: "website",
    icon: "globe",
    title: "Website form",
    blurb: "Form submit → person enters your call plan.",
  },
  {
    id: "meta",
    brand: "meta",
    title: "Meta Lead Ads",
    blurb: "New Meta form leads enter your call plan.",
  },
];

function CardMark({ card }: { card: ConnCard }) {
  if (card.brand) {
    return <BrandLogoBadge brand={card.brand} size={22} className="!h-11 !w-11 !rounded-xl" />;
  }
  // White badge matches BrandLogoBadge; icons must be dark ink — text-foreground
  // is light in dark mode and disappears on bg-white (Calendar / Website form).
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/5 bg-white shadow-sm">
      {card.icon === "calendar" ? (
        <Calendar className="size-5 text-neutral-800" strokeWidth={1.75} />
      ) : (
        <Globe className="size-5 text-neutral-800" strokeWidth={1.75} />
      )}
    </div>
  );
}

function StatusChip({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
        ready
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {ready ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-muted-foreground/50" />}
      {label}
    </span>
  );
}

export default function ConnectionsPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const setupParam = new URLSearchParams(search).get("setup") as SetupId;
  const [setup, setSetup] = useState<SetupId>(
    setupParam && CARDS.some((c) => c.id === setupParam) ? setupParam : null,
  );
  const { toast } = useToast();
  const qc = useQueryClient();
  const emailReady = useEmailChannelReady();

  useEffect(() => {
    if (setupParam && CARDS.some((c) => c.id === setupParam)) setSetup(setupParam);
  }, [setupParam]);

  const openSetup = (id: SetupId) => {
    setSetup(id);
    if (id) navigate(`/app/connections?setup=${id}`, { replace: true });
    else navigate("/app/connections", { replace: true });
  };

  const sheetsQ = useQuery({
    queryKey: ["sheets-connections"],
    queryFn: () =>
      customFetch<Array<{ id: string; email: string }>>("/api/sheets/google/connections"),
  });
  const sheetsConnected = (sheetsQ.data?.length ?? 0) > 0;

  const disconnectSheets = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/sheets/google/connections/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sheets-connections"] });
      toast({ title: "Google Sheets disconnected" });
    },
  });

  const connectSheets = async () => {
    try {
      const { url } = await customFetch<{ url: string }>(
        `/api/sheets/google/connect-url?returnTo=sheets&returnOrigin=${encodeURIComponent(window.location.origin)}`,
      );
      window.location.href = url;
    } catch (err: any) {
      toast({
        title: "Could not start Google Sheets connect",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sheets") === "connected") {
      toast({ title: "Google Sheets connected" });
      params.delete("sheets");
      const next = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
      void qc.invalidateQueries({ queryKey: ["sheets-connections"] });
    }
  }, [qc, toast]);

  const { data: waData } = useQuery({
    queryKey: ["connections-whatsapp-status"],
    queryFn: () =>
      customFetch<{ channel: { active?: boolean } | null }>("/api/whatsapp/channel"),
    staleTime: 60_000,
  });
  const waReady = !!waData?.channel?.active;

  const { data: connections = [] } = useListConnections();
  const websiteReady = connections.some((c) => c.type === "webhook");
  const metaReady = connections.some((c) => c.type === "meta_lead_ads");
  const calendarsQ = useListCalendars();
  const eventTypesQ = useListEventTypes();
  const calendarReady =
    (Array.isArray(calendarsQ.data) ? calendarsQ.data.length : 0) > 0
    && (Array.isArray(eventTypesQ.data) ? eventTypesQ.data.length : 0) > 0;

  const readyMap: Record<Exclude<SetupId, null>, boolean> = {
    sheets: sheetsConnected,
    calendar: calendarReady,
    whatsapp: waReady,
    email: emailReady,
    website: websiteReady,
    meta: metaReady,
  };

  if (setup === "calendar") {
    return <ConnectionsCalendarSetup />;
  }

  if (setup === "email") {
    return (
      <StripePage
        title="Email (Brevo)"
        description="Bring your own Brevo API key. Call plans use this for Send email steps."
        back={{ href: "/app/connections", label: "Connections" }}
      >
        <div className="max-w-xl">
          <EmailChannelCard forceExpanded />
        </div>
      </StripePage>
    );
  }

  if (setup === "website") {
    return (
      <StripePage
        title="Website form"
        description="Copy a webhook into your site form. New leads can enter a call plan — attach the hook on Call plans → Also start from intake."
        back={{ href: "/app/connections", label: "Connections" }}
        fullBleed
        contentClassName="!px-0 !py-0 max-w-none"
      >
        <FromWebsitePage hideMeta />
      </StripePage>
    );
  }

  if (setup === "meta") {
    return (
      <StripePage
        title="Meta Lead Ads"
        description="Connect a Meta form so new leads can enter a call plan — enable Meta intake on the plan detail page."
        back={{ href: "/app/connections", label: "Connections" }}
        fullBleed
        contentClassName="!px-0 !py-0 max-w-none"
      >
        <div className="px-5 py-5 sm:px-6">
          <MetaLeadsPage />
        </div>
      </StripePage>
    );
  }

  if (setup === "sheets") {
    return (
      <StripePage
        title="Google Sheets"
        description="Connect once, then attach a sheet to a call plan (Keep live)."
        back={{ href: "/app/connections", label: "Connections" }}
      >
        <div className="max-w-lg space-y-4">
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3.5">
              <BrandLogoBadge brand="googleSheets" size={20} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Google Sheets</p>
                <p className="text-[12px] text-muted-foreground">OAuth for your workspace</p>
              </div>
              <StatusChip ready={sheetsConnected} label={sheetsConnected ? "Connected" : "Not connected"} />
            </div>
            <div className="space-y-3 px-4 py-4">
              {sheetsQ.isLoading ? (
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Checking…
                </div>
              ) : sheetsConnected ? (
                (sheetsQ.data ?? []).map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5">
                    <BrandLogo brand="googleSheets" size={16} />
                    <p className="min-w-0 flex-1 truncate text-[13px]">{c.email}</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-[11px] text-muted-foreground hover:text-destructive"
                      disabled={disconnectSheets.isPending}
                      onClick={() => disconnectSheets.mutate(c.id)}
                    >
                      Disconnect
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  Connect the Google account that owns your lead sheet. Then attach it on a call plan
                  (Keep live) or{" "}
                  <Link href="/app/call-plans" className="underline underline-offset-2">
                    create a plan
                  </Link>
                  .
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" className="h-9 gap-1.5" onClick={() => void connectSheets()}>
                  <BrandLogo brand="googleSheets" size={14} />
                  {sheetsConnected ? "Add another" : "Connect Google Sheets"}
                </Button>
                {sheetsConnected && (
                  <Button size="sm" variant="outline" className="h-9 gap-1.5" asChild>
                    <Link href="/app/automatic-calls/new">
                      Use with a call plan
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </StripePage>
    );
  }

  return (
    <StripePage
      title="Connections"
      description="Wire the tools your call plans use — Sheets, calendar, WhatsApp, email, and lead forms."
      back={{ href: "/app/home", label: "Home" }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card) => {
          const ready = readyMap[card.id];
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => {
                if (card.href) {
                  navigate(card.href);
                  return;
                }
                openSetup(card.id);
              }}
              className={cn(
                "group flex flex-col items-start gap-4 rounded-2xl border border-border bg-card p-5 text-left",
                "transition-colors hover:bg-muted/30",
              )}
            >
              <div className="flex w-full items-start justify-between gap-3">
                <CardMark card={card} />
                <StatusChip ready={ready} label={ready ? "Ready" : "Set up"} />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-[15px] font-semibold tracking-tight">{card.title}</p>
                <p className="text-[12px] leading-relaxed text-muted-foreground">{card.blurb}</p>
              </div>
              <span className="mt-auto inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground group-hover:text-foreground">
                {ready ? "Manage" : "Connect"}
                <ArrowRight className="size-3.5 opacity-60 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-8 text-[12px] text-muted-foreground">
        Phone numbers live on each agent — open{" "}
        <Link href="/app/agents" className="underline underline-offset-2 hover:text-foreground">
          Agents
        </Link>{" "}
        → Overview to assign a number.
      </p>
    </StripePage>
  );
}
