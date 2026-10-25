import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import LocalPostgres from './helpers/local-postgres.ts';
import { trackPoolShutdown } from './helpers/drain-pool.ts';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';

// Never accept DATABASE_URL/Supabase credentials: this suite ALWAYS creates its
// own cluster bound to loopback, with a fresh random password and test directory.
const root = resolve('tmp/database-tests');
let directory: string;
let server: LocalPostgres;
let pool: Pool;
let closePool: (() => Promise<void>) | undefined;
const logs: string[] = [];
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const projectA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const projectB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const referenceA = `${a}/${projectA}/sketch.png`;
const referenceB = `${b}/${projectB}/survey.pdf`;
let migration: string;

async function user<T>(
  id: string | null,
  operation: (db: PoolClient) => Promise<T>,
  role = 'authenticated',
) {
  assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query(`set local role ${role}`);
    await db.query("select pg_catalog.set_config('request.jwt.claim.sub',$1,true)", [id || '']);
    const result = await operation(db);
    await db.query('commit');
    return result;
  } catch (error) {
    await db.query('rollback');
    throw error;
  } finally {
    db.release();
  }
}
const denied = (fn: () => Promise<unknown>) =>
  assert.rejects(
    fn,
    (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === '42501',
  );
const foreignKeyDenied = (fn: () => Promise<unknown>) =>
  assert.rejects(
    fn,
    (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === '23503',
  );
async function consume(id: string) {
  return user(
    id,
    async (db) =>
      (await db.query('select public.consume_ai_request() as allowed')).rows[0].allowed as boolean,
  );
}

async function finishConcurrent<T>(operations: Promise<T>[]) {
  // Even if one query fails, await every sibling transaction/release before the
  // test rejects and the after hook starts shutting down the cluster.
  const settled = await Promise.allSettled(operations);
  const failures = settled.filter((r) => r.status === 'rejected');
  if (failures.length)
    throw new AggregateError(
      failures.map((r) => r.reason),
      'Concurrent database operations failed',
    );
  return settled.map((r) => (r as PromiseFulfilledResult<T>).value);
}

async function atomicSave(
  owner: string,
  id: string,
  version: string | null,
  name = 'Cloud project',
  claimedOwner = owner,
) {
  return user(
    owner,
    async (db) =>
      (
        await db.query(
          'select saved_updated_at::text as version from public.save_project($1,$2,$3,$4,$5)',
          [id, claimedOwner, name, { id, name }, version],
        )
      ).rows[0].version as string,
  );
}

test('database: atomic cloud save creates a project and revision visible on a second connection', async () => {
  const id = randomUUID();
  const version = await atomicSave(a, id, null);
  assert.ok(version);
  const loaded = await user(a, (db) =>
    db.query('select model from public.projects where id=$1', [id]),
  );
  assert.equal(loaded.rows[0].model.name, 'Cloud project');
  const next = await atomicSave(a, id, version, 'Updated from second device');
  assert.notEqual(next, version);
  assert.equal(
    (
      await user(a, (db) =>
        db.query('select * from public.project_revisions where project_id=$1', [id]),
      )
    ).rowCount,
    2,
  );
  assert.equal(
    (await user(b, (db) => db.query('select * from public.projects where id=$1', [id]))).rowCount,
    0,
  );
});

test('database: two devices saving the same version produce one winner without extra revisions', async () => {
  const id = randomUUID(),
    version = await atomicSave(a, id, null);
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) => atomicSave(a, id, version, 'Device ' + i)),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const result of results)
    if (result.status === 'rejected') assert.equal(result.reason.code, '40001');
  assert.equal(
    (await pool.query('select * from public.project_revisions where project_id=$1', [id])).rowCount,
    2,
  );
});

