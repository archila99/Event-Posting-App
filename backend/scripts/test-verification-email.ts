/**
 * Test sending the 6-digit verification code email (same as register flow).
 * Run from backend: npx tsx scripts/test-verification-email.ts
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const toEmail = process.env.SMTP_USER || process.argv[2];
if (!toEmail) {
  console.error("Usage: npx tsx scripts/test-verification-email.ts [email]");
  console.error("Or set SMTP_USER in backend/.env");
  process.exit(1);
}

const code = String(Math.floor(100000 + Math.random() * 900000));

async function main() {
  console.log("Sending 6-digit verification code to:", toEmail);
  console.log("Code (for checking inbox):", code);

  const { sendVerificationCode } = await import("../src/lib/email.ts");
  try {
    const sent = await sendVerificationCode(toEmail, code);
    if (sent) {
      console.log("SUCCESS — Check your inbox (and spam) for the verification code email.");
    } else {
      console.log("Email not sent (SMTP not configured). Code was:", code);
    }
  } catch (err) {
    console.error("FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
