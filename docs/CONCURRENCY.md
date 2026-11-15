# Eventora booking concurrency and reliability

## A. Initial findings

Investigation and implementation: 15 November 2026. No existing application database was migrated or cleaned. Tests used PostgreSQL 14.24 in a newly initialised cluster under `/private/tmp`, with separate marked databases. Node 22.21.0, Prisma 5.22.0, and the built-in Node test runner were used. No dependency was added.

Before production changes, a temporary harness called the original route handlers with actual Prisma/PostgreSQL queries and test-only middleware coordination. It reproduced these three bugs:

1. **Capacity race:** with capacity 10 and eight reserved tickets, the original admin handler counted eight and paused before its update. Another user reserved two tickets. The admin update then committed capacity 8: ten occupied tickets, availability −2.
2. **Audit atomicity:** failing the original reservation audit write caused the handler to reject, while one reservation and its ticket remained committed, without an audit entry.
3. **Expiry rollback:** a purchase started while valid and waited on a reservation lock. The test holder moved its deadline into the past before releasing the lock. Purchase returned an expiry error, but throwing inside the transaction rolled back its expiry updates: the reservation remained ACTIVE and its ticket RESERVED.

The baseline harness used the current Prisma schema on a fresh baseline test database because the original migration history did not reproduce that schema. The final suite instead applies the real migration history to a fresh database.

### Original operation inventory

| Operation | Original file/handler | Rows read | Rows written | Transaction | Explicit lock | Risk |
|---|---|---|---|---|---|---|
| Reserve | `routes/reservations.ts`, POST `/` | User, Event, ACTIVE reservations, RESERVED/SOLD ticket counts | Reservation with expiry, RESERVED tickets; separate AuditLog | Booking writes only | Event FOR UPDATE | Admin capacity race; audit failure after commit; deadline computed before lock wait |
| Purchase | `routes/tickets.ts`, POST `/purchase/:reservationId` | User, reservation, tickets, optional verification code | Reservation CONVERTED, tickets SOLD with owner/time, verification deletion; separate AuditLog | State writes | Reservation FOR UPDATE | Throw rolls back intended expiry; cancellation uses opposite child-row order |
| Purchase detects expiry | Same handler | Reservation/deadline | Reservation EXPIRED, tickets EXPIRED | Yes | Reservation FOR UPDATE | One branch commits, another throws and rolls back; no expiry audit in those branches |
| Expiry scan | `jobs/expireReservations.ts`, `expireReservations` | ACTIVE overdue reservations | Each reservation/tickets EXPIRED; separate AuditLog | Per candidate | Reservation FOR UPDATE | Audit failure after commit; overlapping interval callbacks; unbounded scan |
| Capacity adjustment | `routes/admin.ts`, PATCH capacity | Event, Location, RESERVED/SOLD count | Event.capacity, separate AuditLog | No shared transaction | None before validation | Confirmed capacity below occupancy |
| Refund | `routes/admin.ts`, POST refund | SOLD ticket, event/user metadata | Ticket REFUNDED, separate AuditLog | No | None before validation | Both requests can pass SOLD check and emit duplicate audits |
| Cancellation | `routes/admin.ts`, POST cancel | Event, attendees, reservations | Deletes verification codes, tickets, reservations, comments, event; separate AuditLog | Deletions only | Implicit locks while deleting | Ticket-first versus purchase's reservation-first locking can deadlock; concurrent inserts can disrupt deletion |
| Public availability | `routes/events.ts`, GET list/detail | Event capacity, separate ticket count | None | No | None | Mixed snapshots can produce misleading/negative displayed availability |
| Admin availability | `routes/admin.ts`, GET events | Event capacities and ticket counts | None | No | None | Same mixed-snapshot risk |
| My reservations | `routes/reservations.ts`, GET my/detail | Reservations, events, ticket counts/details | None | No | None | List availability mixes snapshots; detail is informational |
| My tickets / admin purchases | `routes/tickets.ts` GET my; `routes/admin.ts` GET purchases | SOLD ticket ownership/status | None | No | None | Informational reads can become stale |
| Purchase verification | `routes/tickets.ts`, POST send-verification-code | User, owned ACTIVE reservation and deadline | VerificationCode upsert | No | None | Legacy unverified branch is unreachable behind verified-email middleware |
| Create event | `routes/events.ts` POST; `services/eventValidation.ts` | Venue maximum/activity, time slot, scheduling conflicts | New Event.capacity/status, separate AuditLog | No combined validation/write | None | Artist scheduling check can race; venue limit can change after validation |
| Edit venue | `routes/locations.ts` PATCH | Validated request | Location.maxCapacity/activity, separate AuditLog | No combined audit | Implicit update lock | Can reduce venue maximum below existing event capacities; separate policy issue |
| Auth / deactivation | `routes/auth.ts`, `routes/admin.ts` | User and refresh session | Refresh records or User.deletedAt | Rotation has its own transaction | RefreshToken FOR UPDATE | Independent from event inventory; stale access-token authorisation remains a separate concern |

