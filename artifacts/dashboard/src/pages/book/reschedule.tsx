import { useState } from "react";
import { useSearch } from "wouter";
import { format, parseISO } from "date-fns";
import { Calendar, Clock, CheckCircle, AlertCircle, Loader2, Video } from "lucide-react";
import {
  useGetPublicBookingByToken,
  useGetPublicSlots,
  useReschedulePublicBookingByToken,
  getGetPublicBookingByTokenQueryKey,
  getGetPublicSlotsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatApiError } from "@/lib/format-api-error";
import { HostBrandMark } from "@/components/logo";
import { addDays, formatDate, slotsByDay } from "./slotHelpers";

const BrandHeader = () => (
  <div className="flex flex-col items-center gap-1 mb-8">
    <HostBrandMark iconSize={26} wordmarkHeight={20} />
  </div>
);

export default function RescheduleBookingPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token") ?? "";

  const today = new Date();
  const startDate = formatDate(today);
  const endDate = formatDate(addDays(today, 13));

  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [rescheduled, setRescheduled] = useState(false);
  const [newMeetLink, setNewMeetLink] = useState<string | null>(null);
  const [newSlotStart, setNewSlotStart] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: booking,
    isLoading,
    error: tokenError,
  } = useGetPublicBookingByToken({ token }, { query: { enabled: !!token, retry: false, queryKey: getGetPublicBookingByTokenQueryKey({ token }) } });

  const { data: slots, isLoading: slotsLoading } = useGetPublicSlots(
    { slug: booking?.eventTypeSlug ?? "", startDate, endDate },
    { query: { enabled: !!booking?.eventTypeSlug, queryKey: getGetPublicSlotsQueryKey({ slug: booking?.eventTypeSlug ?? "", startDate, endDate }) } },
  );

  const rescheduleMut = useReschedulePublicBookingByToken();

  async function handleReschedule() {
    if (!selectedSlot) return;
    setActionError(null);
    try {
      const result = await rescheduleMut.mutateAsync({ data: { token, slotStart: selectedSlot } });
      setNewMeetLink(result.meetLink ?? null);
      setNewSlotStart(selectedSlot);
      setRescheduled(true);
    } catch (err) {
      setActionError(formatApiError(err));
    }
  }

  const PageShell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-3xl mx-auto">
        <BrandHeader />
        {children}
        <p className="text-center mt-8">
</p>
      </div>
    </div>
  );

  if (!token) {
    return (
      <PageShell>
        <div className="max-w-md mx-auto">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <div className="text-center">
                <p className="font-semibold text-lg">Invalid link</p>
                <p className="text-muted-foreground text-sm mt-1">This reschedule link is missing a token. Please use the link from your confirmation email.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <div className="max-w-md mx-auto">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground">Loading booking details…</p>
            </CardContent>
          </Card>
        </div>
      </PageShell>
    );
  }

  if (tokenError || !booking) {
    return (
      <PageShell>
        <div className="max-w-md mx-auto">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <div className="text-center">
                <p className="font-semibold text-lg">Link expired or invalid</p>
                <p className="text-muted-foreground text-sm mt-1">
                  This reschedule link is no longer valid. It may have expired (links expire at your original appointment time) or the booking has already been cancelled.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageShell>
    );
  }

  if (booking.status === "cancelled" || booking.status === "rescheduled") {
    return (
      <PageShell>
        <div className="max-w-md mx-auto">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <AlertCircle className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-semibold text-xl">Booking no longer active</p>
                <p className="text-muted-foreground mt-2">
                  This booking has been {booking.status}. It can no longer be rescheduled.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageShell>
    );
  }

  if (rescheduled && newSlotStart) {
    return (
      <PageShell>
        <div className="max-w-md mx-auto">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <div className="p-4 rounded-full bg-muted">
                <CheckCircle className="h-10 w-10 text-zinc-500" />
              </div>
              <div className="w-full">
                <p className="font-semibold text-xl">Appointment rescheduled!</p>
                <p className="text-muted-foreground mt-2">
                  Your appointment has been moved to{" "}
                  <strong>{format(parseISO(newSlotStart), "EEEE, MMMM d, yyyy")}</strong> at{" "}
                  <strong>{format(parseISO(newSlotStart), "h:mm a")}</strong>.
                </p>
                <p className="text-muted-foreground text-sm mt-1">
                  A confirmation has been sent to {booking.attendeeEmail}.
                </p>
                {newMeetLink && (
                  <div className="mt-5 p-4 rounded-lg bg-muted border border-border flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2 text-foreground font-medium text-sm">
                      <Video className="h-4 w-4" />
                      Join with Google Meet
                    </div>
                    <a
                      href={newMeetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline underline-offset-2 text-sm break-all hover:text-zinc-800"
                    >
                      {newMeetLink}
                    </a>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </PageShell>
    );
  }

  const groupedSlots = slotsByDay(slots ?? []);
  const currentSlotStart = parseISO(booking.slotStart);
  const currentSlotEnd = parseISO(booking.slotEnd);

  return (
    <PageShell>
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-foreground text-sm font-medium mb-4">
          <Clock className="h-3.5 w-3.5" />
          Reschedule appointment
        </div>
        <h1 className="text-3xl font-bold text-slate-900">{booking.eventTypeName}</h1>
      </div>

      <div className="mb-6 p-4 rounded-lg bg-muted/60 border border-border text-sm text-slate-700">
        <p className="font-medium text-slate-800 mb-1">Current appointment</p>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Calendar className="h-4 w-4 shrink-0" />
          <span>{format(currentSlotStart, "EEEE, MMMM d, yyyy")}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground mt-1">
          <Clock className="h-4 w-4 shrink-0" />
          <span>{format(currentSlotStart, "h:mm a")} – {format(currentSlotEnd, "h:mm a")} ({booking.timezone})</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Pick a new time
          </h2>
          {slotsLoading && <div className="text-muted-foreground text-sm animate-pulse">Loading available slots…</div>}
          {!slotsLoading && Object.keys(groupedSlots).length === 0 && (
            <p className="text-muted-foreground text-sm">No available slots in the next 2 weeks. Please check back later.</p>
          )}
          <div className="flex flex-col gap-4">
            {Object.entries(groupedSlots).map(([day, daySlots]) => (
              <div key={day}>
                <p className="text-xs font-semibold text-slate-500 mb-2">
                  {format(parseISO(day + "T00:00:00"), "EEEE, MMMM d")}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {daySlots.map(slot => (
                    <button
                      key={slot}
                      onClick={() => setSelectedSlot(slot)}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                        selectedSlot === slot
                          ? "bg-zinc-600 border-zinc-600 text-white"
                          : "bg-card border-slate-200 text-slate-700 hover:border-zinc-400 hover:bg-muted"
                      }`}
                    >
                      {format(parseISO(slot), "h:mm a")}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {selectedSlot && (
            <div className="p-3 rounded-lg bg-muted border border-border text-sm text-zinc-800">
              <strong>New time:</strong>{" "}
              {format(parseISO(selectedSlot), "EEEE, MMMM d")} at {format(parseISO(selectedSlot), "h:mm a")}
            </div>
          )}

          {actionError && (
            <div className="p-3 rounded-lg bg-muted border border-border text-sm text-foreground">
              {actionError}
            </div>
          )}

          <Button
            className="bg-zinc-600 hover:bg-zinc-700 text-white"
            disabled={!selectedSlot || rescheduleMut.isPending}
            onClick={handleReschedule}
          >
            {rescheduleMut.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Rescheduling…</>
            ) : (
              "Confirm new time"
            )}
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
