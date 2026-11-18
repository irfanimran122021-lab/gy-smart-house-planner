'use client';
import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { cloud } from '../lib/cloud';
import { authAction } from '../lib/auth';
import type { AuthAction, AuthInput, AuthMode } from '../lib/auth';
import {
  authProjectHost,
  cleanAuthCallbackURL,
  readAuthCallback,
  resolveAuthCallback,
} from '../lib/auth-callback';
import type { AuthCallback } from '../lib/auth-callback';
export function useAuthentication() {
  const running = useRef(false);
  const callback = useRef<AuthCallback | null>(null);
  if (typeof window !== 'undefined' && !callback.current)
    callback.current = readAuthCallback(window.location.href);
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [mode, setMode] = useState<AuthMode>('signin'),
    [callbackOpen, setCallbackOpen] = useState(false);
  const projectHost = authProjectHost(process.env.NEXT_PUBLIC_SUPABASE_URL);
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
      events = 0,
      recoveryEvent = false;
    const receive = (next: User | null) => {
      if (alive) {
        setUser(next);
        setReady(true);
      }
    };
    const { data } = db.auth.onAuthStateChange((event, session) => {
      events++;
      receive(session?.user || null);
      if (alive && event === 'PASSWORD_RECOVERY' && !callback.current?.failed) {
        recoveryEvent = true;
        setCallbackOpen(true);
        setMode('update');
      }
    });
    void db.auth
      .getSession()
      .then(({ data: session, error: failure }) => {
        if (!alive) return;
        if (failure) setError(failure.message);
        if (events === 0) receive(session.session?.user || null);
        const intent = callback.current || { kind: null, failed: false };
        const result = resolveAuthCallback(
          { ...intent, kind: recoveryEvent ? 'recovery' : intent.kind },
          Boolean(session.session) && !failure,
        );
        if (result) {
          window.history.replaceState(
            {},
            '',
            cleanAuthCallbackURL(window.location.href, result.mode === 'update'),
          );
          setCallbackOpen(true);
          setMode(result.mode);
          setError(result.error);
          setMessage(result.message);
        }
        setReady(true);
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setReady(true);
        }
      });
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
        window.history.replaceState({}, '', cleanAuthCallbackURL(window.location.href));
        setCallbackOpen(false);
        setMode('signin');
      }
      if (action === 'update') {
        setCallbackOpen(false);
        window.history.replaceState({}, '', cleanAuthCallbackURL(window.location.href));
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
  return {
    user,
    ready,
    busy,
    error,
    message,
    mode,
    setMode,
    configured,
    projectHost,
    callbackOpen,
    run,
    open,
  };
}
export type Authentication = ReturnType<typeof useAuthentication>;
