/**
 * The creation checklist as code (FR3.9, docs/CHARGEN.md §4.2 `validate`,
 * §8.4, and the p. 101 checklist) — every rule a build must meet, each
 * finding an `Issue` with a stable code, a severity, the walkthrough step it
 * belongs to (§8.7 numbering: 1 Concept … 9 Finish), our own short words and
 * the page the rule is printed on.
 *
 * Severities (§4.2): `error` stops Submit (a priority used twice, points
 * unspent, two attributes at maximum, alphaware on a 6,000¥ budget…);
 * `warning` is allowed but worth a look (nuyen past the carry-over, no
 * commlink, no lifestyle); `approval` is the book handing the decision to
 * the gamemaster (Exceptional Attribute, Lucky, Restricted and Forbidden
 * gear). The GM's per-item calls sit on `build.approvals`, keyed by issue
 * code: `approved` removes the issue, `denied` turns it into an error.
 *
 * `ISSUE_RULES` is the registry: one entry per code with its step, severity
 * and page, so the UI can list the whole checklist and a code can never
 * quietly change page. Codes that name an item carry a suffix so each can be
 * decided on its own, and the suffix names the *decision*, not just the
 * label: `approval-gear-<name>-<fingerprint>` hashes the whole line but its
 * price — the sheet item's stats and modifiers, kind, table heading, Essence,
 * rating, quantity, Availability and grade (a second identical line adds
 * `-2`), and `approval-quality-<quality>-<target>` carries what the quality
 * lifts. Two items that share a name never share a decision, and an edit that
 * changes what was approved — a Restricted line re-entered as Forbidden, an
 * approved stun baton retyped into an assault rifle, Exceptional Attribute
 * moved to another attribute — asks the GM again.
 *
 * Two readings worth knowing, both from §8.4: the street and prime quality
 * caps follow `settings.levelQualityCaps`; Arcana is not a restricted skill.
 * A few rules the book states in passing are enforced here because the
 * worked examples trip over them — Assensing needs astral perception
 * (p. 142), a skill bought through a group cannot also take individual
 * points at creation (p. 88), a specialisation bought in Step 5 cannot sit
 * on a grouped skill (p. 89). The skill and group fences themselves live in
 * `eligibility.ts`, shared with Step 6's greying and the concept cards.
 *
 * Where an issue is filed follows the walkthrough, not just the rule: an
 * issue belongs to the step that can fix it. Special points on Magic wait
 * for Step 4's type; an attribute one over its maximum that Exceptional
 * Attribute (or Lucky, for Edge) would allow waits for Step 5's qualities —
 * the book's own samurai plans Strength 11 two steps before he takes the
 * quality — and so do two attributes at their maximum when the same quality
 * on one of them would leave only the other there. Filed earlier, any of
 * these would lock Next on a step the player cannot fix from.
 *
 * Pure — no I/O. No book text: messages are ours, numbers and refs only
 * (DESIGN.md §14).
 */
import {
  ATTRIBUTE_CODES,
  PRIORITY_COLUMNS,
  PRIORITY_LEVELS,
  type AttributeCode,
  type BuildStep,
  type CharacterBuild,
  type ChargenSettings,
  type CreationLevel,
  type Issue,
  type IssueSeverity,
  type MagicKind,
  type Modifier,
  type PriorityColumn,
  type Ref,
} from '@safehouse/contracts';
import { activeSkillRow, skillGroupRow } from './skills.js';
import {
  castsSpells,
  focusPurchaseMatches,
  formulaGroup,
  isBioware,
  isDevice,
  knowsFormulaGroup,
  purchaseAvailability,
  purchaseDeviceRating,
  summonsSpirits,
  tallyBuild,
  usesMagic,
  usesResonance,
  type BuildTally,
} from './budget.js';
import { AUGMENTATION_BONUS_CAP } from '../derive-pipeline.js';
import { BUILD_ATTRIBUTE_NAMES, CREATION_ATTRIBUTE_RULES } from './metatypes.js';
import { eligibilityContext, eligibilityMessage, groupEligibilityIn, skillEligibilityIn } from './eligibility.js';
import { IMPLANT_GRADES } from './grades.js';
import { FOCUS_LIMITS, focusBondingKarma, focusSpendType, focusTypesOf } from './foci.js';
import { MAGIC_KIND_TABLE, grantPoolIncludes, magicRowOffers } from './priority.js';
import { CREATION_CONTACT_RULES } from './levels.js';
import { QUALITY_RULE_BY_ID, bornQualities, isQualityBuyOff, qualityRuleFor, type QualityRuleId } from './qualityRules.js';
import { qualityRatingOf, type GroupRating } from './ratings.js';
import { CREATION_SKILL_RULES } from './skills.js';
import { RF, SR5 } from './pages.js';

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export interface IssueRule {
  step: BuildStep;
  severity: IssueSeverity;
  ref: Ref;
}

const rule = (step: BuildStep, severity: IssueSeverity, ref: Ref): IssueRule => ({ step, severity, ref });
const E = 'error' as const;
const W = 'warning' as const;
const A = 'approval' as const;

/**
 * Every rule the validator enforces, by code. `step` is where the issue is
 * usually fixed; a rule broken by a later Karma spend reports step 8 instead,
 * special points on Magic or Resonance report step 4 while the Magic row
 * still offers the type that would use them, and an attribute one over its
 * maximum that Exceptional Attribute or Lucky would allow — or a second
 * attribute at its maximum that Exceptional Attribute would settle — reports
 * step 5.
 */
