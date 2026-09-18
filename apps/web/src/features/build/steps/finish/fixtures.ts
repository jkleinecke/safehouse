/**
 * Invented runners for the Finish step's and the GM review's node tests
 * (DESIGN.md §14: no book characters, no book names; every item, contact and
 * line of background here is ours).
 *
 * The builds are made as the app makes them — a concept card applied to a
 * blank draft (`../../testing.ts`) — and then finished by hand the way a
 * player would: gear bought, a quality taken, Karma converted and spent on
 * contacts down to what carries, a native language, a background. The
 * result has no errors at all, so the Submit and Approve gates can be seen
 * open; `withRestricted` adds one line the rules leave to the GM. Not
 * imported by app code.
 */
import { CharacterBuildSchema, type CharacterBuild, type CharacterBuildInput } from '@safehouse/contracts';
import { issuesForStep, toStep } from '../../lib.js';
import { BUILD_ID, CAMPAIGN, SETTINGS, analysisOf, conceptBuild } from '../../testing.js';
import { stepMeta } from '../meta.js';
import { inertActions, type BuildActions, type StepProps } from '../types.js';

type PurchaseInput = NonNullable<CharacterBuildInput['purchases']>[number];

const CARBINE: PurchaseInput = {
  list: 'weapons',
  kind: 'weapon',
  name: 'Sparrow Carbine',
  cost: 900,
  avail: '6',
  item: { name: 'Sparrow Carbine', skillId: 'automatics', acc: 5, dv: '8P', ap: -1, modes: ['SA', 'BF'] },
};

const LONGCOAT: PurchaseInput = {
  list: 'armor',
  kind: 'armor',
  name: 'Canvas Longcoat',
  cost: 700,
  avail: '2',
  item: { name: 'Canvas Longcoat', rating: 9, worn: true },
};

const TENDONS: PurchaseInput = {
  list: 'augments',
  kind: 'augmentation',
  name: 'Wire Tendons',
  cost: 4000,
  essence: 0.2,
  avail: '4',
  item: {
    name: 'Wire Tendons',
    essence: 0.2,
    mods: [{ id: 'fixture-tendons', source: { kind: 'cyberware' }, target: 'attr.agi', op: 'add', value: 1, active: true }],
  },
};

/** A line the rules leave to the GM: Restricted Availability. */
export const LOCKPICKS: PurchaseInput = {
  list: 'gear',
  kind: 'gear',
  name: 'Lockpick Roll',
  cost: 400,
  avail: '8R',
  item: { name: 'Lockpick Roll' },
};

/** A street muscle with nothing left to fix: every pool spent, the Karma spent down to none. */
export function readyBuild(alias = 'Kestrel Vane'): CharacterBuild {
  const base = conceptBuild('muscle', alias);
  return CharacterBuildSchema.parse({
    ...base,
    purchases: [CARBINE, LONGCOAT, TENDONS],
    // Picked from the books (a catalogue id), so it is not a hand-written line waiting on the GM.
    qualities: [{ name: 'Steady Nerve', catalogueId: 'q-steady-nerve', type: 'positive', karma: 4, rating: null, mods: [] }],
    skills: { ...base.skills, languages: [{ name: 'Cityspeak', native: true, points: 0, skillPoints: 0 }] },
    karma: {
      ...base.karma,
      toNuyen: 10,
      contacts: [
        { name: 'Old Friend', role: 'fixer', connection: 4, loyalty: 3 },
        { name: 'Dock Boss', role: 'foreman', connection: 4, loyalty: 3 },
      ],
    },
    identity: { ...base.identity, background: 'Grew up hauling crates on the night docks.' },
    step: 9,
  });
}

/** The ready runner plus one Restricted line waiting on the GM. */
export function withRestricted(build: CharacterBuild = readyBuild()): CharacterBuild {
  return CharacterBuildSchema.parse({ ...build, purchases: [...build.purchases, LOCKPICKS] });
}

/** The code the validator gives the Restricted line (its suffix fingerprints the line). */
export function restrictedCode(build: CharacterBuild): string {
  // Read without decisions: an approved line's issue is gone from the build's own list.
  const issue = analysisOf({ ...build, approvals: {} }).issues.find((i) => i.code.startsWith('approval-gear-lockpick-roll'));
  if (!issue) throw new Error('no restricted line on this build');
  return issue.code;
}

/** `StepProps` for step 9 over a build, as the shell would hand them. */
export type FinishPropsOver = Omit<Partial<StepProps>, 'actions'> & { actions?: Partial<BuildActions> };

export function finishProps(build: CharacterBuild, over: FinishPropsOver = {}): StepProps {
  const analysis = analysisOf(build);
  const step = toStep(9);
  const { actions, ...rest } = over;
  return {
    campaignId: CAMPAIGN,
    buildId: BUILD_ID,
    characterId: null,
    isOwner: true,
    meta: stepMeta(step),
    build,
    settings: SETTINGS,
    settingsFromCampaign: true,
    budgets: analysis.budgets,
    issues: issuesForStep(analysis.issues, step),
    allIssues: analysis.issues,
    status: analysis.steps[step - 1]!,
    steps: analysis.steps,
    eligibility: analysis.eligibility,
    preview: analysis.preview,
    ratings: analysis.ratings,
    probe: analysis.probe,
    update: () => undefined,
    goTo: () => undefined,
    readOnly: false,
    reviewMode: false,
    mode: 'guided',
    role: 'player',
    ...rest,
    actions: { ...inertActions(), ...actions },
  };
}
