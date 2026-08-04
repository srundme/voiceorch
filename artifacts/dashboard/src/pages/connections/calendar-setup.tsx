/**
 * Connections → Calendar & booking setup (replaces day-to-day Cal.com 5-tab browsing).
 */

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useListCalendars,
  useListEventTypes,
  customFetch,
} from "@workspace/api-client-react";
import { StripePage } from "@/components/stripe-page";
import { Button } from "@/components/ui/button";
import { Check, ArrowRight, Calendar, Clock, CalendarCheck, Video } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Step = {
  id: string;
  title: string;
  blurb: string;
  href: string;
  ready: boolean;
  required: boolean;
  icon: React.ElementType;
};

export function ConnectionsCalendarSetup() {
  const calendarsQ = useListCalendars();
  const eventTypesQ = useListEventTypes();
  const googleQ = useQuery({
    queryKey: ["scheduling-google-connections"],
    queryFn: () =>
      customFetch<Array<{ id: string; email: string }>>(`${BASE}/api/scheduling/google/connections`).catch(
        () => [] as Array<{ id: string; email: string }>,
      ),
    staleTime: 30_000,
  });

  const calendars = Array.isArray(calendarsQ.data) ? calendarsQ.data : [];
  const eventTypes = Array.isArray(eventTypesQ.data) ? eventTypesQ.data : [];
  const googleConnected = (googleQ.data?.length ?? 0) > 0;
  const hasCalendar = calendars.length > 0;
  const hasEventType = eventTypes.length > 0;
  const requiredReadyCount = [hasCalendar, googleConnected, hasEventType].filter(Boolean).length;
  const ready = requiredReadyCount === 3;

  const steps: Step[] = [
    {
      id: "calendar",
      title: "Create a calendar",
      blurb: "Name it and set the host email agents book into.",
      href: `${BASE}/app/scheduling/calendars`,
      ready: hasCalendar,
      required: true,
      icon: Calendar,
    },
    {
      id: "google",
      title: "Connect Google",
      blurb: "OAuth so Meet links and events sync automatically.",
      href: `${BASE}/app/scheduling/calendars`,
      ready: googleConnected,
      required: true,
      icon: CalendarCheck,
    },
    {
      id: "event",
      title: "Event type",
      blurb: "Duration, public /book link, and which calendar.",
      href: `${BASE}/app/scheduling/event-types`,
      ready: hasEventType,
      required: true,
      icon: Clock,
    },
    {
      id: "hours",
      title: "Availability & conferencing",
      blurb: "Weekly hours and Meet/Zoom defaults (advanced).",
      href: `${BASE}/app/scheduling/availability`,
      ready: false,
      required: false,
      icon: Video,
    },
  ];

  return (
    <StripePage
      title="Calendar & booking"
      description="One-time setup for mid-call booking. Day-to-day appointments live under Bookings."
      back={{ href: "/app/connections", label: "Connections" }}
    >
      <div className="max-w-lg space-y-4">
        <div
          className={cn(
            "rounded-xl border px-4 py-3 text-[12px]",
            ready
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-border/60 bg-muted/20 text-muted-foreground",
          )}
        >
          <p className="font-medium text-[12px]">
            {ready ? "3 of 3 ready" : `${requiredReadyCount} of 3 ready`}
          </p>
          <p className="mt-0.5 leading-relaxed">
            {ready
              ? "Calendar ready — bind an event type on Agent → Tools → Booking, then watch Bookings."
              : "Complete the 3 required steps below, then pick the event type on each agent that should book."}
          </p>
        </div>

        <ol className="space-y-2">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.id}>
                <Link href={step.href}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 rounded-xl border border-border/60 bg-card/40 px-3.5 py-3 text-left transition-colors hover:bg-muted/30"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/50">
                      {step.ready ? (
                        <Check className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium flex items-center gap-2 flex-wrap">
                        <span>
                          {i + 1}. {step.title}
                        </span>
                        <span
                          className={cn(
                            "text-[10px] font-normal rounded-md px-1.5 py-0.5 border",
                            step.required
                              ? "border-border/60 text-muted-foreground"
                              : "border-border/40 text-muted-foreground/70",
                          )}
                        >
                          {step.required ? "Required" : "Optional"}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">{step.blurb}</p>
                    </div>
                    <ArrowRight className="mt-2 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  </button>
                </Link>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" className="h-9">
            <Link href={`${BASE}/app/scheduling`}>Open Bookings</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-9">
            <Link href={`${BASE}/app/scheduling/calendars`}>Advanced settings</Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-9 text-muted-foreground">
            <Link href={`${BASE}/app/scheduling/event-types`}>Event types</Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-9 text-muted-foreground">
            <Link href={`${BASE}/app/scheduling/availability`}>Availability</Link>
          </Button>
        </div>
      </div>
    </StripePage>
  );
}
