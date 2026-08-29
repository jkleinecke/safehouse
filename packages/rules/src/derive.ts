import type {
  DerivedCharacter,
  DerivedValue,
  InitiativeLine,
  Modifier,
  ProvenanceEntry,
  SheetV1,
} from '@safehouse/contracts';
import { applyPipeline, baseEntry } from './derive-pipeline.js';
import { buildPools } from './derive-pools.js';

export * from './derive-pipeline.js';
export { buildPools, deriveArmor, skillLimitKind } from './derive-pools.js';

export interface DeriveContext {
  /** Scene/range/situational modifiers active for this derivation (FR9.11). */
  situational?: Modifier[];
  /** Filled boxes per monitor — drives the wound modifier (§10.2). */
  wounds?: { physical: number; stun: number };
}

/** Negate without ever producing -0. */
const neg = (n: number): number => (n === 0 ? 0 : -n);

/** −1 per 3 filled boxes per monitor, cumulative across monitors (§10.2). */
export function woundModifierFor(wounds: { physical: number; stun: number }): number {
  return neg(
    Math.floor(Math.max(0, wounds.physical) / 3) + Math.floor(Math.max(0, wounds.stun) / 3),
  );
}

const CORE_ATTRS = ['bod', 'agi', 'rea', 'str', 'wil', 'log', 'int', 'cha'] as const;

/**
 * ONE authority per scene modifier. The active scene's environment is derived
 * server-side and can reach the engine a second time as a client-side "chip"
 * for the same scene — which silently doubled the penalty (a −1 scene applied
 * as −2, with the note printed twice in the receipt). Collapse `scene`
 * modifiers that name the same `(source.kind, source.ref, target)` triple,
 * whoever assembled the list; everything else passes through untouched, in
 * order.
 */
