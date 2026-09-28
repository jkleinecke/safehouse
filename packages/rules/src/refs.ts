/**
 * Where the core rulebook explains a thing — references, not rules.
 *
 * A reference is a book code, a printed page and the name of the section,
 * exactly what a ref chip carries (FR11.2/FR11.3). No rules text lives here
 * (DESIGN §14); the reader maps printed page → PDF page per book (FR11.1), and
 * the library's search (FR12.14) is the fallback for anything not pinned.
 *
 * Pages are the SR5 core rulebook's printed pages. Every entry names the
 * section it points at, so a chip that opens a page early or late is still
 * one flip from the heading. A skill points at the description page of its
 * skill group — the groups sit together in the Skills chapter — rather than
 * claiming a per-skill page it cannot vouch for.
 */
import type { Ref } from '@safehouse/contracts';

export interface RuleRef extends Ref {
  /** The section heading the chip stands for — "Success Tests", "Drain". */
  topic: string;
}

const SR5 = (page: number, topic: string): RuleRef => ({ book: 'SR5', page, topic });

/** The attributes chapter: one page each, all on the same spread. */
export const ATTRIBUTE_REFS: Readonly<Record<string, RuleRef>> = {
  bod: SR5(51, 'Body'),
  agi: SR5(51, 'Agility'),
  rea: SR5(51, 'Reaction'),
  str: SR5(51, 'Strength'),
  wil: SR5(51, 'Willpower'),
  log: SR5(51, 'Logic'),
  int: SR5(51, 'Intuition'),
  cha: SR5(51, 'Charisma'),
  edg: SR5(56, 'Edge'),
  ess: SR5(53, 'Essence'),
  mag: SR5(53, 'Magic'),
  res: SR5(53, 'Resonance'),
};

/** The names an attribute goes by on a sheet, a pool breakdown, or a chip. */
const ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  body: 'bod',
  agility: 'agi',
  reaction: 'rea',
  strength: 'str',
  willpower: 'wil',
  logic: 'log',
  intuition: 'int',
  charisma: 'cha',
  edge: 'edg',
  essence: 'ess',
  magic: 'mag',
  resonance: 'res',
};

/** `WIL`, `Willpower`, `wil` → `wil`; anything else → null. */
export function attributeCode(label: string): string | null {
  const key = label.trim().toLowerCase();
  if (key in ATTRIBUTE_REFS) return key;
  return ATTRIBUTE_ALIASES[key] ?? null;
}

/**
 * The general mechanics a roll can lean on, and the pages the pool lines point
 * at. The combat and modifier pages below were read off the GM's own copy of
 * the core rulebook (printed page = PDF page − 5), not remembered.
 */
