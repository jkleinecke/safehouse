/**
 * Who is holding the spell up (FR8.2 × FR8.3).
 *
 * Sustaining costs the caster −2 dice on everything *unless something else is
 * carrying it* — a focus, a quickening, or a spirit ordered to hold it. All
 * three read identically here, because on the server they are one `exempt`
 * toggle, so a pool never gets two different answers depending on who asked.
 *
 * Rows tagged `sheet` came from the older convention that carried the −2 as a
 * modifier on the sheet itself. They are shown and releasable so a pre-existing
 * toggle can never become an invisible penalty; new ones are always server-side
 * entries, which are the only kind a spirit can be handed.
 */
import { exemptionPhrase, sustainingPenaltyOf, type SustainedRow } from './lib.js';
import type { SpiritRow } from './types.js';
import { signed } from '../lib.js';
import { Empty, SectionLabel } from '../components/ui.js';

export interface SustainedListProps {
  rows: SustainedRow[];
  /** Spirits that could take a spell over — summoned, this character's. */
  spirits: SpiritRow[];
  onRelease: (row: SustainedRow) => void;
  onSetExempt: (row: SustainedRow, exempt: boolean) => void;
  /** `spiritId` null takes the spell back off whichever spirit holds it. */
  onHandToSpirit: (row: SustainedRow, spiritId: string | null) => void;
  busy?: boolean;
}

export default function SustainedList(props: SustainedListProps) {
  const penalty = sustainingPenaltyOf(props.rows);

  return (
    <>
      <SectionLabel>
        Sustaining — {props.rows.length === 0 ? 'nothing' : `${signed(penalty)} to your pools`}
      </SectionLabel>
      {props.rows.length === 0 && <Empty>Nothing being held up.</Empty>}
      <ul className="divide-y divide-edge/60">
        {props.rows.map((row) => (
          <SustainedRowView key={`${row.origin}:${row.id}`} row={row} {...props} />
        ))}
      </ul>
    </>
  );
}

function SustainedRowView({
  row,
  spirits,
  onRelease,
  onSetExempt,
  onHandToSpirit,
  busy,
}: { row: SustainedRow } & SustainedListProps) {
  const holder = row.spiritId ?? '';
  const canHandOver = row.origin === 'play' && spirits.length > 0;

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-ink">{row.name}</div>
          <div className={`mono-label ${row.exempt ? 'text-cyan' : 'text-magenta'}`}>
            {exemptionPhrase(row)}
          </div>
        </div>
        <button
          type="button"
          className="chip shrink-0 text-faint"
          disabled={busy === true}
          onClick={() => onRelease(row)}
          aria-label={`Stop sustaining ${row.name}`}
        >
          Drop it
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {row.origin === 'play' ? (
          <button
            type="button"
            className={`chip ${row.exemptBy === 'focus_or_quickening' ? 'border-cyan-dim text-cyan' : 'text-dim'}`}
            aria-pressed={row.exemptBy === 'focus_or_quickening'}
            disabled={row.exemptBy === 'spirit' || busy === true}
            onClick={() => onSetExempt(row, !row.exempt)}
            aria-label={
              row.exemptBy === 'spirit'
                ? `${row.name} is held by ${row.spiritName ?? 'a spirit'} — take it back first`
                : row.exempt
                  ? `${row.name} is exempt from the −2 — activate to carry it yourself again`
                  : `${row.name} costs you −2 — activate to mark a focus or quickening as carrying it`
            }
          >
            Focus / quickening
          </button>
        ) : (
          <span className="chip text-faint">carried on the sheet</span>
        )}

        {canHandOver && (
          <label className="inline-flex items-center gap-1.5">
            <span className="mono-label">Spirit</span>
            <select
              className="rounded border border-edge bg-ground px-2 py-1 text-xs text-ink"
              value={holder}
              disabled={busy === true}
              onChange={(e) => onHandToSpirit(row, e.target.value === '' ? null : e.target.value)}
              aria-label={`Which spirit holds ${row.name}`}
            >
              <option value="">nobody — you carry it</option>
              {spirits.map((spirit) => (
                <option key={spirit.id} value={spirit.id}>
                  {spirit.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </li>
  );
}
