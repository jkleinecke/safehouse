/**
 * The Finish step's sheet preview, read into rows (FR3.9, docs/CHARGEN.md
 * §4.4 Step 9 "the full derived sheet as the player will see it in play
 * (limits, initiative, monitors, pools per skill and weapon)").
 *
 * The preview is not a second sheet. Every number on it is one the engine
 * already produced: `compileBuild` wrote the `SheetV1` that approval will
 * store, and `deriveCharacter` gave that sheet the limits, initiative,
 * monitors and dice pools play reads — the same pair the rail shows, run in
 * the browser on every change (`analysis.ts`). What this file does is pick
 * those numbers out in the order a player reads a sheet and name them: the
 * book's "4 (6)" for an augmented attribute, "10 + 1D6" for initiative, a
 * skill's table name rather than its id.
 *
 * Which initiative lines to show is asked of the engine too — astral only for
 * a practitioner whose kind projects (`MAGIC_KIND_TABLE`), the Matrix's VR
 * lines only for someone with a living persona or a deck — so a street
 * samurai's one-pager is not padded with numbers they will never roll.
 *
 * Pure: no JSX, no network, no book text (DESIGN.md §14). Tested in
 * `preview.test.ts` against a compiled invented runner.
 */
import type {
  DerivedCharacter,
  MagicKind,
  PoolBreakdown,
  ProvenanceEntry,
  Ref,
  SheetV1,
} from '@safehouse/contracts';
import {
  BUILD_ATTRIBUTE_NAMES,
  MAGIC_KIND_TABLE,
  activeSkillRow,
  metatypeRow,
  skillPoolKey,
  type CompiledBuild,
} from '@safehouse/rules';
import { formatNuyen } from '../../lib.js';

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const ATTRIBUTE_ORDER = ['bod', 'agi', 'rea', 'str', 'wil', 'log', 'int', 'cha'] as const;

/** The attribute codes' names: the engine's one map (`BUILD_ATTRIBUTE_NAMES`), plus Essence, which the sheet shows among them. */
export const ATTRIBUTE_NAMES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(BUILD_ATTRIBUTE_NAMES).map(([code, names]) => [code, names.name])),
  ess: 'Essence',
};

/** How each kind of practitioner is named on the sheet's header. */
export const MAGIC_KIND_WORDS: Readonly<Record<MagicKind, string>> = {
  mundane: 'mundane',
  magician: 'magician',
  aspected: 'aspected magician',
  adept: 'adept',
  mysticAdept: 'mystic adept',
  technomancer: 'technomancer',
};

