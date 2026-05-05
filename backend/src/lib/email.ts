import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getEmailConfig() {
  dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });
  const SMTP_HOST = process.env.SMTP_HOST?.trim();
  const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
  const SMTP_USER = process.env.SMTP_USER?.trim();
  const SMTP_PASS = process.env.SMTP_PASS?.trim();
  const EMAIL_FROM = (process.env.EMAIL_FROM || process.env.SMTP_USER || "noreply@ticketbook.com").trim();
  return { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM };
}

/** Send a single email via SMTP. Returns true if sent, false if SMTP not configured or send fails. */
async function sendEmail(to: string, subject: string, text: string, html: string): Promise<boolean> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = getEmailConfig();
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn("[Email] Not configured — SMTP_HOST, SMTP_USER, or SMTP_PASS missing. Check backend/.env");
    return false;
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    // Brevo SMTP relay uses STARTTLS on 587 (secure=false).
    // Keep this explicit to avoid provider-specific branching and surprises in production.
    secure: false,
    requireTLS: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  try {
    console.log("[Email] Sending:", subject, "→", to);
    await transporter.sendMail({
      from: EMAIL_FROM || SMTP_USER,
      to,
      subject,
      text,
      html,
    });
    console.log("[Email] Sent successfully:", subject, "→", to);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Email] SMTP send failed:", msg, {
      host: SMTP_HOST,
      port: SMTP_PORT,
      user: SMTP_USER,
      from: EMAIL_FROM || SMTP_USER,
      to,
      subject,
    });
    if (err instanceof Error && "code" in err) console.error("[Email] Code:", (err as { code?: string }).code);
    if (err && typeof err === "object" && "response" in err) console.error("[Email] Response:", (err as { response?: string }).response);
    return false;
  }
}

/** Send verification code to user's email. Returns true if sent, false if SMTP not configured; throws on send failure. */
export async function sendVerificationCode(toEmail: string, code: string): Promise<boolean> {
  const subject = "Your Eventora verification code";
  const text = `Your verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`;
  const html = `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`;

  const sent = await sendEmail(toEmail, subject, text, html);
  if (!sent) console.log("[Email] Verification code not sent for", toEmail, "(SMTP not configured or send failed).");
  return sent;
}

/** Send password reset code. Returns true if sent, false if SMTP not configured; throws on send failure. */
export async function sendPasswordResetCode(toEmail: string, code: string): Promise<boolean> {
  const subject = "Your Eventora password reset code";
  const text = `Your password reset code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone. If you didn't request this, you can ignore this email.`;
  const html = `<p>Your password reset code is: <strong>${code}</strong></p><p>This code expires in 10 minutes. Do not share it with anyone.</p><p>If you didn't request this, you can ignore this email.</p>`;

  const sent = await sendEmail(toEmail, subject, text, html);
  if (!sent) console.log("[Email] Password reset code not sent for", toEmail, "(SMTP not configured or send failed).");
  return sent;
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

  const sent = await sendEmail(toEmail, subject, text, html);
  if (!sent) console.log("[Email not configured] Event cancellation to", toEmail, ":", subject);
}

/** Send ticket refund notification (admin refunded this ticket). If SMTP not configured, logs to console. */
export async function sendTicketRefundEmail(
  toEmail: string,
  eventInfo: { title: string | null; date: string; locationName: string; timeSlotName: string; timeSlotRange?: string }
): Promise<void> {
  const title = eventInfo.title || "Event";
  const when = `${eventInfo.date} at ${eventInfo.locationName} (${eventInfo.timeSlotName}${eventInfo.timeSlotRange ? `, ${eventInfo.timeSlotRange}` : ""})`;
  const subject = `Ticket refunded: ${title} on ${eventInfo.date}`;
  const text = `Your ticket for "${title}" scheduled for ${when} has been refunded by the administrator.\n\nIf you have any questions, please contact support.`;
  const html = `<p>Your ticket for <strong>${escapeHtml(title)}</strong> scheduled for ${escapeHtml(when)} has been refunded by the administrator.</p><p>If you have any questions, please contact support.</p>`;

  const sent = await sendEmail(toEmail, subject, text, html);
  if (!sent) console.log("[Email not configured] Ticket refund to", toEmail, ":", subject);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
