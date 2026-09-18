/**
 * The qualities the builder must understand (FR3.9, docs/CHARGEN.md §8.1,
 * §8.4) — a short whitelist, not an effects map.
 *
 * A quality on a build is a name, a Karma figure and hand-entered modifiers
 * with the page open beside them (§6.2 option a). A handful change the rules
 * of creation itself — a raised attribute maximum, a seventh skill rank, a
 * second native language, a closed skill group, doubled costs — and those the
 * validator and the budget have to apply, so each is listed here with its
 * consequence as a typed descriptor they interpret. What the quality does in
 * play stays on the page (DESIGN.md §14): no descriptions, only numbers, ids
 * and refs.
 *
 * Names are matched after normalising, because the book spells its own
 * qualities more than one way — "Magical Resistance" in the p. 73 table and
 * "Magic Resistance" over the entry, "Dependent(s)", "Exceptional Attribute
 * [Strength]", "Focused Concentration (Rating 2)" — and catalogue rows and
 * Chummer imports add their own drift. A name matches an entry when its
 * normalised form equals an alias or starts with one followed by a word
 * (`exceptional attribute strength`).
 */
import type { KnowledgeCategory, QualityType, Ref } from '@safehouse/contracts';
import { metatypeRow, type CoreMetatypeId, type RacialTraitId } from './metatypes.js';
import { SR5 } from './pages.js';
import { ACTIVE_SKILL_BY_ID, SKILL_GROUP_TABLE, type SkillCategory, type SkillGroupId } from './skills.js';

export const QUALITY_RULE_IDS = [
  'exceptionalAttribute',
  'lucky',
  'aptitude',
  'bilingual',
  'willToLive',
  'magicResistance',
  'mentorSpirit',
  'focusedConcentration',
  'astralChameleon',
  'spiritAffinity',
  'spiritBane',
  'humanLooking',
  'elfPoser',
  'orkPoser',
  'incompetent',
  'uncouth',
  'uneducated',
  'dependents',
  'sensitiveSystem',
  'distinctiveStyle',
  'blandness',
] as const;
export type QualityRuleId = (typeof QUALITY_RULE_IDS)[number];

/** What costs double for a quality (at creation too). */
export interface DoubledCostScope {
  /** Active skills in these Skills-chapter categories. */
  skillCategories: readonly SkillCategory[];
  /** Knowledge skills in these categories. */
  knowledgeCategories: readonly KnowledgeCategory[];
  /** Whether groups whose members fall in scope double as well. */
  groups: boolean;
  /** Whether specialisations on in-scope skills double as well. */
  specializations: boolean;
}

export interface LifestyleSurchargeLevel {
  rating: number;
  /** The Karma bonus printed for this level. */
  karma: number;
  /** Lifestyle cost multiplier while the quality is held. */
  multiplier: number;
}

/**
 * The rule a whitelisted quality imposes. `kind` names the mechanic; the
 * fields are the numbers it needs. The validator switches on `kind`.
 */
export type QualityRule =
  /** One attribute's natural maximum +1 — mental, physical, Magic or Resonance; never those listed. */
  | { kind: 'attributeMaxPlusOne'; excludes: readonly 'edg'[] }
  /** Edge maximum +1; the points are still bought. */
  | { kind: 'edgeMaxPlusOne' }
  /** One active skill (not a group) may go one rating over the cap. */
  | { kind: 'skillCapPlusOne' }
  /** Another free native language; taken at creation only. */
  | { kind: 'extraNativeLanguage'; count: number; creationOnly: boolean }
  /** +1 overflow box per rating, bought at `karmaPerRating` Karma a rating. */
  | { kind: 'overflowPerRating'; max: number; karmaPerRating: number }
  /** Only for the Awakened — any Magic rating, or specifically a spellcaster or a technomancer. */
  | { kind: 'requiresAwakened'; who: 'magicRating' | 'spellcasterOrTechnomancer' }
  /** Not with any Magic rating. */
  | { kind: 'forbiddenWithMagic' }
  /** Only these metatypes (and their metavariants). */
  | { kind: 'metatypeGate'; metatypes: readonly CoreMetatypeId[] }
  /** These groups may never be owned; `chosen` = the one the player names. */
  | { kind: 'barsGroup'; groups: readonly SkillGroupId[] | 'chosen' }
  /** Karma (and, by house rule, point) costs in scope double. */
  | { kind: 'doublesCosts'; scope: DoubledCostScope }
  /** Lifestyle costs rise by the level taken. */
  | { kind: 'lifestyleMultiplierByRating'; levels: readonly LifestyleSurchargeLevel[] }
  /** Training time multiplied (advancement). */
  | { kind: 'trainingTimeMultiplier'; factor: number }
  /** Essence lost to cyberware doubles. */
  | { kind: 'cyberEssenceTimes2' }
  /** No bioware at all. */
  | { kind: 'noBioware' }
  /** Cannot be held together with these. */
  | { kind: 'exclusive'; with: readonly QualityRuleId[] };

