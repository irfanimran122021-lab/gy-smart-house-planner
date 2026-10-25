import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Pool } from 'pg';
import { trackPoolShutdown } from './helpers/drain-pool.ts';

test('database lifecycle: pool bookkeeping completes before sockets, but shutdown waits for every end', async () => {
  const pool = new EventEmitter() as EventEmitter & { end: () => Promise<void> };
  let poolEnded = false;
  pool.end = async () => {
    poolEnded = true;
  };
  const close = trackPoolShutdown(pool as unknown as Pool);
  const first = new EventEmitter(),
    second = new EventEmitter();
  pool.emit('connect', first);
  pool.emit('connect', second);
  let finished = false;
  const closing = close().then(() => {
    finished = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(poolEnded, true);
  assert.equal(finished, false, 'pool.end() is not enough to stop the server');
  first.emit('end');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(finished, false, 'all connections must finish, including concurrent clients');
  second.emit('end');
  await closing;
  assert.equal(finished, true);
  assert.equal(pool.listenerCount('connect'), 0);
  assert.equal(first.listenerCount('error'), 0);
});

test('database lifecycle: unexpected client/pool errors fail teardown after connections close', async () => {
  const pool = new EventEmitter() as EventEmitter & { end: () => Promise<void> };
  pool.end = async () => {};
  const close = trackPoolShutdown(pool as unknown as Pool);
  const client = new EventEmitter();
  pool.emit('connect', client);
  const failure = new Error('unexpected database connection failure');
  client.emit('error', failure);
  pool.emit('error', failure);
  const closing = close();
  const rejected = assert.rejects(
    closing,
    (error: unknown) =>
      error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === failure,
  );
  client.emit('end');
  await rejected;
});
