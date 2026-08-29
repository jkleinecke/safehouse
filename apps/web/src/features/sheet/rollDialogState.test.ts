/**
 * The roll dialog's arithmetic, and the LIVE-2 regression it was built to
 * close: the active scene's environment must land in a roll exactly once.
 */
import { describe, expect, it } from 'vitest';
import type { PoolBreakdown, ProvenanceEntry, SheetSkill } from '@safehouse/contracts';
import { isActivationKey, skillRowLabel } from './a11y.js';
import {
  activeChips,
  appliedSceneEntries,
  buildRollRequest,
  chipModifiers,
  chipTarget,
  MANUAL_SITUATIONAL_ID,
  poolRefOf,
  RANGE_CHIP_ID,
  rollBreakdown,
  rollPool,
  skillRollConfig,
  withPendingRangeChip,
  type RollConfig,
} from './rollDialogState.js';
import type { RollChip } from './lib.js';

/**
 * What `GET /api/characters/:id/derived` returns for Perception in a
 * dimly-lit scene: INT 4 + rating 2, then the scene's −1 already applied.
 * This is the exact shape observed live — sheet said 5, dialog offered 4.
 */
const PERCEPTION: PoolBreakdown = {
  total: 5,
  breakdown: [
    { label: 'INT', value: 4, source: 'attribute' },
    { label: 'perception', value: 2, source: 'skill' },
    { label: 'environment: light 1 → light (-1)', value: -1, source: 'scene' },
  ],
  limit: { kind: 'mental', value: 5 },
};

const PERCEPTION_SKILL = {
  id: 'perception',
  attr: 'int',
  rating: 2,
} as unknown as SheetSkill;

function sceneLines(breakdown: readonly ProvenanceEntry[]): ProvenanceEntry[] {
  return breakdown.filter((e) => e.source === 'scene');
}

describe('LIVE-2 — one authority for the scene environment', () => {
  it("the dialog's dice equal the sheet's pool", () => {
    const config = skillRollConfig(PERCEPTION_SKILL, PERCEPTION);
    const chips = activeChips(config, {});
    expect(rollPool(config.baseTotal, chips, 0)).toBe(PERCEPTION.total);
  });

  it('surfaces the scene as context instead of a chip', () => {
    const config = skillRollConfig(PERCEPTION_SKILL, PERCEPTION);
    // Visible…
    expect(appliedSceneEntries(config.baseBreakdown)).toHaveLength(1);
    // …but not offered as something that can be added again.
    expect(activeChips(config, {})).toHaveLength(0);
  });

  it('sends the scene line exactly once in the receipt', () => {
    const config = skillRollConfig(PERCEPTION_SKILL, PERCEPTION);
    const request = buildRollRequest({
      config,
      chips: activeChips(config, {}),
      situational: 0,
      edge: 'none',
      visibility: 'public',
      characterId: 'char-1',
      edgeCurrent: 3,
    });
    expect(sceneLines(request.breakdown)).toHaveLength(1);
    // …and the pool still sums to its own receipt.
    expect(request.breakdown.reduce((n, e) => n + e.value, 0)).toBe(request.pool);
  });

  it('never smuggles a scene modifier into meta.mods', () => {
    const sneaky: RollChip[] = [
      { id: 'env.scene', label: 'environment', value: -1, active: true, source: 'scene' },
    ];
    expect(chipModifiers(sneaky, 0, 'skill.perception')).toEqual([]);
  });
});

