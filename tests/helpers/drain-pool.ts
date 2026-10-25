import type { Pool, PoolClient } from 'pg';

// pg-pool removes clients from its list before client.end() finishes. Therefore
// pool.end() alone is not a socket-close barrier: stopping PostgreSQL immediately
// afterward can terminate connections which are still completing their shutdown.
export function trackPoolShutdown(pool: Pool) {
  const clients = new Map<PoolClient, Promise<void>>();
  const failures = new Set<Error>();
  const onError = (error: Error) => failures.add(error);
  const onConnect = (client: PoolClient) => {
    client.on('error', onError);
    clients.set(client, new Promise<void>((resolve) => client.once('end', resolve)));
  };
  pool.on('connect', onConnect);
  pool.on('error', onError);
  return async function closePool() {
    await pool.end();
    await Promise.all(clients.values());
    pool.off('connect', onConnect);
    pool.off('error', onError);
    for (const client of clients.keys()) client.off('error', onError);
    // Unexpected connection errors still fail the hook; they are never ignored.
    if (failures.size) throw new AggregateError(failures, 'PostgreSQL connection lifecycle failed');
  };
}
