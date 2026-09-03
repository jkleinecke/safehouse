/**
 * "Signed in as … / switch device" (FR1.1/1.3).
 *
 * The header affordance that makes the per-(campaign, role) session store
 * visible: which device this tab is using, every other device paired in this
 * browser, and a one-tap switch between them. A GM keeping a player view open
 * on the same laptop is a normal thing to do — so is running two tables — and
 * this is where they hop between them.
 *
 * Switching only re-pins THIS tab (`switchSession`), so the other tab keeps
 * whatever it had and no other campaign's token is touched. Sign-out drops
 * this one session; "sign out everywhere" clears the browser.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Role } from '@safehouse/contracts';
import {
  clearAllSessions,
  clearSession,
  listSessions,
  sessionKey,
  switchSession,
  type Session,
} from '../../api/session.js';
import { resetClientState } from './signin-api.js';
import { destinationFor, roleLabel } from './signin.js';

export interface SessionMenuProps {
  /** The session this tab is currently using. */
  role: Role;
  /** …and the campaign half of it: two tables can both be held as `gm`. */
  campaignId: string;
  displayName?: string;
}

/** What tells two rows apart at a glance: the table, then the device. */
function where(session: Session): string {
  return session.campaignName ?? session.displayName ?? session.campaignId.slice(0, 6);
}

export default function SessionMenu({ role, campaignId, displayName }: SessionMenuProps) {
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

  const here = sessionKey({ role, campaignId });
  const others = sessions.filter((s) => sessionKey(s) !== here);
  const current = sessions.find((s) => sessionKey(s) === here);

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
          className="panel absolute right-0 top-full z-50 mt-1.5 w-64 p-3 shadow-glow-cyan"
        >
          <div className="mono-label text-faint">Signed in as</div>
          <div className="mt-0.5 truncate text-sm text-ink">
            {displayName ?? roleLabel(role)}
            <span className="mono-label ml-2 text-cyan">{role}</span>
          </div>
          <div className="mono-label truncate text-faint">
            {current?.campaignName ?? campaignId.slice(0, 8)}
          </div>

          {others.length > 0 && (
            <>
              <div className="mono-label mt-3 text-faint">Switch this tab to</div>
              <ul className="mt-1 space-y-1">
                {others.map((s) => (
                  <li key={sessionKey(s)}>
                    <button
                      type="button"
                      role="menuitem"
                      className="btn w-full justify-between gap-2 px-2.5 py-1"
                      data-campaign={s.campaignId}
                      data-role={s.role}
                      aria-label={`Switch this tab to ${roleLabel(s.role)} on ${where(s)}`}
                      onClick={() => {
                        const next = switchSession(s.role, s.campaignId);
                        resetClientState();
                        setOpen(false);
                        if (next) navigate(destinationFor(next), { replace: true });
                      }}
                    >
                      <span className="shrink-0">{roleLabel(s.role)}</span>
                      <span className="mono-label min-w-0 truncate text-faint">{where(s)}</span>
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
              className="btn px-2.5 py-1"
              onClick={() => {
                // Not sign-out: every stored session survives. This is the way
                // back to the front door's list, which on an open table is
                // every campaign on the server and not just the ones this
                // browser already holds a device for.
                setOpen(false);
                navigate('/?pick=1');
              }}
            >
              all campaigns on this server
            </button>
            <button
              type="button"
              role="menuitem"
              className="btn px-2.5 py-1 text-danger"
              onClick={() => {
                // This session only: the GM's other table, and their player
                // view on this one, both survive.
                clearSession(role, campaignId);
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
