/**
 * A technomancer's living persona, previewed as play will read it (FR3.9,
 * docs/CHARGEN.md §4.4 Step 4, §8.4 "living persona … added to derive.ts").
 *
 * A technomancer has no Matrix attributes to buy: the mind supplies them, one
 * mental attribute each and Resonance for the device rating. So Step 4 shows
 * the five numbers the derived character already carries
 * (`preview.derived.livingPersona`) — they move as attribute points and
 * Resonance move in step 3 — each with the attribute it comes from, and
 * sends the player to step 8 for sprites, which are bought with Karma there.
 * Nothing here computes a persona; a build too unfinished to derive says so.
 */
import { useId } from 'react';
import type { Issue, LivingPersona } from '@safehouse/contracts';
import type { StepProps } from '../types.js';
import { IssueNotes, Section, StepLink } from './parts.js';

/** The persona's attributes in the order the Matrix chapter lists them, and where each comes from. */
export const PERSONA_ROWS: ReadonlyArray<{ key: keyof LivingPersona; label: string; from: string }> = [
  { key: 'attack', label: 'Attack', from: 'Charisma' },
  { key: 'sleaze', label: 'Sleaze', from: 'Intuition' },
  { key: 'dataProcessing', label: 'Data Processing', from: 'Logic' },
  { key: 'firewall', label: 'Firewall', from: 'Willpower' },
  { key: 'deviceRating', label: 'Device Rating', from: 'Resonance' },
];

export function PersonaSection({ props, issues }: { props: StepProps; issues: readonly Issue[] }) {
  const headingId = useId();
  const persona = props.preview.derived?.livingPersona ?? null;
  return (
    <Section id={headingId} title="Living persona" testId="magic-persona-section">
      {persona ? (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]" data-testid="magic-persona">
          {PERSONA_ROWS.map((row) => (
            <div key={row.key} className="contents" data-persona={row.key}>
              <dt className="text-dim">
                {row.label} <span className="text-faint">({row.from})</span>
              </dt>
              <dd className="text-right font-label text-ink">{persona[row.key].value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-dim" data-testid="magic-persona-missing">
          {props.preview.error ? `The persona cannot be previewed yet: ${props.preview.error}` : 'The persona appears once this runner has Resonance.'}
        </p>
      )}
      <p className="flex flex-wrap items-center gap-2 text-xs text-dim">
        <span>Sprites are registered with Karma in step 8.</span>
        <StepLink step={8} label="sprites in step 8" jump={props} />
      </p>
      <IssueNotes issues={issues} />
    </Section>
  );
}
