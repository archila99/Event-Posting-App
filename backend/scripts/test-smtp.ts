/**
 * Test SMTP config from backend/.env
 * Run from backend: npx tsx scripts/test-smtp.ts
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER || "noreply@ticketbook.com";

async function main() {
  console.log("SMTP config:", {
    host: SMTP_HOST,
    port: SMTP_PORT,
    user: SMTP_USER,
    from: EMAIL_FROM,
    hasPass: !!SMTP_PASS,
  });

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error("Missing SMTP_HOST, SMTP_USER, or SMTP_PASS in backend/.env");
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    requireTLS: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  try {
    console.log("Verifying SMTP connection...");
    await transporter.verify();
    console.log("SMTP connection OK.");
  } catch (err) {
    console.error("SMTP verify failed:", err instanceof Error ? err.message : err);
    if (err instanceof Error && "code" in err) console.error("Code:", (err as { code?: string }).code);
    process.exit(1);
  }

  const to = process.argv[2] || SMTP_USER;
  const subject = "Ticket Book SMTP test";
  const text = "If you see this, SMTP is working.";

  try {
    await transporter.sendMail({
      from: EMAIL_FROM || SMTP_USER,
      to,
      subject,
      text,
    });
    console.log("Test email sent to", to, "- check inbox (and spam).");
  } catch (err) {
    console.error("Send failed:", err instanceof Error ? err.message : err);
    if (err instanceof Error && "response" in err) console.error("Response:", (err as { response?: string }).response);
    process.exit(1);
  }
}

main();
