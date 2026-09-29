/**
 * One combatant on the tracker (FR4.2–4.10). Score, condition, statuses, and
 * — for the GM — hand-edit, interrupts, damage, and the NPC copilot rack.
 * The acting row glows; spent rows dim but stay on screen (FR4.8).
 *
 * The initiative line reads the way a table needs it: `8+2d6` beside the
 * name is "roll two dice and add eight". A blank line shows "—", never a 0
 * ranked first. The GM types the score, or — in hand-rolls mode — the dice
 * total, and the server adds base and wounds; a runner does the same for
 * their own row from their phone (FR4.2).
 *
 * The row is also a place on the order strip: its state this pass, the
 * Action Phases it has left, and the GM's levers on its place (▲/▼ or drag,
 * Act now, Delay) — a place only, never a score (SR5 p.159-161).
 */
import { useEffect, useState, type DragEvent } from 'react';
import type { Combatant, Exchange } from '@safehouse/contracts';
import { openGmCard } from '../combat/gmCard.js';
import GmIncoming, { AppliedLines } from '../combat/GmIncoming.js';
import { rackStart } from '../combat/gmModel.js';
import { hasCopilotRack } from './copilot.js';
import {
  deleteCombatant,
  deleteEffect,
  patchCombatant,
  patchCombatantLocal,
  postEnterInitiative,
  postSetInitiative,
  removeCombatantLocal,
} from './commands.js';
import CopilotRack from './CopilotRack.js';
import HintLine from './HintLine.js';
import InterruptMenu from './InterruptMenu.js';
import MonitorBar from './MonitorBar.js';
import StatusChips from './StatusChips.js';
import { formatModifier, scoreFromRolled, type RowState, type TrackerRow } from './initiative.js';

/** The GM's levers on one row's place (the tracker wires them to `POST /order` and `/delay`). */
export interface RowOrderControls {
  onStep: (dir: -1 | 1) => void;
  onActNow: () => void;
  onDelay: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}

export interface CombatantRowProps {
  campaignId: string;
  encounterId: string;
  row: TrackerRow;
  isGm: boolean;
  /** The fight is running: rows can be rolled and entered. */
  live?: boolean;
  /** GM preference: type dice totals rather than scores (FR4.2). */
  handRolls?: boolean;
  /** Visibility for copilot rack rolls (tracker header toggles it). */
  rackVisibility: 'gm' | 'public';
  onRoll?: (c: Combatant) => void;
  onDamage: (c: Combatant, track?: 'physical' | 'stun') => void;
  onOpenChain: (combatantId: string) => void;
  /** GM, fight running: move, call, delay. */
  orderControls?: RowOrderControls;
  /** GM: the open attacks on this row. */
  incoming?: readonly Exchange[];
}

const STATE_LABEL: Partial<Record<RowState, { text: string; cls: string; title: string }>> = {
  acting: { text: 'acting', cls: 'text-cyan', title: 'Taking their Action Phase now' },
  next: { text: 'next', cls: 'text-magenta', title: 'Up after the one acting' },
  delayed: { text: 'delayed', cls: 'text-warn', title: 'Holding a Delayed Action: Next steps over it until Act now (p.161)' },
  acted: { text: 'acted', cls: 'text-faint', title: 'Has acted this pass' },
  out: { text: 'out', cls: 'text-faint', title: 'No Action Phase left this pass (p.159)' },
};

const INIT_KIND_LABEL: Record<string, string> = {
  physical: 'PHYS',
  astral: 'ASTRAL',
  matrix_ar: 'AR',
  vr_cold: 'VR COLD',
  vr_hot: 'VR HOT',
};

