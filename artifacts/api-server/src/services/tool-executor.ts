import { format, addMinutes } from "date-fns";
import { toZonedTime, fromZonedTime, formatInTimeZone } from "date-fns-tz";
import {
  db,
  bookingsTable,
  eventTypesTable,
  schedulingCalendarsTable,
  availabilitySchedulesTable,
  availabilityOverridesTable,
  agentsTable,
  campaignLeadsTable,
  leadTransfersTable,
  leadTimelineTable,
  callExecutionsTable,
  type AgentConfig,
} from "@workspace/db";
import { eq, and, or, sql } from "drizzle-orm";
import { getAvailableSlots } from "./scheduling/slot-engine.js";
import { buildSlotLockKey } from "./scheduling/lock.js";
import {
  sendBookingCreatedEmail,
  sendBookingCancelledEmail,
  sendBookingRescheduledEmail,
} from "./scheduling/notifications.js";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  getFirstConnectionForUser,
} from "./scheduling/google-calendar.js";
import { dispatchSchedulingWebhooks } from "../routes/scheduling/webhooks.js";
import type { AgentConfig as _AgentConfig } from "../orchestration/types.js";
import type { AgentTool, ToolDefinition } from "../orchestration/types.js";
import { logger } from "../lib/logger.js";
import { writeExecutionLog } from "./execution-log.js";
import type { TimeSlot } from "./scheduling/slot-engine.js";
import { sendChannelEmail } from "./email-channel.js";
import { sendMidCallWhatsapp } from "./whatsapp/outbound.js";
import { resolveBookingLineageCallId } from "./meet-booking.js";
import { normalizeBookingDatetimeArgs } from "./booking-tool-args.js";

// ── Booking diagnostic log helper ────────────────────────────────────────────

/**
 * Append a structured booking step entry to the execution_logs table so it
 * surfaces in the Call Log detail view under the "Booking" component.
 * Fire-and-forget — never throws; logging failures must not block the booking.
 */
async function appendBookingLog(
  callId: number,
  agentId: number,
  step: string,
  data: Record<string, unknown>,
  status: "info" | "success" | "error" = "info",
): Promise<void> {
  writeExecutionLog(callId, agentId, "Booking", "system", {
    provider: "VoiceOrch",
    status,
    requestPayload: { step },
    responsePayload: data,
  });
}

// ── Tool name sanitization ────────────────────────────────────────────────────

/** Fallback name used when sanitization produces an empty string. */
const FALLBACK_TOOL_NAME = "tool";

/**
 * Normalize an arbitrary, user-entered tool name into a function name that is
 * valid across every LLM provider we support (Gemini, OpenAI, Anthropic, etc.).
 *
 * Gemini rejects an entire request with a 400 "Invalid function name" error if
 * any `functionDeclarations[].name` contains spaces, non-ASCII characters (e.g.
 * Tamil text), or other disallowed symbols. To stay safe across all providers we
 * restrict to the common intersection: `[A-Za-z0-9_]`, must start with a letter
 * or underscore, max 64 chars (OpenAI/Anthropic limit; Gemini allows 128).
 *
 * Deterministic + idempotent: the same input always maps to the same output, and
 * sanitizing an already-valid name is a no-op. This lets us sanitize names both
 * when building tool definitions (outbound) and when matching tool calls returned
 * by the LLM (inbound) without drift.
 */
export function sanitizeToolName(name: string): string {
  // Decompose accented characters then drop anything outside [A-Za-z0-9_].
  let s = (name ?? "").normalize("NFKD").replace(/[^a-zA-Z0-9_]/g, "_");
  // Collapse runs of underscores and trim leading/trailing ones.
  s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  // Must start with a letter or underscore — prefix one if it starts with a digit.
  if (/^[0-9]/.test(s)) s = "_" + s;
  // Enforce the 64-char max (re-trim a trailing underscore left by the slice).
  if (s.length > 64) s = s.slice(0, 64).replace(/_+$/g, "");
  // Fall back to a safe default if nothing usable survived.
  if (!s) s = FALLBACK_TOOL_NAME;
  return s;
}

/**
 * Find the tool an LLM invoked, matching against the same sanitized name that was
 * sent in the outbound tool definitions. Tries the raw name first (valid
 * snake_case tools behave exactly as before), then the sanitized forms so tools
 * whose stored names contain spaces/non-ASCII still resolve to the right tool.
 */
export function matchToolByName<T extends { name: string }>(
  tools: T[],
  calledName: string,
): T | undefined {
  return (
    tools.find((t) => t.name === calledName) ??
    tools.find((t) => sanitizeToolName(t.name) === calledName) ??
    tools.find((t) => sanitizeToolName(t.name) === sanitizeToolName(calledName))
  );
}

// ── Tool definitions builder ──────────────────────────────────────────────────

/** Canonical function name the LLM must use to hang up. */
export const END_CALL_TOOL_NAME = "end_call";

/** Shared description for the hangup tool, used by both the built-in injection
 *  and the canonicalized explicit end_call definition. */
const END_CALL_TOOL_DESCRIPTION =
  "End the phone call. ONLY call this when the caller EXPLICITLY says goodbye, bye, wants to hang up, or clearly states their needs are fully addressed AND they are done. Do NOT call this if the caller says 'hello', 'hi', or any greeting — that means they are still in the conversation. Do NOT end the call just because the topic seems concluded — always ask 'Is there anything else I can help you with?' first and wait for a clear goodbye or dismissal before ending.";

/** The canonical hangup ToolDefinition offered to the LLM. */
const END_CALL_TOOL_DEF: ToolDefinition = {
  name: END_CALL_TOOL_NAME,
  description: END_CALL_TOOL_DESCRIPTION,
  parameters: { type: "object", properties: {}, required: [] },
};

/**
 * Build the ToolDefinition array from an agent's tools array.
 * Always injects a built-in `end_call` tool unless the agent already defines one.
 * Suitable for passing directly to LLM adapters.
 */
