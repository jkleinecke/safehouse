/**
 * Pure logic for the mage's working surface (FR8.2–FR8.4). No React, no I/O —
 * every rule the Magic tab plays by lives here so it can be tested without a
 * DOM, and so the browser preview and the server agree by construction (the
 * arithmetic itself comes from `@safehouse/rules`, not from a second copy).
 *
 * Three things earn their own functions:
 *
 *  - **The focus toggle has to move a real number.** `previewWithFoci` rebuilds
 *    the character through `deriveCharacter` with the focus rack swapped in, so
 *    flipping a focus changes the pool *and* puts the focus in that pool's
 *    breakdown (Principle 3). It is a preview: the server's answer, which comes
 *    back on the same request, always wins.
 *  - **Counters floor at zero.** Services and reagents both go through the
 *    engine's own `spendServices` / `spendReagents`, so the optimistic number
 *    can never disagree with the authoritative one about what "spend 3 when you
 *    have 1" means.
 *  - **One sustained list, whoever is carrying it.** The caster's own −2, a
 *    focus's exemption and a spirit holding the spell all read the same way,
 *    because on the server they are one toggle (FR8.2 × FR8.3).
 *
 * The `magic.updated` half — folding a frame into a hydrated view, and the log
 * lines it produces — lives next door in `events.ts`.
 */
import type { DerivedCharacter, Modifier, PoolBreakdown, SheetV1 } from '@safehouse/contracts';
import {
  deriveCharacter,
  focusIsLive,
  focusModifiers,
  spendReagents,
  spendServices,
  type BondedFocus,
} from '@safehouse/rules';
import { sustainedSpells } from '../lib.js';
import type { FocusRow, MagicView, SpiritRow } from './types.js';

/** Every modifier a focus contributes carries this id prefix (rules/magic/foci). */
export const FOCUS_MOD_PREFIX = 'focus.';

// ---------------------------------------------------------------------------
// Foci → the engine
// ---------------------------------------------------------------------------

export function toBondedFocus(focus: FocusRow): BondedFocus {
  return {
    id: focus.id,
    name: focus.name,
    kind: focus.kind,
    force: focus.force,
    bonded: focus.bonded,
    active: focus.active,
    sourceKind: focus.sourceKind,
    targets: focus.targets,
    mods: focus.mods,
    ...(focus.ref ? { ref: focus.ref } : {}),
    ...(focus.note ? { note: focus.note } : {}),
  };
}

/**
 * What this focus feeds — the same targets whether it is switched on or off, so
 * the rack can say "this is what flipping it would move" before it moves.
 */
export function focusTargets(focus: FocusRow): string[] {
  const explicit = focus.mods.map((m) => m.target);
  const targets = explicit.length > 0 ? explicit : focus.targets;
  return [...new Set(targets)];
}

/** Live means bonded AND switched on; unbonded is inert however it looks. */
export function focusContributes(focus: FocusRow): boolean {
  return focusIsLive(focus) && focusTargets(focus).length > 0;
}

export function setFocusActive(foci: readonly FocusRow[], focusId: string, active: boolean): FocusRow[] {
  return foci.map((f) => (f.id === focusId ? { ...f, active } : f));
}

export function setFocusBonded(foci: readonly FocusRow[], focusId: string, bonded: boolean): FocusRow[] {
  // Unbonding kills the toggle too: an unbonded focus that still reads "on"
  // is exactly the lie FR8.4 exists to stop.
  return foci.map((f) => (f.id === focusId ? { ...f, bonded, active: bonded && f.active } : f));
}

/**
 * The modifiers behind a derivation with everything EXCEPT foci — scene,
 * wounds already handled separately, sustaining. Foci are stripped by id so a
 * preview can put a different rack back without double-counting.
 */
export function situationalWithoutFoci(situational: readonly Modifier[]): Modifier[] {
  return situational.filter((m) => !m.id.startsWith(FOCUS_MOD_PREFIX));
}

export interface PreviewInput {
  sheet: SheetV1;
  /** The server's own modifier list for the current derivation. */
  situational: readonly Modifier[];
  foci: readonly FocusRow[];
  wounds: { physical: number; stun: number };
}

/**
 * Re-derive the character with `foci` as the live rack. This is what makes the
 * toggle feel instant; the same shape comes back from the server on the very
 * request the toggle fired, and that answer replaces this one.
 */
export function previewWithFoci(input: PreviewInput): DerivedCharacter {
  const situational = [
    ...situationalWithoutFoci(input.situational),
    ...focusModifiers(input.foci.map(toBondedFocus)),
  ];
  return deriveCharacter(input.sheet, { situational, wounds: input.wounds });
}

/**
 * The whole optimistic half of the FR8.4 toggle, in one pure step: flip the
 * focus, re-derive the character through the engine with the new rack, hand
 * back a view whose pools have already moved and whose breakdowns already name
 * the focus. The server's answer to the same tap replaces this wholesale.
 */