export const ISSUE_RULES = {
  // 1 Concept
  'alias-missing': rule(1, E, SR5(62)),
  'level-mismatch': rule(1, W, SR5(64)),
  'table-mismatch': rule(1, W, RF(63)),
  // 2 Priorities
  'method-not-allowed': rule(2, E, RF(62)),
  'priority-unset': rule(2, E, SR5(65)),
  'priority-duplicate': rule(2, E, SR5(65)),
  'sum-to-ten-over': rule(2, E, RF(62)),
  'sum-to-ten-under': rule(2, W, RF(62)),
  // 3 Metatype and attributes
  'metatype-missing': rule(3, E, SR5(65)),
  'metatype-unknown': rule(3, E, SR5(66)),
  'metatype-not-allowed': rule(3, E, RF(102)),
  'metatype-not-on-row': rule(3, E, SR5(65)),
  'special-points-over': rule(3, E, SR5(66)),
  'special-points-unspent': rule(3, W, SR5(66)),
  'special-points-no-magic': rule(3, E, SR5(66)),
  'special-points-no-resonance': rule(3, E, SR5(66)),
  'attribute-points-over': rule(3, E, SR5(66)),
  'attribute-points-unspent': rule(3, E, SR5(66)),
  'attribute-over-max': rule(3, E, SR5(66)),
  'attribute-max-more-than-one': rule(3, E, SR5(66)),
  // 4 Magic or Resonance
  'magic-kind-not-offered': rule(4, E, SR5(65)),
  'magic-priority-unused': rule(4, W, SR5(65)),
  'resonance-not-allowed': rule(4, E, RF(102)),
  'aspect-missing': rule(4, E, SR5(69)),
  'tradition-missing': rule(4, W, SR5(279)),
  'mentor-spirit-unnamed': rule(4, W, SR5(76)),
  'grant-skills-unfilled': rule(4, E, SR5(65)),
  'grant-skills-over': rule(4, E, SR5(65)),
  'grant-skill-invalid': rule(4, E, SR5(65)),
  'grant-groups-unfilled': rule(4, E, SR5(65)),
  'grant-groups-over': rule(4, E, SR5(65)),
  'grant-group-invalid': rule(4, E, SR5(69)),
  'grant-spells-unfilled': rule(4, E, SR5(65)),
  'grant-spells-over': rule(4, E, SR5(65)),
  'grant-forms-unfilled': rule(4, E, SR5(65)),
  'grant-forms-over': rule(4, E, SR5(65)),
  'formulae-not-caster': rule(4, E, SR5(69)),
  'formulae-over-cap': rule(4, E, SR5(98)),
  'forms-not-technomancer': rule(4, E, SR5(98)),
  'forms-over-cap': rule(4, E, SR5(98)),
  'powers-not-adept': rule(4, E, SR5(308)),
  'power-points-over': rule(4, E, SR5(308)),
  'power-levels-over-magic': rule(4, E, SR5(308)),
  'power-point-purchase-not-mystic': rule(4, E, SR5(69)),
  'power-point-purchase-over-magic': rule(4, E, SR5(69)),
  // 5 Qualities
  'lucky-and-exceptional': rule(5, E, SR5(66)),
  'positive-quality-cap': rule(5, E, SR5(71)),
  'negative-quality-cap': rule(5, E, SR5(71)),
  'quality-once': rule(5, E, SR5(71)),
  'quality-exclusive': rule(5, E, SR5(80)),
  'quality-requires-magic': rule(5, E, SR5(76)),
  'quality-requires-caster': rule(5, E, SR5(74)),
  'quality-forbidden-with-magic': rule(5, E, SR5(76)),
  'quality-metatype-gate': rule(5, E, SR5(75)),
  'quality-rating-range': rule(5, E, SR5(77)),
  'quality-karma-mismatch': rule(5, E, SR5(77)),
  'quality-type-mismatch': rule(5, E, SR5(71)),
  'quality-racial-held': rule(5, E, RF(102)),
  'exceptional-attribute-target': rule(5, E, SR5(72)),
  'aptitude-target': rule(5, E, SR5(72)),
  'incompetent-target': rule(5, E, SR5(81)),
  'approval-quality': rule(5, A, SR5(66)),
  // 6 Skills
  'skill-unknown': rule(6, E, SR5(90)),
  'group-unknown': rule(6, E, SR5(90)),
  'skill-duplicate': rule(6, E, SR5(88)),
  'skill-points-over': rule(6, E, SR5(88)),
  'skill-points-unspent': rule(6, E, SR5(88)),
  'group-points-over': rule(6, E, SR5(88)),
  'group-points-unspent': rule(6, E, SR5(88)),
  'knowledge-points-over': rule(6, E, SR5(89)),
  'knowledge-points-unspent': rule(6, E, SR5(88)),
  'skill-rating-over': rule(6, E, SR5(88)),
  'group-rating-over': rule(6, E, SR5(88)),
  'knowledge-rating-over': rule(6, E, SR5(91)),
  'skill-in-bought-group': rule(6, E, SR5(88)),
  'spec-on-group-skill': rule(6, E, SR5(89)),
  'spec-on-group': rule(8, E, SR5(89)),
  'spec-more-than-one': rule(6, E, SR5(89)),
  'spec-without-skill': rule(6, E, SR5(89)),
  'skill-restricted-magic': rule(6, E, SR5(89)),
  'skill-restricted-resonance': rule(6, E, SR5(89)),
  'skill-aspect-fence': rule(6, E, SR5(69)),
  'skill-adept-fence': rule(6, E, SR5(69)),
  'assensing-needs-astral': rule(6, E, SR5(142)),
  'incompetent-group-owned': rule(6, E, SR5(81)),
  'incompetent-skill-owned': rule(6, E, SR5(81)),
  'uncouth-social-group': rule(6, E, SR5(85)),
  'native-language-count': rule(6, E, SR5(89)),
  'native-language-missing': rule(6, W, SR5(89)),
  'native-language-rated': rule(6, W, SR5(89)),
  'knowledge-unnamed': rule(6, E, SR5(89)),
  'specific-skill-target': rule(6, W, SR5(131)),
  // 7 Gear
  'nuyen-overspent': rule(7, E, SR5(94)),
  'karma-to-nuyen-over': rule(7, E, SR5(94)),
  'nuyen-carry-lost': rule(7, W, SR5(94)),
  'availability-over': rule(7, E, SR5(94)),
  'availability-unreadable': rule(7, W, SR5(94)),
  'device-rating-over': rule(7, E, SR5(94)),
  'grade-not-at-creation': rule(7, E, SR5(95)),
  'augment-bonus-over': rule(7, E, SR5(94)),
  'essence-depleted': rule(7, E, SR5(53)),
  'magic-reduced-by-essence': rule(7, W, SR5(95)),
  'magic-burned-out': rule(7, E, SR5(95)),
  'sensitive-system-bioware': rule(7, E, SR5(83)),
  'lifestyle-missing': rule(7, W, SR5(94)),
  'commlink-missing': rule(7, W, SR5(94)),
  'fake-sin-missing': rule(7, W, SR5(94)),
  'approval-gear': rule(7, A, SR5(94)),
  // 8 Karma
  'karma-overspent': rule(8, E, SR5(98)),
  'karma-carry-over': rule(8, E, SR5(98)),
  'karma-spend-stale': rule(8, E, SR5(107)),
  'karma-spend-no-raise': rule(8, E, SR5(107)),
  'karma-magic-no-type': rule(8, E, SR5(68)),
  'karma-resonance-no-type': rule(8, E, SR5(68)),
  'group-raise-broken': rule(8, E, SR5(88)),
  'contact-karma-min': rule(8, E, SR5(98)),
  'contact-karma-max': rule(8, E, SR5(98)),
  'contact-karma-from-karma': rule(8, W, SR5(98)),
  'contact-karma-unspent': rule(8, W, SR5(98)),
  'contact-unnamed': rule(8, W, SR5(98)),
  'spirits-not-summoner': rule(8, E, SR5(98)),
  'spirits-over-charisma': rule(8, E, SR5(98)),
  'sprites-not-technomancer': rule(8, E, SR5(98)),
  'initiation-not-at-this-level': rule(8, E, SR5(64)),
  'initiation-not-awakened': rule(8, E, SR5(325)),
  'initiation-grade-gap': rule(8, E, SR5(325)),
  'sprites-over-charisma': rule(8, E, SR5(98)),
  'foci-force-over': rule(8, E, SR5(98)),
  'focus-bond-karma': rule(8, E, SR5(318)),
  'focus-type-unknown': rule(8, E, SR5(318)),
  'focus-type-mismatch': rule(8, E, SR5(318)),
  'focus-not-purchased': rule(8, E, SR5(318)),
  'knowledge-category-missing': rule(8, W, SR5(89)),
  // 9 Finish
  'contacts-missing': rule(9, W, SR5(101)),
  'background-missing': rule(9, W, SR5(103)),
} as const satisfies Readonly<Record<string, IssueRule>>;

export type IssueCode = keyof typeof ISSUE_RULES;

