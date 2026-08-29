/**
 * The Magic tab as the mage actually meets it (FR8.2–FR8.4).
 *
 * Rendered with `react-dom/server` — no DOM, no effects — from a query cache
 * seeded with exactly what `GET /api/characters/:id/magic/derived` returns and
 * a live store holding zero events. That is the LIVE-1 shape on purpose: if the
 * spirit list, the focus rack and the reagent counter only appeared once a
 * WebSocket frame arrived, every assertion below would fail.
 *
 * The interactions are exercised through the same functions the components
 * call — the optimistic transforms and the bare requests — because a static
 * render cannot click. What is being pinned is the promise, not the pixel:
 * spending a service moves the count and puts a line in the log; flipping a
 * focus moves a derived pool and shows up in its provenance; a spirit that
 * joined stands on the tracker and stops offering to.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Modifier, SheetV1, WsEvent } from '@safehouse/contracts';
import { SheetV1Schema } from '@safehouse/contracts';
import { deriveCharacter } from '@safehouse/rules';
import type { CharacterRecord } from '../api.js';
import { BreakdownSheet } from '../components/Provenance.js';
import type { TabProps } from '../tabs/shared.js';
import MagicTab from '../tabs/MagicTab.js';
import MagicWorkbench from './MagicWorkbench.js';
import { magicKey, sendSpiritToEncounter, spendSpiritService, reagentRequest } from './api.js';
import { applyMagicEvent } from './events.js';
import {
  affectedPools,
  applyFocusPatchLocal,
  replaceSpirit,
  spendServiceLocal,
} from './lib.js';
import { emptyMagicView, normalizeSpirit, type FocusRow, type MagicView, type SpiritRow } from './types.js';

// ---------------------------------------------------------------------------
// Fixtures — original fiction only (G6)
// ---------------------------------------------------------------------------

const SHEET: SheetV1 = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Marisol Quen', metatype: 'elf' },
  attributes: {
    bod: 3,
    agi: 3,
    rea: 4,
    str: 2,
    wil: 5,
    log: 4,
    int: 5,
    cha: 5,
    edg: { max: 3, current: 3 },
    ess: 6,
    mag: 5,
    res: 0,
  },
  skills: [{ id: 'spellcasting', rating: 5, attr: 'mag' }],
  spells: [{ name: 'Pale Lantern', drain: 'F-3' }],
} satisfies Record<string, unknown>);

const DIM_SCENE: Modifier = {
  id: 'env.scene',
  source: { kind: 'scene' },
  target: 'pool.all',
  op: 'add',
  value: -1,
  active: true,
  note: 'environment: light 1 → light (-1)',
};

const CHARACTER: CharacterRecord = {
  id: 'char-1',
  campaignId: 'camp-1',
  name: 'Marisol Quen',
  sheet: SHEET,
  condition: { physical: 0, stun: 0 },
  edgeBurned: 0,
  balances: { karma: 8, nuyen: 900 },
};

const PREVIEW = { sheet: SHEET, wounds: { physical: 0, stun: 0 } };

const WREN: FocusRow = {
  id: 'focus-1',
  characterId: 'char-1',
  name: 'Copper Wren',
  kind: 'power focus',
  force: 3,
  bonded: true,
  active: false,
  sourceKind: 'power',
  targets: ['pool.skill.spellcasting'],
  mods: [],
  note: '',
};

const ASH_WING: SpiritRow = {
  id: 'spirit-1',
  characterId: 'char-1',
  name: 'Ash-Wing',
  spiritType: 'air',
  force: 4,
  bound: true,
  services: 3,
  servicesInitial: 5,
  status: 'summoned',
  sustainingSpellId: 'spell.hush',
  combatantId: null,
  encounterId: null,
  note: '',
};

const FIGHT = { id: 'enc-1', name: 'Rooftop Standoff' };

/** What `deriveWithMagic` returns for this mage with the rack switched off. */
function baseView(over: Partial<MagicView> = {}): MagicView {
  return {
    ...emptyMagicView('char-1'),
    name: 'Marisol Quen',
    derived: deriveCharacter(SHEET, { situational: [DIM_SCENE], wounds: PREVIEW.wounds }),
    situational: [DIM_SCENE],
    foci: [WREN],
    spirits: [ASH_WING],
    sustaining: {
      lines: [
        {
          id: 'spell.hush',
          name: 'Hush',
          exempt: true,
          exemptBy: 'spirit',
          spiritId: 'spirit-1',
          spiritName: 'Ash-Wing',
          penalty: 0,
        },
        {
          id: 'spell.pale-lantern',
          name: 'Pale Lantern',
          exempt: false,
          exemptBy: null,
          spiritId: null,
          spiritName: null,
          penalty: -2,
        },
      ],
      penalty: -2,
      selfSustained: 1,
    },
    reagents: 4,
    ...over,
  };
}

