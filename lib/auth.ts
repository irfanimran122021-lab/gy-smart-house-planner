import type { SupabaseClient } from '@supabase/supabase-js';
export type AuthMode = 'signin' | 'signup' | 'forgot' | 'update';
export type AuthAction = AuthMode | 'signout' | 'profile' | 'magic' | 'resend';
export type AuthInput = { email?: string; password?: string; confirm?: string; name?: string };
export async function authAction(
  db: SupabaseClient | null,
  action: AuthAction,
  input: AuthInput,
  origin: string,
) {
  if (!db)
    throw Error(
      'Sign-in is not configured in this deployment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel and redeploy. Device projects are preserved.',
    );
  const email = input.email?.trim() || '',
    password = input.password || '';
  const redirect = new URL('/', origin).href;
  if (
    ['signin', 'signup', 'forgot', 'magic', 'resend'].includes(action) &&
    !/^\S+@\S+\.\S+$/.test(email)
  )
    throw Error('Enter a valid email address.');
  if (action === 'signin' && !password) throw Error('Enter your password.');
  if (['signup', 'update'].includes(action)) {
    if (password.length < 8)
      throw Error(
        'Use a password with at least 8 characters, or the stronger policy required by your account.',
      );
    if (password !== input.confirm) throw Error('The passwords do not match.');
  }
  if (action === 'signin') {
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (
      error?.code === 'invalid_credentials' ||
      /invalid login credentials/i.test(error?.message || '')
    )
      throw Error(
        'Invalid login credentials. Check the email and password, or choose Forgot password? to reset the password for your existing account. Email confirmation alone does not set or reset a password.',
      );
    if (error?.code === 'email_not_confirmed' || /email not confirmed/i.test(error?.message || ''))
      throw Error(
        'Confirm your email before signing in. Check your inbox and spam folder, or choose Resend confirmation email.',
      );
    if (error) throw error;
    return 'Signed in. Your cloud projects are loading; device projects are unchanged.';
  }
  if (action === 'resend') {
    const { error } = await db.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: redirect },
    });
    if (error) throw error;
    return 'If this account needs confirmation, a new confirmation email will arrive shortly. Check your inbox and spam folder.';
  }
  if (action === 'signup') {
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirect, data: { full_name: input.name?.trim() || '' } },
    });
    if (error) throw error;
    return data.session
      ? 'Your account is ready and you are signed in.'
      : 'Check your email to confirm your account, then sign in. Your device projects are unchanged.';
  }
  if (action === 'forgot') {
    const target = new URL('/', origin);
    target.searchParams.set('auth', 'recovery');
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: target.href });
    if (error) throw error;
    return 'If this email is registered, a password reset link will arrive shortly. Check your inbox and spam folder.';
  }
  if (action === 'update') {
    const { error } = await db.auth.updateUser({ password });
    if (error) throw error;
    return 'Password updated successfully.';
  }
  if (action === 'signout') {
    const { error } = await db.auth.signOut({ scope: 'local' });
    if (error) throw error;
    return 'Signed out on this device. Account drafts remain in their separate cache; device projects are unchanged.';
  }
  if (action === 'profile') {
    const { error } = await db.auth.updateUser({
      data: { full_name: input.name?.trim().slice(0, 100) || '' },
    });
    if (error) throw error;
    return 'Account settings saved.';
  }
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirect, shouldCreateUser: false },
  });
  if (error) throw error;
  return 'Check your email for a secure sign-in link.';
}
