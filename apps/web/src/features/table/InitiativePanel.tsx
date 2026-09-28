/**
 * The call for initiative (SR5 p.159): every row's recipe with a page chip on
 * each line, and three ways in per row — the app's dice, the table's dice
 * total, or a final score. Nothing waits on a phone: the GM can fill any row,
 * and a runner fills their own. Blank rows can start the turn and join late (p.160).
 */
import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Encounter, InitiativeCall, InitiativeRecipe, ProvenanceEntry } from '@safehouse/contracts';
import { RefChip } from '../gm/books/RefChip.js';
import {
  fetchInitiativeCall,
  postEnterInitiative,
  postRollNpcs,
  postStartTurn,
  type InitiativeInput,
} from './commands.js';
import { formatModifier } from './initiative.js';

export interface InitiativePanelProps {
  encounter: Encounter;
  isGm: boolean;
  /** Offered when the panel was opened over a running turn. */
  onClose?: () => void;
}

/** Changes whenever a frame could have changed a recipe or an entry, so the call is read again. */
function callSignature(e: Encounter): string {
  const rows = (e.combatants ?? []).map(
    (c) => `${c.id}:${c.initScore}:${c.initBase}:${c.initDice}:${c.monitors.physical.filled}:${c.monitors.stun.filled}`,
  );
  return [e.turn, e.pass, e.gathering ? 1 : 0, ...rows].join('|');
}

/** "9 + 3d6 −2": the line a table reads aloud. */
export function recipeLine(r: Pick<InitiativeRecipe, 'base' | 'dice' | 'modifier'>): string {
  return `${r.base} + ${r.dice}d6${r.modifier !== 0 ? ` ${formatModifier(r.modifier)}` : ''}`;
}

/** How the score came in, in a few words. */
function entryNote(r: InitiativeRecipe): string {
  const e = r.entry;
  if (!e) return '';
  const how =
    e.via === 'app'
      ? `app dice ${e.rolls && e.rolls.length > 0 ? e.rolls.join(' ') : (e.rolled ?? '')}`
      : e.via === 'dice'
        ? `table dice ${e.rolled ?? ''}`
        : 'typed';
  return e.by === 'player' ? `${how} · player` : how;
}

function Line({ l, text }: { l: ProvenanceEntry; text: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {text}
      {l.ref && <RefChip refValue={l.ref} className="py-0 text-[0.6rem]" />}
    </span>
  );
}

function NumberEntry({
  label,
  placeholder,
  min,
  max,
  onCommit,
}: {
  label: string;
  placeholder: string;
  min?: number;
  max?: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const t = draft.trim();
    setDraft('');
    if (t === '') return;
    const n = Math.trunc(Number(t));
    if (!Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) return;
    onCommit(n);
  };
  return (
    <input
      value={draft}
      inputMode="numeric"
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft('');
          e.currentTarget.blur();
        }
      }}
      aria-label={label}
      title={label}
      className="w-20 rounded border border-edge bg-deck px-1.5 py-0.5 text-center font-label text-xs tabular-nums outline-none placeholder:text-faint focus:border-cyan pointer-coarse:min-h-9"
    />
  );
}

