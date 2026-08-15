import { useState } from "react";
import { useSearch } from "wouter";
import { format, parseISO } from "date-fns";
import { CheckCircle, AlertCircle, Calendar, Clock, Loader2 } from "lucide-react";
import {
  useGetPublicBookingByToken,
  useCancelPublicBookingByToken,
  getGetPublicBookingByTokenQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatApiError } from "@/lib/format-api-error";
import { BrandMark } from "@/components/logo";

const BrandHeader = () => (
  <div className="flex flex-col items-center gap-1 mb-8">
    <BrandMark iconSize={26} wordmarkHeight={20} />
  </div>
);

export default function CancelBookingPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token") ?? "";

  const [cancelled, setCancelled] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: booking,
    isLoading,
    error: tokenError,
  } = useGetPublicBookingByToken({ token }, { query: { enabled: !!token, retry: false, queryKey: getGetPublicBookingByTokenQueryKey({ token }) } });

  const cancelMut = useCancelPublicBookingByToken();

  async function handleCancel() {
    setActionError(null);
    try {
      await cancelMut.mutateAsync({ data: { token } });
      setCancelled(true);
    } catch (err) {
      setActionError(formatApiError(err));
    }
  }

  const PageShell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-md w-full">
        <BrandHeader />
        {children}
        <p className="text-center mt-4">
</p>
      </div>
    </div>
  );

  if (!token) {
    return (
      <PageShell>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div className="text-center">
              <p className="font-semibold text-lg">Invalid link</p>
              <p className="text-muted-foreground text-sm mt-1">This cancellation link is missing a token. Please use the link from your confirmation email.</p>
            </div>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Loading booking details…</p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (tokenError || !booking) {
    return (
      <PageShell>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div className="text-center">
              <p className="font-semibold text-lg">Link expired or invalid</p>
              <p className="text-muted-foreground text-sm mt-1">
                This cancellation link is no longer valid. It may have expired or the booking has already been cancelled.
              </p>
            </div>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (booking.status === "cancelled") {
    return (
      <PageShell>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="p-4 rounded-full bg-muted">
              <CheckCircle className="h-10 w-10 text-zinc-500" />
            </div>
            <div>
              <p className="font-semibold text-xl">Already cancelled</p>
              <p className="text-muted-foreground mt-2">This booking has already been cancelled.</p>
            </div>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (cancelled) {
    return (
      <PageShell>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="p-4 rounded-full bg-muted">
              <CheckCircle className="h-10 w-10 text-zinc-500" />
            </div>
            <div>
              <p className="font-semibold text-xl">Booking cancelled</p>
              <p className="text-muted-foreground mt-2">
                Your appointment has been cancelled. A confirmation has been sent to <strong>{booking.attendeeEmail}</strong>.
              </p>
            </div>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const slotStart = parseISO(booking.slotStart);
  const slotEnd = parseISO(booking.slotEnd);

  return (
    <PageShell>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Cancel appointment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="rounded-lg bg-muted p-4 flex flex-col gap-2 text-sm">
            <p className="font-semibold text-base">{booking.eventTypeName}</p>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4 shrink-0" />
              <span>{format(slotStart, "EEEE, MMMM d, yyyy")}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" />
              <span>{format(slotStart, "h:mm a")} – {format(slotEnd, "h:mm a")} ({booking.timezone})</span>
            </div>
            <p className="text-muted-foreground">Booked for <strong>{booking.attendeeName}</strong></p>
          </div>

          <p className="text-sm text-muted-foreground">
            Are you sure you want to cancel this appointment? This action cannot be undone and you'll need to book a new slot if you change your mind.
          </p>

          {actionError && (
            <div className="p-3 rounded-lg bg-muted border border-border text-sm text-foreground">
              {actionError}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelMut.isPending}
            >
              {cancelMut.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Cancelling…</>
              ) : (
                "Yes, cancel this appointment"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => window.history.back()}
              disabled={cancelMut.isPending}
            >
              Keep appointment
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