test('database: first saves cannot overwrite a UUID and owner changes are rejected', async () => {
  const id = randomUUID(),
    version = await atomicSave(a, id, null);
  await assert.rejects(() => atomicSave(a, id, null, 'Overwrite'), { code: '40001' });
  await assert.rejects(() => atomicSave(b, id, version, 'Other owner'), { code: '40001' });
  await denied(() => atomicSave(b, randomUUID(), null, 'Spoof', a));
  await denied(() =>
    user(
      null,
      (db) =>
        db.query('select public.save_project($1,$2,$3,$4,null)', [randomUUID(), a, 'Anon', {}]),
      'anon',
    ),
  );
  const fn = (
    await pool.query(
      "select prosecdef,proconfig from pg_proc where oid='public.save_project(uuid,uuid,text,jsonb,timestamptz)'::regprocedure",
    )
  ).rows[0];
  assert.equal(fn.prosecdef, false);
  assert.ok(fn.proconfig.includes('search_path=""'));
});

test('database: failed revision writes roll back the project and version receipt', async () => {
  const id = randomUUID(),
    version = await atomicSave(a, id, null);
  await pool.query(
    "create function public.test_revision_failure() returns trigger language plpgsql as $$ begin raise exception 'test revision failure'; end $$",
  );
  await pool.query(
    'create trigger test_revision_failure before insert on public.project_revisions for each row execute function public.test_revision_failure()',
  );
  try {
    await assert.rejects(
      () => atomicSave(a, id, version, 'Must roll back'),
      /test revision failure/,
    );
  } finally {
    await pool.query('drop trigger test_revision_failure on public.project_revisions');
    await pool.query('drop function public.test_revision_failure()');
  }
  const row = (
    await pool.query('select name,updated_at::text as version from public.projects where id=$1', [
      id,
    ])
  ).rows[0];
  assert.equal(row.name, 'Cloud project');
  assert.equal(row.version, version);
});

before(
  async () => {
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(resolve(root, 'pg-'));
    assert.ok(resolve(directory).startsWith(root + sep));
    const port = await new Promise<number>((done, reject) => {
      const reservation = createServer();
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', () => {
        const address = reservation.address();
        if (!address || typeof address === 'string') throw Error('No local test port');
        reservation.close(() => done(address.port));
      });
    });
    const password = randomUUID();
    server = new LocalPostgres({
      databaseDir: directory,
      port,
      user: 'postgres',
      password,
      onLog: (message) => {
        logs.push(message);
      },
    });
    try {
      await server.initialise();
      await server.start();
      pool = new Pool({
        host: '127.0.0.1',
        port,
        user: 'postgres',
        password,
        database: 'postgres',
        max: 40,
        connectionTimeoutMillis: 10000,
      });
      closePool = trackPoolShutdown(pool);
      await pool.query(await readFile(new URL('./fixtures/supabase.sql', import.meta.url), 'utf8'));
      migration = await readFile(
        new URL('../supabase/migrations/001_initial.sql', import.meta.url),
        'utf8',
      );
      await pool.query(migration);
      await pool.query(
        await readFile(
          new URL('../supabase/migrations/002_cloud_saving.sql', import.meta.url),
          'utf8',
        ),
      );
      await pool.query('insert into auth.users(id) values($1),($2)', [a, b]);
      await user(a, (db) =>
        db.query('insert into public.projects(id,owner_id,name,model) values($1,$2,$3,$4)', [
          projectA,
          a,
          'Project A',
          {},
        ]),
      );
      await user(b, (db) =>
        db.query('insert into public.projects(id,owner_id,name,model) values($1,$2,$3,$4)', [
          projectB,
          b,
          'Project B',
          {},
        ]),
      );
    } catch (error) {
      console.error(logs.slice(-8).join('\n'));
      throw error;
    }
  },
  { timeout: 60000 },
);

