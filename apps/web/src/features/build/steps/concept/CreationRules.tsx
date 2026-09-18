/**
 * The campaign's creation level and priority table on Step 1 — shown, never
 * chosen (FR3.9, docs/CHARGEN.md §4.4 Step 1 "set by the GM, shown not
 * chosen").
 *
 * A player reads the level before spending anything, so it is laid out as
 * the numbers it moves (`levelFacts`: starting Karma, the Availability and
 * device caps, starting nuyen, the quality cap, conversion, carry-over,
 * contact Karma) rather than as a word, with a "why?" chip to the page. The
 * table is named with the one row that differs between the printings. There
 * is no control for either: the GM owns them, and the screen says so.
 *
 * Two honest notes can sit under them. When the campaign's settings could not
 * be read, the numbers are the build's own level's, and the player is told.
 * When the build was started at another level or on another table, the
 * validator's sentence is shown with its page and — for someone who may edit
 * — one button that records the campaign's level and table on the build.
 *
 * Definition lists, not tables, so nothing scrolls sideways on a phone.
 */
import { useId } from 'react';
import type { CharacterBuild, ChargenSettings, Issue } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import WhyLink from '../../kit/WhyLink.js';
import { levelFacts, mismatchIssues, tableFacts, type CampaignFact } from './campaign.js';

export interface CreationRulesProps {
  build: CharacterBuild;
  settings: ChargenSettings;
  settingsFromCampaign: boolean;
  /** This step's issues; the level and table warnings are read from them. */
  issues: readonly Issue[];
  readOnly: boolean;
  /** Record the campaign's level and table on the build. */
  onMatch: () => void;
}

function Facts({ facts, testId }: { facts: readonly CampaignFact[]; testId: string }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2" data-testid={testId}>
      {facts.map((fact) => (
        <div key={fact.key} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3" data-fact={fact.key}>
          <dt className="text-xs text-dim">{fact.label}</dt>
          <dd className="text-sm text-ink">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function CreationRules({ build, settings, settingsFromCampaign, issues, readOnly, onMatch }: CreationRulesProps) {
  const id = useId();
  const headingId = `${id}-heading`;
  const level = levelFacts(build, settings);
  const table = tableFacts(settings);
  const mismatches = mismatchIssues(issues);
  const matchReason = `${id}-mismatch`;

  return (
    <section aria-labelledby={headingId} className="space-y-3" data-testid="concept-campaign">
      <div>
        <h2 id={headingId} className="mono-label text-cyan">
          What this campaign builds
        </h2>
        <p className="mt-1 text-xs text-dim">Set by the GM. The rail and every step hold the build to these numbers.</p>
      </div>

      {!settingsFromCampaign && (
        <p className="rounded-md border border-warn/40 bg-deck px-3 py-2 text-xs text-warn" data-testid="concept-settings-note">
          <span aria-hidden>! </span>
          The campaign&apos;s settings could not be read, so these numbers are for the level this build was started
          at.
        </p>
      )}

      <div className="rounded-md border border-edge bg-deck p-3" data-testid="concept-level" data-level={level.level}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-ink">{level.name}</h3>
          <WhyLink refValue={level.ref} />
        </div>
        <p className="mt-0.5 mb-2 text-xs text-dim">{level.pitch}</p>
        <Facts facts={level.facts} testId="concept-level-facts" />
      </div>

      <div className="rounded-md border border-edge bg-deck p-3" data-testid="concept-table" data-table={table.table}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-ink">{table.name}</h3>
          <WhyLink refValue={table.ref} />
        </div>
        <p className="mt-0.5 mb-2 text-xs text-dim">
          The two tables differ only in what a technomancer starts with. On this one:
        </p>
        <Facts facts={table.rows} testId="concept-table-facts" />
      </div>

      {mismatches.length > 0 && (
        <div className="space-y-2 rounded-md border border-warn/40 bg-deck p-3" data-testid="concept-mismatch">
          <ul id={matchReason} className="space-y-1">
            {mismatches.map((issue) => (
              <li key={issue.code} className="flex items-baseline gap-1.5 text-xs text-warn" data-issue={issue.code}>
                <span aria-hidden className="shrink-0">
                  !
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span>{issue.message}</span>
                  <RefChip refValue={issue.ref} className="pointer-coarse:min-h-10" />
                </span>
              </li>
            ))}
          </ul>
          {!readOnly && (
            <button
              type="button"
              className="btn px-3 py-1.5"
              aria-describedby={matchReason}
              onClick={onMatch}
              data-testid="concept-match-campaign"
            >
              build to the campaign&apos;s rules
            </button>
          )}
        </div>
      )}
    </section>
  );
}
