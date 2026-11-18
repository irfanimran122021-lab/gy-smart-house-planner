import type { AuthMode } from './auth.ts';

export type AuthCallback = { kind: 'recovery' | 'confirmation' | null; failed: boolean };

// Capture intent before the SDK consumes and removes the token fragment. Never
// retain tokens, authorization codes, email addresses or raw provider messages.
export function readAuthCallback(href: string): AuthCallback {
  const url = new URL(href),
    fragment = new URLSearchParams(url.hash.slice(1));
  const kind =
    url.searchParams.get('auth') === 'recovery' || fragment.get('type') === 'recovery'
      ? 'recovery'
      : url.searchParams.get('auth') === 'confirmation' || fragment.get('type') === 'signup'
        ? 'confirmation'
        : null;
  return {
    kind,
    failed: ['error', 'error_code', 'error_description'].some(
      (name) => url.searchParams.has(name) || fragment.has(name),
    ),
  };
}

export function resolveAuthCallback(
  callback: AuthCallback,
  hasSession: boolean,
): {
  mode: AuthMode;
  error: string;
  message: string;
} | null {
  if (callback.failed)
    return {
      mode: callback.kind === 'recovery' ? 'forgot' : 'signin',
      error:
        'This email link is invalid, expired or already used. Request a fresh password reset or confirmation email.',
      message: '',
    };
  if (callback.kind === 'recovery')
    return hasSession
      ? {
          mode: 'update',
          error: '',
          message: 'Recovery link accepted. Set a new password for your existing account.',
        }
      : {
          mode: 'forgot',
          error: 'The reset link is expired or incomplete. Request a new password reset email.',
          message: '',
        };
  if (callback.kind === 'confirmation')
    return hasSession
      ? { mode: 'signin', error: '', message: 'Email confirmed. You are signed in.' }
      : {
          mode: 'signin',
          error: '',
          message:
            'Sign in with your account password after confirming your email. If you do not know it, choose Forgot password?.',
        };
  return null;
}

export function authProjectHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function cleanAuthCallbackURL(href: string, keepRecovery = false): string {
  const url = new URL(href),
    fragment = new URLSearchParams(url.hash.slice(1));
  for (const name of ['auth', 'error', 'error_code', 'error_description'])
    url.searchParams.delete(name);
  if (
    ['access_token', 'refresh_token', 'error', 'error_code', 'error_description', 'type'].some(
      (name) => fragment.has(name),
    )
  )
    url.hash = '';
  if (keepRecovery) url.searchParams.set('auth', 'recovery');
  return url.href;
}
