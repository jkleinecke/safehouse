/**
 * Root path — an already-joined device bounces to its campaign (displays to
 * the TV view); a fresh one gets the "scan the QR" card.
 */
import { Navigate } from 'react-router-dom';
import { getSession } from '../../api/session.js';

export default function Landing() {
  const session = getSession();
  if (session) {
    const dest =
      session.role === 'display' ? `/tv/${session.campaignId}` : `/c/${session.campaignId}`;
    return <Navigate to={dest} replace />;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground p-6 text-ink">
      <div className="panel max-w-sm p-8 text-center">
        <div className="font-label text-xl tracking-[0.35em] text-cyan">SAFEHOUSE</div>
        <p className="mt-2 text-sm text-dim">The place the team plans the run.</p>
        <div className="mono-label mt-6 text-magenta">No device token</div>
        <p className="mt-2 text-sm text-dim">
          Scan the join QR the GM shows at the table to jack in.
        </p>
      </div>
    </main>
  );
}