after(async () => {
  // Do not stop the server until every driver connection emitted its end event.
  const failures: unknown[] = [];
  try {
    await closePool?.();
  } catch (error) {
    failures.push(error);
  }
  try {
    if (server) await server.stop();
  } catch (error) {
    // Keep the directory for diagnosis if the process could not stop safely.
    throw new AggregateError([...failures, error], 'Database teardown failed');
  }
  // Verify the exact absolute target before recursive cleanup. No external DB
  // or user directory is ever accepted by this test runner.
  if (directory) {
    assert.ok(resolve(directory).startsWith(root + sep));
    assert.ok(/^pg-[\w-]+$/.test(directory.split(sep).at(-1)!));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  if (failures.length) throw new AggregateError(failures, 'Database connection teardown failed');
});

test('database: fresh migration configures private bucket and least-privilege grants', async () => {
  const bucket = (await pool.query("select * from storage.buckets where id='references'")).rows[0];
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 3145728);
  assert.deepEqual(bucket.allowed_mime_types, [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ]);
  for (const table of ['projects', 'project_revisions', 'ai_usage']) {
    assert.equal(
      (
        await pool.query('select relrowsecurity from pg_catalog.pg_class where oid=$1::regclass', [
          `public.${table}`,
        ])
      ).rows[0].relrowsecurity,
      true,
    );
    assert.equal(
      (
        await pool.query("select has_table_privilege('anon',$1,'SELECT') as allowed", [
          `public.${table}`,
        ])
      ).rows[0].allowed,
      false,
    );
  }
  for (const privilege of ['SELECT', 'INSERT'])
    assert.equal(
      (
        await pool.query(
          "select has_table_privilege('authenticated','public.project_revisions',$1) as allowed",
          [privilege],
        )
      ).rows[0].allowed,
      true,
    );
  for (const privilege of ['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
    assert.equal(
      (
        await pool.query(
          "select has_table_privilege('authenticated','public.project_revisions',$1) as allowed",
          [privilege],
        )
      ).rows[0].allowed,
      false,
    );
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
    assert.equal(
      (
        await pool.query(
          "select has_table_privilege('authenticated','public.ai_usage',$1) as allowed",
          [privilege],
        )
      ).rows[0].allowed,
      false,
    );
});

test('database: owner cloud upsert works and foreign project access is denied', async () => {
  await user(a, (db) =>
    db.query(
      'insert into public.projects(id,owner_id,name,model) values($1,$2,$3,$4) on conflict(id) do update set owner_id=excluded.owner_id,name=excluded.name,model=excluded.model',
      [projectA, a, 'Saved A', { revision: 2 }],
    ),
  );
  assert.equal(
    (await user(a, (db) => db.query('select name from public.projects where id=$1', [projectA])))
      .rows[0].name,
    'Saved A',
  );
  assert.equal(
    (await user(b, (db) => db.query('select * from public.projects where id=$1', [projectA])))
      .rowCount,
    0,
  );
  assert.equal(
    (
      await user(b, (db) =>
        db.query("update public.projects set name='attack' where id=$1", [projectA]),
      )
    ).rowCount,
    0,
  );
  await denied(() =>
    user(a, (db) => db.query('update public.projects set owner_id=$1 where id=$2', [b, projectA])),
  );
  await denied(() =>
    user(b, (db) =>
      db.query('insert into public.projects(id,owner_id,name,model) values($1,$2,$3,$4)', [
        randomUUID(),
        a,
        'Spoof',
        {},
      ]),
    ),
  );
});

test('database: revisions require a matching owned project, remain readable and append-only', async () => {
  const result = await user(a, (db) =>
    db.query(
      'insert into public.project_revisions(project_id,owner_id,model) values($1,$2,$3) returning id',
      [projectA, a, { snapshot: 1 }],
    ),
  );
  const id = result.rows[0].id;
  assert.equal(
    (
      await user(a, (db) =>
        db.query('select model from public.project_revisions where id=$1', [id]),
      )
    ).rows[0].model.snapshot,
    1,
  );
  assert.equal(
    (await user(b, (db) => db.query('select * from public.project_revisions where id=$1', [id])))
      .rowCount,
    0,
  );
  await denied(() =>
    user(b, (db) =>
      db.query('insert into public.project_revisions(project_id,owner_id,model) values($1,$2,$3)', [
        projectA,
        b,
        {},
      ]),
    ),
  );
  await denied(() =>
    user(b, (db) =>
      db.query('insert into public.project_revisions(project_id,owner_id,model) values($1,$2,$3)', [
        projectA,
        a,
        {},
      ]),
    ),
  );
  await denied(() =>
    user(a, (db) =>
      db.query('insert into public.project_revisions(project_id,owner_id,model) values($1,$2,$3)', [
        randomUUID(),
        a,
        {},
      ]),
    ),
  );
  await denied(() =>
    user(a, (db) =>
      db.query('update public.project_revisions set owner_id=$1 where id=$2', [b, id]),
    ),
  );
  await denied(() =>
    user(a, (db) => db.query('delete from public.project_revisions where id=$1', [id])),
  );
});

test('database: composite ownership constraint also protects privileged writes and transfers', async () => {
  await foreignKeyDenied(() =>
    pool.query('insert into public.project_revisions(project_id,owner_id,model) values($1,$2,$3)', [
      projectB,
      a,
      {},
    ]),
  );
  await assert.rejects(
    () => pool.query('update public.projects set owner_id=$1 where id=$2', [b, projectA]),
    (e: unknown) =>
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      ['23503', '23001'].includes(String(e.code)) &&
      'constraint' in e &&
      e.constraint === 'revision_project_owner_fk',
  );
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query(
      'alter table public.project_revisions drop constraint revision_project_owner_fk',
    );
    const bad = await db.query(
      'insert into public.project_revisions(project_id,owner_id,model) values($1,$2,$3) returning id',
      [projectB, a, {}],
    );
    await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [a]);
    assert.equal(
      (await db.query('select * from public.project_revisions where id=$1', [bad.rows[0].id]))
        .rowCount,
      0,
      'read policy must independently check project ownership',
    );
  } finally {
    await db.query('rollback');
    db.release();
  }
});

