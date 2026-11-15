import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/lib/accessToken.js';
import { bookingTransaction, databaseBusy } from '../src/lib/bookingTransaction.js';
import { createReservation, purchaseReservation, expireReservation, changeEventCapacity } from '../src/services/bookingService.js';
import { expireReservations } from '../src/jobs/expireReservations.js';
import { cleanup, deferred, fixture, verifyDatabase } from './helpers.js';

let server: Server;
let base: string;
const owned: Awaited<ReturnType<typeof fixture>>[] = [];
type Next = (params: Prisma.MiddlewareParams) => Promise<unknown>;
let hook: ((params: Prisma.MiddlewareParams, next: Next) => Promise<unknown>) | undefined;
prisma.$use((params, next) => hook ? hook(params, next) : next(params));

before(async () => {
  await verifyDatabase();
  process.env.JWT_ACCESS_SECRET = randomUUID();
  server = createApp({ uploadsDir: '/private/tmp/eventora-test-no-uploads' }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  await prisma.$disconnect();
});

async function make(capacity: number, users = 2) {
  const f = await fixture(capacity, users); owned.push(f); return f;
}
async function request(user: { id: string; email: string; role: string }, path: string, body?: unknown, method = 'POST') {
  const token = signAccessToken({ userId: user.id, email: user.email, role: user.role });
  const response = await fetch(base + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
function reserve(f: Awaited<ReturnType<typeof fixture>>, index: number, quantity = 1) {
  return request(f.attendees[index], '/reservations', { eventId: f.event.id, quantity });
}
async function invariant(f: Awaited<ReturnType<typeof fixture>>) {
  const event = await prisma.event.findUnique({ where: { id: f.event.id } });
  if (!event) return;
  const tickets = await prisma.ticket.findMany({ where: { eventId: event.id } });
  assert.ok(tickets.filter(t => ['RESERVED', 'SOLD'].includes(t.status)).length <= event.capacity, 'occupied <= capacity');
  const reservations = await prisma.reservation.findMany({ where: { eventId: event.id } });
  for (const r of reservations) {
    const associated = tickets.filter(t => t.reservationId === r.id);
    assert.equal(associated.length, r.quantity);
    const allowed = r.status === 'ACTIVE' ? ['RESERVED'] : r.status === 'EXPIRED' ? ['EXPIRED'] : ['SOLD', 'REFUNDED'];
    assert.ok(associated.every(t => allowed.includes(t.status)), `ticket states agree with ${r.status}`);
    if (r.status === 'CONVERTED') assert.ok(associated.every(t => t.userId === r.userId && t.purchasedAt !== null));
    const logs = await prisma.auditLog.findMany({ where: { entityId: r.id } });
    assert.equal(logs.filter(l => l.action === 'RESERVATION_CREATED').length, 1);
    assert.equal(logs.filter(l => l.action === 'PURCHASE').length, r.status === 'CONVERTED' ? 1 : 0);
    assert.equal(logs.filter(l => l.action === 'RESERVATION_EXPIRED').length, r.status === 'EXPIRED' ? 1 : 0);
  }
  for (const user of f.attendees) {
    const total = tickets.filter(t => ['RESERVED', 'SOLD'].includes(t.status) && (t.userId === user.id || reservations.find(r => r.id === t.reservationId)?.userId === user.id));
    assert.ok(total.length <= 2, 'per-user ticket limit');
    assert.ok(reservations.filter(r => r.userId === user.id && r.status === 'ACTIVE').length <= 1);
  }
}
afterEach(async () => {
  hook = undefined;
  const failures: unknown[] = [];
  for (const f of owned.splice(0)) {
    try { await invariant(f); } catch (error) { failures.push(error); }
    try { await cleanup(f); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Invariant or fixture cleanup failed');
});

// Middleware coordination is test-only. Production services have no delay/failure hooks.
function pauseFirstEventLock() {
  const entered = deferred(); const release = deferred(); const contended = deferred(); let first = true; let attempts = 0;
  hook = async (params, next) => {
    const eventLock = params.action === 'queryRaw' && JSON.stringify(params.args).includes('SELECT id, capacity, status');
    if (eventLock && ++attempts === 2) contended.resolve();
    const result = await next(params);
    if (first && eventLock) {
      first = false; entered.resolve(); await release.promise;
    }
    return result;
  };
  return { entered: entered.promise, contended: contended.promise, release: () => release.resolve() };
}

test('A: repeated last-ticket competition: exactly one allocation', { timeout: 60000 }, async t => {
  const iterations = Number(process.env.CONCURRENCY_ITERATIONS || 20);
  assert.ok(Number.isInteger(iterations) && iterations >= 1 && iterations <= 100);
  for (let i = 0; i < iterations; i++) {
    const f = await make(1);
    const responses = await Promise.all([reserve(f, 0), reserve(f, 1)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    assert.equal(await prisma.ticket.count({ where: { eventId: f.event.id } }), 1);
    await invariant(f);
  }
  t.diagnostic(`${iterations} iterations; each final state: capacity=1, reserved=1, active reservations=1`);
});

test('B: 30+ attendees compete at concurrency 10, 30 and 50', { timeout: 60000 }, async t => {
  for (const concurrency of [10, 30, 50]) {
    for (let round = 0; round < 2; round++) {
      const count = Math.max(30, concurrency); const f = await make(10, count);
      const responses = [];
      for (let offset = 0; offset < count; offset += concurrency) {
        responses.push(...await Promise.all(f.attendees.slice(offset, offset + concurrency).map((_, i) => reserve(f, offset + i))));
      }
      assert.equal(responses.filter(r => r.status === 201).length, 10);
      assert.ok(responses.every(r => [201, 409].includes(r.status)));
      assert.equal(await prisma.ticket.count({ where: { eventId: f.event.id, status: 'RESERVED' } }), 10);
      await invariant(f);
    }
  }
  t.diagnostic('6 rounds; 220 requests; each final state: capacity=10, reserved=10, availability=0');
});

test('C: duplicate requests and sold tickets preserve per-user limits', async t => {
  for (let round = 0; round < 5; round++) {
    const f = await make(10);
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve(f, 0, 2)));
    assert.equal(results.filter(r => r.status === 201).length, 1);
    assert.ok(results.every(r => [201, 400].includes(r.status)));
    const id = results.find(r => r.status === 201)!.body.id;
    assert.equal((await request(f.attendees[0], `/tickets/purchase/${id}`, {})).status, 200);
    assert.equal((await reserve(f, 0)).status, 400);
    await invariant(f);
  }
  t.diagnostic('5 rounds of 10 duplicates; final per user: 1 converted reservation, 2 sold tickets');
});

test('D: purchase-first and expiry-first ordering, duplicates, deadline after lock wait', { timeout: 30000 }, async t => {
  for (const order of ['purchase', 'expiry'] as const) {
    for (let round = 0; round < 5; round++) {
      const f = await make(1); const r = await createReservation(f.event.id, f.attendees[0].id, 1);
      const control = pauseFirstEventLock();
      const first = order === 'purchase'
        ? purchaseReservation(r.id, f.attendees[0].id)
        : expireReservation(r.id, f.event.id);
      // Attach rejection handling immediately; an expected rejection must not be unhandled.
      const firstOutcome = Promise.allSettled([first]);
      await control.entered;
      if (order === 'expiry') await prisma.reservation.update({ where: { id: r.id }, data: { expiresAt: new Date(0) } });
      const second = order === 'purchase' ? expireReservation(r.id, f.event.id) : purchaseReservation(r.id, f.attendees[0].id);
      const secondOutcome = Promise.allSettled([second]);
      await control.contended;
      control.release();
      await Promise.all([firstOutcome, secondOutcome]); hook = undefined;
      const row = await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } });
      assert.equal(row.status, order === 'purchase' ? 'CONVERTED' : 'EXPIRED');
      assert.equal((await request(f.attendees[0], `/tickets/purchase/${r.id}`, {})).status, order === 'purchase' ? 404 : 400);
      await invariant(f);
    }
  }
  // Purchase starts while valid, but lock acquisition occurs after its deadline.
  const f = await make(1); const r = await createReservation(f.event.id, f.attendees[0].id, 1);
  const holding = deferred(); const release = deferred(); const attempted = deferred();
  const holder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${f.event.id} FOR UPDATE`;
    holding.resolve(); await release.promise;
    await tx.reservation.update({ where: { id: r.id }, data: { expiresAt: new Date(0) } });
  });
  await holding.promise;
  hook = async (params, next) => {
    if (params.action === 'queryRaw' && JSON.stringify(params.args).includes('SELECT id, capacity, status')) attempted.resolve();
    return next(params);
  };
  const purchase = request(f.attendees[0], `/tickets/purchase/${r.id}`, {});
  await attempted.promise; release.resolve(); await holder;
  assert.equal((await purchase).status, 400); hook = undefined;
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status, 'EXPIRED');
  t.diagnostic('10 ordered races + 1 deadline crossing; final tickets agree with CONVERTED/SOLD or EXPIRED/EXPIRED');
});

test('E: capacity reduction versus reservation, both lock orders', { timeout: 30000 }, async t => {
  for (const order of ['capacity', 'reservation'] as const) {
    for (let round = 0; round < 5; round++) {
      const f = await make(10, 5);
      for (let i = 0; i < 4; i++) await createReservation(f.event.id, f.attendees[i].id, 2);
      const control = pauseFirstEventLock();
      const capacity = () => request(f.admin, `/admin/events/${f.event.id}/capacity`, { capacity: 8 }, 'PATCH');
      const first = order === 'capacity' ? capacity() : reserve(f, 4, 2);
      await control.entered;
      const second = order === 'capacity' ? reserve(f, 4, 2) : capacity();
      await control.contended;
      control.release(); const [a, b] = await Promise.all([first, second]); hook = undefined;
      assert.equal(a.status, order === 'capacity' ? 200 : 201);
      assert.equal(b.status, order === 'capacity' ? 409 : 400);
      const event = await prisma.event.findUniqueOrThrow({ where: { id: f.event.id } });
      assert.equal(event.capacity, order === 'capacity' ? 8 : 10); await invariant(f);
    }
  }
  t.diagnostic('10 races; final capacity/occupied = 8/8 or 10/10, never 8/10');
});

test('F: expiry workers versus new reservation, both lock orders', async t => {
  for (const order of ['expiry', 'reservation'] as const) {
    for (let round = 0; round < 5; round++) {
      const f = await make(1); const old = await createReservation(f.event.id, f.attendees[0].id, 1);
      await prisma.reservation.update({ where: { id: old.id }, data: { expiresAt: new Date(0) } });
      const control = pauseFirstEventLock();
      const first = order === 'expiry' ? expireReservation(old.id, f.event.id) : reserve(f, 1);
      await control.entered;
      const second = order === 'expiry' ? reserve(f, 1) : expireReservation(old.id, f.event.id);
      await control.contended;
      control.release(); await Promise.all([first, second]); hook = undefined;
      const repeated = await Promise.all([expireReservations(), expireReservations()]);
      assert.deepEqual(repeated, [0, 0]);
      if (order === 'reservation') assert.equal((await reserve(f, 1)).status, 201);
      assert.equal(await prisma.ticket.count({ where: { eventId: f.event.id, status: 'RESERVED' } }), 1);
      await invariant(f);
    }
  }
  t.diagnostic('10 races; old ticket expired, exactly one new reserved ticket; duplicate workers no-op');
});

test('concurrent expiry scans process the same candidate exactly once and retry failed candidates', async () => {
  const f = await make(1); const r = await createReservation(f.event.id, f.attendees[0].id, 1);
  await prisma.reservation.update({ where: { id: r.id }, data: { expiresAt: new Date(0) } });
  hook = async (params, next) => {
    if (params.model === 'AuditLog' && params.action === 'create') throw new Error('CONTROLLED_JOB_FAILURE');
    return next(params);
  };
  assert.equal(await expireReservations(), 0); hook = undefined;
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status, 'ACTIVE');
  const counts = await Promise.all([expireReservations(), expireReservations()]);
  assert.equal(counts.reduce((a, b) => a + b, 0), 1);
  assert.equal(await prisma.auditLog.count({ where: { entityId: r.id, action: 'RESERVATION_EXPIRED' } }), 1);
});

test('G: injected audit failures roll back creation, conversion, expiry and capacity', async t => {
  const f = await make(2);
  const fail = (action: string) => { hook = async (params, next) => {
    if (params.model === 'AuditLog' && params.action === 'create' && params.args.data.action === action) throw new Error('CONTROLLED_TEST_FAILURE');
    return next(params);
  }; };
  fail('RESERVATION_CREATED');
  const failed = await reserve(f, 0);
  assert.equal(failed.status, 500); assert.deepEqual(failed.body, { error: 'Internal Server Error' }); hook = undefined;
  assert.equal(await prisma.reservation.count({ where: { eventId: f.event.id } }), 0);
  assert.equal(await prisma.ticket.count({ where: { eventId: f.event.id } }), 0);
  const r = await createReservation(f.event.id, f.attendees[0].id, 1);
  fail('PURCHASE');
  assert.equal((await request(f.attendees[0], `/tickets/purchase/${r.id}`, {})).status, 500); hook = undefined;
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status, 'ACTIVE');
  assert.equal(await prisma.ticket.count({ where: { reservationId: r.id, status: 'RESERVED', userId: null } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { entityId: r.id, action: 'PURCHASE' } }), 0);
  fail('EVENT_CAPACITY_OVERRIDE');
  assert.equal((await request(f.admin, `/admin/events/${f.event.id}/capacity`, { capacity: 1 }, 'PATCH')).status, 500); hook = undefined;
  assert.equal((await prisma.event.findUniqueOrThrow({ where: { id: f.event.id } })).capacity, 2);
  await prisma.reservation.update({ where: { id: r.id }, data: { expiresAt: new Date(0) } });
  fail('RESERVATION_EXPIRED');
  await assert.rejects(expireReservation(r.id, f.event.id), /CONTROLLED_TEST_FAILURE/); hook = undefined;
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status, 'ACTIVE');
  await expireReservation(r.id, f.event.id);
  t.diagnostic('4 failure points; no partial writes or misleading audit entries; subsequent expiry succeeds');
});

test('H: bounded lock timeout, real PostgreSQL deadlock retry, transaction timeout', { timeout: 30000 }, async t => {
  const f = await make(2); const held = deferred(); const release = deferred();
  const holder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${f.event.id} FOR UPDATE`;
    held.resolve(); await release.promise;
  }, { timeout: 8000 });
  await held.promise;
  try {
    const response = await reserve(f, 0);
    assert.equal(response.status, 503); assert.equal(response.body.error, 'Database is busy. Please try again.');
  } finally { release.resolve(); await holder; }
  assert.equal((await reserve(f, 0)).status, 201);

  // Deliberately reverse order in TEST transactions, to exercise actual SQLSTATE 40P01/P2034.
  const other = await make(2); const left = deferred(); const right = deferred(); let attempts = 0;
  const work = (a: string, b: string, own: { resolve: () => void }, peer: { promise: Promise<void> }) => {
    let first = true;
    return bookingTransaction(async tx => {
      attempts++;
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${a} FOR UPDATE`;
      if (first) { first = false; own.resolve(); await peer.promise; }
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${b} FOR UPDATE`;
    });
  };
  await Promise.all([work(f.event.id, other.event.id, left, right), work(other.event.id, f.event.id, right, left)]);
  assert.ok(attempts >= 3 && attempts <= 4);
  const timeoutClient = new PrismaClient();
  try {
    await assert.rejects(timeoutClient.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_sleep(0.08)`;
      await tx.event.count();
    }, { timeout: 20 }), e => databaseBusy(e));
  } finally { await timeoutClient.$disconnect(); }
  t.diagnostic(`lock wait returned HTTP 503; real deadlock resolved in ${attempts} attempts; interactive timeout classified as busy`);
});

test('related writers: duplicate refunds, cancellation versus purchase, unrelated event proceeds', async t => {
  const f = await make(2); const r = await createReservation(f.event.id, f.attendees[0].id, 1);
  const sold = await purchaseReservation(r.id, f.attendees[0].id);
  const refunds = await Promise.all([0, 1].map(() => request(f.admin, `/admin/tickets/${sold[0].id}/refund`, {})));
  assert.deepEqual(refunds.map(r => r.status).sort(), [200, 400]);
  assert.equal(await prisma.auditLog.count({ where: { entityId: sold[0].id, action: 'TICKET_REFUNDED' } }), 1);
  const next = await createReservation(f.event.id, f.attendees[1].id, 1);
  const control = pauseFirstEventLock();
  const cancel = request(f.admin, `/admin/events/${f.event.id}/cancel`, {});
  await control.entered;
  const purchase = request(f.attendees[1], `/tickets/purchase/${next.id}`, {});
  // No global mutex: a different event can complete while this event is locked.
  const independent = await make(1);
  assert.equal((await reserve(independent, 0)).status, 201);
  control.release();
  assert.equal((await cancel).status, 200); assert.equal((await purchase).status, 404); hook = undefined;
  assert.equal(await prisma.ticket.count({ where: { eventId: f.event.id } }), 0);
  t.diagnostic('one refund/audit, cancellation removes bookings atomically, unrelated event remains independent');
});

test('database guards reject invalid quantities, ownerless sold tickets and duplicate active reservations', async () => {
  const f = await make(2); const r = await createReservation(f.event.id, f.attendees[0].id, 1);
  await assert.rejects(prisma.reservation.create({ data: { eventId: f.event.id, userId: f.attendees[0].id, quantity: 1, expiresAt: new Date() } }), { code: 'P2002' });
  await assert.rejects(prisma.reservation.update({ where: { id: r.id }, data: { quantity: 3 } }));
  await assert.rejects(prisma.ticket.updateMany({ where: { reservationId: r.id }, data: { status: 'SOLD' } }));
});

test('availability reads keep capacity and occupancy in one snapshot during writes', async () => {
  const f = await make(1); const entered = deferred(); const release = deferred(); let first = true;
  hook = async (params, next) => {
    const result = await next(params);
    if (first && params.model === 'Event' && params.action === 'findUnique') {
      first = false; entered.resolve(); await release.promise;
    }
    return result;
  };
  const read = request(f.attendees[0], `/events/${f.event.id}`, undefined, 'GET');
  await entered.promise;
  await changeEventCapacity(f.event.id, 2, f.admin.id);
  await createReservation(f.event.id, f.attendees[0].id, 2);
  release.resolve(); const result = await read; hook = undefined;
  assert.equal(result.status, 200);
  assert.equal(result.body.capacity, 1); assert.equal(result.body.taken, 0); assert.equal(result.body.available, 1);
  const current = await request(f.attendees[0], `/events/${f.event.id}`, undefined, 'GET');
  assert.equal(current.body.capacity, 2); assert.equal(current.body.taken, 2); assert.equal(current.body.available, 0);
  for (const path of ['/events', '/reservations/my', '/admin/events']) {
    assert.equal((await request(f.admin, path, undefined, 'GET')).status, 200);
  }
});

test('API preserves authentication, role, quantity and reservation ownership checks', async () => {
  const f = await make(2);
  assert.equal((await fetch(base + '/reservations', { method: 'POST' })).status, 401);
  assert.equal((await request(f.artist, '/reservations', { eventId: f.event.id, quantity: 1 })).status, 403);
  for (const quantity of [0, 3, 1.5]) assert.equal((await reserve(f, 0, quantity)).status, 400);
  const r = await createReservation(f.event.id, f.attendees[0].id, 1);
  assert.equal((await request(f.attendees[1], `/tickets/purchase/${r.id}`, {})).status, 404);
  assert.equal((await request(f.attendees[0], `/admin/events/${f.event.id}/capacity`, { capacity: 1 }, 'PATCH')).status, 403);
  await prisma.user.update({ where: { id: f.attendees[1].id }, data: { emailVerifiedAt: null } });
  const unverified = await reserve(f, 1);
  assert.equal(unverified.status, 403); assert.equal(unverified.body.code, 'VERIFICATION_REQUIRED');
});