export function applyFocusPatchLocal(
  view: MagicView,
  focusId: string,
  patch: { active?: boolean; bonded?: boolean },
  ctx: { sheet: SheetV1; wounds: { physical: number; stun: number } },
): MagicView {
  let foci = view.foci;
  if (typeof patch.bonded === 'boolean') foci = setFocusBonded(foci, focusId, patch.bonded);
  if (typeof patch.active === 'boolean') foci = setFocusActive(foci, focusId, patch.active);
  return {
    ...view,
    foci,
    derived: previewWithFoci({
      sheet: ctx.sheet,
      situational: view.situational,
      foci,
      wounds: ctx.wounds,
    }),
  };
}

// ---------------------------------------------------------------------------
// Which pools a focus rack is allowed to move
// ---------------------------------------------------------------------------

export interface AffectedPool {
  /** Key into `derived.pools`. */
  key: string;
  label: string;
  pool: PoolBreakdown;
}

/** `pool.all` reaches every pool except damage resistance (see derive-pools). */
const POOL_ALL_EXEMPT = new Set(['soak', 'armor']);

export function poolKeyForTarget(target: string): string | null {
  return target.startsWith('pool.') ? target.slice('pool.'.length) : null;
}

export function prettyPoolLabel(key: string): string {
  if (key.startsWith('skill.')) return key.slice('skill.'.length);
  if (key.startsWith('spell.')) return key.slice('spell.'.length);
  if (key.startsWith('weapon.')) return key.slice('weapon.'.length);
  return key;
}

/**
 * The pools a bonded rack touches, whether or not it is switched on right now
 * — the mage needs to see the number BEFORE they flip the focus as well as
 * after. Capped so a `pool.all` focus does not paint forty rows on a phone.
 */
export function affectedPools(
  foci: readonly FocusRow[],
  derived: DerivedCharacter | null,
  limit = 6,
): AffectedPool[] {
  if (!derived) return [];
  const keys = new Set<string>();
  for (const focus of foci) {
    if (!focus.bonded) continue;
    for (const target of focusTargets(focus)) {
      const key = poolKeyForTarget(target);
      if (key === null) continue;
      if (key === 'all') {
        for (const poolKey of Object.keys(derived.pools)) {
          if (!POOL_ALL_EXEMPT.has(poolKey)) keys.add(poolKey);
        }
      } else if (derived.pools[key]) {
        keys.add(key);
      }
    }
  }
  return [...keys]
    .sort((a, b) => a.localeCompare(b))
    .flatMap((key) => {
      const pool = derived.pools[key];
      return pool ? [{ key, label: prettyPoolLabel(key), pool }] : [];
    })
    .slice(0, Math.max(0, limit));
}

/** Does this pool's provenance name a focus? The Principle-3 receipt. */
export function focusEntriesIn(pool: PoolBreakdown | undefined, foci: readonly FocusRow[]): string[] {
  if (!pool) return [];
  const names = foci.filter((f) => focusContributes(f)).map((f) => f.name);
  return pool.breakdown
    .filter((entry) => names.some((n) => entry.label.includes(n)))
    .map((entry) => entry.label);
}

// ---------------------------------------------------------------------------
// Spirits: services, and the optimistic decrement
// ---------------------------------------------------------------------------

export function replaceSpirit(spirits: readonly SpiritRow[], next: SpiritRow): SpiritRow[] {
  return spirits.some((s) => s.id === next.id)
    ? spirits.map((s) => (s.id === next.id ? next : s))
    : [...spirits, next];
}

export interface ServiceSpendPreview {
  spirits: SpiritRow[];
  spent: number;
  shortfall: number;
  remaining: number;
}

/**
 * One tap, spent immediately in the UI. The engine does the arithmetic, so
 * "spend 2 with 1 left" floors at zero here exactly as it will on the server,
 * and the shortfall is reported rather than swallowed.
 */
export function spendServiceLocal(
  spirits: readonly SpiritRow[],
  spiritId: string,
  count = 1,
): ServiceSpendPreview {
  const current = spirits.find((s) => s.id === spiritId);
  if (!current) return { spirits: [...spirits], spent: 0, shortfall: count, remaining: 0 };
  const change = spendServices(
    { remaining: current.services, initial: current.servicesInitial },
    count,
  );
  const next: SpiritRow = {
    ...current,
    services: change.after.remaining,
    servicesInitial: change.after.initial,
  };
  return {
    spirits: replaceSpirit(spirits, next),
    spent: change.spent,
    shortfall: change.shortfall,
    remaining: change.after.remaining,
  };
}

/** Spirits this sheet can actually order about: its own, still summoned. */
export function liveSpirits(view: MagicView): SpiritRow[] {
  return view.spirits.filter((s) => s.status === 'summoned');
}

export function spiritIsInFight(spirit: SpiritRow, encounterId: string | null): boolean {
  return Boolean(spirit.combatantId) && spirit.encounterId === encounterId && encounterId !== null;
}

// ---------------------------------------------------------------------------
// Reagents — the counter that cannot go below zero (FR8.4)
// ---------------------------------------------------------------------------

