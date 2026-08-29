/**
 * The hint as it actually reaches the tracker row (FR10.10).
 *
 * `hints.test.tsx` pins the rules in isolation; this one renders the real
 * `CombatantRow` over a seeded query cache, because the failure that matters is
 * not "the predicate is wrong" — it is "a line the GM was allowed to see turned
 * up in a player's markup". So the assertion is on the RENDERED HTML for each
 * viewer, in the spirit of `e2e/secrecy.spec.ts`: the payload, not the pixels.
 *
 * Note what the player case really proves. A player device never *has* the
 * hint — the route that carries it is GM-only, so the cache is empty for them
 * and the server is the guarantee (Principle 4). Seeding the cache anyway is
 * the harsher test: even handed the payload, a player row must not render it.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { Combatant } from '@safehouse/contracts';
import CombatantRow from './CombatantRow.js';
import { quickRollsKey, type QuickRolls, type TacticalHint } from './quickRolls.js';
import type { TrackerRow } from './initiative.js';

const HINT: TacticalHint = {
  roleTag: 'lieutenant',
  text: 'give one order, then fight',
  why: 'role tag "lieutenant"',
  advisoryOnly: true,
};

/** An original NPC (G6): generator-backed, so the row carries a copilot rack. */
function combatant(): Combatant {
  return {
    id: 'cb-1',
    encounterId: 'enc-1',
    source: 'generated',
    name: 'Vellum Shrike',
    initBase: 8,
    initDice: 2,
    initScore: 17,
    initKind: 'physical',
    monitors: {
      physical: { max: 10, filled: 0 },
      stun: { max: 10, filled: 0 },
      overflow: { max: 4, filled: 0 },
    },
    effects: [],
    visibility: 'gm',
    actedThisPass: false,
    copilot: {
      generator: { templateId: 'tpl-1' },
      pools: { attack: 9, defense: 7, soak: 11 },
      attributes: { bod: 4, rea: 4, int: 3 },
    },
  };
}

function row(over: Partial<TrackerRow> = {}): TrackerRow {
  return {
    combatant: combatant(),
    order: 1,
    acting: true,
    acted: false,
    active: true,
    woundModifier: 0,
    detail: 'full',
    own: false,
    ...over,
  } as TrackerRow;
}

/** Seeded so `useQuery` resolves synchronously during a server render. */
function render(opts: { isGm: boolean; row?: TrackerRow; hint?: TacticalHint }): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const data: QuickRolls = {
    combatantId: 'cb-1',
    woundModifier: 0,
    entries: [
      { key: 'defense', kind: 'defense', label: 'Defense', pool: 7, breakdown: [] },
    ],
    sceneModifiers: [],
    ...(opts.hint ? { hint: opts.hint } : {}),
  };
  qc.setQueryData(quickRollsKey('cb-1'), data);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <ul>
        <CombatantRow
          campaignId="camp-1"
          encounterId="enc-1"
          row={opts.row ?? row()}
          isGm={opts.isGm}
          rackVisibility="gm"
          onDamage={() => undefined}
          onOpenChain={() => undefined}
        />
      </ul>
    </QueryClientProvider>,
  );
}

describe('hints on the tracker row', () => {
  it('shows the acting NPC’s line to the GM when the campaign turned them on', () => {
    const html = render({ isGm: true, hint: HINT });
    expect(html).toContain(HINT.text);
    expect(html).toContain('hint ▸');
    expect(html).toContain('role="note"');
  });

  /** Off is how the feature ships: the server simply omits the field. */
  it('shows nothing when hints are off — which is the default', () => {
    const html = render({ isGm: true });
    expect(html).not.toContain('hint ▸');
    expect(html).not.toContain('role="note"');
    // The rack the hint rides along with is still there, so this is a hint
    // that is absent, not a row that failed to render.
    expect(html).toContain('pool 7');
  });

  it('never renders on a player’s device, even handed the payload', () => {
    const html = render({ isGm: false, hint: HINT });
    expect(html).not.toContain(HINT.text);
    expect(html).not.toContain('hint ▸');
    expect(html).not.toContain(HINT.roleTag);
  });

  it('is a hint for the row that is UP, not a column down the tracker', () => {
    const html = render({ isGm: true, hint: HINT, row: row({ acting: false, order: 3 }) });
    expect(html).not.toContain(HINT.text);
  });

  it('never renders anything the GM could press', () => {
    const html = render({ isGm: true, hint: HINT });
    const line = html.slice(html.indexOf('hint ▸'));
    // Everything from the hint marker to the end of its paragraph is prose.
    expect(line.slice(0, line.indexOf('</p>'))).not.toContain('<button');
  });
});
