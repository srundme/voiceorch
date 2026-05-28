import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { format, parseISO } from "date-fns";
import { Calendar, Clock, CheckCircle, AlertCircle, Video } from "lucide-react";
import { buildBookingPayload } from "./bookingPayload";
import { addDays, formatDate, slotsByDay } from "./slotHelpers";
import {
  useGetPublicEventType,
  useGetPublicSlots,
  useCreatePublicBooking,
} from "@workspace/api-client-react";
import { CreatePublicBookingBody } from "@workspace/api-zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatApiError } from "@/lib/format-api-error";
import { SnapServeLogo } from "@/components/logo";


export default function PublicBookingPage() {
  const [, params] = useRoute("/book/:slug");
  const slug = params?.slug ?? "";

  const today = new Date();
  const [startDate] = useState(formatDate(today));
  const [endDate] = useState(formatDate(addDays(today, 13)));
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [meetLink, setMeetLink] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string }>({});
  const [touched, setTouched] = useState<{ name?: boolean; email?: boolean }>({});

  const { data: eventType, isLoading: etLoading, error: etError } = useGetPublicEventType(slug);

  useEffect(() => {
    if (eventType?.name) {
      document.title = `${eventType.name} — powered by SnapServe`;
    } else {
      document.title = "Book a meeting · SnapServe";
    }
    return () => {
      document.title = "SnapServe";
    };
  }, [eventType?.name]);

  const { data: slots, isLoading: slotsLoading } = useGetPublicSlots({ slug, startDate, endDate });

  const createMut = useCreatePublicBooking();

  function validateFields(fields: { name: string; email: string }) {
    const result = CreatePublicBookingBody.safeParse({
      eventTypeSlug: slug || "placeholder",
      slotStart: selectedSlot ?? new Date().toISOString(),
      attendeeName: fields.name,
      attendeeEmail: fields.email,
    });
    const errors: { name?: string; email?: string } = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (field === "attendeeName" && !errors.name) {
          errors.name = "Name is required";
        }
        if (field === "attendeeEmail" && !errors.email) {
          errors.email = fields.email.trim() === "" ? "Email is required" : "Please enter a valid email address";
        }
      }
    }
    return errors;
  }

  function handleBlur(field: "name" | "email") {
    setTouched(prev => ({ ...prev, [field]: true }));
    const errors = validateFields({ name, email });
    setFieldErrors(errors);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ name: true, email: true });
    const errors = validateFields({ name, email });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !selectedSlot) return;
    setBookingError(null);
    try {
      const booking = await createMut.mutateAsync({
        data: buildBookingPayload({
          eventTypeSlug: slug,
          slotStart: selectedSlot,
          attendeeName: name,
          attendeeEmail: email,
          attendeeNotes: notes,
        }),
      });
      setMeetLink(booking.meetLink ?? null);
      setSubmitted(true);
    } catch (err: unknown) {
      setBookingError(formatApiError(err));
    }
  }

  const BrandHeader = () => (
    <div className="flex justify-center mb-8">
      <SnapServeLogo size="lg" showIcon iconSize={26} className="text-foreground" />
    </div>
  );

  if (etLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  if (etError || !eventType) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="max-w-md w-full">
          <BrandHeader />
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <div className="text-center">
                <p className="font-semibold text-lg">Page not found</p>
                <p className="text-muted-foreground text-sm mt-1">This booking link is invalid or has been removed.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="max-w-md w-full">
          <BrandHeader />
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <div className="p-4 rounded-full bg-muted">
                <CheckCircle className="h-10 w-10 text-zinc-500" />
              </div>
              <div className="w-full">
                <p className="font-semibold text-xl">Booking confirmed!</p>
                <p className="text-muted-foreground mt-2">
                  You'll receive a confirmation email at <strong>{email}</strong>.
                </p>
                {selectedSlot && (
                  <p className="text-sm text-muted-foreground mt-2">
                    {format(parseISO(selectedSlot), "EEEE, MMMM d, yyyy")} at {format(parseISO(selectedSlot), "h:mm a")}
                  </p>
                )}
                {meetLink && (
                  <div className="mt-5 p-4 rounded-lg bg-muted border border-border flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2 text-foreground font-medium text-sm">
                      <Video className="h-4 w-4" />
                      Join with Google Meet
                    </div>
                    <a
                      href={meetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline underline-offset-2 text-sm break-all hover:text-zinc-800"
                    >
                      {meetLink}
                    </a>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          <p className="text-center text-xs text-muted-foreground mt-4">Powered by SnapServe</p>
        </div>
      </div>
    );
  }

  const groupedSlots = slotsByDay(slots ?? []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <BrandHeader />
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-foreground text-sm font-medium mb-4">
            <Clock className="h-3.5 w-3.5" />
            {eventType.durationMinutes} min
          </div>
          <h1 className="text-3xl font-bold text-slate-900">{eventType.name}</h1>
          {eventType.description && (
            <p className="text-slate-600 mt-2">{eventType.description}</p>
          )}
          {eventType.confirmationMode === "manual" && (
            <Badge variant="outline" className="mt-2">Requires host approval</Badge>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Select a time
            </h2>
            {slotsLoading && <div className="text-muted-foreground text-sm animate-pulse">Loading slots...</div>}
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

          <div>
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">
              Your details
            </h2>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Full name <span className="text-destructive">*</span></Label>
                <Input
                  id="name"
                  value={name}
                  onChange={e => {
                    setName(e.target.value);
                    if (touched.name) {
                      const errors = validateFields({ name: e.target.value, email });
                      setFieldErrors(prev => ({ ...prev, name: errors.name }));
                    }
                  }}
                  onBlur={() => handleBlur("name")}
                  aria-invalid={touched.name && !!fieldErrors.name}
                  aria-describedby={fieldErrors.name ? "name-error" : undefined}
                  placeholder="Jane Smith"
                  className={`bg-card ${touched.name && fieldErrors.name ? "border-destructive focus-visible:ring-destructive" : ""}`}
                />
                {touched.name && fieldErrors.name && (
                  <p id="name-error" className="text-sm text-destructive">{fieldErrors.name}</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email <span className="text-destructive">*</span></Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    if (touched.email) {
                      const errors = validateFields({ name, email: e.target.value });
                      setFieldErrors(prev => ({ ...prev, email: errors.email }));
                    }
                  }}
                  onBlur={() => handleBlur("email")}
                  aria-invalid={touched.email && !!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? "email-error" : undefined}
                  placeholder="jane@example.com"
                  className={`bg-card ${touched.email && fieldErrors.email ? "border-destructive focus-visible:ring-destructive" : ""}`}
                />
                {touched.email && fieldErrors.email && (
                  <p id="email-error" className="text-sm text-destructive">{fieldErrors.email}</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Anything you'd like to share in advance..."
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                />
              </div>

              {selectedSlot && (
                <div className="p-3 rounded-lg bg-muted border border-border text-sm text-zinc-800">
                  <strong>Selected:</strong> {format(parseISO(selectedSlot), "EEEE, MMMM d")} at {format(parseISO(selectedSlot), "h:mm a")}
                </div>
              )}

              {bookingError && (
                <div className="p-3 rounded-lg bg-muted border border-border text-sm text-foreground">
                  {bookingError}
                </div>
              )}

              <Button
                type="submit"
                className="bg-zinc-600 hover:bg-zinc-700 text-white"
                disabled={!selectedSlot || !name || !email || createMut.isPending}
              >
                {createMut.isPending ? "Booking..." : "Confirm booking"}
              </Button>
            </form>
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-8">Powered by SnapServe</p>
      </div>
    </div>
  );
}
