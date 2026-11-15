import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Never fall back to DATABASE_URL or load the application's .env into process.env.
const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error('Set TEST_DATABASE_URL to a dedicated eventora_test_* PostgreSQL database.');
const url = new URL(raw);
const database = decodeURIComponent(url.pathname.slice(1));
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^eventora_test_[a-z0-9_]+$/.test(database)) {
  throw new Error('Refusing tests: database name must match eventora_test_[a-z0-9_]+.');
}
if (url.searchParams.has('options') || url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public') {
  throw new Error('Use a dedicated database, not search-path/schema isolation.');
}
const identity = (value) => {
  const u = new URL(value);
  return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
};
let developmentUrl;
try { developmentUrl = dotenv.parse(readFileSync('.env')).DATABASE_URL; } catch {}
if ([process.env.DATABASE_URL, developmentUrl].some(value => value && identity(value) === identity(raw))) {
  throw new Error('Refusing tests against the configured application database.');
}
const db = new PrismaClient({ datasources: { db: { url: raw } } });
try {
  const [row] = await db.$queryRaw`SELECT current_database() AS name, current_schema() AS schema,
    shobj_description(oid, 'pg_database') AS purpose FROM pg_database WHERE datname = current_database()`;
  if (row.name !== database || row.schema !== 'public' || row.purpose !== 'eventora isolated integration tests') {
    throw new Error('Database identity/purpose check failed. Mark only a newly created dedicated test database.');
  }
  console.log(`Verified isolated database: ${database}`);
} finally { await db.$disconnect(); }
const env = { ...process.env, DATABASE_URL: raw, EVENTORA_TEST_DATABASE_VERIFIED: database, NODE_ENV: 'test' };
function run(args) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit', timeout: 120000 });
  if (result.status !== 0) process.exit(result.status || 1);
}
run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
run(['--import', 'tsx', '--test', '--test-concurrency=1', 'tests/concurrency.test.ts']);