export function buildToolDefs(tools: AgentTool[]): ToolDefinition[] {
  const hasExplicitEndCall = tools.some((t) => t.type === "end_call");
  const builtInEndCall: ToolDefinition[] = hasExplicitEndCall
    ? []
    : [{ ...END_CALL_TOOL_DEF }];

  const defs: ToolDefinition[] = [
    ...builtInEndCall,
    ...tools.map((t): ToolDefinition => {
      if (t.type === "native_booking") {
        return {
          name: t.name,
          description:
            t.description +
            " Call this tool to create the actual booking." +
            " CRITICAL RULES — violating any of these will cause an error:" +
            " (1) NEVER call this tool with placeholder, example, or test values — attendee_name must be the caller's real full name and attendee_email must be their real email address (not @example.com, @test.com, or similar fake domains)." +
            " (2) You MUST have the caller's real name AND real email address explicitly stated in the conversation before calling — do NOT fabricate or guess these details." +
            " (3) Only book ONE slot per conversation turn — present available slots to the caller, wait for them to choose one, then book only that ONE slot. Do NOT call this tool multiple times in a row." +
            " (4) Required fields: attendee_name (ask the caller if not yet provided) and attendee_email (ask the caller if not yet provided).",
          parameters: {
            type: "object",
            properties: {
              attendee_name: { type: "string", description: "Full name of the person being booked" },
              attendee_email: { type: "string", description: "Email address of the person being booked" },
              preferred_date: {
                type: "string",
                description:
                  "Optional preferred date or time of day for the appointment, e.g. 'next Tuesday', '2025-06-10', 'morning', or 'afternoon'. The system will find the first available slot on or after this date/time. If you ran check_availability first, pass the ISO 8601 string returned there (e.g. '2026-06-06T20:30:00+05:30') verbatim — do NOT convert or reformat it.",
              },
              timezone: {
                type: "string",
                description: "IANA timezone of the caller, e.g. 'America/New_York' or 'Asia/Kolkata'. Used to format the confirmation time in the caller's local timezone. Pass the same timezone you used in check_availability.",
              },
              meeting_type: {
                type: "string",
                enum: ["google_meet", "in_person"],
                description:
                  "Where the meeting takes place. Use 'google_meet' for a video call with an auto-generated Google Meet link, or 'in_person' for an in-person meeting at a physical address. Ask the caller which they prefer. Defaults to 'google_meet' if not specified.",
              },
              meeting_address: {
                type: "string",
                description:
                  "The physical address for the meeting. Required only when meeting_type is 'in_person'. Ask the caller for the address before booking.",
              },
            },
            required: ["attendee_name", "attendee_email"],
          },
        };
      }
      if (t.type === "native_reschedule") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              booking_id: { type: "string", description: "The booking reference ID to reschedule" },
              preferred_date: {
                type: "string",
                description:
                  "The requested date/time for the new slot." +
                  " When the caller names a specific time (e.g. '12 PM', '2:30 PM', 'noon'), pass a full ISO 8601 datetime with timezone offset, e.g. '2026-06-18T12:00:00+05:30'." +
                  " The system will book EXACTLY that slot if available, or return the nearest alternatives — it will NEVER silently pick a different time." +
                  " For vague preferences (e.g. 'morning', 'next Tuesday') a plain string is fine.",
              },
            },
            required: ["booking_id"],
          },
        };
      }
      if (t.type === "native_cancel") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              booking_id: { type: "string", description: "The booking reference ID to cancel" },
            },
            required: ["booking_id"],
          },
        };
      }
      if (t.type === "native_check_availability") {
        return {
          name: t.name,
          description:
            t.description +
            " This tool ONLY checks availability — it does NOT create a booking." +
            " The response has three possible formats:" +
            " (1) requested_slot_available: the 'slot' field contains the ISO 8601 string for the exact time the caller requested — tell the caller that time is available, then immediately collect their full name and email and call book_appointment with that ISO string verbatim as preferred_date." +
            " (2) requested_slot_unavailable: the requested time is not open — tell the caller and present the slots from the 'alternatives' field (each slot is shown as an ISO string followed by a human label in parentheses); once the caller chooses one, collect their name and email and call book_appointment with the chosen ISO string verbatim as preferred_date." +
            " (3) available_slots: the 'next' field lists up to 5 slots, each formatted as an ISO 8601 string followed by a human-readable label in parentheses, e.g. '2026-06-22T15:00:00+05:30 (Sun Jun 22 at 3:00 PM)' — present these to the caller, then after they choose one collect name and email and call book_appointment with the ISO string verbatim." +
            " Always pass ISO strings verbatim to book_appointment — do NOT convert or reformat them." +
            " Never confirm to the caller that an appointment is booked without first calling the booking tool and receiving a booking_confirmed result.",
          parameters: {
            type: "object",
            properties: {
              preferred_date: {
                type: "string",
                description:
                  "Optional preferred date or time of day to check availability for, e.g. 'next Tuesday', '2025-06-10', 'tomorrow morning'. When the caller names a specific time (e.g. '3 PM', '2:30 PM'), pass a full ISO 8601 datetime with timezone offset, e.g. '2026-06-22T15:00:00+05:30'. For vague preferences a plain string is fine. Defaults to the next 7 days.",
              },
              timezone: {
                type: "string",
                description: "IANA timezone, e.g. 'America/New_York' or 'Asia/Kolkata'. Defaults to Asia/Kolkata if not provided.",
              },
            },
            required: [],
          },
        };
      }
      if (t.type === "native_list_bookings") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              attendee_name: {
                type: "string",
                description: "Full name of the caller whose bookings you want to look up",
              },
              timezone: {
                type: "string",
                description: "IANA timezone, e.g. 'America/New_York' or 'Asia/Kolkata'. Defaults to Asia/Kolkata if not provided.",
              },
            },
            required: ["attendee_name"],
          },
        };
      }
      if (t.type === "transfer_cold") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              targetNumber: { type: "string", description: "Phone number to transfer the call to, e.g. +911234567890" },
              holdMessage:  { type: "string", description: "Optional message to speak before transferring (e.g. 'Please hold while we connect you')" },
            },
            required: ["targetNumber"],
          },
        };
      }
      if (t.type === "transfer_warm") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              targetNumber:  { type: "string", description: "Phone number of the human agent to transfer the call to" },
              holdMessage:   { type: "string", description: "Optional message to speak before transferring (e.g. 'Please hold for a moment while I connect you')" },
            },
            required: ["targetNumber"],
          },
        };
      }
      if (t.type === "transfer_agent") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              targetAgentId: { type: "string", description: "ID of the specialist agent to transfer the call to" },
              context:       { type: "string", description: "Optional context to pass to the new agent about what the caller needs" },
            },
            required: ["targetAgentId"],
          },
        };
      }
      if (t.type === "squad_followup") {
        return {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              targetAgentId: { type: "string", description: "agentId of the teammate who should make the follow-up call (from your team roster)" },
              note:          { type: "string", description: "What the teammate should do on the follow-up call, e.g. 'Schedule a demo — caller is interested in the premium plan'" },
              delay_minutes: { type: "string", description: "Minutes from now to place the call, e.g. '120' for 2 hours, '1440' for tomorrow" },
            },
            required: ["targetAgentId", "note", "delay_minutes"],
          },
        };
      }
      if (t.type === "send_email") {
        return {
          name: t.name || "send_email",
          description:
            (t.description || "Send an email to the caller using the configured Email channel.") +
            " Use this when the caller asks you to email them something (summary, brochure, confirmation)." +
            " You MUST have a real email address from the caller before calling — never invent one." +
            " Optional subject/body override the channel default template; omit them to use the saved template with {{variables}}.",
          parameters: {
            type: "object",
            properties: {
              to_email: {
                type: "string",
                description: "Recipient email address spoken by the caller (required)",
              },
              recipient_name: {
                type: "string",
                description: "Caller's name for {{name}} in the template",
              },
              subject: {
                type: "string",
                description: "Optional subject override (supports {{name}}, {{summary}}, etc.)",
              },
              body: {
                type: "string",
                description: "Optional HTML or plain-text body override (supports {{variables}})",
              },
              summary: {
                type: "string",
                description: "Short call summary for {{summary}} if not already in context",
              },
            },
            required: ["to_email"],
          },
        };
      }
      if (t.type === "send_whatsapp") {
        return {
          name: t.name || "send_whatsapp",
          description:
            (t.description || "Send a WhatsApp message to the caller.") +
            " Use when the caller asks you to WhatsApp them something." +
            " Put the actual content you want to send in `message` — it is delivered inside the business's approved WhatsApp template." +
            " Prefer the caller's phone from the call; only pass to_phone if they give a different number." +
            " template_hint is one of: call_summary, booking_confirmed, callback_scheduled.",
          parameters: {
            type: "object",
            properties: {
              to_phone: {
                type: "string",
                description: "Recipient phone in E.164 or 10-digit local form. Omit to use the caller on this call.",
              },
              message: {
                type: "string",
                description: "The message content to send (any text: details, address, price, link, summary…). Inserted into the approved template's variable.",
              },
              template_hint: {
                type: "string",
                description: "call_summary | booking_confirmed | callback_scheduled (default call_summary)",
              },
              template_name: {
                type: "string",
                description: "Optional BSP template name override",
              },
              summary: {
                type: "string",
                description: "Alias of message (deprecated — prefer message)",
              },
            },
            required: [],
          },
        };
      }
      // End Call: always emit under the canonical `end_call` function name with
      // the built-in description, regardless of what (possibly blank) name was
      // persisted on the tool. This repairs existing agents whose stored end_call
      // name is empty — otherwise it sanitizes to the fallback sentinel and gets
      // dropped, leaving the LLM with no way to hang up.
      if (t.type === "end_call") {
        return { ...END_CALL_TOOL_DEF };
      }
      // Webhook: use caller-defined parameters if provided
      if (t.type === "webhook" && t.parameters) {
        return {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        };
      }
      // Generic fallback for call_transfer, webhook (no params), send_sms, cal_com
      return {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Brief reason for invoking this tool" },
          },
          required: [],
        },
      };
    }),
  ];

  // Normalize every function name to a provider-safe form before it reaches any
  // LLM adapter. Done in one place so custom tools, native scheduling, transfers,
  // webhook, and the built-in end_call all stay valid (e.g. Gemini 400 "Invalid
  // function name" on spaces/non-ASCII names).
  const normalized = defs.map((d) => ({ ...d, name: sanitizeToolName(d.name) }));

  // Drop any tool whose name sanitized to the fallback sentinel ("tool").  This
  // happens when an agent tool has a blank or entirely non-ASCII name.  Sending a
  // tool literally named "tool" confuses every model — it looks like a type field,
  // not a function name — and can cause the LLM to stall or ignore all tools.
  const filtered = normalized.filter((d) => d.name !== FALLBACK_TOOL_NAME);

  // Safety net: if the agent has an end_call-type tool but no valid `end_call`
  // definition survived (e.g. some future path stripped it), inject the built-in
  // so the agent is never left without a way to hang up.
  if (hasExplicitEndCall && !filtered.some((d) => d.name === END_CALL_TOOL_NAME)) {
    filtered.unshift({ ...END_CALL_TOOL_DEF });
  }

  return filtered;
}

// ── Native scheduling executors ───────────────────────────────────────────────

// ── Placeholder attendee guard ────────────────────────────────────────────────
// Domains known to be fake/placeholder — reject immediately so the LLM must ask
// the caller for their real email rather than booking under a fabricated address.
const BLOCKED_EMAIL_DOMAINS = ["example.com", "test.com", "placeholder.com", "example.org", "test.org"];

// Local-parts (the part before @) that are clearly placeholder regardless of domain.
// e.g. "example@gmail.com", "test@gmail.com", "fake@yahoo.com" are all fabricated.
const BLOCKED_EMAIL_LOCAL_PARTS = new Set([
  "example", "test", "fake", "dummy", "placeholder", "sample", "demo",
  "noreply", "no-reply", "null", "undefined", "none", "na", "n/a", "invalid",
]);

// Names that are clearly fabricated placeholders — case-insensitive match.
const BLOCKED_ATTENDEE_NAMES = new Set([
  "test user", "unknown", "guest", "user", "test", "unknown user",
  "placeholder", "sample user", "demo user", "caller",
]);

/**
 * Resolve calendar context for native scheduling tools.
 * Reads agentConfig.calendarCapability (set by the agent editor's calendar picker).
 */
async function resolveCalendarContext(agentId: number): Promise<{
  authorizedUserId: string | null;
  defaultCalendarId: number | null;
  defaultEventTypeId: number | null;
}> {
  const [agentRow] = await db
    .select({ userId: agentsTable.userId, agentConfig: agentsTable.agentConfig })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId));

  const authorizedUserId = agentRow?.userId ?? null;
  const cap = (agentRow?.agentConfig as AgentConfig | null)?.calendarCapability;

  return {
    authorizedUserId,
    defaultCalendarId: cap?.enabled && cap.defaultCalendarId != null ? cap.defaultCalendarId : null,
    defaultEventTypeId: cap?.defaultEventTypeId ?? null,
  };
}

/**
 * True only when the agent was created/saved as phone + meetings
 * (`agentConfig.meetings.enabled === true`). Phone-only agents still book
 * calendars and can attach Meet links for humans — they must not claim AI join.
 */
async function agentMeetingsChannelEnabled(agentId: number): Promise<boolean> {
  const [row] = await db
    .select({ agentConfig: agentsTable.agentConfig })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId))
    .limit(1);
  const raw =
    row?.agentConfig && typeof row.agentConfig === "object"
      ? (row.agentConfig as Record<string, unknown>)["meetings"]
      : undefined;
  if (!raw || typeof raw !== "object") return false;
  return (raw as Record<string, unknown>)["enabled"] === true;
}

/** Tool-result note so the LLM tells the caller the truth about who joins Meet. */
function formatMeetLinkToolNote(
  meetLink: string | null,
  meetingsEnabled: boolean,
  timing: "this time" | "the new time" = "this time",
): string {
  if (!meetLink) {
    return meetingsEnabled
      ? ", auto_join=no (no Meet link on this booking — enable Google Meet on the event type)"
      : "";
  }
  if (meetingsEnabled) {
    return `, meet_link="${meetLink}", auto_join=yes (SnapServe meeting agent will join near ${timing})`;
  }
  return `, meet_link="${meetLink}", auto_join=no (share this Meet link with human attendees — this phone-only agent will not join the room)`;
}

