import { Link, useLocation } from "wouter";
import { Calendar, Clock, CalendarCheck, Video, CalendarDays, Settings2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const ADVANCED = [
  { label: "Calendars", href: `${BASE}/app/scheduling/calendars`, icon: Calendar },
  { label: "Event Types", href: `${BASE}/app/scheduling/event-types`, icon: Clock },
  { label: "Availability", href: `${BASE}/app/scheduling/availability`, icon: CalendarCheck },
  { label: "Conferencing", href: `${BASE}/app/scheduling/conferencing`, icon: Video },
] as const;

/** Bookings ops + Setup (Connections). Advanced tabs only when already in advanced routes. */
export function SchedulingTabNav() {
  const [location] = useLocation();
  const bookingsHref = `${BASE}/app/scheduling`;
  const onBookings = location === bookingsHref || location === `${bookingsHref}/`;
  const onAdvanced = ADVANCED.some((t) => location.startsWith(t.href));

  return (
    <div className="border-b border-border bg-background">
      <div className="flex items-center gap-0 px-6 overflow-x-auto">
        <Link href={bookingsHref}>
          <button
            type="button"
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              onBookings
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Bookings
          </button>
        </Link>
        <Link href={`${BASE}/app/connections?setup=calendar`}>
          <button
            type="button"
            className="flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:border-border transition-colors whitespace-nowrap"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Setup
          </button>
        </Link>
        {onAdvanced &&
          ADVANCED.map((tab) => {
            const active = location.startsWith(tab.href);
            const Icon = tab.icon;
            return (
              <Link key={tab.href} href={tab.href}>
                <button
                  type="button"
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              </Link>
            );
          })}
      </div>
    </div>
  );
}