/** The registry entry for an issue code, suffixed codes included (`approval-gear-…`). */
export function issueRule(code: string): IssueRule | null {
  const rules = ISSUE_RULES as Readonly<Record<string, IssueRule>>;
  if (rules[code]) return rules[code];
  for (const prefix of ['approval-gear', 'approval-quality'] as const) {
    if (code.startsWith(`${prefix}-`)) return ISSUE_RULES[prefix];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AddOptions {
  path?: string;
  step?: BuildStep;
  ref?: Ref;
  /** Appended to the code for per-item codes. */
  suffix?: string;
}
type Add = (code: IssueCode, message: string, options?: AddOptions) => void;

const COLUMN_LABELS: Readonly<Record<PriorityColumn, string>> = {
  metatype: 'Metatype',
  attributes: 'Attributes',
  magic: 'Magic or Resonance',
  skills: 'Skills',
  resources: 'Resources',
};

/** The creation levels in our words, for the sentences that name one (SR5 p.64). */
const LEVEL_LABELS: Readonly<Record<CreationLevel, string>> = {
  street: 'street-level',
  experienced: 'standard',
  prime: 'prime runner',
};

const KIND_LABELS: Readonly<Record<MagicKind, string>> = {
  mundane: 'Mundane',
  magician: 'Magician',
  aspected: 'Aspected magician',
  adept: 'Adept',
  mysticAdept: 'Mystic adept',
  technomancer: 'Technomancer',
};

/**
 * Attributes by their full names in every sentence ("Body 11 is over its
 * maximum of 10"), from the engine's one map, so the validator names them the
 * way every step's rows do — not "BOD" in one sentence and "Magic" in the next.
 */
const ATTRIBUTE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(BUILD_ATTRIBUTE_NAMES).map(([id, names]) => [id, names.name]),
);

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const slug = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
const kebab = (id: string): string => id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const fmt = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`): string => `${fmt(n)} ${n === 1 ? one : many}`;

/** A short, stable fingerprint of some text: FNV-1a over its UTF-16 units, six base-36 digits. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(-6);
}

/**
 * A value as text that does not depend on key order: objects with their keys
 * sorted, `undefined` left out, and a modifier's `id` dropped — an id names
 * the row, not what the modifier does, and an editor may mint a new one.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const isModifier = typeof record.target === 'string' && typeof record.op === 'string' && 'source' in record;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined && !(isModifier && k === 'id'))
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * What a gear approval decides: the whole line as entered — the sheet item
 * with its stats and modifiers, its kind, table heading, Essence, how many, at
 * what rating, how available, what grade. Price is the one thing left out: a
 * new price is not a new item. Name and Availability are read without case
 * or padding, so retyping "8r" as "8R" is not a new decision either.
 */
const gearDecision = (p: CharacterBuild['purchases'][number]): string => {
  const { cost: _price, ...line } = p;
  return canonical({ ...line, name: p.name.trim().toLowerCase(), avail: (p.avail ?? '').trim().toUpperCase() });
};

const FORMULA_GROUP_LABELS = { spells: 'spells', rituals: 'rituals', preparations: 'alchemical preparations' } as const;

// ---------------------------------------------------------------------------
// Rules by step
// ---------------------------------------------------------------------------

function concept(build: CharacterBuild, settings: ChargenSettings, add: Add): void {
  if (!build.identity.alias.trim()) add('alias-missing', 'Give the runner an alias.', { path: 'identity.alias' });
  if (build.level !== settings.level) {
    add('level-mismatch', `The campaign builds ${settings.level} runners; this build was started as ${build.level}.`, {
      path: 'level',
    });
  }
  if (build.table !== settings.table) {
    add('table-mismatch', `The campaign uses the ${settings.table} priority table; this build was started on ${build.table}.`, {
      path: 'table',
    });
  }
}

function priorities(build: CharacterBuild, settings: ChargenSettings, t: BuildTally, add: Add): void {
  if (build.method === 'sumToTen' && !settings.allowSumToTen) {
    add('method-not-allowed', 'This campaign does not use Sum to Ten.', { path: 'method' });
  }
  for (const col of PRIORITY_COLUMNS) {
    if (build.priorities[col] === null) {
      add('priority-unset', `Choose a priority for ${COLUMN_LABELS[col]}.`, { path: `priorities.${col}` });
    }
  }
  if (build.method === 'priority') {
    for (const level of PRIORITY_LEVELS) {
      const cols = PRIORITY_COLUMNS.filter((c) => build.priorities[c] === level);
      if (cols.length > 1) {
        add('priority-duplicate', `Priority ${level} is used by ${cols.map((c) => COLUMN_LABELS[c]).join(' and ')}.`, {
          path: `priorities.${cols[1]}`,
        });
      }
    }
  } else {
    const pp = t.pools.priorityPoints;
    if (pp && pp.remaining < 0) {
      add('sum-to-ten-over', `The priorities cost ${pp.spent} points; Sum to Ten allows ${pp.available}.`, {
        path: 'priorities',
      });
    } else if (pp && pp.remaining > 0 && PRIORITY_COLUMNS.every((c) => build.priorities[c] !== null)) {
      add('sum-to-ten-under', `${plural(pp.remaining, 'priority point')} left unspent.`, { path: 'priorities' });
    }
  }
}

function metatypeAndAttributes(build: CharacterBuild, settings: ChargenSettings, t: BuildTally, add: Add): void {
  const { tables, ratings: r, effects } = t;
  const meta = tables.metatype;
  if (build.metatype === null) {
    add('metatype-missing', 'Choose a metatype.', { path: 'metatype' });
  } else if (!meta) {
    add('metatype-unknown', `"${build.metatype}" is not a metatype the tables know.`, { path: 'metatype' });
  } else {
    if (meta.family !== 'core' && !settings.allowMetavariants) {
      add('metatype-not-allowed', `${meta.name} needs the campaign to allow metavariants.`, {
        path: 'metatype',
        ref: meta.ref,
      });
    }
    const level = build.priorities.metatype;
    if (level && !tables.metatypeCell) {
      add('metatype-not-on-row', `${meta.name} cannot be taken at Metatype priority ${level}.`, { path: 'metatype' });
    }
  }

  const kindRow = MAGIC_KIND_TABLE[build.magic.kind];
  if (build.priorities.metatype) {
    const special = t.pools.special;
    if (special.remaining < 0) {
      add('special-points-over', `${plural(special.spent, 'special point')} spent; the priority gives ${special.available}.`, {
        path: 'special',
      });
    } else if (special.remaining > 0) {
      // Room wherever special points may go: Edge, and Magic or Resonance the
      // build can use — a mundane metasapient's natural Magic included (RF p. 102).
      const a = r.attributes;
      const room =
        Math.max(0, a.edg.max - a.edg.rating) +
        (usesMagic(build) ? Math.max(0, a.mag.max - a.mag.rating) : 0) +
        (usesResonance(build) ? Math.max(0, a.res.max - a.res.rating) : 0);
      if (room > 0) {
        add('special-points-unspent', `${plural(special.remaining, 'special point')} unspent; they vanish after creation.`, {
          path: 'special',
        });
      }
    }
  }
  // Special points go on Magic or Resonance before the type that uses them is
  // chosen: the book's own technomancer puts 2 on Resonance in its Step Two
  // (p. 67) and takes the Resonance column in Step Three (p. 70), which is the
  // walkthrough's 3-then-4. While the Magic row still offers a type that uses
  // the attribute, the missing decision is Step 4's, so the issue is filed
  // there; filed on Step 3 it would lock Next on the step before the fix.
  const rowOffers = (attribute: 'mag' | 'res'): boolean =>
    build.priorities.magic !== null && magicRowOffers(tables.table, build.priorities.magic, attribute);
  // A metasapient's or shapeshifter's natural Magic takes special points
  // whatever the Magic priority (RF p. 102).
  if (build.special.mag > 0 && !usesMagic(build)) {
    add('special-points-no-magic', 'Special points on Magic need a magic-using type.', {
      path: 'special.mag',
      ...(rowOffers('mag') ? { step: 4 as const } : {}),
    });
  }
  if (build.special.res > 0 && kindRow.attribute !== 'res') {
    add('special-points-no-resonance', 'Special points on Resonance need a technomancer.', {
      path: 'special.res',
      ...(rowOffers('res') ? { step: 4 as const } : {}),
    });
  }

  if (build.priorities.attributes) {
    const pool = t.pools.attributes;
    if (pool.remaining < 0) {
      add('attribute-points-over', `${plural(pool.spent, 'attribute point')} spent; the priority gives ${pool.available}.`, {
        path: 'attributes',
      });
    } else if (pool.remaining > 0) {
      add('attribute-points-unspent', `${plural(pool.remaining, 'attribute point')} still to spend.`, { path: 'attributes' });
    }
  }

  // Over the maximum. One point over, on an attribute a quality not yet taken
  // would lift — Exceptional Attribute for any but Edge, Lucky for Edge, never
  // both (p. 66, p. 72) — is Step 5's to fix, and only while exactly one
  // attribute is waiting on it.
  const over = ([...ATTRIBUTE_CODES, 'edg', 'mag', 'res'] as const).filter((id) => {
    const a = r.attributes[id];
    return a.rating > a.max && !((id === 'mag' || id === 'res') && a.rating === 0);
  });
  const liftable = over.filter((id) => {
    const a = r.attributes[id];
    if (a.creation !== a.tableMax + CREATION_ATTRIBUTE_RULES.qualityMaxBonus) return false;
    if (id === 'edg') return !effects.ids.has('exceptionalAttribute') && !effects.ids.has('lucky');
    // Exceptional Attribute held without a target still has one to name on Step 5.
    if (effects.ids.has('lucky') || effects.exceptionalAttribute !== null) return false;
    return id !== 'res' || !!meta?.resonance;
  });
  for (const id of over) {
    const a = r.attributes[id];
    const special = id === 'edg' || id === 'mag' || id === 'res';
    if (a.creation <= a.max) {
      add('attribute-over-max', `${ATTRIBUTE_LABELS[id]} ${a.rating} is over its maximum of ${a.max}.`, {
        path: 'karma.spends',
        step: 8,
      });
    } else if (liftable.length === 1 && liftable[0] === id) {
      add(
        'attribute-over-max',
        `${ATTRIBUTE_LABELS[id]} ${a.creation} is one over its maximum of ${a.max}; ${id === 'edg' ? 'Lucky' : 'Exceptional Attribute'} would allow it.`,
        { path: 'qualities', step: 5, ref: QUALITY_RULE_BY_ID[id === 'edg' ? 'lucky' : 'exceptionalAttribute'].ref },
      );
    } else {
      add('attribute-over-max', `${ATTRIBUTE_LABELS[id]} ${a.rating} is over its maximum of ${a.max}.`, {
        path: `${special ? 'special' : 'attributes'}.${id}`,
        step: 3,
      });
    }
  }

  // Magic and Resonance come from the Magic or Resonance priority (pp. 65–68),
  // or a metasapient's natural Magic (RF p. 102) — never from Karma alone.
  if (r.attributes.mag.karma > 0 && !usesMagic(build)) {
    add('karma-magic-no-type', `${KIND_LABELS[build.magic.kind]}s cannot buy Magic with Karma; it comes with a magic-using type.`, {
      path: 'karma.spends',
    });
  }
  if (r.attributes.res.karma > 0 && !usesResonance(build)) {
    add('karma-resonance-no-type', 'Only a technomancer can raise Resonance with Karma.', { path: 'karma.spends' });
  }

  // At the natural maximum: each attribute against its own maximum, so an
  // Exceptional Attribute one short of its lifted maximum is not "at" it.
  const atMax = ATTRIBUTE_CODES.filter((c) => r.attributes[c].rating >= r.attributes[c].max);
  if (atMax.length > 1) {
    const atCreation = ATTRIBUTE_CODES.filter((c) => r.attributes[c].creation >= r.attributes[c].max);
    const message = `Only one attribute may start at its natural maximum: ${atMax.map((c) => ATTRIBUTE_LABELS[c]).join(', ')} are.`;
    // Two at the table's maximum while Exceptional Attribute is still to be
    // taken (and Lucky does not rule it out): the quality on one of them lifts
    // that maximum and leaves one at it, so the fix is Step 5's — as for an
    // attribute one over, which the same quality would allow.
    const eaSettles =
      atCreation.length > 1 &&
      effects.exceptionalAttribute === null &&
      !effects.ids.has('lucky') &&
      atCreation.some((lifted) => {
        const bonus = CREATION_ATTRIBUTE_RULES.qualityMaxBonus;
        const maxOf = (c: AttributeCode): number => r.attributes[c].tableMax + (c === lifted ? bonus : 0);
        return (
          ATTRIBUTE_CODES.every((c) => r.attributes[c].creation <= maxOf(c)) &&
          ATTRIBUTE_CODES.filter((c) => r.attributes[c].creation >= maxOf(c)).length <= 1
        );
      });
    if (eaSettles) {
      add('attribute-max-more-than-one', `${message} Exceptional Attribute on one of them would allow it.`, {
        path: 'qualities',
        step: 5,
        ref: QUALITY_RULE_BY_ID.exceptionalAttribute.ref,
      });
    } else {
      add('attribute-max-more-than-one', message, { path: 'attributes', step: atCreation.length > 1 ? 3 : 8 });
    }
  }

  if (effects.ids.has('exceptionalAttribute') && effects.ids.has('lucky')) {
    add('lucky-and-exceptional', 'Take Lucky or Exceptional Attribute, not both.', { path: 'qualities' });
  }
}

function magic(build: CharacterBuild, t: BuildTally, add: Add): void {
  const { tables, ratings: r, effects, pools } = t;
  const kind = build.magic.kind;
  const kindRow = MAGIC_KIND_TABLE[kind];
  const level = build.priorities.magic;
  const row = tables.rows.magic;
  const option = tables.magicOption;

  if (level && row) {
    if (kind !== 'mundane' && !option) {
      add('magic-kind-not-offered', `${KIND_LABELS[kind]} is not offered at Magic priority ${level}.`, {
        path: 'magic.kind',
        ref: row.ref,
      });
    } else if (kind === 'mundane' && row.magic.length > 0) {
      add('magic-priority-unused', `Magic priority ${level} is spent on a mundane.`, { path: 'magic.kind', ref: row.ref });
    }
  }
  if (kind === 'technomancer' && tables.metatype && tables.metatype.resonance === null) {
    add('resonance-not-allowed', `${tables.metatype.name} cannot have Resonance.`, { path: 'magic.kind' });
  }
  if (kind === 'aspected' && !build.magic.aspect) {
    add('aspect-missing', 'Choose the aspect: Sorcery, Conjuring or Enchanting.', { path: 'magic.aspect' });
  }
  if ((kind === 'magician' || kind === 'aspected' || kind === 'mysticAdept') && !build.magic.tradition) {
    add('tradition-missing', 'Choose a tradition; it sets the Drain attributes.', { path: 'magic.tradition' });
  }
  if (effects.ids.has('mentorSpirit') && !build.magic.mentor?.trim()) {
    add('mentor-spirit-unnamed', 'Name the mentor spirit.', { path: 'magic.mentor' });
  }

  // Grants: filled, or explicitly waived (§4.4 Step 4).
  const waived = new Set(build.magic.waived ?? []);
  const ref = option?.ref ?? row?.ref ?? SR5(65);
  const g = build.grants;
  const skillGrant = option?.skills ?? null;
  const wantSkills = skillGrant?.count ?? 0;
  if (g.skills.length > wantSkills) {
    add('grant-skills-over', `${plural(g.skills.length, 'granted skill')} picked; the priority grants ${wantSkills}.`, {
      path: 'grants.skills',
      ref,
    });
  } else if (g.skills.length < wantSkills && !waived.has('skills')) {
    add('grant-skills-unfilled', `Pick ${plural(wantSkills - g.skills.length, 'more granted skill')}.`, {
      path: 'grants.skills',
      ref,
    });
  }
  if (skillGrant) {
    g.skills.forEach((grant, i) => {
      const sk = activeSkillRow(grant.id);
      const pool = skillGrant.pool;
      const inPool = !!sk && grantPoolIncludes(sk, pool);
      if (!inPool || grant.rating !== skillGrant.rating) {
        add(
          'grant-skill-invalid',
          !sk
            ? `"${grant.id}" is not a skill the tables know.`
            : !inPool
              ? `${sk.name} is not one of the skills this priority grants.`
              : `${sk.name} is granted at ${skillGrant.rating}, not ${grant.rating}.`,
          { path: `grants.skills.${i}`, ref },
        );
      }
    });
  }
  const groupGrant = option?.groups ?? null;
  const wantGroups = groupGrant?.count ?? 0;
  if (g.groups.length > wantGroups) {
    add('grant-groups-over', `${plural(g.groups.length, 'granted group')} picked; the priority grants ${wantGroups}.`, {
      path: 'grants.groups',
      ref,
    });
  } else if (g.groups.length < wantGroups && !waived.has('groups')) {
    add('grant-groups-unfilled', `Pick ${plural(wantGroups - g.groups.length, 'more granted group')}.`, {
      path: 'grants.groups',
      ref,
    });
  }
  if (groupGrant) {
    g.groups.forEach((grant, i) => {
      const grp = skillGroupRow(grant.id);
      const inPool = !!grp && groupGrant.groups.includes(grp.id);
      const aspectOk = kind !== 'aspected' || !build.magic.aspect || grp?.id === build.magic.aspect;
      if (!inPool || !aspectOk || grant.rating !== groupGrant.rating) {
        add(
          'grant-group-invalid',
          !grp
            ? `"${grant.id}" is not a skill group the tables know.`
            : !inPool || !aspectOk
              ? `${grp.name} is not a group this magician may be granted.`
              : `${grp.name} is granted at ${groupGrant.rating}, not ${grant.rating}.`,
          { path: `grants.groups.${i}` },
        );
      }
    });
  }
  const wantSpells = option?.formulae ?? 0;
  if (g.spells.length > wantSpells) {
    add('grant-spells-over', `${plural(g.spells.length, 'free spell')} picked; the priority grants ${wantSpells}.`, {
      path: 'grants.spells',
      ref,
    });
  } else if (g.spells.length < wantSpells && !waived.has('spells')) {
    add('grant-spells-unfilled', `Pick ${plural(wantSpells - g.spells.length, 'more free spell')}.`, {
      path: 'grants.spells',
      ref,
    });
  }
  const wantForms = option?.forms ?? 0;
  if (g.forms.length > wantForms) {
    add('grant-forms-over', `${plural(g.forms.length, 'free complex form')} picked; the priority grants ${wantForms}.`, {
      path: 'grants.forms',
      ref,
    });
  } else if (g.forms.length < wantForms && !waived.has('forms')) {
    add('grant-forms-unfilled', `Pick ${plural(wantForms - g.forms.length, 'more free complex form')}.`, {
      path: 'grants.forms',
      ref,
    });
  }

  // Formulae and forms: who may know them (p. 69 — an aspected magician only
  // its aspect's), and the Magic × 2 / Resonance × 2 caps (p. 98).
  const karmaFormulae = build.karma.spends.some((s) => s.kind === 'spell');
  const cap = t.magic * kindRow.knownPerRating;
  for (const group of ['spells', 'rituals', 'preparations'] as const) {
    const n = t.formulae[group];
    if (n <= 0) continue;
    if (!knowsFormulaGroup(build.magic, group)) {
      const granted = build.grants.spells.some((pick) => formulaGroup(pick) === group);
      add(
        'formulae-not-caster',
        kind === 'aspected'
          ? `An aspected magician of ${build.magic.aspect ?? 'this aspect'} cannot learn ${FORMULA_GROUP_LABELS[group]}.`
          : `${KIND_LABELS[kind]} cannot learn ${FORMULA_GROUP_LABELS[group]}.`,
        { path: granted ? 'grants.spells' : 'karma.spends', step: granted ? 4 : 8 },
      );
    } else if (n > cap) {
      add('formulae-over-cap', `${plural(n, group.slice(0, -1))} known; Magic ${t.magic} allows ${cap}.`, {
        path: 'grants.spells',
        step: karmaFormulae ? 8 : 4,
      });
    }
  }
  if (t.forms > 0 && kind !== 'technomancer') {
    add('forms-not-technomancer', 'Only technomancers learn complex forms.', { path: 'grants.forms' });
  } else if (t.forms > t.resonance * 2) {
    add('forms-over-cap', `${plural(t.forms, 'complex form')} known; Resonance ${t.resonance} allows ${t.resonance * 2}.`, {
      path: 'grants.forms',
      step: build.karma.spends.some((s) => s.kind === 'form') ? 8 : 4,
    });
  }

  // Adept powers and power points.
  if (build.powers.length > 0 && kindRow.powerPoints === null) {
    add('powers-not-adept', `${KIND_LABELS[kind]} cannot take adept powers.`, { path: 'powers' });
  }
  if (kindRow.powerPoints !== null && pools.powerPoints.remaining < 0) {
    add(
      'power-points-over',
      `Powers cost ${pools.powerPoints.spent} power points; ${pools.powerPoints.available} are available.`,
      { path: 'powers' },
    );
  }
  build.powers.forEach((p, i) => {
    if (kindRow.powerPoints !== null && p.levels > t.magic) {
      add('power-levels-over-magic', `${p.name} has ${p.levels} levels; Magic ${t.magic} allows ${t.magic}.`, {
        path: `powers.${i}.levels`,
      });
    }
  });
  // Bought up to Magic — Magic after Essence loss, which takes a power point
  // with each point of Magic (p. 69, p. 279).
  const bought = build.karma.spends.reduce((s, sp) => s + (sp.kind === 'powerPoint' ? sp.count : 0), 0);
  if (bought > 0 && kind !== 'mysticAdept') {
    add('power-point-purchase-not-mystic', 'Only mystic adepts buy power points with Karma.', { path: 'karma.spends' });
  } else if (kind === 'mysticAdept' && bought > t.magic) {
    add(
      'power-point-purchase-over-magic',
      t.magic < r.attributes.mag.rating
        ? `${plural(bought, 'power point')} bought; Essence loss leaves Magic ${t.magic}, which allows ${t.magic}.`
        : `${plural(bought, 'power point')} bought; Magic ${t.magic} allows ${t.magic}.`,
      { path: 'karma.spends' },
    );
  }
}

function qualities(build: CharacterBuild, t: BuildTally, add: Add): void {
  const { effects, tables, ratings: r } = t;
  const cap = tables.preset.qualityCap;
  if (t.positiveKarma > cap) {
    add('positive-quality-cap', `Positive qualities cost ${t.positiveKarma} Karma; the cap is ${cap}.`, {
      path: 'qualities',
    });
  }
  if (t.negativeKarma > cap) {
    add('negative-quality-cap', `Negative qualities give ${t.negativeKarma} Karma; the cap is ${cap}.`, {
      path: 'qualities',
    });
  }

  // A whitelisted quality's type is the book's: a positive one recorded as
  // negative would pay Karma out, a negative one recorded as positive would
  // drop its rules. The one exception is the buy-off of a quality the
  // metatype is born with (RF p. 102) — and that quality, being held already,
  // cannot be taken again for its Karma.
  const born = bornQualities(build.metatype);
  build.qualities.forEach((q, i) => {
    const entry = qualityRuleFor(q.name);
    if (!entry) return;
    if (q.type === 'negative' && born.includes(entry.id)) {
      const metatype = tables.metatype?.name.toLowerCase() ?? build.metatype;
      add('quality-racial-held', `A ${metatype} is born ${entry.name}; it gives no Karma a second time.`, {
        path: `qualities.${i}`,
      });
    } else if (q.type !== entry.type && !isQualityBuyOff(q, build.metatype)) {
      add('quality-type-mismatch', `${entry.name} is a ${entry.type} quality, not a ${q.type} one.`, {
        path: `qualities.${i}.type`,
        ref: entry.ref,
      });
    }
  });

  // A quality written in by hand — not picked from the books, and not one the
  // whitelist knows — has a side, a price and effects only the player vouches
  // for: nothing else stops a player writing themselves a 25-Karma negative
  // quality. The GM decides it the way they decide Restricted gear, and the
  // decision is the line as written (side, Karma, rating, target, modifiers),
  // so a quality re-priced after approval asks again. A second identical line
  // is a second decision.
  const custom = new Map<string, number>();
  build.qualities.forEach((q, i) => {
    if (q.catalogueId || qualityRuleFor(q.name)) return;
    const decision = canonical({
      name: q.name.trim().toLowerCase(),
      type: q.type,
      karma: q.karma,
      rating: q.rating,
      target: q.target?.trim() ?? '',
      mods: q.mods,
    });
    const base = `custom-${slug(q.name)}-${fingerprint(decision)}`;
    const n = (custom.get(base) ?? 0) + 1;
    custom.set(base, n);
    add(
      'approval-quality',
      `${q.name.trim()} is written in by hand (${q.type}, ${q.karma} Karma); the GM decides whether it stands.`,
      { path: `qualities.${i}`, ref: q.ref ?? SR5(71), suffix: n > 1 ? `${base}-${n}` : base },
    );
  });

  const seen = new Map<QualityRuleId, number>();
  const pairs = new Set<string>();
  // Only a Magic rating the build can use: a mundane's Karma-bought Magic
  // opens no Awakened-only quality (and is its own error).
  const magicRating = usesMagic(build) ? r.attributes.mag.rating : 0;
  for (const h of effects.held) {
    const entry = h.rule;
    if (!entry) continue;
    const path = `qualities.${h.index}`;
    const count = (seen.get(entry.id) ?? 0) + 1;
    seen.set(entry.id, count);
    if (entry.once && count === 2) {
      add('quality-once', `${entry.name} can be taken only once.`, { path, ref: entry.ref });
    }
    if (count === 1 && entry.needsApproval) {
      // The decision is the quality *and* what it lifts: Exceptional Attribute
      // on Strength is not Exceptional Attribute on Agility.
      const target =
        entry.id === 'exceptionalAttribute'
          ? (effects.exceptionalAttribute ?? h.quality.target?.trim() ?? '')
          : (h.quality.target?.trim() ?? '');
      add('approval-quality', `${entry.name}${target ? ` (${target})` : ''} needs the GM's approval.`, {
        path,
        ref: entry.ref,
        suffix: target ? `${kebab(entry.id)}-${slug(target)}` : kebab(entry.id),
      });
    }
    for (const q of entry.rules) {
      switch (q.kind) {
        case 'exclusive':
          for (const other of q.with) {
            const key = [entry.id, other].sort().join('|');
            if (key === 'exceptionalAttribute|lucky' || pairs.has(key) || !effects.ids.has(other)) continue;
            pairs.add(key);
            add('quality-exclusive', `${entry.name} and ${QUALITY_RULE_BY_ID[other].name} cannot be held together.`, {
              path,
              ref: entry.ref,
            });
          }
          break;
        case 'requiresAwakened':
          if (q.who === 'magicRating' && magicRating <= 0) {
            add('quality-requires-magic', `${entry.name} needs a Magic rating.`, { path, ref: entry.ref });
          }
          if (q.who === 'spellcasterOrTechnomancer' && !(castsSpells(build.magic) || build.magic.kind === 'technomancer')) {
            add('quality-requires-caster', `${entry.name} is for spellcasters and technomancers.`, {
              path,
              ref: entry.ref,
            });
          }
          break;
        case 'forbiddenWithMagic':
          if (magicRating > 0) {
            add('quality-forbidden-with-magic', `${entry.name} cannot be taken with a Magic rating.`, {
              path,
              ref: entry.ref,
            });
          }
          break;
        case 'metatypeGate': {
          const meta = tables.metatype;
          if (meta && !(q.metatypes as readonly string[]).includes(meta.variantOf ?? meta.id)) {
            add('quality-metatype-gate', `${entry.name} is not open to a ${meta.name.toLowerCase()}.`, {
              path,
              ref: entry.ref,
            });
          }
          break;
        }
        case 'overflowPerRating': {
          // The rating and the Karma must describe one purchase: Karma per rating × rating (p. 77).
          const rating = qualityRatingOf(h);
          if (rating > q.max) {
            add('quality-rating-range', `${entry.name} goes to rating ${q.max}.`, {
              path: `${path}.rating`,
              ref: entry.ref,
            });
          } else if (h.quality.karma !== rating * q.karmaPerRating) {
            add(
              'quality-karma-mismatch',
              `${entry.name} ${rating} costs ${rating * q.karmaPerRating} Karma, not ${h.quality.karma}.`,
              { path: `${path}.karma`, ref: entry.ref },
            );
          }
          break;
        }
        case 'lifestyleMultiplierByRating': {
          // Each level has its own Karma (p. 80); a rating and a Karma that disagree are two different purchases.
          const rating = h.quality.rating;
          const level = rating === null ? q.levels.find((l) => l.karma === h.quality.karma) : q.levels.find((l) => l.rating === rating);
          if (rating !== null && rating > q.levels.length) {
            add('quality-rating-range', `${entry.name} goes to rating ${q.levels.length}.`, {
              path: `${path}.rating`,
              ref: entry.ref,
            });
          } else if (!level || level.karma !== h.quality.karma) {
            add(
              'quality-karma-mismatch',
              level
                ? `${entry.name} ${level.rating} gives ${level.karma} Karma, not ${h.quality.karma}.`
                : `${entry.name} gives ${q.levels.map((l) => l.karma).join(', ')} Karma by level, not ${h.quality.karma}.`,
              { path: `${path}.karma`, ref: entry.ref },
            );
          }
          break;
        }
        case 'barsGroup':
          if (q.groups === 'chosen') {
            const text = h.quality.target?.trim() || /[([{]\s*([^)\]}]+?)\s*[)\]}]/.exec(h.quality.name)?.[1];
            if (!text || !skillGroupRow(text)) {
              add('incompetent-target', `Name the skill group ${entry.name} applies to.`, {
                path: `${path}.target`,
                ref: entry.ref,
              });
            }
          }
          break;
        default:
          break;
      }
    }
    if (entry.id === 'exceptionalAttribute' && count === 1 && !effects.exceptionalAttribute) {
      add('exceptional-attribute-target', 'Name the attribute Exceptional Attribute raises (not Edge).', {
        path: `${path}.target`,
      });
    }
    if (entry.id === 'aptitude' && count === 1 && !effects.aptitudeSkill) {
      add('aptitude-target', 'Name the active skill Aptitude applies to.', { path: `${path}.target` });
    }
  }
}

