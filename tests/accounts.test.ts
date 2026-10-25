import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authAction } from '../lib/auth.ts';
import { newProject } from '../lib/model.ts';
import { saveCloud, CloudConflictError } from '../lib/cloud.ts';
import {
  legacyKey,
  deviceKey,
  accountKey,
  readDeviceProjects,
  writeDeviceProject,
  readAccountDrafts,
  writeAccountDrafts,
  mergeCloudDrafts,
  cloudCopy,
} from '../lib/project-storage.ts';

function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}
function authMock(session: unknown = null) {
  const calls: { method: string; input: unknown }[] = [];
  const auth = Object.fromEntries(
    [
      'signInWithPassword',
      'signUp',
      'resetPasswordForEmail',
      'updateUser',
      'signOut',
      'signInWithOtp',
    ].map((method) => [
      method,
      async (...args: unknown[]) => {
        calls.push({ method, input: args });
        return { data: { session }, error: null };
      },
    ]),
  );
  return { client: { auth } as unknown as SupabaseClient, calls };
}
const origin = 'https://gy-smart-house-planner.vercel.app';
test('account: password sign-in uses email/password and preserves password whitespace', async () => {
  const { client, calls } = authMock();
  await authAction(
    client,
    'signin',
    { email: '  user@example.com ', password: ' secret password ' },
    origin,
  );
  assert.deepEqual(calls[0], {
    method: 'signInWithPassword',
    input: [{ email: 'user@example.com', password: ' secret password ' }],
  });
});
test('account: signup requires matching strong password and reports email confirmation', async () => {
  const { client, calls } = authMock();
  await assert.rejects(
    () =>
      authAction(
        client,
        'signup',
        { email: 'a@b.com', password: 'short', confirm: 'short' },
        origin,
      ),
    /8 characters/,
  );
  await assert.rejects(
    () =>
      authAction(
        client,
        'signup',
        { email: 'a@b.com', password: 'password123', confirm: 'different' },
        origin,
      ),
    /do not match/,
  );
  assert.equal(calls.length, 0);
  assert.match(
    await authAction(
      client,
      'signup',
      { email: 'a@b.com', password: 'password123', confirm: 'password123', name: ' Ada ' },
      origin,
    ),
    /confirm your account/,
  );
  assert.deepEqual(calls[0], {
    method: 'signUp',
    input: [
      {
        email: 'a@b.com',
        password: 'password123',
        options: { emailRedirectTo: origin + '/', data: { full_name: 'Ada' } },
      },
    ],
  });
});
test('account: password recovery sends a recovery redirect and updates the recovered session', async () => {
  const { client, calls } = authMock();
  await authAction(client, 'forgot', { email: 'user@example.com' }, origin);
  assert.deepEqual(calls[0], {
    method: 'resetPasswordForEmail',
    input: ['user@example.com', { redirectTo: origin + '/?auth=recovery' }],
  });
  await authAction(
    client,
    'update',
    { password: 'newPassword123', confirm: 'newPassword123' },
    origin,
  );
  assert.deepEqual(calls[1], { method: 'updateUser', input: [{ password: 'newPassword123' }] });
});
test('account: logout is scoped to this device and existing magic links remain available', async () => {
  const { client, calls } = authMock();
  await authAction(client, 'signout', {}, origin);
  assert.deepEqual(calls[0], { method: 'signOut', input: [{ scope: 'local' }] });
  await authAction(client, 'magic', { email: 'user@example.com' }, origin);
  assert.equal(calls[1].method, 'signInWithOtp');
});
test('account: missing configuration and provider failures are actionable', async () => {
  await assert.rejects(() => authAction(null, 'signin', {}, origin), /NEXT_PUBLIC_SUPABASE/);
  const client = {
    auth: { signInWithPassword: async () => ({ error: new Error('Invalid login credentials') }) },
  } as unknown as SupabaseClient;
  await assert.rejects(
    () => authAction(client, 'signin', { email: 'user@example.com', password: 'invalid' }, origin),
    /Invalid login/,
  );
});
test('storage: device writes retain every legacy project and never change the original backup', () => {
  const db = storage(),
    a = newProject(),
    b = newProject();
  const original = JSON.stringify([a, b]);
  db.setItem(legacyKey, original);
  const edited = { ...a, updatedAt: new Date().toISOString() };
  writeDeviceProject(db, edited);
  assert.equal(db.getItem(legacyKey), original);
  assert.equal(readDeviceProjects(db).length, 2);
  assert.ok(db.getItem(deviceKey));
});
test('storage: account caches stay separate from each other and device projects', () => {
  const db = storage(),
    p = newProject();
  writeDeviceProject(db, p);
  writeAccountDrafts(db, 'alice', { [p.id]: { draft: p, base: null } });
  assert.equal(Object.keys(readAccountDrafts(db, 'bob')).length, 0);
  assert.equal(readDeviceProjects(db).length, 1);
  assert.ok(db.getItem(accountKey('alice')));
});
test('storage: a refresh retains dirty geometry and its original version for conflict detection', () => {
  const p = newProject(),
    draft = { ...p, requirements: { ...p.requirements, name: 'Local edit' } };
  const base = { project: p, version: 'old' },
    remote = {
      project: { ...p, requirements: { ...p.requirements, name: 'Other device' } },
      version: 'new',
    };
  const merged = mergeCloudDrafts({ [p.id]: { draft, base } }, [remote]);
  assert.equal(merged[p.id].draft.requirements.name, 'Local edit');
  assert.equal(merged[p.id].base?.version, 'old');
  assert.equal(
    mergeCloudDrafts({ [p.id]: { draft: p, base } }, [remote])[p.id].draft.requirements.name,
    'Other device',
  );
});
test('storage: migration creates a new UUID and preserves originals and geometry', () => {
  const p = newProject(),
    before = JSON.stringify(p),
    copy = cloudCopy(p, 'alice');
  assert.notEqual(copy.id, p.id);
  assert.deepEqual(copy.floors, p.floors);
  assert.equal(JSON.stringify(p), before);
});
test('cloud: saving uses the atomic RPC with the original version and verified owner', async () => {
  const p = newProject();
  let args: unknown;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'alice' } } }) },
    rpc: async (name: string, input: unknown) => {
      assert.equal(name, 'save_project');
      args = input;
      return { data: [{ saved_updated_at: 'receipt' }], error: null };
    },
  } as unknown as SupabaseClient;
  assert.equal((await saveCloud(p, 'old', client, 'alice')).version, 'receipt');
  assert.equal((args as { p_expected_updated_at: string }).p_expected_updated_at, 'old');
  await assert.rejects(() => saveCloud(p, 'old', client, 'bob'), /account changed/);
});
test('cloud: stale saves and missing migration fail without an unsafe upsert fallback', async () => {
  const client = (code: string) =>
    ({
      auth: { getUser: async () => ({ data: { user: { id: 'alice' } } }) },
      rpc: async () => ({ error: { code } }),
    }) as unknown as SupabaseClient;
  await assert.rejects(() => saveCloud(newProject(), 'old', client('40001')), CloudConflictError);
  await assert.rejects(() => saveCloud(newProject(), null, client('PGRST202')), /002_cloud_saving/);
});
