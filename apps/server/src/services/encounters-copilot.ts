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
  bulletsForMode,
  computeWoundModifier,
  deriveCharacter,
  envRowsOf,
  environmentCompensationFor,
  eyesOnly,
  foldEnvironment,
  lineRef,
  recoilLine,
  resolveAttackChain,
  type AttackChainOptions,
  type EnvironmentCompensation,
  type AttackChainResult,
  type CombatActor,
} from '@safehouse/rules';

// ---------------------------------------------------------------------------
// Fire modes and recoil (FR10.7 "mode and recoil aware")
// ---------------------------------------------------------------------------
//
// The rack and the chain take their rounds per mode and their recoil line from
// the rules package (`bulletsForMode`, `recoilLine`) — the same sums the
// sheet's weapon card uses: one free point, Strength ÷ 3 rounded up and the
// gun's compensation against every round fired (SR5 p.175), with semi-auto
// one round a pull and single shot never recoiling (p.176, 180). The copilot
// used to keep its own shorter table, which left Strength out and fired two
// rounds in semi-auto.

/**
 * Scene environment modifiers (FR9.11) as roll-provenance entries, each
 * keeping the page its modifier named (the Environmental Modifiers table).
 * This is the scene as it stands, for showing — a pool reads it through
 * `sceneEntries`, which folds in a range band and the character's eyes.
 */
export function environmentEntries(mods: readonly Modifier[]): ProvenanceEntry[] {
  return mods
    .filter((m) => m.active && m.op === 'add' && m.value !== 0)
    .map((m) => ({
      label: m.note ?? 'environment',
      value: m.value,
      source: 'scene',
      ...(m.bookRef ? { ref: m.bookRef } : {}),
    }));
}

/**
 * The scene's lines for a pool the copilot builds by hand (the chain's attack
 * and defense, the rack's composure and defaulted perception), read the way
 * `deriveCharacter` reads them for every other pool (SR5 p.173-175): every
 * modifier carrying environment-table rows — the scene, and for a shot its
 * range band — becomes ONE line, the worst row after the character's
 * compensation, one row worse when two tie. The range band joins the scene's
 * line; it is never added on top of it. Anything else the GM put on the scene
 * follows as its own line.
 */
export function sceneEntries(
  mods: readonly Modifier[],
  compensation: EnvironmentCompensation,
  range?: Modifier | null,
): ProvenanceEntry[] {
  const env = foldEnvironment([...mods, ...(range ? [range] : [])], { compensation });
  const rest = environmentEntries(mods.filter((m) => envRowsOf(m) === undefined));
  return [...(env ? [env] : []), ...rest];
}

/**
 * What a sheet brings against the environment on a shot (its eyes and its
 * smartlink) and on anything else (its eyes alone) — `buildPools` splits it
 * the same way.
 */
export function environmentCompensation(sheet: SheetV1): { shot: EnvironmentCompensation; sight: EnvironmentCompensation } {
  const shot = environmentCompensationFor(sheet);
  return { shot, sight: eyesOnly(shot) };
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

function adjustments(woundModifier: number, envLines: readonly ProvenanceEntry[]): ProvenanceEntry[] {
  const out: ProvenanceEntry[] = [];
  if (woundModifier !== 0) {
    out.push({ label: 'Wounds', value: woundModifier, source: 'wound', ref: lineRef('wounds') });
  }
  out.push(...envLines);
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
  // Composure and a defaulted Perception are not shots: the eyes count, the
  // smartlink does not, and there is no range band to fold in.
  const envLines = sceneEntries(
    situational.filter((m) => m.target === 'pool.all'),
    environmentCompensation(sheet).sight,
  );
  const entries: RackEntry[] = [];

  // --- attack per weapon --------------------------------------------------
  for (const weapon of sheet.weapons) {
    const pool = derived.pools[`weapon.${weapon.name}`];
    if (!pool) continue;
    const mode = ctx.modes?.[weapon.name] ?? weapon.modes[0] ?? null;
    const bullets = ctx.bullets?.[weapon.name] ?? bulletsForMode(mode);
    const breakdown = [...pool.breakdown];
    // No rounds fired before this one as far as the rack knows: it keeps no
    // per-turn count, so a second burst in the same turn is the GM's edit.
    const recoil = recoilLine({
      mode,
      bullets,
      recoilComp: weapon.recoilComp ?? 0,
      strength: attr(derived, 'str'),
    });
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
      { label: 'WIL (Full Defense)', value: wil, source: 'situational', ref: lineRef('fullDefense') },
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
      ...adjustments(woundModifier, envLines),
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
        { label: 'defaulting (no perception)', value: -1, source: 'skill', ref: lineRef('defaulting') },
        ...adjustments(woundModifier, envLines),
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
    // The sheet's own Physical limit, for a Dodge, Block or Parry (SR5 p.191).
    physicalLimit: derived.limits.physical.value,
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