function skills(build: CharacterBuild, t: BuildTally, add: Add): void {
  const { ratings: r, pools, effects } = t;
  const fences = eligibilityContext(build, t.tables.settings);
  const activePath = (i: number | null, field: string): string => (i === null ? 'skills.active' : `skills.active.${i}.${field}`);
  // A fence on a rating is filed where that rating came from: points are Step
  // 6's, a Magic column grant Step 4's, and a rating only Karma gave Step 8's
  // to take back. Filed on Step 6 when nothing there holds it, it would lock
  // Next on a step that cannot fix it.
  type Where = { path: string; step?: BuildStep };
  const groupWhere = (grp: GroupRating): Where => {
    const grant = build.grants.groups.findIndex((g) => (skillGroupRow(g.id)?.id ?? g.id) === grp.id);
    if (grp.points > 0) return { path: grp.index === null ? 'skills.groups' : `skills.groups.${grp.index}.points` };
    if (grp.grant > 0 && grant >= 0) return { path: `grants.groups.${grant}`, step: 4 };
    return { path: 'karma.spends', step: 8 };
  };

  const keys = new Map<string, number>();
  build.skills.active.forEach((entry, i) => {
    if (!activeSkillRow(entry.id)) {
      add('skill-unknown', `"${entry.id}" is not a skill the tables know.`, { path: `skills.active.${i}.id` });
    }
    const key = `${activeSkillRow(entry.id)?.id ?? entry.id}|${(entry.target ?? '').trim().toLowerCase()}`;
    if (keys.has(key)) {
      add('skill-duplicate', `${activeSkillRow(entry.id)?.name ?? entry.id} is listed twice.`, { path: `skills.active.${i}` });
    }
    keys.set(key, i);
  });
  build.skills.groups.forEach((entry, i) => {
    if (!skillGroupRow(entry.id)) {
      add('group-unknown', `"${entry.id}" is not a skill group the tables know.`, { path: `skills.groups.${i}.id` });
    }
  });

  if (build.priorities.skills) {
    if (pools.skills.remaining < 0) {
      add('skill-points-over', `${plural(pools.skills.spent, 'skill point')} spent; the priority gives ${pools.skills.available}.`, {
        path: 'skills.active',
      });
    } else if (pools.skills.remaining > 0) {
      add('skill-points-unspent', `${plural(pools.skills.remaining, 'skill point')} still to spend.`, { path: 'skills.active' });
    }
    if (pools.groups.remaining < 0) {
      add('group-points-over', `${plural(pools.groups.spent, 'group point')} spent; the priority gives ${pools.groups.available}.`, {
        path: 'skills.groups',
      });
    } else if (pools.groups.remaining > 0) {
      add('group-points-unspent', `${plural(pools.groups.remaining, 'group point')} still to spend.`, { path: 'skills.groups' });
    }
  }
  const freeKnowledge = (r.attributes.int.rating + r.attributes.log.rating) * CREATION_SKILL_RULES.knowledgePointsPerIntLog;
  const diverted = pools.knowledge.available - freeKnowledge;
  if (pools.knowledge.remaining < 0) {
    add(
      'knowledge-points-over',
      `${plural(pools.knowledge.spent - diverted, 'knowledge point')} spent; INT + LOG gives ${freeKnowledge}.`,
      { path: 'skills.knowledge' },
    );
  } else if (pools.knowledge.remaining > 0) {
    add('knowledge-points-unspent', `${plural(pools.knowledge.remaining, 'knowledge point')} still to spend.`, {
      path: 'skills.knowledge',
    });
  }

  for (const sk of r.skills) {
    if (sk.rating <= 0 && !sk.pointSpec) continue;
    const name = sk.row?.name ?? sk.id;
    const path = activePath(sk.index, 'points');
    if (sk.rating > sk.max) {
      add('skill-rating-over', `${name} ${sk.rating} is over the creation maximum of ${sk.max}.`, {
        path: sk.creation > sk.max ? path : 'karma.spends',
        step: sk.creation > sk.max ? 6 : 8,
      });
    }
    if (sk.group && (sk.points > 0 || sk.grant > 0) && sk.groupRating > 0) {
      add('skill-in-bought-group', `${name} is already bought through its group; groups cannot be broken yet.`, { path });
    }
    if (sk.pointSpec && sk.group && sk.groupRating > 0) {
      add('spec-on-group-skill', `${name} is bought through its group; specialise it with Karma instead.`, {
        path: activePath(sk.index, 'spec'),
      });
    }
    if (sk.pointSpec && sk.creation === 0) {
      add('spec-without-skill', `${name} needs a rating before it can be specialised.`, { path: activePath(sk.index, 'spec') });
    }
    if (sk.specs.length > 1) {
      // A skill point buys at most one (one entry, one `spec`), so a second is always a Karma one.
      add('spec-more-than-one', `${name} has ${sk.specs.length} specialisations; one is allowed at creation.`, {
        path: 'karma.spends',
        step: 8,
      });
    }
    if (sk.rating <= 0 || !sk.row) continue;
    // A member rated only through its group — bought with points or with
    // Karma — has no rating of its own: the group's incompetent issue says it,
    // and any other fence on it is filed where the group's is.
    const group = sk.group ? r.groups.find((g) => g.id === sk.group) : undefined;
    const viaGroupOnly = !!group && sk.points === 0 && sk.grant === 0 && sk.rating <= group.rating;
    const grantIndex = build.grants.skills.findIndex((g) => (activeSkillRow(g.id)?.id ?? g.id) === sk.id);
    const where: Where =
      sk.points > 0
        ? { path }
        : viaGroupOnly && group
          ? groupWhere(group)
          : sk.grant > 0 && grantIndex >= 0
            ? { path: `grants.skills.${grantIndex}`, step: 4 }
            : { path: 'karma.spends', step: 8 };
    for (const reason of skillEligibilityIn(fences, sk.row).reasons) {
      if (reason.code === 'incompetent-skill-owned' && viaGroupOnly) continue;
      add(reason.code as IssueCode, eligibilityMessage(reason.code, name, build), where);
    }
    if (sk.row.specific && !sk.target) {
      add('specific-skill-target', `${name} needs the weapon or vehicle it is for.`, { path: activePath(sk.index, 'target') });
    }
  }

  for (const grp of r.groups) {
    if (grp.rating <= 0 || !grp.row) continue;
    const path = grp.index === null ? 'skills.groups' : `skills.groups.${grp.index}.points`;
    if (grp.rating > CREATION_SKILL_RULES.maxRating) {
      add('group-rating-over', `${grp.row.name} ${grp.rating} is over the creation maximum of ${CREATION_SKILL_RULES.maxRating}.`, {
        path: grp.creation > CREATION_SKILL_RULES.maxRating ? path : 'karma.spends',
        step: grp.creation > CREATION_SKILL_RULES.maxRating ? 6 : 8,
      });
    }
    const where = groupWhere(grp);
    for (const reason of groupEligibilityIn(fences, grp.row).reasons) {
      add(reason.code as IssueCode, eligibilityMessage(reason.code, grp.row.name, build), where);
    }
  }

  for (const k of [...r.knowledge, ...r.languages]) {
    const isLanguage = 'native' in k;
    const list = isLanguage ? 'languages' : 'knowledge';
    const path = k.index === null ? `skills.${list}` : `skills.${list}.${k.index}`;
    if (k.rating > CREATION_SKILL_RULES.maxKnowledgeRating) {
      add('knowledge-rating-over', `${k.name || 'A knowledge skill'} ${k.rating} is over the creation maximum of 6.`, {
        path: k.creation > CREATION_SKILL_RULES.maxKnowledgeRating ? path : 'karma.spends',
        step: k.creation > CREATION_SKILL_RULES.maxKnowledgeRating ? 6 : 8,
      });
    }
    if (!k.name && (k.creation > 0 || k.pointSpec)) {
      add('knowledge-unnamed', `Name the ${isLanguage ? 'language' : 'knowledge skill'} the points went into.`, {
        path: `${path}.name`,
      });
    }
    if (k.specs.length > 1) {
      add('spec-more-than-one', `${k.name} has ${k.specs.length} specialisations; one is allowed at creation.`, {
        path: 'karma.spends',
        step: 8,
      });
    }
    if (k.pointSpec && k.creation === 0) {
      add('spec-without-skill', `${k.name || 'That skill'} needs a rating before it can be specialised.`, { path: `${path}.spec` });
    }
  }

  const natives = r.languages.filter((l) => l.native);
  if (natives.length > effects.nativeLanguages) {
    add(
      'native-language-count',
      `${plural(natives.length, 'native language')}; ${effects.nativeLanguages === 1 ? 'one is' : 'two are'} free.`,
      { path: 'skills.languages' },
    );
  } else if (natives.length === 0) {
    add('native-language-missing', 'Choose a native language.', { path: 'skills.languages' });
  }
  for (const l of natives) {
    if (l.points + l.skillPoints > 0) {
      add('native-language-rated', `${l.name} is native; points on it buy nothing.`, {
        path: l.index === null ? 'skills.languages' : `skills.languages.${l.index}`,
      });
    }
  }
}

