/**
 * Pure projection helpers for the initiative tracker (FR4.2–4.9, FR10.9).
 * No React, no I/O — the row order, the honest-UI visibility rules, and the
 * morale prompt derivation all live here so they can be tested directly.
 *
 * Visibility note (Principle 4): the server already withholds GM-only
 * combatants from player sockets. The filters here are a second, honest layer
 * so a stale buffer never paints something a player shouldn't read.
 */
import type {
  Combatant,
  CombatantMonitors,
  Encounter,
  Role,
  StatusEffect,
} from '@safehouse/contracts';
import {
  computeWoundModifier,
  gruntMoraleTriggers,
  moraleReport,
  nextActor,
  type MoraleReport,
} from '@safehouse/rules';

export interface Viewer {
  role: Role;
  /** The player's own character, when the device's invite is bound to one. */
  characterId?: string;
}

// ---------------------------------------------------------------------------
// Who may read what
// ---------------------------------------------------------------------------

/** A row driven by this viewer's own PC. */
export function isOwnCombatant(c: Combatant, viewer: Viewer): boolean {
  return (
    viewer.characterId !== undefined &&
    c.source === 'character' &&
    c.sourceId === viewer.characterId
  );
}

/** Rows this viewer may see at all (hidden NPCs stay off player screens). */
export function visibleCombatants(list: Combatant[], viewer: Viewer): Combatant[] {
  if (viewer.role === 'gm') return list;
  return list.filter((c) => c.visibility === 'public' || isOwnCombatant(c, viewer));
}

/**
 * How much of a combatant's condition this viewer gets (FR4.9): the GM and
 * the row's owner read exact boxes; everyone else reads a coarse band —
 * "presence and public condition only".
 */
export type MonitorDetail = 'full' | 'coarse' | 'none';

export function monitorDetailFor(c: Combatant, viewer: Viewer): MonitorDetail {
  if (viewer.role === 'gm') return 'full';
  if (isOwnCombatant(c, viewer)) return 'full';
  return c.visibility === 'public' ? 'coarse' : 'none';
}

export type ConditionBand = 'fresh' | 'scratched' | 'wounded' | 'bloodied' | 'down';

/** Coarse condition read for public rows — never exact numbers. */
export function conditionBand(m: CombatantMonitors): ConditionBand {
  if (m.overflow.filled > 0) return 'down';
  if (m.physical.max > 0 && m.physical.filled >= m.physical.max) return 'down';
  if (m.stun.max > 0 && m.stun.filled >= m.stun.max) return 'down';
  const ratio = Math.max(
    m.physical.max > 0 ? m.physical.filled / m.physical.max : 0,
    m.stun.max > 0 ? m.stun.filled / m.stun.max : 0,
  );
  if (ratio <= 0) return 'fresh';
  if (ratio >= 0.75) return 'bloodied';
  if (ratio >= 0.4) return 'wounded';
  return 'scratched';
}

export const CONDITION_LABEL: Record<ConditionBand, string> = {
  fresh: 'unhurt',
  scratched: 'scratched',
  wounded: 'wounded',
  bloodied: 'badly hurt',
  down: 'down',
};

// ---------------------------------------------------------------------------
// Row order (FR4.3: descending score, current pass, who's still coming)
// ---------------------------------------------------------------------------

export interface TrackerRow {
  combatant: Combatant;
  /** 1-based place in the acting order; null once the score is spent. */
  order: number | null;
  acting: boolean;
  acted: boolean;
  /** Score still above 0 — this row acts again this pass. */
  active: boolean;
  woundModifier: number;
  detail: MonitorDetail;
  own: boolean;
}

/** Score desc, then initiative base desc, then id — matches the rules engine. */
function compareOrder(a: Combatant, b: Combatant): number {
  return b.initScore - a.initScore || b.initBase - a.initBase || (a.id < b.id ? -1 : 1);
}

/**
 * Project an encounter into ordered tracker rows for one viewer. Spent rows
 * (score ≤ 0) sink below the live ones instead of vanishing — the GM still
 * hand-edits them (FR4.8).
 */