test('database: project and auth-user deletes cascade without orphaned revisions', async () => {
  const id = randomUUID();
  await user(a, (db) =>
    db.query('insert into public.projects(id,owner_id,name,model) values($1,$2,$3,$4)', [
      id,
      a,
      'Temporary',
      {},
    ]),
  );
  await user(a, (db) =>
    db.query('insert into public.project_revisions(project_id,owner_id,model) values($1,$2,$3)', [
      id,
      a,
      {},
    ]),
  );
  assert.equal(
    (await user(b, (db) => db.query('delete from public.projects where id=$1', [id]))).rowCount,
    0,
  );
  await user(a, (db) => db.query('delete from public.projects where id=$1', [id]));
  assert.equal(
    (await pool.query('select * from public.project_revisions where project_id=$1', [id])).rowCount,
    0,
  );
  const temporary = randomUUID(),
    project = randomUUID();
  await pool.query('insert into auth.users values($1)', [temporary]);
  await user(temporary, (db) =>
    db.query('insert into public.projects(id,owner_id,name,model) values($1,$2,$3,$4)', [
      project,
      temporary,
      'Temporary user',
      {},
    ]),
  );
  await user(temporary, (db) =>
    db.query('insert into public.project_revisions(project_id,owner_id,model) values($1,$2,$3)', [
      project,
      temporary,
      {},
    ]),
  );
  await consume(temporary);
  await pool.query('delete from auth.users where id=$1', [temporary]);
  for (const table of ['projects', 'project_revisions', 'ai_usage'])
    assert.equal(
      (await pool.query(`select * from public.${table} where owner_id=$1`, [temporary])).rowCount,
      0,
    );
});

test('database: security-definer RPC pins search_path and restricts execution and counter access', async () => {
  const fn = (
    await pool.query(
      "select prosecdef,proconfig,pg_get_userbyid(proowner) as owner from pg_proc where oid='public.consume_ai_request()'::regprocedure",
    )
  ).rows[0];
  assert.equal(fn.prosecdef, true);
  assert.equal(fn.owner, 'postgres');
  assert.ok(fn.proconfig.includes('search_path=""'));
  for (const role of ['anon', 'service_role'])
    await denied(() => user(null, (db) => db.query('select public.consume_ai_request()'), role));
  assert.equal(
    await user(
      null,
      async (db) =>
        (await db.query('select public.consume_ai_request() as allowed')).rows[0].allowed,
    ),
    false,
  );
  for (const statement of [
    'select * from public.ai_usage',
    'delete from public.ai_usage',
    'update public.ai_usage set requests=1',
    `insert into public.ai_usage values('${a}',date_trunc('hour',now(),'UTC'),1)`,
  ])
    await denied(() => user(a, (db) => db.query(statement)));
});

test('database: sequential limit accepts 20, rejects later calls without changing the row', async () => {
  for (let i = 0; i < 20; i++) assert.equal(await consume(a), true);
  const before = (
    await pool.query('select requests,xmin::text from public.ai_usage where owner_id=$1', [a])
  ).rows[0];
  for (let i = 0; i < 5; i++) assert.equal(await consume(a), false);
  assert.deepEqual(
    (await pool.query('select requests,xmin::text from public.ai_usage where owner_id=$1', [a]))
      .rows[0],
    before,
  );
  assert.equal(before.requests, 20);
});