function gear(build: CharacterBuild, t: BuildTally, add: Add): void {
  const { tables, effects, ratings: r } = t;
  const preset = tables.preset;
  if (t.nuyenRemaining < 0) {
    add('nuyen-overspent', `${fmt(-t.nuyenRemaining)}¥ overspent.`, { path: 'purchases' });
  }
  if (build.karma.toNuyen > preset.karmaToNuyenMax) {
    add(
      'karma-to-nuyen-over',
      `${plural(build.karma.toNuyen, 'Karma', 'Karma')} converted; ${tables.level} allows ${preset.karmaToNuyenMax}.`,
      { path: 'karma.toNuyen', ...(tables.level === 'experienced' ? {} : { ref: SR5(64) }) },
    );
  }
  if (t.nuyenRemaining > preset.nuyenCarry) {
    add(
      'nuyen-carry-lost',
      `${fmt(t.nuyenRemaining - preset.nuyenCarry)}¥ over the ${fmt(preset.nuyenCarry)}¥ carry-over will be lost.`,
      { path: 'purchases' },
    );
  }

  const bonus: Record<string, number> = {};
  const addMods = (mods: readonly Modifier[]): void => {
    for (const m of mods) {
      if (m.source.kind === 'quality' || m.source.kind === 'override') continue;
      const code = /^attr\.(bod|agi|rea|str|wil|log|int|cha)$/.exec(m.target)?.[1];
      if (code && m.active && m.op === 'add' && m.value > 0) bonus[code] = (bonus[code] ?? 0) + m.value;
    }
  };

  const decisions = new Map<string, number>();
  // An unrated focus a bond answers has the bond's Force for its rating: Step 8 reads its Availability there.
  const bonded = new Set(focusPurchaseMatches(build).filter((at): at is number => typeof at === 'number'));
  build.purchases.forEach((p, i) => {
    const path = `purchases.${i}`;
    const avail = purchaseAvailability(p);
    if (avail.value !== null && avail.value > preset.maxAvailability) {
      add('availability-over', `${p.name} is Availability ${avail.value}; the cap is ${preset.maxAvailability}.`, {
        path: `${path}.avail`,
      });
    }
    if (avail.status === 'needsRating') {
      if (!bonded.has(i)) {
        add('availability-unreadable', `${p.name}'s Availability (${p.avail}) needs its rating before the cap can be checked.`, {
          path: `${path}.rating`,
        });
      }
    } else if (avail.status === 'unreadable') {
      add('availability-unreadable', `${p.name}'s Availability (${p.avail}) cannot be read; check it against the cap by hand.`, {
        path: `${path}.avail`,
      });
    }
    const deviceRating = purchaseDeviceRating(p);
    if (isDevice(p) && deviceRating !== null && deviceRating > preset.maxDeviceRating) {
      add('device-rating-over', `${p.name} is device rating ${deviceRating}; the cap is ${preset.maxDeviceRating}.`, {
        path: p.deviceRating !== undefined ? `${path}.deviceRating` : `${path}.rating`,
      });
    }
    if (p.list === 'augments' && p.grade && !IMPLANT_GRADES[p.grade].atCreation) {
      // The rule's page (p. 95, the registry's), not the grades table's: the
      // Gear step's grade cards cite p. 95 for the same refusal.
      add('grade-not-at-creation', `${p.name}: ${p.grade} is not available at creation.`, { path: `${path}.grade` });
    }
    if (effects.sensitiveSystem && isBioware(p)) {
      add('sensitive-system-bioware', `Sensitive System rules out ${p.name}.`, { path });
    }
    if (avail.legality) {
      // One decision per item as entered; an identical second line is a second decision.
      const base = `${slug(p.name)}-${fingerprint(gearDecision(p))}`;
      const n = (decisions.get(base) ?? 0) + 1;
      decisions.set(base, n);
      add('approval-gear', `${p.name} is ${avail.legality === 'F' ? 'Forbidden' : 'Restricted'}; the GM decides.`, {
        path,
        suffix: n === 1 ? base : `${base}-${n}`,
      });
    }
    if (p.list === 'augments') addMods(p.item.mods);
  });
  // Qualities are innate — part of the natural rating the cap is measured from,
  // as derive reads it (derive-pipeline's AUGMENTATION_SOURCE_KINDS).
  for (const p of build.powers) addMods(p.mods);
  for (const code of ATTRIBUTE_CODES) {
    const b = bonus[code] ?? 0;
    if (b > AUGMENTATION_BONUS_CAP) {
      add('augment-bonus-over', `${ATTRIBUTE_LABELS[code]} is raised +${b}; augmentation stops at +${AUGMENTATION_BONUS_CAP}.`, { path: 'purchases' });
    }
  }

  if (t.essence <= 0) add('essence-depleted', `Essence ${t.essence} — a runner needs Essence above 0.`, { path: 'purchases' });
  for (const [id, after, counts] of [
    ['mag', t.magic, usesMagic(build)],
    ['res', t.resonance, usesResonance(build)],
  ] as const) {
    const natural = counts ? r.attributes[id].rating : 0;
    if (natural <= 0 || t.essenceLost <= 0) continue;
    if (after <= 0) {
      add('magic-burned-out', `Essence loss takes ${ATTRIBUTE_LABELS[id]} to 0.`, { path: 'purchases' });
    } else if (after < natural) {
      add('magic-reduced-by-essence', `Essence loss drops ${ATTRIBUTE_LABELS[id]} from ${natural} to ${after}.`, {
        path: 'purchases',
      });
    }
  }

  if (build.lifestyles.length === 0) add('lifestyle-missing', 'Pick a lifestyle.', { path: 'lifestyles' });
  const named = (re: RegExp): boolean => build.purchases.some((p) => re.test(p.name) || re.test(p.kind));
  if (!named(/commlink/i)) add('commlink-missing', 'No commlink yet.', { path: 'purchases' });
  if (!named(/fake\s*sin|false\s*sin/i)) add('fake-sin-missing', 'No fake SIN yet.', { path: 'purchases' });
}

