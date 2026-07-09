export interface BookingToolMeta {
  type: string;
  fnName: string;
  label: string;
  description: string;
  color: string;
}

export const BOOKING_TOOLS: BookingToolMeta[] = [
  {
    type:        "native_booking",
    fnName:      "book_appointment",
    color:       "emerald",
    label:       "Book Appointment",
    description: "Lets the agent book a meeting slot for the caller. Agent collects name, email, and preferred time, then confirms the booking live.",
  },
  {
    type:        "native_check_availability",
    fnName:      "check_availability",
    color:       "sky",
    label:       "Check Availability",
    description: "Enables the agent to look up open slots before suggesting a time. Use alongside Book Appointment for a natural booking flow.",
  },
  {
    type:        "native_list_bookings",
    fnName:      "list_bookings",
    color:       "violet",
    label:       "List Bookings",
    description: "Allows the agent to retrieve existing bookings for the caller — useful for reschedule or cancellation flows.",
  },
  {
    type:        "native_reschedule",
    fnName:      "reschedule_booking",
    color:       "amber",
    label:       "Reschedule Booking",
    description: "Lets the agent reschedule an existing booking to a new time slot chosen by the caller.",
  },
  {
    type:        "native_cancel",
    fnName:      "cancel_booking",
    color:       "red",
    label:       "Cancel Booking",
    description: "Allows the agent to cancel an upcoming booking on the caller's request.",
  },
];

export const ALL_SCHEDULING_TOOL_TYPES = BOOKING_TOOLS.map(t => t.type);
