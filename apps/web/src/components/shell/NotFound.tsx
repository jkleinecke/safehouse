/** 404 — dead drop. */
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground p-6 text-ink">
      <div className="panel max-w-sm p-8 text-center">
        <div className="mono-label text-magenta">404 / dead drop</div>
        <p className="mt-3 text-sm text-dim">Nothing at this address, chummer.</p>
        <Link to="/" className="btn btn-accent mt-6">
          Back to the safehouse
        </Link>
      </div>
    </main>
  );
}
