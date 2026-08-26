import nodemailer from "nodemailer";
import { logger } from "../../lib/logger.js";
import {
  getLinkedGoogleConnectionForBooking,
  sendMailFromGoogleConnection,
} from "./google-calendar.js";

interface BookingEmailData {
  attendeeName: string;
  attendeeEmail: string;
  eventTypeName: string;
  slotStart: Date;
  slotEnd: Date;
  timezone: string;
  hostName?: string;
  hostEmail?: string | null;
  additionalHosts?: string[] | null;
  bookingId: number;
  notes?: string | null;
  meetLink?: string | null;
  cancelLink?: string | null;
  rescheduleLink?: string | null;
  calendarSyncStatus?: string | null;
}

function getTransporter() {
  const user = process.env["GMAIL_USER"];
  const pass = process.env["GMAIL_APP_PASSWORD"];
  if (!user || !pass) {
    return null;
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

/**
 * Sends a generic email via the Gmail transport (GMAIL_USER + GMAIL_APP_PASSWORD).
 * Throws if env vars are absent so callers can decide how to handle the failure.
 */
export async function sendGmailEmail(to: string, subject: string, htmlBody: string): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error("Gmail transport not configured: GMAIL_USER and GMAIL_APP_PASSWORD must be set.");
  }
  const from = process.env["GMAIL_USER"]!;
  await transporter.sendMail({ from, to, subject, html: htmlBody });
}

function formatDateTime(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toUTCString();
  }
}

function buildEmailContent(subject: string, body: string): { subject: string; text: string; html: string } {
  const htmlBody = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  return {
    subject,
    text: body,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">${htmlBody}<hr style="margin-top:24px;border:none;border-top:1px solid #e5e7eb"/><p style="color:#888;font-size:12px;margin-top:12px">Powered by VoiceOrch Scheduling</p></div>`,
  };
}

/** Collect, dedupe and normalize the full host recipient list (primary + additional). */
function hostRecipients(data: { hostEmail?: string | null; additionalHosts?: string[] | null }): string[] {
  const all: string[] = [];
  if (data.hostEmail) all.push(data.hostEmail);
  if (data.additionalHosts) all.push(...data.additionalHosts);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of all) {
    const e = raw.trim();
    if (!e) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

async function sendToAll(
  to: string,
  content: { subject: string; text: string; html: string },
  bookingId: number,
  tag: string,
) {
  const conn = await getLinkedGoogleConnectionForBooking(bookingId);
  if (!conn) {
    logger.warn(
      { bookingId, to, tag },
      "Booking email skipped — calendar has no linked Google account (will not send as platform GMAIL_USER)",
    );
    return;
  }
  const ok = await sendMailFromGoogleConnection(conn.id, {
    to,
    subject: content.subject,
    html: content.html,
  });
  if (ok) {
    logger.info({ bookingId, email: to, from: conn.email, tag }, "Booking email sent");
  }
}

/**
 * Sends a single test booking-confirmation email to the given address.
 * Unlike the regular send helpers, this throws on SMTP failure so callers
 * can surface the error as an HTTP 500 response.
 */
export async function sendTestEmail(to: string): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error("GMAIL_USER or GMAIL_APP_PASSWORD not configured");
  }

  const now = new Date();
  const slotEnd = new Date(now.getTime() + 30 * 60 * 1000);
  const from = formatDateTime(now, "UTC");
  const toTime = formatDateTime(slotEnd, "UTC");

  const body = `Hi Test Attendee,

Your appointment "Test Event (30 min)" has been booked successfully.

Date & Time: ${from} – ${toTime} (UTC)
Notes: This is a test email sent from the VoiceOrch Admin panel to verify GMAIL configuration.

Booking Reference: #0

We look forward to speaking with you!`;

  const content = buildEmailContent("Appointment Confirmed: Test Event (30 min)", body);

  await transporter.sendMail({
    from: process.env["GMAIL_USER"],
    to,
    ...content,
  });

  logger.info({ to }, "Admin test email sent");
}

export async function sendBookingCreatedEmail(data: BookingEmailData): Promise<void> {
  if (data.calendarSyncStatus === "synced") {
    logger.info(
      { bookingId: data.bookingId, attendeeEmail: data.attendeeEmail },
      "Skipping extra booking email: Google Calendar invitation was sent from the connected Google account",
    );
    return;
  }

  const from = formatDateTime(data.slotStart, data.timezone);
  const to = formatDateTime(data.slotEnd, data.timezone);
  const meetLine = data.meetLink ? `\nGoogle Meet: ${data.meetLink}` : "";

  const selfServiceLines = (data.cancelLink || data.rescheduleLink)
    ? `\n\n── Manage your appointment ──${data.rescheduleLink ? `\nReschedule: ${data.rescheduleLink}` : ""}${data.cancelLink ? `\nCancel: ${data.cancelLink}` : ""}`
    : "";

  const attendeeBody = `Hi ${data.attendeeName},

Your appointment "${data.eventTypeName}" has been booked successfully.

Date & Time: ${from} – ${to} (${data.timezone})${meetLine}${data.notes ? `\nNotes: ${data.notes}` : ""}

Booking Reference: #${data.bookingId}${selfServiceLines}

We look forward to speaking with you!`;

  const hosts = hostRecipients(data);
  const content = buildEmailContent(`Appointment Confirmed: ${data.eventTypeName}`, attendeeBody);
  await sendToAll(data.attendeeEmail, content, data.bookingId, "created");

  if (hosts.length > 0) {
    const hostBody = `New booking received.

Attendee: ${data.attendeeName} (${data.attendeeEmail})
Event: ${data.eventTypeName}
Date & Time: ${from} – ${to} (${data.timezone})${meetLine}${data.notes ? `\nNotes: ${data.notes}` : ""}

Booking Reference: #${data.bookingId}`;

    const hostContent = buildEmailContent(`New Booking: ${data.attendeeName} — ${data.eventTypeName}`, hostBody);
    await sendToAll(hosts.join(", "), hostContent, data.bookingId, "created-host");
  }
}

