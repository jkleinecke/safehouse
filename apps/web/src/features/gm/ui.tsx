/** Small shared UI atoms for GM screens (desktop-first, theme classes). */
import type { ReactNode } from 'react';
import { getSession } from '../../api/session.js';

/** GM-only gate: DESIGN §13 filters server-side; this is just honest UI. */
export function GmGuard({ children }: { children: ReactNode }) {
  const session = getSession();
  if (session?.role !== 'gm') {
    return (
      <div className="p-6">
        <div className="panel max-w-sm p-6 text-center">
          <div className="mono-label text-magenta">GM only</div>
          <p className="mt-2 text-sm text-dim">
            This console needs a GM device. The server filters GM data either way.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="mono-label text-cyan">{children}</div>
      {hint && <div className="mono-label text-faint">{hint}</div>}
    </div>
  );
}

/** Labeled field row. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mono-label block">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-cyan focus:outline-none';

/** The "clearly labeled estimates" badge (FR10.5, Principle 3). */
export function EstBadge() {
  return <span className="chip border-warn/40 text-warn">est</span>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
      {message}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="mono-label inline-flex animate-pulse items-center gap-2 text-cyan">
      <span aria-hidden>▮▮▯</span>
      {label ?? 'working'}
    </span>
  );
}