describe('the authoritative path (§10.1)', () => {
  it('sends poolRef, which is the key the roll service actually reads', () => {
    const config = skillRollConfig(PERCEPTION_SKILL, PERCEPTION);
    expect(poolRefOf(config.meta)).toBe('skill.perception');
    const request = buildRollRequest({
      config,
      chips: [],
      situational: 0,
      edge: 'none',
      visibility: 'public',
      characterId: 'char-1',
      edgeCurrent: 0,
    });
    expect(request.meta['poolRef']).toBe('skill.perception');
  });

  it('still accepts the older poolKey spelling', () => {
    expect(poolRefOf({ poolKey: 'defense' })).toBe('defense');
    expect(poolRefOf({})).toBeNull();
    expect(poolRefOf(undefined)).toBeNull();
  });

  it('ships client-only chips as meta.mods so the recompute keeps them', () => {
    const chips: RollChip[] = [
      { id: 'range.heavy_pistol.medium', label: 'medium range', value: -1, active: true, source: 'range' },
      { id: 'recoil.Ares', label: 'recoil (3 rds)', value: -2, active: true, source: 'situational' },
      { id: 'mode.BF', label: 'BF burst', value: 0, active: true, source: 'situational' },
      { id: 'spec.pistols', label: 'spec', value: 2, active: false, source: 'situational' },
    ];
    const mods = chipModifiers(chips, -1, 'weapon.Ares');

    // The zero-value marker and the un-armed offer contribute nothing.
    expect(mods.map((m) => m.id)).toEqual([
      'range.heavy_pistol.medium',
      'recoil.Ares',
      MANUAL_SITUATIONAL_ID,
    ]);
    // Every one targets THIS pool, and the range chip keeps its own kind so
    // the server files it under range provenance.
    expect(mods.every((m) => m.target === 'pool.weapon.Ares')).toBe(true);
    expect(mods[0]?.source.kind).toBe('range');
    expect(mods[1]?.source.kind).toBe('situational');
  });

  it('falls back to pool.all when the roll names no pool', () => {
    expect(chipTarget(null)).toBe('pool.all');
    expect(chipTarget('defense')).toBe('pool.defense');
  });
});

describe('chips and situational modifiers', () => {
  const config: RollConfig = {
    title: 'pistols',
    baseTotal: 9,
    baseBreakdown: [{ label: 'base', value: 9, source: 'base' }],
    extraChips: [
      { id: 'spec.pistols', label: 'spec: semi-autos', value: 2, active: false, source: 'situational' },
      { id: 'recoil', label: 'recoil', value: -2, active: true, source: 'situational' },
    ],
  };

  it('arms an offered chip and drops an applied one', () => {
    expect(rollPool(config.baseTotal, activeChips(config, {}), 0)).toBe(7);
    expect(rollPool(config.baseTotal, activeChips(config, { 'spec.pistols': true }), 0)).toBe(9);
    expect(rollPool(config.baseTotal, activeChips(config, { recoil: true }), 0)).toBe(9);
  });

  it('adds the manual situational bump and floors the pool at zero', () => {
    const chips = activeChips(config, {});
    expect(rollPool(config.baseTotal, chips, -3)).toBe(4);
    expect(rollPool(config.baseTotal, chips, -50)).toBe(0);
  });

  it('records only what actually contributed in the receipt', () => {
    const entries = rollBreakdown(config, activeChips(config, {}), 2);
    expect(entries.map((e) => e.label)).toEqual(['base', 'recoil', 'situational']);
  });
});

