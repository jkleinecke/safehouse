/**
 * "Static on the Line" — the run itself (FR5.5).
 *
 * ORIGINAL FICTION ONLY (G6/§14): an invented Johnson, an invented pier, an
 * invented crate. Nuyen and karma are ordinary game math a GM types in.
 *
 * It lives out here beside the rest of the demo's content — and not inline in
 * `demo.ts` — for one reason beyond tidiness: `demo.ts` is a script with
 * top-level `await` and a `process.exit`, so nothing can import it, and for as
 * long as the run's payload lived inside it the payload was the one piece of
 * seeded content no test could look at. Now the seeder and its test read the
 * same constant, which is the only way "the seeded run validates" means
 * anything.
 *
 * The shape is exactly what `POST /api/campaigns/:id/runs` accepts. `awards` is
 * deliberately absent: that blob is written by the run's own `/award` route
 * when the GM settles up, and every entry it posts lands **pending** for
 * confirmation (FR3.6). Seeding a filled-in `awards` would put money on the
 * table nobody approved — which is the exact mistake the pending state exists
 * to prevent. What the Johnson promised belongs in `payout`; what the crew was
 * actually paid is a decision, not a fixture.
 */
export interface DemoRun {
  title: string;
  state: 'prep' | 'active' | 'done' | 'failed';
  ingameDate: string;
  hook: string;
  objectives: Array<{ text: string; state: 'open' | 'done' | 'failed' }>;
  payout: { nuyen: number; karma: number; notes: string };
  recapMd: string;
}

export function demoRun(title: string, ingameDate: string): DemoRun {
  return {
    title,
    state: 'prep',
    ingameDate,
    hook:
      'A crate leaves Pier 23 tonight one way or another. Mr. Pell wants it first, ' +
      'will not say who for, and pays on hand-over rather than on promises.',
    objectives: [
      { text: 'Take the meet under the skyway and settle the price', state: 'open' },
      { text: 'Get inside Pier 23 without waking the Rusted Halo', state: 'open' },
      { text: 'Move the crate off the pier and hand it over intact', state: 'open' },
    ],
    payout: {
      nuyen: 8000,
      karma: 4,
      notes:
        '2,000¥ up front, 6,000¥ on delivery; split however the crew likes. ' +
        '+1 karma if the drone leaves the pier unshot at.',
    },
    recapMd: '',
  };
}
