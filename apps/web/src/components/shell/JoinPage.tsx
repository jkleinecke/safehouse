/**
 * /join/:code — QR-join flow (DESIGN.md FR1.1/1.3).
 * Calls GET /join/:code (anonymous), stores token+role+campaign, then routes
 * by role: display → /tv/:id, player/gm/observer → /c/:id.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client.js';
import { saveSession, type JoinResponse } from '../../api/session.js';

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;

    api<JoinResponse>(`/join/${code}`, { anonymous: true })
      .then((join) => {
        if (cancelled) return;
        saveSession({
          token: join.token,
          role: join.role,
          campaignId: join.campaignId,
          deviceId: join.deviceId,
          userId: join.user?.id,
          displayName: join.user?.displayName,
        });
        const dest =
          join.role === 'display' ? `/tv/${join.campaignId}` : `/c/${join.campaignId}`;
        navigate(dest, { replace: true });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? `${err.code}: ${err.message}`
            : 'Could not reach the table server.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

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
        ) : (
          <>
            <h1 className="mt-4 animate-pulse text-lg font-semibold">Jacking in…</h1>
            <p className="mt-2 text-sm text-dim">Minting a device token for this phone.</p>
          </>
        )}
      </div>
    </main>
  );
}
