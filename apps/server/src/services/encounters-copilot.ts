/**
 * Combat copilot maths (FR10.7–10.9) — PURE helpers, no db, no hub.
 *
 * `EncountersService` (services/encounters.ts) loads the sheets/scene and calls
 * into here; keeping this half I/O-free means the quick-roll rack and the
 * resolved chain are unit-testable and share one provenance vocabulary with the
 * rules engine (Principle 3: every number carries its receipt).
 */
import type {
  CombatantMonitors,
  DerivedCharacter,
  LimitRef,
  Modifier,
  ProvenanceEntry,
  RollResult,
  SheetV1,
  SheetWeapon,
} from '@safehouse/contracts';
import {
  computeWoundModifier,
  deriveCharacter,
  resolveAttackChain,
  type AttackChainOptions,
  type AttackChainResult,
  type CombatActor,
} from '@safehouse/rules';

// ---------------------------------------------------------------------------
// Fire modes and recoil (FR10.7 "mode and recoil aware")
// ---------------------------------------------------------------------------

/**
 * Bullets fired by one Simple/Complex action per mode. GM-editable per roll via
 * the `bullets` field — these are only the defaults the rack starts from.
 */
export const MODE_BULLETS: Readonly<Record<string, number>> = {
  SS: 1,
  SA: 2,
  BF: 3,
  FA: 6,
};

/** Bullets for a mode string (case-insensitive), 1 when unknown. */
export function bulletsForMode(mode: string | undefined): number {
  if (!mode) return 1;
  return MODE_BULLETS[mode.trim().toUpperCase()] ?? 1;
}

/**
 * Recoil penalty for firing `bullets` rounds with `recoilComp` compensation:
 * the first bullet is free, every further uncompensated one is −1 die.
 * Returns null when nothing is owed (so the rack stays quiet at single shot).
 */
export function recoilEntry(bullets: number, recoilComp = 0): ProvenanceEntry | null {
  const uncompensated = Math.max(0, Math.floor(bullets) - 1 - Math.max(0, recoilComp));
  if (uncompensated <= 0) return null;
  return {
    label: `recoil (${bullets} rounds, ${recoilComp} comp)`,
    value: -uncompensated,
    source: 'situational',
  };
}

/** Scene environment modifiers (FR9.11) as roll-provenance entries. */
export function environmentEntries(mods: readonly Modifier[]): ProvenanceEntry[] {
  return mods
    .filter((m) => m.active && m.op === 'add' && m.value !== 0)
    .map((m) => ({ label: m.note ?? 'environment', value: m.value, source: 'scene' }));
}

/** Total of the `pool.all` add-modifiers (scene/situational) for hand-built pools. */
function poolAllDelta(mods: readonly Modifier[]): number {
  return mods
    .filter((m) => m.active && m.op === 'add' && m.target === 'pool.all')
    .reduce((sum, m) => sum + m.value, 0);
}

// ---------------------------------------------------------------------------
// Quick-roll rack (FR10.7)
// ---------------------------------------------------------------------------

export type RackKind = 'attack' | 'defense' | 'soak' | 'composure' | 'perception' | 'skill';

/** One tappable row of the rack: a ready pool with its full receipt. */
export interface RackEntry {
  /** Stable id the quick-roll endpoint takes (`attack:Beretta`, `defense`, …). */
  key: string;
  kind: RackKind;
  label: string;
  pool: number;
  breakdown: ProvenanceEntry[];
  limit?: LimitRef;
  /** Attack rows only: the weapon's live combat data for the chain/UI. */
  weapon?: {
    name: string;
    mode: string | null;
    modes: string[];
    bullets: number;
    ap: number;
    dv: string | null;
    rangeCat: string | null;
    recoilComp: number;
    ammo: { cap: number; current: number } | null;
  };
  note?: string;
}

export interface RackContext {
  /** Live monitor fill — drives the wound modifier automatically (FR10.7). */
  monitors: CombatantMonitors;
  /** Scene environment + any GM situational modifiers (FR9.11). */
  situational?: Modifier[];
  /** Fire mode per weapon name; defaults to the weapon's first listed mode. */
  modes?: Record<string, string>;
  /** Bullet count override per weapon name (progressive recoil, FR3.4). */
  bullets?: Record<string, number>;
}

export interface QuickRollRack {
  entries: RackEntry[];
  /** Wound modifier already folded into every non-soak pool. */
  woundModifier: number;
  /** The derived character behind the rack (provenance for the UI). */
  derived: DerivedCharacter;
}

function attr(derived: DerivedCharacter, code: string): number {
  return derived.attributes[code]?.value ?? 0;
}

function adjustments(woundModifier: number, envDelta: number): ProvenanceEntry[] {
  const out: ProvenanceEntry[] = [];
  if (woundModifier !== 0) out.push({ label: 'Wounds', value: woundModifier, source: 'wound' });
  if (envDelta !== 0) out.push({ label: 'Environment', value: envDelta, source: 'scene' });
  return out;
}

