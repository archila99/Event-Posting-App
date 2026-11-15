import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma.js';

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

export async function verifyDatabase() {
  const expected = process.env.EVENTORA_TEST_DATABASE_VERIFIED;
  assert.match(expected || '', /^eventora_test_[a-z0-9_]+$/);
  assert.equal(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL);
  const [row] = await prisma.$queryRaw<Array<{ name: string; purpose: string; schema: string }>>`
    SELECT current_database() AS name, current_schema() AS schema, shobj_description(oid, 'pg_database') AS purpose
    FROM pg_database WHERE datname = current_database()`;
  assert.equal(row.name, expected);
  assert.equal(row.schema, 'public');
  assert.equal(row.purpose, 'eventora isolated integration tests');
}

export async function fixture(capacity: number, users = 2) {
  const prefix = `test_${randomUUID()}`;
  const artist = await prisma.user.create({ data: {
    email: `${prefix}_artist@example.invalid`, name: prefix, role: 'ARTIST', password: 'unused', emailVerifiedAt: new Date(),
  } });
  const attendees = [];
  for (let i = 0; i < users; i++) attendees.push(await prisma.user.create({ data: {
    email: `${prefix}_${i}@example.invalid`, name: prefix, role: 'USER', password: 'unused', emailVerifiedAt: new Date(),
  } }));
  const admin = await prisma.user.create({ data: {
    email: `${prefix}_admin@example.invalid`, name: prefix, role: 'ADMIN', password: 'unused', emailVerifiedAt: new Date(),
  } });
  const location = await prisma.location.create({ data: { name: prefix, maxCapacity: 100 } });
  const slot = await prisma.timeSlot.create({ data: { name: prefix, startTime: '13:00', endTime: '17:00' } });
  const event = await prisma.event.create({ data: {
    artistId: artist.id, locationId: location.id, timeSlotId: slot.id, date: '2099-01-01', capacity,
  } });
  return { prefix, artist, attendees, admin, location, slot, event };
}

export async function cleanup(f: Awaited<ReturnType<typeof fixture>>) {
  await verifyDatabase();
  const userIds = [f.artist, f.admin, ...f.attendees].map(u => u.id);
  // Every delete is scoped to UUID-owned fixtures; never truncate/reset/drop.
  await prisma.$transaction(async tx => {
    await tx.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { entityId: f.event.id }] } });
    await tx.verificationCode.deleteMany({ where: { userId: { in: userIds } } });
    await tx.ticket.deleteMany({ where: { eventId: f.event.id } });
    await tx.reservation.deleteMany({ where: { eventId: f.event.id } });
    await tx.eventComment.deleteMany({ where: { eventId: f.event.id } });
    await tx.event.deleteMany({ where: { id: f.event.id } });
    await tx.location.delete({ where: { id: f.location.id } });
    await tx.timeSlot.delete({ where: { id: f.slot.id } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
}
