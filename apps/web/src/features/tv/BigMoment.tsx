/**
 * A public roll, billboard-sized (FR9.20). Faces animate in, hits land in
 * huge type, and glitches get the drama they deserve — the whole point of a
 * screen the whole table is already looking at.
 */
import { edgeLabel } from '../table/views.js';
import { momentDrama, type TvMoment } from './feed.js';

function dieClass(face: number): string {
  if (face >= 5) return 'border-cyan text-cyan bg-[#082530]';
  if (face === 1) return 'border-danger/70 text-danger bg-[#2a0d12]';
  return 'border-edge-bright text-dim bg-raised';
}

/** Faces are capped for layout — a 30-die pool still has to fit on a TV. */
const FACE_CAP = 24;

export default function BigMoment({ moment }: { moment: TvMoment }) {
  const drama = momentDrama(moment);
  const faces = moment.faces.slice(0, FACE_CAP);
  const hidden = moment.faces.length - faces.length;

  const frame =
    drama === 'critical'
      ? 'tv-crit border-danger'
      : drama === 'glitch'
        ? 'border-warn'
        : drama === 'edge'
          ? 'border-magenta'
          : 'border-edge-bright';

  return (
    <section
      className={`tv-moment w-full rounded-3xl border-2 bg-panel/90 px-10 py-8 ${frame}`}
      aria-label="Roll result"
    >
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span className="text-5xl font-bold">{moment.actorName}</span>
        {moment.label && <span className="text-4xl text-dim">{moment.label}</span>}
        <span className="font-label ml-auto text-2xl tracking-[0.3em] text-faint">
          {moment.pool}d6
        </span>
      </header>

      {(moment.edge || moment.burnedEdge) && (
        <div className="mt-4 flex flex-wrap gap-3">
          {moment.edge && (
            <span className="font-label rounded-full border border-magenta px-5 py-1.5 text-2xl tracking-[0.25em] text-magenta">
              EDGE — {edgeLabel(moment.edge)}
            </span>
          )}
          {moment.burnedEdge && (
            <span className="font-label rounded-full border border-danger bg-danger/15 px-5 py-1.5 text-2xl font-bold tracking-[0.25em] text-danger">
              EDGE BURNED
            </span>
          )}
        </div>
      )}

      {moment.bought ? (
        <div className="mt-6 text-4xl text-dim">Bought hits — no roll</div>
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {faces.map((f, i) => (
            <span
              key={`f${i}`}
              className={`tv-die inline-flex h-16 w-16 items-center justify-center rounded-xl border-2 font-label text-3xl font-bold ${dieClass(f)}`}
              style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}
            >
              {f}
            </span>
          ))}
          {hidden > 0 && <span className="font-label text-3xl text-faint">+{hidden}</span>}
          {moment.exploded.length > 0 && (
            <>
              <span className="font-label text-3xl text-magenta">6!</span>
              {moment.exploded.slice(0, 8).map((f, i) => (
                <span
                  key={`x${i}`}
                  className={`tv-die inline-flex h-16 w-16 items-center justify-center rounded-xl border-2 ring-4 ring-magenta/60 font-label text-3xl font-bold ${dieClass(f)}`}
                >
                  {f}
                </span>
              ))}
            </>
          )}
        </div>
      )}

      <footer className="mt-7 flex flex-wrap items-baseline gap-x-10 gap-y-3">
        <span className="font-label text-8xl font-bold leading-none text-cyan">
          {moment.limitedHits}
          <span className="ml-4 text-3xl tracking-[0.3em] text-dim">
            {moment.limitedHits === 1 ? 'HIT' : 'HITS'}
          </span>
        </span>
        {moment.limit && moment.hits > moment.limitedHits && (
          <span className="text-3xl text-faint">
            <span className="line-through decoration-danger/60">{moment.hits}</span> over limit{' '}
            {moment.limit.value}
          </span>
        )}
        {drama === 'glitch' && (
          <span className="tv-glitch font-label text-5xl font-bold tracking-[0.2em] text-warn">
            ⚠ GLITCH
          </span>
        )}
        {drama === 'critical' && (
          <span className="tv-glitch font-label text-5xl font-bold tracking-[0.2em] text-danger">
            ☠ CRITICAL GLITCH
          </span>
        )}
      </footer>
    </section>
  );
}
