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
  bookingId: number;
  notes?: string | null;
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
  return {
    subject,
    text: body,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px"><p style="white-space:pre-line">${body}</p><hr/><p style="color:#888;font-size:12px">Powered by VoiceOrch Scheduling</p></div>`,
  };
}

export async function sendBookingCreatedEmail(data: BookingEmailData): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    logger.warn("GMAIL_USER or GMAIL_APP_PASSWORD not set — skipping email notification");
    return;
  }

  const from = formatDateTime(data.slotStart, data.timezone);
  const to = formatDateTime(data.slotEnd, data.timezone);
  const body = `Hi ${data.attendeeName},

Your appointment has been ${data.eventTypeName ? `"${data.eventTypeName}"` : "booked"} successfully.

Date & Time: ${from} – ${to} (${data.timezone})
${data.notes ? `\nNotes: ${data.notes}` : ""}

Booking Reference: #${data.bookingId}

We look forward to speaking with you!`;

  const content = buildEmailContent(`Appointment Confirmed: ${data.eventTypeName}`, body);

  try {
    await transporter.sendMail({
      from: process.env["GMAIL_USER"],
      to: data.attendeeEmail,
      ...content,
    });
    logger.info({ bookingId: data.bookingId, email: data.attendeeEmail }, "Booking created email sent");
  } catch (err) {
    logger.warn({ err, bookingId: data.bookingId }, "Failed to send booking created email");
  }
}

export async function sendBookingConfirmedEmail(data: BookingEmailData): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) return;

  const from = formatDateTime(data.slotStart, data.timezone);
  const to = formatDateTime(data.slotEnd, data.timezone);
  const body = `Hi ${data.attendeeName},

Your appointment "${data.eventTypeName}" has been confirmed by the host.

Date & Time: ${from} – ${to} (${data.timezone})
Booking Reference: #${data.bookingId}

See you then!`;

  const content = buildEmailContent(`Appointment Confirmed: ${data.eventTypeName}`, body);

  try {
    await transporter.sendMail({
      from: process.env["GMAIL_USER"],
      to: data.attendeeEmail,
      ...content,
    });
  } catch (err) {
    logger.warn({ err, bookingId: data.bookingId }, "Failed to send booking confirmed email");
  }
}

export async function sendBookingCancelledEmail(data: BookingEmailData): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) return;

  const from = formatDateTime(data.slotStart, data.timezone);
  const body = `Hi ${data.attendeeName},

Your appointment "${data.eventTypeName}" scheduled for ${from} (${data.timezone}) has been cancelled.

Booking Reference: #${data.bookingId}

If you have any questions, please reach out.`;

  const content = buildEmailContent(`Appointment Cancelled: ${data.eventTypeName}`, body);

  try {
    await transporter.sendMail({
      from: process.env["GMAIL_USER"],
      to: data.attendeeEmail,
      ...content,
    });
  } catch (err) {
    logger.warn({ err, bookingId: data.bookingId }, "Failed to send booking cancelled email");
  }
}

export async function sendBookingRescheduledEmail(data: BookingEmailData & { oldSlotStart?: Date }): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) return;

  const from = formatDateTime(data.slotStart, data.timezone);
  const to = formatDateTime(data.slotEnd, data.timezone);
  const body = `Hi ${data.attendeeName},

Your appointment "${data.eventTypeName}" has been rescheduled.

New Date & Time: ${from} – ${to} (${data.timezone})
Booking Reference: #${data.bookingId}

If you did not request this change, please contact us.`;

  const content = buildEmailContent(`Appointment Rescheduled: ${data.eventTypeName}`, body);

  try {
    await transporter.sendMail({
      from: process.env["GMAIL_USER"],
      to: data.attendeeEmail,
      ...content,
    });
  } catch (err) {
    logger.warn({ err, bookingId: data.bookingId }, "Failed to send booking rescheduled email");
  }
}