export interface QualityRuleEntry {
  id: QualityRuleId;
  /** The name over the book's entry. */
  name: string;
  /** Normalised names that match (see `normalizeQualityName`). */
  aliases: readonly string[];
  type: QualityType;
  /**
   * May be taken only once. So is each quality whose rating the engine reads
   * (Will to Live, Dependents): the rating is how much of it is held — Will to
   * Live 3, not three lines of Will to Live 1 — so a second line could only
   * buy past the top rating or bank a level's Karma twice.
   */
  once: boolean;
  /** The book puts it to the gamemaster — the validator raises an approval issue. */
  needsApproval: boolean;
  rules: readonly QualityRule[];
  ref: Ref;
}

/** Acting and Influence: every member a social skill (what Uncouth closes, p. 85). */
const SOCIAL_GROUPS: readonly SkillGroupId[] = SKILL_GROUP_TABLE.filter((g) =>
  g.skills.every((id) => ACTIVE_SKILL_BY_ID[id].category === 'social'),
).map((g) => g.id);

const MAGIC_RATING = { kind: 'requiresAwakened', who: 'magicRating' } as const;

export const QUALITY_RULES: readonly QualityRuleEntry[] = [
  {
    id: 'exceptionalAttribute',
    name: 'Exceptional Attribute',
    aliases: ['exceptional attribute'],
    type: 'positive',
    once: true,
    needsApproval: true,
    rules: [
      { kind: 'attributeMaxPlusOne', excludes: ['edg'] },
      { kind: 'exclusive', with: ['lucky'] },
    ],
    ref: SR5(72),
  },
  {
    id: 'lucky',
    name: 'Lucky',
    aliases: ['lucky'],
    type: 'positive',
    once: true,
    needsApproval: true,
    rules: [{ kind: 'edgeMaxPlusOne' }, { kind: 'exclusive', with: ['exceptionalAttribute'] }],
    ref: SR5(76),
  },
  {
    id: 'aptitude',
    name: 'Aptitude',
    aliases: ['aptitude'],
    type: 'positive',
    once: true,
    needsApproval: false,
    rules: [{ kind: 'skillCapPlusOne' }],
    ref: SR5(72),
  },
  {
    id: 'bilingual',
    name: 'Bilingual',
    aliases: ['bilingual'],
    type: 'positive',
    once: false,
    needsApproval: false,
    rules: [{ kind: 'extraNativeLanguage', count: 1, creationOnly: true }],
    ref: SR5(72),
  },
  {
    id: 'willToLive',
    name: 'Will to Live',
    aliases: ['will to live'],
    type: 'positive',
    once: true,
    needsApproval: false,
    rules: [{ kind: 'overflowPerRating', max: 3, karmaPerRating: 3 }],
    ref: SR5(77),
  },
  {
    id: 'magicResistance',
    name: 'Magic Resistance',
    aliases: ['magic resistance', 'magical resistance'],
    type: 'positive',
    once: false,
    needsApproval: false,
    rules: [{ kind: 'forbiddenWithMagic' }],
    ref: SR5(76),
  },
  {
    id: 'mentorSpirit',
    name: 'Mentor Spirit',
    aliases: ['mentor spirit'],
    type: 'positive',
    once: true,
    needsApproval: false,
    rules: [MAGIC_RATING],
    ref: SR5(76),
  },
  {
    id: 'focusedConcentration',
    name: 'Focused Concentration',
    aliases: ['focused concentration'],
    type: 'positive',
    once: false,
    needsApproval: false,
    rules: [{ kind: 'requiresAwakened', who: 'spellcasterOrTechnomancer' }],
    ref: SR5(74),
  },
  {
    id: 'astralChameleon',
    name: 'Astral Chameleon',
    aliases: ['astral chameleon'],
    type: 'positive',
    once: false,
    needsApproval: false,
    rules: [MAGIC_RATING],
    ref: SR5(72),
  },
  {
    id: 'spiritAffinity',
    name: 'Spirit Affinity',
    aliases: ['spirit affinity'],
    type: 'positive',
    once: false,
    needsApproval: false,
    rules: [MAGIC_RATING],
    ref: SR5(77),
  },
  {
    id: 'spiritBane',
    name: 'Spirit Bane',
    aliases: ['spirit bane'],
    type: 'negative',
    once: false,
    needsApproval: false,
    rules: [MAGIC_RATING],
    ref: SR5(85),
  },
  {
    id: 'humanLooking',
    name: 'Human-Looking',
    aliases: ['human looking'],
    type: 'positive',
    once: false,
    needsApproval: false,
    rules: [{ kind: 'metatypeGate', metatypes: ['elf', 'dwarf', 'ork'] }],
    ref: SR5(75),
  },
  {
    id: 'elfPoser',
    name: 'Elf Poser',
    aliases: ['elf poser'],
    type: 'negative',
    once: false,
    needsApproval: false,
    rules: [{ kind: 'metatypeGate', metatypes: ['human'] }],
    ref: SR5(81),
  },
  {
    id: 'orkPoser',
    name: 'Ork Poser',
    aliases: ['ork poser', 'orc poser'],
    type: 'negative',
    once: false,
    needsApproval: false,
    rules: [{ kind: 'metatypeGate', metatypes: ['human', 'elf'] }],
    ref: SR5(82),
  },
  {
    id: 'incompetent',
    name: 'Incompetent',
    aliases: ['incompetent'],
    type: 'negative',
    once: true,
    needsApproval: false,
    rules: [{ kind: 'barsGroup', groups: 'chosen' }],
    ref: SR5(81),
  },
  {
    id: 'uncouth',
    name: 'Uncouth',
    aliases: ['uncouth'],
    type: 'negative',
    once: false,
    needsApproval: false,
    rules: [
      {
        kind: 'doublesCosts',
        scope: { skillCategories: ['social'], knowledgeCategories: [], groups: false, specializations: true },
      },
      { kind: 'barsGroup', groups: SOCIAL_GROUPS },
    ],
    ref: SR5(85),
  },
  {
    id: 'uneducated',
    name: 'Uneducated',
    aliases: ['uneducated'],
    type: 'negative',
    once: false,
    needsApproval: false,
    rules: [
      {
        kind: 'doublesCosts',
        scope: {
          skillCategories: ['technical'],
          knowledgeCategories: ['academic', 'professional'],
          groups: true,
          specializations: true,
        },
      },
    ],
    ref: SR5(87),
  },
  {
    id: 'dependents',
    name: 'Dependents',
    aliases: ['dependents', 'dependent'],
    type: 'negative',
    once: true,
    needsApproval: false,
    rules: [
      {
        kind: 'lifestyleMultiplierByRating',
        levels: [
          { rating: 1, karma: 3, multiplier: 1.1 },
          { rating: 2, karma: 6, multiplier: 1.2 },
          { rating: 3, karma: 9, multiplier: 1.3 },
        ],
      },
      { kind: 'trainingTimeMultiplier', factor: 1.5 },
    ],
    ref: SR5(80),
  },
  {
    id: 'sensitiveSystem',
    name: 'Sensitive System',
    aliases: ['sensitive system'],
    type: 'negative',
    once: false,
    needsApproval: false,
    rules: [{ kind: 'cyberEssenceTimes2' }, { kind: 'noBioware' }],
    ref: SR5(83),
  },
  {
    id: 'distinctiveStyle',
    name: 'Distinctive Style',
    aliases: ['distinctive style'],
    type: 'negative',
    once: true,
    needsApproval: false,
    rules: [{ kind: 'exclusive', with: ['blandness'] }],
    ref: SR5(80),
  },
  {
    id: 'blandness',
    name: 'Blandness',
    aliases: ['blandness'],
    type: 'positive',
    once: false,
    needsApproval: false,
    rules: [{ kind: 'exclusive', with: ['distinctiveStyle'] }],
    ref: SR5(72),
  },
];

