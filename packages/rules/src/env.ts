import type { Modifier, RangeTables, SceneEnvironment } from '@safehouse/contracts';

/**
 * Environmental tier values (§10.2): index 0 = clear, then the standard
 * −1/−3/−6/−10 ladder. A single axis at its worst level (3) is tier 3 (−6);
 * tier 4 (−10) is only reached by composition.
 */
export const ENVIRONMENT_TIER_VALUES = [0, -1, -3, -6, -10] as const;

const TIER_NAMES = ['clear', 'light', 'moderate', 'heavy', 'extreme'] as const;

const ENV_AXES = ['light', 'visibility', 'glare', 'wind'] as const;

/**
 * Compose a scene's light/visibility/glare/wind levels (0–3 each) into a
 * single `scene` modifier per the SR5-style environmental tiers (FR9.11,
 * §10.2): take the worst axis; when two or more axes sit at that same worst
 * level, escalate one tier (capped at −10). Clear conditions emit nothing.
 */
export function environment(scene: SceneEnvironment): Modifier[] {
  const levels = ENV_AXES.map((axis) => ({ axis, level: scene[axis] ?? 0 }));
  const worst = Math.max(...levels.map((l) => l.level));
  if (worst <= 0) return [];

  const atWorst = levels.filter((l) => l.level === worst);
  const tier = Math.min(
    ENVIRONMENT_TIER_VALUES.length - 1,
    atWorst.length >= 2 ? worst + 1 : worst,
  );
  const value = ENVIRONMENT_TIER_VALUES[tier] ?? 0;
  const contributors = levels
    .filter((l) => l.level > 0)
    .map((l) => `${l.axis} ${l.level}`)
    .join(', ');

  return [
    {
      id: 'env.scene',
      source: { kind: 'scene' },
      target: 'pool.all',
      op: 'add',
      value,
      active: true,
      note: `environment: ${contributors} → ${TIER_NAMES[tier] ?? 'extreme'} (${value})`,
    },
  ];
}

/** Range band modifiers by band index: short/medium/long/extreme (FR9.9). */
export const RANGE_BAND_VALUES = [0, -1, -3, -6] as const;

const RANGE_BAND_NAMES = ['short', 'medium', 'long', 'extreme'] as const;

/**
 * Range band modifier for a shot at `distM` meters using the sheet's
 * user-entered range table for `rangeCat` (FR9.9, §10.2). Band edges are
 * inclusive upper bounds in meters ([short, medium, long, extreme]).
 * Returns a 0-value `range` Modifier at short range (so provenance still
 * names the band), and null when the category is unknown, the distance is
 * negative, or beyond extreme range.
 */
export function rangeModifier(
  distM: number,
  rangeCat: string,
  rangeTables: RangeTables,
): Modifier | null {
  const bands = rangeTables[rangeCat];
  if (!bands || distM < 0) return null;

  const idx = bands.findIndex((edge) => distM <= edge);
  if (idx === -1) return null; // beyond extreme range

  const name = RANGE_BAND_NAMES[idx] ?? 'extreme';
  return {
    id: `range.${rangeCat}.${name}`,
    source: { kind: 'range', ref: rangeCat },
    target: 'pool.all',
    op: 'add',
    value: RANGE_BAND_VALUES[idx] ?? 0,
    active: true,
    note: `${name} range (${distM} m, ${rangeCat})`,
  };
}
