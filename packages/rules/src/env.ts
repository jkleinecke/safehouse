import type {
  EnvRows,
  Modifier,
  ProvenanceEntry,
  RangeTables,
  SceneEnvironment,
} from '@safehouse/contracts';
import type { EnvColumn } from './combat/situational.js';
import { lineRef } from './refs.js';

/**
 * The environment, the way the book reckons it (SR5 p.173-176).
 *
 * The Environmental Modifiers table on p.175 has four columns — visibility,
 * light/glare, wind and range — and one modifier column beside them: nothing,
 * −1, −3, −6, and −10 for two or more conditions on the −6 row. p.173 says how
 * to read it: take only the most severe condition, and when two or more tie
 * for most severe, go one row worse. It adds that range is an environmental
 * condition too. So a pistol shot at medium range in dim light is −3 (dim
 * light is the worst row, and nothing ties it), not −3 for the light and
 * another −1 for the range. The app used to add range on top; everything here
 * exists so that it reads one table instead.
 *
 * Compensation (the second table on p.175) moves a condition up the table
 * before the worst row is picked: low-light eyes treat partial and dim light
 * as full light, thermographic shifts visibility and light one row up, a
 * smartlink shifts wind one row up, and image magnification brings range one
 * category closer. The book's own example on p.176 walks all four.
 */

/**
 * Environmental tier values (§10.2): index 0 = clear, then the standard
 * −1/−3/−6/−10 ladder. A single condition at its worst row (3) is tier 3
 * (−6); tier 4 (−10) is only reached when two conditions tie at −6.
 */
export const ENVIRONMENT_TIER_VALUES = [0, -1, -3, -6, -10] as const;

/** One condition of the environment table: a key of `EnvRows`. */
export type EnvCondition = keyof EnvRows;

/** Every condition, in the order a receipt names them (the table's column order). */
export const ENV_CONDITIONS: readonly EnvCondition[] = ['visibility', 'light', 'glare', 'wind', 'range'];

/**
 * The table column each condition is read in. Glare has no column of its own:
 * the book heads the column Light/Glare, so a dark room with a torch in your
 * eyes is one condition at the worse of the two, never two conditions tying.
 */
export const ENV_COLUMN_OF: Readonly<Record<EnvCondition, EnvColumn>> = {
  visibility: 'visibility',
  light: 'light',
  glare: 'light',
  wind: 'wind',
  range: 'range',
};

const ALL_COLUMNS: readonly EnvColumn[] = ['visibility', 'light', 'wind', 'range'];

/** Row names, in our own words, for the receipt. */
const ROW_NAMES: Readonly<Record<EnvCondition, readonly [string, string, string, string]>> = {
  visibility: ['clear air', 'light rain/fog/smoke', 'moderate rain/fog/smoke', 'heavy rain/fog/smoke'],
  light: ['full light', 'partial light', 'dim light', 'total darkness'],
  glare: ['no glare', 'weak glare', 'moderate glare', 'blinding glare'],
  wind: ['calm', 'light wind', 'moderate wind', 'strong wind'],
  range: ['short range', 'medium range', 'long range', 'extreme range'],
};

/** A row index held to the table: a whole number from 0 to 3. */
function clampRow(row: number | undefined): number {
  if (row === undefined || !Number.isFinite(row)) return 0;
  return Math.max(0, Math.min(3, Math.round(row)));
}

/** The dice a row costs on its own: 0, −1, −3, −6. */
export function envRowValue(row: number): number {
  return ENVIRONMENT_TIER_VALUES[clampRow(row)] ?? 0;
}

// ---------------------------------------------------------------------------
// Compensation (p.175, the Environmental Compensation table)
// ---------------------------------------------------------------------------

/**
 * What a character brings against the conditions. Each flag is one line of
 * the p.175 compensation table:
 *
 * - `lowLight`: partial and dim light count as full light (darkness stays).
 * - `thermographic`: visibility and light each shift one row up. The book
 *   excepts thermal smoke (p.174), which the scene does not model — the GM's
 *   call when it matters.
 * - `smartlink`: wind shifts one row up. It helps a shot, so it belongs on an
 *   attack and nowhere else (see `eyesOnly`).
 * - `imageMagnification`: range comes one category closer — but only after a
 *   Take Aim (p.166, 178), so it is never read off the sheet; whoever knows the
 *   shooter aimed passes it in.
 *
 * Flare compensation, sunglasses, tracer rounds and ultrasound are in the
 * same table and not modelled yet.
 */
export interface EnvironmentCompensation {
  lowLight?: boolean;
  thermographic?: boolean;
  smartlink?: boolean;
  imageMagnification?: boolean;
}

export type CompensationKind = keyof EnvironmentCompensation;