function tabProps(over: Partial<TabProps> = {}): TabProps {
  return {
    character: CHARACTER,
    campaignId: 'camp-1',
    derived: deriveCharacter(SHEET),
    patchSheet: () => {},
    setCondition: () => {},
    roll: () => {},
    overrideFor: () => ({ set: () => {}, clear: () => {} }),
    ...over,
  };
}

interface LiveIn {
  encounter?: { id: string; name: string } | null;
  events?: WsEvent[];
  isGm?: boolean;
}

/** Render the workbench from a seeded cache — REST state only, no events at all. */
function renderTab(view: MagicView | null, live: LiveIn = {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (view) qc.setQueryData(magicKey('char-1'), view);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MagicWorkbench
        {...tabProps()}
        encounter={live.encounter ?? null}
        events={live.events ?? []}
        isGm={live.isGm ?? false}
      />
    </QueryClientProvider>,
  );
}

function labels(html: string): string[] {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1] ?? '');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(reply: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const call: Call = {
        url: String(url),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      return Promise.resolve(reply(call));
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe('the tab comes up whole from REST alone (LIVE-1)', () => {
  const html = renderTab(baseView());

  it('shows the spirit, its Force and its services with no event ever arriving', () => {
    expect(html).toContain('Ash-Wing');
    expect(html).toContain('air · Force 4 · bound');
    expect(labels(html)).toContain(
      'Ash-Wing, air Force 4, bound, 3 of 5 services left',
    );
  });

  it('shows the focus rack and the reagent counter', () => {
    expect(html).toContain('Copper Wren');
    expect(labels(html).some((l) => l.startsWith('Copper Wren Force 3, inactive'))).toBe(true);
    expect(labels(html)).toContain('4 drams of reagents on hand');
  });

  it('still shows the spellbook, with the magic-derived pool', () => {
    expect(labels(html).some((l) => l.startsWith('Cast Pale Lantern'))).toBe(true);
  });

  it('keeps the sheet’s accessibility floor: real buttons, no nesting', () => {
    expect(html).not.toContain('role="button"');
    expect(html).not.toMatch(/<button(?:(?!<\/button>).)*<button/s);
    expect(labels(html).every((l) => l.trim().length > 0)).toBe(true);
  });

  it('says it is reading rather than rendering an empty rack it has not confirmed', () => {
    const pending = renderTab(null);
    expect(pending).toContain('Reading the tracker…');
    // …and the spellbook is up regardless, because it needs nothing but the sheet.
    expect(pending).toContain('Pale Lantern');
  });
});

describe('the tab assembles both halves', () => {
  it('puts the workbench above the spellbook when a query client is mounted', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(magicKey('char-1'), baseView());
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <MagicTab {...tabProps()} />
      </QueryClientProvider>,
    );
    expect(html).toContain('Ash-Wing');
    // Thumb order on a 390px phone: what is costing you, then what you cast,
    // then the things you manage between casts.
    const order = ['Sustaining —', 'Spells', 'Adept powers', 'Spirits —', 'Foci —', 'Reagents'];
    const found = order.map((label) => html.indexOf(label));
    expect(found.every((i) => i >= 0)).toBe(true);
    expect(found).toEqual([...found].sort((a, b) => a - b));
  });

  it('degrades to the spellbook alone rather than throwing without one', () => {
    const bare = renderToStaticMarkup(<MagicTab {...tabProps()} />);
    expect(bare).toContain('Pale Lantern');
    expect(bare).not.toContain('Spirits —');
    // Sustaining still has somewhere to go: the sheet modifier convention.
    expect(bare).toContain('Adept powers');
  });
});

