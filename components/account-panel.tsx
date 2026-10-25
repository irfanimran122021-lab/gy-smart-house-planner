'use client';
import { useEffect, useState } from 'react';
import { Cloud, LogIn, LogOut, KeyRound, UserRound } from 'lucide-react';
import type { Authentication } from './use-authentication';
export function AccountPanel({
  auth,
  onProjects,
  onImport,
}: {
  auth: Authentication;
  onProjects: () => void;
  onImport: () => void;
}) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [name, setName] = useState('');
  useEffect(() => {
    setPassword('');
    setConfirm('');
    setName(auth.user?.user_metadata.full_name || '');
  }, [auth.mode, auth.user?.id]);
  const title = {
    signin: 'Sign in',
    signup: 'Create account',
    forgot: 'Reset your password',
    update: 'Set a new password',
  }[auth.mode];
  return (
    <>
      <div className="connection-status">
        <Cloud size={25} />
        <div>
          <b>
            {auth.configured
              ? 'Your studio, saved across devices'
              : 'Cloud sign-in needs configuration'}
          </b>
          <p>
            {auth.configured
              ? 'Use your account to keep projects and revision history together. Local projects stay on this device until you choose to copy them.'
              : 'The deployment needs the two existing Supabase public environment variables and a rebuild. You can continue drafting on this device.'}
          </p>
        </div>
      </div>
      {!auth.ready && (
        <p role="status" className="helper">
          Restoring your sign-in session…
        </p>
      )}
      {auth.error && (
        <div role="alert" className="error-box">
          {auth.error}
        </div>
      )}
      {auth.message && (
        <div role="status" className="auth-success">
          {auth.message}
        </div>
      )}
      {auth.user && auth.mode !== 'update' ? (
        <>
          <h3 className="subheading">
            <UserRound size={17} /> Account information
          </h3>
          <dl className="account-info">
            <div>
              <dt>Email</dt>
              <dd>{auth.user.email}</dd>
            </div>
            <div>
              <dt>Account ID</dt>
              <dd>{auth.user.id}</dd>
            </div>
            <div>
              <dt>Email confirmed</dt>
              <dd>{auth.user.email_confirmed_at ? 'Yes' : 'Awaiting confirmation'}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{new Date(auth.user.created_at).toLocaleDateString()}</dd>
            </div>
          </dl>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await auth.run('profile', { name });
            }}
          >
            <label className="field">
              Display name
              <input
                autoComplete="name"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button className="btn" disabled={auth.busy}>
              Save account settings
            </button>
          </form>
          <div className="modal-actions">
            <button className="btn" onClick={onProjects}>
              Open cloud projects
            </button>
            <button className="btn" onClick={onImport}>
              Copy device projects to account
            </button>
            <button
              className="btn"
              disabled={auth.busy}
              onClick={() => void auth.run('forgot', { email: auth.user!.email })}
            >
              <KeyRound size={14} />
              Reset password by email
            </button>
            <button className="btn" disabled={auth.busy} onClick={() => void auth.run('signout')}>
              <LogOut size={14} />
              {auth.busy ? 'Working…' : 'Sign out'}
            </button>
          </div>
        </>
      ) : (
        <>
          {auth.mode !== 'update' && (
            <div className="auth-tabs">
              <button
                className={auth.mode === 'signin' ? 'chosen' : ''}
                onClick={() => auth.open('signin')}
              >
                Sign in
              </button>
              <button
                className={auth.mode === 'signup' ? 'chosen' : ''}
                onClick={() => auth.open('signup')}
              >
                Create account
              </button>
            </div>
          )}
          <h3 className="subheading">{title}</h3>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await auth.run(auth.mode, { email, password, confirm, name })) {
                setPassword('');
                setConfirm('');
              }
            }}
          >
            {auth.mode === 'signup' && (
              <label className="field">
                Display name (optional)
                <input
                  autoComplete="name"
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            {auth.mode !== 'update' && (
              <label className="field">
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </label>
            )}
            {(auth.mode === 'signup' || auth.mode === 'signin' || auth.mode === 'update') && (
              <label className="field">
                {auth.mode === 'update' ? 'New password' : 'Password'}
                <input
                  type="password"
                  autoComplete={auth.mode === 'signin' ? 'current-password' : 'new-password'}
                  minLength={auth.mode === 'signin' ? undefined : 8}
                  maxLength={256}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {(auth.mode === 'signup' || auth.mode === 'update') && (
              <label className="field">
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={256}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
            )}
            <button className="btn primary full" disabled={auth.busy || !auth.ready}>
              <LogIn size={16} />
              {auth.busy ? 'Please wait…' : title}
            </button>
          </form>
          {auth.mode === 'signin' && (
            <div className="auth-secondary">
              <button className="text-button" onClick={() => auth.open('forgot')}>
                Forgot your password?
              </button>
              <button
                className="text-button"
                disabled={auth.busy}
                onClick={() => void auth.run('magic', { email })}
              >
                Email me a sign-in link
              </button>
            </div>
          )}
          {auth.mode === 'forgot' && (
            <button className="text-button" onClick={() => auth.open('signin')}>
              Back to sign in
            </button>
          )}
        </>
      )}
    </>
  );
}