export async function executeNativeBooking(
  callId: number,
  agentId: number,
  tool: AgentTool & { type: "native_booking" },
  args: Record<string, unknown>,
  opts?: { lineageCallId?: number | null },
): Promise<string> {
  args = normalizeBookingDatetimeArgs(args);
  logger.info({ callId, eventTypeId: tool.eventTypeId }, "Native booking tool invoked");
  const bookingCallId = await resolveBookingLineageCallId(callId, opts?.lineageCallId);
  const attendeeName = String(args["attendee_name"] ?? args["name"] ?? "Guest");
  const attendeeEmail = String(args["attendee_email"] ?? args["email"] ?? "");
  const preferredRaw = args["preferred_date"] != null ? String(args["preferred_date"]) : null;

  if (!attendeeEmail) {
    logger.warn({ callId }, "Native booking: no attendee email — cannot book");
    return "error: attendee_email is required to complete the booking";
  }

  // ── Placeholder email guard ──────────────────────────────────────────────
  const emailParts = attendeeEmail.split("@");
  const emailLocalPart = emailParts[0]?.toLowerCase() ?? "";
  const emailDomain = emailParts[1]?.toLowerCase() ?? "";
  const isBlockedDomain = BLOCKED_EMAIL_DOMAINS.includes(emailDomain);
  const isBlockedLocalPart = BLOCKED_EMAIL_LOCAL_PARTS.has(emailLocalPart);
  if (isBlockedDomain || isBlockedLocalPart) {
    logger.warn({ callId, attendeeEmail, isBlockedDomain, isBlockedLocalPart }, "Native booking blocked: placeholder email");
    void appendBookingLog(callId, agentId, "Booking Blocked", {
      reason: "placeholder_email",
      attendeeEmail,
      attendeeName,
      blockedDomain: isBlockedDomain ? emailDomain : undefined,
      blockedLocalPart: isBlockedLocalPart ? emailLocalPart : undefined,
    }, "error");
    return "error: cannot book with a placeholder or example email address. Ask the caller for their real email address before calling this tool again.";
  }

  // ── Placeholder name guard ───────────────────────────────────────────────
  const nameTrimmed = attendeeName.trim();
  const nameLower = nameTrimmed.toLowerCase();
  if (!nameTrimmed || BLOCKED_ATTENDEE_NAMES.has(nameLower)) {
    logger.warn({ callId, attendeeName }, "Native booking blocked: placeholder attendee name");
    void appendBookingLog(callId, agentId, "Booking Blocked", {
      reason: "placeholder_name",
      attendeeEmail,
      attendeeName,
    }, "error");
    return "error: cannot book with a placeholder or missing attendee name. Ask the caller for their real full name before calling this tool again.";
  }

  try {
    const { authorizedUserId, defaultCalendarId, defaultEventTypeId } = await resolveCalendarContext(agentId);

    // Resolve eventTypeId: capability default → first active on calendar → legacy tool.eventTypeId
    let resolvedEventTypeId = defaultEventTypeId ?? undefined;
    if (!resolvedEventTypeId && defaultCalendarId) {
      const [firstEt] = await db
        .select({ id: eventTypesTable.id })
        .from(eventTypesTable)
        .where(and(eq(eventTypesTable.calendarId, defaultCalendarId), eq(eventTypesTable.isActive, true)))
        .limit(1);
      resolvedEventTypeId = firstEt?.id;
    }
    if (!resolvedEventTypeId && tool.eventTypeId) {
      resolvedEventTypeId = tool.eventTypeId;
    }
    if (!resolvedEventTypeId) {
      return JSON.stringify({ error: "no_event_type", message: "No event type configured for this agent's calendar. Go to Settings → Calendar to create one." });
    }

    const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, resolvedEventTypeId));
    if (!eventType || !eventType.isActive) {
      return "error: the appointment type is unavailable";
    }

    const [calendar] = await db
      .select()
      .from(schedulingCalendarsTable)
      .where(eq(schedulingCalendarsTable.id, eventType.calendarId));
    if (!calendar || !calendar.isActive) {
      return "error: the calendar is unavailable";
    }

    if (authorizedUserId && calendar.userId !== authorizedUserId) {
      logger.warn(
        { callId, eventTypeId: resolvedEventTypeId, authorizedUserId, calendarUserId: calendar.userId },
        "Native booking: event type ownership mismatch — rejected",
      );
      return "error: the appointment type is unavailable";
    }

    const { searchStart, minSlotStart, timeFilter, isExactTime } = preferredRaw
      ? parsePreferredDate(preferredRaw, calendar.timezone)
      : { searchStart: new Date(), minSlotStart: undefined, timeFilter: undefined, isExactTime: false };
    if (preferredRaw) {
      logger.info({ callId, preferredRaw, searchStart, minSlotStart, isExactTime }, "Native booking: preferred date resolved");
    }
    const calTz = calendar.timezone || "UTC";
    const searchEnd = new Date(searchStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    // Use formatInTimeZone so offset-aware datetimes like "2026-06-22T14:00:00+05:30"
    // produce the correct calendar-local date string (not the UTC-local date string
    // which would be wrong when the offset crosses midnight: e.g. 00:00+05:30 → "prev day" in UTC).
    let slots = await getAvailableSlots(eventType.id, formatInTimeZone(searchStart, calTz, "yyyy-MM-dd"), formatInTimeZone(searchEnd, calTz, "yyyy-MM-dd"));
    if (minSlotStart) slots = slots.filter((s) => s.slotStart >= minSlotStart);
    if (timeFilter) slots = slots.filter(timeFilter);
    void appendBookingLog(callId, agentId, "Booking Request", {
      attendeeName,
      attendeeEmail,
      preferredRaw: preferredRaw ?? "(earliest available)",
      eventTypeName: eventType.name,
      calendarTimezone: calendar.timezone,
      availableSlotsFound: slots.length,
    });

    if (slots.length === 0) {
      const rangeDesc = preferredRaw ? `on or after "${preferredRaw}"` : "in the next 7 days";
      logger.info({ callId, eventTypeId: eventType.id }, `Native booking: no available slots ${rangeDesc}`);
      void appendBookingLog(callId, agentId, "Availability Applied", {
        result: "no_slots",
        rangeDesc,
        eventTypeId: eventType.id,
      }, "error");
      return `error: no available slots ${rangeDesc}`;
    }

    // ── Exact-time enforcement ──────────────────────────────────────────────
    // When the caller supplied a specific clock time (isExactTime=true) we MUST
    // land on that exact slot.  Auto-picking the first available slot when the
    // requested time is unavailable causes silent, wrong bookings.
    let chosenSlot: TimeSlot;
    if (isExactTime && minSlotStart) {
      const EXACT_TOLERANCE_MS = 60_000; // 1-minute window to absorb rounding
      const exactMatch = slots.find(
        (s) => Math.abs(s.slotStart.getTime() - minSlotStart.getTime()) <= EXACT_TOLERANCE_MS,
      );

      const tz = calendar.timezone || "UTC";
      const requestedLabel = formatInTimeZone(minSlotStart, tz, "EEEE, MMMM do 'at' h:mm a");

      logger.info(
        { callId, requestedLabel, exactMatch: !!exactMatch, availableCount: slots.length },
        "Native booking: exact-time slot check",
      );

      if (!exactMatch) {
        const alternatives = slots
          .slice(0, 5)
          .map((s) => formatInTimeZone(s.slotStart, tz, "EEE MMM d 'at' h:mm a"))
          .join("; ");
        const altMsg = alternatives ? ` Available nearby slots: ${alternatives}` : " No nearby slots available.";
        return `error: requested slot "${requestedLabel}" is not available.${altMsg}`;
      }

      logger.info({ callId, confirmedSlot: exactMatch.slotStart }, "Native booking: exact slot confirmed");
      chosenSlot = exactMatch;
    } else {
      chosenSlot = slots[0]!;
    }

    // Post-selection availability guard — verify the chosen slot falls within
    // the calendar's configured working-hours window before committing.
    const guardTz = calendar.timezone || "Asia/Kolkata";
    const withinWindow = await isSlotWithinAvailabilityWindow(calendar.id, chosenSlot.slotStart, guardTz);
    if (!withinWindow) {
      const slotLabel = formatInTimeZone(chosenSlot.slotStart, guardTz, "EEEE, MMMM do 'at' h:mm a");
      logger.warn({ callId, slotLabel, calendarId: calendar.id }, "Native booking: chosen slot outside availability window — rejected");
      return `error: the requested slot "${slotLabel}" falls outside the calendar's configured availability hours`;
    }

    const slotStart = chosenSlot.slotStart;
    const slotEnd = chosenSlot.slotEnd;
    const lockKey = buildSlotLockKey(calendar.id, slotStart);

    let booking: typeof bookingsTable.$inferSelect | undefined;
    let lockConflict = false;

    await db.transaction(async (tx) => {
      const lockResult = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`);
      const acquired = (lockResult.rows[0] as { acquired?: boolean })?.acquired === true;
      if (!acquired) {
        lockConflict = true;
        return;
      }

      const bufBefore = addMinutes(slotStart, -eventType.bufferBeforeMins);
      const bufAfter = addMinutes(slotEnd, eventType.bufferAfterMins);

      const overlapCount = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.calendarId, calendar.id),
            or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
            sql`${bookingsTable.slotStart} < ${bufAfter}`,
            sql`${bookingsTable.slotEnd} > ${bufBefore}`,
          ),
        )
        .then((r) => r[0]?.count ?? 0);

      const exactOverlapCount = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.calendarId, calendar.id),
            or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
            sql`${bookingsTable.slotStart} < ${slotEnd}`,
            sql`${bookingsTable.slotEnd} > ${slotStart}`,
          ),
        )
        .then((r) => r[0]?.count ?? 0);

      if (exactOverlapCount >= eventType.maxBookingsPerSlot || overlapCount > exactOverlapCount) {
        lockConflict = true;
        return;
      }

      const [inserted] = await tx
        .insert(bookingsTable)
        .values({
          eventTypeId: eventType.id,
          calendarId: calendar.id,
          // Prefer original phone call id when booking from a meet-bot session.
          callId: bookingCallId,
          userId: calendar.userId,
          attendeeName,
          attendeeEmail,
          attendeeNotes: null,
          slotStart,
          slotEnd,
          status: eventType.confirmationMode === "instant" ? "confirmed" : "pending",
          bookedVia: "agent",
        })
        .returning();
      booking = inserted;
    });

    if (lockConflict || !booking) {
      logger.warn({ callId }, "Native booking: slot conflict");
      void appendBookingLog(callId, agentId, "Availability Applied", {
        result: "slot_conflict",
        slotStart: slotStart.toISOString(),
      }, "error");
      return "error: slot was just taken — no booking created";
    }
    const confirmedBooking = booking;

    const tz = (args["timezone"] as string | undefined) || calendar.timezone || "UTC";
    const dateStr = formatInTimeZone(slotStart, tz, "EEEE, MMMM do 'at' h:mm a zzz");
    logger.info(
      {
        callId,
        bookingId: confirmedBooking.id,
        attendeeEmail,
        requested_datetime: preferredRaw,
        requested_timezone: tz,
        stored_datetime: slotStart.toISOString(),
        stored_timezone: "UTC (postgres timestamptz)",
        returned_slot: dateStr,
      },
      "Native booking created",
    );
    void appendBookingLog(callId, agentId, "Availability Applied", {
      bookingId: confirmedBooking.id,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
      slotFormatted: dateStr,
      status: confirmedBooking.status,
      attendeeEmail,
      attendeeName,
    }, "success");

    // Automatic Calls sheet: Meeting Time + Status Booked (fire-and-forget)
    import("./sheets-writeback.js").then(({ writeSheetBookingForCall }) => {
      writeSheetBookingForCall(callId, {
        slotStart: confirmedBooking.slotStart,
        meetLink: null,
      }).catch((err) => logger.warn({ callId, err }, "sheet-auto-call: booking writeback failed"));
    }).catch(() => {});

    // Create Google Calendar event with Meet link
    let meetLink: string | null = null;
    let googleEventId: string | null = null;
    let gcalConnectionId: string | null = null;
    let gcalFailed = false;
    let calendarSyncStatus: string | null = null;
    let calendarSyncError: string | null = null;

    if (!eventType.enableGoogleMeet) {
      // Google Meet not enabled on this event type — skip GCal entirely
      calendarSyncStatus = "skipped";
      await db.execute(
        sql`UPDATE bookings SET calendar_sync_status = 'skipped' WHERE id = ${confirmedBooking.id}`,
      );
      logger.info({ callId, bookingId: confirmedBooking.id }, "Native booking: GCal skipped — enableGoogleMeet=false on event type");
    }
    if (eventType.enableGoogleMeet) {
    try {
      const calRow = await db.execute(
        sql`SELECT google_calendar_connection_id FROM scheduling_calendars WHERE id = ${calendar.id}`,
      );
      const calendarConnectionId = (calRow.rows[0] as { google_calendar_connection_id?: string | null })
        ?.google_calendar_connection_id ?? null;
      gcalConnectionId = calendarConnectionId ?? (await getFirstConnectionForUser(calendar.userId))?.id ?? null;

      if (!calendar.hostEmail) {
        logger.warn({ callId, bookingId: confirmedBooking.id, calendarId: calendar.id }, "Native booking: calendar.hostEmail is null — organizer will be missing from Google Calendar invitation and no host notification email will be sent; set host_email on the calendar to fix this");
      }

      if (gcalConnectionId) {
        logger.info({ callId, bookingId: confirmedBooking.id, connectionId: gcalConnectionId }, "Native booking: creating Google Calendar event");
      } else {
        calendarSyncStatus = "skipped";
        await db.execute(
          sql`UPDATE bookings SET calendar_sync_status = 'skipped' WHERE id = ${confirmedBooking.id}`,
        );
        logger.warn({ callId, bookingId: confirmedBooking.id }, "Native booking: no Google Calendar connection configured — GCal event creation skipped");
        void appendBookingLog(callId, agentId, "Calendar Event Created", {
          result: "skipped",
          reason: "no_google_connection",
          bookingId: confirmedBooking.id,
        }, "info");
      }

      let gcalErrCode: string | null = null;
      let gcalErrMsg: string | null = null;
      const gcalResult = gcalConnectionId
        ? await createCalendarEvent({
            connectionId: gcalConnectionId,
            summary: `${eventType.name} — ${confirmedBooking.attendeeName}`,
            description: confirmedBooking.attendeeNotes ?? undefined,
            startTime: confirmedBooking.slotStart,
            endTime: confirmedBooking.slotEnd,
            attendeeEmail: confirmedBooking.attendeeEmail,
            attendeeName: confirmedBooking.attendeeName,
            // Use the caller-requested timezone (e.g. Asia/Kolkata) so the
            // Google Calendar event displays in the correct local time — not the
            // calendar's DB-configured timezone which may differ (e.g. "UTC").
            timezone: tz,
            hostEmail: calendar.hostEmail,
            additionalHosts: calendar.additionalHosts,
            onError: (detail) => { gcalErrCode = detail.errorCode; gcalErrMsg = detail.message ?? null; },
          })
        : null;
      if (gcalResult) {
        meetLink = gcalResult.meetLink;
        googleEventId = gcalResult.eventId;
        calendarSyncStatus = "synced";
        if (meetLink || googleEventId) {
          await db.execute(
            sql`UPDATE bookings SET meet_link = ${meetLink}, google_event_id = ${googleEventId}, calendar_sync_status = 'synced' WHERE id = ${confirmedBooking.id}`,
          );
        } else {
          await db.execute(
            sql`UPDATE bookings SET calendar_sync_status = 'synced' WHERE id = ${confirmedBooking.id}`,
          );
        }
        void appendBookingLog(callId, agentId, "Calendar Event Created", {
          googleEventId,
          connectionId: gcalConnectionId,
          bookingId: confirmedBooking.id,
          hasMeetLink: !!meetLink,
          calendarSyncStatus: "synced",
        }, "success");
        if (meetLink) {
          void appendBookingLog(callId, agentId, "Meet Link Generated", {
            meetLink,
            googleEventId,
            bookingId: confirmedBooking.id,
          }, "success");
        } else {
          logger.warn(
            { callId, bookingId: confirmedBooking.id, googleEventId, connectionId: gcalConnectionId },
            "Native booking: Google Calendar event created but no Meet link returned — check conferenceData in API response",
          );
          void appendBookingLog(callId, agentId, "Meet Link Generated", {
            result: "missing",
            googleEventId,
            connectionId: gcalConnectionId,
            bookingId: confirmedBooking.id,
            note: "conferenceData was absent in the events.insert response",
          }, "error");
        }
      } else if (gcalConnectionId) {
        gcalFailed = true;
        calendarSyncStatus = gcalErrCode === "scope_insufficient" ? "scope_insufficient" : "sync_failed";
        calendarSyncError = gcalErrMsg;
        await db.execute(
          sql`UPDATE bookings SET calendar_sync_status = ${calendarSyncStatus}, calendar_sync_error = ${calendarSyncError} WHERE id = ${confirmedBooking.id}`,
        );
        logger.error(
          { callId, bookingId: confirmedBooking.id, connectionId: gcalConnectionId, calendarSyncStatus, gcalErrCode, gcalErrMsg },
          "Native booking: createCalendarEvent returned null — booking will be downgraded to pending",
        );
        void appendBookingLog(callId, agentId, "Calendar Event Created", {
          result: "failed",
          connectionId: gcalConnectionId,
          bookingId: confirmedBooking.id,
          calendarSyncStatus,
          gcalErrCode,
          gcalErrMsg,
        }, "error");
      }
    } catch (err) {
      if (gcalConnectionId) {
        gcalFailed = true;
        calendarSyncStatus = "sync_failed";
        calendarSyncError = String((err as any)?.message ?? err);
        await db.execute(
          sql`UPDATE bookings SET calendar_sync_status = 'sync_failed', calendar_sync_error = ${calendarSyncError} WHERE id = ${confirmedBooking.id}`,
        ).catch(() => {});
      }
      logger.error(
        { callId, bookingId: confirmedBooking.id, connectionId: gcalConnectionId, err, errStack: (err as any)?.stack, googleApiError: (err as any)?.response?.data, errDetails: (err as any)?.errors },
        "Native booking: Google Calendar event creation failed",
      );
      void appendBookingLog(callId, agentId, "Calendar Event Created", {
        result: "exception",
        error: String(err),
        bookingId: confirmedBooking.id,
        calendarSyncStatus: "sync_failed",
      }, "error");
    }
    } // end if (eventType.enableGoogleMeet)

    // If GCal was configured but failed, only downgrade to pending for manual-confirmation
    // event types. Instant (auto-confirm) events stay confirmed — GCal is supplementary.
    if (gcalFailed) {
      if (eventType.confirmationMode !== "instant" && confirmedBooking.status === "confirmed") {
        await db.execute(
          sql`UPDATE bookings SET status = 'pending' WHERE id = ${confirmedBooking.id}`,
        );
        (confirmedBooking as any).status = "pending";
        logger.warn({ callId, bookingId: confirmedBooking.id, connectionId: gcalConnectionId }, "Native booking: downgraded to pending — Google Calendar event creation failed (manual-confirm event)");
        void appendBookingLog(callId, agentId, "Booking Status", {
          status: "pending",
          reason: "gcal_failed",
          bookingId: confirmedBooking.id,
        }, "error");
        dispatchSchedulingWebhooks(calendar.userId, "scheduling.booking.created", {
          booking: {
            ...confirmedBooking,
            slotStart: confirmedBooking.slotStart.toISOString(),
            slotEnd: confirmedBooking.slotEnd.toISOString(),
            cancelledAt: confirmedBooking.cancelledAt?.toISOString() ?? null,
            createdAt: confirmedBooking.createdAt.toISOString(),
            updatedAt: confirmedBooking.updatedAt.toISOString(),
            meetLink,
            googleEventId,
          },
        }).catch((err) => logger.warn({ callId, bookingId: confirmedBooking.id, err }, "Native booking: webhook dispatch failed"));
        return `booking_pending: booking_id=${confirmedBooking.id}, slot="${dateStr}", status="pending", note="Google Calendar event creation failed — booking requires manual confirmation"`;
      }
      // Instant-confirm: GCal failure is non-blocking — booking stays confirmed
      logger.warn({ callId, bookingId: confirmedBooking.id, connectionId: gcalConnectionId }, "Native booking: GCal event creation failed but event type is instant-confirm — booking stays confirmed");
      void appendBookingLog(callId, agentId, "Booking Status", {
        status: "confirmed",
        reason: "gcal_failed_non_blocking",
        bookingId: confirmedBooking.id,
      }, "info");
    }

    sendBookingCreatedEmail({
      attendeeName: confirmedBooking.attendeeName,
      attendeeEmail: confirmedBooking.attendeeEmail,
      eventTypeName: eventType.name,
      slotStart: confirmedBooking.slotStart,
      slotEnd: confirmedBooking.slotEnd,
      timezone: calendar.timezone,
      hostEmail: calendar.hostEmail,
      additionalHosts: calendar.additionalHosts,
      bookingId: confirmedBooking.id,
      notes: confirmedBooking.attendeeNotes,
      meetLink,
      calendarSyncStatus,
    }).then(() => {
      void appendBookingLog(callId, agentId, "Invitation Sent", {
        attendeeEmail,
        hostEmail: calendar.hostEmail ?? null,
        bookingId: confirmedBooking.id,
        meetLink: meetLink ?? null,
      }, "success");
    }).catch((err) => {
      logger.error({ callId, bookingId: confirmedBooking.id, err }, "Native booking: email send failed");
      void appendBookingLog(callId, agentId, "Invitation Sent", {
        result: "failed",
        error: String(err),
        attendeeEmail,
        bookingId: confirmedBooking.id,
      }, "error");
    });
    dispatchSchedulingWebhooks(calendar.userId, "scheduling.booking.created", {
      booking: {
        ...confirmedBooking,
        slotStart: confirmedBooking.slotStart.toISOString(),
        slotEnd: confirmedBooking.slotEnd.toISOString(),
        cancelledAt: confirmedBooking.cancelledAt?.toISOString() ?? null,
        createdAt: confirmedBooking.createdAt.toISOString(),
        updatedAt: confirmedBooking.updatedAt.toISOString(),
        meetLink,
        googleEventId,
      },
    }).catch((err) => logger.warn({ callId, bookingId: confirmedBooking.id, err }, "Native booking: webhook dispatch failed"));

    void appendBookingLog(callId, agentId, "Booking Confirmed", {
      bookingId: confirmedBooking.id,
      eventTypeName: eventType.name,
      slot: dateStr,
      attendeeName,
      attendeeEmail,
      status: confirmedBooking.status,
      meetLink: meetLink ?? null,
      googleEventId: googleEventId ?? null,
    }, "success");

    const meetingsEnabled = await agentMeetingsChannelEnabled(agentId);
    const meetNote = formatMeetLinkToolNote(meetLink, meetingsEnabled);
    return `booking_confirmed: event="${eventType.name}", slot="${dateStr}", booking_id=${confirmedBooking.id}, attendee="${attendeeName}", email="${attendeeEmail}", status="${confirmedBooking.status}"${meetNote}`;
  } catch (err) {
    logger.error({ callId, err }, "Native booking tool execution failed");
    return "error: booking failed due to a technical issue";
  }
}

export async function executeNativeCheckAvailability(
  callId: number,
  agentId: number,
  tool: AgentTool & { type: "native_check_availability" },
  args: Record<string, unknown>,
): Promise<string> {
  args = normalizeBookingDatetimeArgs(args);
  logger.info({ callId, eventTypeId: tool.eventTypeId }, "Native check-availability tool invoked");
  const preferredRaw = args["preferred_date"] != null ? String(args["preferred_date"]) : null;

  try {
    const { authorizedUserId, defaultCalendarId, defaultEventTypeId } = await resolveCalendarContext(agentId);

    // Resolve eventTypeId: capability default → first active on calendar → legacy tool.eventTypeId
    let resolvedEventTypeId = defaultEventTypeId ?? undefined;
    if (!resolvedEventTypeId && defaultCalendarId) {
      const [firstEt] = await db
        .select({ id: eventTypesTable.id })
        .from(eventTypesTable)
        .where(and(eq(eventTypesTable.calendarId, defaultCalendarId), eq(eventTypesTable.isActive, true)))
        .limit(1);
      resolvedEventTypeId = firstEt?.id;
    }
    if (!resolvedEventTypeId && tool.eventTypeId) {
      resolvedEventTypeId = tool.eventTypeId;
    }
    if (!resolvedEventTypeId) {
      return JSON.stringify({ error: "no_event_type", message: "No event type configured for this agent's calendar. Go to Settings → Calendar to create one." });
    }

    const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, resolvedEventTypeId));
    if (!eventType || !eventType.isActive) {
      return "error: the appointment type is unavailable";
    }
    const [calendar] = await db
      .select()
      .from(schedulingCalendarsTable)
      .where(eq(schedulingCalendarsTable.id, eventType.calendarId));
    if (!calendar || !calendar.isActive) {
      return "error: the calendar is unavailable";
    }
    if (authorizedUserId && calendar.userId !== authorizedUserId) {
      logger.warn({ callId, eventTypeId: resolvedEventTypeId }, "Native check-availability: ownership mismatch — rejected");
      return "error: the appointment type is unavailable";
    }

    const { searchStart, minSlotStart, timeFilter, isExactTime } = preferredRaw
      ? parsePreferredDate(preferredRaw, calendar.timezone)
      : { searchStart: new Date(), minSlotStart: undefined, timeFilter: undefined, isExactTime: false };
    const calTz = calendar.timezone || "UTC";
    const searchEnd = new Date(searchStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    let slots = await getAvailableSlots(eventType.id, formatInTimeZone(searchStart, calTz, "yyyy-MM-dd"), formatInTimeZone(searchEnd, calTz, "yyyy-MM-dd"));
    if (minSlotStart) slots = slots.filter((s) => s.slotStart >= minSlotStart);
    if (timeFilter) slots = slots.filter(timeFilter);

    if (slots.length === 0) {
      const rangeDesc = preferredRaw ? `on or after "${preferredRaw}"` : "in the next 7 days";
      return `no_availability: no available slots ${rangeDesc}`;
    }

    const tz = (args["timezone"] != null && String(args["timezone"]).trim())
      ? String(args["timezone"])
      : (tool.timezone || calendar.timezone || "UTC");

    const slotLabel = (s: { slotStart: Date }) =>
      `${formatInTimeZone(s.slotStart, tz, "yyyy-MM-dd'T'HH:mm:ssxxx")} (${formatInTimeZone(s.slotStart, tz, "EEE MMM d 'at' h:mm a")})`;

    // Exact-time branch: check whether the requested slot is available
    if (isExactTime && minSlotStart) {
      const EXACT_TOLERANCE_MS = 60_000;
      const exactMatch = slots.find(
        (s) => Math.abs(s.slotStart.getTime() - minSlotStart.getTime()) <= EXACT_TOLERANCE_MS,
      );
      if (exactMatch) {
        return `requested_slot_available: slot="${formatInTimeZone(exactMatch.slotStart, tz, "yyyy-MM-dd'T'HH:mm:ssxxx")}", label="${formatInTimeZone(exactMatch.slotStart, tz, "EEE MMM d 'at' h:mm a")}", event="${eventType.name}", duration_mins=${eventType.durationMinutes}, timezone="${tz}"`;
      }
      // Filter alternatives to only those within the calendar's configured working hours
      // before slicing — prevents out-of-hours slots from appearing when calendar timezone is wrong
      const windowTz = calendar.timezone || "Asia/Kolkata";
      const windowChecks = await Promise.all(
        slots.slice(0, 15).map(async (s) => ({
          slot: s,
          ok: await isSlotWithinAvailabilityWindow(calendar.id, s.slotStart, windowTz),
        })),
      );
      const alternatives = windowChecks
        .filter((x) => x.ok)
        .slice(0, 5)
        .map((x) => slotLabel(x.slot))
        .join("; ");
      const requestedLabel = formatInTimeZone(minSlotStart, tz, "EEE MMM d 'at' h:mm a");
      return `requested_slot_unavailable: requested="${requestedLabel}", alternatives="${alternatives || "none available"}"`; 
    }

    const preview = slots
      .slice(0, 5)
      .map(slotLabel)
      .join("; ");
    return `available_slots: count=${slots.length}, event="${eventType.name}", duration_mins=${eventType.durationMinutes}, timezone="${tz}", next="${preview}"`;
  } catch (err) {
    logger.error({ callId, err }, "Native check-availability tool execution failed");
    return "error: availability check failed due to a technical issue";
  }
}

export async function executeNativeListBookings(
  callId: number,
  agentId: number,
  tool: AgentTool & { type: "native_list_bookings" },
  args: Record<string, unknown>,
): Promise<string> {
  logger.info({ callId }, "Native list-bookings tool invoked");
  const attendeeName = String(args["attendee_name"] ?? "").trim();
  if (!attendeeName) {
    return "error: attendee_name is required to look up bookings";
  }

  try {
    logger.debug({ callId, attendeeName }, "list_bookings: input received");

    // Determine authorized user for ownership scoping
    const { authorizedUserId } = await resolveCalendarContext(agentId);
    logger.debug({ callId, authorizedUserId }, "list_bookings: ownership resolved");

    // Fetch upcoming, active bookings with a case-insensitive name match.
    // Rescheduling produces two DB rows: the original row is set to status="rescheduled"
    // and a new row is inserted for the new slot. We must exclude "rescheduled" rows here
    // so the AI only sees the current (new) booking and not the superseded original.
    const nameLike = `%${attendeeName.toLowerCase()}%`;
    const now = new Date();
    const owned = await db
      .select({
        id: bookingsTable.id,
        attendeeName: bookingsTable.attendeeName,
        attendeeEmail: bookingsTable.attendeeEmail,
        slotStart: bookingsTable.slotStart,
        slotEnd: bookingsTable.slotEnd,
        status: bookingsTable.status,
        calendarId: bookingsTable.calendarId,
        eventTypeId: bookingsTable.eventTypeId,
        googleEventId: bookingsTable.googleEventId,
        rescheduledFromId: bookingsTable.rescheduledFromId,
      })
      .from(bookingsTable)
      .where(
        and(
          sql`lower(${bookingsTable.attendeeName}) like ${nameLike}`,
          sql`${bookingsTable.slotStart} >= ${now.toISOString()}`,
          sql`${bookingsTable.status} != 'cancelled'`,
          sql`${bookingsTable.status} != 'rescheduled'`,
          authorizedUserId ? eq(bookingsTable.userId, authorizedUserId) : sql`true`,
          tool.calendarId ? eq(bookingsTable.calendarId, tool.calendarId) : sql`true`,
        ),
      )
      .orderBy(bookingsTable.slotStart)
      .limit(5);

    logger.debug({ callId, rowCount: owned.length, attendeeName }, "list_bookings: booking query complete");

    if (owned.length === 0) {
      return `no_bookings_found: no upcoming bookings found for "${attendeeName}". Ask the caller to double-check the name on their booking.`;
    }

    // Resolve timezone: args → tool config → first booking's calendar → Asia/Kolkata
    let tz = (args["timezone"] != null ? String(args["timezone"]) : null) ?? tool.timezone ?? null;
    const firstCalendarId = owned[0]?.calendarId;
    if (!tz && firstCalendarId) {
      const [cal] = await db
        .select({ timezone: schedulingCalendarsTable.timezone })
        .from(schedulingCalendarsTable)
        .where(eq(schedulingCalendarsTable.id, firstCalendarId));
      tz = cal?.timezone ?? null;
    }
    const tzFallback = !tz;
    tz = tz ?? "Asia/Kolkata";
    if (tzFallback) {
      logger.warn({ callId, tz }, "list_bookings: timezone fell back to Asia/Kolkata default — check agent/calendar timezone config");
    } else {
      logger.debug({ callId, tz }, "list_bookings: timezone resolved");
    }

    // Resolve event type names in bulk
    const etIds = [...new Set(owned.map((b) => b.eventTypeId).filter((id): id is number => id != null))];
    const etRows = etIds.length
      ? await db.select({ id: eventTypesTable.id, name: eventTypesTable.name }).from(eventTypesTable).where(sql`${eventTypesTable.id} in (${sql.join(etIds.map((id) => sql`${id}`), sql`, `)})`)
      : [];
    const etMap = new Map(etRows.map((e) => [e.id, e.name]));

    const list = owned.map((b) => {
      const eventName = (b.eventTypeId != null ? etMap.get(b.eventTypeId) : undefined) ?? "Appointment";
      const dateStr = formatInTimeZone(b.slotStart, tz, "EEE MMM d 'at' h:mm a zzz");
      const endDateStr = formatInTimeZone(b.slotEnd, tz, "h:mm a zzz");
      logger.debug(
        {
          callId,
          bookingId: b.id,
          attendeeEmail: b.attendeeEmail,
          slotStartUtc: b.slotStart.toISOString(),
          slotEndUtc: b.slotEnd.toISOString(),
          displayTime: dateStr,
          googleEventId: b.googleEventId,
          rescheduledFromId: b.rescheduledFromId,
        },
        "list_bookings: returning booking to AI",
      );
      const parts = [
        `booking_id=${b.id}`,
        `event="${eventName}"`,
        `iso_start=${b.slotStart.toISOString()}`,
        `iso_end=${b.slotEnd.toISOString()}`,
        `date="${dateStr} – ${endDateStr}"`,
        `status="${b.status}"`,
      ];
      if (b.googleEventId) parts.push(`google_event_id="${b.googleEventId}"`);
      if (b.rescheduledFromId != null) parts.push(`rescheduled_from_booking_id=${b.rescheduledFromId}`);
      return parts.join(", ");
    });

    const rescheduleNotes = owned
      .filter((b) => b.rescheduledFromId != null)
      .map((b) => `booking #${b.id} replaced original booking #${b.rescheduledFromId}`);

    const suffix = rescheduleNotes.length > 0 ? ` | notes: ${rescheduleNotes.join("; ")}` : "";
    return `bookings_found: count=${owned.length}, ${list.join(" | ")}${suffix}`;
  } catch (err) {
    logger.error({ callId, errMsg: (err as Error)?.message, err }, "Native list-bookings tool execution failed");
    return "error: booking lookup failed due to a technical issue";
  }
}

export async function executeNativeReschedule(
  callId: number,
  agentId: number,
  tool: AgentTool & { type: "native_reschedule" },
  args: Record<string, unknown>,
  opts?: { lineageCallId?: number | null },
): Promise<string> {
  args = normalizeBookingDatetimeArgs(args);
  logger.info({ callId }, "Native reschedule tool invoked");
  const bookingId = Number(args["booking_id"] ?? args["bookingId"] ?? 0);
  const preferredRaw = args["preferred_date"] != null ? String(args["preferred_date"]) : null;
  if (!bookingId) {
    return "error: booking_id is required to reschedule";
  }
  const bookingCallId = await resolveBookingLineageCallId(
    callId,
    opts?.lineageCallId ?? undefined,
  );

  try {
    const { authorizedUserId } = await resolveCalendarContext(agentId);

    const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    if (!existing || existing.status === "cancelled") {
      return `error: no active booking found with reference ${bookingId}`;
    }

    if (authorizedUserId && existing.userId !== authorizedUserId) {
      logger.warn(
        { callId, bookingId, authorizedUserId, bookingUserId: existing.userId },
        "Native reschedule: ownership mismatch — rejected",
      );
      return `error: no active booking found with reference ${bookingId}`;
    }

    const [eventType] = existing.eventTypeId
      ? await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, existing.eventTypeId))
      : [];
    if (!eventType) {
      return "error: appointment type not found for this booking";
    }

    const [calendar] = existing.calendarId
      ? await db.select().from(schedulingCalendarsTable).where(eq(schedulingCalendarsTable.id, existing.calendarId))
      : [];
    if (!calendar || !calendar.isActive) {
      return "error: calendar is unavailable";
    }

    const { searchStart, minSlotStart, timeFilter, isExactTime } = preferredRaw
      ? parsePreferredDate(preferredRaw, calendar.timezone)
      : { searchStart: new Date(), minSlotStart: undefined, timeFilter: undefined, isExactTime: false };
    if (preferredRaw) {
      logger.info(
        { callId, preferredRaw, searchStart, minSlotStart, isExactTime },
        "Native reschedule: preferred date resolved",
      );
    }
    const calTz = calendar.timezone || "UTC";
    const searchEnd = new Date(searchStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    let slots = await getAvailableSlots(eventType.id, formatInTimeZone(searchStart, calTz, "yyyy-MM-dd"), formatInTimeZone(searchEnd, calTz, "yyyy-MM-dd"));
    if (minSlotStart) slots = slots.filter((s) => s.slotStart >= minSlotStart);
    if (timeFilter) slots = slots.filter(timeFilter);
    const filteredSlots = slots.filter((s) => s.slotStart.getTime() !== existing.slotStart.getTime());
    if (filteredSlots.length === 0) {
      const rangeDesc = preferredRaw ? `on or after "${preferredRaw}"` : "in the next 7 days";
      return `error: no other available slots ${rangeDesc}`;
    }

    // ── Exact-time enforcement ──────────────────────────────────────────────
    // When the caller supplied a specific clock time (isExactTime=true) we MUST
    // land on that exact slot.  Auto-picking the first available slot when the
    // requested time is unavailable causes silent, wrong reschedules.
    let chosenSlot: TimeSlot;
    if (isExactTime && minSlotStart) {
      const EXACT_TOLERANCE_MS = 60_000; // 1-minute window to absorb rounding
      const exactMatch = filteredSlots.find(
        (s) => Math.abs(s.slotStart.getTime() - minSlotStart.getTime()) <= EXACT_TOLERANCE_MS,
      );

      const tz = calendar.timezone || "UTC";
      const requestedLabel = formatInTimeZone(minSlotStart, tz, "EEEE, MMMM do 'at' h:mm a");

      logger.info(
        { callId, requestedLabel, exactMatch: !!exactMatch, availableCount: filteredSlots.length },
        "Native reschedule: exact-time slot check",
      );

      if (!exactMatch) {
        // Slot not available — surface up to 5 nearby alternatives, never auto-pick
        const alternatives = filteredSlots
          .slice(0, 5)
          .map((s) => formatInTimeZone(s.slotStart, tz, "EEE MMM d 'at' h:mm a"))
          .join("; ");
        const altMsg = alternatives ? ` Available nearby slots: ${alternatives}` : " No nearby slots available.";
        return `error: requested slot "${requestedLabel}" is not available.${altMsg}`;
      }

      logger.info({ callId, confirmedSlot: exactMatch.slotStart }, "Native reschedule: exact slot confirmed");
      chosenSlot = exactMatch;
    } else {
      // Vague preference (morning / next Tuesday / etc.) — first available is fine
      chosenSlot = filteredSlots[0]!;
    }

    // Post-selection availability guard — verify the chosen slot falls within
    // the calendar's configured working-hours window before committing.
    const guardTz = calendar.timezone || "Asia/Kolkata";
    const withinWindow = await isSlotWithinAvailabilityWindow(calendar.id, chosenSlot.slotStart, guardTz);
    if (!withinWindow) {
      const slotLabel = formatInTimeZone(chosenSlot.slotStart, guardTz, "EEEE, MMMM do 'at' h:mm a");
      logger.warn({ callId, slotLabel, calendarId: calendar.id }, "Native reschedule: chosen slot outside availability window — rejected");
      return `error: the requested slot "${slotLabel}" falls outside the calendar's configured availability hours`;
    }

    const newStart = chosenSlot.slotStart;
    const newEnd = chosenSlot.slotEnd;
    const lockKey = buildSlotLockKey(calendar.id, newStart);
    let newBooking: typeof bookingsTable.$inferSelect | undefined;
    let lockConflict = false;

    await db.transaction(async (tx) => {
      const lockResult = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`);
      const acquired = (lockResult.rows[0] as { acquired?: boolean })?.acquired === true;
      if (!acquired) {
        lockConflict = true;
        return;
      }

      const bufBefore = addMinutes(newStart, -eventType.bufferBeforeMins);
      const bufAfter = addMinutes(newEnd, eventType.bufferAfterMins);

      const overlapCount = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.calendarId, calendar.id),
            or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
            sql`${bookingsTable.slotStart} < ${bufAfter}`,
            sql`${bookingsTable.slotEnd} > ${bufBefore}`,
          ),
        )
        .then((r) => r[0]?.count ?? 0);

      const exactOverlapCount = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.calendarId, calendar.id),
            or(eq(bookingsTable.status, "pending"), eq(bookingsTable.status, "confirmed")),
            sql`${bookingsTable.slotStart} < ${newEnd}`,
            sql`${bookingsTable.slotEnd} > ${newStart}`,
          ),
        )
        .then((r) => r[0]?.count ?? 0);

      if (exactOverlapCount >= eventType.maxBookingsPerSlot || overlapCount > exactOverlapCount) {
        lockConflict = true;
        return;
      }

      await tx.update(bookingsTable).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(bookingsTable.id, bookingId));

      const [inserted] = await tx
        .insert(bookingsTable)
        .values({
          eventTypeId: eventType.id,
          calendarId: calendar.id,
          // Keep phone-call lineage (not the live meetbot call id).
          callId: existing.callId && existing.callId !== callId
            ? existing.callId
            : bookingCallId,
          userId: calendar.userId,
          attendeeName: existing.attendeeName,
          attendeeEmail: existing.attendeeEmail,
          attendeeNotes: existing.attendeeNotes,
          slotStart: newStart,
          slotEnd: newEnd,
          status: eventType.confirmationMode === "instant" ? "confirmed" : "pending",
          bookedVia: "agent",
          rescheduledFromId: bookingId,
          // Preserve Meet link until GCal sync confirms (never drop auto-dispatch).
          meetLink: existing.meetLink ?? null,
          googleEventId: existing.googleEventId ?? null,
        })
        .returning();
      newBooking = inserted;
    });

    if (lockConflict || !newBooking) {
      return "error: slot was just taken — reschedule failed";
    }
    const confirmedNewBooking = newBooking;

    const tz = calendar.timezone || "UTC";
    const dateStr = formatInTimeZone(newStart, tz, "EEEE, MMMM do 'at' h:mm a zzz");

    // Google Calendar sync info for debug logging (filled in below)
    const gcalStart = formatInTimeZone(newStart, tz, "yyyy-MM-dd'T'HH:mm:ss");
    logger.info(
      {
        callId,
        oldBookingId: bookingId,
        newBookingId: confirmedNewBooking.id,
        requested_datetime: preferredRaw,
        requested_timezone: tz,
        stored_datetime: newStart.toISOString(),
        stored_timezone: "UTC (postgres timestamptz)",
        google_event_start: gcalStart,
        google_event_timezone: tz,
        returned_slot: dateStr,
      },
      "Native reschedule complete",
    );

    // Google Calendar sync: patch the existing event in-place (best-effort)
    // Using patch/update instead of delete+create so attendees get a seamless
    // "time changed" notification rather than a cancellation + new invite.
    // Seed meetLink from the old booking — the GCal patch preserves the same link,
    // so even if the sync fails below the email still gets the correct Meet URL.
    let meetLink: string | null = existing.meetLink ?? null;
    try {
      const oldGcalRow = await db.execute(
        sql`SELECT google_event_id FROM bookings WHERE id = ${bookingId}`,
      );
      const existingGoogleEventId = (oldGcalRow.rows[0] as { google_event_id?: string | null })
        ?.google_event_id ?? null;
      const calRow = await db.execute(
        sql`SELECT google_calendar_connection_id FROM scheduling_calendars WHERE id = ${calendar.id}`,
      );
      const calendarConnectionId = (calRow.rows[0] as { google_calendar_connection_id?: string | null })
        ?.google_calendar_connection_id ?? null;
      const connectionId = calendarConnectionId ?? (await getFirstConnectionForUser(calendar.userId))?.id ?? null;

      if (connectionId) {
        logger.info(
          { callId, bookingId: confirmedNewBooking.id, oldBookingId: bookingId, existingGoogleEventId, connectionId },
          "Agent reschedule: syncing Google Calendar event",
        );
      } else {
        logger.warn(
          { callId, bookingId: confirmedNewBooking.id, oldBookingId: bookingId },
          "Native reschedule: no Google Calendar connection configured — GCal event sync skipped",
        );
      }

      if (connectionId) {
        const gcalResult = existingGoogleEventId
          ? await updateCalendarEvent({
              connectionId,
              eventId: existingGoogleEventId,
              summary: `${eventType.name} — ${confirmedNewBooking.attendeeName}`,
              description: confirmedNewBooking.attendeeNotes ?? undefined,
              startTime: confirmedNewBooking.slotStart,
              endTime: confirmedNewBooking.slotEnd,
              attendeeEmail: confirmedNewBooking.attendeeEmail,
              attendeeName: confirmedNewBooking.attendeeName,
              timezone: calendar.timezone,
              hostEmail: calendar.hostEmail,
              additionalHosts: calendar.additionalHosts,
            })
          : await createCalendarEvent({
              connectionId,
              summary: `${eventType.name} — ${confirmedNewBooking.attendeeName}`,
              description: confirmedNewBooking.attendeeNotes ?? undefined,
              startTime: confirmedNewBooking.slotStart,
              endTime: confirmedNewBooking.slotEnd,
              attendeeEmail: confirmedNewBooking.attendeeEmail,
              attendeeName: confirmedNewBooking.attendeeName,
              timezone: calendar.timezone,
              hostEmail: calendar.hostEmail,
              additionalHosts: calendar.additionalHosts,
            });
        if (gcalResult) {
          // Never wipe an existing Meet link if GCal omits conference data.
          meetLink = gcalResult.meetLink ?? meetLink ?? existing.meetLink ?? null;
          await db.execute(
            sql`UPDATE bookings SET meet_link = ${meetLink}, google_event_id = ${gcalResult.eventId} WHERE id = ${confirmedNewBooking.id}`,
          );
        }
      }
    } catch (err) {
      logger.error(
        { callId, bookingId: confirmedNewBooking.id, err, errStack: (err as any)?.stack, googleApiError: (err as any)?.response?.data, errDetails: (err as any)?.errors },
        "Native reschedule: Google Calendar sync failed",
      );
    }

    sendBookingRescheduledEmail({
      attendeeName: confirmedNewBooking.attendeeName,
      attendeeEmail: confirmedNewBooking.attendeeEmail,
      eventTypeName: eventType.name,
      slotStart: confirmedNewBooking.slotStart,
      slotEnd: confirmedNewBooking.slotEnd,
      timezone: calendar.timezone,
      hostEmail: calendar.hostEmail,
      additionalHosts: calendar.additionalHosts,
      bookingId: confirmedNewBooking.id,
      notes: confirmedNewBooking.attendeeNotes,
      meetLink,
      oldSlotStart: existing.slotStart,
    }).catch((err) => logger.error({ callId, bookingId: confirmedNewBooking.id, err }, "Native reschedule: email send failed"));
    dispatchSchedulingWebhooks(calendar.userId, "scheduling.booking.rescheduled", {
      booking: {
        ...confirmedNewBooking,
        slotStart: confirmedNewBooking.slotStart.toISOString(),
        slotEnd: confirmedNewBooking.slotEnd.toISOString(),
        cancelledAt: confirmedNewBooking.cancelledAt?.toISOString() ?? null,
        createdAt: confirmedNewBooking.createdAt.toISOString(),
        updatedAt: confirmedNewBooking.updatedAt.toISOString(),
      },
    }).catch((err) => logger.warn({ callId, bookingId: confirmedNewBooking.id, err }, "Native reschedule: webhook dispatch failed"));

    const meetingsEnabled = await agentMeetingsChannelEnabled(agentId);
    const meetNote = formatMeetLinkToolNote(meetLink, meetingsEnabled, "the new time");
    return `reschedule_confirmed: old_booking_id=${bookingId}, new_booking_id=${confirmedNewBooking.id}, new_slot="${dateStr}", status="${confirmedNewBooking.status}"${meetNote}`;
  } catch (err) {
    logger.error({ callId, err }, "Native reschedule tool execution failed");
    return "error: reschedule failed due to a technical issue";
  }
}

export async function executeNativeCancel(
  callId: number,
  agentId: number,
  tool: AgentTool & { type: "native_cancel" },
  args: Record<string, unknown>,
): Promise<string> {
  logger.info({ callId }, "Native cancel tool invoked");
  const bookingId = Number(args["booking_id"] ?? args["bookingId"] ?? 0);
  if (!bookingId) {
    return "error: booking_id is required to cancel";
  }

  try {
    const { authorizedUserId: resolvedUserId } = await resolveCalendarContext(agentId);

    let authorizedUserId: string | null = null;
    if (tool.calendarId) {
      const [calRow] = await db
        .select({ userId: schedulingCalendarsTable.userId })
        .from(schedulingCalendarsTable)
        .where(eq(schedulingCalendarsTable.id, tool.calendarId));
      if (!calRow || calRow.userId !== resolvedUserId) {
        logger.warn(
          { callId, toolCalendarId: tool.calendarId, agentOwnerId: resolvedUserId },
          "Native cancel: stored calendarId does not belong to agent owner — rejected",
        );
        return `error: no booking found with reference ${bookingId}`;
      }
      authorizedUserId = calRow.userId;
    } else {
      authorizedUserId = resolvedUserId;
    }

    const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    if (!existing) {
      return `error: no booking found with reference ${bookingId}`;
    }

    if (authorizedUserId && existing.userId !== authorizedUserId) {
      logger.warn(
        { callId, bookingId, authorizedUserId, bookingUserId: existing.userId },
        "Native cancel: ownership mismatch — rejected",
      );
      return `error: no booking found with reference ${bookingId}`;
    }

    if (existing.status === "cancelled") {
      return `info: booking ${bookingId} was already cancelled`;
    }

    const [eventType] = existing.eventTypeId
      ? await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, existing.eventTypeId))
      : [];
    const [calendar] = existing.calendarId
      ? await db.select().from(schedulingCalendarsTable).where(eq(schedulingCalendarsTable.id, existing.calendarId))
      : [];

    const cancelledAt = new Date();
    await db.update(bookingsTable).set({ status: "cancelled", cancelledAt }).where(eq(bookingsTable.id, bookingId));

    logger.info({ callId, bookingId }, "Native cancel complete");

    if (eventType && calendar) {
      // Delete the Google Calendar event (best-effort, non-blocking)
      void (async () => {
        try {
          const gcalRow = await db.execute(
            sql`SELECT google_event_id FROM bookings WHERE id = ${bookingId}`,
          );
          const existingGoogleEventId = (gcalRow.rows[0] as { google_event_id?: string | null })
            ?.google_event_id ?? null;
          if (!existingGoogleEventId) return;
          const calRow = await db.execute(
            sql`SELECT google_calendar_connection_id FROM scheduling_calendars WHERE id = ${calendar.id}`,
          );
          const calendarConnectionId = (calRow.rows[0] as { google_calendar_connection_id?: string | null })
            ?.google_calendar_connection_id ?? null;
          const connectionId = calendarConnectionId ?? (await getFirstConnectionForUser(calendar.userId))?.id ?? null;
          if (connectionId) {
            await deleteCalendarEvent(connectionId, existingGoogleEventId);
          }
        } catch (err) {
          logger.warn({ callId, bookingId, err }, "Native cancel: Google Calendar event deletion failed");
        }
      })();

      sendBookingCancelledEmail({
        attendeeName: existing.attendeeName,
        attendeeEmail: existing.attendeeEmail,
        eventTypeName: eventType.name,
        slotStart: existing.slotStart,
        slotEnd: existing.slotEnd,
        timezone: calendar.timezone,
        hostEmail: calendar.hostEmail,
        additionalHosts: calendar.additionalHosts,
        bookingId: existing.id,
        notes: existing.attendeeNotes,
      }).catch((err) => logger.error({ callId, bookingId: existing.id, err }, "Native cancel: email send failed"));
      dispatchSchedulingWebhooks(calendar.userId, "scheduling.booking.cancelled", {
        booking: {
          ...existing,
          status: "cancelled",
          cancelledAt: cancelledAt.toISOString(),
          slotStart: existing.slotStart.toISOString(),
          slotEnd: existing.slotEnd.toISOString(),
          createdAt: existing.createdAt.toISOString(),
          updatedAt: existing.updatedAt.toISOString(),
        },
      }).catch((err) => logger.warn({ callId, bookingId: existing.id, err }, "Native cancel: webhook dispatch failed"));
    }

    return `cancellation_confirmed: booking_id=${bookingId}`;
  } catch (err) {
    logger.error({ callId, err }, "Native cancel tool execution failed");
    return "error: cancellation failed due to a technical issue";
  }
}

/**
 * Execute a webhook tool. Returns a result string (success or error) so it can
 * optionally be fed back to the LLM.
 */
export async function executeWebhookTool(
  callId: number,
  tool: AgentTool & { type: "webhook" },
  args: Record<string, unknown>,
): Promise<string> {
  logger.info({ callId, url: tool.url, method: tool.method }, "Executing webhook tool");
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "SnapServe-VoiceAgent/1.0",
      "ngrok-skip-browser-warning": "true",
      ...(tool.headers ?? {}),
    };
    if (tool.secret) headers["X-Webhook-Secret"] = tool.secret;

    let targetUrl = tool.url;
    if (tool.method === "GET" && args && Object.keys(args).length > 0) {
      try {
        const u = new URL(targetUrl);
        for (const [k, v] of Object.entries(args)) {
          if (v !== undefined && v !== null) {
            u.searchParams.set(k, String(v));
          }
        }
        targetUrl = u.toString();
      } catch {
        // if invalid URL for parsing, fallback to original
      }
    }

    // Support both wrapped { args } and top-level fields for maximum developer compatibility
    const requestBody =
      tool.method === "POST"
        ? JSON.stringify({
            callId,
            toolName: tool.name,
            args,
            ...args,
          })
        : undefined;

    const resp = await fetch(targetUrl, {
      method: tool.method,
      headers,
      body: requestBody,
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      logger.warn({ callId, url: targetUrl, status: resp.status }, "Webhook tool returned non-OK status");
      return `webhook_error: status=${resp.status}`;
    }

    logger.info({ callId, url: targetUrl, status: resp.status }, "Webhook tool executed successfully");

    let body = "";
    try {
      body = await resp.text();
    } catch {
      // ignore body read errors
    }
    return body ? `webhook_result: ${body.slice(0, 2000)}` : "webhook_success";
  } catch (err) {
    logger.error({ callId, url: tool.url, err }, "Webhook tool execution failed");
    return "error: webhook tool failed to execute";
  }
}

// ── parsePreferredDate (shared between pipeline.ts and webcall tool execution) ─

/**
 * Parse a natural-language or ISO preferred date string into a concrete search
 * start date, an optional minimum slot start instant for time-precision, and an
 * optional time-of-day slot filter.
 *
 * `isExactTime` is true when the caller supplied a specific clock time (e.g.
 * "2026-06-18T12:00" or "2026-06-18 12:00 PM").  The reschedule tool uses this
 * to enforce exact-slot matching instead of silently falling back to the first
 * available slot.
 */
export function parsePreferredDate(
  raw: string,
  tz = "UTC",
): { searchStart: Date; minSlotStart?: Date; timeFilter?: (slot: TimeSlot) => boolean; isExactTime?: boolean } {
  const now = new Date();
  const lower = raw.trim().toLowerCase();

  if (lower === "morning") {
    return { searchStart: now, timeFilter: (s) => toZonedTime(s.slotStart, tz).getHours() < 12 };
  }
  if (lower === "afternoon") {
    return {
      searchStart: now,
      timeFilter: (s) => {
        const h = toZonedTime(s.slotStart, tz).getHours();
        return h >= 12 && h < 17;
      },
    };
  }
  if (lower === "evening") {
    return { searchStart: now, timeFilter: (s) => toZonedTime(s.slotStart, tz).getHours() >= 17 };
  }

  if (lower === "today") {
    return { searchStart: now };
  }
  if (lower === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return { searchStart: d };
  }

  const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayMatch = lower.match(/^(?:(next|this)\s+)?(\w+)$/);
  if (dayMatch) {
    const modifier = dayMatch[1];
    const dayName = dayMatch[2]!;
    const dayIdx = DAY_NAMES.indexOf(dayName);
    if (dayIdx !== -1) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      const currentDay = d.getDay();
      let daysAhead = dayIdx - currentDay;
      if (modifier === "next") {
        if (daysAhead <= 0) daysAhead += 7;
        else daysAhead += 7;
      } else {
        if (daysAhead <= 0) daysAhead += 7;
      }
      d.setDate(d.getDate() + daysAhead);
      return { searchStart: d };
    }
  }

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const hasTimeComponent = raw.includes("T") || raw.includes(":");
    // When the string carries an explicit UTC offset (Z or ±HH:mm / ±HHmm) JS
    // new Date() honours it correctly.  A bare datetime like "2026-06-22T15:00:00"
    // has no offset and new Date() treats it as UTC, which shifts 3 PM IST to
    // 8:30 PM IST.  Re-anchor bare datetimes to the calendar's IANA timezone.
    const hasExplicitOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(raw.trim());
    const anchoredDate =
      hasTimeComponent && !hasExplicitOffset ? fromZonedTime(raw, tz) : new Date(raw);
    const effectiveStart = anchoredDate > now ? anchoredDate : now;
    return {
      searchStart: effectiveStart,
      minSlotStart: hasTimeComponent ? effectiveStart : undefined,
      isExactTime: hasTimeComponent,
    };
  }

  return { searchStart: now };
}

/**
 * Verifies that a UTC instant falls within the calendar's configured working-hours
 * for the day (including override windows).  Used as a post-selection safety guard
 * so a slot that somehow bypassed the slot-engine filter is caught before booking.
 */
async function isSlotWithinAvailabilityWindow(
  calendarId: number,
  slotStart: Date,
  timezone: string,
): Promise<boolean> {
  const schedules = await db
    .select()
    .from(availabilitySchedulesTable)
    .where(
      and(
        eq(availabilitySchedulesTable.calendarId, calendarId),
        eq(availabilitySchedulesTable.isActive, true),
      ),
    );

  if (schedules.length === 0) return false;

  const localSlot = toZonedTime(slotStart, timezone);
  const dayOfWeek = localSlot.getDay();
  const slotTimeStr = format(localSlot, "HH:mm");
  const dateStr = format(localSlot, "yyyy-MM-dd");

  const overrides = await db
    .select()
    .from(availabilityOverridesTable)
    .where(
      and(
        eq(availabilityOverridesTable.calendarId, calendarId),
        eq(availabilityOverridesTable.date, dateStr),
      ),
    )
    .limit(1);

  const override = overrides[0];
  if (override?.isBlocked) return false;
  if (override?.startTime && override?.endTime) {
    return slotTimeStr >= override.startTime && slotTimeStr < override.endTime;
  }

  const daySchedules = schedules.filter((s) => s.dayOfWeek === dayOfWeek);
  return daySchedules.some((s) => slotTimeStr >= s.startTime && slotTimeStr < s.endTime);
}

// ── Mid-call SMS (Twilio / Plivo) ────────────────────────────────────────────

export async function executeSendSms(opts: {
  callId: number;
  callerPhone?: string | null;
  telephonyProvider: string;
  providerKeys: Map<string, string>;
  messageTemplate: string;
}): Promise<string> {
  const callerPhone = opts.callerPhone?.trim() ?? "";
  if (!callerPhone) {
    logger.warn({ callId: opts.callId }, "Send SMS: no caller phone available — skipping");
    return "error: no caller phone available to send SMS. Ask the caller for a number, or continue without SMS.";
  }
  const message = opts.messageTemplate;
  const tprov = opts.telephonyProvider;
  logger.info({ callId: opts.callId, to: callerPhone, tprov }, "Executing Send SMS tool");
  try {
    if (tprov === "twilio") {
      const authToken = opts.providerKeys.get("twilio") ?? "";
      const extra = opts.providerKeys.get("twilio:extraConfig");
      const cfg = extra ? (JSON.parse(extra) as Record<string, string>) : {};
      const accountSid = cfg["accountSid"] ?? "";
      const fromNumber = cfg["fromNumber"] ?? "";
      const body = new URLSearchParams({ To: callerPhone, From: fromNumber, Body: message });
      const resp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Authorization": `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!resp.ok) {
        logger.warn({ callId: opts.callId, status: resp.status }, "Twilio SMS failed");
        return `error: SMS send failed (twilio status ${resp.status}). Apologize and continue helping the caller.`;
      }
      logger.info({ callId: opts.callId, to: callerPhone }, "SMS sent via Twilio");
      return `sms_sent: message delivered to ${callerPhone}. Confirm briefly to the caller.`;
    }
    if (tprov === "plivo") {
      const authToken = opts.providerKeys.get("plivo") ?? "";
      const extra = opts.providerKeys.get("plivo:extraConfig");
      const cfg = extra ? (JSON.parse(extra) as Record<string, string>) : {};
      const authId = cfg["authId"] ?? "";
      const fromNumber = cfg["fromNumber"] ?? "";
      const resp = await fetch(
        `https://api.plivo.com/v1/Account/${authId}/Message/`,
        {
          method: "POST",
          headers: {
            "Authorization": `Basic ${Buffer.from(`${authId}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ src: fromNumber, dst: callerPhone, text: message }),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!resp.ok) {
        logger.warn({ callId: opts.callId, status: resp.status }, "Plivo SMS failed");
        return `error: SMS send failed (plivo status ${resp.status}). Apologize and continue helping the caller.`;
      }
      logger.info({ callId: opts.callId, to: callerPhone }, "SMS sent via Plivo");
      return `sms_sent: message delivered to ${callerPhone}. Confirm briefly to the caller.`;
    }
    logger.warn({ callId: opts.callId, tprov }, "Send SMS: telephony provider does not support SMS");
    return "error: this telephony provider does not support SMS. Tell the caller you cannot text them from this call.";
  } catch (err) {
    logger.error({ callId: opts.callId, err }, "Send SMS tool execution failed");
    return "error: SMS send failed due to a technical issue. Apologize and continue helping the caller.";
  }
}