describe('one tap spends a service (FR8.3)', () => {
  it('sends the spend to the spirit’s own route', async () => {
    const calls = stubFetch(() =>
      json({ spirit: { ...ASH_WING, services: 2 }, spent: 1, shortfall: 0, remaining: 2 }),
    );
    await spendSpiritService('camp-1', 'spirit-1', 1, 'watch the stairwell');
    expect(calls[0]).toMatchObject({
      url: '/api/campaigns/camp-1/magic/spirits/spirit-1/services',
      method: 'POST',
      body: { op: 'spend', count: 1, reason: 'watch the stairwell' },
    });
  });

  it('drops the count on the row immediately', () => {
    const before = baseView();
    expect(renderTab(before)).toContain('>3/5<');

    const after = { ...before, spirits: spendServiceLocal(before.spirits, 'spirit-1').spirits };
    const html = renderTab(after);
    expect(html).toContain('>2/5<');
    expect(labels(html)).toContain('Spend a service from Ash-Wing, 2 left');
  });

  it('puts the spend in the log, and reconciles the count from that same frame', () => {
    const optimistic = {
      ...baseView(),
      spirits: spendServiceLocal(baseView().spirits, 'spirit-1').spirits,
    };
    const frame: WsEvent = {
      id: 42,
      type: 'magic.updated',
      payload: {
        op: 'spirit.service.spend',
        spirit: { ...ASH_WING, services: 2 },
        spent: 1,
        shortfall: 0,
        remaining: 2,
        reason: 'watch the stairwell',
      },
      visibility: 'public',
      ts: '2076-05-12T21:03:00.000Z',
    };
    const reconciled = applyMagicEvent(optimistic, frame).view;
    expect(reconciled.spirits[0]?.services).toBe(2);

    const html = renderTab(reconciled, { events: [frame] });
    expect(html).toContain('Magic in the log');
    expect(html).toContain('Ash-Wing: 1 service spent, 2 left — watch the stairwell');
    expect(html).toContain('>2/5<');
  });

  it('offers nothing to spend when the spirit owes nothing', () => {
    const spent = baseView({ spirits: [{ ...ASH_WING, services: 0 }] });
    const html = renderTab(spent);
    expect(labels(html)).toContain('Ash-Wing has no services left');
    expect(html).toMatch(/disabled=""[^>]*aria-label="Ash-Wing has no services left"/);
  });
});

describe('a focus toggle moves a real number (FR8.4, Principle 3)', () => {
  const off = baseView();
  const on = applyFocusPatchLocal(off, 'focus-1', { active: true }, PREVIEW);

  it('changes the pool the rack shows', () => {
    // MAG 5 + Spellcasting 5 − scene 1 = 9, and the Force-3 focus makes it 12.
    expect(labels(renderTab(off))).toContain('spellcasting pool: 9. Show breakdown');
    expect(labels(renderTab(on))).toContain('spellcasting pool: 12. Show breakdown');
  });

  it('names the focus in that pool’s breakdown', () => {
    const pool = affectedPools(on.foci, on.derived)[0]?.pool;
    expect(pool).toBeDefined();
    const sheet = renderToStaticMarkup(
      <BreakdownSheet
        open
        onClose={() => {}}
        title="spellcasting pool"
        value={pool!.total}
        breakdown={pool!.breakdown}
      />,
    );
    expect(sheet).toContain('Copper Wren');
    expect(sheet).toContain('+3');
    // The scene is still in there — the focus was added, nothing was replaced.
    expect(sheet).toContain('environment');
  });

  it('moves the cast pool the spellbook offers too', () => {
    // A Spellcasting focus reaches the spell rows, which is what the caster
    // actually rolls — the tab must not show 9 in one place and 12 in another.
    expect(labels(renderTab(off)).some((l) => l.startsWith('Cast Pale Lantern, pool 9'))).toBe(true);
    expect(labels(renderTab(on)).some((l) => l.startsWith('Cast Pale Lantern, pool 12'))).toBe(true);
  });

  it('will not switch on a focus that is not bonded', () => {
    const unbonded = baseView({ foci: [{ ...WREN, bonded: false, active: true }] });
    const html = renderTab(unbonded);
    expect(html).toContain('not bonded');
    expect(labels(html).some((l) => l.includes('bond it before it can do anything'))).toBe(true);
    // The rack shows nothing moving, because nothing is.
    expect(labels(html).some((l) => l.includes('spellcasting pool'))).toBe(false);
  });

  it('reads the focus rack’s header off the engine, not off a counter', () => {
    expect(renderTab(off)).toContain('Foci — 1 bonded, 0 burning');
    expect(renderTab(on)).toContain('Foci — 1 bonded, 1 burning');
  });
});

