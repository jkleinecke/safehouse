/**
 * Pure helpers for the character sheet feature (no React, no I/O) —
 * monitor tap semantics, Edge ops, override/sustain sheet transforms,
 * recoil math, drain parsing, ledger balances. Unit-tested in lib.test.ts.
 */
import type {
  EdgeState,
  LedgerEntry,
  Modifier,
  ProvenanceEntry,
  Ref,
  SheetV1,
  SheetWeapon,
  WsEvent,
} from '@safehouse/contracts';

// ---------------------------------------------------------------------------
// Condition monitors (FR3.4)
// ---------------------------------------------------------------------------

export interface ConditionState {
  physical: number;
  stun: number;
}

/**
 * Tap-to-damage/heal: tapping box `index` (0-based) fills up to it; tapping
 * the last filled box clears it (heals one). So tapping deeper damages to
 * that box, tapping the current edge heals one back.
 */
export function monitorTapTarget(filled: number, index: number): number {
  return index + 1 === filled ? index : index + 1;
}

/** Clamp a monitor fill to [0, max]. */
export function clampFill(filled: number, max: number): number {
  return Math.min(Math.max(0, Math.floor(filled)), Math.max(0, max));
}

// ---------------------------------------------------------------------------
// Edge (FR2.3): spend decrements current; burn permanently loses a point.
// ---------------------------------------------------------------------------

export type EdgeOp = 'spend' | 'burn' | 'regain';

export function edgeAfter(edge: EdgeState, op: EdgeOp): EdgeState {
  switch (op) {
    case 'spend':
      return { ...edge, current: Math.max(0, edge.current - 1) };
    case 'regain':
      return { ...edge, current: Math.min(edge.max, edge.current + 1) };
    case 'burn': {
      const max = Math.max(0, edge.max - 1);
      return { max, current: Math.min(max, Math.max(0, edge.current - 1)) };
    }
  }
}

// ---------------------------------------------------------------------------
// Overrides (Principle 2): Modifier with source.kind 'override' in
// sheet.overrides, op 'set', keyed by target. Visibly flagged in the UI.
// ---------------------------------------------------------------------------

export function overrideId(target: string): string {
  return `override.${target}`;
}

export function findOverride(sheet: SheetV1, target: string): Modifier | undefined {
  return sheet.overrides.find(
    (m) => m.source.kind === 'override' && m.target === target && m.op === 'set',
  );
}

export function upsertOverride(
  sheet: SheetV1,
  target: string,
  value: number,
  note?: string,
): SheetV1 {
  const mod: Modifier = {
    id: overrideId(target),
    source: { kind: 'override' },
    target,
    op: 'set',
    value,
    active: true,
    ...(note ? { note } : {}),
  };
  const rest = sheet.overrides.filter(
    (m) => !(m.source.kind === 'override' && m.target === target && m.op === 'set'),
  );
  return { ...sheet, overrides: [...rest, mod] };
}

export function clearOverride(sheet: SheetV1, target: string): SheetV1 {
  return {
    ...sheet,
    overrides: sheet.overrides.filter(
      (m) => !(m.source.kind === 'override' && m.target === target && m.op === 'set'),
    ),
  };
}

/** Does this derived breakdown contain an override contribution? */
export function hasOverrideEntry(breakdown: readonly ProvenanceEntry[]): boolean {
  return breakdown.some((e) => e.source === 'override');
}

// ---------------------------------------------------------------------------
// Sustained spells (FR8.2): −2 per sustained spell on all pools. The sheet
// has no `sustained` field, so the toggle is carried as a Modifier (source
// kind 'spell') in sheet.overrides — persisted, so the server's /derived and
// every other device see the −2 too.
// INTEGRATION: if the server grows first-class sustained-spell state, move
// these toggles there and drop the modifier convention.
// ---------------------------------------------------------------------------

export function sustainId(spellName: string): string {
  return `sustain.${spellName}`;
}

export function isSustained(sheet: SheetV1, spellName: string): boolean {
  return sheet.overrides.some((m) => m.id === sustainId(spellName) && m.active);
}

export function sustainedSpells(sheet: SheetV1): string[] {
  return sheet.overrides
    .filter((m) => m.id.startsWith('sustain.') && m.source.kind === 'spell' && m.active)
    .map((m) => m.id.slice('sustain.'.length));
}

export function toggleSustain(sheet: SheetV1, spellName: string): SheetV1 {
  if (isSustained(sheet, spellName)) {
    return {
      ...sheet,
      overrides: sheet.overrides.filter((m) => m.id !== sustainId(spellName)),
    };
  }
  const mod: Modifier = {
    id: sustainId(spellName),
    source: { kind: 'spell', ref: spellName },
    target: 'pool.all',
    op: 'add',
    value: -2,
    active: true,
    note: `sustaining ${spellName}`,
  };
  return { ...sheet, overrides: [...sheet.overrides, mod] };
}

// ---------------------------------------------------------------------------
// Adept powers (FR8.5): toggled powers flip their carried mods' `active`.
// ---------------------------------------------------------------------------

export function isPowerActive(power: { mods: Modifier[] }): boolean {
  return power.mods.length > 0 && power.mods.every((m) => m.active);
}