test('database: attacker search_path and a shadow quota table cannot redirect definer writes', async () => {
  await user(a, async (db) => {
    await db.query('create temporary table ai_usage(requests integer)');
    await db.query('insert into pg_temp.ai_usage values(0)');
    await db.query('set local search_path=pg_temp,public');
    assert.equal(
      (await db.query('select public.consume_ai_request() as allowed')).rows[0].allowed,
      false,
    );
    assert.equal((await db.query('select requests from pg_temp.ai_usage')).rows[0].requests, 0);
    await db.query('drop table pg_temp.ai_usage');
  });
  assert.equal(
    (await pool.query('select requests from public.ai_usage where owner_id=$1', [a])).rows[0]
      .requests,
    20,
  );
});

test('database: 80 concurrent calls contend on a new hour row and accept exactly 20', async () => {
  const results = await finishConcurrent(Array.from({ length: 80 }, () => consume(b)));
  assert.equal(results.filter(Boolean).length, 20);
  assert.equal(results.filter((v) => !v).length, 60);
  assert.equal(
    (await pool.query('select requests from public.ai_usage where owner_id=$1', [b])).rows[0]
      .requests,
    20,
  );
});

test('database: 40 concurrent calls at 19 used permit exactly one more request', async () => {
  const id = randomUUID();
  await pool.query('insert into auth.users values($1)', [id]);
  await pool.query(
    "insert into public.ai_usage values($1,date_trunc('hour',statement_timestamp(),'UTC'),19)",
    [id],
  );
  const results = await finishConcurrent(Array.from({ length: 40 }, () => consume(id)));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(
    (await pool.query('select requests from public.ai_usage where owner_id=$1', [id])).rows[0]
      .requests,
    20,
  );
});