const COMPENSATION_LABELS: Readonly<Record<CompensationKind, string>> = {
  lowLight: 'low-light',
  thermographic: 'thermographic',
  smartlink: 'smartlink',
  imageMagnification: 'image magnification',
};

/**
 * Low-light eyes on a light row: partial and dim light read as full light,
 * total darkness stays total darkness (p.175). The vision module's light maps
 * use this same rule (`compensatedLight`).
 */
export function lowLightRow(row: number): number {
  return row === 1 || row === 2 ? 0 : row;
}

/** One row up the table — thermographic on sight, a smartlink on wind, magnification on range. */
export function oneRowUp(row: number): number {
  return Math.max(0, row - 1);
}

/**
 * The compensation that helps any test, not just a shot: the eyes. A
 * smartlink reads the wind for a gun, and image magnification is a Take Aim
 * thing, so neither reaches a Perception or a Defense Test.
 */
export function eyesOnly(comp: EnvironmentCompensation | undefined): EnvironmentCompensation {
  return {
    ...(comp?.lowLight ? { lowLight: true } : {}),
    ...(comp?.thermographic ? { thermographic: true } : {}),
  };
}

/** One condition's row after compensation, and which system moved it (the best one wins). */
function compensate(
  condition: EnvCondition,
  row: number,
  comp: EnvironmentCompensation,
): { row: number; by: CompensationKind | null } {
  const offers: readonly [CompensationKind, number][] =
    condition === 'visibility'
      ? [['thermographic', oneRowUp(row)]]
      : condition === 'light'
        ? [
            ['lowLight', lowLightRow(row)],
            ['thermographic', oneRowUp(row)],
          ]
        : condition === 'wind'
          ? [['smartlink', oneRowUp(row)]]
          : condition === 'range'
            ? [['imageMagnification', oneRowUp(row)]]
            : []; // glare: flare compensation and sunglasses are its lines; not modelled
  let best: { row: number; by: CompensationKind | null } = { row, by: null };
  for (const [kind, r] of offers) {
    if (comp[kind] && r < best.row) best = { row: r, by: kind };
  }
  return best;
}

// ---------------------------------------------------------------------------
// The lookup
// ---------------------------------------------------------------------------

export interface EnvironmentLookupOptions {
  compensation?: EnvironmentCompensation;
  /**
   * Only these columns count. A ranged attack reads all four; melee (p.187),
   * Perception by sight (p.135) and spells aimed by sight (p.281) read only
   * visibility and light — the catalogue's `environment_sight` line.
   */
  columns?: readonly EnvColumn[];
}

export interface EnvironmentLookup {
  /** The rows each condition sits on after compensation (only the conditions read). */
  rows: EnvRows;
  /** Which system moved which condition, for the receipt. */
  compensatedBy: Partial<Record<EnvCondition, CompensationKind>>;
  /** The worst row in each column counted, glare folded into light. */
  columns: Partial<Record<EnvColumn, number>>;
  /** The worst row of all: 0 (clear) to 3 (the −6 row). */
  worst: number;
  /** How many columns sit on that worst row. Two or more go one row worse. */
  tied: number;
  /** The row the modifier is read from: 0–4, where 4 is the −10 row. */
  tier: number;
  /** The dice-pool modifier. */
  value: number;
  /** One line for the receipt, naming every condition that counted. */
  note: string;
}

/**
 * Read the environment table once (SR5 p.173-175): compensate each condition,
 * take the worst row across the columns, and go one row worse when two or
 * more columns tie on it (two conditions tied at −6 make −10). Rows are
 * row indices (see `EnvRows`); a missing condition is the clear row.
 *
 * The book's examples, as this reads them (p.176):
 * - dim light (−3) and medium range (−1): −3.
 * - light fog −1, dim light −3, moderate wind −3, medium range −1: two tie at
 *   −3, so −6.
 * - the same with thermographic, a smartlink and image magnification: fog
 *   clears, dim becomes partial (−1), wind becomes light (−1), range becomes
 *   short — two tie at −1, so −3.
 */
export function environmentLookup(raw: EnvRows, opts: EnvironmentLookupOptions = {}): EnvironmentLookup {
  const comp = opts.compensation ?? {};
  const counted = new Set<EnvColumn>(opts.columns ?? ALL_COLUMNS);
  const rows: EnvRows = {};
  const compensatedBy: Partial<Record<EnvCondition, CompensationKind>> = {};
  const columns: Partial<Record<EnvColumn, number>> = {};

  for (const condition of ENV_CONDITIONS) {
    if (raw[condition] === undefined) continue;
    const column = ENV_COLUMN_OF[condition];
    if (!counted.has(column)) continue;
    const { row, by } = compensate(condition, clampRow(raw[condition]), comp);
    rows[condition] = row;
    if (by) compensatedBy[condition] = by;
    columns[column] = Math.max(columns[column] ?? 0, row);
  }

  const worst = Math.max(0, ...Object.values(columns));
  const tied = worst > 0 ? Object.values(columns).filter((r) => r === worst).length : 0;
  const tier = Math.min(ENVIRONMENT_TIER_VALUES.length - 1, tied >= 2 ? worst + 1 : worst);
  const value = ENVIRONMENT_TIER_VALUES[tier] ?? 0;
  const note = environmentNote(raw, { rows, compensatedBy, worst, tied, value });
  return { rows, compensatedBy, columns, worst, tied, tier, value, note };
}

