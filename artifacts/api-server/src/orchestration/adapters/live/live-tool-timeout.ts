const LIVE_TOOL_TIMEOUT_MS = 15_000;
const LIVE_BOOKING_TOOL_TIMEOUT_MS = 45_000;

/** Calendar book/check can exceed the generic 15s Live tool cap (GCal + slots). */
export function liveToolTimeoutMs(toolType: string): number {
  if (
    toolType === "native_booking"
    || toolType === "native_check_availability"
    || toolType === "native_reschedule"
    || toolType === "native_cancel"
  ) {
    return LIVE_BOOKING_TOOL_TIMEOUT_MS;
  }
  return LIVE_TOOL_TIMEOUT_MS;
}
