/**
 * One combatant on the tracker (FR4.2–4.10). Score, condition, statuses, and
 * — for the GM — hand-edit, interrupts, damage, and the NPC copilot rack.
 * The acting row glows; spent rows dim but stay on screen (FR4.8).
 */
import { useEffect, useState } from 'react';
import type { Combatant } from '@safehouse/contracts';
import { hasCopilotRack } from './copilot.js';
import { patchCombatant, patchCombatantLocal } from './commands.js';
import CopilotRack from './CopilotRack.js';
import HintLine from './HintLine.js';
import InterruptMenu from './InterruptMenu.js';
import MonitorBar from './MonitorBar.js';
import StatusChips from './StatusChips.js';
import { formatModifier, type TrackerRow } from './initiative.js';

export interface CombatantRowProps {
  campaignId: string;
  encounterId: string;
  row: TrackerRow;
  isGm: boolean;
  /** Visibility for copilot rack rolls (tracker header toggles it). */
  rackVisibility: 'gm' | 'public';
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
function ScoreCell({ c, editable }: { c: Combatant; editable: boolean }) {
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
    return <span className="font-label text-xl font-bold tabular-nums">{c.initScore}</span>;
  }
  return (
    <input
      value={draft}
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
      className="w-12 rounded border border-transparent bg-transparent text-center font-label text-xl font-bold tabular-nums outline-none hover:border-edge focus:border-cyan-dim focus:bg-deck"
    />
  );
}

export default function CombatantRow({
  campaignId,
  encounterId,
  row,
  isGm,
  rackVisibility,
  onDamage,
  onOpenChain,
}: CombatantRowProps) {
  const c = row.combatant;
  const [menuOpen, setMenuOpen] = useState(false);
  const canDamage = isGm || row.own;

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
        row.acting ? 'sh-acting bg-raised/70' : row.active ? '' : 'opacity-55'
      } ${row.acted && !row.acting ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex w-12 shrink-0 flex-col items-center">
          <ScoreCell c={c} editable={isGm} />
          <span className="mono-label text-faint">{row.order ?? '—'}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className={`truncate text-sm font-semibold ${row.acting ? 'text-cyan' : ''}`}>
              {c.name}
            </span>
            {row.acting && <span className="mono-label text-cyan">acting</span>}
            {row.own && <span className="chip border-cyan-dim py-0 text-cyan">you</span>}
            {c.visibility !== 'public' && isGm && (
              <span className="chip border-magenta-dim py-0 text-magenta">hidden</span>
            )}
            {c.initKind !== 'physical' && (
              <span className="mono-label text-faint">{INIT_KIND_LABEL[c.initKind] ?? c.initKind}</span>
            )}
            <span className="mono-label text-faint">
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
          {canDamage && (
            <button
              type="button"
              className="chip border-edge-bright hover:border-danger hover:text-danger"
              onClick={() => onDamage(c)}
              title="Apply damage (FR4.5)"
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
              title="Interrupt actions (FR4.4)"
            >
              INT ▾
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