function sumEntries(entries: ProvenanceEntry[]): number {
  return Math.max(
    0,
    entries.reduce((sum, e) => sum + e.value, 0),
  );
}

/**
 * Build the FR10.7 quick-roll rack for one combatant: attack per weapon (mode
 * and recoil aware), defense (plus the Full Defense variant), soak, composure,
 * perception, and every skill pool the sheet carries. Scene modifiers and the
 * wound state are honored automatically — the GM taps, the maths is already done.
 */
export function buildRack(sheet: SheetV1, ctx: RackContext): QuickRollRack {
  const situational = ctx.situational ?? [];
  const wounds = { physical: ctx.monitors.physical.filled, stun: ctx.monitors.stun.filled };
  const derived = deriveCharacter(sheet, { wounds, situational });
  const woundModifier = computeWoundModifier(ctx.monitors);
  const envDelta = poolAllDelta(situational);
  const entries: RackEntry[] = [];

  // --- attack per weapon --------------------------------------------------
  for (const weapon of sheet.weapons) {
    const pool = derived.pools[`weapon.${weapon.name}`];
    if (!pool) continue;
    const mode = ctx.modes?.[weapon.name] ?? weapon.modes[0] ?? null;
    const bullets = ctx.bullets?.[weapon.name] ?? bulletsForMode(mode ?? undefined);
    const breakdown = [...pool.breakdown];
    const recoil = recoilEntry(bullets, weapon.recoilComp ?? 0);
    if (recoil) breakdown.push(recoil);
    entries.push({
      key: `attack:${weapon.name}`,
      kind: 'attack',
      label: mode ? `${weapon.name} (${mode})` : weapon.name,
      pool: sumEntries(breakdown),
      breakdown,
      ...(pool.limit ? { limit: pool.limit } : {}),
      weapon: {
        name: weapon.name,
        mode,
        modes: weapon.modes,
        bullets,
        ap: weapon.ap,
        dv: weapon.dv ?? null,
        rangeCat: weapon.rangeCat ?? null,
        recoilComp: weapon.recoilComp ?? 0,
        ammo: weapon.ammo ? { cap: weapon.ammo.cap, current: weapon.ammo.current } : null,
      },
    });
  }

  // --- defense (REA + INT) and the Full Defense variant --------------------
  const defense = derived.pools['defense'];
  if (defense) {
    entries.push({
      key: 'defense',
      kind: 'defense',
      label: 'Defense',
      pool: defense.total,
      breakdown: defense.breakdown,
    });
    const wil = attr(derived, 'wil');
    const fullBreakdown: ProvenanceEntry[] = [
      ...defense.breakdown,
      { label: 'WIL (Full Defense)', value: wil, source: 'situational' },
    ];
    entries.push({
      key: 'defense.full',
      kind: 'defense',
      label: 'Full Defense',
      pool: sumEntries(fullBreakdown),
      breakdown: fullBreakdown,
      note: 'costs 10 Initiative Score (FR4.4)',
    });
  }

  // --- soak (BOD + armor; exempt from wound/scene penalties per §10.2) -----
  const soak = derived.pools['soak'];
  if (soak) {
    entries.push({
      key: 'soak',
      kind: 'soak',
      label: 'Soak',
      pool: soak.total,
      breakdown: soak.breakdown,
    });
  }

  // --- composure (WIL + CHA) ----------------------------------------------
  {
    const wil = attr(derived, 'wil');
    const cha = attr(derived, 'cha');
    const breakdown: ProvenanceEntry[] = [
      { label: 'WIL', value: wil, source: 'attribute' },
      { label: 'CHA', value: cha, source: 'attribute' },
      ...adjustments(woundModifier, envDelta),
    ];
    entries.push({
      key: 'composure',
      kind: 'composure',
      label: 'Composure',
      pool: sumEntries(breakdown),
      breakdown,
      limit: { kind: 'social', value: derived.limits.social.value },
    });
  }

  // --- perception (the skill pool when present, else INT defaulting) -------
  {
    const skillPool = derived.pools['skill.perception'];
    if (skillPool) {
      entries.push({
        key: 'perception',
        kind: 'perception',
        label: 'Perception',
        pool: skillPool.total,
        breakdown: skillPool.breakdown,
        ...(skillPool.limit ? { limit: skillPool.limit } : {}),
      });
    } else {
      const int = attr(derived, 'int');
      const breakdown: ProvenanceEntry[] = [
        { label: 'INT', value: int, source: 'attribute' },
        { label: 'defaulting (no perception)', value: -1, source: 'skill' },
        ...adjustments(woundModifier, envDelta),
      ];
      entries.push({
        key: 'perception',
        kind: 'perception',
        label: 'Perception (defaulting)',
        pool: sumEntries(breakdown),
        breakdown,
        limit: { kind: 'mental', value: derived.limits.mental.value },
      });
    }
  }

  // --- every skill the sheet carries (the template's key skills, FR10.7) --
  for (const skill of sheet.skills) {
    const pool = derived.pools[`skill.${skill.id}`];
    if (!pool) continue;
    entries.push({
      key: `skill:${skill.id}`,
      kind: 'skill',
      label: skill.spec ? `${skill.id} (${skill.spec})` : skill.id,
      pool: pool.total,
      breakdown: pool.breakdown,
      ...(pool.limit ? { limit: pool.limit } : {}),
    });
  }

  return { entries, woundModifier, derived };
}

