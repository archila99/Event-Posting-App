import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('integration runner refuses absent or non-test targets before connecting', () => {
  for (const value of ['', 'postgresql://unused@127.0.0.1/application', 'postgresql://unused@127.0.0.1/eventora_test_safe?schema=other']) {
    const result = spawnSync(process.execPath, ['scripts/run-db-tests.mjs'], {
      env: { ...process.env, TEST_DATABASE_URL: value }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Set TEST_DATABASE_URL|Refusing tests|dedicated database/);
    assert.doesNotMatch(result.stderr, /Can't reach database|Authentication failed/);
  }
});