function karma(build: CharacterBuild, t: BuildTally, add: Add): void {
  const { tables, ratings: r, pools } = t;
  const preset = tables.preset;
  if (t.karmaRemaining < 0) {
    add('karma-overspent', `${plural(-t.karmaRemaining, 'Karma', 'Karma')} overspent.`, { path: 'karma' });
  } else if (t.karmaRemaining > preset.karmaCarry) {
    add(
      'karma-carry-over',
      `${plural(t.karmaRemaining, 'Karma', 'Karma')} left; at most ${preset.karmaCarry} carries into play.`,
      { path: 'karma' },
    );
  }

  // Raises chain from the rating they were tapped at.
  const running = new Map<string, number>();
  const groupKeyOf = (id: string): string => `group|${skillGroupRow(id)?.id ?? id}`;
  const skillKeyOf = (id: string, target?: string): string => `skill|${activeSkillRow(id)?.id ?? id}|${(target ?? '').toLowerCase()}`;
  // Indexed once. Every one of these was a linear `find` or `some` INSIDE the
  // per-spend loop below, which made judging a build quadratic in its own
  // lists — and this pass runs on the server in front of the table's single
  // database connection as well as in the browser on every change.
  const lcName = (s: string): string => s.trim().toLowerCase();
  const firstBy = <T,>(rows: readonly T[], key: (row: T) => string): Map<string, T> => {
    const out = new Map<string, T>();
    for (const row of rows) {
      const k = key(row);
      if (!out.has(k)) out.set(k, row);
    }
    return out;
  };
  const skillByKey = firstBy(r.skills, (s) => `${s.id}|${lcName(s.target ?? '')}`);
  const skillById = firstBy(r.skills, (s) => s.id);
  const knowledgeByName = firstBy(r.knowledge, (k) => lcName(k.name));
  const languageByName = firstBy(r.languages, (l) => lcName(l.name));
  const groupById = firstBy(r.groups, (g) => g.id);
  const knowledgeEntered = new Set(build.skills.knowledge.map((k) => lcName(k.name)));
  const skillStart = (id: string, target?: string): number => {
    const row = activeSkillRow(id);
    const sk = skillByKey.get(`${row?.id ?? id}|${lcName(target ?? '')}`);
    const groupRun = row?.group ? running.get(groupKeyOf(row.group)) : undefined;
    return Math.max(sk?.creation ?? 0, groupRun ?? 0);
  };
  const skillNow = (id: string): number => running.get(skillKeyOf(id)) ?? skillStart(id);
  // A group can be raised as a group only while every member sits at one
  // rating (p. 88) — raising one member breaks it, evening the rest up to
  // match mends it — and a specialised member keeps it broken for good
  // (p. 89). Specialisations bought with skill points count from the start.
  const specialised = new Set<string>(r.skills.filter((s) => s.pointSpec).map((s) => s.id));
  build.karma.spends.forEach((s, i) => {
    const path = `karma.spends.${i}`;
    let key: string | null = null;
    let start = 0;
    let label = '';
    switch (s.kind) {
      case 'attribute':
        key = `attr|${s.id}`;
        start = r.attributes[s.id].creation;
        label = ATTRIBUTE_LABELS[s.id] ?? s.id;
        break;
      case 'skill': {
        const row = activeSkillRow(s.id);
        if (!row) add('skill-unknown', `"${s.id}" is not a skill the tables know.`, { path: `${path}.id`, step: 8 });
        key = skillKeyOf(s.id, s.target);
        start = skillStart(s.id, s.target);
        label = row?.name ?? s.id;
        break;
      }
      case 'group': {
        const grp = skillGroupRow(s.id);
        if (!grp) add('group-unknown', `"${s.id}" is not a skill group the tables know.`, { path: `${path}.id`, step: 8 });
        key = groupKeyOf(s.id);
        start = groupById.get(grp?.id ?? s.id)?.creation ?? 0;
        label = grp?.name ?? s.id;
        if (grp) {
          const spec = grp.skills.find((member) => specialised.has(member));
          const levels = grp.skills.map((member) => skillNow(member));
          const level = levels.every((n) => n === levels[0]) ? (levels[0] ?? 0) : null;
          if (spec) {
            add('group-raise-broken', `${grp.name} cannot be raised as a group: ${activeSkillRow(spec)?.name ?? spec} is specialised.`, {
              path,
            });
          } else if (level === null) {
            add(
              'group-raise-broken',
              `${grp.name} cannot be raised as a group while its skills differ: ${grp.skills.map((m, n) => `${activeSkillRow(m)?.name ?? m} ${levels[n]}`).join(', ')}.`,
              { path },
            );
          } else {
            // Members evened up one by one carry the group to their rating;
            // a legal group raise carries every member with it.
            if (level > (running.get(key) ?? start)) running.set(key, level);
            if (s.to > level) for (const member of grp.skills) running.set(skillKeyOf(member), s.to);
          }
        }
        break;
      }
      case 'knowledge': {
        key = `knowledge|${s.name.toLowerCase()}`;
        start = knowledgeByName.get(lcName(s.name))?.creation ?? 0;
        label = s.name;
        if (!knowledgeEntered.has(lcName(s.name)) && !s.category) {
          add('knowledge-category-missing', `Give ${s.name} a knowledge category.`, { path });
        }
        break;
      }
      case 'language':
        key = `language|${s.name.toLowerCase()}`;
        start = languageByName.get(lcName(s.name))?.creation ?? 0;
        label = s.name;
        break;
      case 'specialization': {
        if (s.list === 'active' && !activeSkillRow(s.id) && skillGroupRow(s.id)) {
          add('spec-on-group', 'A skill group takes no specialisation; pick one of its skills.', { path });
          break;
        }
        const rating =
          s.list === 'active'
            ? (skillById.get(activeSkillRow(s.id)?.id ?? s.id)?.rating ?? 0)
            : s.list === 'knowledge'
              ? (knowledgeByName.get(lcName(s.id))?.rating ?? 0)
              : (languageByName.get(lcName(s.id))?.rating ?? 0);
        if (rating <= 0) {
          add('spec-without-skill', `${activeSkillRow(s.id)?.name ?? s.id} needs a rating before it can be specialised.`, {
            path,
            step: 8,
          });
        }
        if (s.list === 'active') specialised.add(activeSkillRow(s.id)?.id ?? s.id);
        break;
      }
      default:
        break;
    }
    // Only raises chain; a specialisation, spell or spirit has no rating to start from.
    if (key === null || !('from' in s)) return;
    const current = running.get(key) ?? start;
    if (s.to <= s.from) {
      add('karma-spend-no-raise', `${label}: ${s.from} → ${s.to} raises nothing.`, { path });
    } else if (s.from !== current) {
      add('karma-spend-stale', `${label} is ${current} now, not ${s.from}; redo this raise.`, { path });
    }
    running.set(key, Math.max(current, s.to));
  });

  // Contacts (p. 98).
  build.karma.contacts.forEach((c, i) => {
    const path = `karma.contacts.${i}`;
    const k = t.contactKarma[i] ?? 0;
    if (k < CREATION_CONTACT_RULES.minKarmaPerContact) {
      add('contact-karma-min', `${c.name || 'A contact'} needs at least Connection 1 and Loyalty 1.`, { path });
    }
    if (k > CREATION_CONTACT_RULES.maxKarmaPerContact) {
      add('contact-karma-max', `${c.name || 'A contact'} costs ${k} Karma; 7 is the most at creation.`, { path });
    }
    if (!c.name.trim()) add('contact-unnamed', 'Name this contact.', { path: `${path}.name` });
  });
  const ck = pools.contactKarma;
  if (ck.remaining < 0) {
    add('contact-karma-from-karma', `Contacts take ${plural(-ck.remaining, 'Karma', 'Karma')} past the free pool.`, {
      path: 'karma.contacts',
    });
  } else if (ck.remaining > 0 && build.karma.contacts.length > 0) {
    add('contact-karma-unspent', `${plural(ck.remaining, 'free contact Karma', 'free contact Karma')} unspent.`, {
      path: 'karma.contacts',
    });
  }

  // Spirits, sprites, foci (p. 98).
  const cha = r.attributes.cha.rating;
  const spirits = build.karma.spends.filter((s) => s.kind === 'spirit').length;
  if (spirits > 0 && !summonsSpirits(build.magic)) {
    add('spirits-not-summoner', `${KIND_LABELS[build.magic.kind]} cannot bind spirits.`, { path: 'karma.spends' });
  } else if (spirits > cha) {
    add('spirits-over-charisma', `${plural(spirits, 'bound spirit')}; Charisma ${cha} allows ${cha}.`, { path: 'karma.spends' });
  }
  const sprites = build.karma.spends.filter((s) => s.kind === 'sprite').length;
  if (sprites > 0 && build.magic.kind !== 'technomancer') {
    add('sprites-not-technomancer', 'Only technomancers register sprites.', { path: 'karma.spends' });
  } else if (sprites > cha) {
    add('sprites-over-charisma', `${plural(sprites, 'registered sprite')}; Charisma ${cha} allows ${cha}.`, {
      path: 'karma.spends',
    });
  }
  // Initiation and submersion (p. 325, p. 259). Only a prime runner may take
  // a grade at creation (p. 64, p. 98) — Step 1 says so on screen, and this is
  // what makes the screen true. Grades are bought one at a time from 1 up,
  // because each grade's price depends on the one below it.
  const grades = build.karma.spends.flatMap((s) => (s.kind === 'initiation' ? [s.grade] : []));
  if (grades.length > 0) {
    if (!tables.preset.canInitiate) {
      add(
        'initiation-not-at-this-level',
        `A ${LEVEL_LABELS[tables.preset.id]} character does not initiate or submerge at creation.`,
        { path: 'karma.spends' },
      );
    }
    if (!usesMagic(build) && !usesResonance(build)) {
      add('initiation-not-awakened', `${KIND_LABELS[build.magic.kind]} has nothing to initiate or submerge.`, {
        path: 'karma.spends',
      });
    }
    const wanted = [...new Set(grades)].sort((a, b) => a - b);
    const missing = Array.from({ length: Math.max(...wanted) }, (_, i) => i + 1).filter((g) => !wanted.includes(g));
    if (missing.length > 0 || wanted.length !== grades.length) {
      add(
        'initiation-grade-gap',
        `Grades are taken one at a time from 1: ${grades.length === wanted.length ? `grade ${missing.join(', ')} is not paid for` : 'a grade is paid for twice'}.`,
        { path: 'karma.spends' },
      );
    }
  }

  const fociCap = t.magic * FOCUS_LIMITS.creationForcePerMagic;
  if (t.fociForce > fociCap) {
    add('foci-force-over', `Bonded foci total Force ${t.fociForce}; Magic ${t.magic} allows ${fociCap}.`, {
      path: 'karma.spends',
    });
  }
  // Each bond: a type the Focus Table prices (p. 318), the Karma it prices, and
  // a focus the character bought to bond (p. 94) — never Karma alone.
  const owned = focusPurchaseMatches(build);
  build.karma.spends.forEach((s, i) => {
    if (s.kind !== 'focus') return;
    const line = owned[i] == null ? undefined : build.purchases[owned[i]];
    // The label, the name and the line bought must agree on one type. The
    // budget prices the dearer of label and name meanwhile (`focusSpendType`),
    // so a disagreement never bonds on the cheap.
    const read = focusTypesOf(s.focusType, s.name, line?.name);
    const type = focusSpendType(s);
    if (read.length > 1) {
      add(
        'focus-type-mismatch',
        `${s.name} reads as ${read.map((t) => `a ${t} focus`).join(' and as ')}; say which it is.`,
        { path: `karma.spends.${i}.focusType` },
      );
    }
    if (!type) {
      add('focus-type-unknown', `Say what kind of focus ${s.name} is (spell, spirit, power, weapon, qi, enchanting, metamagic).`, {
        path: `karma.spends.${i}.focusType`,
      });
    } else {
      const expected = focusBondingKarma(type, s.force);
      if (s.bondKarma !== expected) {
        add('focus-bond-karma', `Bonding ${s.name} at Force ${s.force} costs ${expected} Karma, not ${s.bondKarma}.`, {
          path: `karma.spends.${i}.bondKarma`,
        });
      }
    }
    if (owned[i] === null) {
      add('focus-not-purchased', `${s.name} (Force ${s.force}) is bonded but never bought; add it to the gear.`, {
        path: `karma.spends.${i}`,
      });
    } else if (line && line.rating === null) {
      // A line that records no Force is the Force this bond gives it: its
      // Availability is read there, against the same cap as any gear (p. 94).
      const avail = purchaseAvailability({ ...line, rating: s.force });
      if (avail.value !== null && avail.value > tables.preset.maxAvailability) {
        add(
          'availability-over',
          `${line.name} at Force ${s.force} is Availability ${avail.value}; the cap is ${tables.preset.maxAvailability}.`,
          { path: `karma.spends.${i}.force`, step: 8 },
        );
      }
    }
  });
}

