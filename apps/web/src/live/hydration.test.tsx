/**
 * LIVE-1 regression suite.
 *
 * Measured in a real browser before this landed: seconds after a roll
 * persisted, the table log read "The log is empty"; a live encounter with
 * eight staged combatants in the database rendered "No combatants yet". The
 * UI drew only the WebSocket events it happened to receive while mounted.
 *
 * These tests drive the whole path with ZERO WebSocket traffic — a seeded REST
 * mock, the real hydration orchestrator, the real live store, the real row
 * projections and the real row components rendered to markup. Then they merge
 * a live event on top and assert it does not double-apply, and finally
 * reconnect and assert the views re-hydrate.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WsEvent } from '@safehouse/contracts';
import CombatantRow from '../features/table/CombatantRow.js';
import { LogEmptyLine, LogLine } from '../features/table/LogStream.js';
import { TrackerEmptyLine } from '../features/table/Tracker.js';
import { passLabel, trackerRows, type Viewer } from '../features/table/initiative.js';
import { toLogItems } from '../features/table/views.js';
import { hydrateCampaign } from './hydrate.js';
import { useLiveStore } from './store.js';

const CAMPAIGN = 'camp_1';
const GM: Viewer = { role: 'gm' };

// ---------------------------------------------------------------------------
// The seeded server
// ---------------------------------------------------------------------------

function rollEvent(id: number, actorName: string, label: string): WsEvent {
  return {
    id,
    type: 'roll.created',
    visibility: 'public',
    ts: '2076-05-12T20:14:00.000Z',
    payload: {
      id: `roll_${id}`,
      actorName,
      kind: 'simple',
      request: {
        pool: 5,
        breakdown: [
          { label: 'Perception', value: 3, source: 'skill' },
          { label: 'Intuition', value: 3, source: 'attribute' },
          { label: 'environment: light (-1)', value: -1, source: 'scene' },
        ],
        meta: { label },
      },
      faces: [5, 3, 6, 1, 4],
      hits: 2,
      ones: 1,
      glitch: 'none',
      limitedHits: 2,
    },
  };
}

function talkEvent(id: number, text: string): WsEvent {
  return {
    id,
    type: 'log.posted',
    visibility: 'public',
    ts: '2076-05-12T20:15:00.000Z',
    payload: { kind: 'talk', authorName: 'Hatchet', text },
  };
}

function combatant(id: string, name: string, initScore: number, sourceId: string) {
  return {
    id,
    encounterId: 'enc_1',
    source: 'character',
    sourceId,
    name,
    initBase: 9,
    initDice: 2,
    initScore,
    initKind: 'physical',
    monitors: {
      physical: { max: 10, filled: 0 },
      stun: { max: 10, filled: 0 },
      overflow: { max: 3, filled: 0 },
    },
    effects: [],
    visibility: 'public',
    actedThisPass: false,
  };
}

interface Seed {
  log: WsEvent[];
  combatants: ReturnType<typeof combatant>[];
  turn: number;
  pass: number;
  activeCombatantId: string;
}

function freshSeed(): Seed {
  return {
    log: [rollEvent(101, 'Kestrel', 'Perception'), talkEvent(102, 'Anyone see that drone?')],
    combatants: [
      combatant('cbt_1', 'Kestrel', 21, 'chr_1'),
      combatant('cbt_2', 'Hatchet', 17, 'chr_2'),
      combatant('cbt_3', 'Solstice', 11, 'chr_3'),
    ],
    turn: 2,
    pass: 1,
    activeCombatantId: 'cbt_1',
  };
}

let seed: Seed;
let calls: string[];
let socketsOpened: number;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function route(url: string): Response {
  if (url.includes(`/api/campaigns/${CAMPAIGN}/log`)) {
    // The route answers NEWEST FIRST — the client must put it back in order.
    return json({ events: [...seed.log].reverse() });
  }
  if (url === `/api/campaigns/${CAMPAIGN}/encounters`) {
    // NOTE: the list route carries no combatants. Trusting it alone is what
    // rendered "No combatants yet" over a fully staged fight.
    return json({
      encounters: [
        { id: 'enc_0', campaignId: CAMPAIGN, name: 'Old fight', state: 'done', turn: 6, pass: 1 },
        { id: 'enc_1', campaignId: CAMPAIGN, name: 'Rooftop ambush', state: 'live', turn: seed.turn, pass: seed.pass },
      ],
    });
  }
  if (url === '/api/encounters/enc_1') {
    return json({
      encounter: {
        id: 'enc_1',
        campaignId: CAMPAIGN,
        sceneId: 'scn_1',
        name: 'Rooftop ambush',
        state: 'live',
        turn: seed.turn,
        pass: seed.pass,
        activeCombatantId: null,
      },
      combatants: seed.combatants,
      activeCombatantId: seed.activeCombatantId,
      turnOrder: seed.combatants.map((c) => c.id),
      scope: 'gm',
      state: 'live',
      turn: seed.turn,
      pass: seed.pass,
    });
  }
  if (url === `/api/campaigns/${CAMPAIGN}/live`) {
    return json({ live: true, sessionId: 'ses_1', connected: 5 });
  }
  if (url === `/api/campaigns/${CAMPAIGN}/roll-tables`) {
    return json({ tables: [{ id: 'tbl_1', name: 'Street rumours', visibility: 'public', entries: [] }] });
  }
  if (url === `/api/campaigns/${CAMPAIGN}`) {
    return json({
      id: CAMPAIGN,
      name: 'Static on the Line',
      ingameDate: '2076-05-12',
      activeSceneId: 'scn_1',
      activeSessionId: 'ses_1',
    });
  }
  return json({ error: { code: 'not_found', message: `no route: ${url}` } }, 404);
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

// ---------------------------------------------------------------------------
// Rendering helpers — the real components, no DOM required
// ---------------------------------------------------------------------------

function renderLog(): string {
  const items = toLogItems(useLiveStore.getState().events);
  return renderToStaticMarkup(
    <div>
      {items.map((item) => (
        <LogLine key={item.id} item={item} />
      ))}
    </div>,
  );
}

function renderTracker(viewer: Viewer = GM): string {
  const encounter = useLiveStore.getState().encounter;
  const rows = trackerRows(encounter, viewer);
  return renderToStaticMarkup(
    <ul>
      {rows.map((row) => (
        <CombatantRow
          key={row.combatant.id}
          campaignId={CAMPAIGN}
          encounterId={encounter?.id ?? ''}
          row={row}
          isGm={viewer.role === 'gm'}
          rackVisibility="gm"
          onDamage={() => undefined}
          onOpenChain={() => undefined}
        />
      ))}
    </ul>,
  );
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  seed = freshSeed();
  calls = [];
  socketsOpened = 0;
  useLiveStore.getState().reset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      return route(url);
    }),
  );
  // Any WebSocket construction in this file is a test bug: these views must
  // paint from REST alone.
  vi.stubGlobal(
    'WebSocket',
    class {
      constructor() {
        socketsOpened += 1;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hydration on mount (LIVE-1)', () => {
  it('renders the session log from REST with zero WS traffic', async () => {
    expect(renderLog()).not.toContain('Kestrel'); // the bug's starting state

    await hydrateCampaign(CAMPAIGN, { qc: newClient() });

    const html = renderLog();
    expect(socketsOpened).toBe(0);
    expect(html).toContain('Kestrel');
    expect(html).toContain('Anyone see that drone?');
    expect(useLiveStore.getState().events.map((e) => e.id)).toEqual([101, 102]);
    expect(useLiveStore.getState().lastEventId).toBe(102);
  });

  it('keeps each backfilled roll expandable to its provenance breakdown (FR2.6)', async () => {
    await hydrateCampaign(CAMPAIGN, { qc: newClient() });
    const html = renderLog();
    expect(html).toContain('provenance');
    expect(html).toContain('Perception');
    expect(html).toContain('environment: light (-1)');
  });

  it('renders the staged combatants, in initiative order, with the acting highlight', async () => {
    expect(trackerRows(useLiveStore.getState().encounter, GM)).toHaveLength(0);

    await hydrateCampaign(CAMPAIGN, { qc: newClient() });

    const encounter = useLiveStore.getState().encounter;
    expect(encounter?.id).toBe('enc_1');
    expect(encounter?.combatants).toHaveLength(3);

    const rows = trackerRows(encounter, GM);
    expect(rows.map((r) => r.combatant.name)).toEqual(['Kestrel', 'Hatchet', 'Solstice']);
    expect(rows.map((r) => r.order)).toEqual([1, 2, 3]);
    expect(rows.filter((r) => r.acting).map((r) => r.combatant.name)).toEqual(['Kestrel']);

    const html = renderTracker();
    expect(socketsOpened).toBe(0);
    expect(html).toContain('Kestrel');
    expect(html).toContain('Hatchet');
    expect(html).toContain('Solstice');
    expect(html).toContain('acting');
  });

  it('shows the current turn and pass from the hydrated encounter', async () => {
    await hydrateCampaign(CAMPAIGN, { qc: newClient() });
    expect(passLabel(useLiveStore.getState().encounter)).toBe('TURN 2 · PASS 1');
  });

  it('hydrates the active scene, live mode and presence, and warms the tables cache', async () => {
    const qc = newClient();
    await hydrateCampaign(CAMPAIGN, { qc });
    const st = useLiveStore.getState();
    expect(st.activeSceneId).toBe('scn_1');
    expect(st.sessionLive).toBe(true);
    expect(st.activeSessionId).toBe('ses_1');
    expect(st.connectedCount).toBe(5);
    expect(qc.getQueryData(['roll-tables', CAMPAIGN])).toHaveLength(1);
    expect(st.hydration).toEqual({
      campaign: 'ready',
      log: 'ready',
      encounter: 'ready',
      session: 'ready',
      tables: 'ready',
    });
  });

  it('marks a slice that failed as error, not as empty, and keeps the others', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/log')) return json({ error: { code: 'forbidden', message: 'no' } }, 403);
        return route(url);
      }),
    );

    await hydrateCampaign(CAMPAIGN, { qc: newClient() });
    const st = useLiveStore.getState();
    expect(st.hydration.log).toBe('error');
    expect(st.hydration.encounter).toBe('ready');
    expect(st.encounter?.combatants).toHaveLength(3);
  });
});

describe('live events merged on top of a hydrated snapshot', () => {
  it('adds a new roll once and leaves the backfilled ones alone', async () => {
    await hydrateCampaign(CAMPAIGN, { qc: newClient() });
    useLiveStore.getState().applyEvent(rollEvent(103, 'Solstice', 'Sneaking'));

    const html = renderLog();
    expect(occurrences(html, 'Kestrel')).toBe(1);
    expect(occurrences(html, 'Solstice')).toBe(1);
    expect(useLiveStore.getState().events.map((e) => e.id)).toEqual([101, 102, 103]);
  });

  it('never double-applies a replayed event', async () => {
    await hydrateCampaign(CAMPAIGN, { qc: newClient() });
    const live = rollEvent(103, 'Solstice', 'Sneaking');
    useLiveStore.getState().applyEvent(live);
    // Reconnect replay: the hub resends from last_event_id, and hydration
    // repeats the whole window.
    useLiveStore.getState().applyEvent(live);
    seed.log = [...seed.log, live];
    await hydrateCampaign(CAMPAIGN, { qc: newClient(), force: true });

    expect(useLiveStore.getState().events.map((e) => e.id)).toEqual([101, 102, 103]);
    expect(occurrences(renderLog(), 'Solstice')).toBe(1);
  });

  it('lets a live encounter.updated win over the hydrated snapshot', async () => {
    await hydrateCampaign(CAMPAIGN, { qc: newClient() });
    useLiveStore.getState().applyEvent({
      id: 200,
      type: 'encounter.updated',
      visibility: 'public',
      ts: '2076-05-12T20:20:00.000Z',
      payload: {
        encounter: {
          id: 'enc_1',
          campaignId: CAMPAIGN,
          name: 'Rooftop ambush',
          state: 'live',
          turn: 3,
          pass: 2,
          activeCombatantId: 'cbt_2',
          combatants: seed.combatants,
        },
      },
    });
    expect(passLabel(useLiveStore.getState().encounter)).toBe('TURN 3 · PASS 2');
  });
});

describe('reconnect re-hydration', () => {
  it('picks up everything that happened while the socket was down', async () => {
    await hydrateCampaign(CAMPAIGN, { qc: newClient() });
    expect(useLiveStore.getState().events).toHaveLength(2);

    // The phone loses Wi-Fi; the table plays on.
    const store = useLiveStore.getState();
    store.setStatus('online');
    store.setStatus('offline');
    seed.log = [...seed.log, rollEvent(104, 'Hatchet', 'Sneaking'), talkEvent(105, 'Clear.')];
    seed.combatants = [...seed.combatants, combatant('cbt_4', 'Redline', 8, 'chr_4')];
    seed.turn = 3;
    seed.pass = 2;
    seed.activeCombatantId = 'cbt_2';

    useLiveStore.getState().setStatus('online');
    expect(useLiveStore.getState().reconnectEpoch).toBe(1);

    await hydrateCampaign(CAMPAIGN, { qc: newClient(), force: true });

    const st = useLiveStore.getState();
    expect(st.events.map((e) => e.id)).toEqual([101, 102, 104, 105]);
    expect(st.encounter?.combatants).toHaveLength(4);
    expect(passLabel(st.encounter)).toBe('TURN 3 · PASS 2');

    const log = renderLog();
    expect(occurrences(log, 'Kestrel')).toBe(1);
    expect(log).toContain('Clear.');
    const tracker = renderTracker();
    expect(tracker).toContain('Redline');
    // Four rows, not seven: re-hydration replaces the roster, never appends.
    expect(occurrences(tracker, '<li')).toBe(4);
    expect(occurrences(tracker, 'Initiative score for Kestrel')).toBe(1);
    expect(socketsOpened).toBe(0);
  });

  it('bypasses the query cache when forced, and uses it when not', async () => {
    const qc = newClient();
    qc.setDefaultOptions({ queries: { retry: false } });
    await hydrateCampaign(CAMPAIGN, { qc });
    const first = calls.length;

    // Not forced and inside the freshness window: no second round trip.
    await hydrateCampaign(CAMPAIGN, { qc });
    expect(calls.length).toBe(first);

    // A reconnect must actually re-read.
    await hydrateCampaign(CAMPAIGN, { qc, force: true });
    expect(calls.length).toBeGreaterThan(first);
  });
});

describe('honest empty states', () => {
  it('says it is still reading before the server has answered', () => {
    expect(renderToStaticMarkup(<LogEmptyLine asked={false} failed={false} />)).toContain(
      'Loading the session log',
    );
    expect(
      renderToStaticMarkup(<TrackerEmptyLine asked={false} failed={false} hasEncounter={false} />),
    ).toContain('Loading the encounter');
  });

  it('says "empty" only once the server has answered with nothing', () => {
    expect(renderToStaticMarkup(<LogEmptyLine asked failed={false} />)).toContain(
      'The log is empty',
    );
    expect(
      renderToStaticMarkup(<TrackerEmptyLine asked failed={false} hasEncounter />),
    ).toContain('No combatants yet');
    expect(
      renderToStaticMarkup(<TrackerEmptyLine asked failed={false} hasEncounter={false} />),
    ).toContain('No live encounter');
  });

  it('says a failed read failed instead of pretending the table was quiet', () => {
    expect(renderToStaticMarkup(<LogEmptyLine asked failed />)).toContain('Could not load');
    expect(
      renderToStaticMarkup(<TrackerEmptyLine asked failed hasEncounter />),
    ).toContain('Could not read');
  });
});