// ── Mid-call email (Email channel: managed or BYO Brevo) ─────────────────────

export async function executeSendEmail(opts: {
  agentId: number;
  callId: number;
  agentName?: string;
  callerPhone?: string | null;
  args: Record<string, unknown>;
}): Promise<string> {
  const toEmail = String(opts.args["to_email"] ?? opts.args["email"] ?? "").trim();
  if (!toEmail || !toEmail.includes("@")) {
    return "email_failed: missing or invalid to_email. Ask the caller for their email address, then try again.";
  }
  const domain = toEmail.split("@")[1]?.toLowerCase() ?? "";
  if (BLOCKED_EMAIL_DOMAINS.includes(domain)) {
    return "email_failed: that looks like a placeholder email. Ask the caller for their real address.";
  }

  const [agent] = await db
    .select({ userId: agentsTable.userId, name: agentsTable.name })
    .from(agentsTable)
    .where(eq(agentsTable.id, opts.agentId))
    .limit(1);
  if (!agent?.userId) {
    return "email_failed: could not resolve agent owner for the email channel.";
  }

  const recipientName = String(opts.args["recipient_name"] ?? opts.args["name"] ?? "").trim();
  const summary = String(opts.args["summary"] ?? "").trim();
  const subject = typeof opts.args["subject"] === "string" ? opts.args["subject"].trim() : "";
  const body = typeof opts.args["body"] === "string" ? opts.args["body"].trim() : "";

  const template =
    subject || body
      ? {
          ...(subject ? { subject } : {}),
          ...(body ? { body } : {}),
        }
      : null;

  logger.info(
    { callId: opts.callId, agentId: opts.agentId, toEmail, hasOverride: !!(subject || body) },
    "Executing Send Email tool",
  );

  const result = await sendChannelEmail({
    userId: agent.userId,
    toEmail,
    context: {
      name: recipientName || "there",
      phone: opts.callerPhone ?? "",
      email: toEmail,
      summary,
      agent_name: opts.agentName || agent.name || "SnapServe",
      call_id: opts.callId,
    },
    template,
    callId: opts.callId,
    journeyRunHint: "midcall_send_email",
  });

  if (result.ok) {
    return `email_sent: successfully sent to ${toEmail}. Confirm briefly to the caller that the email is on its way.`;
  }
  if (result.skipped === "inactive" || result.skipped === "missing_config") {
    return "email_failed: Email channel is not configured or inactive. Tell the caller you cannot send email right now.";
  }
  return `email_failed: ${result.error ?? "send failed"}. Apologize and offer another way to follow up.`;
}

