import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { newProject, mm } from '../lib/model.ts';
import { resizeWallLength } from '../lib/editor.ts';
import { validateUpload } from '../lib/ai.ts';
import { loadCloud, cloudRevisions, storeReference } from '../lib/cloud.ts';

test('wall length: resizing retains start point and direction in every drawing direction', () => {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [3, -4],
  ]) {
    const wall = {
      id: 'qa-wall',
      a: { x: mm(20), y: mm(20) },
      b: { x: mm(20) + dx * 100, y: mm(20) + dy * 100 },
      thickness: 152.4,
    };
    const before = JSON.stringify(wall),
      next = resizeWallLength(wall, mm(4));
    assert.deepEqual(next.a, wall.a);
    assert.ok(Math.abs(Math.hypot(next.b.x - next.a.x, next.b.y - next.a.y) - mm(4)) < 0.001);
    assert.equal(Math.sign(next.b.x - next.a.x), Math.sign(dx));
    assert.equal(Math.sign(next.b.y - next.a.y), Math.sign(dy));
    assert.equal(JSON.stringify(wall), before);
  }
  const wall = { id: 'qa', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, thickness: 100 };
  for (const value of [0, -1, NaN, Infinity])
    assert.throws(() => resizeWallLength(wall, value), /positive wall length/);
});

test('reference validation: accepted extensions must agree with their MIME type', () => {
  const pairs = [
    ['image/jpeg', 'jpg'],
    ['image/jpeg', 'jpeg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['application/pdf', 'pdf'],
  ];
  for (const [type, extension] of pairs)
    assert.doesNotThrow(() =>
      validateUpload({ name: 'reference.' + extension.toUpperCase(), type, size: 1024 }),
    );
  for (const [type, extension] of [
    ['image/png', 'pdf'],
    ['application/pdf', 'png'],
    ['image/jpeg', 'webp'],
  ])
    assert.throws(
      () => validateUpload({ name: 'reference.' + extension, type, size: 1024 }),
      /must match/,
    );
});

const owner = '11111111-1111-4111-8111-111111111111';
const user = {
  id: owner,
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00Z',
  app_metadata: {},
  user_metadata: {},
};
const makeClient = (fetcher: typeof fetch) =>
  createClient('https://launch-fixture.supabase.co', 'test-public-key', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'launch-fixture',
    },
    global: { fetch: fetcher },
  });
// getUser needs a session; a fixture JWT is used only by this isolated transport.
const accessToken = [
  Buffer.from('{"alg":"HS256"}').toString('base64url'),
  Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
    'base64url',
  ),
  'fixture',
].join('.');
async function loginFixture(db: ReturnType<typeof makeClient>) {
  const { error } = await db.auth.setSession({
    access_token: accessToken,
    refresh_token: 'fixture-refresh',
  });
  assert.equal(error, null);
}

test('cloud SDK: paginated project reopening and revision history always filter the verified owner', async () => {
  const projects = Array.from({ length: 101 }, () => newProject());
  let pages = 0,
    revisions = 0;
  const db = makeClient(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/user')) return Response.json(user);
    assert.equal(url.searchParams.get('owner_id'), 'eq.' + owner);
    if (url.pathname.endsWith('/projects')) {
      const offset = Number(url.searchParams.get('offset') || 0);
      pages++;
      return Response.json(
        projects.slice(offset, offset + 100).map((project) => ({
          id: project.id,
          model: project,
          updated_at: '2026-11-17T12:00:00.123456Z',
        })),
      );
    }
    assert.equal(url.pathname, '/rest/v1/project_revisions');
    assert.equal(url.searchParams.get('project_id'), 'eq.' + projects[0].id);
    revisions++;
    return Response.json([
      { id: 'revision-fixture', created_at: '2026-11-17T12:00:00Z', model: projects[0] },
    ]);
  });
  try {
    await loginFixture(db);
    const loaded = await loadCloud(db);
    assert.equal(loaded.length, 101);
    assert.equal(pages, 2);
    assert.deepEqual(loaded[0].project.floors, projects[0].floors);
    assert.equal(loaded[0].version, '2026-11-17T12:00:00.123456Z');
    const history = await cloudRevisions(projects[0].id, 0, db);
    assert.equal(revisions, 1);
    assert.deepEqual(history[0].project, projects[0]);
  } finally {
    await db.auth.dispose();
  }
});

test('storage SDK: supported references upload without overwrite under the verified user and can request private previews', async () => {
  let uploads = 0,
    previews = 0;
  const db = makeClient(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/user')) return Response.json(user);
    if (url.pathname.startsWith('/storage/v1/object/sign/references/')) {
      assert.ok(url.pathname.includes('/' + owner + '/'));
      previews++;
      return Response.json({ signedURL: '/object/sign/references/fixture?token=fixture' });
    }
    assert.ok(url.pathname.startsWith('/storage/v1/object/references/' + owner + '/'));
    assert.equal(new Headers(init?.headers).get('x-upsert'), 'false');
    uploads++;
    return Response.json({ Key: 'references/fixture' });
  });
  try {
    await loginFixture(db);
    const p = newProject();
    for (const [type, extension] of [
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
      ['application/pdf', 'pdf'],
    ]) {
      const reference = await storeReference(
        p,
        new File(['fixture'], 'qa.' + extension, { type }),
        db,
      );
      assert.ok(reference.path.startsWith(owner + '/' + p.id + '/'));
      const preview = await db.storage.from('references').createSignedUrl(reference.path, 120);
      assert.equal(preview.error, null);
      assert.ok(preview.data?.signedUrl);
    }
    assert.equal(uploads, 4);
    assert.equal(previews, 4);
    await assert.rejects(
      () => storeReference(p, new File(['fixture'], 'wrong.pdf', { type: 'image/png' }), db),
      /must match/,
    );
    assert.equal(uploads, 4);
  } finally {
    await db.auth.dispose();
  }
});