describe('a spirit joins the fight (FR8.3 → the tracker)', () => {
  it('has nothing to join when no fight is running', () => {
    const html = renderTab(baseView());
    expect(html).toContain('No fight running');
    expect(labels(html).some((l) => l.startsWith('Send Ash-Wing into'))).toBe(false);
  });

  it('offers the tracker the moment there is a fight', () => {
    const html = renderTab(baseView(), { encounter: FIGHT });
    expect(labels(html)).toContain('Send Ash-Wing into Rooftop Standoff as a combatant');
  });

  it('asks the encounter to take it, through the spirit’s own route', async () => {
    const calls = stubFetch(() =>
      json({ spirit: { ...ASH_WING, combatantId: 'cmb-9', encounterId: 'enc-1' }, combatant: { id: 'cmb-9' } }, 201),
    );
    const body = (await sendSpiritToEncounter('camp-1', 'spirit-1', 'enc-1')) as {
      combatant: { id: string };
    };
    expect(calls[0]).toMatchObject({
      url: '/api/campaigns/camp-1/magic/spirits/spirit-1/join',
      method: 'POST',
      body: { encounterId: 'enc-1' },
    });
    expect(body.combatant.id).toBe('cmb-9');
  });

  it('shows it standing on the tracker afterwards, and stops offering to send it', () => {
    const placed = normalizeSpirit({ ...ASH_WING, combatantId: 'cmb-9', encounterId: 'enc-1' });
    const view = baseView({ spirits: replaceSpirit(baseView().spirits, placed!) });
    const html = renderTab(view, { encounter: FIGHT });
    expect(html).toContain('in the fight');
    expect(labels(html).some((l) => l.startsWith('Send Ash-Wing into'))).toBe(false);
  });

  it('says who places figures when this device is not the GM', () => {
    // No session in this environment → not a GM, and the row says so rather
    // than handing a player a button the server will refuse.
    expect(renderTab(baseView(), { encounter: FIGHT })).toContain(
      'The GM places figures on the tracker.',
    );
  });
});

describe('the reagent counter cannot go below zero (FR8.4)', () => {
  it('says what a spend will leave', () => {
    expect(labels(renderTab(baseView()))).toContain('Spend 1 dram, leaving 3');
  });

  it('refuses to spend from an empty pouch', () => {
    const html = renderTab(baseView({ reagents: 0 }));
    expect(labels(html)).toContain('No reagents left to spend');
    expect(html).toMatch(/disabled=""[^>]*aria-label="No reagents left to spend"/);
  });

  it('sends spend and restock to the character’s own route', async () => {
    const calls = stubFetch(() => json({ characterId: 'char-1', before: 4, after: 2, shortfall: 0 }));
    await reagentRequest('char-1', 'spend', 2);
    await reagentRequest('char-1', 'restock', 6);
    expect(calls[0]).toMatchObject({
      url: '/api/characters/char-1/reagents',
      method: 'POST',
      body: { op: 'spend', amount: 2 },
    });
    expect(calls[1]?.body).toMatchObject({ op: 'restock', amount: 6 });
  });
});

describe('the sustained list says who is carrying what (FR8.2)', () => {
  const html = renderTab(baseView());

  it('charges the caster only for the ones they are holding themselves', () => {
    expect(html).toContain('Sustaining — -2 to your pools');
    expect(html).toContain('held by Ash-Wing — no −2');
    expect(html).toContain('−2 to your pools');
  });

  it('lets the caster hand a spell to a spirit, and take it back', () => {
    expect(labels(html)).toContain('Which spirit holds Pale Lantern');
    expect(html).toContain('nobody — you carry it');
    expect(html).toContain('>Ash-Wing</option>');
  });

  it('will not offer the focus toggle for a spell a spirit already holds', () => {
    expect(labels(html).some((l) => l.includes('is held by Ash-Wing — take it back first'))).toBe(true);
  });

  it('has an honest empty state', () => {
    const quiet = renderTab(baseView({ sustaining: { lines: [], penalty: 0, selfSustained: 0 } }));
    expect(quiet).toContain('Sustaining — nothing');
    expect(quiet).toContain('Nothing being held up.');
  });
});
