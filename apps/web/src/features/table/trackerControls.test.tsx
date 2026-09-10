/**
 * The tracker's on-ramps (FR4.2, FR4.3, FR4.8): a fight that has not started
 * offers "Start the fight" and nothing that presumes it has; a running fight
 * offers the turn controls, a roll, and an end; the dice line is on every
 * row; a blank line shows "—" and not a ranked zero; and a runner gets the
 * dice on their own row and nobody else's.
 *
 * Static markup, no DOM — the same bar as the sibling tracker tests: is the
 * control there, and does it say the right thing.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Combatant, Encounter, Role } from '@safehouse/contracts';
import { ACTIVE_ROLE_KEY, SESSION_PREFIX } from '../../api/session.js';
import { liveKeys } from '../../api/live.js';
import Tracker from './Tracker.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSession(role: Role) {
  const data: Record<string, string> = {
    [`${SESSION_PREFIX}${role}`]: JSON.stringify({ token: 't', role, campaignId: 'camp-1', userId: 'u1' }),
    [ACTIVE_ROLE_KEY]: role,
  };
  const store = {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
    key: (i: number) => Object.keys(data)[i] ?? null,
    get length() {
      return Object.keys(data).length;
    },
  };
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', undefined);
}

function combatant(over: Partial<Combatant> & { id: string; name: string }): Combatant {
  return {
    encounterId: 'enc-1',
    source: 'character',
    sourceId: null,
    initBase: 8,
    initDice: 2,
    initScore: 0,
    initKind: 'physical',
    monitors: { physical: { max: 10, filled: 0 }, stun: { max: 10, filled: 0 }, overflow: { max: 3, filled: 0 } },
    effects: [],
    visibility: 'public',
    actedThisPass: false,
    ...over,
  };
}

function render(role: Role, encounter: Encounter, extra: Encounter[] = []): string {
  stubSession(role);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['campaign', 'camp-1'], { id: 'camp-1', name: 'Night shift', settings: {} });
  qc.setQueryData(liveKeys.encounter('camp-1'), encounter);
  qc.setQueryData(liveKeys.encounters('camp-1'), [encounter, ...extra]);
  // What `GET /api/me` answers a player whose phone holds Static's sheet.
  qc.setQueryData(['me', 't'], { user: { id: 'u1', displayName: 'Static' }, role, campaignId: 'camp-1', deviceId: 'd1', characterId: 'char-static' });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <Tracker campaignId="camp-1" />
    </QueryClientProvider>,
  );
}

const STATIC = combatant({ id: 'c-static', name: 'Static', sourceId: 'char-static' });
const GANGER = combatant({ id: 'c-ganger', name: 'Halo ganger', source: 'npc_template', initBase: 6, initDice: 1 });

const PREP: Encounter = { id: 'enc-1', campaignId: 'camp-1', name: 'Pier 23 ambush', state: 'prep', turn: 0, pass: 0, combatants: [STATIC, GANGER] };
const LIVE: Encounter = {
  ...PREP,
  state: 'live',
  turn: 1,
  pass: 1,
  combatants: [{ ...STATIC, initScore: 17 }, { ...GANGER, initScore: 9 }],
};

describe('a fight that has not started', () => {
  it('offers the GM "Start the fight" and the hand-rolls switch, and nothing that presumes it is running', () => {
    const html = render('gm', PREP);
    expect(html).toContain('Start the fight');
    expect(html).toContain('hand rolls off');
    expect(html).toContain('NOT STARTED');
    expect(html).not.toContain('New turn');
    expect(html).not.toContain('End pass');
    expect(html).not.toContain('Roll initiative');
  });

  it('shows every line’s dice and a blank score, never a ranked zero', () => {
    const html = render('gm', PREP);
    expect(html).toContain('8+2d6');
    expect(html).toContain('6+1d6');
    expect(html).toContain('data-rolled="no"');
    expect(html).not.toContain('data-rolled="yes"');
    expect(html).not.toContain('>0<');
  });

  it('offers the GM the manage menu even before any fight exists', () => {
    const html = render('gm', { ...PREP, combatants: [] });
    expect(html).toContain('manage ▾');
  });

  it('keeps the controls from a player', () => {
    const html = render('player', PREP);
    expect(html).not.toContain('manage ▾');
    expect(html).not.toContain('Remove Static from the fight');
    expect(html).not.toContain('Start the fight');
    expect(html).not.toContain('hand rolls');
    expect(html).not.toContain('Dice total for');
  });
});

describe('a running fight', () => {
  it('offers next, roll, end pass, new turn and end — and a roll on every row', () => {
    const html = render('gm', LIVE);
    expect(html).toContain('Next ▸');
    expect(html).toContain('Roll initiative');
    expect(html).toContain('End pass');
    expect(html).toContain('New turn');
    expect(html).toContain('End the fight');
    expect(html).toContain('TURN 1 · PASS 1');
    expect(html).toContain('data-rolled="yes"');
    expect((html.match(/>ROLL</g) ?? []).length).toBe(2);
    expect(html).toContain('Initiative score for Static');
    // Every row can be taken off the roster, two clicks each (FR4.8).
    expect(html).toContain('aria-label="Remove Static from the fight"');
    expect(html).toContain('aria-label="Remove Halo ganger from the fight"');
  });

  it('lets a runner roll or type the dice for their own row and no other', () => {
    const html = render('player', LIVE);
    expect(html).toContain('Dice total for Static');
    expect(html).not.toContain('Dice total for Halo ganger');
    expect((html.match(/>ROLL</g) ?? []).length).toBe(1);
    // …and never the GM's score override.
    expect(html).not.toContain('Initiative score for');
  });

  it('offers the GM a picker only when there is more than one fight to pick from', () => {
    const alone = render('gm', LIVE);
    expect(alone).not.toContain('Which fight');
    const two = render('gm', LIVE, [{ ...PREP, id: 'enc-2', name: 'Rooftop', combatants: [] }]);
    expect(two).toContain('Which fight');
    expect(two).toContain('Rooftop · prep');
    expect(two).toContain('Pier 23 ambush · live');
  });
});
