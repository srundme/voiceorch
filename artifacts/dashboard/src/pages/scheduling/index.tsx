import { useState } from "react";
import { Link, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { Calendar, Filter, ChevronRight, Bot, Globe } from "lucide-react";
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
import { useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function statusBadge(status: string) {
  switch (status) {
    case "confirmed":   return <Badge className="bg-muted text-foreground border-border hover:bg-muted">{status}</Badge>;
    case "pending":     return <Badge className="bg-muted text-foreground border-border hover:bg-muted">{status}</Badge>;
    case "cancelled":   return <Badge className="bg-muted text-foreground border-border hover:bg-muted">{status}</Badge>;
    case "rescheduled": return <Badge className="bg-muted text-foreground border-border hover:bg-muted">{status}</Badge>;
    default:            return <Badge variant="outline">{status}</Badge>;
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
  const [, navigate] = useLocation();
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
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-muted">
              <Calendar className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Scheduling</h1>
              <p className="text-sm text-muted-foreground">Manage bookings, event types, and availability</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`${BASE}/app/scheduling/calendars`}>Calendars</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`${BASE}/app/scheduling/event-types`}>Event Types</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`${BASE}/app/scheduling/availability`}>Availability</Link>
            </Button>
          </div>
        </div>

        <div className="flex gap-3 items-center flex-wrap">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <Filter className="h-3.5 w-3.5 mr-2" />
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
            <SelectTrigger className="w-40">
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
            <SelectTrigger className="w-44">
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
              <SelectTrigger className="w-48">
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

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attendee</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Via</TableHead>
                  <TableHead>Cal Sync</TableHead>
                  <TableHead>Booked</TableHead>
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
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      No bookings found
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
                      <TableCell>{sourceBadge(b.bookedVia)}</TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <CalSyncBadge status={b.calendarSyncStatus} error={b.calendarSyncError} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
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
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
