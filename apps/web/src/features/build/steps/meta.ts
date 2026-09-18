/**
 * The walkthrough's nine screens as the shell names them (FR3.9,
 * docs/CHARGEN.md §4.4, numbering per §8.7).
 *
 * §4.4 asks every step to open with two sentences on what the step is for and
 * one on what the book lets you do — "ours, not the book's" — plus a "why?"
 * link that opens the reader at the page. This is that copy, kept apart from
 * the step components so the progress strip, the issues list ("step 6 ·
 * Skills") and the frame all say the same thing, and so the next workflow that
 * fills the steps writes content, not chrome.
 *
 * Every sentence here is our own summary of what a screen does; the page ref
 * is where the reader opens. No book prose (DESIGN.md §14). Pure data, no JSX.
 */
import { BUILD_STEPS, type BuildMethod, type BuildStep, type BuildStepName, type Ref } from '@safehouse/contracts';
import type { RailPoolKey } from '../lib.js';

export interface StepMeta {
  step: BuildStep;
  name: BuildStepName;
  /** The screen's heading. */
  title: string;
  /** One or two words for the progress strip on a phone. */
  short: string;
  /** Two sentences: what the step is for. */
  intro: string;
  /** One sentence: what the rules let you do here. */
  allows: string;
  /**
   * The same sentence where the build method changes the rule: step 2 under
   * Sum to Ten, where rows may repeat and it is the points that bind. The
   * frame reads it through `stepMetaFor(step, method)`.
   */
  allowsByMethod?: Readonly<Partial<Record<BuildMethod, string>>>;
  /** The printed page the "why?" link opens. */
  ref: Ref;
  /**
   * The rail pools this step spends, in the order a player reads them. On a
   * phone the rail folds away, so the bottom bar shows these beside the
   * counts — a player tapping skill steppers sees "8 left" without opening
   * the sheet after every tap. Pools that do not apply to a build (power
   * points for a mundane) simply do not show.
   */
  pools: readonly RailPoolKey[];
}

const SR5 = (page: number): Ref => ({ book: 'SR5', page });

export const STEP_META: readonly StepMeta[] = [
  {
    step: 1,
    name: 'concept',
    title: 'Concept',
    short: 'Concept',
    intro:
      'Decide what kind of runner this is before any numbers come into it. A concept card suggests a priority order and a spend for every later step, and all of it stays yours to change.',
    allows: 'Only an alias is needed to move on; a card is optional, and starting from nothing is a card too.',
    ref: SR5(62),
    pools: [],
  },
  {
    step: 2,
    name: 'priorities',
    title: 'Priorities',
    short: 'Priorities',
    intro:
      'Metatype, attributes, magic or resonance, skills and resources each take one row from A to E. The row decides how much of that column the runner starts with.',
    allows: 'Each row can hold one column, so raising one column always lowers another.',
    allowsByMethod: {
      sumToTen:
        'Under Sum to Ten rows may repeat: each row costs points, A 4 down to E 0, and the five columns share ten.',
    },
    ref: SR5(65),
    pools: ['priorityPoints'],
  },
  {
    step: 3,
    name: 'metatype',
    title: 'Metatype & attributes',
    short: 'Attributes',
    intro:
      'Pick a metatype, then spend attribute points on the eight attributes and special points on Edge, Magic or Resonance. The metatype sets where each attribute starts and how high it can go.',
    allows: 'Only one attribute may start at its natural maximum, and special points left unspent are lost.',
    ref: SR5(66),
    pools: ['attributes', 'special'],
  },
  {
    step: 4,
    name: 'magic',
    title: 'Magic or Resonance',
    short: 'Magic',
    intro:
      'Choose how the runner touches magic or the Resonance, if at all, and fill the picks that choice hands over. Tradition, mentor spirit and an aspected magician’s group are chosen here too.',
    allows: 'A mundane runner skips this step; everyone else fills each grant or waives it.',
    ref: SR5(68),
    pools: ['spells', 'forms', 'powerPoints'],
  },
  {
    step: 5,
    name: 'qualities',
    title: 'Qualities',
    short: 'Qualities',
    intro:
      'Buy positive qualities and take negative ones, each side moving the Karma pool on the rail. A quality that changes the rules of creation says so and may need the GM.',
    allows: 'Each side has its own Karma cap, and the step may be passed with no qualities at all.',
    ref: SR5(71),
    pools: ['positiveQualities', 'negativeQualities', 'karma'],
  },
  {
    step: 6,
    name: 'skills',
    title: 'Skills',
    short: 'Skills',
    intro:
      'Spend skill points on active skills and group points on skill groups, then the free knowledge points on knowledge skills and languages. The two active pools never mix.',
    allows: 'Points cannot be saved for later, and no skill starts above rating 6 without a quality that says otherwise.',
    ref: SR5(88),
    pools: ['skills', 'groups', 'knowledge'],
  },
  {
    step: 7,
    name: 'gear',
    title: 'Gear',
    short: 'Gear',
    intro:
      'Spend the resources row’s nuyen on gear, augmentations and a lifestyle. Essence, and Magic for the Awakened, move on the rail as implants go in.',
    allows: 'Availability and device ratings are capped at creation, and only a little nuyen carries into play.',
    ref: SR5(94),
    pools: ['nuyen'],
  },
  {
    step: 8,
    name: 'karma',
    title: 'Karma & contacts',
    short: 'Karma',
    intro:
      'Spend the Karma that is left on raises, spells, bonded foci and the rest, with each cost shown before you take it. Contacts come from a pool of their own.',
    allows: 'The creation caps still hold here, and only a few points of Karma carry into play.',
    ref: SR5(98),
    pools: ['karma', 'contactKarma'],
  },
  {
    step: 9,
    name: 'finish',
    title: 'Finish',
    short: 'Finish',
    intro:
      'Check the runner against the creation checklist and see the sheet as it will play. When nothing is left to fix, send it to the GM.',
    allows: 'Submitting freezes the build until the GM approves it or returns it with a note.',
    ref: SR5(101),
    pools: [],
  },
];

if (STEP_META.length !== BUILD_STEPS.length) {
  throw new Error('STEP_META must name every walkthrough step');
}

export function stepMeta(step: BuildStep): StepMeta {
  return STEP_META[step - 1] ?? STEP_META[0]!;
}

/**
 * A step's copy for the method this build uses: the stock meta, with the
 * "what the rules let you do" sentence swapped where the method changes the
 * rule. Step 2's stock line — one column per row — is simply wrong under Sum
 * to Ten, where rows repeat.
 */
export function stepMetaFor(step: BuildStep, method: BuildMethod): StepMeta {
  const meta = stepMeta(step);
  const allows = meta.allowsByMethod?.[method];
  return allows && allows !== meta.allows ? { ...meta, allows } : meta;
}

/**
 * The frame's opening words for a step, fitted to where the build stands.
 * Finish's stock intro tells a player to send the runner to the GM; on a
 * build already sent, and on the GM's own review, that was the wrong
 * instruction above "Waiting for the GM". Null keeps the step's own intro.
 */
export function introFor(step: number, state: 'draft' | 'submitted' | 'returned' | 'approved', reviewMode: boolean): string | null {
  if (step !== 9) return null;
  if (reviewMode) {
    return 'Read the runner as it will play and decide what the rules leave to you. Then approve it, or send it back with a note on the step to fix.';
  }
  if (state === 'submitted') {
    return 'The runner is with the GM now, frozen as it was sent. Nothing changes until they approve it or send it back with a note.';
  }
  if (state === 'approved') return 'The GM approved this runner and it is on the roster. This is the build it was made from.';
  return null;
}
