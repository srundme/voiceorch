import { useState } from "react";
import { Link, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { Calendar, Filter, ChevronRight, Bot, Globe, Plus } from "lucide-react";
import { StripePage } from "@/components/stripe-page";
import { EmptyState } from "@/components/empty-state";
import {
  useListBookings,
  useListCalendars,
  getListBookingsQueryKey,
} from "@workspace/api-client-react";
import type { Booking } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const SCHED_TABS = [
  { label: "Bookings", href: `${BASE}/app/scheduling`, exact: true },
  { label: "Calendars", href: `${BASE}/app/scheduling/calendars` },
  { label: "Event Types", href: `${BASE}/app/scheduling/event-types` },
  { label: "Availability", href: `${BASE}/app/scheduling/availability` },
  { label: "Conferencing", href: `${BASE}/app/scheduling/conferencing` },
] as const;

function statusBadge(status: string) {
  switch (status) {
    case "confirmed":
      return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10 text-[10px]">{status}</Badge>;
    case "pending":
      return <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/10 text-[10px]">{status}</Badge>;
    case "cancelled":
      return <Badge className="bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/10 text-[10px]">{status}</Badge>;
    case "rescheduled":
      return <Badge className="bg-sky-500/10 text-sky-400 border-sky-500/20 hover:bg-sky-500/10 text-[10px]">{status}</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
  }
}

function sourceBadge(bookedVia: string) {
  if (bookedVia === "agent") {
    return (
      <Badge className="bg-muted text-foreground border-border hover:bg-muted gap-1">
        <Bot className="h-3 w-3" />Agent Call
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Globe className="h-3 w-3" />Web
    </Badge>
  );
}

function CalSyncBadge({ status, error }: { status: Booking["calendarSyncStatus"]; error?: string | null }) {
  let badge: React.ReactNode;
  switch (status) {
    case "synced":
      badge = (
        <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800 text-xs">
          Synced
        </Badge>
      );
      break;
    case "scope_insufficient":
      badge = (
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800 text-xs">
          Scope issue
        </Badge>
      );
      break;
    case "sync_failed":
      badge = (
        <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800 text-xs">
          Sync failed
        </Badge>
      );
      break;
    case "skipped":
    default:
      badge = (
        <Badge variant="outline" className="text-muted-foreground text-xs">
          No calendar
        </Badge>
      );
      break;
  }

  if (!error) return <>{badge}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help">{badge}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs break-words">
        {error}
      </TooltipContent>
    </Tooltip>
  );
}

export default function SchedulingPage() {
  const [location, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [calendarFilter, setCalendarFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [syncFilter, setSyncFilter] = useState<string>("all");

  const queryParams = {
    status: statusFilter !== "all" ? statusFilter as Booking["status"] : undefined,
    calendarId: calendarFilter !== "all" ? parseInt(calendarFilter) : undefined,
    bookedVia: sourceFilter !== "all" ? sourceFilter as Booking["bookedVia"] : undefined,
    calendarSyncStatus: syncFilter !== "all" ? syncFilter as Booking["calendarSyncStatus"] : undefined,
  };

  const { data: bookings, isLoading } = useListBookings(
    queryParams,
    { query: { queryKey: getListBookingsQueryKey(queryParams) } }
  );
  const { data: calendars } = useListCalendars();

  return (
    <TooltipProvider>
      <StripePage
        title="Bookings"
        description="Appointments booked by agents or the web — sync status and attendee details in one place."
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5 rounded-lg"
            onClick={() => navigate(`${BASE}/app/scheduling/calendars`)}
          >
            <Plus className="h-3.5 w-3.5" />
            Set up calendar
          </Button>
        }
        tabs={
          <div className="flex items-center gap-0 -mx-1 overflow-x-auto">
            {SCHED_TABS.map((tab) => {
              const exact = "exact" in tab && tab.exact;
              const active = exact
                ? location === tab.href || location === `${tab.href}/`
                : location.startsWith(tab.href);
              return (
                <Link key={tab.href} href={tab.href}>
                  <button
                    type="button"
                    className={cn(
                      "relative px-3 pb-3 text-[13px] font-medium transition-colors whitespace-nowrap",
                      active
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground/80",
                    )}
                  >
                    {tab.label}
                    {active && (
                      <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-foreground" />
                    )}
                  </button>
                </Link>
              );
            })}
          </div>
        }
      >
        <div className="mb-4 flex gap-2 items-center flex-wrap">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <Filter className="h-3 w-3 mr-1.5 opacity-50" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="rescheduled">Rescheduled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="agent">Agent Call</SelectItem>
              <SelectItem value="web">Web</SelectItem>
              <SelectItem value="api">API</SelectItem>
            </SelectContent>
          </Select>
          <Select value={syncFilter} onValueChange={setSyncFilter}>
            <SelectTrigger className="w-[150px] h-8 text-xs">
              <SelectValue placeholder="Cal sync" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sync statuses</SelectItem>
              <SelectItem value="synced">Synced</SelectItem>
              <SelectItem value="scope_insufficient">Scope issue</SelectItem>
              <SelectItem value="sync_failed">Sync failed</SelectItem>
              <SelectItem value="skipped">No calendar</SelectItem>
            </SelectContent>
          </Select>
          {calendars && calendars.length > 0 && (
            <Select value={calendarFilter} onValueChange={setCalendarFilter}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="Calendar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All calendars</SelectItem>
                {calendars.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <Card className="border-border/50">
          <CardContent className="p-0">
            {/* Mobile booking cards */}
            <div className="sm:hidden divide-y divide-border/60">
              {isLoading && Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="p-4 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
              {!isLoading && (!bookings || bookings.length === 0) && (
                <EmptyState
                  variant="inline"
                  icon={<Calendar />}
                  title="No bookings yet"
                  description={
                    statusFilter !== "all" || sourceFilter !== "all" || syncFilter !== "all" || calendarFilter !== "all"
                      ? "No bookings match these filters. Try clearing them."
                      : "When agents book appointments mid-call, they'll show up here."
                  }
                  action={{
                    label: "Open calendars",
                    onClick: () => navigate(`${BASE}/app/scheduling/calendars`),
                    icon: <Calendar className="h-3.5 w-3.5" />,
                  }}
                />
              )}
              {!isLoading && bookings?.map(b => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => navigate(`${BASE}/app/scheduling/bookings/${b.id}`)}
                  className="w-full text-left p-4 hover:bg-muted/40 transition-colors active:bg-muted/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{b.attendeeName}</p>
                      <p className="text-xs text-muted-foreground truncate">{b.attendeeEmail}</p>
                    </div>
                    {statusBadge(b.status)}
                  </div>
                  <p className="text-xs text-foreground/80 mt-2">
                    {format(parseISO(b.slotStart), "MMM d, yyyy · h:mm a")} – {format(parseISO(b.slotEnd), "h:mm a")}
                  </p>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {sourceBadge(b.bookedVia)}
                    <CalSyncBadge status={b.calendarSyncStatus} error={b.calendarSyncError} />
                  </div>
                </button>
              ))}
            </div>

            <div className="hidden sm:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attendee</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Via</TableHead>
                  <TableHead className="hidden lg:table-cell">Cal Sync</TableHead>
                  <TableHead className="hidden sm:table-cell">Booked</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))}
                {!isLoading && (!bookings || bookings.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={7} className="p-0 border-0">
                      <EmptyState
                        variant="inline"
                        icon={<Calendar />}
                        title="No bookings yet"
                        description={
                          statusFilter !== "all" || sourceFilter !== "all" || syncFilter !== "all" || calendarFilter !== "all"
                            ? "No bookings match these filters. Try clearing them."
                            : "When agents book appointments mid-call, they'll show up here. Start by connecting a calendar and event type."
                        }
                        action={{
                          label: "Open calendars",
                          onClick: () => navigate(`${BASE}/app/scheduling/calendars`),
                          icon: <Calendar className="h-3.5 w-3.5" />,
                        }}
                        secondaryAction={{
                          label: "Event types",
                          onClick: () => navigate(`${BASE}/app/scheduling/event-types`),
                        }}
                      />
                    </TableCell>
                  </TableRow>
                )}
                {(() => {
                  const replacedByMap = new Map<number, number>();
                  bookings?.forEach(b => {
                    if (b.rescheduledFromId != null) {
                      replacedByMap.set(b.rescheduledFromId, b.id);
                    }
                  });
                  return bookings?.map(b => (
                    <TableRow
                      key={b.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`${BASE}/app/scheduling/bookings/${b.id}`)}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">{b.attendeeName}</span>
                          <span className="text-xs text-muted-foreground">{b.attendeeEmail}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm">{format(parseISO(b.slotStart), "MMM d, yyyy")}</span>
                          <span className="text-xs text-muted-foreground">
                            {format(parseISO(b.slotStart), "h:mm a")} – {format(parseISO(b.slotEnd), "h:mm a")}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {statusBadge(b.status)}
                          {b.status === "rescheduled" && replacedByMap.has(b.id) && (
                            <span className="text-xs text-muted-foreground">
                              → <span
                                className="text-primary hover:underline cursor-pointer"
                                onClick={e => { e.stopPropagation(); navigate(`${BASE}/app/scheduling/bookings/${replacedByMap.get(b.id)}`); }}
                              >#{replacedByMap.get(b.id)}</span>
                            </span>
                          )}
                          {b.rescheduledFromId != null && (
                            <span className="text-xs text-muted-foreground">
                              from <span
                                className="text-primary hover:underline cursor-pointer"
                                onClick={e => { e.stopPropagation(); navigate(`${BASE}/app/scheduling/bookings/${b.rescheduledFromId}`); }}
                              >#{b.rescheduledFromId}</span>
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{sourceBadge(b.bookedVia)}</TableCell>
                      <TableCell className="hidden lg:table-cell" onClick={e => e.stopPropagation()}>
                        <CalSyncBadge status={b.calendarSyncStatus} error={b.calendarSyncError} />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {format(parseISO(b.createdAt), "MMM d")}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ));
                })()}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </StripePage>
    </TooltipProvider>
  );
}
