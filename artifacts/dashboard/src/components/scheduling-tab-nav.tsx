import { Link, useLocation } from "wouter";
import { Calendar, Clock, CalendarCheck, Video, CalendarDays } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const TABS = [
  { label: "Bookings",     href: `${BASE}/app/scheduling`,              icon: CalendarDays,  exact: true  },
  { label: "Calendars",    href: `${BASE}/app/scheduling/calendars`,    icon: Calendar,      exact: false },
  { label: "Event Types",  href: `${BASE}/app/scheduling/event-types`,  icon: Clock,         exact: false },
  { label: "Availability", href: `${BASE}/app/scheduling/availability`, icon: CalendarCheck, exact: false },
  { label: "Conferencing", href: `${BASE}/app/scheduling/conferencing`, icon: Video,         exact: false },
] as const;

export function SchedulingTabNav() {
  const [location] = useLocation();

  function isActive(href: string, exact: boolean) {
    if (exact) return location === href || location === href + "/";
    return location.startsWith(href);
  }

  return (
    <div className="border-b border-border bg-background">
      <div className="flex items-center gap-0 px-6 overflow-x-auto">
        {TABS.map(tab => {
          const active = isActive(tab.href, tab.exact);
          const Icon = tab.icon;
          return (
            <Link key={tab.href} href={tab.href}>
              <button
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
