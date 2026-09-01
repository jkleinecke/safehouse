/**
 * 404 — dead drop.
 *
 * The catch-all used to offer one link to `/`, which for a signed-in device is
 * a redirect back to where they already were. If this browser holds a session
 * it now offers the two doors that are actually useful: the campaign, and the
 * GM console when this device runs one.
 */
import { Link, useLocation } from 'react-router-dom';
import { getSession } from '../../api/session.js';

export default function NotFound() {
  const session = getSession();
  const { pathname } = useLocation();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground p-6 text-ink">
      <div className="panel max-w-sm p-8 text-center">
        <div className="mono-label text-magenta">404 / dead drop</div>
        <p className="mt-3 text-sm text-dim">Nothing at this address, chummer.</p>
        <code className="mono-label mt-2 block break-all text-faint">{pathname}</code>

        <div className="mt-6 flex flex-col gap-2">
          {session && (
            <Link to={`/c/${session.campaignId}`} className="btn btn-accent">
              Back to the table
            </Link>
          )}
          {session?.role === 'gm' && (
            <Link to={`/c/${session.campaignId}/gm`} className="btn">
              GM console
            </Link>
          )}
          <Link to="/" className={session ? 'btn' : 'btn btn-accent'}>
            {session ? 'Switch device' : 'Back to the safehouse'}
          </Link>
        </div>
      </div>
    </main>
  );
}