function RecipeRow({
  r,
  busy,
  onEnter,
}: {
  r: InitiativeRecipe;
  busy: boolean;
  onEnter: (input: InitiativeInput) => void;
}) {
  const missing = !r.entry;
  return (
    <li
      className={`rounded border px-2 py-1.5 ${missing ? 'border-warn/70 bg-warn/5' : 'border-edge'}`}
      data-missing={missing ? 'yes' : 'no'}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-semibold">{r.name}</span>
        <span className="font-label text-sm tabular-nums text-ink">{recipeLine(r)}</span>
        <RefChip refValue={r.ref} className="py-0 text-[0.6rem]" />
        <span className="ml-auto flex items-baseline gap-1.5">
          {r.entry ? (
            <>
              <span className="text-[0.65rem] text-faint">{entryNote(r)}</span>
              <span className="font-label text-lg font-bold tabular-nums text-cyan">{r.entry.score}</span>
            </>
          ) : (
            <span className="mono-label text-warn">missing</span>
          )}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-dim">
        {r.baseLines.map((l, i) => (
          <Line
            key={`b${i}`}
            l={l}
            text={`${l.label} ${i > 0 && l.source !== 'attribute' ? formatModifier(l.value) : l.value}`}
          />
        ))}
        {r.diceLines.map((l, i) => (
          <Line key={`d${i}`} l={l} text={i === 0 ? l.label : `${l.label} ${formatModifier(l.value)}d6`} />
        ))}
        {r.modifiers.map((l, i) => (
          <Line key={`m${i}`} l={l} text={`${l.label} ${formatModifier(l.value)}`} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="btn px-2 py-0.5 pointer-coarse:min-h-9"
          disabled={busy}
          onClick={() => onEnter({ app: true })}
          title={`The app rolls ${r.dice}d6`}
        >
          Roll here
        </button>
        <NumberEntry
          label={`Dice total for ${r.name}`}
          placeholder={`${r.dice}d6 total`}
          min={0}
          max={30}
          onCommit={(n) => onEnter({ rolled: n })}
        />
        <NumberEntry label={`Final score for ${r.name}`} placeholder="score" onCommit={(n) => onEnter({ score: n })} />
      </div>
    </li>
  );
}

export default function InitiativePanel({ encounter, isGm, onClose }: InitiativePanelProps) {
  const qc = useQueryClient();
  const key = ['initiative', encounter.id, callSignature(encounter)] as const;
  const call = useQuery({
    queryKey: key,
    queryFn: () => fetchInitiativeCall(encounter.id),
    placeholderData: keepPreviousData,
    staleTime: 5_000,
    retry: 0,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'That did not go through.');
  const put = (next: InitiativeCall) => qc.setQueryData(key, next);

  const enter = (combatantId: string, input: InitiativeInput) => {
    setBusyId(combatantId);
    setError(null);
    postEnterInitiative(combatantId, input)
      .then(({ recipe }) => {
        const held = qc.getQueryData<InitiativeCall>(key);
        if (held) put({ ...held, rows: held.rows.map((r) => (r.combatantId === combatantId ? recipe : r)) });
      })
      .catch(fail)
      .finally(() => setBusyId(null));
  };
  const rollNpcs = () => {
    setBusyId('npcs');
    setError(null);
    postRollNpcs(encounter.id)
      .then(put)
      .catch(fail)
      .finally(() => setBusyId(null));
  };
  const start = () => {
    setBusyId('start');
    setError(null);
    postStartTurn(encounter.id)
      .then(() => onClose?.())
      .catch(fail)
      .finally(() => setBusyId(null));
  };

  const rows = call.data?.rows ?? [];
  // A runner with no row of their own in this fight has nothing to fill.
  if (!isGm && rows.length === 0) return null;
  const blank = rows.filter((r) => !r.entry).length;
  const gathering = encounter.gathering === true;

  return (
    <section className="border-b border-edge bg-raised/30 px-3 py-2" aria-label="Initiative">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono-label text-cyan">{isGm ? 'Initiative' : 'Your initiative'}</span>
        <span className="mono-label text-faint">turn {Math.max(1, encounter.turn)}</span>
        {isGm && rows.length > 0 && (
          <span className={`mono-label ${blank > 0 ? 'text-warn' : 'text-ok'}`}>
            {rows.length - blank} of {rows.length} in
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {isGm && (
            <button type="button" className="btn px-2 py-1" disabled={busyId !== null} onClick={rollNpcs}>
              Roll all NPCs
            </button>
          )}
          {isGm && gathering && (
            <button
              type="button"
              className="btn btn-accent px-2 py-1"
              disabled={busyId !== null}
              onClick={start}
              title={blank > 0 ? 'Blank rows start the turn without a score and join when it comes in (p.160)' : undefined}
            >
              Start the turn
            </button>
          )}
          {onClose && !gathering && (
            <button type="button" className="btn px-2 py-1" onClick={onClose}>
              Done
            </button>
          )}
        </span>
      </div>
      {isGm && gathering && blank > 0 && (
        <p className="mt-1 text-xs text-faint">
          {blank} still blank. You can start anyway: they join late when their score comes in.
        </p>
      )}
      {call.isError && !call.data && <p className="mt-1 text-xs text-warn">Could not read the recipes. Retrying on the next change.</p>}
      {error && <p className="mt-1 text-xs text-warn">{error}</p>}
      <ul className="mt-1.5 flex max-h-[45dvh] flex-col gap-1.5 overflow-y-auto">
        {rows.map((r) => (
          <RecipeRow key={r.combatantId} r={r} busy={busyId !== null} onEnter={(input) => enter(r.combatantId, input)} />
        ))}
      </ul>
    </section>
  );
}
