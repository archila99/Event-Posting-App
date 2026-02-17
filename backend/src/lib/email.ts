import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@ticketbook.com";

/** Send verification code to user's email. If SMTP is not configured, logs to console. */
export async function sendVerificationCode(toEmail: string, code: string): Promise<void> {
  const subject = "Your Ticket Book verification code";
  const text = `Your verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`;
  const html = `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log("[Email not configured] Verification code for", toEmail, ":", code);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    ...(SMTP_HOST === "smtp.gmail.com" && { secure: false, requireTLS: true }),
  });

  await transporter.sendMail({
    from: EMAIL_FROM || SMTP_USER,
    to: toEmail,
    subject,
    text,
    html,
  });
}

export type EventCancellationRecipient = "attendee" | "artist";

/** Send event cancellation notification. If SMTP not configured, logs to console. */
export async function sendEventCancellationEmail(
  toEmail: string,
  eventInfo: { title: string | null; date: string; locationName: string; timeSlotName: string; timeSlotRange?: string },
  recipientType: EventCancellationRecipient
): Promise<void> {
  const title = eventInfo.title || "Concert";
  const when = `${eventInfo.date} at ${eventInfo.locationName} (${eventInfo.timeSlotName}${eventInfo.timeSlotRange ? `, ${eventInfo.timeSlotRange}` : ""})`;

  const isAttendee = recipientType === "attendee";
  const subject = isAttendee
    ? `Event cancelled: ${title} on ${eventInfo.date}`
    : `Your event has been cancelled: ${title}`;
  const text = isAttendee
    ? `The event "${title}" scheduled for ${when} has been cancelled by the administrator.\n\nYour reservation has been cancelled. If you had already purchased ticket(s), they will be refunded.\n\nWe apologise for any inconvenience.`
    : `Your event "${title}" scheduled for ${when} has been cancelled by the administrator.`;
  const html = isAttendee
    ? `<p>The event <strong>${escapeHtml(title)}</strong> scheduled for ${escapeHtml(when)} has been cancelled by the administrator.</p><p>Your reservation has been cancelled. If you had already purchased ticket(s), they will be refunded.</p><p>We apologise for any inconvenience.</p>`
    : `<p>Your event <strong>${escapeHtml(title)}</strong> scheduled for ${escapeHtml(when)} has been cancelled by the administrator.</p>`;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log("[Email not configured] Event cancellation to", toEmail, ":", subject);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    ...(SMTP_HOST === "smtp.gmail.com" && { secure: false, requireTLS: true }),
  });

  await transporter.sendMail({
    from: EMAIL_FROM || SMTP_USER,
    to: toEmail,
    subject,
    text,
    html,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