export const QUALITY_RULE_BY_ID = Object.fromEntries(QUALITY_RULES.map((q) => [q.id, q])) as Readonly<
  Record<QualityRuleId, QualityRuleEntry>
>;

/**
 * A quality name reduced to what identifies it: lower case, accents off,
 * "(s)" folded in, anything from the first bracket or colon dropped, a
 * trailing rating dropped, punctuation to single spaces.
 * `Dependent(s)` → `dependents`; `Exceptional Attribute [Strength]` →
 * `exceptional attribute`; `Human-Looking` → `human looking`.
 */
export function normalizeQualityName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(s\)/g, 's')
    .replace(/[([{:].*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+\d+$/, '');
}

/** One legal rating of a whitelisted rated quality and the Karma it costs or gives at creation. */
export interface QualityRatingLevel {
  rating: number;
  karma: number;
}

/** The ratings a whitelisted rated quality comes in, lowest first. */
export interface QualityRatingRange {
  min: number;
  max: number;
  levels: readonly QualityRatingLevel[];
}

/**
 * The legal ratings of a quality whose rating the engine reads, each with its
 * Karma: Will to Live 1–3 at 3 Karma a rating (p. 77), Dependents 1–3 at 3, 6
 * or 9 (p. 80). Null for every other entry, and for a quality off the
 * whitelist — its price is the catalogue row's. A stepper over these moves
 * only through amounts the validator accepts (`quality-karma-mismatch`).
 */
export function qualityRatingRange(entry: Pick<QualityRuleEntry, 'rules'> | null | undefined): QualityRatingRange | null {
  for (const rule of entry?.rules ?? []) {
    if (rule.kind === 'overflowPerRating' && rule.max >= 1) {
      const levels = Array.from({ length: rule.max }, (_, i) => ({ rating: i + 1, karma: (i + 1) * rule.karmaPerRating }));
      return { min: 1, max: rule.max, levels };
    }
    if (rule.kind === 'lifestyleMultiplierByRating' && rule.levels.length > 0) {
      const levels = [...rule.levels].sort((a, b) => a.rating - b.rating).map((l) => ({ rating: l.rating, karma: l.karma }));
      return { min: levels[0]!.rating, max: levels[levels.length - 1]!.rating, levels };
    }
  }
  return null;
}

/** The Karma a whitelisted rated quality costs or gives at a rating; null off its range or off the whitelist. */
export function qualityKarmaFor(entry: Pick<QualityRuleEntry, 'rules'> | null | undefined, rating: number): number | null {
  return qualityRatingRange(entry)?.levels.find((l) => l.rating === rating)?.karma ?? null;
}

/** The whitelist entry a quality name refers to, or null for a quality the engine leaves to the page. */
export function qualityRuleFor(name: string): QualityRuleEntry | null {
  const key = normalizeQualityName(name);
  if (!key) return null;
  for (const entry of QUALITY_RULES) {
    if (entry.aliases.some((alias) => key === alias || key.startsWith(`${alias} `))) return entry;
  }
  return null;
}

/**
 * Whitelisted qualities a metatype is born with, keyed by the racial trait
 * that carries them: most of Run Faster's metasapients and shapeshifters are
 * Uneducated by birth (RF pp. 104–105), and pay double for the same skills a
 * human with the quality does.
 */
export const RACIAL_QUALITY_TRAITS: Readonly<Partial<Record<RacialTraitId, QualityRuleId>>> = {
  uneducated: 'uneducated',
};

/** The whitelisted qualities a metatype's racial traits carry, bought off or not. */
export function bornQualities(metatype: string | null | undefined): QualityRuleId[] {
  const row = metatypeRow(metatype ?? undefined);
  if (!row) return [];
  const out: QualityRuleId[] = [];
  for (const trait of row.traits) {
    const id = RACIAL_QUALITY_TRAITS[trait.id];
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Whether a quality line buys a racial negative quality off rather than
 * holding it: the name of a negative quality the metatype is born with,
 * recorded as positive — the Karma paid to be rid of it (RF p. 102). Anyone
 * else's positive line of a negative quality is a slip in the type, and the
 * quality's rules still hold (the validator's `quality-type-mismatch`). A line
 * with no type is held.
 */
export function isQualityBuyOff(
  quality: { readonly name: string; readonly type?: QualityType | undefined },
  metatype: string | null | undefined,
): boolean {
  const entry = qualityRuleFor(quality.name);
  return !!entry && entry.type === 'negative' && quality.type === 'positive' && bornQualities(metatype).includes(entry.id);
}

/**
 * The whitelisted qualities a metatype holds by birth and has not bought off
 * (RF p. 102): its racial traits' qualities, less any the list buys off.
 */
export function racialQualities(
  metatype: string | null | undefined,
  qualities: readonly { readonly name: string; readonly type?: QualityType | undefined }[],
): QualityRuleId[] {
  const boughtOff = new Set(qualities.filter((q) => isQualityBuyOff(q, metatype)).map((q) => qualityRuleFor(q.name)?.id));
  return bornQualities(metatype).filter((id) => !boughtOff.has(id));
}