Original lock order was not universal: reservation creation locked Event, purchase/expiry locked Reservation then Ticket, while cancellation deleted Ticket before Reservation and eventually Event. No explicit transaction isolation was selected. The new service selects READ COMMITTED explicitly.

## B. Changes made

- [`bookingService.ts`](../backend/src/services/bookingService.ts) holds the six related state-changing workflows: create, purchase, expire, capacity change, refund, and cancellation. HTTP validation and role checks remain in routes; the service repeats critical attendee/ownership/state checks where relevant.
- [`bookingTransaction.ts`](../backend/src/lib/bookingTransaction.ts) provides parameterised event locks, a database wall-clock read, bounded transaction settings, business errors, and narrowly classified retries.
- [`audit.ts`](../backend/src/lib/audit.ts) accepts a transaction client. All six booking workflows write audits inside their business transaction. Other unrelated audit callers retain the existing default client.
- [`expireReservations.ts`](../backend/src/jobs/expireReservations.ts) exports a callable scan, processes at most 200 candidates, isolates candidate failures, prevents overlapping interval callbacks in one process, and returns a stop function. Multiple instances remain safe through database locking and state rechecks.
- Booking routes delegate to the service. Every async route callback uses [`asyncHandler.ts`](../backend/src/lib/asyncHandler.ts), so Express 4 forwards rejected promises to its error middleware.
- [`app.ts`](../backend/src/app.ts) maps business errors to existing 4xx responses, contention/timeouts to 503 plus Retry-After, and unexpected failures to a generic 500. Internal error text is no longer returned to clients.
- Public event list/detail, admin event list, and my-reservation availability use REPEATABLE READ transactions, keeping capacity and occupancy in one snapshot. These reads do not take inventory row locks.
- [`schema.prisma`](../backend/prisma/schema.prisma) and the new [`booking_integrity` migration](../backend/prisma/migrations/20261115120000_booking_integrity/migration.sql) add booking lookup indexes and database checks.
- [`run-db-tests.mjs`](../backend/scripts/run-db-tests.mjs), [`helpers.ts`](../backend/tests/helpers.ts), and [`concurrency.test.ts`](../backend/tests/concurrency.test.ts) provide guarded real-database tests. Standard safety tests require no database. Root and backend package scripts expose the checks.

### Migration effects and deployment review

The new migration does not drop business tables, booking rows, or legacy auth tables. It adds the missing OtpCode table/indexes if absent, adds VerificationCode.codeHash if absent, and makes the retained legacy `code` column nullable where present. Legacy plaintext purchase codes receive an invalid hash sentinel rather than being presented as valid password hashes. Those temporary legacy codes cannot subsequently verify.

Checks enforce positive event capacity, reservation quantity 1–2, known reservation/ticket statuses, and ownership plus purchase time for SOLD tickets. A partial unique index allows at most one ACTIVE reservation per event/user while retaining any number of historical reservations. Expiry and ticket-count lookup indexes support the service queries. Prisma 5 cannot express the partial index/check constraints in its schema; SQL migrations are their source of truth. Do not substitute `db push` for these migrations.

**Review before deployment:** the migration intentionally fails if legacy business rows violate checks or contain duplicate active reservations. It performs no automatic repair. Index creation and validation take locks and may need a staged deployment on a large database. It has only been applied to isolated test databases. Existing database baselining and migration history must be reviewed separately; do not blindly apply it to a database previously managed with `db push`.

Existing foreign keys prevent references to missing users/events/reservations. They do not enforce every cross-table invariant: ticket.eventId matching its reservation, aggregate occupancy, exact ticket count per reservation, and the aggregate per-user ticket limit still depend on the service protocol. Implementing database triggers for all aggregates would be a larger design change and was not introduced.

## C. Concurrency test results

Final result: **13/13 integration tests passed**, with CONCURRENCY_ITERATIONS=100; all A–H scenarios below passed. The safety test, backend/test TypeScript checks, full backend/frontend build, and git diff whitespace check passed too. The final integration run took approximately 5.3 seconds on this local setup; this is a test observation, not a production throughput benchmark. Tests inspect committed rows and audit histories, not just HTTP response codes. Test-only Prisma middleware pauses queries or injects failures; no coordination delays were added to production logic.

