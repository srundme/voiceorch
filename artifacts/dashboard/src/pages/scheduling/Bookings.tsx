import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Calendar, Clock, User, Mail, Phone, X, RotateCcw, Check, ChevronLeft, Bot, ExternalLink } from "lucide-react";
import {
  useGetBooking,
  useUpdateBooking,
  getListBookingsQueryKey,
} from "@workspace/api-client-react";
import type { Booking } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function statusBadge(status: string) {
  switch (status) {
    case "confirmed":   return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">{status}</Badge>;
    case "pending":     return <Badge className="bg-amber-50 text-amber-700 border-amber-200">{status}</Badge>;
    case "cancelled":   return <Badge className="bg-red-50 text-red-600 border-red-200">{status}</Badge>;
    case "rescheduled": return <Badge className="bg-blue-50 text-blue-700 border-blue-200">{status}</Badge>;
    default:            return <Badge variant="outline">{status}</Badge>;
  }
}

export default function BookingDetailPage() {
  const [, params] = useRoute("/app/scheduling/bookings/:id");
  const [, navigate] = useLocation();
  const id = parseInt(params?.id ?? "0");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: booking, isLoading, error } = useGetBooking(id);
  const updateMut = useUpdateBooking();

  const [showCancel, setShowCancel] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");

  async function handleCancel() {
    try {
      await updateMut.mutateAsync({ id, data: { status: "cancelled" } });
      await qc.invalidateQueries({ queryKey: getListBookingsQueryKey() });
      setShowCancel(false);
      toast({ title: "Booking cancelled" });
    } catch (e) {
      toast({ title: "Error", description: formatApiError(e), variant: "destructive" });
    }
  }

  async function handleConfirm() {
    try {
      await updateMut.mutateAsync({ id, data: { status: "confirmed" } });
      await qc.invalidateQueries({ queryKey: getListBookingsQueryKey() });
      toast({ title: "Booking confirmed" });
    } catch (e) {
      toast({ title: "Error", description: formatApiError(e), variant: "destructive" });
    }
  }

  async function handleReschedule() {
    if (!rescheduleDate || !rescheduleTime) {
      toast({ title: "Please select date and time", variant: "destructive" });
      return;
    }
    const slotStart = new Date(`${rescheduleDate}T${rescheduleTime}:00`).toISOString();
    try {
      await updateMut.mutateAsync({ id, data: { status: "rescheduled", slotStart } });
      await qc.invalidateQueries({ queryKey: getListBookingsQueryKey() });
      setShowReschedule(false);
      toast({ title: "Booking rescheduled" });
    } catch (e) {
      toast({ title: "Error", description: formatApiError(e), variant: "destructive" });
    }
  }

  if (isLoading) return <div className="p-6 text-muted-foreground animate-pulse">Loading...</div>;
  if (error || !booking) return <div className="p-6 text-destructive">Booking not found</div>;

  const isEditable = booking.status === "pending" || booking.status === "confirmed";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(`${BASE}/app/scheduling`)}>
          <ChevronLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Booking #{booking.id}</h1>
          {statusBadge(booking.status)}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Attendee</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{booking.attendeeName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <a href={`mailto:${booking.attendeeEmail}`} className="text-primary hover:underline">{booking.attendeeEmail}</a>
            </div>
            {booking.attendeeNotes && (
              <div className="text-sm text-muted-foreground bg-muted rounded p-2">
                {booking.attendeeNotes}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Slot</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>{format(parseISO(booking.slotStart), "EEEE, MMMM d, yyyy")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>{format(parseISO(booking.slotStart), "h:mm a")} – {format(parseISO(booking.slotEnd), "h:mm a")}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {booking.bookedVia === "agent" ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 font-medium">
                  <Bot className="h-3 w-3" />Agent Call
                </span>
              ) : (
                <span className="capitalize font-medium">{booking.bookedVia}</span>
              )}
              <span>on {format(parseISO(booking.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
            </div>
            {booking.bookedVia === "agent" && booking.callId != null && (
              <a
                href={`${BASE}/app/calls/${booking.callId}`}
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mt-0.5"
                onClick={e => e.stopPropagation()}
              >
                <ExternalLink className="h-3 w-3" />
                View call log #{booking.callId}
              </a>
            )}
          </CardContent>
        </Card>
      </div>

      {isEditable && (
        <div className="flex gap-3">
          {booking.status === "pending" && (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleConfirm} disabled={updateMut.isPending}>
              <Check className="h-3.5 w-3.5 mr-1" />Confirm
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowReschedule(true)}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />Reschedule
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setShowCancel(true)}>
            <X className="h-3.5 w-3.5 mr-1" />Cancel
          </Button>
        </div>
      )}

      <Dialog open={showCancel} onOpenChange={setShowCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel booking?</DialogTitle>
            <DialogDescription>This will cancel the booking and notify the attendee by email.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancel(false)}>Keep</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={updateMut.isPending}>Cancel booking</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showReschedule} onOpenChange={setShowReschedule}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule booking</DialogTitle>
            <DialogDescription>Choose a new date and time for this booking.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-4 py-2">
            <div className="flex flex-col gap-1.5 flex-1">
              <Label>Date</Label>
              <Input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <Label>Time</Label>
              <Input type="time" value={rescheduleTime} onChange={e => setRescheduleTime(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReschedule(false)}>Cancel</Button>
            <Button onClick={handleReschedule} disabled={updateMut.isPending}>Reschedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