export const RULE_REFS = {
  skills: SR5(128, 'Skills'),
  /** A specialization's +2 dice. */
  specialization: SR5(129, 'Specializations'),
  /** Rolling a skill you do not have: attribute − 1. */
  defaulting: SR5(130, 'Defaulting'),
  success: SR5(44, 'Success Tests'),
  opposed: SR5(45, 'Opposed Tests'),
  threshold: SR5(45, 'Thresholds'),
  extended: SR5(48, 'Extended Tests'),
  limits: SR5(47, 'Limits'),
  edge: SR5(56, 'Edge'),
  /** The +4 cap on what augmentations can add to an attribute. */
  augmentationCap: SR5(94, 'Augmentation Bonus Cap'),
  /** What to roll to notice something, and the modifiers table beside it. */
  perception: SR5(135, 'Using Perception'),
  perceptionThresholds: SR5(136, 'Perception Thresholds'),
  initiative: SR5(159, 'Initiative'),
  delaying: SR5(161, 'Delaying Actions'),
  /** The table of Free, Simple, Complex and Interrupt actions (runs onto p.163). */
  actions: SR5(162, 'Combat Actions'),
  /**
   * The Interrupt Actions heading sits at the foot of p.167; Full Defense,
   * Dodge, Block and the rest are described over the page on p.168.
   */
  interrupts: SR5(167, 'Interrupt Actions'),
  fullDefense: SR5(168, 'Full Defense'),
  damage: SR5(169, 'Damage'),
  soak: SR5(169, 'Damage Resistance'),
  armorPenetration: SR5(169, 'Armor Penetration'),
  wounds: SR5(169, 'Wound Modifiers'),
  rangedCombat: SR5(173, 'Ranged Combat'),
  /** Visibility, light and glare, wind and range read as one table. */
  environment: SR5(175, 'Environmental Modifiers'),
  /** Range is one column of the environment table; the bands are on p.185. */
  range: SR5(175, 'Range'),
  recoil: SR5(175, 'Recoil'),
  situational: SR5(176, 'Situational Modifiers'),
  fireModes: SR5(180, 'Firing Mode Table'),
  meleeCombat: SR5(184, 'Melee Combat'),
  rangeTable: SR5(185, 'Range Table'),
  /** Where the Defending section starts; its modifiers table is the next page. */
  defense: SR5(188, 'Defending in Combat'),
  defenseModifiers: SR5(189, 'Defense Modifiers'),
  /** Good and partial cover as a bonus to the defender's dice. */
  cover: SR5(190, 'Cover'),
  matrix: SR5(237, 'Matrix Actions'),
  spellcasting: SR5(281, 'Spellcasting'),
  drain: SR5(282, 'Drain'),
  /** −2 dice per spell held, from the step after Drain. */
  sustaining: SR5(282, 'Sustaining Spells'),
  combatSpells: SR5(283, 'Combat Spells'),
  summoning: SR5(300, 'Summoning'),
  /** Finding and buying gear: the Availability test and haggling over the price. */
  buyingGear: SR5(418, 'Buying Gear'),
} as const;

export type RuleTopic = keyof typeof RULE_REFS;

/**
 * A rule reference in the shape a pool line or a modifier carries it
 * (`ProvenanceEntry.ref`, `Modifier.bookRef`): the book and the printed page,
 * with the section's name riding in `note` so the chip's tooltip can say what
 * it opens. The engine stamps these on the lines it writes itself — wounds,
 * the scene's environment, range, recoil, cover, sustaining — so every buff
 * and debuff on a pool can show its page.
 */
export function lineRef(topic: RuleTopic): Ref {
  const r = RULE_REFS[topic];
  return { book: r.book, page: r.page, note: r.topic };
}

/** Skill groups as the Skills chapter lays them out, and the page each starts on. */
export const SKILL_GROUP_REFS = {
  combat: SR5(130, 'Combat Active Skills'),
  physical: SR5(132, 'Physical Active Skills'),
  social: SR5(133, 'Social Active Skills'),
  magical: SR5(134, 'Magical Active Skills'),
  resonance: SR5(135, 'Resonance Active Skills'),
  technical: SR5(136, 'Technical Active Skills'),
  vehicle: SR5(138, 'Vehicle Active Skills'),
} as const;

export type SkillGroup = keyof typeof SKILL_GROUP_REFS;

const GROUPS: Readonly<Record<SkillGroup, readonly string[]>> = {
  combat: [
    'archery',
    'automatics',
    'blades',
    'clubs',
    'exotic-melee',
    'exotic-ranged',
    'heavy-weapons',
    'longarms',
    'pistols',
    'throwing-weapons',
    'unarmed-combat',
  ],
  physical: [
    'disguise',
    'diving',
    'escape-artist',
    'free-fall',
    'gymnastics',
    'palming',
    'perception',
    'running',
    'sneaking',
    'survival',
    'swimming',
    'tracking',
  ],
  social: [
    'con',
    'etiquette',
    'impersonation',
    'instruction',
    'intimidation',
    'leadership',
    'negotiation',
    'performance',
  ],
  magical: [
    'alchemy',
    'arcana',
    'artificing',
    'assensing',
    'astral-combat',
    'banishing',
    'binding',
    'counterspelling',
    'disenchanting',
    'ritual-spellcasting',
    'spellcasting',
    'summoning',
  ],
  resonance: ['compiling', 'decompiling', 'registering'],
  technical: [
    'aeronautics-mechanic',
    'animal-handling',
    'armorer',
    'artisan',
    'automotive-mechanic',
    'biotechnology',
    'chemistry',
    'computer',
    'cybercombat',
    'cybertechnology',
    'demolitions',
    'electronic-warfare',
    'first-aid',
    'forgery',
    'hacking',
    'hardware',
    'industrial-mechanic',
    'locksmith',
    'medicine',
    'nautical-mechanic',
    'navigation',
    'software',
  ],
  vehicle: [
    'gunnery',
    'pilot-aircraft',
    'pilot-aerospace',
    'pilot-exotic-vehicle',
    'pilot-ground-craft',
    'pilot-walker',
    'pilot-watercraft',
  ],
};

