import { useState } from "react";
import { Link, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { Calendar, Plus, Filter, ChevronRight, Clock, User, Mail } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function statusBadge(status: string) {
  switch (status) {
    case "confirmed":   return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50">{status}</Badge>;
    case "pending":     return <Badge className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50">{status}</Badge>;
    case "cancelled":   return <Badge className="bg-red-50 text-red-600 border-red-200 hover:bg-red-50">{status}</Badge>;
    case "rescheduled": return <Badge className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50">{status}</Badge>;
    default:            return <Badge variant="outline">{status}</Badge>;
  }
}

export default function SchedulingPage() {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [calendarFilter, setCalendarFilter] = useState<string>("all");

  const { data: bookings, isLoading } = useListBookings(
    {
      status: statusFilter !== "all" ? statusFilter as Booking["status"] : undefined,
      calendarId: calendarFilter !== "all" ? parseInt(calendarFilter) : undefined,
    },
    { query: { queryKey: getListBookingsQueryKey({ status: statusFilter !== "all" ? statusFilter as any : undefined, calendarId: calendarFilter !== "all" ? parseInt(calendarFilter) : undefined }) } }
  );
  const { data: calendars } = useListCalendars();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-50">
            <Calendar className="h-5 w-5 text-emerald-600" />
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

      <div className="flex gap-3 items-center">
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
                <TableHead>Booked</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))}
              {!isLoading && (!bookings || bookings.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    No bookings found
                  </TableCell>
                </TableRow>
              )}
              {bookings?.map(b => (
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
                  <TableCell>{statusBadge(b.status)}</TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground capitalize">{b.bookedVia}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(parseISO(b.createdAt), "MMM d")}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