/** GM-editable initiative score (FR4.8) — commits on blur / Enter. */
function ScoreCell({ c, editable, rolled }: { c: Combatant; editable: boolean; rolled: boolean }) {
  const [draft, setDraft] = useState(String(c.initScore));
  const [editing, setEditing] = useState(false);

  // Server events are authoritative: reflect them unless mid-edit.
  useEffect(() => {
    if (!editing) setDraft(String(c.initScore));
  }, [c.initScore, editing]);

  const commit = () => {
    setEditing(false);
    const next = Math.trunc(Number(draft));
    if (!Number.isFinite(next) || next === c.initScore) {
      setDraft(String(c.initScore));
      return;
    }
    patchCombatantLocal(c.id, { initScore: next });
    // A blank line takes it as this turn's entry; a rolled one is a hand edit (FR4.8).
    const write = rolled ? patchCombatant(c.id, { initScore: next }) : postEnterInitiative(c.id, { score: next });
    write.catch(() => {
      patchCombatantLocal(c.id, { initScore: c.initScore });
    });
  };

  if (!editable) {
    return (
      <span className="font-label text-xl font-bold tabular-nums" title={rolled ? undefined : 'not rolled yet'}>
        {rolled ? c.initScore : '—'}
      </span>
    );
  }
  return (
    <input
      value={editing || rolled ? draft : ''}
      placeholder="—"
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(String(c.initScore));
          setEditing(false);
          e.currentTarget.blur();
        }
      }}
      aria-label={`Initiative score for ${c.name}`}
      title={rolled ? 'Type a score to override it' : 'Not rolled yet — type a score, or roll'}
      className="w-12 rounded border border-transparent bg-transparent text-center font-label text-xl font-bold tabular-nums outline-none placeholder:text-faint hover:border-edge focus:border-cyan-dim focus:bg-deck"
    />
  );
}

/**
 * The dice total off the table (FR4.2). Commits on blur / Enter; the server
 * adds base and wounds, and the row shows the resulting score optimistically
 * until the event confirms it.
 */
function DiceEntry({ c, woundModifier }: { c: Combatant; woundModifier: number }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(false);
  const commit = () => {
    const n = Math.trunc(Number(draft));
    if (draft.trim() === '' || !Number.isFinite(n) || n < 0 || n > 30) {
      setDraft('');
      return;
    }
    const before = c.initScore;
    patchCombatantLocal(c.id, { initScore: scoreFromRolled(c, n), actedThisPass: false });
    setDraft('');
    setError(false);
    postSetInitiative(c.id, { rolled: n }).catch(() => {
      patchCombatantLocal(c.id, { initScore: before });
      setError(true);
    });
  };
  const hint =
    woundModifier !== 0
      ? `${c.initBase} + dice ${formatModifier(woundModifier)} wounds`
      : `${c.initBase} + dice`;
  return (
    <input
      value={draft}
      inputMode="numeric"
      placeholder={`${c.initDice}d6`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft('');
          e.currentTarget.blur();
        }
      }}
      aria-label={`Dice total for ${c.name}`}
      title={`What the ${c.initDice}d6 came to — the tracker makes it ${hint}`}
      className={`mt-0.5 w-12 rounded border bg-deck px-1 text-center font-label text-xs tabular-nums outline-none placeholder:text-faint focus:border-warn ${
        error ? 'border-danger' : 'border-warn/60'
      }`}
    />
  );
}

