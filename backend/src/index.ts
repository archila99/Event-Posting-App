import { startServer } from "./server.js";

// Log uncaught errors so they appear in Cloud Run logs before exit
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
