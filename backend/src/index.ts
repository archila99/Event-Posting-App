import { startServer } from "./server.js";

if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  console.log("[Email] SMTP configured:", process.env.SMTP_HOST, "from:", process.env.EMAIL_FROM || process.env.SMTP_USER);
} else if (!process.env.SMTP_HOST) {
  console.log("[Email] Not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS (and optionally EMAIL_FROM) in backend/.env");
}

// Log uncaught errors so they appear in hosting logs before exit
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("unhandledRejection:", reason, promise);
  process.exit(1);
});

startServer().catch((e) => {
  console.error("Failed to start server:", e);
  process.exit(1);
});
