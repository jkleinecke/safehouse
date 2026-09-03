/**
 * What a tab does when the server says its token is dead.
 *
 * `getSession()` is pure storage: it cannot tell a live token from a revoked
 * one. So a GM whose device had been revoked (or whose campaign was restored
 * from a backup) got the entire console — sidebar, Fixer dock, QR button —
 * rendering over a token that 401'd every call, with no message anywhere and
 * no way out but a menu item they had no reason to open. The socket made it
 * worse: the server closes an unauthorized WS with 4401 and the client
 * reconnects forever, so the only visible symptom was "offline".
 *
 * `api/client.ts` now retires the exact token a 401 came back for and
 * announces it. This hook is the other half: the tab holding that token — and
 * only that tab — resets its caches and returns to the front door, where the
 * campaign picker can offer the sessions that are still good. A tab on a
 * different campaign or a different role keeps working, which is why the
 * comparison is on the token and not on "something expired somewhere".
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SESSION_EXPIRED_EVENT, type SessionExpiredDetail } from '../../api/client.js';
import { resetClientState } from './signin-api.js';

export function useSessionExpiry(token: string | undefined): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (!token || typeof window === 'undefined') return;

    const onExpired = (event: Event) => {
      const detail = (event as CustomEvent<SessionExpiredDetail>).detail;
      if (!detail || detail.token !== token) return;
      resetClientState();
      // `expired` is what stops the bounce: the front door would otherwise see
      // another stored session and send this tab straight back in.
      navigate('/?expired=1', { replace: true });
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [navigate, token]);
}

export default useSessionExpiry;
