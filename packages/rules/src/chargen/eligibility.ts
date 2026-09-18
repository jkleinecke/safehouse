/**
 * Who may take which skill and which skill group at creation (FR3.9,
 * docs/CHARGEN.md §4.4 Step 6, §8.4, §8.6).
 *
 * Step 6 greys the skills and groups a character cannot take, the validator
 * refuses them, and a concept card must not suggest them. Those are three
 * readers of one set of fences, so the fences live here once and each
 * reader asks:
 *
 * - Magic skills and groups need a magic-using type with a Magic rating;
 *   Resonance skills and the Tasking group are a technomancer's (p. 89).
 * - An aspected magician keeps only its aspect's group of the three magical
 *   ones, and an adept none of them (p. 69).
 * - Assensing needs astral perception: a magician's or aspected magician's
 *   own, an adept's or mystic adept's Astral Perception power, or a
 *   metatype's racial trait (p. 142).
 * - Incompetent closes the group it names, members and all — the character
 *   cannot grasp them (p. 81); Uncouth closes the social groups as groups,
 *   and its skills are still bought one by one at double cost (p. 85).
 *
 * The answer names the rule that says no — the validator's issue code and
 * its page — so the UI can show the reason with a "why?" link and never
 * restates a rule the engine already knows. Arcana is not restricted (§8.4).
 *
 * Pure — no I/O. Numbers, ids and page refs only (DESIGN.md §14).
 */
import type { CharacterBuild, ChargenSettings, MagicAspect, MagicKind, Ref } from '@safehouse/contracts';
import { hasRacialTrait, metatypeRow } from './metatypes.js';
import { SR5 } from './pages.js';
import { MAGIC_KIND_TABLE } from './priority.js';
import { QUALITY_RULE_BY_ID } from './qualityRules.js';
import { qualityEffects, ratings } from './ratings.js';
import {
  MAGICAL_SKILL_GROUP_IDS,
  activeSkillRow,
  skillGroupRow,
  type ActiveSkillRow,
  type SkillGroupId,
  type SkillGroupRow,
} from './skills.js';

/** The rule that fences a skill or group off — the validator's issue code for it. */
export type EligibilityCode =
  | 'skill-unknown'
  | 'group-unknown'
  | 'skill-restricted-magic'
  | 'skill-restricted-resonance'
  | 'skill-aspect-fence'
  | 'skill-adept-fence'
  | 'assensing-needs-astral'
  | 'incompetent-skill-owned'
  | 'incompetent-group-owned'
  | 'uncouth-social-group';

/** The page each fence is printed on — the same refs as the validator's registry. */
export const ELIGIBILITY_REFS: Readonly<Record<EligibilityCode, Ref>> = {
  'skill-unknown': SR5(90),
  'group-unknown': SR5(90),
  'skill-restricted-magic': SR5(89),
  'skill-restricted-resonance': SR5(89),
  'skill-aspect-fence': SR5(69),
  'skill-adept-fence': SR5(69),
  'assensing-needs-astral': SR5(142),
  'incompetent-skill-owned': SR5(81),
  'incompetent-group-owned': SR5(81),
  'uncouth-social-group': SR5(85),
};

/**
 * Our sentence for a fence on a named skill or group — the validator's issue
 * message, and the words a step shows on a skill it greys, so the two never
 * say the same "no" differently.
 */
export function eligibilityMessage(code: EligibilityCode, name: string, build: Pick<CharacterBuild, 'magic'>): string {
  switch (code) {
    case 'skill-restricted-magic':
      return `${name} needs a Magic rating and a magic-using type.`;
    case 'skill-restricted-resonance':
      return `${name} is for technomancers only.`;
    case 'skill-aspect-fence':
      return `${name} is outside this aspected magician's ${build.magic.aspect ?? 'aspect'}.`;
    case 'skill-adept-fence':
      return `Adepts cannot take ${name}.`;
    case 'assensing-needs-astral':
      return 'Assensing needs astral perception (for an adept, the Astral Perception power).';
    case 'incompetent-skill-owned':
      return `Incompetent bars ${name} with the rest of its group.`;
    case 'incompetent-group-owned':
      return `Incompetent bars ${name}.`;
    case 'uncouth-social-group':
      return `Uncouth bars the ${name} group.`;
    case 'skill-unknown':
      return `"${name}" is not a skill the tables know.`;
    case 'group-unknown':
      return `"${name}" is not a skill group the tables know.`;
  }
}

export interface EligibilityReason {
  code: EligibilityCode;
  ref: Ref;
}

export interface Eligibility {
  allowed: boolean;
  /** The first rule that says no (absent when allowed). */
  code?: EligibilityCode;
  ref?: Ref;
  /** Every rule that says no, in the order above. */
  reasons: readonly EligibilityReason[];
}

/** What the fences read about a character, gathered once for a whole skill list. */
export interface EligibilityContext {
  kind: MagicKind;
  aspect: MagicAspect | null;
  /** A magic-using type's Magic rating before Essence loss; 0 for any other type. */
  magicRating: number;
  canPerceive: boolean;
  /** The group Incompetent names, closed with its members. */
  incompetentGroup: SkillGroupId | null;
  /** Groups closed as groups only (Uncouth's social groups). */
  barredGroups: readonly SkillGroupId[];
}

