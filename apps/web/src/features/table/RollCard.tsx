/**
 * One roll in the session log (M2): dice faces, hits vs limit, glitch flair,
 * expandable provenance (FR2.6), edge/burn callouts (FR2.3), visibility chip.
 */
import type { RollView } from './views.js';
import { edgeLabel } from './views.js';
import DiceFaces from './DiceFaces.js';

function timeOf(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function RollCard({ roll }: { roll: RollView }) {
  const overLimit = roll.limit && roll.hits > roll.limitedHits;
  const glitched = roll.glitch !== 'none';

  return (
    <article
      className={`panel sh-log-enter p-3 ${roll.glitch === 'critical' ? 'sh-glitch border-danger/70' : glitched ? 'border-warn/50' : ''}`}
    >
      <header className="flex items-baseline gap-2">
        <span className="truncate text-sm font-semibold">{roll.actorName}</span>
        {roll.label && <span className="truncate text-sm text-dim">— {roll.label}</span>}
        {roll.kind !== 'simple' && <span className="chip text-faint">{roll.kind}</span>}
        {roll.visibility !== 'public' && (
          <span className="chip border-magenta-dim text-magenta">
            {roll.visibility === 'gm' ? 'GM only' : 'behind the screen'}
          </span>
        )}
        <span className="mono-label ml-auto shrink-0 text-faint">{timeOf(roll.ts)}</span>
      </header>

      {(roll.burnedEdge || roll.edge) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {roll.edge && (
            <span className="chip border-magenta-dim bg-magenta-dim/15 text-magenta">
              EDGE — {edgeLabel(roll.edge)}
            </span>
          )}
          {roll.burnedEdge && (
            <span className="chip border-danger bg-danger/15 font-bold text-danger">
              EDGE BURNED
            </span>
          )}
        </div>
      )}

      {roll.bought ? (
        <div className="mt-2 text-sm text-dim">
          Bought hits — pool {roll.pool} → <span className="font-semibold text-cyan">{roll.hits} hits</span>
        </div>
      ) : (
        <DiceFaces faces={roll.faces} exploded={roll.exploded} className="mt-2" />
      )}

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-label text-lg font-bold text-cyan">
          {roll.limitedHits} {roll.limitedHits === 1 ? 'hit' : 'hits'}
        </span>
        {overLimit && (
          <span className="text-sm text-faint line-through decoration-danger/60">{roll.hits} rolled</span>
        )}
        {roll.limit && (
          <span className="mono-label">
            limit {roll.limit.kind} {roll.limit.value}
          </span>
        )}
        {roll.ones > 0 && <span className="mono-label text-danger/80">{roll.ones} ones</span>}
        {glitched && (
          <span
            className={`font-label text-sm font-bold uppercase tracking-widest ${
              roll.glitch === 'critical' ? 'text-danger' : 'text-warn'
            }`}
          >
            {roll.glitch === 'critical' ? '☠ CRITICAL GLITCH' : '⚠ GLITCH'}
          </span>
        )}
      </div>

      {roll.breakdown.length > 0 && (
        <details className="mt-2">
          <summary className="mono-label cursor-pointer select-none text-faint hover:text-cyan">
            pool {roll.pool} — provenance
          </summary>
          <ul className="mt-1.5 space-y-0.5 border-l border-edge pl-3">
            {roll.breakdown.map((b, i) => (
              <li key={i} className="flex justify-between gap-4 text-xs text-dim">
                <span>
                  {b.label}
                  {b.source && <span className="text-faint"> · {b.source}</span>}
                </span>
                <span className="font-label">{b.value >= 0 ? `+${b.value}` : b.value}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