function finish(build: CharacterBuild, add: Add): void {
  if (build.karma.contacts.length === 0) add('contacts-missing', 'No contacts yet.', { path: 'karma.contacts' });
  if (!build.identity.background?.trim()) add('background-missing', 'No background written yet.', { path: 'identity.background' });
}

// ---------------------------------------------------------------------------
// validate()
// ---------------------------------------------------------------------------

/**
 * Every issue with a build under a campaign's settings, ordered by step. The
 * GM's decisions in `build.approvals` are applied: an approved item's issue
 * is gone, a denied one is an error.
 */
export function validate(build: CharacterBuild, settings: ChargenSettings): Issue[] {
  const t = tallyBuild(build, settings);
  const found: Issue[] = [];
  const add: Add = (code, message, options = {}) => {
    const entry = ISSUE_RULES[code];
    found.push({
      code: options.suffix ? `${code}-${options.suffix}` : code,
      severity: entry.severity,
      step: options.step ?? entry.step,
      message,
      ref: options.ref ?? entry.ref,
      ...(options.path ? { path: options.path } : {}),
    });
  };
  concept(build, settings, add);
  priorities(build, settings, t, add);
  metatypeAndAttributes(build, settings, t, add);
  magic(build, t, add);
  qualities(build, t, add);
  skills(build, t, add);
  gear(build, t, add);
  karma(build, t, add);
  finish(build, add);

  const decided: Issue[] = [];
  for (const issue of found) {
    if (issue.severity !== 'approval') {
      decided.push(issue);
      continue;
    }
    const decision = build.approvals[issue.code];
    if (decision === 'approved') continue;
    decided.push(decision === 'denied' ? { ...issue, severity: 'error', message: `${issue.message} The GM said no.` } : issue);
  }
  return decided
    .map((issue, i) => ({ issue, i }))
    .sort((x, y) => x.issue.step - y.issue.step || x.i - y.i)
    .map(({ issue }) => issue);
}