const magicalGroup = (group: string | null | undefined): boolean =>
  !!group && (MAGICAL_SKILL_GROUP_IDS as readonly string[]).includes(group);

/** The text a quality names its target by: `target`, or the bracketed part of the name. */
function namedTarget(q: { name: string; target?: string | undefined }): string | null {
  if (q.target && q.target.trim()) return q.target.trim();
  return /[([{]\s*([^)\]}]+?)\s*[)\]}]/.exec(q.name)?.[1] ?? null;
}

/** The fences' view of a build under a campaign's settings. */
export function eligibilityContext(
  build: CharacterBuild,
  settings?: Pick<ChargenSettings, 'table'>,
): EligibilityContext {
  const kind = build.magic.kind;
  const kindRow = MAGIC_KIND_TABLE[kind];
  const effects = qualityEffects(build);
  const meta = metatypeRow(build.metatype ?? undefined);
  const incompetent = effects.held.find((h) => h.rule?.id === 'incompetent');
  const incompetentText = incompetent ? namedTarget(incompetent.quality) : null;
  const uncouthGroups = effects.uncouth
    ? QUALITY_RULE_BY_ID.uncouth.rules.flatMap((q) => (q.kind === 'barsGroup' && q.groups !== 'chosen' ? [...q.groups] : []))
    : [];
  return {
    kind,
    aspect: kind === 'aspected' ? (build.magic.aspect ?? null) : null,
    magicRating: kindRow.attribute === 'mag' ? ratings(build, settings).attributes.mag.rating : 0,
    canPerceive:
      kindRow.astralPerception === 'innate' ||
      (kindRow.astralPerception === 'power' && build.powers.some((p) => /astral\s+perception/i.test(p.name))) ||
      (!!meta && hasRacialTrait(meta, 'astralPerception')),
    incompetentGroup: incompetentText ? (skillGroupRow(incompetentText)?.id ?? null) : null,
    barredGroups: uncouthGroups,
  };
}

function answer(codes: readonly EligibilityCode[]): Eligibility {
  const reasons = codes.map((code) => ({ code, ref: ELIGIBILITY_REFS[code] }));
  const first = reasons[0];
  return first ? { allowed: false, code: first.code, ref: first.ref, reasons } : { allowed: true, reasons };
}

/** Whether a skill row is open to a character, and if not which rules close it. */
export function skillEligibilityIn(ctx: EligibilityContext, row: ActiveSkillRow): Eligibility {
  const codes: EligibilityCode[] = [];
  if (row.restricted === 'magic' && ctx.magicRating <= 0) codes.push('skill-restricted-magic');
  if (row.restricted === 'resonance' && ctx.kind !== 'technomancer') codes.push('skill-restricted-resonance');
  if (magicalGroup(row.group) && ctx.kind === 'aspected' && ctx.aspect && row.group !== ctx.aspect) codes.push('skill-aspect-fence');
  if (magicalGroup(row.group) && ctx.kind === 'adept') codes.push('skill-adept-fence');
  if (row.id === 'assensing' && !ctx.canPerceive) codes.push('assensing-needs-astral');
  if (row.group && row.group === ctx.incompetentGroup) codes.push('incompetent-skill-owned');
  return answer(codes);
}

/** Whether a skill group row is open to a character, and if not which rules close it. */
export function groupEligibilityIn(ctx: EligibilityContext, row: SkillGroupRow): Eligibility {
  const codes: EligibilityCode[] = [];
  if (row.restricted === 'magic' && ctx.magicRating <= 0) codes.push('skill-restricted-magic');
  if (row.restricted === 'resonance' && ctx.kind !== 'technomancer') codes.push('skill-restricted-resonance');
  if (magicalGroup(row.id) && ctx.kind === 'aspected' && ctx.aspect && row.id !== ctx.aspect) codes.push('skill-aspect-fence');
  if (magicalGroup(row.id) && ctx.kind === 'adept') codes.push('skill-adept-fence');
  if (row.id === ctx.incompetentGroup) codes.push('incompetent-group-owned');
  if (ctx.barredGroups.includes(row.id)) codes.push('uncouth-social-group');
  return answer(codes);
}

/** Whether an active skill (by id or name) is open to a build — what Step 6 greys (§4.4). */
export function skillEligibility(
  build: CharacterBuild,
  settings: Pick<ChargenSettings, 'table'> | undefined,
  id: string,
): Eligibility {
  const row = activeSkillRow(id);
  return row ? skillEligibilityIn(eligibilityContext(build, settings), row) : answer(['skill-unknown']);
}

/** Whether a skill group (by id or name) is open to a build. */
export function groupEligibility(
  build: CharacterBuild,
  settings: Pick<ChargenSettings, 'table'> | undefined,
  id: string,
): Eligibility {
  const row = skillGroupRow(id);
  return row ? groupEligibilityIn(eligibilityContext(build, settings), row) : answer(['group-unknown']);
}
