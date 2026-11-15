import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export class BookingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function sqlState(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return String(error.meta?.code ?? "");
  }
  return undefined;
}

export function retryableTransaction(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || ["40P01", "40001"].includes(sqlState(error) || ""));
}

export function databaseBusy(error: unknown): boolean {
  return retryableTransaction(error) ||
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (["P2028", "P2024"].includes(error.code) || ["55P03", "57014"].includes(sqlState(error) || ""));
}

// Only callbacks containing transactional DB work belong here: no mail, HTTP, or other side effects.
// Retry only explicit transaction aborts, never errors with an ambiguous commit outcome.
export async function bookingTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
        return work(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (!retryableTransaction(error) || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}

export async function lockEvent(tx: Prisma.TransactionClient, eventId: string) {
  const [event] = await tx.$queryRaw<Array<{ id: string; capacity: number; status: string; locationId: string }>>`
    SELECT id, capacity, status, "locationId" FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
  if (!event) throw new BookingError(404, "Event not found");
  return event;
}

export async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  // CURRENT_TIMESTAMP is fixed at transaction start, which can precede a long lock wait.
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return row.now;
}
