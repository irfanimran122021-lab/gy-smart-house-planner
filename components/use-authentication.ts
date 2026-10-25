'use client';
import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { cloud } from '../lib/cloud';
import { authAction } from '../lib/auth';
import type { AuthAction, AuthInput, AuthMode } from '../lib/auth';
export function useAuthentication() {
  const running = useRef(false);
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [mode, setMode] = useState<AuthMode>('signin'),
    [recovery, setRecovery] = useState(false);
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  useEffect(() => {
    const db = cloud();
    if (!db) {
      setReady(true);
      return;
    }
    let alive = true,
      events = 0;
    const receive = (next: User | null) => {
      if (alive) {
        setUser(next);
        setReady(true);
      }
    };
    const { data } = db.auth.onAuthStateChange((event, session) => {
      events++;
      receive(session?.user || null);
      if (alive && event === 'PASSWORD_RECOVERY') {
        setRecovery(true);
        setMode('update');
      }
    });
    void db.auth
      .getSession()
      .then(({ data: session, error: failure }) => {
        if (!alive) return;
        if (failure) setError(failure.message);
        if (events === 0) receive(session.session?.user || null);
        if (new URL(window.location.href).searchParams.get('auth') === 'recovery') {
          setRecovery(true);
          setMode(session.session ? 'update' : 'forgot');
          if (!session.session)
            setError(
              'The reset link is expired or incomplete. Request a new password reset email.',
            );
        }
        setReady(true);
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setReady(true);
        }
      });
    const url = new URL(window.location.href);
    const failure =
      url.searchParams.get('error_description') ||
      new URLSearchParams(url.hash.slice(1)).get('error_description');
    if (failure) {
      setError(failure);
      setRecovery(true);
      setMode('forgot');
    }
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  async function run(action: AuthAction, input: AuthInput = {}) {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setMessage(await authAction(cloud(), action, input, window.location.origin));
      if (action === 'signout') {
        setRecovery(false);
        setMode('signin');
      }
      if (action === 'update') {
        setRecovery(false);
        const url = new URL(window.location.href);
        url.searchParams.delete('auth');
        window.history.replaceState({}, '', url);
        setMode('signin');
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed. Try again.');
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  function open(next: AuthMode = 'signin') {
    setMode(next);
    setError('');
    setMessage('');
  }
  return { user, ready, busy, error, message, mode, setMode, configured, recovery, run, open };
}
export type Authentication = ReturnType<typeof useAuthentication>;
