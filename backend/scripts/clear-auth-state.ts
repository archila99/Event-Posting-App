/**
 * Clear temporary auth data so register flow requires verification again.
 * - Deletes all PendingRegistration (pending signups that never verified)
 * - Deletes all EmailVerificationCode (old per-user verification codes)
 * Does NOT delete User records; use Prisma Studio or SQL to remove test users.
 *
 * Run from backend: npx tsx scripts/clear-auth-state.ts
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const prisma = new PrismaClient();

async function main() {
  const deletedPending = await prisma.pendingRegistration.deleteMany({});
  const deletedCodes = await prisma.emailVerificationCode.deleteMany({});

  console.log("Cleared auth state:");
  console.log("  PendingRegistration deleted:", deletedPending.count);
  console.log("  EmailVerificationCode deleted:", deletedCodes.count);
  console.log("");
  console.log("Users in DB are unchanged. To remove test users, use Prisma Studio or:");
  console.log('  npx prisma studio  → delete from User table');
  console.log("  Or SQL: DELETE FROM \"User\" WHERE email = 'test@example.com';");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