| Scenario | Iterations / cases | Expected committed result |
|---|---|---|
| A: two users, last ticket | 100 races / 200 requests | One 201, one 409, one ACTIVE reservation and RESERVED ticket per event |
| B: many users | Two rounds each at concurrency 10, 30, 50; 220 requests total | Exactly ten reserved tickets per event, capacity ten, availability zero |
| C: duplicate attendee requests | Five rounds of ten duplicates, then purchase and another reserve | One reservation per round, two SOLD tickets after purchase; additional booking rejected |
| D: purchase/expiry | Five races for each lock order, plus purchase deadline crossed during lock wait | Either CONVERTED/SOLD or EXPIRED/EXPIRED; expired purchases rejected; no duplicate audit |
| E: capacity/reserve | Five races for each lock order | Either capacity/occupied 8/8 or 10/10; never 8/10 |
| F: expiry/new reservation | Five races for each lock order | Old ticket EXPIRED, one new RESERVED ticket; reservation-first may need retry after expiry |
| G: controlled failure | Creation, purchase, capacity update, expiry audit failures | Whole business transaction rolls back; no false audit or partial ticket state |
| H: lock/deadlock/timeout | One held-lock HTTP test, one real two-transaction deadlock, one interactive timeout | 503 under bounded lock wait; deadlock resolves through three total attempts; timeout classified busy |

Additional checks cover duplicate refunds, cancellation versus purchase, progress on an unrelated event, overlapping expiry workers, retry after a failed expiry candidate, database constraints, snapshot availability during writes, and API authentication/role/ownership/quantity checks.

The final read-only cleanup check confirmed the dedicated database identity/purpose and found zero Event, Reservation, Ticket, and AuditLog rows, with zero oversold events. Each test's pre-cleanup assertions establish its business outcome; the empty post-cleanup database establishes fixture cleanup, not concurrency correctness by itself.

Invariant checks run before fixture cleanup: occupied <= capacity; reservation quantity matches ticket count; ACTIVE -> RESERVED, EXPIRED -> EXPIRED, CONVERTED -> SOLD or REFUNDED; sold tickets belong to the reservation owner; at most two occupied tickets per attendee/event; one ACTIVE reservation; exactly one appropriate creation/conversion/expiry audit. Refunds legitimately leave a CONVERTED reservation containing REFUNDED tickets.

An early test run passed A–C but timed out in D because a test-only barrier inspected the wrong Prisma argument shape. That harness issue was corrected before reporting complete suite results. k6 scripts were inspected but were not run: they target a separately started server and do not establish inventory invariants.

## D. Transaction and locking explanation

### Protocol

1. Begin a Prisma interactive transaction at READ COMMITTED.
2. Set a local PostgreSQL lock timeout of two seconds. Prisma waits at most five seconds to acquire a transaction connection; its interactive transaction timeout is ten seconds.
3. Lock the affected Event row using parameterised SELECT FOR UPDATE. Different events can proceed independently.
4. If existing reservations are affected, lock them after Event. Cancellation locks reservation IDs in sorted order. Ticket updates/deletions follow.
5. Re-read business state after acquiring locks. Candidate queries outside the transaction identify the event only; they do not authorise a state transition.
6. Validate limits and apply the related reservation/ticket/capacity writes.
7. Write the corresponding audit with the same transaction client.
8. Commit before returning success. Any unexpected failure rolls back the business writes and audit together.

Capacity adjustment also takes a shared Location lock after Event while checking the venue maximum. Current venue updates do not subsequently acquire event locks, so they do not introduce the reverse order. Future venue workflows must respect this order or redesign it consistently.

### Simultaneous reservations

For an event of capacity one, Alice and Bob both request one ticket. Alice locks the event; Bob waits. Alice counts zero occupied tickets, writes one reservation/ticket/audit, and commits. Bob then obtains the lock. READ COMMITTED gives Bob a fresh snapshot for the subsequent count, which sees Alice's ticket; Bob receives 409. Merely placing the count and insert in a transaction would not establish this order.

### Purchase and expiry

Both acquire Event then Reservation. The database's clock_timestamp() is checked after lock acquisition; transaction-start CURRENT_TIMESTAMP would be stale after a lock wait. If purchase obtains its turn while valid, it records purchasedAt from that clock, sells the tickets, converts the reservation, and commits its audit. A later expiry sees CONVERTED and does nothing.

If the locked check finds the deadline reached, purchase expires the hold and its tickets and writes an expiry audit. The callback returns an expired outcome, allowing commit. Only then does the service throw the HTTP-facing expiry error. A competing expiry worker either makes that transition first or subsequently sees EXPIRED and does nothing.