export function dedupeSceneModifiers(mods: readonly Modifier[]): Modifier[] {
  const seen = new Set<string>();
  const out: Modifier[] = [];
  for (const mod of mods) {
    if (mod.source.kind !== 'scene') {
      out.push(mod);
      continue;
    }
    const key = `${mod.source.kind}|${mod.source.ref ?? ''}|${mod.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mod);
  }
  return out;
}

/** All active-able modifiers carried on the sheet itself, in pipeline terms. */
function collectSheetModifiers(sheet: SheetV1): Modifier[] {
  const mods: Modifier[] = [];
  for (const q of sheet.qualities) mods.push(...q.mods);
  for (const a of sheet.augments) mods.push(...a.mods);
  for (const p of sheet.powers) mods.push(...p.mods);
  mods.push(...sheet.overrides);
  return mods;
}

function dv(value: number, breakdown: ProvenanceEntry[]): DerivedValue {
  return { value, breakdown };
}

interface InitLineSpec {
  key: 'physical' | 'astral' | 'matrixAR' | 'vrCold' | 'vrHot';
  base: number;
  baseEntries: ProvenanceEntry[];
  dice: number;
  /** physical + matrixAR also honor the generic initiative.* targets. */
  generic: boolean;
}

const INITIATIVE_DICE_CAP = 5;

/**
 * One initiative variant. Generic `initiative.score` / `initiative.dice`
 * modifiers apply to the meat-world lines (physical, matrixAR); every variant
 * honors its specific `initiative.<key>.score` / `.dice` targets; wound
 * modifiers (kind 'wound' on `initiative.score`) hit ALL variants' scores.
 * Total dice are capped at 5d6 (§10.2), with the clip in the provenance.
 */
function initiativeLine(spec: InitLineSpec, mods: readonly Modifier[]): InitiativeLine {
  const scoreTargets = [`initiative.${spec.key}.score`];
  const diceTargets = [`initiative.${spec.key}.dice`];
  if (spec.generic) {
    scoreTargets.push('initiative.score');
    diceTargets.push('initiative.dice');
  }
  let scoreMods: readonly Modifier[] = mods;
  if (!spec.generic) {
    // Wounds always drag the score, whatever the plane (§10.2).
    scoreMods = [
      ...mods,
      ...mods
        .filter((m) => m.source.kind === 'wound' && m.target === 'initiative.score')
        .map((m) => ({ ...m, target: `initiative.${spec.key}.score` })),
    ];
  }
  const base = applyPipeline(spec.base, spec.baseEntries, scoreTargets, scoreMods);
  const dice = applyPipeline(
    spec.dice,
    [baseEntry(`${spec.dice}d6`, spec.dice)],
    diceTargets,
    mods,
    { floorZero: true },
  );
  let diceValue = dice.value;
  const diceBreakdown = dice.breakdown;
  if (diceValue > INITIATIVE_DICE_CAP) {
    diceBreakdown.push({
      label: `initiative dice cap (${INITIATIVE_DICE_CAP}d6)`,
      value: INITIATIVE_DICE_CAP - diceValue,
      source: 'engine',
    });
    diceValue = INITIATIVE_DICE_CAP;
  }
  return { base: dv(base.value, base.breakdown), dice: dv(diceValue, diceBreakdown) };
}

/**
 * (sheet JSON, situational state) → derived character with per-value
 * provenance (DESIGN.md §10.2, FR3.3). Pure — no I/O.
 *
 * Pipeline order: base → qualities → augmentation → magic → status →
 * wounds → scene/range/situational → override (§7.2).
 */
export function deriveCharacter(sheet: SheetV1, ctx?: DeriveContext): DerivedCharacter {
  // Scene modifiers are deduped here so no caller can double-count the active
  // scene, whether it arrived from the db or bounced off a client.
  const mods: Modifier[] = dedupeSceneModifiers([
    ...collectSheetModifiers(sheet),
    ...(ctx?.situational ?? []),
  ]);

  // Wound modifier → ordinary pipeline modifiers in the 'wound' phase.
  let woundModifier: DerivedValue | undefined;
  if (ctx?.wounds) {
    const physicalSteps = neg(Math.floor(Math.max(0, ctx.wounds.physical) / 3));
    const stunSteps = neg(Math.floor(Math.max(0, ctx.wounds.stun) / 3));
    const wm = physicalSteps + stunSteps;
    woundModifier = dv(wm, [
      {
        label: `physical wounds (${ctx.wounds.physical} boxes)`,
        value: physicalSteps,
        source: 'wound',
      },
      { label: `stun wounds (${ctx.wounds.stun} boxes)`, value: stunSteps, source: 'wound' },
    ]);
    if (wm !== 0) {
      const note = `wound modifier (${ctx.wounds.physical}P/${ctx.wounds.stun}S boxes)`;
      mods.push(
        {
          id: 'wound.pools',
          source: { kind: 'wound' },
          target: 'pool.all',
          op: 'add',
          value: wm,
          active: true,
          note,
        },
        {
          id: 'wound.initiative',
          source: { kind: 'wound' },
          target: 'initiative.score',
          op: 'add',
          value: wm,
          active: true,
          note,
        },
      );
    }
  }

  // --- Essence: base ESS − Σ augment essence costs (§10.2). ---
  const essBase = sheet.attributes.ess;
  const essEntries: ProvenanceEntry[] = [baseEntry('Essence', essBase)];
  let essLost = 0;
  for (const aug of sheet.augments) {
    if (aug.essence > 0) {
      essLost += aug.essence;
      essEntries.push({ label: aug.name, value: -aug.essence, source: 'cyberware' });
    }
  }
  const essPiped = applyPipeline(essBase - essLost, essEntries, ['attr.ess'], mods, {
    floorZero: true,
  });

  // --- Attributes ---
  const attributes: Record<string, DerivedValue> = {};
  for (const code of CORE_ATTRS) {
    const base = sheet.attributes[code];
    const res = applyPipeline(base, [baseEntry(code.toUpperCase(), base)], [`attr.${code}`], mods, {
      floorZero: true,
    });
    attributes[code] = dv(res.value, res.breakdown);
  }
  attributes['ess'] = dv(essPiped.value, essPiped.breakdown);

  // MAG/RES: reduced by Essence lost, rounded up (§10.2 Essence→MAG).
  const magicLoss = essLost > 0 ? Math.ceil(essLost - 1e-9) : 0;
  for (const code of ['mag', 'res'] as const) {
    const base = sheet.attributes[code];
    const entries: ProvenanceEntry[] = [baseEntry(code.toUpperCase(), base)];
    let start = base;
    if (base > 0 && magicLoss > 0) {
      const loss = Math.min(magicLoss, base);
      entries.push({ label: `Essence loss (−⌈${essLost}⌉)`, value: -loss, source: 'cyberware' });
      start -= loss;
    }
    const res = applyPipeline(start, entries, [`attr.${code}`], mods, { floorZero: true });
    attributes[code] = dv(res.value, res.breakdown);
  }
  attributes['edg'] = dv(sheet.attributes.edg.max, [baseEntry('EDG', sheet.attributes.edg.max)]);

  const a = (code: string): number => attributes[code]?.value ?? 0;

  // --- Limits (§10.2) ---
  const limitSpecs = [
    {
      key: 'physical' as const,
      raw: Math.ceil((a('str') * 2 + a('bod') + a('rea')) / 3),
      label: '⌈(STR×2+BOD+REA)/3⌉',
    },
    {
      key: 'mental' as const,
      raw: Math.ceil((a('log') * 2 + a('int') + a('wil')) / 3),
      label: '⌈(LOG×2+INT+WIL)/3⌉',
    },
    {
      key: 'social' as const,
      raw: Math.ceil((a('cha') * 2 + a('wil') + a('ess')) / 3),
      label: '⌈(CHA×2+WIL+ESS)/3⌉',
    },
  ];
  const limits = {} as Record<'physical' | 'mental' | 'social', DerivedValue>;
  for (const spec of limitSpecs) {
    const res = applyPipeline(
      spec.raw,
      [baseEntry(spec.label, spec.raw)],
      [`limit.${spec.key}`],
      mods,
      { floorZero: true },
    );
    limits[spec.key] = dv(res.value, res.breakdown);
  }

  // --- Condition monitor sizes (§10.2) ---
  const monitorSpecs = [
    { key: 'physical' as const, raw: 8 + Math.ceil(a('bod') / 2), label: '8+⌈BOD/2⌉' },
    { key: 'stun' as const, raw: 8 + Math.ceil(a('wil') / 2), label: '8+⌈WIL/2⌉' },
    { key: 'overflow' as const, raw: a('bod'), label: 'BOD' },
  ];
  const monitors = {} as Record<'physical' | 'stun' | 'overflow', DerivedValue>;
  for (const spec of monitorSpecs) {
    const res = applyPipeline(
      spec.raw,
      [baseEntry(spec.label, spec.raw)],
      [`monitor.${spec.key}`],
      mods,
      { floorZero: true },
    );
    monitors[spec.key] = dv(res.value, res.breakdown);
  }

  // --- Initiative variants (§10.2, FR4.2) ---
  const rea = a('rea');
  const int = a('int');
  const dp = sheet.matrix.deck?.asdf[2] ?? 0;
  const meat: ProvenanceEntry[] = [
    { label: 'REA', value: rea, source: 'attribute' },
    { label: 'INT', value: int, source: 'attribute' },
  ];
  const dpInt: ProvenanceEntry[] = [
    { label: 'Data Processing', value: dp, source: 'attribute' },
    { label: 'INT', value: int, source: 'attribute' },
  ];
  const initiative = {
    physical: initiativeLine(
      { key: 'physical', base: rea + int, baseEntries: [...meat], dice: 1, generic: true },
      mods,
    ),
    astral: initiativeLine(
      {
        key: 'astral',
        base: int * 2,
        baseEntries: [{ label: 'INT×2', value: int * 2, source: 'attribute' }],
        dice: 2,
        generic: false,
      },
      mods,
    ),
    matrixAR: initiativeLine(
      { key: 'matrixAR', base: rea + int, baseEntries: [...meat], dice: 1, generic: true },
      mods,
    ),
    vrCold: initiativeLine(
      { key: 'vrCold', base: dp + int, baseEntries: [...dpInt], dice: 3, generic: false },
      mods,
    ),
    vrHot: initiativeLine(
      { key: 'vrHot', base: dp + int, baseEntries: [...dpInt], dice: 4, generic: false },
      mods,
    ),
  };

  // --- Movement: walk AGI×2 / run AGI×4 m per turn (FR9.8) ---
  const agi = a('agi');
  const walk = applyPipeline(
    agi * 2,
    [{ label: 'AGI×2', value: agi * 2, source: 'attribute' }],
    ['movement.walk'],
    mods,
    { floorZero: true },
  );
  const run = applyPipeline(
    agi * 4,
    [{ label: 'AGI×4', value: agi * 4, source: 'attribute' }],
    ['movement.run'],
    mods,
    { floorZero: true },
  );

  // --- Pools ---
  const pools = buildPools(sheet, attributes, limits, mods);

  return {
    attributes,
    limits,
    monitors,
    initiative,
    movement: { walk: dv(walk.value, walk.breakdown), run: dv(run.value, run.breakdown) },
    pools,
    ...(woundModifier ? { woundModifier } : {}),
  };
}
