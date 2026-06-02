import nodemailer from "nodemailer";
import { logger } from "../../lib/logger.js";

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
  locationType?: string | null;
  locationAddress?: string | null;
  cancelLink?: string | null;
  rescheduleLink?: string | null;
}

/** Build the location line shown in confirmation emails: address for in-person, else the Meet link. */
function locationLine(data: { locationType?: string | null; locationAddress?: string | null; meetLink?: string | null }): string {
  if (data.locationType === "in_person") {
    return data.locationAddress ? `\nLocation: ${data.locationAddress}` : "";
  }
  return data.meetLink ? `\nGoogle Meet: ${data.meetLink}` : "";
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
  transporter: ReturnType<typeof nodemailer.createTransport>,
  to: string,
  cc: string | null | undefined,
  content: { subject: string; text: string; html: string },
  bookingId: number,
  tag: string,
) {
  const mailOptions: nodemailer.SendMailOptions = {
    from: process.env["GMAIL_USER"],
    to,
    ...content,
  };
  if (cc) mailOptions.cc = cc;

  try {
    await transporter.sendMail(mailOptions);
    logger.info({ bookingId, email: to, cc, tag }, "Booking email sent");
  } catch (err) {
    logger.warn({ err, bookingId, tag }, "Failed to send booking email");
  }
}

export async function sendBookingCreatedEmail(data: BookingEmailData): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    logger.warn("GMAIL_USER or GMAIL_APP_PASSWORD not set — skipping email notification");
    return;
  }

  const from = formatDateTime(data.slotStart, data.timezone);
  const to = formatDateTime(data.slotEnd, data.timezone);
  const meetLine = locationLine(data);

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
  await sendToAll(transporter, data.attendeeEmail, hosts.join(", ") || null, content, data.bookingId, "created");

  if (hosts.length > 0) {
    const hostBody = `New booking received.

Attendee: ${data.attendeeName} (${data.attendeeEmail})
Event: ${data.eventTypeName}
Date & Time: ${from} – ${to} (${data.timezone})${meetLine}${data.notes ? `\nNotes: ${data.notes}` : ""}

Booking Reference: #${data.bookingId}`;

    const hostContent = buildEmailContent(`New Booking: ${data.attendeeName} — ${data.eventTypeName}`, hostBody);
    await sendToAll(transporter, hosts.join(", "), null, hostContent, data.bookingId, "created-host");
  }
}

export async function sendBookingConfirmedEmail(data: BookingEmailData): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) return;

  const from = formatDateTime(data.slotStart, data.timezone);
  const to = formatDateTime(data.slotEnd, data.timezone);
  const meetLine = locationLine(data);

  const body = `Hi ${data.attendeeName},

Your appointment "${data.eventTypeName}" has been confirmed by the host.

Date & Time: ${from} – ${to} (${data.timezone})${meetLine}
Booking Reference: #${data.bookingId}

See you then!`;

  const content = buildEmailContent(`Appointment Confirmed: ${data.eventTypeName}`, body);
  await sendToAll(transporter, data.attendeeEmail, hostRecipients(data).join(", ") || null, content, data.bookingId, "confirmed");
}

export async function sendBookingCancelledEmail(data: BookingEmailData): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) return;

  const from = formatDateTime(data.slotStart, data.timezone);

  const attendeeBody = `Hi ${data.attendeeName},

Your appointment "${data.eventTypeName}" scheduled for ${from} (${data.timezone}) has been cancelled.

Booking Reference: #${data.bookingId}

If you have any questions, please reach out.`;

  const content = buildEmailContent(`Appointment Cancelled: ${data.eventTypeName}`, attendeeBody);
  await sendToAll(transporter, data.attendeeEmail, null, content, data.bookingId, "cancelled-attendee");

  const hosts = hostRecipients(data);
  if (hosts.length > 0) {
    const hostBody = `A booking has been cancelled.

Attendee: ${data.attendeeName} (${data.attendeeEmail})
Event: ${data.eventTypeName}
Originally scheduled: ${from} (${data.timezone})
Booking Reference: #${data.bookingId}`;

    const hostContent = buildEmailContent(`Booking Cancelled: ${data.attendeeName} — ${data.eventTypeName}`, hostBody);
    await sendToAll(transporter, hosts.join(", "), null, hostContent, data.bookingId, "cancelled-host");
  }
}

export async function sendBookingRescheduledEmail(data: BookingEmailData & { oldSlotStart?: Date }): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) return;

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
  await sendToAll(transporter, data.attendeeEmail, null, content, data.bookingId, "rescheduled-attendee");

  const hosts = hostRecipients(data);
  if (hosts.length > 0) {
    const hostBody = `A booking has been rescheduled.

Attendee: ${data.attendeeName} (${data.attendeeEmail})
Event: ${data.eventTypeName}
Previous time: ${oldFrom}
New Date & Time: ${from} – ${to} (${data.timezone})${meetLine}
Booking Reference: #${data.bookingId}`;

    const hostContent = buildEmailContent(`Booking Rescheduled: ${data.attendeeName} — ${data.eventTypeName}`, hostBody);
    await sendToAll(transporter, hosts.join(", "), null, hostContent, data.bookingId, "rescheduled-host");
  }
}
