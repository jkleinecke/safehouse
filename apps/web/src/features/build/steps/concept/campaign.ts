/**
 * What the campaign's creation level and priority table mean, in numbers
 * (FR3.9, docs/CHARGEN.md §4.4 Step 1 "the creation level the campaign runs
 * … set by the GM, shown not chosen").
 *
 * A player on Step 1 cannot change the level, but they need to know what it
 * does before they spend anything: "prime" is a word, "35 Karma and gear up to
 * Availability 15" is a plan. Every number here is the engine's —
 * `effectiveTables` already lays the campaign's own caps and carry-over over
 * the level's preset, and picks the quality cap the settings choose — so the
 * screen shows exactly what the rail and the validator will hold the build to,
 * including a GM's house caps. The priority table's line reads the one place
 * the two printings differ, the technomancer's row, straight off
 * `magicPriorityOption`.
 *
 * The build records the level and table it was started at, and the validator
 * warns when the campaign has moved on since (`level-mismatch`,
 * `table-mismatch`). The numbers already follow the campaign; bringing the
 * record in line is one field set, offered on this step (`matchCampaign`).
 *
 * Pure, no JSX. Our own words; numbers and page refs only (DESIGN.md §14).
 */
import {
  PRIORITY_LEVELS,
  type CharacterBuild,
  type ChargenSettings,
  type CreationLevel,
  type Issue,
  type PriorityTable,
  type Ref,
} from '@safehouse/contracts';
import { PRIORITY_CHARTS, effectiveTables, magicPriorityOption } from '@safehouse/rules';
import { formatNuyen } from '../../lib.js';

/** What the level is called on screen. */
export const LEVEL_NAMES: Readonly<Record<CreationLevel, string>> = {
  street: 'Street level',
  experienced: 'Experienced',
  prime: 'Prime runner',
};

/** One line on what the level is for, in our words. */
export const LEVEL_PITCH: Readonly<Record<CreationLevel, string>> = {
  street: 'A leaner start: less Karma, less money and tighter caps on gear.',
  experienced: 'The standard start for a runner new to the table.',
  prime: 'A seasoned start: more Karma, more money and better gear in reach.',
};

/** What the priority table is called on screen. */
export const TABLE_NAMES: Readonly<Record<PriorityTable, string>> = {
  sr5: 'Core priority table',
  rf: 'Revised priority table',
};

export interface CampaignFact {
  key: string;
  label: string;
  value: string;
}

export interface LevelFacts {
  level: CreationLevel;
  name: string;
  pitch: string;
  facts: CampaignFact[];
  ref: Ref;
}

/** The level's numbers as this campaign runs them: starting Karma, caps, money and carry-over. */
export function levelFacts(build: CharacterBuild, settings: ChargenSettings): LevelFacts {
  const { level, chart, preset } = effectiveTables(build, settings);
  const top = chart.A.resources[level];
  const bottom = chart.E.resources[level];
  return {
    level,
    name: LEVEL_NAMES[level],
    pitch: LEVEL_PITCH[level],
    ref: preset.ref,
    facts: [
      { key: 'karma', label: 'Starting Karma', value: String(preset.karma) },
      { key: 'availability', label: 'Highest Availability', value: String(preset.maxAvailability) },
      { key: 'device', label: 'Highest device rating', value: String(preset.maxDeviceRating) },
      { key: 'resources', label: 'Starting nuyen', value: `${formatNuyen(bottom)} at E to ${formatNuyen(top)} at A` },
      { key: 'qualities', label: 'Quality Karma', value: `up to ${preset.qualityCap} positive and ${preset.qualityCap} negative` },
      {
        key: 'toNuyen',
        label: 'Karma into nuyen',
        value: `up to ${preset.karmaToNuyenMax}, at ${formatNuyen(preset.nuyenPerKarma)} each`,
      },
      { key: 'carry', label: 'Carried into play', value: `${preset.karmaCarry} Karma and ${formatNuyen(preset.nuyenCarry)}` },
      { key: 'contacts', label: 'Contact Karma', value: `Charisma × ${preset.contactKarmaPerCharisma}` },
      { key: 'initiation', label: 'Initiation at creation', value: preset.canInitiate ? 'allowed' : 'not at this level' },
    ],
  };
}

export interface TableFacts {
  table: PriorityTable;
  name: string;
  /** "A: 3 skills at 5, 7 forms" for each row that offers a technomancer. */
  rows: CampaignFact[];
  ref: Ref;
}

/** The priority table the campaign uses, read where the printings differ: the technomancer's row. */
export function tableFacts(settings: Pick<ChargenSettings, 'table'>): TableFacts {
  const { table } = settings;
  const rows: CampaignFact[] = [];
  for (const level of PRIORITY_LEVELS) {
    const option = magicPriorityOption(table, level, 'technomancer');
    if (!option) continue;
    const skills = option.skills
      ? `${option.skills.count} ${option.skills.count === 1 ? 'skill' : 'skills'} at ${option.skills.rating}`
      : 'no free skills';
    const forms = `${option.forms} complex ${option.forms === 1 ? 'form' : 'forms'}`;
    rows.push({ key: level, label: `Priority ${level}`, value: `${skills}, ${forms}` });
  }
  return { table, name: TABLE_NAMES[table], rows, ref: PRIORITY_CHARTS[table].A.ref };
}

/** The validator's warnings that the build was started at another level or on another table. */
export function mismatchIssues(issues: readonly Issue[]): Issue[] {
  return issues.filter((i) => i.code === 'level-mismatch' || i.code === 'table-mismatch');
}

/** The build's record of its level and table brought in line with the campaign's. Nothing else changes. */
export function matchCampaign(build: CharacterBuild, settings: Pick<ChargenSettings, 'level' | 'table'>): CharacterBuild {
  if (build.level === settings.level && build.table === settings.table) return build;
  return { ...build, level: settings.level, table: settings.table };
}