export async function sendBookingConfirmedEmail(data: BookingEmailData): Promise<void> {
  if (data.calendarSyncStatus === "synced") {
    logger.info(
      { bookingId: data.bookingId, attendeeEmail: data.attendeeEmail },
      "Skipping extra booking email: Google Calendar invitation was sent from the connected Google account",
    );
    return;
  }

  const from = formatDateTime(data.slotStart, data.timezone);
  const to = formatDateTime(data.slotEnd, data.timezone);
  const meetLine = data.meetLink ? `\nGoogle Meet: ${data.meetLink}` : "";

  const body = `Hi ${data.attendeeName},

Your appointment "${data.eventTypeName}" has been confirmed by the host.

Date & Time: ${from} – ${to} (${data.timezone})${meetLine}
Booking Reference: #${data.bookingId}

See you then!`;

  const content = buildEmailContent(`Appointment Confirmed: ${data.eventTypeName}`, body);
  await sendToAll(data.attendeeEmail, content, data.bookingId, "confirmed");
}

export async function sendBookingCancelledEmail(data: BookingEmailData): Promise<void> {
  if (data.calendarSyncStatus === "synced") {
    logger.info(
      { bookingId: data.bookingId, attendeeEmail: data.attendeeEmail },
      "Skipping extra booking cancel email: Google Calendar cancellation was sent from the connected Google account",
    );
    return;
  }

  const from = formatDateTime(data.slotStart, data.timezone);

  const attendeeBody = `Hi ${data.attendeeName},

Your appointment "${data.eventTypeName}" scheduled for ${from} (${data.timezone}) has been cancelled.

Booking Reference: #${data.bookingId}

If you have any questions, please reach out.`;

  const content = buildEmailContent(`Appointment Cancelled: ${data.eventTypeName}`, attendeeBody);
  await sendToAll(data.attendeeEmail, content, data.bookingId, "cancelled-attendee");

  const hosts = hostRecipients(data);
  if (hosts.length > 0) {
    const hostBody = `A booking has been cancelled.

Attendee: ${data.attendeeName} (${data.attendeeEmail})
Event: ${data.eventTypeName}
Originally scheduled: ${from} (${data.timezone})
Booking Reference: #${data.bookingId}`;

    const hostContent = buildEmailContent(`Booking Cancelled: ${data.attendeeName} — ${data.eventTypeName}`, hostBody);
    await sendToAll(hosts.join(", "), hostContent, data.bookingId, "cancelled-host");
  }
}

export async function sendBookingRescheduledEmail(data: BookingEmailData & { oldSlotStart?: Date }): Promise<void> {
  if (data.calendarSyncStatus === "synced") {
    logger.info(
      { bookingId: data.bookingId, attendeeEmail: data.attendeeEmail },
      "Skipping extra booking reschedule email: Google Calendar notification was sent from the connected Google account",
    );
    return;
  }

  const from = formatDateTime(data.slotStart, data.timezone);
  const to = formatDateTime(data.slotEnd, data.timezone);
  const meetLine = data.meetLink ? `\nGoogle Meet: ${data.meetLink}` : "";
  const oldFrom = data.oldSlotStart ? formatDateTime(data.oldSlotStart, data.timezone) : "previous time";

  const selfServiceLines = (data.cancelLink || data.rescheduleLink)
    ? `\n\n── Manage your appointment ──${data.rescheduleLink ? `\nReschedule again: ${data.rescheduleLink}` : ""}${data.cancelLink ? `\nCancel: ${data.cancelLink}` : ""}`
    : "";

  const attendeeBody = `Hi ${data.attendeeName},

Your appointment "${data.eventTypeName}" has been rescheduled.

Previous time: ${oldFrom}
New Date & Time: ${from} – ${to} (${data.timezone})${meetLine}
Booking Reference: #${data.bookingId}${selfServiceLines}

If you did not request this change, please contact us.`;

  const content = buildEmailContent(`Appointment Rescheduled: ${data.eventTypeName}`, attendeeBody);
  await sendToAll(data.attendeeEmail, content, data.bookingId, "rescheduled-attendee");

  const hosts = hostRecipients(data);
  if (hosts.length > 0) {
    const hostBody = `A booking has been rescheduled.

Attendee: ${data.attendeeName} (${data.attendeeEmail})
Event: ${data.eventTypeName}
Previous time: ${oldFrom}
New Date & Time: ${from} – ${to} (${data.timezone})${meetLine}
Booking Reference: #${data.bookingId}`;

    const hostContent = buildEmailContent(`Booking Rescheduled: ${data.attendeeName} — ${data.eventTypeName}`, hostBody);
    await sendToAll(hosts.join(", "), hostContent, data.bookingId, "rescheduled-host");
  }
}
