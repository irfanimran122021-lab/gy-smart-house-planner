import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authProjectHost,
  cleanAuthCallbackURL,
  readAuthCallback,
  resolveAuthCallback,
} from '../lib/auth-callback.ts';
import { authAction } from '../lib/auth.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

test('auth callback: dashboard recovery links without the app query retain their intent before SDK cleanup', () => {
  const url = 'https://planner.example/#access_token=fixture&refresh_token=fixture&type=recovery';
  const intent = readAuthCallback(url);
  assert.deepEqual(intent, { kind: 'recovery', failed: false });
  assert.equal(resolveAuthCallback(intent, true)?.mode, 'update');
  assert.equal(JSON.stringify(intent).includes('fixture'), false);
  const cleaned = cleanAuthCallbackURL(url, true);
  assert.equal(cleaned, 'https://planner.example/?auth=recovery');
  assert.equal(resolveAuthCallback(readAuthCallback(cleaned), true)?.mode, 'update');
});
test('auth callback: a recovery query or token fragment cannot create a session', () => {
  for (const url of [
    'https://planner.example/?auth=recovery',
    'https://planner.example/#type=recovery&access_token=invalid',
  ]) {
    const result = resolveAuthCallback(readAuthCallback(url), false);
    assert.equal(result?.mode, 'forgot');
    assert.match(result?.error || '', /expired or incomplete/);
  }
});
test('auth callback: expired links never open the password form even with an older signed-in session', () => {
  const url =
    'https://planner.example/?auth=recovery#error=access_denied&error_code=otp_expired&error_description=private-provider-detail';
  const result = resolveAuthCallback(readAuthCallback(url), true);
  assert.equal(result?.mode, 'forgot');
  assert.match(result?.error || '', /expired/);
  assert.equal(result?.error.includes('private-provider-detail'), false);
  assert.equal(cleanAuthCallbackURL(url), 'https://planner.example/');
});
test('auth callback: confirmation and ordinary refresh remain distinct', () => {
  const intent = readAuthCallback('https://planner.example/#access_token=fixture&type=signup');
  assert.match(resolveAuthCallback(intent, true)?.message || '', /Email confirmed/);
  assert.match(resolveAuthCallback(intent, false)?.message || '', /Sign in/);
  assert.equal(resolveAuthCallback(readAuthCallback('https://planner.example/'), true), null);
  assert.equal(
    cleanAuthCallbackURL('https://planner.example/?drawing=floor#help'),
    'https://planner.example/?drawing=floor#help',
  );
});
test('auth configuration: account diagnostics reveal only the host, never a key or URL credentials', () => {
  assert.equal(
    authProjectHost('https://user:password@project.supabase.co/path?apikey=secret'),
    'project.supabase.co',
  );
  assert.equal(authProjectHost(undefined), null);
  assert.equal(authProjectHost('invalid'), null);
});
test('account: invalid credentials and unconfirmed email produce distinct recovery guidance', async () => {
  const client = (code: string) =>
    ({
      auth: { signInWithPassword: async () => ({ error: { code, message: 'Provider error' } }) },
    }) as unknown as SupabaseClient;
  await assert.rejects(
    () =>
      authAction(
        client('invalid_credentials'),
        'signin',
        { email: 'test@example.com', password: 'unchanged' },
        'https://planner.example',
      ),
    /Forgot password/,
  );
  await assert.rejects(
    () =>
      authAction(
        client('email_not_confirmed'),
        'signin',
        { email: 'test@example.com', password: 'unchanged' },
        'https://planner.example',
      ),
    /Resend confirmation/,
  );
});
test('account: resend confirmation uses signup verification and the app origin without changing credentials', async () => {
  let request: unknown;
  const client = {
    auth: {
      resend: async (input: unknown) => {
        request = input;
        return { error: null };
      },
    },
  } as unknown as SupabaseClient;
  assert.match(
    await authAction(client, 'resend', { email: ' test@example.com ' }, 'https://planner.example'),
    /If this account/,
  );
  assert.deepEqual(request, {
    type: 'signup',
    email: 'test@example.com',
    options: { emailRedirectTo: 'https://planner.example/' },
  });
});