export default function CombatantRow({
  campaignId,
  encounterId,
  row,
  isGm,
  live = true,
  handRolls = false,
  rackVisibility,
  onRoll = () => undefined,
  onDamage,
  onOpenChain,
  orderControls,
  incoming = [],
}: CombatantRowProps) {
  const c = row.combatant;
  const who = { actor: { kind: 'combatant' as const, id: c.id }, title: c.name, runner: c.source === 'character' };
  const [menuOpen, setMenuOpen] = useState(false);
  // Damage is the GM's to apply (the server takes `damage.apply` from the GM only).
  const canDamage = isGm;
  const remove = () => {
    removeCombatantLocal(c.id);
    deleteCombatant(c.id).catch(() => undefined);
  };
  // Who may put a number on this row: the GM on any, a runner on their own (FR4.2).
  const canRoll = live && (isGm || row.own);
  const enterDice = live && ((isGm && handRolls) || (!isGm && row.own));

  /** Drop a status effect (FR4.7) — optimistic, the next event is truth. */
  const removeEffect = (effectId: string) => {
    patchCombatantLocal(c.id, { effects: c.effects.filter((e) => e.id !== effectId) });
    deleteEffect(c.id, effectId).catch(() => {
      patchCombatantLocal(c.id, { effects: c.effects });
    });
  };
  const label = live ? STATE_LABEL[row.state] : undefined;
  const placed = orderControls !== undefined && row.order !== null;

  const standing = c.grunt
    ? (c.grunt.members.length > 0 ? c.grunt.members.length : c.grunt.size) -
      c.grunt.members.filter((m) => m.down).length
    : null;

  return (
    <li
      className={`relative border-b border-edge/60 px-3 py-2 last:border-b-0 ${
        row.acting ? 'sh-acting bg-raised/70' : row.active || !row.rolled ? '' : 'opacity-55'
      } ${row.acted && !row.acting ? 'opacity-70' : ''}`}
      data-rolled={row.rolled ? 'yes' : 'no'}
      data-state={row.state}
      {...(placed
        ? {
            onDragOver: (e: DragEvent<HTMLLIElement>) => e.preventDefault(),
            onDrop: (e: DragEvent<HTMLLIElement>) => {
              e.preventDefault();
              orderControls.onDrop();
            },
          }
        : {})}
    >
      <div className="flex items-start gap-3">
        {placed && (
          // ▲/▼ for touch, the grip for a mouse: both move the place, never the score.
          <div className="-ml-1.5 flex w-5 shrink-0 flex-col items-center text-xs text-faint pointer-coarse:w-8">
            <button
              type="button"
              className="leading-none hover:text-cyan pointer-coarse:min-h-8 pointer-coarse:min-w-8"
              onClick={() => orderControls.onStep(-1)}
              aria-label={`Move ${c.name} up`}
              title="One place up"
            >
              ▲
            </button>
            <span
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', c.id);
                e.dataTransfer.effectAllowed = 'move';
                orderControls.onDragStart();
              }}
              className="cursor-grab select-none py-0.5 hover:text-cyan"
              title="Drag to a new place"
              aria-hidden
            >
              ⠿
            </span>
            <button
              type="button"
              className="leading-none hover:text-cyan pointer-coarse:min-h-8 pointer-coarse:min-w-8"
              onClick={() => orderControls.onStep(1)}
              aria-label={`Move ${c.name} down`}
              title="One place down"
            >
              ▼
            </button>
          </div>
        )}
        <div className="flex w-12 shrink-0 flex-col items-center">
          <ScoreCell c={c} editable={isGm} rolled={row.rolled} />
          {enterDice ? (
            <DiceEntry c={c} woundModifier={row.woundModifier} />
          ) : (
            <span className="mono-label text-faint">{row.rolled ? (row.order ?? '—') : '—'}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className={`truncate text-sm font-semibold ${row.acting ? 'text-cyan' : ''}`}>
              {c.name}
            </span>
            {label && (
              <span className={`mono-label ${label.cls}`} title={label.title}>
                {label.text}
              </span>
            )}
            {live && row.late && (
              <span className="mono-label text-warn" title="Joined mid-turn: roll, then −10 for each pass gone (p.160)">
                joins late
              </span>
            )}
            {row.own && <span className="chip border-cyan-dim py-0 text-cyan">you</span>}
            {c.visibility !== 'public' && isGm && (
              <span className="chip border-magenta-dim py-0 text-magenta">hidden</span>
            )}
            {c.tokenRemoved && (
              <span className="chip border-edge py-0 text-faint" title="Its token was removed from the map; the row stays">
                no token
              </span>
            )}
            {c.initKind !== 'physical' && (
              <span className="mono-label text-faint">{INIT_KIND_LABEL[c.initKind] ?? c.initKind}</span>
            )}
            <span
              className={`mono-label ${row.rolled ? 'text-faint' : 'text-warn'}`}
              title={`Initiative: ${c.initBase} + ${c.initDice}d6${row.rolled ? '' : ' — not rolled yet'}`}
            >
              {c.initBase}+{c.initDice}d6
            </span>
            {live && row.passesLeft > 0 && (
              <span
                className="text-[0.6rem] tracking-tight text-cyan-dim"
                title={`${row.passesLeft} Action Phase${row.passesLeft === 1 ? '' : 's'} left this turn (p.159)`}
                aria-label={`${row.passesLeft} passes left`}
              >
                {'●'.repeat(row.passesLeft)}
              </span>
            )}
            {row.woundModifier !== 0 && (
              <span className="mono-label text-warn">wounds {formatModifier(row.woundModifier)}</span>
            )}
            {c.edge && (
              <span className="mono-label text-magenta">
                edge {c.edge.current}/{c.edge.max}
              </span>
            )}
            {standing !== null && c.grunt && (
              <span className="mono-label text-dim">
                {standing}/{c.grunt.members.length > 0 ? c.grunt.members.length : c.grunt.size} up · PR{' '}
                {c.grunt.professionalRating}
                {c.grunt.groupEdge > 0 && ` · edge ${c.grunt.groupEdge}`}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <MonitorBar
              monitors={c.monitors}
              detail={row.detail}
              {...(canDamage ? { onPick: (track) => onDamage(c, track) } : {})}
            />
            <StatusChips effects={c.effects} {...(isGm ? { onRemove: removeEffect } : {})} />
            {placed && (
              <span className="flex gap-1">
                <button
                  type="button"
                  className="chip border-edge-bright py-0 hover:border-cyan hover:text-cyan"
                  onClick={orderControls.onActNow}
                  title="Acts now, in front of whoever was next: a place, not a score (p.161)"
                >
                  Act now
                </button>
                <button
                  type="button"
                  className={`chip py-0 hover:border-cyan hover:text-cyan ${
                    c.delayed ? 'border-warn text-warn' : 'border-edge-bright'
                  }`}
                  aria-pressed={c.delayed === true}
                  onClick={orderControls.onDelay}
                  title={
                    c.delayed
                      ? 'Stop holding the Delayed Action'
                      : 'Hold a Delayed Action: keeps the score, Next steps over it until Act now (p.161)'
                  }
                >
                  {c.delayed ? 'Stop delay' : 'Delay'}
                </button>
              </span>
            )}
          </div>

          {isGm && hasCopilotRack(c) && (
            <>
              <CopilotRack
                campaignId={campaignId}
                combatant={c}
                visibility={rackVisibility}
                onOpenChain={() => onOpenChain(c.id)}
                onOpenCard={(entry) => {
                  const start = rackStart(entry);
                  openGmCard({ ...who, kind: 'act', visibility: rackVisibility, ...(start ? { start } : {}) });
                }}
              />
              {/* FR10.10 — one advisory line, GM-only, off by default. The
                  server withholds it unless the campaign turned hints on, so
                  this renders nothing in the ordinary case. */}
              <HintLine combatant={c} isGm={isGm} acting={row.acting} />
            </>
          )}
          {isGm &&
            incoming.map((x) => (
              <GmIncoming key={x.id} x={x} row={c} />
            ))}
          {isGm && <AppliedLines combatantId={c.id} />}
        </div>

        <div className="relative flex shrink-0 items-center gap-1">
          {canRoll && (
            <button
              type="button"
              className={`chip ${row.rolled ? 'border-edge-bright' : 'border-warn text-warn'} hover:border-cyan hover:text-cyan`}
              onClick={() => onRoll(c)}
              title={`Roll ${c.initDice}d6 + ${c.initBase} with the server’s dice`}
            >
              ROLL
            </button>
          )}
          {isGm && (
            <button
              type="button"
              className="chip border-cyan-dim text-cyan hover:border-cyan"
              onClick={() => openGmCard({ ...who, kind: 'act' })}
              title="Every action, each with its roll card; and declare an attack on this row"
            >
              Actions
            </button>
          )}
          {canDamage && (
            <button
              type="button"
              className="chip border-edge-bright hover:border-danger hover:text-danger"
              onClick={() => onDamage(c)}
              title="Apply damage"
            >
              DMG
            </button>
          )}
          {isGm && (
            <button
              type="button"
              className="chip border-edge-bright hover:border-cyan hover:text-cyan"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              title="Interrupt actions"
            >
              INT ▾
            </button>
          )}
          {isGm && (
            <button
              type="button"
              className="chip border-edge-bright text-faint hover:border-danger hover:text-danger"
              onClick={remove}
              aria-label={`Remove ${c.name} from the fight`}
              title="Remove this row from the fight"
            >
              ✕
            </button>
          )}
          {menuOpen && (
            <InterruptMenu
              encounterId={encounterId}
              combatant={c}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>
    </li>
  );
}
