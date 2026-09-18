/**
 * /join/:code — QR-join flow (DESIGN.md FR1.1/1.3). This is the SPA route the
 * QR encodes; the token endpoint is /api/join/:code (LIVE-3 — they used to
 * share a path, so scanning showed raw JSON).
 *
 * Peeks the code first (`GET /api/join/:code/peek`, spends nothing). A player
 * or observer invite asks for a name before redeeming, so the table sees who
 * joined instead of a row of "Guest"s; a TV display or a GM pairing code has
 * no one to name and redeems straight away. Redeeming (`POST /api/join/:code`)
 * stores token+role+campaign, then routes by role: display → /tv/:id,
 * player → /c/:id/welcome (onboarding), gm/observer → the usual home.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client.js';
import { peekJoinCode, useRedeemCode, type JoinPeek } from './signin-api.js';
import { destinationFor } from './signin.js';

/** Remembered so a returning player (new phone, cleared session) is prefilled. */
const NAME_KEY = 'safehouse.join.name';

function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function describe(err: unknown): string {
  return err instanceof ApiError ? `${err.code}: ${err.message}` : 'Could not reach the table server.';
}

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const redeem = useRedeemCode();
  const [peek, setPeek] = useState<JoinPeek | null>(null);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [name, setName] = useState(rememberedName);

  const join = (displayName?: string) => {
    if (!code) return;
    redeem.mutate(
      { code, ...(displayName ? { name: displayName } : {}) },
      // Stored in this role's own slot, so pairing a player view on the GM's
      // laptop no longer clobbers the GM session (see api/session.ts).
      // A new player goes on to onboarding (pick, upload or build a runner);
      // the welcome step forwards anyone who already has one.
      {
        onSuccess: (session) =>
          navigate(
            session.role === 'player' ? `/c/${session.campaignId}/welcome` : destinationFor(session),
            { replace: true },
          ),
      },
    );
  };

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    peekJoinCode(code)
      .then((p) => {
        if (cancelled) return;
        setPeek(p);
        if (p.role === 'display' || p.role === 'gm') join();
      })
      .catch((err: unknown) => {
        if (!cancelled) setPeekError(describe(err));
      });
    return () => {
      cancelled = true;
    };
    // `join` is recreated every render; the peek runs once per code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      localStorage.setItem(NAME_KEY, trimmed);
    } catch {
      // Private mode — the name still goes to the server, just not remembered.
    }
    join(trimmed);
  };

  const error = peekError ?? (redeem.error ? describe(redeem.error) : null);
  const asksName = peek !== null && (peek.role === 'player' || peek.role === 'observer');

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground p-6 text-ink">
      <div className="panel w-full max-w-sm p-8 text-center">
        <div className="mono-label text-cyan">Safehouse</div>
        {error ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-magenta">Join failed</h1>
            <p className="mt-2 text-sm text-dim">{error}</p>
            <p className="mono-label mt-6">Ask the GM for a fresh QR</p>
          </>
        ) : asksName && !redeem.isPending && !redeem.isSuccess ? (
          <form className="mt-4 space-y-4 text-left" onSubmit={onSubmit}>
            <h1 className="text-center text-lg font-semibold">
              Joining <span className="text-cyan">{peek.campaignName}</span>
            </h1>
            <label className="block">
              <span className="mono-label block">Your name</span>
              <input
                className="mt-1 w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What the table calls you"
                maxLength={100}
                autoComplete="nickname"
                autoFocus
                required
              />
            </label>
            <button className="btn btn-accent w-full" type="submit" disabled={!name.trim()}>
              jack in
            </button>
          </form>
        ) : (
          <>
            <h1 className="mt-4 animate-pulse text-lg font-semibold">Jacking in…</h1>
            <p className="mt-2 text-sm text-dim">Minting a device token for this device.</p>
          </>
        )}
      </div>
    </main>
  );
}
