/**
 * Initiative ribbon for the table TV (FR9.20): the acting combatant blown up
 * and glowing, the rest of the order trailing behind at readable-from-the-
 * couch size. Public rows only — the server never sends the TV the others.
 *
 * Two shapes, one order. `full` owns the screen when there is no map to own it
 * (P1 behaviour, and any scene-less fight); `strip` lays the same order along
 * the bottom of the map so combat runs *on* the map, which is the whole point
 * of the P2 exit criterion.
 */
import { CONDITION_LABEL, type ConditionBand } from '../table/initiative.js';
import type { TvRibbonRow } from './feed.js';

const BAND_BAR: Record<ConditionBand, { fill: number; className: string }> = {
  fresh: { fill: 0, className: 'bg-ok' },
  scratched: { fill: 1, className: 'bg-ok' },
  wounded: { fill: 2, className: 'bg-warn' },
  bloodied: { fill: 3, className: 'bg-danger' },
  down: { fill: 4, className: 'bg-danger' },
};

/** Coarse public condition as a four-segment bar — no numbers on the TV. */
export function ConditionMeter({ band, wide = false }: { band: ConditionBand; wide?: boolean }) {
  const { fill, className } = BAND_BAR[band];
  return (
    <span className="flex items-center gap-1" title={CONDITION_LABEL[band]}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`${wide ? 'h-2.5 w-7' : 'h-1.5 w-4'} rounded-[2px] ${
            i < fill ? className : 'bg-edge'
          }`}
        />
      ))}
    </span>
  );
}

export interface RibbonProps {
  rows: TvRibbonRow[];
  turn: number;
  pass: number;
  /** Lay the order out as a bottom strip over the map instead of a panel. */
  compact?: boolean;
}

/** "TURN 2 · PASS 1" — clamped, because a fight can sit at 0/0 before its
 *  first roll and the table reads that as "not started" when it has. */
function turnLabel(turn: number, pass: number): string {
  return `TURN ${Math.max(1, turn)} · PASS ${Math.max(1, pass)}`;
}

export default function Ribbon({ rows, turn, pass, compact = false }: RibbonProps) {
  if (rows.length === 0) return null;
  const acting = rows.find((r) => r.acting);
  const rest = rows.filter((r) => !r.acting);

  if (compact) {
    return (
      <section
        className="flex items-center gap-5 rounded-2xl border border-edge bg-ground/85 px-6 py-4 backdrop-blur-sm"
        aria-label="Initiative order"
      >
        <span className="font-label shrink-0 text-lg tracking-[0.3em] text-faint">
          {turnLabel(turn, pass)}
        </span>

        {acting && (
          <div className="tv-acting flex shrink-0 items-center gap-4 rounded-xl border border-cyan-dim bg-panel px-6 py-3">
            <span className="font-label text-4xl font-bold tabular-nums text-cyan">
              {acting.score}
            </span>
            <span className="max-w-[18ch] truncate text-4xl font-bold">{acting.name}</span>
            <ConditionMeter band={acting.band} wide />
          </div>
        )}

        <ol className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          {rest.map((r) => (
            <li
              key={r.id}
              className={`flex shrink-0 items-center gap-3 rounded-lg border border-edge bg-panel/70 px-4 py-2 ${
                r.acted ? 'opacity-45' : ''
              }`}
            >
              <span className="font-label text-2xl font-bold tabular-nums text-dim">{r.score}</span>
              <span className="max-w-[12ch] truncate text-2xl">{r.name}</span>
              <ConditionMeter band={r.band} />
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6" aria-label="Initiative order">
      <div className="flex items-baseline gap-6">
        <span className="font-label text-2xl tracking-[0.35em] text-faint">
          {turnLabel(turn, pass)}
        </span>
      </div>

      {acting && (
        <div className="tv-acting flex items-center gap-8 rounded-2xl border border-cyan-dim bg-panel px-10 py-7">
          <span className="font-label text-7xl font-bold tabular-nums text-cyan">{acting.score}</span>
          <div className="min-w-0">
            <div className="truncate text-6xl font-bold leading-none">{acting.name}</div>
            <div className="mt-3 flex items-center gap-4">
              <span className="font-label text-xl tracking-[0.3em] text-cyan">NOW ACTING</span>
              <ConditionMeter band={acting.band} wide />
            </div>
          </div>
        </div>
      )}

      <ol className="flex flex-wrap gap-3">
        {rest.map((r) => (
          <li
            key={r.id}
            className={`flex items-center gap-4 rounded-xl border border-edge bg-panel/70 px-6 py-3 ${
              r.acted ? 'opacity-45' : ''
            }`}
          >
            <span className="font-label text-3xl font-bold tabular-nums text-dim">{r.score}</span>
            <span className="max-w-[16ch] truncate text-3xl">{r.name}</span>
            <ConditionMeter band={r.band} />
          </li>
        ))}
      </ol>
    </section>
  );
}