// ── Mid-call WhatsApp (BYO BSP webhook or native Instant/Business) ───────────

export async function executeSendWhatsapp(opts: {
  agentId: number;
  callId: number;
  agentName?: string;
  callerPhone?: string | null;
  args: Record<string, unknown>;
}): Promise<string> {
  const toPhone = String(opts.args["to_phone"] ?? opts.args["phone"] ?? opts.callerPhone ?? "").trim();
  if (!toPhone || toPhone.replace(/\D/g, "").length < 8) {
    return "whatsapp_failed: missing or invalid phone. Ask the caller for their WhatsApp number, then try again.";
  }

  const [agent] = await db
    .select({ userId: agentsTable.userId, name: agentsTable.name })
    .from(agentsTable)
    .where(eq(agentsTable.id, opts.agentId))
    .limit(1);
  if (!agent?.userId) {
    return "whatsapp_failed: could not resolve agent owner for WhatsApp.";
  }

  const templateHint = typeof opts.args["template_hint"] === "string" ? opts.args["template_hint"].trim() : "call_summary";
  const templateName = typeof opts.args["template_name"] === "string" ? opts.args["template_name"].trim() : "";
  const message = typeof opts.args["message"] === "string" ? opts.args["message"].trim() : "";
  const summary = message || (typeof opts.args["summary"] === "string" ? opts.args["summary"].trim() : "");

  logger.info(
    { callId: opts.callId, agentId: opts.agentId, toPhone, templateHint },
    "Executing Send WhatsApp tool",
  );

  const result = await sendMidCallWhatsapp({
    userId: agent.userId,
    agentId: opts.agentId,
    agentName: opts.agentName || agent.name,
    callId: opts.callId,
    toPhone,
    templateHint,
    templateName: templateName || undefined,
    summary,
  });

  if (result.ok) {
    return `whatsapp_sent: message queued to ${toPhone} via ${result.via ?? "channel"}. Confirm briefly to the caller.`;
  }
  return `whatsapp_failed: ${result.error ?? "send failed"}. Apologize and offer another way to follow up.`;
}