The purchase deadline applies at the authoritative locked decision. A transaction may finish committing or its response may arrive after that instant. Requiring response arrival or commit completion before a wall-clock deadline is a different rule and is not claimed here. Test-only coordination moves the persisted deadline to force a deterministic crossing; it does not wait for a ten-minute TTL.

### Retries, errors, and repeat processing

Only explicit aborted transactions (Prisma P2034, SQLSTATE 40P01/40001) are retried, at most twice after the first attempt. All work in these callbacks is database work, so rolled-back attempts do not send external side effects. Lock timeout, connection-pool timeout, and interactive transaction timeout produce a bounded 503 rather than blind retries. Ambiguous connection/commit failures are not retried automatically.

An expired reservation is processed at most once successfully because the locked status check stops later workers. A failed candidate remains ACTIVE and can be retried in a later scan. A restart immediately runs a scan; the database retains all pending deadlines. Expiry is idempotent in effect, but purchase/refund endpoints preserve their existing repeated-request errors rather than promising identical successful responses for retries.

## E. Remaining risks and production limits

- These are tests on one local PostgreSQL instance, not a proof for all schedules, PostgreSQL deployments, connection poolers, failovers, or traffic volumes. Independent transactions and multiple scan calls exercise worker competition; a multi-process deployment was not tested.
- All inventory writers must use this protocol. Direct SQL, Prisma Studio, or new code can bypass aggregate protections. No cross-row capacity CHECK is possible using a simple row CHECK.
- An overdue ACTIVE hold continues consuming capacity until expiry commits. The worker scans every minute and processes up to 200 candidates per scan; outages and backlog can increase release delay. New reservations conservatively count those tickets rather than oversell.
- One event is intentionally a serialisation point. Busy events can encounter the two-second lock timeout; production tuning needs measured workload and connection-pool limits. Pagination, aggregate query improvements, worker metrics, and backlog monitoring remain useful.
- Event creation's artist scheduling check and venue edits' policy for existing event capacity remain separate races/policy gaps. They were inventoried but not changed into a larger scheduling redesign.
- Other non-booking audit callers still write outside their business mutation. Email-verification preview, refresh/session security, and deactivated-account authorisation across all endpoints remain separate security topics.
- Cancellation continues deleting bookings and tickets, preserving current behaviour. Audit rows retain entity identifiers, but this is not an immutable financial order ledger. Payment processing is still absent.
- Migration preflight on actual legacy data, rolling deployment with old code, production lock duration, Docker builds, and failover/ambiguous commit recovery were not tested. A mixed deployment where old handlers ignore event locks does not inherit these guarantees.
- HTTP idempotency keys, payment outbox/inbox handling, and stronger ledger design would be needed if external payments were introduced. A queue is not required for the demonstrated local expiry workload.

## F. Safe rerun commands

From the repository root:

```bash
npm run typecheck
npm test
npm run build
```

Those commands do not connect to PostgreSQL. The build syncs existing shared image constants as before. `npm test` runs database-target refusal checks. The integration suite requires a dedicated database; never point it at the application database.

Example for a **new local test database** on a PostgreSQL instance you control:

```bash
createdb eventora_test_local
psql -d eventora_test_local -v ON_ERROR_STOP=1 \
  -c "COMMENT ON DATABASE eventora_test_local IS 'eventora isolated integration tests'"
export TEST_DATABASE_URL='postgresql://localhost:5432/eventora_test_local'
npm run test:integration
CONCURRENCY_ITERATIONS=100 npm run test:concurrency
```

Supply your local PostgreSQL user/connection details privately if your installation needs them. Do not reuse a pre-existing application database or mark one as a test database. The runner requires the name prefix, matching current_database(), public schema, and exact database-purpose marker, and rejects the configured application URL. It never loads application dotenv values into its process environment. It explicitly sets the verified test URL for child migration/test processes. Each child process has a 120-second bound.

Tests create UUID-owned fixtures, verify the database identity again before cleanup, and delete only those fixture rows in foreign-key order. No reset/drop/truncate or search-path-based schema isolation is used. A process killed mid-test can leave its owned fixtures behind; disposable database provisioning is preferable for CI. Migrations run only after the guard succeeds.

The verification run used a fresh cluster at `/private/tmp/eventora-pg.wua76Q`, port 55439, and database `eventora_test_verified`. It has no application credentials and is separate from your usual database. Its local test URL was `postgresql://eventora_test@127.0.0.1:55439/eventora_test_verified`. The temporary server was stopped after verification. To reuse it, while its temporary directory still exists:

```bash
pg_ctl -D /private/tmp/eventora-pg.wua76Q/data \
  -l /private/tmp/eventora-pg.wua76Q/server.log \
  -o '-h 127.0.0.1 -p 55439 -k /private/tmp/eventora-pg.wua76Q' start
export TEST_DATABASE_URL='postgresql://eventora_test@127.0.0.1:55439/eventora_test_verified'
CONCURRENCY_ITERATIONS=100 npm run test:concurrency
pg_ctl -D /private/tmp/eventora-pg.wua76Q/data stop -m fast
```

Stop/restart only that temporary cluster using its exact data directory. The complete final test log remains at `/private/tmp/eventora-pg.wua76Q/final-tests.log` while that directory exists.

## G. Interview learning summary

Five lessons from this work:

1. A transaction provides all-or-nothing changes; it does not automatically serialize a count-then-insert decision.
2. Every competing inventory writer must participate in the same locking protocol, including admin operations.
3. Throwing inside a transaction rolls back intentional writes too. An expected error can require committing a business outcome before returning an HTTP failure.
4. An audit that must describe a committed operation belongs in that operation's transaction.
5. Deterministic overlapping transactions, fault injection, and final-state assertions provide stronger evidence than response-only load tests.

### Concepts through Eventora

| Concept | Meaning and why Eventora needs it | Actual code and concrete example |
|---|---|---|
| Race condition | The result depends on how overlapping work is interleaved | Original admin capacity count saw eight before another request allocated two; the later capacity update wrote eight |
| Database transaction | A group of database changes committed together | `createReservation`: reservation, ticket rows, and audit all commit or all disappear |
| ACID | Atomicity, Consistency, Isolation, Durability | Booking writes are grouped; constraints and protocol enforce rules; locks/isolation coordinate transactions; PostgreSQL persists acknowledged commits according to its storage configuration. Crash durability was not tested here |
| Atomicity | All related changes happen, or none do | `purchaseReservation` cannot leave SOLD tickets after its injected audit failure; rollback restores RESERVED tickets and ACTIVE reservation |
| Row-level locking | Coordinate changes to particular rows rather than the whole database | `lockEvent` blocks another booking on the same event while a test confirms a different event still proceeds |
| SELECT FOR UPDATE | Read a row while taking an exclusive row lock for this transaction | `lockEvent` and `lockReservation`: the second caller waits, then checks the current committed state |
| Transaction isolation | Rules for what concurrent transactions can see | Booking uses READ COMMITTED plus Event locking so the waiting caller's subsequent count sees the winner; availability reads use REPEATABLE READ so capacity and counts share a snapshot |
| Deadlock | Two transactions each hold something the other needs | The H test intentionally locks event A then B and B then A. PostgreSQL aborts one attempt; `bookingTransaction` retries it. Production single-event writers use a consistent order |
| Rollback | Undo uncommitted changes after failure | Original purchase rolled back expiry by throwing. New purchase returns an expiry outcome, commits, then reports the error outside the transaction |
| Database constraints | Rules PostgreSQL rejects even when application checks are bypassed | The partial ACTIVE index rejects a duplicate event/user hold; quantity CHECK rejects three; SOLD-owner CHECK rejects a sale without an owner/time |
| Idempotency | Repeating an action has no additional effect | `expireReservation` sees EXPIRED/CONVERTED and returns false; duplicate workers produce one expiry audit. Repeated purchase still returns a state error rather than another sale |

### A truthful 60–90 second interview explanation

Use this after reviewing and understanding the changes. It attributes the implementation accurately:

> One backend problem in Eventora is keeping ticket inventory consistent when reservations, purchases, expiry, and admin changes overlap. The original reservation handler already locked the event, but the admin capacity handler did not follow that protocol. During an AI-assisted investigation, we reproduced a case where capacity became eight while ten tickets were occupied. We also reproduced a failed audit after a committed reservation and an expiry update that was accidentally rolled back.
>
> The resulting implementation uses a shared event-first locking protocol for booking changes and puts each booking audit inside the same transaction. Purchase checks the database clock after taking its locks. If the reservation is expired, it commits the expiry state before returning an error, so the error does not undo the intended update.
>
> The changes were validated with real PostgreSQL integration tests, including a hundred last-ticket races, duplicate requests, purchase versus expiry, capacity changes, rollback injection, and a real deadlock. I am studying the implementation and tests so I can explain the reasoning myself. The key lesson is that a transaction alone is not enough: all competing operations need compatible locks and final-state tests.

Do not present autonomous code changes as your unaided implementation. Describe which investigation, review, testing, or follow-up work you personally performed.
