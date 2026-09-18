/**
 * The rail — the spreadsheet a first-timer would otherwise keep beside the
 * book (FR3.9, docs/CHARGEN.md §4.4 "every pool as spent / available … plus
 * the derived numbers as they change").
 *
 * It renders `budgets()` and the derived preview and nothing else: every
 * number comes from the rules engine, run in the browser on every change, so
 * the rail moves on the same render as the tap that moved it. A pool spent
 * past what it holds is red, carries `data-over="yes"`, and says "over by N"
 * in words, because a colour alone tells a colour-blind player nothing and a
 * screen reader less.
 *
 * The derived block is the compiled sheet through `deriveCharacter` — the same
 * initiative, limits and monitors play will use — so the rail never shows a
 * second approximation of them. While a half-made record cannot compile, the
 * block says so rather than showing stale numbers.
 */
import { useId } from 'react';
import type { Budgets, DerivedCharacter } from '@safehouse/contracts';
import { formatNuyen, poolLabel, poolRows, formatPoolValue, type PoolRow } from '../lib.js';

export interface RailProps {
  budgets: Budgets;
  derived: DerivedCharacter | null;
  /** Why there is no derived block, when there is none. */
  previewError?: string | null;
  /** Shown when the campaign's settings could not be read. */
  settingsNote?: string | null;
  className?: string;
}

function PoolLine({ row }: { row: PoolRow }) {
  const f = (n: number) => formatPoolValue(row.unit, n);
  const tone = row.over ? 'text-danger' : row.exact ? 'text-ok' : 'text-ink';
  const fill = row.available > 0 ? Math.min(100, Math.max(0, (row.spent / row.available) * 100)) : row.spent > 0 ? 100 : 0;
  return (
    <li className="py-1.5" data-pool={row.key} data-over={row.over ? 'yes' : 'no'}>
      <span className="sr-only">{poolLabel(row)}</span>
      <div className="flex items-baseline justify-between gap-2" aria-hidden>
        <span className={`text-xs ${row.over ? 'text-danger' : 'text-dim'}`}>{row.label}</span>
        <span className={`font-label text-sm tabular-nums ${tone}`}>
          {f(row.spent)}
          <span className="text-faint"> / {f(row.available)}</span>
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-deck" aria-hidden>
        <div
          className={`h-full rounded-full ${row.over ? 'bg-danger' : row.exact ? 'bg-ok' : 'bg-cyan-dim'}`}
          style={{ width: `${fill}%` }}
        />
      </div>
      {row.over ? (
        <div className="mono-label mt-0.5 text-danger" aria-hidden>
          ✕ over by {f(-row.remaining)}
        </div>
      ) : row.remaining > 0 ? (
        <div className="mono-label mt-0.5 text-faint" aria-hidden>
          {f(row.remaining)} left
        </div>
      ) : null}
    </li>
  );
}

function Stat({ label, value, testId, title }: { label: string; value: string; testId: string; title?: string }) {
  return (
    <div className="rounded-md border border-edge bg-deck px-2 py-1.5" data-testid={testId} {...(title ? { title } : {})}>
      <div className="mono-label text-faint">{label}</div>
      <div className="font-label text-sm tabular-nums text-ink">{value}</div>
    </div>
  );
}

/** Essence to two places, the way the sheet writes it. */
function essence(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

export default function Rail({ budgets, derived, previewError, settingsNote, className }: RailProps) {
  const rows = poolRows(budgets);
  const preview = budgets.preview ?? {};
  const overCount = rows.filter((r) => r.over).length;
  const init = derived?.initiative.physical;
  const titleId = useId();

  return (
    <section className={`panel p-3 ${className ?? ''}`} aria-labelledby={titleId} data-testid="build-rail">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={titleId} className="mono-label text-cyan">
          Pools
        </h2>
        {overCount > 0 && (
          <span className="mono-label text-danger" data-testid="rail-over-count">
            {overCount} overspent
          </span>
        )}
      </div>
      {settingsNote && <p className="mt-1 text-xs text-warn">{settingsNote}</p>}
      <ul className="mt-1 divide-y divide-edge/60" data-testid="rail-pools">
        {rows.map((row) => (
          <PoolLine key={row.key} row={row} />
        ))}
      </ul>

      <h2 className="mono-label mt-3 text-cyan">As it will play</h2>
      <div className="mt-2 grid grid-cols-2 gap-1.5" data-testid="rail-derived">
        <Stat
          label="Essence"
          value={preview.essence !== undefined ? essence(preview.essence) : '6'}
          testId="rail-essence"
        />
        {preview.magic !== undefined && <Stat label="Magic" value={String(preview.magic)} testId="rail-magic" />}
        {preview.resonance !== undefined && (
          <Stat label="Resonance" value={String(preview.resonance)} testId="rail-resonance" />
        )}
        {derived && init && (
          <Stat
            label="Initiative"
            value={`${init.base.value} + ${init.dice.value}D6`}
            testId="rail-initiative"
          />
        )}
        {derived && (
          <Stat
            label="Limits P/M/S"
            value={`${derived.limits.physical.value} / ${derived.limits.mental.value} / ${derived.limits.social.value}`}
            testId="rail-limits"
            title="Physical, Mental and Social limits"
          />
        )}
        {derived && (
          <Stat
            label="Monitors P/S"
            value={`${derived.monitors.physical.value} / ${derived.monitors.stun.value}`}
            testId="rail-monitors"
            title="Physical and Stun condition monitor boxes"
          />
        )}
        {preview.karmaCarried !== undefined && (
          <Stat
            label="Karma to carry"
            value={`${preview.karmaCarried}${preview.karmaLost ? ` (${preview.karmaLost} lost)` : ''}`}
            testId="rail-karma-carried"
          />
        )}
        {preview.nuyenCarried !== undefined && (
          <Stat
            label="Nuyen to carry"
            value={`${formatNuyen(preview.nuyenCarried)}${preview.nuyenLost ? ` (${formatNuyen(preview.nuyenLost)} lost)` : ''}`}
            testId="rail-nuyen-carried"
          />
        )}
      </div>
      {!derived && (
        <p className="mt-2 text-xs text-faint" data-testid="rail-derived-pending">
          {previewError
            ? `Initiative, limits and monitors appear once the build compiles: ${previewError}`
            : 'Initiative, limits and monitors appear once the build compiles.'}
        </p>
      )}
    </section>
  );
}
