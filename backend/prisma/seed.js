import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();
async function main() {
    const password = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.upsert({
        where: { email: "admin@ticketbook.com" },
        update: {},
        create: {
            email: "admin@ticketbook.com",
            password,
            name: "Admin",
            role: "ADMIN",
        },
    });
    const artist = await prisma.user.upsert({
        where: { email: "artist@ticketbook.com" },
        update: {},
        create: {
            email: "artist@ticketbook.com",
            password,
            name: "Jane Artist",
            role: "ARTIST",
        },
    });
    const user = await prisma.user.upsert({
        where: { email: "user@ticketbook.com" },
        update: {},
        create: {
            email: "user@ticketbook.com",
            password,
            name: "John User",
            role: "USER",
        },
    });
    const slotA = await prisma.timeSlot.findFirst({ where: { name: "Slot A" } })
        ?? await prisma.timeSlot.create({ data: { name: "Slot A", startTime: "13:00", endTime: "17:00" } });
    const slotB = await prisma.timeSlot.findFirst({ where: { name: "Slot B" } })
        ?? await prisma.timeSlot.create({ data: { name: "Slot B", startTime: "18:00", endTime: "22:00" } });
    const london = await prisma.location.findFirst({ where: { name: "London Stadium" } })
        ?? await prisma.location.create({ data: { name: "London Stadium", maxCapacity: 1000 } });
    const cardiff = await prisma.location.findFirst({ where: { name: "Cardiff Stadium" } })
        ?? await prisma.location.create({ data: { name: "Cardiff Stadium", maxCapacity: 500 } });
    console.log("Seed complete:", { admin: admin.email, artist: artist.email, user: user.email, slotA: slotA.name, slotB: slotB.name, london: london.name, cardiff: cardiff.name });
}
main()
    .then(() => prisma.$disconnect())
    .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});