export function trackerRows(encounter: Encounter | null | undefined, viewer: Viewer): TrackerRow[] {
  const all = visibleCombatants(encounter?.combatants ?? [], viewer);
  const sorted = [...all].sort(
    (a, b) => Number(a.initScore <= 0) - Number(b.initScore <= 0) || compareOrder(a, b),
  );
  const actingId = encounter?.activeCombatantId ?? nextActor(all)?.id ?? null;

  let order = 0;
  return sorted.map((c) => {
    const active = c.initScore > 0;
    if (active) order += 1;
    return {
      combatant: c,
      order: active ? order : null,
      acting: c.id === actingId,
      acted: c.actedThisPass,
      active,
      woundModifier: computeWoundModifier(c.monitors),
      detail: monitorDetailFor(c, viewer),
      own: isOwnCombatant(c, viewer),
    };
  });
}

/** "TURN 2 · PASS 1" — the always-visible turn structure readout (FR4.3). */
export function passLabel(encounter: Encounter | null | undefined): string {
  const turn = encounter?.turn ?? 0;
  const pass = encounter?.pass ?? 0;
  return `TURN ${Math.max(1, turn)} · PASS ${Math.max(1, pass)}`;
}

/** Signed modifier for display: -2, +0, +3. */
export function formatModifier(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** Short duration hint on a status chip (FR4.7). */
export function effectHint(effect: StatusEffect): string | null {
  switch (effect.duration.kind) {
    case 'end_of_turn':
      return 'EOT';
    case 'while_sustained':
      return 'sust';
    case 'passes':
      return effect.duration.value !== undefined ? `${effect.duration.value}p` : 'passes';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Morale (FR10.9) — a suggestion, never an action
// ---------------------------------------------------------------------------

export interface MoralePrompt {
  /** Stable across re-renders; changes when the situation worsens. */
  key: string;
  combatantId: string;
  name: string;
  report: MoraleReport;
  standing: number;
  size: number;
}

export const MORALE_PROMPT_CAP = 3;

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/**
 * Derive morale prompts from live grunt-group state. `copilot.leaderDown`
 * is a GM flag (the engine can't know who the leader was); setting
 * `copilot.morale = false` silences a group entirely.
 *
 * INTEGRATION: `copilot.leaderDown` / `copilot.morale` flag names assumed —
 * align with the encounters + generator agents' copilot payload.
 */
export function moralePrompts(combatants: Combatant[]): MoralePrompt[] {
  const out: MoralePrompt[] = [];
  for (const c of combatants) {
    const grunt = c.grunt;
    if (!grunt) continue;
    const copilot = rec(c.copilot);
    if (copilot['morale'] === false) continue;
    const leaderDown = copilot['leaderDown'] === true;
    const triggers = gruntMoraleTriggers(grunt, { leaderDown });
    const report = moraleReport(grunt.professionalRating, triggers);
    if (report.suggestion === 'fight_on') continue;
    const size = grunt.members.length > 0 ? grunt.members.length : grunt.size;
    const casualties = grunt.members.filter((m) => m.down).length;
    out.push({
      key: `${c.id}:${casualties}:${leaderDown ? 1 : 0}`,
      combatantId: c.id,
      name: c.name,
      report,
      standing: size - casualties,
      size,
    });
  }
  return out.slice(0, MORALE_PROMPT_CAP);
}

export const MORALE_TEXT: Record<MoraleReport['suggestion'], string> = {
  fight_on: 'holds the line',
  fall_back: 'wants to fall back',
  cut_and_run: 'wants to cut and run',
};

/** The line a GM drops into the log when they take the suggestion. */
export function moraleLine(prompt: MoralePrompt): string {
  const why = prompt.report.reasons.join(', ');
  return `${prompt.name} ${MORALE_TEXT[prompt.report.suggestion]} — ${prompt.standing}/${prompt.size} standing${
    why ? ` (${why})` : ''
  }`;
}
