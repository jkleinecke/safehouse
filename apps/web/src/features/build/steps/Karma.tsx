/**
 * Step 8 — Karma and contacts (FR3.9, docs/CHARGEN.md §4.4 Step 8).
 *
 * What is left of the 25 (or 13, or 35) Karma after qualities and conversion
 * buys the runner's last ratings, spells, bonded foci and bound spirits, and
 * a separate pool of Charisma × 3 buys contacts. The book puts this last
 * because every price here depends on everything before it: a raise costs
 * the new rating times a multiple, so the rating the earlier steps left is
 * what is priced, and the creation caps still hold — a skill will not go to
 * 7, a second attribute will not reach its maximum.
 *
 * The screen is sections over one pure core (`karma/`):
 *
 * - the Karma left, big, with where it came from and what carries into play
 *   (the step is complete when no more than the cap is left) —
 *   `KarmaHeader`;
 * - every spend, priced and undoable in one tap, the validator's findings
 *   under the line they name — `Ledger`;
 * - attributes, active skills and groups, knowledge and languages,
 *   specialisations, and for the Awakened or Emerged spells, complex forms,
 *   power points, spirits, sprites and foci — each control quoting its price
 *   before the tap and refusing, with the engine's sentence and page, a tap
 *   that would break a creation cap or spend Karma that is not there
 *   (`karma/taps.ts`, `karma/logic.ts`);
 * - contacts, on their own pool.
 *
 * Every price is the engine's (`spendKarma` over `buildPricing`, so Uncouth
 * and Uneducated double exactly what they double); every refusal is the
 * validator's through the shell's `probe`; every edit is a pure updater
 * handed to `update`. `readOnly` and `reviewMode` render the same sections
 * without a control in them.
 */
import { useMemo } from 'react';
import { tallyBuild } from '@safehouse/rules';
import Attributes from './karma/Attributes.js';
import Contacts from './karma/Contacts.js';
import KarmaHeader from './karma/KarmaHeader.js';
import Knowledge from './karma/Knowledge.js';
import Ledger from './karma/Ledger.js';
import Magic from './karma/Magic.js';
import Skills from './karma/Skills.js';
import Specializations from './karma/Specializations.js';
import { placeIssues } from './karma/logic.js';
import { createKarmaTaps, type KarmaSectionProps } from './karma/taps.js';
import type { StepProps } from './types.js';

export default function KarmaStep(props: StepProps) {
  const { build, settings, budgets, probe, issues } = props;
  const readOnly = props.readOnly || props.reviewMode;
  const taps = useMemo(() => createKarmaTaps({ build, settings, budgets, probe }), [build, settings, budgets, probe]);
  const tally = useMemo(() => tallyBuild(build, settings), [build, settings]);
  const placed = useMemo(() => placeIssues(issues), [issues]);
  const section: KarmaSectionProps = { step: props, taps, readOnly };
  return (
    <div className="space-y-4" data-testid="karma-step" data-readonly={readOnly ? 'yes' : 'no'}>
      <KarmaHeader build={build} budgets={budgets} settings={settings} tally={tally} general={placed.general} />
      <Ledger build={build} taps={taps} issues={placed.spends} update={props.update} readOnly={readOnly} />
      <Attributes {...section} />
      <Skills {...section} />
      <Knowledge {...section} />
      <Specializations {...section} />
      <Magic {...section} />
      <Contacts {...section} tally={tally} issues={placed.contacts} />
    </div>
  );
}
