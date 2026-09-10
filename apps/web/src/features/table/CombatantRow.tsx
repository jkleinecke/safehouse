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
 */
import { useEffect, useState } from 'react';
import type { Combatant } from '@safehouse/contracts';
import { hasCopilotRack } from './copilot.js';
import { deleteCombatant, patchCombatant, patchCombatantLocal, postSetInitiative, removeCombatantLocal } from './commands.js';
import CopilotRack from './CopilotRack.js';
import HintLine from './HintLine.js';
import InterruptMenu from './InterruptMenu.js';
import MonitorBar from './MonitorBar.js';
import StatusChips from './StatusChips.js';
import { formatModifier, scoreFromRolled, type TrackerRow } from './initiative.js';

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
}

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
    patchCombatant(c.id, { initScore: next }).catch(() => {
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
}: CombatantRowProps) {
  const c = row.combatant;
  const [menuOpen, setMenuOpen] = useState(false);
  // Removing a row takes two clicks: the second one is the confirmation.
  const [confirmRemove, setConfirmRemove] = useState(false);
  const canDamage = isGm || row.own;
  const remove = () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setConfirmRemove(false);
    removeCombatantLocal(c.id);
    deleteCombatant(c.id).catch(() => undefined);
  };
  // Who may put a number on this row: the GM on any, a runner on their own (FR4.2).
  const canRoll = live && (isGm || row.own);
  const enterDice = live && ((isGm && handRolls) || (!isGm && row.own));

  /** Drop a status effect (FR4.7) — optimistic, the next event is truth. */
  const removeEffect = (effectId: string) => {
    const effects = c.effects.filter((e) => e.id !== effectId);
    patchCombatantLocal(c.id, { effects });
    patchCombatant(c.id, { effects }).catch(() => {
      patchCombatantLocal(c.id, { effects: c.effects });
    });
  };

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
    >
      <div className="flex items-start gap-3">
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
            {row.acting && live && <span className="mono-label text-cyan">acting</span>}
            {row.own && <span className="chip border-cyan-dim py-0 text-cyan">you</span>}
            {c.visibility !== 'public' && isGm && (
              <span className="chip border-magenta-dim py-0 text-magenta">hidden</span>
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
          </div>

          {isGm && hasCopilotRack(c) && (
            <>
              <CopilotRack
                campaignId={campaignId}
                combatant={c}
                visibility={rackVisibility}
                onOpenChain={() => onOpenChain(c.id)}
              />
              {/* FR10.10 — one advisory line, GM-only, off by default. The
                  server withholds it unless the campaign turned hints on, so
                  this renders nothing in the ordinary case. */}
              <HintLine combatant={c} isGm={isGm} acting={row.acting} />
            </>
          )}
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
              className={`chip ${confirmRemove ? 'border-danger text-danger' : 'border-edge-bright text-faint'} hover:border-danger hover:text-danger`}
              onClick={remove}
              onBlur={() => setConfirmRemove(false)}
              aria-label={`Remove ${c.name} from the fight`}
              title={confirmRemove ? 'Click again to remove this row' : 'Remove this row from the fight'}
            >
              {confirmRemove ? 'remove?' : '✕'}
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
