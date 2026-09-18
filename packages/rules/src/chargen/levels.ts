/**
 * Creation levels — street, experienced, prime runner (FR3.9,
 * docs/CHARGEN.md §8.3–8.4): the numbers a GM's one choice of level moves.
 *
 * The book defines experienced as the default across Steps One to Seven and
 * the other two as a sidebar of replacements (SR5 p. 64). The part of a level
 * a campaign may override — Availability and device caps, Karma and nuyen
 * carry-over — is `CHARGEN_LEVEL_PRESETS` in contracts, the defaults of
 * `ChargenSettings`; it is spread in here rather than typed twice. The rest
 * is the level itself: starting Karma, the quality cap, the conversion cap,
 * the contact multiplier. Resources per level live on the priority rows
 * (`priority.ts`).
 *
 * One reading is ours, not the book's: street "13 Karma (maximum of 26)" and
 * prime "35 Karma (maximum of 70)" do not say what the maximum bounds. We read
 * it as the cap on positive and on negative qualities at that level — 26 and
 * 70 in place of experienced's 25 (§8.4) — and the settings expose it as the
 * `levelQualityCaps` house-rule toggle; the book's flat 25 is
 * `BOOK_QUALITY_CAP`.
 *
 * Numbers and page refs only (DESIGN.md §14).
 */
import { CHARGEN_LEVEL_PRESETS, type CreationLevel, type Ref } from '@safehouse/contracts';
import { SR5 } from './pages.js';

export interface CreationLevelPreset {
  id: CreationLevel;
  /** Karma every character starts with (p. 62 / p. 64). */
  karma: number;
  /** Most Karma of positive qualities, and separately of negative ones (p. 71; §8.4 reading at street/prime). */
  qualityCap: number;
  /** Highest gear Availability at creation (p. 94 / p. 64). */
  maxAvailability: number;
  /** Highest device rating at creation (p. 94 / p. 64). */
  maxDeviceRating: number;
  /** Most Karma that may be converted to nuyen (p. 94 / p. 64). */
  karmaToNuyenMax: number;
  /** Nuyen per converted Karma point (p. 94). */
  nuyenPerKarma: number;
  /** Most Karma carried into play (p. 98). */
  karmaCarry: number;
  /** Most unspent nuyen carried into play (p. 94). */
  nuyenCarry: number;
  /** Free contact Karma = Charisma × this (p. 98 / p. 64). */
  contactKarmaPerCharisma: number;
  /** Whether initiation or submersion may be bought at creation (p. 98 / p. 64). */
  canInitiate: boolean;
  ref: Ref;
}

/** The quality cap the book states for every character (p. 71), whatever the level. */
export const BOOK_QUALITY_CAP = 25;

const NUYEN_PER_KARMA = 2_000;

export const CREATION_LEVEL_PRESETS: Readonly<Record<CreationLevel, CreationLevelPreset>> = {
  street: {
    id: 'street',
    karma: 13,
    qualityCap: 26,
    ...CHARGEN_LEVEL_PRESETS.street,
    karmaToNuyenMax: 5,
    nuyenPerKarma: NUYEN_PER_KARMA,
    contactKarmaPerCharisma: 3,
    canInitiate: false,
    ref: SR5(64),
  },
  experienced: {
    id: 'experienced',
    karma: 25,
    qualityCap: BOOK_QUALITY_CAP,
    ...CHARGEN_LEVEL_PRESETS.experienced,
    karmaToNuyenMax: 10,
    nuyenPerKarma: NUYEN_PER_KARMA,
    contactKarmaPerCharisma: 3,
    canInitiate: false,
    ref: SR5(62),
  },
  prime: {
    id: 'prime',
    karma: 35,
    qualityCap: 70,
    ...CHARGEN_LEVEL_PRESETS.prime,
    karmaToNuyenMax: 25,
    nuyenPerKarma: NUYEN_PER_KARMA,
    contactKarmaPerCharisma: 6,
    canInitiate: true,
    ref: SR5(64),
  },
};

/**
 * Contact purchases at creation (p. 98): Connection and Loyalty each at least
 * 1, one Karma per point, so 2 to 7 Karma per contact; no limit on how many.
 */
export const CREATION_CONTACT_RULES = {
  minConnection: 1,
  minLoyalty: 1,
  karmaPerPoint: 1,
  minKarmaPerContact: 2,
  maxKarmaPerContact: 7,
  ref: SR5(98),
} as const;
