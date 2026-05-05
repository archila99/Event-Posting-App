import { prisma } from "../lib/prisma.js";

export async function findActiveUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, password: true, name: true, role: true, deletedAt: true, emailVerifiedAt: true, createdAt: true },
  });
}

export async function createVerifiedUser(args: { email: string; passwordHash: string; name: string; role: string }) {
  return prisma.user.create({
    data: {
      email: args.email,
      password: args.passwordHash,
      name: args.name,
      role: args.role,
      emailVerifiedAt: new Date(),
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true, emailVerifiedAt: true },
  });
}