export interface ReagentPreview {
  after: number;
  shortfall: number;
}

export function reagentsAfterSpend(before: number, amount: number): ReagentPreview {
  const change = spendReagents(before, amount);
  return { after: change.after, shortfall: change.shortfall };
}

export function reagentsAfterRestock(before: number, amount: number): ReagentPreview {
  return { after: Math.max(0, Math.trunc(before)) + Math.max(0, Math.trunc(amount)), shortfall: 0 };
}

// ---------------------------------------------------------------------------
// Sustained spells (FR8.2) — one list, whoever is carrying them
// ---------------------------------------------------------------------------

export type SustainOrigin = 'play' | 'sheet';

export interface SustainedRow {
  /** `play.sustained` entry id, or the sheet modifier's spell name. */
  id: string;
  name: string;
  exempt: boolean;
  /** Why it is free: a spirit by name, or the caster's own focus/quickening. */
  exemptBy: 'spirit' | 'focus_or_quickening' | null;
  spiritId: string | null;
  spiritName: string | null;
  penalty: number;
  /**
   * `play` — the server's first-class sustained list, the only kind a spirit
   * can be handed. `sheet` — the older convention that carried the −2 as a
   * modifier in `sheet.overrides`; still shown (and still releasable) so a
   * pre-existing toggle can never become an invisible −2.
   */
  origin: SustainOrigin;
}

export function sustainedRows(view: MagicView, sheet: SheetV1): SustainedRow[] {
  const rows: SustainedRow[] = view.sustaining.lines.map((line) => ({
    id: line.id,
    name: line.name,
    exempt: line.exempt,
    exemptBy: line.exemptBy,
    spiritId: line.spiritId,
    spiritName: line.spiritName,
    penalty: line.penalty,
    origin: 'play',
  }));
  const seen = new Set(rows.map((r) => r.name.toLowerCase()));
  for (const name of sustainedSpells(sheet)) {
    if (seen.has(name.toLowerCase())) continue;
    rows.push({
      id: name,
      name,
      exempt: false,
      exemptBy: null,
      spiritId: null,
      spiritName: null,
      penalty: -2,
      origin: 'sheet',
    });
  }
  return rows;
}

export function sustainingPenaltyOf(rows: readonly SustainedRow[]): number {
  return rows.reduce((sum, r) => sum + r.penalty, 0);
}

export type SustainRelease =
  | { op: 'sheet_toggle'; name: string }
  | { op: 'take_back'; spiritId: string; sustainedId: string }
  | { op: 'remove'; id: string };

/**
 * What "drop it" actually has to do, in order.
 *
 * A spell a spirit is holding has to be taken back BEFORE the entry goes, or
 * the spirit is left pointing at a sustained id that no longer exists — it
 * would still read "holding a spell" with nothing in its hands.
 */
export function releaseSteps(row: SustainedRow): SustainRelease[] {
  if (row.origin === 'sheet') return [{ op: 'sheet_toggle', name: row.name }];
  const remove: SustainRelease = { op: 'remove', id: row.id };
  return row.spiritId
    ? [{ op: 'take_back', spiritId: row.spiritId, sustainedId: row.id }, remove]
    : [remove];
}

/** Human reason a row costs nothing — the FR8.2 exemption, spelled out. */
export function exemptionPhrase(row: SustainedRow): string {
  if (!row.exempt) return `−2 to your pools`;
  if (row.exemptBy === 'spirit') return `held by ${row.spiritName ?? 'a spirit'} — no −2`;
  return 'held by a focus or quickening — no −2';
}

// ---------------------------------------------------------------------------
// Accessible names (the sheet's house rule: every control says what it does)
// ---------------------------------------------------------------------------

export function spiritSummaryLabel(spirit: SpiritRow): string {
  const bond = spirit.bound ? 'bound' : 'unbound';
  return `${spirit.name}, ${spirit.spiritType} Force ${spirit.force}, ${bond}, ${spirit.services} of ${spirit.servicesInitial} services left`;
}

export function spendServiceLabel(spirit: SpiritRow): string {
  return spirit.services > 0
    ? `Spend a service from ${spirit.name}, ${spirit.services} left`
    : `${spirit.name} has no services left`;
}

export function focusToggleLabel(focus: FocusRow): string {
  if (!focus.bonded) return `${focus.name} is not bonded — bond it before it can do anything`;
  const targets = focusTargets(focus);
  const what = targets.length > 0 ? ` on ${targets.map(prettyTarget).join(', ')}` : '';
  return focus.active
    ? `${focus.name} Force ${focus.force}, active${what} — activate to switch off`
    : `${focus.name} Force ${focus.force}, inactive${what} — activate to switch on`;
}

export function prettyTarget(target: string): string {
  const key = poolKeyForTarget(target);
  if (key === 'all') return 'every pool';
  if (key) return prettyPoolLabel(key);
  if (target.startsWith('attr.')) return target.slice('attr.'.length).toUpperCase();
  if (target.startsWith('limit.')) return `${target.slice('limit.'.length)} limit`;
  return target;
}
