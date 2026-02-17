import { prisma } from "../lib/prisma.js";

/** Slot is reserved if there is an APPROVED event (not cancelled). */
export async function isLocationAvailable(locationId: string, date: string, timeSlotId: string, excludeEventId?: string): Promise<boolean> {
  const existing = await prisma.event.findFirst({
    where: {
      locationId,
      date,
      timeSlotId,
      status: "APPROVED",
      id: excludeEventId ? { not: excludeEventId } : undefined,
    },
  });
  return !existing;
}

export async function isArtistAvailable(artistId: string, date: string, timeSlotId: string, excludeEventId?: string): Promise<boolean> {
  const existing = await prisma.event.findFirst({
    where: {
      artistId,
      date,
      timeSlotId,
      status: "APPROVED",
      id: excludeEventId ? { not: excludeEventId } : undefined,
    },
  });
  return !existing;
}

/** Check that (date + timeSlot start) is in the future from now. */
export function isDateAndSlotInFuture(date: string, startTime: string): boolean {
  const now = new Date();
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = startTime.split(":").map(Number);
  const slotStart = new Date(y, m - 1, d, hh, mm, 0, 0);
  return slotStart > now;
}

export async function validateEventCreation(
  artistId: string,
  locationId: string,
  date: string,
  timeSlotId: string,
  capacity: number
): Promise<{ ok: boolean; error?: string }> {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location || !location.isActive) return { ok: false, error: "Location not found or inactive" };
  if (capacity > location.maxCapacity) return { ok: false, error: "Event capacity exceeds location maximum" };

  const timeSlot = await prisma.timeSlot.findUnique({ where: { id: timeSlotId } });
  if (!timeSlot || !timeSlot.isActive) return { ok: false, error: "Time slot not found or inactive" };

  if (!isDateAndSlotInFuture(date, timeSlot.startTime)) {
    return { ok: false, error: "Event must be in the future. Select a date and time slot from the current time onward." };
  }

  const locationFree = await isLocationAvailable(locationId, date, timeSlotId);
  if (!locationFree) return { ok: false, error: "This slot is already reserved. Choose another date or time slot." };

  const artistFree = await isArtistAvailable(artistId, date, timeSlotId);
  if (!artistFree) return { ok: false, error: "You already have an event in this time slot." };

  return { ok: true };
}