describe('keyboard-only roll flow', () => {
  /**
   * The whole path a keyboard user takes, driven through the same functions
   * the components call:
   *
   *   Tab to the skill row  → it has a spoken name
   *   Enter (or Space)      → the roll dialog opens on this pool
   *   Enter on "Roll Nd6"   → the request goes out
   *
   * Found live: the rows were `<div>`s with a click handler and no accessible
   * name, so step one had nothing to land on and step two did nothing.
   */
  it('rolls a skill from the keyboard with the sheet-accurate pool', () => {
    const label = skillRowLabel(PERCEPTION_SKILL, PERCEPTION.total, PERCEPTION.limit);
    expect(label).toContain('Roll perception');
    expect(label).toContain('pool 5');
    expect(label).toContain('mental limit 5');

    // Both activation keys reach the row (a real <button> honours each).
    expect(isActivationKey('Enter')).toBe(true);
    expect(isActivationKey(' ')).toBe(true);
    expect(isActivationKey('a')).toBe(false);

    const config = skillRollConfig(PERCEPTION_SKILL, PERCEPTION);
    const chips = activeChips(config, {});
    const pool = rollPool(config.baseTotal, chips, 0);
    expect(pool).toBe(5); // the button reads "Roll 5d6", matching the sheet

    const request = buildRollRequest({
      config,
      chips,
      situational: 0,
      edge: 'none',
      visibility: 'public',
      characterId: 'char-1',
      edgeCurrent: 2,
    });
    expect(request).toMatchObject({
      kind: 'simple',
      pool: 5,
      edge: null,
      visibility: 'public',
      actor: { characterId: 'char-1' },
      limit: { kind: 'mental', value: 5 },
    });
    expect(request.meta['title']).toBe('perception');
    expect(request.meta['mods']).toBeUndefined();
  });

  it('carries the Edge choice and its dice hint', () => {
    const config = skillRollConfig(PERCEPTION_SKILL, PERCEPTION);
    const request = buildRollRequest({
      config,
      chips: [],
      situational: 0,
      edge: 'push_pre',
      visibility: 'gm_owner',
      characterId: 'char-1',
      edgeCurrent: 4,
    });
    expect(request.edge).toBe('push_pre');
    expect(request.visibility).toBe('gm_owner');
    expect(request.meta['edgeDice']).toBe(4);
  });
});

/**
 * FR9.9 — the range the GM measured on the Grid has to reach the dice. The
 * ruler published it to `live/rollHandoff`; nothing on the sheet read it, so
 * the number died on the map.
 */
describe('the ruler → dice handoff', () => {
  const measured = {
    value: -1,
    label: 'medium range (9.5 m, heavy_pistol)',
    sourceKind: 'range' as const,
    ts: Date.now(),
  };

  it('offers the measurement as an armed range chip', () => {
    const config = withPendingRangeChip(skillRollConfig(PERCEPTION_SKILL, PERCEPTION), measured);
    const chip = (config.extraChips ?? []).find((c) => c.id === RANGE_CHIP_ID);
    expect(chip).toMatchObject({ value: -1, active: true, source: 'range' });
    // Armed means it counts: the pool is a die down from the sheet's.
    expect(rollPool(config.baseTotal, activeChips(config, {}), 0)).toBe(PERCEPTION.total - 1);
  });

  it('sends it as a range Modifier, not an anonymous bump', () => {
    const config = withPendingRangeChip(skillRollConfig(PERCEPTION_SKILL, PERCEPTION), measured);
    const mods = chipModifiers(activeChips(config, {}), 0, poolRefOf(config.meta));
    expect(mods).toHaveLength(1);
    expect(mods[0]).toMatchObject({
      source: { kind: 'range' },
      target: 'pool.skill.perception',
      value: -1,
    });
  });

  it('is still one tap away from being dropped', () => {
    const config = withPendingRangeChip(skillRollConfig(PERCEPTION_SKILL, PERCEPTION), measured);
    const chips = activeChips(config, { [RANGE_CHIP_ID]: true });
    expect(rollPool(config.baseTotal, chips, 0)).toBe(PERCEPTION.total);
  });

  it('never adds a second range line — a weapon roll already knows its range', () => {
    const base = skillRollConfig(PERCEPTION_SKILL, PERCEPTION);
    const withOwn: RollConfig = {
      ...base,
      extraChips: [
        { id: 'range.live', label: 'short range', value: 0, active: true, source: 'range' },
      ],
    };
    expect(withPendingRangeChip(withOwn, measured).extraChips).toHaveLength(1);
  });

  it('does nothing without an offer, or with a zero one', () => {
    const base = skillRollConfig(PERCEPTION_SKILL, PERCEPTION);
    expect(withPendingRangeChip(base, null)).toBe(base);
    expect(withPendingRangeChip(base, { ...measured, value: 0 })).toBe(base);
  });
});
