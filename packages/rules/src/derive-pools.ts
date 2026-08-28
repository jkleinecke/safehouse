import type {
  DerivedValue,
  LimitKind,
  Modifier,
  PoolBreakdown,
  ProvenanceEntry,
  SheetV1,
  SkillAttr,
} from '@safehouse/contracts';
import { applyPipeline, baseEntry } from './derive-pipeline.js';

/** Which inherent limit a skill test uses, keyed by the skill's linked attribute. */
export function skillLimitKind(attr: SkillAttr): Exclude<LimitKind, 'accuracy' | 'force'> | null {
  switch (attr) {
    case 'bod':
    case 'agi':
    case 'rea':
    case 'str':
      return 'physical';
    case 'wil':
    case 'log':
    case 'int':
      return 'mental';
    case 'cha':
      return 'social';
    default:
      // mag / res tests are limited by Force / level, set per-cast — no static limit.
      return null;
  }
}

interface LimitsIn {
  physical: DerivedValue;
  mental: DerivedValue;
  social: DerivedValue;
}

function attrValue(attrs: Record<string, DerivedValue>, code: string): number {
  return attrs[code]?.value ?? 0;
}

/**
 * Derived armor value: highest worn armor item (SR5 wears one suit; stacking
 * accessories land as `armor`-targeted modifiers), plus `armor` modifiers.
 */
export function deriveArmor(sheet: SheetV1, mods: readonly Modifier[]): PoolBreakdown {
  const worn = sheet.armor.filter((a) => a.worn);
  let base = 0;
  const entries: ProvenanceEntry[] = [];
  if (worn.length > 0) {
    const best = worn.reduce((a, b) => (b.rating > a.rating ? b : a));
    base = best.rating;
    entries.push(baseEntry(best.name, best.rating));
  }
  const res = applyPipeline(base, entries, ['armor'], mods, { floorZero: true });
  return { total: res.value, breakdown: res.breakdown };
}

/**
 * Build every dice pool with provenance (FR3.3): one per skill, per weapon,
 * per spell, plus `defense`, `soak`, and the derived `armor` value.
 *
 * Modifier targets honored per pool: `pool.skill.<id>`, `pool.weapon.<name>`,
 * `pool.spell.<name>`, `pool.defense`, `pool.soak`, and `pool.all` (which hits
 * every pool EXCEPT `soak` and `armor` — damage-resistance tests are exempt
 * from wound/scene/sustaining penalties).
 */
export function buildPools(
  sheet: SheetV1,
  attrs: Record<string, DerivedValue>,
  limits: LimitsIn,
  mods: readonly Modifier[],
): Record<string, PoolBreakdown> {
  const pools: Record<string, PoolBreakdown> = {};

  const armor = deriveArmor(sheet, mods);
  pools['armor'] = armor;

  // Skill pools: linked attribute + rating.
  for (const skill of sheet.skills) {
    const av = attrValue(attrs, skill.attr);
    const entries: ProvenanceEntry[] = [
      { label: skill.attr.toUpperCase(), value: av, source: 'attribute' },
      { label: skill.id, value: skill.rating, source: 'skill' },
    ];
    const res = applyPipeline(
      av + skill.rating,
      entries,
      [`pool.skill.${skill.id}`, 'pool.all'],
      mods,
      { floorZero: true },
    );
    const lk = skillLimitKind(skill.attr);
    pools[`skill.${skill.id}`] = {
      total: res.value,
      breakdown: res.breakdown,
      ...(lk ? { limit: { kind: lk, value: limits[lk].value } } : {}),
    };
  }

  // Weapon pools: the weapon's skill pool (defaulting AGI−1 when the skill is
  // missing), limited by Accuracy when the sheet provides one.
  for (const weapon of sheet.weapons) {
    const skill = sheet.skills.find((s) => s.id === weapon.skillId);
    let base: number;
    const entries: ProvenanceEntry[] = [];
    if (skill) {
      const av = attrValue(attrs, skill.attr);
      base = av + skill.rating;
      entries.push(
        { label: skill.attr.toUpperCase(), value: av, source: 'attribute' },
        { label: skill.id, value: skill.rating, source: 'skill' },
      );
    } else {
      const agi = attrValue(attrs, 'agi');
      base = agi - 1;
      entries.push(
        { label: 'AGI', value: agi, source: 'attribute' },
        { label: `defaulting (no ${weapon.skillId})`, value: -1, source: 'skill' },
      );
    }
    const res = applyPipeline(
      base,
      entries,
      [`pool.weapon.${weapon.name}`, `pool.skill.${weapon.skillId}`, 'pool.all'],
      mods,
      { floorZero: true },
    );
    pools[`weapon.${weapon.name}`] = {
      total: res.value,
      breakdown: res.breakdown,
      ...(weapon.acc !== undefined
        ? { limit: { kind: 'accuracy' as const, value: weapon.acc } }
        : {}),
    };
  }

  // Spell pools: MAG + Spellcasting (skill id 'spellcasting' when present).
  // The limit is Force, chosen at cast time — no static limit attached.
  if (sheet.spells.length > 0) {
    const casting = sheet.skills.find((s) => s.id === 'spellcasting');
    const mag = attrValue(attrs, 'mag');
    for (const spell of sheet.spells) {
      const entries: ProvenanceEntry[] = [{ label: 'MAG', value: mag, source: 'attribute' }];
      let base = mag;
      if (casting) {
        base += casting.rating;
        entries.push({ label: casting.id, value: casting.rating, source: 'skill' });
      }
      const targets = [`pool.spell.${spell.name}`, 'pool.all'];
      if (casting) targets.push(`pool.skill.${casting.id}`);
      const res = applyPipeline(base, entries, targets, mods, { floorZero: true });
      pools[`spell.${spell.name}`] = { total: res.value, breakdown: res.breakdown };
    }
  }

  // Defense: REA + INT (FR10.8's baseline defense pool).
  {
    const rea = attrValue(attrs, 'rea');
    const int = attrValue(attrs, 'int');
    const res = applyPipeline(
      rea + int,
      [
        { label: 'REA', value: rea, source: 'attribute' },
        { label: 'INT', value: int, source: 'attribute' },
      ],
      ['pool.defense', 'pool.all'],
      mods,
      { floorZero: true },
    );
    pools['defense'] = { total: res.value, breakdown: res.breakdown };
  }

  // Soak: BOD + modified armor. Exempt from `pool.all` (damage resistance
  // ignores wound modifiers, sustaining and scene penalties per §10.2 soak).
  {
    const bod = attrValue(attrs, 'bod');
    const res = applyPipeline(
      bod + armor.total,
      [
        { label: 'BOD', value: bod, source: 'attribute' },
        { label: 'Armor', value: armor.total, source: 'armor' },
      ],
      ['pool.soak'],
      mods,
      { floorZero: true },
    );
    pools['soak'] = { total: res.value, breakdown: res.breakdown };
  }

  return pools;
}