// ── Transfer lead DB helper ────────────────────────────────────────────────────

// Not a scheduling function — re-exported here so pipeline.ts can import it
// from one place without circular dependencies.

export async function writeTransferLeadDb(
  opts: {
    callId: number;
    campaignLeadId: number | null;
    transferTo: string;
    type: "cold" | "warm" | "agent";
    summary?: string;
  },
): Promise<void> {
  const { callId, campaignLeadId, transferTo, type, summary } = opts;
  if (!campaignLeadId) return;

  let campaignId: number | undefined;
  let batchId: number | null = null;
  try {
    const [lead] = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, campaignLeadId));
    if (lead) {
      campaignId = lead.campaignId;
      batchId = lead.batchId ?? null;
    }
  } catch (err) {
    logger.warn({ callId, campaignLeadId, err }, "Transfer DB: failed to load lead — skipping DB writes");
    return;
  }
  if (!campaignId) return;

  let callExecutionId: number | null = null;
  try {
    const [exec] = await db.select().from(callExecutionsTable).where(eq(callExecutionsTable.callId, callId));
    if (exec) callExecutionId = exec.id;
  } catch (err) {
    logger.warn({ callId, err }, "Transfer DB: failed to resolve call execution");
  }

  let transferId: number | null = null;
  try {
    const [row] = await db.insert(leadTransfersTable).values({
      leadId: campaignLeadId,
      campaignId,
      batchId,
      callExecutionId: callExecutionId ?? undefined,
      transferredTo: transferTo,
      type,
      summary: summary ?? null,
      transferTime: new Date(),
    }).returning({ id: leadTransfersTable.id });
    transferId = row?.id ?? null;
  } catch (err) {
    logger.error({ callId, campaignLeadId, err }, "Transfer DB: lead_transfers insert failed");
  }

  try {
    await db.insert(leadTimelineTable).values({
      leadId: campaignLeadId,
      campaignId,
      eventType: `transfer_${type}`,
      data: { transferTo, summary: summary ?? null, transferId },
    });
  } catch (err) {
    logger.warn({ callId, campaignLeadId, err }, "Transfer DB: lead_timeline insert failed");
  }
}