/**
 * The receipt line: each condition that counted with its row and cost, a
 * compensated one as "before → after (by what)", then how they combined when
 * there was more than one. Range is named even at short range, because the
 * band is a fact about the shot; the other conditions only when not clear.
 */
function environmentNote(
  raw: EnvRows,
  look: Pick<EnvironmentLookup, 'rows' | 'compensatedBy' | 'worst' | 'tied' | 'value'>,
): string {
  const parts: string[] = [];
  for (const condition of ENV_CONDITIONS) {
    const after = look.rows[condition];
    if (after === undefined) continue;
    const before = clampRow(raw[condition]);
    if (before === 0 && condition !== 'range') continue;
    const names = ROW_NAMES[condition];
    const by = look.compensatedBy[condition];
    parts.push(
      by
        ? `${names[before]} ${envRowValue(before)} → ${names[after]} ${envRowValue(after)} (${COMPENSATION_LABELS[by]})`
        : `${names[after]} ${envRowValue(after)}`,
    );
  }
  const body = parts.length > 0 ? parts.join(', ') : 'clear';
  if (look.tied >= 2) return `environment: ${body} → ${look.tied} tied at ${envRowValue(look.worst)}: ${look.value}`;
  if (parts.length > 1) return `environment: ${body} → worst row ${look.value}`;
  return `environment: ${body}`;
}

