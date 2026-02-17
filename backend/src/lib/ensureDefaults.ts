import { prisma } from "./prisma.js";

/** Create default locations and time slots if the DB has none (so artist dashboard has options). */
export async function ensureDefaultLocationsAndSlots() {
  const [locationCount, slotCount] = await Promise.all([
    prisma.location.count(),
    prisma.timeSlot.count(),
  ]);
  if (locationCount === 0) {
    await prisma.location.createMany({
      data: [
        { name: "London Stadium", maxCapacity: 1000 },
        { name: "Cardiff Stadium", maxCapacity: 500 },
      ],
    });
    console.log("Created default locations (London Stadium, Cardiff Stadium)");
  }
  if (slotCount === 0) {
    await prisma.timeSlot.createMany({
      data: [
        { name: "Slot A", startTime: "13:00", endTime: "17:00" },
        { name: "Slot B", startTime: "18:00", endTime: "22:00" },
      ],
    });
    console.log("Created default time slots (Slot A, Slot B)");
  }
}
