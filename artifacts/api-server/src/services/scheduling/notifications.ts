import nodemailer from "nodemailer";
import { logger } from "../../lib/logger.js";
import { collectBookingMailRecipients } from "./booking-mail-recipients.js";
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

async function sendOneFromCalendar(
  to: string,
  content: { subject: string; text: string; html: string },
  bookingId: number,
  tag: string,
  conn: { id: string; email: string },
): Promise<boolean> {
  const ok = await sendMailFromGoogleConnection(conn.id, {
    to,
    subject: content.subject,
    html: content.html,
  });
  if (ok) {
    logger.info({ bookingId, email: to, from: conn.email, tag }, "Booking email sent");
  }
  return ok;
}

/**
 * Send booking mail as the linked Google Calendar account (From = calendar mail).
 * Recipients: customer (spoken email) + organizer (hostEmail + calendar owner) + additional hosts.
 */
async function sendBookingPartyMails(opts: {
  data: BookingEmailData;
  customerContent: { subject: string; text: string; html: string };
  hostContent: { subject: string; text: string; html: string };
  tagPrefix: string;
}): Promise<void> {
  const { data, customerContent, hostContent, tagPrefix } = opts;
  const conn = await getLinkedGoogleConnectionForBooking(data.bookingId);
  if (!conn) {
    logger.warn(
      { bookingId: data.bookingId, tag: tagPrefix },
      "Booking email skipped — calendar has no linked Google account (will not send as platform GMAIL_USER)",
    );
    return;
  }

  const { customer, hosts } = collectBookingMailRecipients({
    attendeeEmail: data.attendeeEmail,
    hostEmail: data.hostEmail,
    additionalHosts: data.additionalHosts,
    organizerEmail: conn.email,
  });

  if (customer) {
    await sendOneFromCalendar(customer, customerContent, data.bookingId, `${tagPrefix}-customer`, conn);
  }
  for (const host of hosts) {
    await sendOneFromCalendar(host, hostContent, data.bookingId, `${tagPrefix}-host`, conn);
  }

  logger.info(
    {
      bookingId: data.bookingId,
      from: conn.email,
      customer,
      hosts,
      tag: tagPrefix,
    },
    "Booking party mails dispatched from Google Calendar account",
  );
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

  const hostBody = `New booking received.

Attendee: ${data.attendeeName} (${data.attendeeEmail})
Event: ${data.eventTypeName}
Date & Time: ${from} – ${to} (${data.timezone})${meetLine}${data.notes ? `\nNotes: ${data.notes}` : ""}

Booking Reference: #${data.bookingId}`;

  await sendBookingPartyMails({
    data,
    customerContent: buildEmailContent(`Appointment Confirmed: ${data.eventTypeName}`, attendeeBody),
    hostContent: buildEmailContent(`New Booking: ${data.attendeeName} — ${data.eventTypeName}`, hostBody),
    tagPrefix: "created",
  });
}

export async function sendBookingConfirmedEmail(data: BookingEmailData): Promise<void> {
  const from = formatDateTime(data.slotStart, data.timezone);
  const to = formatDateTime(data.slotEnd, data.timezone);
  const meetLine = data.meetLink ? `\nGoogle Meet: ${data.meetLink}` : "";

  const body = `Hi ${data.attendeeName},

Your appointment "${data.eventTypeName}" has been confirmed by the host.

Date & Time: ${from} – ${to} (${data.timezone})${meetLine}
Booking Reference: #${data.bookingId}

See you then!`;

  const hostBody = `A booking has been confirmed.

Attendee: ${data.attendeeName} (${data.attendeeEmail})
Event: ${data.eventTypeName}
Date & Time: ${from} – ${to} (${data.timezone})${meetLine}
Booking Reference: #${data.bookingId}`;

  await sendBookingPartyMails({
    data,
    customerContent: buildEmailContent(`Appointment Confirmed: ${data.eventTypeName}`, body),
    hostContent: buildEmailContent(`Booking Confirmed: ${data.attendeeName} — ${data.eventTypeName}`, hostBody),
    tagPrefix: "confirmed",
  });
}

export async function sendBookingCancelledEmail(data: BookingEmailData): Promise<void> {
  const from = formatDateTime(data.slotStart, data.timezone);

  const attendeeBody = `Hi ${data.attendeeName},

Your appointment "${data.eventTypeName}" scheduled for ${from} (${data.timezone}) has been cancelled.

Booking Reference: #${data.bookingId}

If you have any questions, please reach out.`;

  const hostBody = `A booking has been cancelled.

Attendee: ${data.attendeeName} (${data.attendeeEmail})
Event: ${data.eventTypeName}
Originally scheduled: ${from} (${data.timezone})
Booking Reference: #${data.bookingId}`;

  await sendBookingPartyMails({
    data,
    customerContent: buildEmailContent(`Appointment Cancelled: ${data.eventTypeName}`, attendeeBody),
    hostContent: buildEmailContent(`Booking Cancelled: ${data.attendeeName} — ${data.eventTypeName}`, hostBody),
    tagPrefix: "cancelled",
  });
}

export async function sendBookingRescheduledEmail(data: BookingEmailData & { oldSlotStart?: Date }): Promise<void> {
  const from = formatDateTime(data.slotStart, data.timezone);
  const to = formatDateTime(data.slotEnd, data.timezone);
  const meetLine = data.meetLink ? `\nGoogle Meet: ${data.meetLink}` : "";
  const oldLine = data.oldSlotStart
    ? `\nPrevious time: ${formatDateTime(data.oldSlotStart, data.timezone)}`
    : "";

  const attendeeBody = `Hi ${data.attendeeName},

Your appointment "${data.eventTypeName}" has been rescheduled.

New Date & Time: ${from} – ${to} (${data.timezone})${oldLine}${meetLine}
Booking Reference: #${data.bookingId}

See you then!`;

  const hostBody = `A booking has been rescheduled.

Attendee: ${data.attendeeName} (${data.attendeeEmail})
Event: ${data.eventTypeName}
New Date & Time: ${from} – ${to} (${data.timezone})${oldLine}${meetLine}
Booking Reference: #${data.bookingId}`;

  await sendBookingPartyMails({
    data,
    customerContent: buildEmailContent(`Appointment Rescheduled: ${data.eventTypeName}`, attendeeBody),
    hostContent: buildEmailContent(`Booking Rescheduled: ${data.attendeeName} — ${data.eventTypeName}`, hostBody),
    tagPrefix: "rescheduled",
  });
}