/** Rows per condition, the worse of each: what several sources say about one shot. */
export function mergeEnvRows(...all: readonly (EnvRows | undefined)[]): EnvRows {
  const out: EnvRows = {};
  for (const rows of all) {
    if (!rows) continue;
    for (const condition of ENV_CONDITIONS) {
      const row = rows[condition];
      if (row === undefined) continue;
      out[condition] = Math.max(out[condition] ?? 0, clampRow(row));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The scene and the range band, as modifiers
// ---------------------------------------------------------------------------

/**
 * A scene's weather and light as table rows. The scene stores a level 0–3 per
 * axis, and a level IS the row (1 = the −1 row, 3 = the −6 row). Clear axes
 * are left out.
 */
export function sceneEnvRows(scene: SceneEnvironment): EnvRows {
  const rows: EnvRows = {};
  for (const condition of ['visibility', 'light', 'glare', 'wind'] as const) {
    const level = clampRow(scene[condition] ?? 0);
    if (level > 0) rows[condition] = level;
  }
  return rows;
}

/**
 * The active scene as ONE `scene` modifier on every pool (FR9.11): the table
 * read once over its visibility, light/glare and wind (p.173-175). Clear
 * conditions emit nothing.
 *
 * The rows ride along on the modifier (`env`) because the value here is only
 * what the scene costs someone with ordinary eyes and no range to worry
 * about. `deriveCharacter` reads the rows again with the character's own eyes
 * and folds in a shot's range band, so the receipt shows one environment line
 * with the worst row of everything — never the scene and the range as two.
 */
export function environment(scene: SceneEnvironment): Modifier[] {
  const rows = sceneEnvRows(scene);
  const look = environmentLookup(rows);
  if (look.value === 0) return [];
  return [
    {
      id: 'env.scene',
      source: { kind: 'scene' },
      target: 'pool.all',
      op: 'add',
      value: look.value,
      active: true,
      note: look.note,
      // The Environmental Modifiers table (SR5 p.175), so the scene's line on
      // every receipt opens the page the table is printed on.
      bookRef: lineRef('environment'),
      env: rows,
    },
  ];
}

/** Range band modifiers by band index: short/medium/long/extreme (FR9.9) — the range column's rows. */
export const RANGE_BAND_VALUES = [0, -1, -3, -6] as const;

const RANGE_BAND_NAMES = ['short', 'medium', 'long', 'extreme'] as const;

/**
 * Range band modifier for a shot at `distM` meters using the sheet's
 * user-entered range table for `rangeCat` (FR9.9, §10.2). Band edges are
 * inclusive upper bounds in meters ([short, medium, long, extreme]).
 * Returns a 0-value `range` Modifier at short range (so provenance still
 * names the band), and null when the category is unknown, the distance is
 * negative, or beyond extreme range.
 *
 * The band is a row of the environment table (`env.range`), so wherever it
 * meets the scene's line the two are read as one lookup — see `environment`.
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
    // Range is a column of the environment table (SR5 p.175); the page's
    // Range section points on to the Range Table for the band edges.
    bookRef: lineRef('range'),
    env: { range: idx },
  };
}

/**
 * The range row a band's modifier value names (−1 → medium), or null for a
 * value no band has. For range modifiers written before modifiers carried
 * rows — an older client's chip, a ruler hand-off that only kept the number.
 */
export function rangeRowOfValue(value: number): number | null {
  const idx = (RANGE_BAND_VALUES as readonly number[]).indexOf(value);
  return idx === -1 ? null : idx;
}

/**
 * The environment rows a modifier stands for: its own `env`, or — for an
 * additive `range` modifier from before rows existed — the band its value
 * names. Undefined for everything else, which is summed as it always was.
 */
export function envRowsOf(mod: Modifier): EnvRows | undefined {
  if (mod.op !== 'add') return undefined;
  if (mod.env) return mod.env;
  if (mod.source.kind === 'range') {
    const row = rangeRowOfValue(mod.value);
    if (row !== null) return { range: row };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Folding: the scene and the range band as one line
// ---------------------------------------------------------------------------

/**
 * Every environment-bearing modifier in `mods` (the scene, a range band) read
 * as ONE line: the rows merged (the worse of each condition), compensated,
 * and looked up once. Null when none of them carries rows.
 *
 * A lone modifier that nothing changed keeps its own label and page — a range
 * band on a clear night still reads "medium range (9.5 m, heavy_pistol)" — so
 * only a real fold, or a real compensation, rewrites the receipt. The value
 * always comes from the rows, never from the modifier's own number: rows are
 * the authority, so a client cannot hand in a range chip worth +5.
 *
 * The line carries `env`: the rows after compensation, so a client pricing a
 * range band against this pool can fold it the same way (`rangeInEnvironment`).
 */
export function foldEnvironment(
  mods: readonly Modifier[],
  opts: EnvironmentLookupOptions = {},
): ProvenanceEntry | null {
  const carrying = mods.flatMap((m) => {
    if (!m.active) return [];
    const rows = envRowsOf(m);
    return rows ? [{ m, rows }] : [];
  });
  if (carrying.length === 0) return null;

  const raw = mergeEnvRows(...carrying.map((c) => c.rows));
  const look = environmentLookup(raw, opts);
  const compensated = Object.keys(look.compensatedBy).length > 0;
  const lone = carrying.length === 1 ? carrying[0]!.m : null;

  if (lone && !compensated && lone.value === look.value) {
    return {
      label: lone.note ?? lone.source.ref ?? lone.id,
      value: look.value,
      source: lone.source.kind,
      ...(lone.bookRef ? { ref: lone.bookRef } : {}),
      env: look.rows,
    };
  }
  const scene = carrying.some((c) => c.m.source.kind === 'scene');
  return {
    label: look.note,
    value: look.value,
    source: scene ? 'scene' : carrying[0]!.m.source.kind,
    ref: lineRef('environment'),
    env: look.rows,
  };
}

/** What a range band costs a pool whose receipt may already carry an environment line. */
export interface RangeInEnvironment {
  /** What the band changes the pool by: the fold, less what the environment line already took. */
  value: number;
  /** The environment line's value once the band is folded in (the band's own value when there is none). */
  combined: number;
  /** True when the band met an environment line and was read inside it. */
  folded: boolean;
  /** The band's rows, to send with the chip so the server folds it the same way. */
  env: EnvRows;
}

/**
 * Price a range band against a pool the server already derived with the
 * scene in it (p.173: range is an environmental condition, so it joins the
 * scene's line instead of stacking on it). The pool's environment line knows
 * its rows (`ProvenanceEntry.env`, after the character's eyes), so the band is
 * merged into them and the table read again: medium range in dim light
 * changes nothing (still −3), medium range in partial light makes two tied at
 * −1 (−3, so −2 more). With no environment line the band costs its own row.
 */
export function rangeInEnvironment(
  breakdown: readonly ProvenanceEntry[],
  rangeRows: EnvRows,
): RangeInEnvironment {
  const line = breakdown.find((e) => e.env !== undefined);
  const env: EnvRows = rangeRows.range === undefined ? {} : { range: clampRow(rangeRows.range) };
  if (!line?.env) {
    const own = environmentLookup(env).value;
    return { value: own, combined: own, folded: false, env };
  }
  const combined = environmentLookup(mergeEnvRows(line.env, env)).value;
  return { value: combined - line.value, combined, folded: true, env };
}
