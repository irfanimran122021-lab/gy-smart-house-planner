import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { authAction } from '../lib/auth.ts';

// Real Supabase SDK, isolated in-memory HTTP/storage fixtures. No test emails,
// production accounts or real credentials are sent to an external service.
test('session: real SDK persists login across client recreation and clears it on logout', async () => {
  const values = new Map<string, string>(),
    requests: string[] = [];
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'test@example.com',
    aud: 'authenticated',
    role: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    user_metadata: {},
    app_metadata: {},
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('/token')) {
      assert.equal(JSON.parse(String(init?.body)).email, user.email);
      return Response.json({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
        token_type: 'bearer',
        user,
      });
    }
    if (url.endsWith('/user')) return Response.json(user);
    if (url.includes('/logout')) return new Response(null, { status: 204 });
    throw Error('Unexpected test SDK request: ' + url);
  };
  const make = () =>
    createClient('https://session-fixture.supabase.co', 'test-public-anon-key', {
      auth: {
        storage,
        storageKey: 'test-session',
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: fetcher },
    });
  const first = make();
  await authAction(
    first,
    'signin',
    { email: user.email, password: 'fixture-password' },
    'https://planner.example',
  );
  assert.ok(values.get('test-session'));
  first.auth.stopAutoRefresh();
  const refreshed = make();
  assert.equal((await refreshed.auth.getSession()).data.session?.user.id, user.id);
  assert.equal((await refreshed.auth.getUser()).data.user?.id, user.id);
  await authAction(refreshed, 'signout', {}, 'https://planner.example');
  assert.equal((await refreshed.auth.getSession()).data.session, null);
  assert.equal(values.has('test-session'), false);
  assert.ok(requests.some((url) => url.includes('/logout?scope=local')));
  refreshed.auth.stopAutoRefresh();
});