test('database: UTC windows are independent of session timezone, and old hours do not consume new quota', async () => {
  const id = randomUUID();
  await pool.query('insert into auth.users values($1)', [id]);
  await pool.query(
    "insert into public.ai_usage values($1,date_trunc('hour',statement_timestamp(),'UTC')-interval '1 hour',20)",
    [id],
  );
  for (const timezone of ['Asia/Kathmandu', 'America/Guyana'])
    assert.equal(
      await user(id, async (db) => {
        await db.query("select set_config('TimeZone',$1,true)", [timezone]);
        return (await db.query('select public.consume_ai_request() as allowed')).rows[0].allowed;
      }),
      true,
    );
  assert.deepEqual(
    (
      await pool.query(
        'select requests from public.ai_usage where owner_id=$1 order by window_start',
        [id],
      )
    ).rows.map((r) => r.requests),
    [20, 2],
  );
  await assert.rejects(
    () => pool.query('update public.ai_usage set requests=21 where owner_id=$1', [id]),
    (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === '23514',
  );
});

test('database: private references isolate users by path, not spoofable ownership metadata', async () => {
  await user(a, (db) =>
    db.query("insert into storage.objects(bucket_id,name,owner_id) values('references',$1,$2)", [
      referenceA,
      b,
    ]),
  );
  await user(b, (db) =>
    db.query("insert into storage.objects(bucket_id,name) values('references',$1)", [referenceB]),
  );
  assert.equal(
    (
      await user(a, (db) =>
        db.query("select name from storage.objects where bucket_id='references'"),
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (await user(b, (db) => db.query('select * from storage.objects where name=$1', [referenceA])))
      .rowCount,
    0,
  );
  assert.equal(
    (await user(b, (db) => db.query('delete from storage.objects where name=$1', [referenceA])))
      .rowCount,
    0,
  );
  await denied(() =>
    user(b, (db) =>
      db.query("insert into storage.objects(bucket_id,name) values('references',$1)", [
        `${a}/malicious.png`,
      ]),
    ),
  );
  await denied(() =>
    user(a, (db) =>
      db.query("insert into storage.objects(bucket_id,name) values('references','unprefixed.png')"),
    ),
  );
  await denied(() =>
    user(
      null,
      (db) =>
        db.query("insert into storage.objects(bucket_id,name) values('references',$1)", [
          `${a}/anonymous.png`,
        ]),
      'anon',
    ),
  );
  assert.equal(
    (
      await user(a, (db) =>
        db.query('update storage.objects set name=$1 where name=$2', [
          `${a}/renamed.png`,
          referenceA,
        ]),
      )
    ).rowCount,
    0,
  );
});

test('database: restrictive storage guards survive broad permissive policies and preserve other buckets', async () => {
  await pool.query(
    'create policy "test broad policy" on storage.objects for all to public using(true) with check(true)',
  );
  try {
    assert.equal(
      (await user(b, (db) => db.query('select * from storage.objects where name=$1', [referenceA])))
        .rowCount,
      0,
    );
    assert.equal(
      (
        await user(
          null,
          (db) => db.query("select * from storage.objects where bucket_id='references'"),
          'anon',
        )
      ).rowCount,
      0,
    );
    await denied(() =>
      user(b, (db) =>
        db.query("insert into storage.objects(bucket_id,name) values('references',$1)", [
          `${a}/broad.png`,
        ]),
      ),
    );
    assert.equal(
      (
        await user(a, (db) =>
          db.query("update storage.objects set owner_id='changed' where name=$1", [referenceA]),
        )
      ).rowCount,
      0,
    );
    await pool.query("insert into storage.buckets(id,name) values('other','other')");
    await user(b, (db) =>
      db.query("insert into storage.objects(bucket_id,name) values('other','example.txt')"),
    );
    assert.equal(
      (await user(a, (db) => db.query("select * from storage.objects where bucket_id='other'")))
        .rowCount,
      1,
    );
    assert.equal(
      (await user(a, (db) => db.query('delete from storage.objects where name=$1', [referenceA])))
        .rowCount,
      1,
    );
  } finally {
    await pool.query('drop policy "test broad policy" on storage.objects');
  }
});

test('database: rerunning initial migration fails safely rather than overwriting an installation', async () => {
  const db = await pool.connect();
  try {
    await assert.rejects(
      () => db.query(migration),
      (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === '42P07',
    );
  } finally {
    await db.query('rollback');
    db.release();
  }
  assert.equal(
    (await user(a, (db) => db.query('select * from public.projects where id=$1', [projectA])))
      .rowCount,
    1,
  );
  assert.equal(
    (await pool.query("select public from storage.buckets where id='references'")).rows[0].public,
    false,
  );
});

test('database: preflight rejects missing managed Storage grants or disabled RLS', async () => {
  const db = await pool.connect();
  try {
    await db.query('alter table storage.objects disable row level security');
    await assert.rejects(() => db.query(migration), /Storage RLS is not enabled/);
    await db.query('rollback');
    await db.query('alter table storage.objects enable row level security');
    await db.query('revoke select on storage.objects from authenticated');
    await assert.rejects(() => db.query(migration), /Storage grants are not provisioned/);
    await db.query('rollback');
  } finally {
    await db.query('rollback');
    await db.query('alter table storage.objects enable row level security');
    await db.query('grant select on storage.objects to authenticated');
    db.release();
  }
});

test('database: a late migration error rolls back tables, policies and bucket reconfiguration', async () => {
  const name = 'rollback_fixture';
  await server.createDatabase(name);
  const db = server.getPgClient(name, '127.0.0.1');
  await db.connect();
  try {
    const fixture = (
      await readFile(new URL('./fixtures/supabase.sql', import.meta.url), 'utf8')
    ).replace(/^create role .*;\r?$/gm, '');
    await db.query(fixture);
    const broken = migration.replace(
      'create index revision_project_created',
      'create index project_owner_updated',
    );
    await assert.rejects(
      () => db.query(broken),
      (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === '42P07',
    );
    await db.query('rollback');
    assert.equal(
      (await db.query("select to_regclass('public.projects') as table_name")).rows[0].table_name,
      null,
    );
    assert.equal(
      (await db.query("select public from storage.buckets where id='references'")).rows[0].public,
      true,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::integer as n from pg_policy where polrelid='storage.objects'::regclass",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.end();
    await server.dropDatabase(name);
  }
});
