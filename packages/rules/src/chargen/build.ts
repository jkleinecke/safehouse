/**
 * Starting and editing a build (FR3.9, docs/CHARGEN.md §4.4): the empty
 * draft, and the few updates whose correctness is not just "set a field".
 *
 * Every function returns a new `CharacterBuild` and leaves its input alone,
 * so the walkthrough can hold the record in state, autosave it, and undo by
 * keeping the previous value. They are deliberately few. Most edits are a
 * field set the UI does itself; these are the ones with a rule inside:
 *
 * - `setPriority` keeps the five columns on five different rows under the
 *   Priority method (§4.4 Step 2: "a label can sit in only one slot") by
 *   swapping the level out of whichever column held it; under Sum to Ten
 *   rows may repeat, so it only sets.
 * - `setMetatype` and `setMagicKind` change the choice and nothing
 *   downstream — "nothing is lost by going back" (§4.4): points spent later
 *   stay, and the validator says what the change broke. `setMagicKind` only
 *   drops the aspect when the kind is no longer aspected, since an aspect
 *   means nothing on any other kind.
 * - `clearSpend` empties every choice the steps make and keeps the runner's
 *   identity — "start from nothing".
 *
 * Pure — no I/O. No book text (DESIGN.md §14).
 */
import {
  CharacterBuildSchema,
  type AttributeCode,
  type BuildIdentity,
  type BuildMethod,
  type CharacterBuild,
  type ChargenSettings,
  type KarmaSpend,
  type MagicKind,
  type PriorityColumn,
  type PriorityLevel,
  type SpecialAttributeCode,
} from '@safehouse/contracts';

/** A fresh draft at the campaign's level and priority table, with whatever identity is known. */
export function emptyBuild(
  settings: Pick<ChargenSettings, 'level' | 'table'>,
  identity: Partial<BuildIdentity> = {},
): CharacterBuild {
  return CharacterBuildSchema.parse({
    v: 1,
    level: settings.level,
    table: settings.table,
    identity: { alias: '', ...identity },
  });
}

/**
 * Put a priority level on a column. Under the Priority method a level sits
 * in one column only, so the column that held it takes this column's old
 * level (or is emptied). `null` clears the slot.
 */
export function setPriority(build: CharacterBuild, column: PriorityColumn, level: PriorityLevel | null): CharacterBuild {
  const priorities = { ...build.priorities };
  const previous = priorities[column];
  if (build.method === 'priority' && level !== null) {
    for (const other of Object.keys(priorities) as PriorityColumn[]) {
      if (other !== column && priorities[other] === level) priorities[other] = previous;
    }
  }
  priorities[column] = level;
  return { ...build, priorities };
}

/**
 * Switch between Priority and Sum to Ten. Moving to Priority empties any
 * column that repeats an earlier column's level, so the record is never left
 * in a state its method forbids without a slot showing it.
 */
export function setMethod(build: CharacterBuild, method: BuildMethod): CharacterBuild {
  if (method === build.method) return build;
  if (method === 'sumToTen') return { ...build, method };
  const priorities = { ...build.priorities };
  const used = new Set<PriorityLevel>();
  for (const column of Object.keys(priorities) as PriorityColumn[]) {
    const level = priorities[column];
    if (level === null) continue;
    if (used.has(level)) priorities[column] = null;
    else used.add(level);
  }
  return { ...build, method, priorities };
}

/**
 * The record with every section of its spend back to the empty draft's —
 * priorities, metatype, special and attribute points, magic and its grants,
 * powers, qualities, skills, purchases, lifestyles and Karma — while who the
 * runner is (identity), how it is built (method, level, table), where the
 * walkthrough stands and the GM's fields stay. This is "start from nothing"
 * (§4.4 Step 1: "an empty build and the nine steps"), the blank card's whole
 * effect in `applyConcept`.
 */
export function clearSpend(build: CharacterBuild): CharacterBuild {
  const empty = emptyBuild(build);
  return {
    ...build,
    priorities: empty.priorities,
    metatype: empty.metatype,
    special: empty.special,
    attributes: empty.attributes,
    magic: empty.magic,
    grants: empty.grants,
    powers: empty.powers,
    qualities: empty.qualities,
    skills: empty.skills,
    purchases: empty.purchases,
    lifestyles: empty.lifestyles,
    karma: empty.karma,
  };
}

/** Choose (or clear) the metatype. Nothing else changes. */
export function setMetatype(build: CharacterBuild, metatype: string | null): CharacterBuild {
  return { ...build, metatype };
}

/** Choose the magic kind; the aspect goes when the kind is no longer aspected. */
export function setMagicKind(build: CharacterBuild, kind: MagicKind): CharacterBuild {
  const { aspect, ...rest } = build.magic;
  return { ...build, magic: kind === 'aspected' && aspect ? { ...rest, kind, aspect } : { ...rest, kind } };
}

/** Attribute points on one of the eight, never below zero. */
export function setAttributePoints(build: CharacterBuild, id: AttributeCode, points: number): CharacterBuild {
  return { ...build, attributes: { ...build.attributes, [id]: Math.max(0, Math.trunc(points)) } };
}

/** Special attribute points on Edge, Magic or Resonance, never below zero. */
export function setSpecialPoints(build: CharacterBuild, id: SpecialAttributeCode, points: number): CharacterBuild {
  return { ...build, special: { ...build.special, [id]: Math.max(0, Math.trunc(points)) } };
}

/** Power points a mystic adept bought with Karma (every `powerPoint` spend's count, p. 69). */
export function powerPointsBought(build: Pick<CharacterBuild, 'karma'>): number {
  return build.karma.spends.reduce((n, s) => n + (s.kind === 'powerPoint' ? s.count : 0), 0);
}

/**
 * Buy this many power points with Karma — the one updater for it, whether
 * the Magic step's shortcut or the Karma step's stepper presses it. However
 * many purchases the record held become one spend where the first one sat,
 * so the Karma ledger neither reorders nor stacks; zero removes it.
 */
export function setPowerPointsBought(build: CharacterBuild, count: number): CharacterBuild {
  const n = Math.max(0, Math.trunc(count));
  const spends = build.karma.spends;
  if (n === powerPointsBought(build) && spends.filter((s) => s.kind === 'powerPoint').length <= 1) return build;
  const first = spends.findIndex((s) => s.kind === 'powerPoint');
  const rest = spends.filter((s) => s.kind !== 'powerPoint');
  if (n === 0) return { ...build, karma: { ...build.karma, spends: rest } };
  const at = first === -1 ? rest.length : spends.slice(0, first).filter((s) => s.kind !== 'powerPoint').length;
  const spend: KarmaSpend = { kind: 'powerPoint', count: n };
  return { ...build, karma: { ...build.karma, spends: [...rest.slice(0, at), spend, ...rest.slice(at)] } };
}
