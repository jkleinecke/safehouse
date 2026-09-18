/**
 * Who the runner is: the four identity fields on Step 1, as pure edits
 * (FR3.9, docs/CHARGEN.md §4.4 Step 1 "alias, real name, age"; §8.3
 * `identity`).
 *
 * The alias is the one thing Step 1 needs, and the validator says so
 * (`alias-missing`); the rest are optional and stay out of the record until a
 * player types something. The edits are written for a controlled field that
 * saves on every keystroke, which rules out the obvious tidy-ups:
 *
 * - Nothing is trimmed as it is typed — "Kestrel " on the way to "Kestrel
 *   Vane" must survive the render. The validator already reads the alias
 *   trimmed, so a name of spaces is still missing.
 * - An optional field emptied is removed, not kept as `''`, so a record that
 *   never had a real name and one whose real name was typed and deleted are
 *   the same record (and the same autosave).
 * - Age takes digits only. A number input would report `''` for a half-typed
 *   value and wipe the age under the player's thumb; a text field with a
 *   numeric keyboard keeps what was typed and drops anything that is not a
 *   digit.
 *
 * Pure, no JSX.
 */
import type { BuildIdentity, CharacterBuild, Issue } from '@safehouse/contracts';

/** The contract's name length (`Name` in contracts' build.ts). */
export const IDENTITY_TEXT_MAX = 200;
/** Three digits is every age a runner has had. */
export const AGE_MAX_DIGITS = 3;

export type IdentityTextField = 'alias' | 'realName' | 'sex';

/** The field set, as an updater's body. The alias is always a string; an optional field emptied goes away. */
export function setIdentityText(build: CharacterBuild, field: IdentityTextField, raw: string): CharacterBuild {
  const value = raw.slice(0, IDENTITY_TEXT_MAX);
  if (field === 'alias') {
    if (build.identity.alias === value) return build;
    return { ...build, identity: { ...build.identity, alias: value } };
  }
  if ((build.identity[field] ?? '') === value) return build;
  const identity: BuildIdentity = { ...build.identity };
  if (value === '') delete identity[field];
  else identity[field] = value;
  return { ...build, identity };
}

/** Digits typed into the age field as an age, or null when there are none. */
export function parseAge(raw: string): number | null {
  const digits = raw.replace(/\D/g, '').slice(0, AGE_MAX_DIGITS);
  return digits === '' ? null : Number.parseInt(digits, 10);
}

/** The age field set: a whole number, or no age at all. */
export function setIdentityAge(build: CharacterBuild, raw: string): CharacterBuild {
  const age = parseAge(raw);
  if ((build.identity.age ?? null) === age) return build;
  const identity: BuildIdentity = { ...build.identity };
  if (age === null) delete identity.age;
  else identity.age = age;
  return { ...build, identity };
}

/** What the age field shows. */
export function ageText(age: number | null | undefined): string {
  return age === null || age === undefined ? '' : String(age);
}

/** The validator's word that the alias is missing, when it is. */
export function aliasIssue(issues: readonly Issue[]): Issue | null {
  return issues.find((i) => i.code === 'alias-missing') ?? null;
}

export interface IdentityLine {
  field: IdentityTextField | 'age';
  label: string;
  value: string;
}

/** The four fields as a read-only view shows them; "not given" rather than a blank. */
export function identityLines(identity: BuildIdentity): IdentityLine[] {
  const text = (v: string | undefined) => (v && v.trim() ? v.trim() : 'not given');
  return [
    { field: 'alias', label: 'Alias', value: text(identity.alias) },
    { field: 'realName', label: 'Real name', value: text(identity.realName) },
    { field: 'age', label: 'Age', value: identity.age === null || identity.age === undefined ? 'not given' : String(identity.age) },
    { field: 'sex', label: 'Sex', value: text(identity.sex) },
  ];
}