/** Find one rack row by key (404 handling belongs to the caller). */
export function rackEntry(rack: QuickRollRack, key: string): RackEntry | undefined {
  return rack.entries.find((e) => e.key === key);
}

// ---------------------------------------------------------------------------
// Resolved attack chain (FR10.8)
// ---------------------------------------------------------------------------

/**
 * Build a `CombatActor` for the chain. Derives WITHOUT wounds on purpose: the
 * chain adds its own wound line from `monitors`, so folding them in here would
 * double-count them. Scene modifiers ride in as chain `attackModifiers` /
 * `defenseModifiers` instead.
 */
export function chainActor(
  sheet: SheetV1,
  monitors: CombatantMonitors,
  opts: { name?: string; weaponName?: string } = {},
): CombatActor {
  const derived = deriveCharacter(sheet);
  const attackPool = opts.weaponName ? derived.pools[`weapon.${opts.weaponName}`]?.total : undefined;
  return {
    ...(opts.name ? { name: opts.name } : {}),
    attributes: {
      bod: attr(derived, 'bod'),
      rea: attr(derived, 'rea'),
      int: attr(derived, 'int'),
      str: attr(derived, 'str'),
      wil: attr(derived, 'wil'),
    },
    ...(attackPool !== undefined ? { attackPool } : {}),
    armor: derived.pools['armor']?.total ?? 0,
    woundModifier: computeWoundModifier(monitors),
    monitors,
  };
}

/** One overridable step of the exchange, rendered as a card (FR10.8). */
export interface ChainCard {
  step: 'attack' | 'defense' | 'damage' | 'soak' | 'apply';
  label: string;
  /** Every card is GM-overridable before commit (Principle 2). */
  overridable: true;
  data: Record<string, unknown>;
}

export interface ChainOutcome {
  result: AttackChainResult;
  cards: ChainCard[];
  /** What `commit` will apply unless the GM overrides it. */
  suggested: { boxes: number; track: 'physical' | 'stun' } | null;
}

/** Resolve the exchange and render it as the FR10.8 card stack. */
export function resolveChain(
  attacker: CombatActor,
  defender: CombatActor,
  weapon: SheetWeapon,
  rng: () => number,
  opts: AttackChainOptions = {},
): ChainOutcome {
  const result = resolveAttackChain(attacker, defender, weapon, rng, opts);
  const cards: ChainCard[] = [
    {
      step: 'attack',
      label: `Attack — ${weapon.name}`,
      overridable: true,
      data: {
        pool: result.attack.pool,
        breakdown: result.attack.breakdown,
        limit: result.attack.limit ?? null,
        roll: result.attack.roll,
      },
    },
    {
      step: 'defense',
      label: result.defense.fullDefense ? 'Defense (Full Defense)' : 'Defense',
      overridable: true,
      data: {
        pool: result.defense.pool,
        breakdown: result.defense.breakdown,
        roll: result.defense.roll,
        netHits: result.netHits,
        outcome: result.outcome,
      },
    },
  ];
  if (result.damage) {
    cards.push({
      step: 'damage',
      label: `Modified DV ${result.damage.modifiedDv}${result.damage.type}`,
      overridable: true,
      data: { ...result.damage },
    });
  }
  if (result.soak) {
    cards.push({
      step: 'soak',
      label: `Soak — ${result.soak.boxes} box(es) through`,
      overridable: true,
      data: {
        pool: result.soak.pool,
        breakdown: result.soak.breakdown,
        roll: result.soak.roll,
        boxes: result.soak.boxes,
        track: result.soak.track,
      },
    });
    cards.push({
      step: 'apply',
      label: `Apply ${result.soak.boxes} to ${result.soak.track}`,
      overridable: true,
      data: {
        boxes: result.soak.boxes,
        track: result.soak.track,
        projected: result.applied?.monitors ?? null,
        woundModifier: result.applied?.woundModifier ?? null,
      },
    });
  }
  const suggested = result.soak ? { boxes: result.soak.boxes, track: result.soak.track } : null;
  return { result, cards, suggested };
}

/** Pre-rolled dice the GM forced onto a step (FR10.8 overrides). */
export type ChainRollOverrides = { attack?: RollResult; defense?: RollResult; soak?: RollResult };
