export interface BookingFormInputs {
  eventTypeSlug: string;
  slotStart: string;
  attendeeName: string;
  attendeeEmail: string;
  attendeeNotes?: string;
}

export interface BookingPayload {
  eventTypeSlug: string;
  slotStart: string;
  attendeeName: string;
  attendeeEmail: string;
  attendeeNotes?: string;
}

/**
 * Builds the payload for POST /api/scheduling/public/bookings.
 *
 * Keeps payload construction in one place so both the UI component and
 * unit tests share the same logic. The server uses zod.coerce.date() on
 * slotStart, so an ISO 8601 string is the correct wire format.
 */
export function buildBookingPayload(inputs: BookingFormInputs): BookingPayload {
  const { eventTypeSlug, slotStart, attendeeName, attendeeEmail, attendeeNotes } = inputs;

  const payload: BookingPayload = {
    eventTypeSlug,
    slotStart,
    attendeeName,
    attendeeEmail,
  };

  if (attendeeNotes !== undefined && attendeeNotes !== "") {
    payload.attendeeNotes = attendeeNotes;
  }

  return payload;
}