/** Up to two decimals, no trailing zeros: Essence 5.8, power points 0.25. */
export function shortNumber(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * The book's way of writing a rating with augmentation: the natural rating,
 * then the augmented one in brackets when they differ — "4 (6)".
 */
export function ratingText(natural: number, value: number): string {
  return natural === value ? shortNumber(value) : `${shortNumber(natural)} (${shortNumber(value)})`;
}

/**
 * The name a rating's breakdown is announced and titled by. The button's
 * spoken label carries only the number it opens on, so an augmented rating
 * names its natural one here — "Agility (natural 4)" — rather than losing
 * the half of "4 (5)" a screen reader would otherwise never hear.
 */
function spokenRating(name: string, natural: number, value: number): string {
  return natural === value ? name : `${name} (natural ${shortNumber(natural)})`;
}

/** A skill id as a label when the table does not know it: "exotic-ranged" → "Exotic ranged". */
function humanise(id: string): string {
  const words = id.replace(/[-_.]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface PreviewIdentity {
  alias: string;
  metatype: string;
  /** "magician · hermetic · mentor: Bear", or null for a mundane. */
  awakening: string | null;
  /** Real name, age and sex, where the build has them. */
  details: string[];
}

export function previewIdentity(sheet: SheetV1): PreviewIdentity {
  const a = sheet.awakening;
  const awakening =
    a.kind === 'mundane'
      ? null
      : [
          MAGIC_KIND_WORDS[a.kind],
          ...(a.aspect ? [a.aspect] : []),
          ...(a.tradition ? [a.tradition] : []),
          ...(a.grade > 0 ? [`grade ${a.grade}`] : []),
          ...(a.mentor ? [`mentor: ${a.mentor}`] : []),
        ].join(' · ');
  const id = sheet.identity;
  return {
    alias: id.alias,
    metatype: metatypeRow(id.metatype)?.name ?? id.metatype,
    awakening,
    details: [
      ...(id.realName ? [`real name ${id.realName}`] : []),
      ...(id.age !== undefined ? [`age ${id.age}`] : []),
      ...(id.sex ? [id.sex] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Attributes, limits, initiative, monitors
// ---------------------------------------------------------------------------

/** One number with its receipt, as a cell on the preview. */
export interface ValueCell {
  key: string;
  /** Short label on the cell ("agi", "P limit"). */
  label: string;
  /** What a screen reader and the breakdown sheet call it. */
  name: string;
  /** The number the breakdown opens on. */
  value: number;
  /** What the cell shows: "4 (6)", "10 + 1D6", "5.8". */
  text: string;
  breakdown: ProvenanceEntry[];
}

function derivedValue(derived: DerivedCharacter, code: string, fallback: number): { value: number; breakdown: ProvenanceEntry[] } {
  const v = derived.attributes[code];
  return v ? { value: v.value, breakdown: v.breakdown } : { value: fallback, breakdown: [] };
}

/** The eight physical and mental attributes: natural on the sheet, augmented as derived. */
export function attributeCells(sheet: SheetV1, derived: DerivedCharacter): ValueCell[] {
  return ATTRIBUTE_ORDER.map((code) => {
    const natural = sheet.attributes[code];
    const { value, breakdown } = derivedValue(derived, code, natural);
    return {
      key: code,
      label: code,
      name: spokenRating(ATTRIBUTE_NAMES[code] ?? code, natural, value),
      value,
      text: ratingText(natural, value),
      breakdown,
    };
  });
}

/** Edge, Essence, and Magic or Resonance where the runner has one. */
export function specialCells(sheet: SheetV1, derived: DerivedCharacter): ValueCell[] {
  const cells: ValueCell[] = [];
  const edgeMax = sheet.attributes.edg.max;
  const edge = derivedValue(derived, 'edg', edgeMax);
  cells.push({
    key: 'edg',
    label: 'edg',
    name: spokenRating('Edge', edgeMax, edge.value),
    value: edge.value,
    text: ratingText(edgeMax, edge.value),
    breakdown: edge.breakdown,
  });
  const ess = derivedValue(derived, 'ess', sheet.attributes.ess);
  cells.push({ key: 'ess', label: 'ess', name: 'Essence', value: ess.value, text: shortNumber(ess.value), breakdown: ess.breakdown });
  for (const code of ['mag', 'res'] as const) {
    const natural = sheet.attributes[code];
    const { value, breakdown } = derivedValue(derived, code, natural);
    if (natural === 0 && value === 0) continue;
    cells.push({
      key: code,
      label: code,
      name: spokenRating(ATTRIBUTE_NAMES[code] ?? code, natural, value),
      value,
      text: ratingText(natural, value),
      breakdown,
    });
  }
  return cells;
}

export function limitCells(derived: DerivedCharacter): ValueCell[] {
  const line = (key: 'physical' | 'mental' | 'social', label: string, name: string): ValueCell => ({
    key: `limit.${key}`,
    label,
    name,
    value: derived.limits[key].value,
    text: shortNumber(derived.limits[key].value),
    breakdown: derived.limits[key].breakdown,
  });
  return [line('physical', 'P limit', 'Physical limit'), line('mental', 'M limit', 'Mental limit'), line('social', 'S limit', 'Social limit')];
}

type InitKey = keyof DerivedCharacter['initiative'];

const INIT_WORDS: Readonly<Record<InitKey, { label: string; name: string }>> = {
  physical: { label: 'Init', name: 'Initiative' },
  astral: { label: 'Astral', name: 'Astral initiative' },
  matrixAR: { label: 'AR', name: 'Matrix AR initiative' },
  vrCold: { label: 'VR cold', name: 'Cold-sim VR initiative' },
  vrHot: { label: 'VR hot', name: 'Hot-sim VR initiative' },
};

/**
 * The initiative lines this runner uses: physical always; astral for a kind
 * the engine says can project; cold- and hot-sim VR for a living persona or a
 * deck on the sheet.
 */
export function initiativeCells(sheet: SheetV1, derived: DerivedCharacter): ValueCell[] {
  const keys: InitKey[] = ['physical'];
  if (MAGIC_KIND_TABLE[sheet.awakening.kind].astralProjection) keys.push('astral');
  if (derived.livingPersona !== null || sheet.matrix.deck) keys.push('vrCold', 'vrHot');
  return keys.map((key) => {
    const init = derived.initiative[key];
    return {
      key: `initiative.${key}`,
      label: INIT_WORDS[key].label,
      // The button speaks the score it opens on; the dice ride in the name.
      name: `${INIT_WORDS[key].name} (plus ${shortNumber(init.dice.value)}D6)`,
      value: init.base.value,
      text: `${shortNumber(init.base.value)} + ${shortNumber(init.dice.value)}D6`,
      breakdown: [...init.base.breakdown, ...init.dice.breakdown],
    };
  });
}

export interface MonitorCell extends ValueCell {
  tone: 'physical' | 'stun' | 'overflow';
  /** Boxes, grouped in threes as the wound modifiers step. */
  boxes: number;
}

export function monitorCells(derived: DerivedCharacter): MonitorCell[] {
  const cell = (tone: MonitorCell['tone'], label: string, name: string): MonitorCell => {
    const size = derived.monitors[tone];
    const boxes = Math.max(0, size.value);
    return { key: `monitor.${tone}`, label, name, value: boxes, text: shortNumber(boxes), breakdown: size.breakdown, tone, boxes };
  };
  return [cell('physical', 'Physical', 'Physical monitor'), cell('stun', 'Stun', 'Stun monitor'), cell('overflow', 'Overflow', 'Overflow')];
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export interface SkillLine {
  key: string;
  name: string;
  attr: string;
  rating: number;
  spec: string | null;
  group: string | null;
  pool: PoolBreakdown | null;
}

/** Active skills by name, each with the dice pool derive built for it. */
export function skillLines(sheet: SheetV1, derived: DerivedCharacter | null): SkillLine[] {
  return sheet.skills
    .map((s, i) => {
      const base = activeSkillRow(s.id)?.name ?? humanise(s.id);
      return {
        key: `${s.id}|${s.target ?? ''}|${i}`,
        name: s.target ? `${base} (${s.target})` : base,
        attr: s.attr,
        rating: s.rating,
        spec: s.spec ?? null,
        group: s.group ?? null,
        pool: derived?.pools[skillPoolKey(s.id, s.target)] ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Knowledge skills, then languages (native first). Shared with the sheet in
 * play (`features/sheet/rows.ts`), so the last screen before submit and the
 * Skills tab after approval read a built runner's knowledge the same way — it
 * was rendered here and nowhere else until the tab caught up.
 */
export { knowledgeLines, type KnowledgeLine } from '../../../sheet/rows.js';

// ---------------------------------------------------------------------------
// Gear
// ---------------------------------------------------------------------------

export interface WeaponLine {
  key: string;
  name: string;
  dv: string;
  ap: string;
  acc: string;
  modes: string;
  pool: PoolBreakdown | null;
  ref: Ref | null;
}

export function weaponLines(sheet: SheetV1, derived: DerivedCharacter | null): WeaponLine[] {
  return sheet.weapons.map((w, i) => ({
    key: `${w.name}|${i}`,
    name: w.name,
    dv: w.dv ?? '—',
    ap: w.ap === 0 ? '—' : String(w.ap),
    acc: w.acc === undefined ? '—' : String(w.acc),
    modes: w.modes.length > 0 ? w.modes.join('/') : '—',
    pool: derived?.pools[`weapon.${w.name}`] ?? null,
    ref: w.ref ?? null,
  }));
}

export interface ItemLine {
  key: string;
  name: string;
  /** The line's figures in a few words: "rating 9 · worn", "0.2 Essence · alphaware". */
  detail: string;
  ref: Ref | null;
}

export function armorLines(sheet: SheetV1): ItemLine[] {
  return sheet.armor.map((a, i) => ({
    key: `${a.name}|${i}`,
    name: a.name,
    detail: [`rating ${a.rating}`, a.worn ? 'worn' : 'carried'].join(' · '),
    ref: a.ref ?? null,
  }));
}

export function augmentLines(sheet: SheetV1): ItemLine[] {
  return sheet.augments.map((a, i) => ({
    key: `${a.name}|${i}`,
    name: a.name,
    detail: [
      `${shortNumber(a.essence)} Essence`,
      ...(a.grade && a.grade !== 'standard' ? [a.grade] : []),
      ...(a.rating !== undefined && a.rating > 0 ? [`rating ${a.rating}`] : []),
    ].join(' · '),
    ref: a.ref ?? null,
  }));
}

export function qualityLines(sheet: SheetV1): ItemLine[] {
  return sheet.qualities.map((q, i) => ({
    key: `${q.name}|${i}`,
    name: q.rating !== undefined ? `${q.name} ${q.rating}` : q.name,
    detail: [
      ...(q.type ? [q.type] : []),
      ...(q.karma !== undefined ? [`${q.karma} Karma`] : []),
      ...(q.note ? [q.note] : []),
    ].join(' · '),
    ref: q.ref ?? null,
  }));
}

export function gearLines(sheet: SheetV1): ItemLine[] {
  return sheet.gear.map((g, i) => ({
    key: `${g.name}|${i}`,
    name: g.qty > 1 ? `${g.name} ×${g.qty}` : g.name,
    detail: g.rating !== undefined ? `rating ${g.rating}` : '',
    ref: g.ref ?? null,
  }));
}

export interface MagicLine extends ItemLine {
  pool: PoolBreakdown | null;
}

/** Spells with their casting pools, adept powers with their cost, complex forms with their fading. */
export function magicLines(sheet: SheetV1, derived: DerivedCharacter | null): { title: string; lines: MagicLine[] }[] {
  const groups: { title: string; lines: MagicLine[] }[] = [
    {
      title: 'Spells',
      lines: sheet.spells.map((s, i) => ({
        key: `s|${s.name}|${i}`,
        name: s.name,
        detail: [...(s.category ? [s.category] : []), ...(s.drain ? [`drain ${s.drain}`] : [])].join(' · '),
        ref: s.ref ?? null,
        pool: derived?.pools[`spell.${s.name}`] ?? null,
      })),
    },
    {
      title: 'Powers',
      lines: sheet.powers.map((p, i) => ({
        key: `p|${p.name}|${i}`,
        name: p.rating !== undefined ? `${p.name} ${p.rating}` : p.name,
        detail: p.cost !== undefined ? `${shortNumber(p.cost)} PP` : '',
        ref: p.ref ?? null,
        pool: null,
      })),
    },
    {
      title: 'Complex forms',
      lines: sheet.complexForms.map((f, i) => ({
        key: `f|${f.name}|${i}`,
        name: f.name,
        detail: f.fading ? `fading ${f.fading}` : '',
        ref: f.ref ?? null,
        pool: null,
      })),
    },
  ];
  return groups.filter((g) => g.lines.length > 0);
}

/** Lifestyles with the months paid, from the compile's own list. */
export function lifestyleLines(compiled: Pick<CompiledBuild, 'lifestyles'>): ItemLine[] {
  return compiled.lifestyles.map((l, i) => ({
    key: `${l.name}|${i}`,
    name: l.name,
    detail: `${formatNuyen(l.costPerMonth)} a month · ${l.months} ${l.months === 1 ? 'month' : 'months'} paid`,
    ref: null,
  }));
}

export interface ContactLine {
  key: string;
  name: string;
  role: string;
  connection: number;
  loyalty: number;
}

export function contactLines(compiled: Pick<CompiledBuild, 'contacts'>): ContactLine[] {
  return compiled.contacts.map((c, i) => ({
    key: `${c.name}|${i}`,
    name: c.name || 'unnamed contact',
    role: c.archetype,
    connection: c.connection,
    loyalty: c.loyalty,
  }));
}

/**
 * What goes into play with the runner, in a sentence: the Karma and nuyen
 * that carry, and the starting-nuyen roll the server makes on approval.
 */
export function openingLine(compiled: Pick<CompiledBuild, 'opening'>): string {
  const o = compiled.opening;
  const carry = `Carries ${o.karma} Karma and ${formatNuyen(o.nuyenCarry)} into play`;
  const roll =
    o.startingNuyen.dice > 0
      ? `; starting nuyen is ${o.startingNuyen.dice}D6 × ${formatNuyen(o.startingNuyen.multiplier)}, rolled on the record when the GM approves.`
      : '.';
  return `${carry}${roll}`;
}
