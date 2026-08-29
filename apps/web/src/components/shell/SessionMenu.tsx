/**
 * "Signed in as … / switch device" (FR1.1/1.3).
 *
 * The header affordance that makes the per-role session store visible: which
 * device this tab is using, every other device paired in this browser, and a
 * one-tap switch between them. A GM keeping a player view open on the same
 * laptop is a normal thing to do — this is where they hop back.
 *
 * Switching only re-pins THIS tab (`switchSession`), so the other tab keeps
 * whatever it had. Sign-out drops one role's token; "sign out everywhere"
 * clears the browser.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Role } from '@safehouse/contracts';
import { clearAllSessions, clearSession, listSessions, switchSession } from '../../api/session.js';
import { resetClientState } from './signin-api.js';
import { destinationFor, roleLabel } from './signin.js';

export interface SessionMenuProps {
  /** The session this tab is currently using. */
  role: Role;
  displayName?: string;
}

export default function SessionMenu({ role, displayName }: SessionMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sessions = listSessions();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const others = sessions.filter((s) => s.role !== role);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        className="chip cursor-pointer border-edge-bright text-dim hover:border-cyan hover:text-cyan"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sr-only">Signed in as </span>
        {roleLabel(role)}
        <span aria-hidden>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Device sessions"
          className="panel absolute right-0 top-full z-50 mt-1.5 w-60 p-3 shadow-glow-cyan"
        >
          <div className="mono-label text-faint">Signed in as</div>
          <div className="mt-0.5 truncate text-sm text-ink">
            {displayName ?? roleLabel(role)}
            <span className="mono-label ml-2 text-cyan">{role}</span>
          </div>

          {others.length > 0 && (
            <>
              <div className="mono-label mt-3 text-faint">Switch this tab to</div>
              <ul className="mt-1 space-y-1">
                {others.map((s) => (
                  <li key={s.role}>
                    <button
                      type="button"
                      role="menuitem"
                      className="btn w-full justify-between px-2.5 py-1"
                      aria-label={`Switch this tab to ${roleLabel(s.role)}${
                        s.displayName ? ` (${s.displayName})` : ''
                      }`}
                      onClick={() => {
                        const next = switchSession(s.role);
                        resetClientState();
                        setOpen(false);
                        if (next) navigate(destinationFor(next), { replace: true });
                      }}
                    >
                      <span>{roleLabel(s.role)}</span>
                      <span className="mono-label text-faint">
                        {s.displayName ?? s.campaignId.slice(0, 6)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-3 flex flex-col gap-1 border-t border-edge pt-3">
            <button
              type="button"
              role="menuitem"
              className="btn px-2.5 py-1 text-danger"
              onClick={() => {
                clearSession();
                resetClientState();
                setOpen(false);
                navigate('/', { replace: true });
              }}
            >
              sign this device out
            </button>
            {sessions.length > 1 && (
              <button
                type="button"
                role="menuitem"
                className="btn px-2.5 py-1 text-danger"
                onClick={() => {
                  clearAllSessions();
                  resetClientState();
                  setOpen(false);
                  navigate('/', { replace: true });
                }}
              >
                sign out everywhere
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
