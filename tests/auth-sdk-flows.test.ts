import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { authAction } from '../lib/auth.ts';
import { readAuthCallback, resolveAuthCallback } from '../lib/auth-callback.ts';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'fixture@example.com',
  aud: 'authenticated',
  role: 'authenticated',
  created_at: '2026-01-01T00:00:00Z',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: {},
  user_metadata: {},
};
const accessToken = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
    'base64url',
  ),
  Buffer.from('fixture-signature').toString('base64url'),
].join('.');
const session = () => ({
  user,
  access_token: accessToken,
  refresh_token: 'fixture-refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
});

test('auth SDK: confirmation and dashboard recovery fragments establish a verified session before choosing the form', async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'),
    oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    for (const type of ['signup', 'recovery']) {
      const location = new URL(
        'https://planner.example/#' +
          new URLSearchParams({
            type,
            access_token: accessToken,
            refresh_token: 'fixture-refresh-token',
            expires_in: '3600',
            expires_at: String(Math.floor(Date.now() / 1000) + 3600),
            token_type: 'bearer',
          }),
      );
      const intent = readAuthCallback(location.href);
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { location, addEventListener() {}, removeEventListener() {} },
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { visibilityState: 'visible' },
      });
      const db = createClient('https://fixture.supabase.co', 'test-public-key', {
        auth: {
          flowType: 'implicit',
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: true,
          storageKey: 'callback-' + type,
        },
        global: {
          fetch: async (input, init) => {
            assert.equal(String(input), 'https://fixture.supabase.co/auth/v1/user');
            assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${accessToken}`);
            return Response.json(user);
          },
        },
      });
      const expected = type === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN';
      let subscription: { unsubscribe: () => void } | undefined;
      const event = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('Missing SDK callback event')), 2000);
        subscription = db.auth.onAuthStateChange((name) => {
          if (name === expected) {
            clearTimeout(timeout);
            resolve();
          }
        }).data.subscription;
      });
      try {
        const [{ data, error }] = await Promise.all([db.auth.getSession(), event]);
        assert.equal(error, null);
        assert.equal(data.session?.user.id, user.id);
        assert.equal(location.hash, '', 'SDK removes tokens from the address bar');
        assert.equal(
          resolveAuthCallback(intent, Boolean(data.session))?.mode,
          type === 'recovery' ? 'update' : 'signin',
        );
      } finally {
        subscription?.unsubscribe();
        await db.auth.dispose();
      }
    }
  } finally {
    for (const [name, descriptor] of [
      ['window', oldWindow],
      ['document', oldDocument],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test('auth SDK: signup, confirmation rejection, password reset, new login and logout keep the same account', async () => {
  let confirmed = false,
    password = '',
    recoveries = 0;
  const db = createClient('https://fixture.supabase.co', 'test-public-key', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'password-flow',
    },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input)),
          body = init?.body ? JSON.parse(String(init.body)) : {};
        if (url.pathname.endsWith('/signup')) {
          password = body.password;
          return Response.json({ user: { ...user, email_confirmed_at: null }, session: null });
        }
        if (url.pathname.endsWith('/token')) {
          if (!confirmed)
            return Response.json(
              { code: 'email_not_confirmed', msg: 'Email not confirmed' },
              { status: 400 },
            );
          if (body.password !== password)
            return Response.json(
              { code: 'invalid_credentials', msg: 'Invalid login credentials' },
              { status: 400 },
            );
          return Response.json(session());
        }
        if (url.pathname.endsWith('/recover')) {
          assert.equal(
            url.searchParams.get('redirect_to'),
            'https://planner.example/?auth=recovery',
          );
          assert.equal(body.email, user.email);
          recoveries++;
          return Response.json({});
        }
        if (url.pathname.endsWith('/user')) {
          assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${accessToken}`);
          if (init?.method === 'PUT') password = body.password;
          return Response.json(user);
        }
        if (url.pathname.endsWith('/logout')) return new Response(null, { status: 204 });
        throw Error('Unexpected fixture endpoint');
      },
    },
  });
  try {
    assert.match(
      await authAction(
        db,
        'signup',
        { email: user.email, password: 'InitialPassword123', confirm: 'InitialPassword123' },
        'https://planner.example',
      ),
      /confirm your account/,
    );
    await assert.rejects(
      () => authAction(db, 'signin', { email: user.email, password }, 'https://planner.example'),
      /Confirm your email/,
    );
    confirmed = true;
    await assert.rejects(
      () =>
        authAction(
          db,
          'signin',
          { email: user.email, password: 'WrongPassword' },
          'https://planner.example',
        ),
      /Forgot password/,
    );
    await authAction(db, 'forgot', { email: user.email }, 'https://planner.example');
    assert.equal(recoveries, 1);
    // The preceding test covers receiving the recovery session from a real SDK URL callback.
    await db.auth.setSession({
      access_token: accessToken,
      refresh_token: 'fixture-refresh-token',
    });
    await authAction(
      db,
      'update',
      { password: 'NewPassword123', confirm: 'NewPassword123' },
      'https://planner.example',
    );
    await authAction(db, 'signout', {}, 'https://planner.example');
    await assert.rejects(
      () =>
        authAction(
          db,
          'signin',
          { email: user.email, password: 'InitialPassword123' },
          'https://planner.example',
        ),
      /Invalid login/,
    );
    await authAction(
      db,
      'signin',
      { email: user.email, password: 'NewPassword123' },
      'https://planner.example',
    );
    assert.equal((await db.auth.getSession()).data.session?.user.id, user.id);
    await authAction(db, 'signout', {}, 'https://planner.example');
    assert.equal((await db.auth.getSession()).data.session, null);
  } finally {
    await db.auth.dispose();
  }
});