const GROUP_OF: ReadonlyMap<string, SkillGroup> = new Map(
  (Object.keys(GROUPS) as SkillGroup[]).flatMap((g) => GROUPS[g].map((id) => [id, g] as const)),
);

/** `Unarmed Combat`, `unarmed_combat`, `unarmed-combat` → `unarmed-combat`. */
export function skillKey(skillId: string): string {
  return skillId.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

export function skillGroup(skillId: string): SkillGroup | null {
  return GROUP_OF.get(skillKey(skillId)) ?? null;
}

/** The page a skill is explained on; the Skills chapter for one the table made up. */
export function skillRef(skillId: string): RuleRef {
  const group = skillGroup(skillId);
  const base = group ? SKILL_GROUP_REFS[group] : RULE_REFS.skills;
  return { ...base, topic: `${skillId} · ${base.topic}` };
}

/** What a roll is, as far as the references care. */
export interface RollRefInput {
  /** `skill.pistols`, `weapon.Ares Predator`, `spell.Stunbolt`, `defense`, `soak`, … */
  poolRef?: string | undefined;
  /** The skill behind a weapon or a rack entry, when the caller knows it. */
  skillId?: string | undefined;
  /** Attribute labels or codes that contribute (`WIL`, `Agility`, `cha`). */
  attributes?: readonly string[] | undefined;
  /** `physical` | `mental` | `social` | `force` | `accuracy` …; present when a limit applies. */
  limitKind?: string | undefined;
  /** `threshold` for a drain or resistance roll. */
  kind?: string | undefined;
  /** Set when this is the Drain roll behind a cast. */
  drain?: boolean | undefined;
  /** Melee or ranged, when a weapon roll knows. */
  melee?: boolean | undefined;
}

/**
 * The references that explain a roll, in reading order: the thing being
 * rolled, the attributes in the pool, then the mechanics (the test, the
 * limit). Never empty — every roll is at least a Success Test.
 */
export function rollRefs(input: RollRefInput): RuleRef[] {
  const out: RuleRef[] = [];
  const add = (ref: RuleRef | null | undefined) => {
    if (ref && !out.some((r) => r.book === ref.book && r.page === ref.page && r.topic === ref.topic)) out.push(ref);
  };
  const pool = input.poolRef ?? '';
  const [head, ...rest] = pool.split('.');
  const tail = rest.join('.');

  if (input.drain) add(RULE_REFS.drain);
  // `skill.exotic-ranged-weapon::dart-pistol` is one skill with a target
  // (`skillPoolKey`); the page is the skill's, so the target comes off first.
  else if (head === 'skill' && tail) add(skillRef(tail.split('::')[0] ?? tail));
  else if (head === 'weapon') {
    if (input.skillId) add(skillRef(input.skillId));
    add(input.melee === true ? RULE_REFS.meleeCombat : input.melee === false ? RULE_REFS.rangedCombat : null);
    if (input.melee === undefined) {
      add(RULE_REFS.rangedCombat);
      add(RULE_REFS.meleeCombat);
    }
  } else if (head === 'spell') add(RULE_REFS.spellcasting);
  else if (head === 'defense') add(RULE_REFS.defense);
  else if (head === 'soak') add(RULE_REFS.soak);
  else if (head === 'initiative') add(RULE_REFS.initiative);
  else if (input.skillId) add(skillRef(input.skillId));

  for (const label of input.attributes ?? []) {
    const code = attributeCode(label);
    if (code) add(ATTRIBUTE_REFS[code]);
  }

  if (input.kind === 'threshold' && !input.drain) add(RULE_REFS.threshold);
  add(RULE_REFS.success);
  if (input.limitKind) add(RULE_REFS.limits);
  return out;
}