export function setPowerActive(sheet: SheetV1, powerName: string, active: boolean): SheetV1 {
  return {
    ...sheet,
    powers: sheet.powers.map((p) =>
      p.name === powerName ? { ...p, mods: p.mods.map((m) => ({ ...m, active })) } : p,
    ),
  };
}

// ---------------------------------------------------------------------------
// Weapons: fire modes, progressive recoil (FR3.4), ammo.
// ---------------------------------------------------------------------------

/** Rounds a trigger pull expends per fire mode — assistive default, editable per-roll. */
export function bulletsForMode(mode: string): number {
  switch (mode.toUpperCase()) {
    case 'BF':
      return 3;
    case 'FA':
      return 6;
    default: // SS, SA, unknown
      return 1;
  }
}

/**
 * Progressive recoil penalty (≤ 0) if `bullets` more rounds are fired after
 * `firedSoFar` this turn: cumulative rounds − 1 (first is free) − recoil comp.
 * Assistive per Principle 2 — the roll dialog lets the GM/user adjust it.
 */
export function recoilPenalty(firedSoFar: number, bullets: number, recoilComp: number): number {
  const total = Math.max(0, firedSoFar) + Math.max(0, bullets);
  const uncompensated = Math.max(0, total - 1 - Math.max(0, recoilComp));
  return uncompensated === 0 ? 0 : -uncompensated; // never -0
}

export function ammoAfterShots(weapon: SheetWeapon, bullets: number): SheetV1['weapons'][number] {
  if (!weapon.ammo) return weapon;
  return {
    ...weapon,
    ammo: { ...weapon.ammo, current: Math.max(0, weapon.ammo.current - Math.max(0, bullets)) },
  };
}

export function withWeaponAmmo(sheet: SheetV1, weaponName: string, current: number): SheetV1 {
  return {
    ...sheet,
    weapons: sheet.weapons.map((w) =>
      w.name === weaponName && w.ammo
        ? { ...w, ammo: { ...w.ammo, current: clampFill(current, w.ammo.cap) } }
        : w,
    ),
  };
}

// ---------------------------------------------------------------------------
// Drain (FR8.1): user-entered drain codes like 'F-3' → value at a Force,
// minimum 2. Plain numbers pass through. Unknown formats return null.
// ---------------------------------------------------------------------------

export function drainValue(code: string | undefined, force: number): number | null {
  if (!code) return null;
  const trimmed = code.trim();
  const asNumber = /^\d+$/.exec(trimmed);
  if (asNumber) return Math.max(2, Number(trimmed));
  const m = /^F\s*(?:([+-])\s*(\d+))?$/i.exec(trimmed);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const off = m[2] ? sign * Number(m[2]) : 0;
  return Math.max(2, force + off);
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

/**
 * Hits from the most recent `roll.created` event whose request meta carries
 * `drainFor === spell` — prefills the drain application panel (FR8.1).
 * INTEGRATION: payload shape assumed `{ request: { meta }, result: { hits } }`
 * with flat `meta` / `hits` tolerated; align with the rolls plugin.
 */
export function drainHitsFromEvents(events: readonly WsEvent[], spell: string): number | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || event.type !== 'roll.created') continue;
    const p = asRecord(event.payload);
    const meta = asRecord(asRecord(p['request'])['meta'] ?? p['meta']);
    if (meta['drainFor'] !== spell) continue;
    const result = asRecord(p['result'] ?? p);
    const hits = result['limitedHits'] ?? result['hits'];
    return typeof hits === 'number' ? hits : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ledger (FR3.6): balances are sums; player spends are pending until approved.
// ---------------------------------------------------------------------------

export interface CurrencyBalance {
  approved: number;
  pending: number;
}

export interface LedgerBalances {
  karma: CurrencyBalance;
  nuyen: CurrencyBalance;
}

export function ledgerBalances(entries: readonly LedgerEntry[]): LedgerBalances {
  const out: LedgerBalances = {
    karma: { approved: 0, pending: 0 },
    nuyen: { approved: 0, pending: 0 },
  };
  for (const e of entries) {
    const bucket = out[e.currency];
    if (e.state === 'approved') bucket.approved += e.delta;
    else if (e.state === 'pending') bucket.pending += e.delta;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formatting + misc
// ---------------------------------------------------------------------------

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function formatNuyen(n: number): string {
  return `${n.toLocaleString('en-US')}¥`;
}

/** In-app reader route for a {book, page} ref (M11, FR11.3). */
export function readerHref(ref: Ref): string {
  return `/read/${encodeURIComponent(ref.book)}?p=${ref.page}`;
}

/** A situational chip in the roll dialog — toggleable pool contribution. */
export interface RollChip {
  id: string;
  label: string;
  value: number;
  active: boolean;
  /** Provenance source tag carried into the roll's breakdown. */
  source: string;
}

export function chipSum(chips: readonly RollChip[]): number {
  return chips.reduce((sum, c) => (c.active ? sum + c.value : sum), 0);
}

export function chipEntries(chips: readonly RollChip[]): ProvenanceEntry[] {
  return chips
    .filter((c) => c.active && c.value !== 0)
    .map((c) => ({ label: c.label, value: c.value, source: c.source }));
}

export function clampPool(n: number): number {
  return Math.max(0, Math.floor(n));
}
