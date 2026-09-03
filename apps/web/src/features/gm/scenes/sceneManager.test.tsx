/**
 * The Scenes manager, judged the way the GM judges it: can they see what they
 * have, tell which map the table is looking at, and act on it without knowing a
 * UUID or reading the source.
 *
 * There is no DOM in this package (no jsdom, no testing-library), so the render
 * half asserts on static markup and the behaviour half drives the very request
 * functions the hooks run, against a stub `fetch`. What must not regress:
 *
 *   1. the list is HYDRATED from REST — seeded scenes render on a cold mount;
 *   2. the live scene is unmistakable, and cannot be archived out from under
 *      the table;
 *   3. token counts come from the composed read, and say "counting" until then;
 *   4. the environment editor prints the engine's own modifier (FR9.11);
 *   5. create → activate → delete is one round trip against §12 routes;
 *   6. duplicating copies the authoring work but never the reveals (P4);
 *   7. an empty campaign gets a create form, not a blank card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Scene } from '@safehouse/contracts';
import ScenesPage from '../ScenesPage.js';
import { activateScene, createScene, deleteScene, duplicateScene, fogOp } from './api.js';
import {
  archiveBlockedReason,
  deleteWarning,
  describeGeometry,
  duplicateName,
  envReadout,
  normalizeDraft,
  sceneCounts,
  sortScenes,
  summarizeScene,
} from './summary.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Aztechnology loading dock',
    state: 'draft',
    grid: { unitM: 1, cols: 40, rows: 30, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    fog: { regions: [], revealed: [], revealedShapes: [] },
    levels: [],
    mapAttachmentIds: [],
    ...over,
  } as Scene;
}

const REGION_A = { id: 'r1', name: 'east wing', polygon: [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
] };
const REGION_B = { id: 'r2', name: 'the lab', polygon: [
  { x: 2, y: 2 },
  { x: 3, y: 2 },
  { x: 3, y: 3 },
] };

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

interface Composed {
  sceneId: string;
  tokens: { id: string; hidden?: boolean }[];
}

function renderPage(scenes: Scene[] | undefined, composed: Composed[] = []): string {
  const store = fakeStorage();
  store.setItem(
    'safehouse.session.gm',
    JSON.stringify({ token: 't', role: 'gm', campaignId: 'c1' }),
  );
  const prevLocal = Reflect.get(globalThis, 'localStorage');
  const prevTab = Reflect.get(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: fakeStorage(), configurable: true });
  try {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (scenes) qc.setQueryData(['scenes', 'c1'], scenes);
    for (const c of composed) {
      qc.setQueryData(['scene', c.sceneId], {
        scene: scenes?.find((s) => s.id === c.sceneId) ?? scene({ id: c.sceneId }),
        tokens: c.tokens,
        drawings: [],
      });
    }
    const tree: ReactNode = (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/c/c1/gm/scenes']}>
          <Routes>
            <Route path="/c/:campaignId/gm/scenes" element={<ScenesPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    return renderToStaticMarkup(tree);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: prevLocal, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: prevTab, configurable: true });
  }
}

// ---------------------------------------------------------------------------
// The list, hydrated from REST
// ---------------------------------------------------------------------------

describe('the scene list is the inventory the Grid panel never gave', () => {
  it('renders every seeded scene on a cold mount, with its map and its scale', () => {
    const html = renderPage([
      scene({ id: 's1', name: 'Aztechnology loading dock', mapAttachmentIds: ['att_1'] }),
      scene({
        id: 's2',
        name: 'Penumbra rooftop',
        state: 'active',
        grid: { unitM: 2, cols: 20, rows: 20, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
      }),
    ]);

    expect(html).toContain('data-scene-id="s1"');
    expect(html).toContain('data-scene-id="s2"');
    expect(html).toContain('Aztechnology loading dock');
    expect(html).toContain('2 scenes');
    // Scale is stated in the units SR5 measures in, not left implicit.
    expect(html).toContain('40 × 30 squares · 1 m per square · 40 × 30 m');
    expect(html).toContain('20 × 20 squares · 2 m per square · 40 × 40 m');
    // The map preview resolves to the file route, not a broken placeholder —
    // and carries the device token, because `/files/:id` is authenticated and
    // an <img> cannot send a header. Without it the GM got a 401 and a broken
    // thumbnail on a campaign whose map was sitting in the store.
    expect(html).toContain('src="/files/att_1?token=t"');
    expect(html).toContain('data-testid="no-map"');
  });

  it('marks the live scene, names it at the top, and blocks archiving it', () => {
    const html = renderPage([
      scene({ id: 's1', name: 'Rooftop' }),
      scene({ id: 's2', name: 'The lab', state: 'active' }),
    ]);

    expect(html).toContain('data-scene-state="live"');
    expect(html).toContain('data-testid="live-badge"');
    expect(html).toContain('on the table · The lab');
    // The card for the live scene offers no second activation…
    expect(html).toContain('on the table</button>');
    // …and archive is refused with the move that comes first.
    expect(html).toContain('activate another scene first');
  });

  it('says nothing is on the table when no scene is active', () => {
    const html = renderPage([scene({ id: 's1', name: 'Rooftop' })]);
    expect(html).toContain('nothing on the table — activate a scene');
    expect(html).not.toContain('data-scene-state="live"');
  });

  it('counts tokens from the composed read and admits when it has not landed', () => {
    const html = renderPage(
      [scene({ id: 's1' }), scene({ id: 's2', name: 'Unread' })],
      [{ sceneId: 's1', tokens: [{ id: 't1' }, { id: 't2', hidden: true }, { id: 't3' }] }],
    );
    expect(html).toMatch(/data-testid="token-count"[^>]*>3 · 1 hidden</);
    // The scene whose read has not resolved must not claim a confident zero.
    expect(html).toContain('counting…');
  });

  it('inventories fog regions and which of them are open', () => {
    const html = renderPage([
      scene({ id: 's1', fog: { regions: [REGION_A, REGION_B], revealed: ['r1'], revealedShapes: [] } }),
    ]);
    expect(html).toContain('1/2 revealed');
    expect(html).toContain('east wing');
    expect(html).toContain('data-region-state="revealed"');
    expect(html).toContain('data-region-state="hidden"');
    // Painting stays on the canvas; this screen only flips what exists.
    expect(html).toContain('regions are painted and named on the canvas');
  });

  it('links every card into the Grid and says which screen owns drawing', () => {
    const html = renderPage([scene({ id: 's1' })]);
    expect(html).toContain('data-testid="open-in-grid"');
    expect(html).toContain('href="/c/c1/grid"');
    expect(html).toContain('walls, fog painting and tokens are canvas work');
  });

  it('gives GM scene notes the only home they have in the app', () => {
    const html = renderPage([
      scene({ id: 's1', notes: 'The drone hears them before it sees them.' }),
      scene({ id: 's2', name: 'Blank' }),
    ]);
    expect(html).toContain('data-testid="scene-notes"');
    expect(html).toContain('GM notes · written');
    expect(html).toContain('GM notes · empty');
    expect(html).toContain('The drone hears them before it sees them.');
    // Secrecy is stated where the GM types, not buried in a doc (Principle 4).
    expect(html).toContain('the server strips notes out of every player and TV payload');
    // Nothing is written until the button is pressed.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>save notes<\/button>/);
  });

  it('archives are folded away, not mixed into the working list', () => {
    const html = renderPage([
      scene({ id: 's1', name: 'Rooftop' }),
      scene({ id: 's2', name: 'Old warehouse', state: 'archived' }),
    ]);
    expect(html).toContain('data-testid="archived-scenes"');
    expect(html).toContain('archived (1)');
    expect(html).toContain('data-scene-state="archived"');
  });

  it('an empty campaign gets a create form with the metres default, not a blank card', () => {
    const html = renderPage([]);
    expect(html).toContain('data-testid="scenes-empty"');
    expect(html).toContain('data-testid="create-scene"');
    expect(html).toContain('1 m per square unless your floor plan says otherwise');
    expect(html).toContain('put it on the table now');
    expect(html).not.toContain('data-testid="scene-card"');
    // Not the old placeholder.
    expect(html).not.toContain('Placeholder');
  });

  it('says "loading" rather than "no scenes" before the read lands', () => {
    const html = renderPage(undefined);
    expect(html).toContain('loading scenes');
    expect(html).not.toContain('data-testid="scenes-empty"');
  });

  /**
   * The bug this exists for, found by clicking the button in a real browser:
   * the metres field shipped `min="0.1" step="0.5"` and defaulted to 1, which
   * is not on that ladder. Chrome refuses to fire `submit` when a field fails
   * constraint validation, so "create scene" did NOTHING — no request, no
   * error, no card — while every assertion in this file stayed green, because
   * `renderToStaticMarkup` has no constraint validation to fail.
   *
   * Markup is all this package can see, so the rule is asserted on the markup:
   * the form opts out of native validation, and no number field ships a default
   * its own attributes reject.
   */
  it('the create form can actually submit: no native validation can swallow the click', () => {
    const html = renderPage([]);
    const form = /<form\b[^>]*>/.exec(html.slice(html.indexOf('data-testid="create-scene"')))?.[0];
    expect(form).toBeDefined();
    expect(form).toMatch(/\bnovalidate\b/i);

    for (const tag of html.match(/<input[^>]*type="number"[^>]*>/g) ?? []) {
      const attr = (name: string): string | null =>
        new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
      const value = Number(attr('value'));
      const min = attr('min');
      const step = attr('step');
      expect(Number.isFinite(value)).toBe(true);
      if (min !== null) expect(value).toBeGreaterThanOrEqual(Number(min));
      if (step !== null && step !== 'any') {
        // The browser's own rule: value must sit on (min ?? 0) + n·step.
        const base = min === null ? 0 : Number(min);
        const n = (value - base) / Number(step);
        expect(
          Math.abs(n - Math.round(n)) < 1e-9,
          `${attr('aria-label')} defaults to ${value}, which its own step=${step} rejects`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Environment (FR9.11)
// ---------------------------------------------------------------------------

describe('the environment editor shows the consequence, not just the setting', () => {
  it('prints the modifier the engine itself composes, beside the selects', () => {
    const html = renderPage([
      scene({
        id: 's1',
        state: 'active',
        environment: { light: 2, visibility: 0, glare: 0, wind: 2 },
      }),
    ]);
    expect(html).toContain('data-testid="environment-editor"');
    // Two axes at the worst level escalate a tier: −6, straight from the engine.
    expect(html).toContain('data-env-value="-6"');
    expect(html).toContain('environment: light 2, wind 2');
    expect(html).toContain('applied to every roll while this scene is live');
    // And the card summarises it without opening anything.
    expect(html).toContain('data-testid="env-chip"');
    expect(html).toContain('dim, strong wind');
  });

  it('a clear scene injects nothing and says so', () => {
    const html = renderPage([scene({ id: 's1', state: 'active' })]);
    expect(html).toContain('data-env-value="0"');
    expect(html).toContain('clear conditions — nothing is injected into rolls');
  });

  it('composes the same tiers the roll log will quote', () => {
    expect(envReadout({ light: 0, visibility: 0, glare: 0, wind: 0 }).clear).toBe(true);
    expect(envReadout({ light: 1, visibility: 0, glare: 0, wind: 0 }).value).toBe(-1);
    expect(envReadout({ light: 2, visibility: 0, glare: 0, wind: 0 }).value).toBe(-3);
    expect(envReadout({ light: 3, visibility: 0, glare: 0, wind: 0 }).value).toBe(-6);
    // Composition is the only route to −10.
    expect(envReadout({ light: 3, visibility: 3, glare: 0, wind: 0 }).value).toBe(-10);
    expect(envReadout({ light: 2, visibility: 0, glare: 0, wind: 2 }).contributors).toEqual([
      { axis: 'light', level: 2, label: 'dim' },
      { axis: 'wind', level: 2, label: 'strong wind' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Round trips against §12
// ---------------------------------------------------------------------------

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(reply: (call: Call) => unknown): Call[] {
  const calls: Call[] = [];
  const impl = async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const url = String(input);
    const raw = init?.body;
    const call: Call = {
      method: init?.method ?? 'GET',
      url,
      body: typeof raw === 'string' ? JSON.parse(raw) : (raw ?? null),
    };
    calls.push(call);
    const payload = reply(call);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(payload ?? {}),
    };
  };
  vi.stubGlobal('fetch', impl);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('create → activate → delete is one round trip a GM can complete', () => {
  it('creates with the calibrated square, activates it, then deletes it', async () => {
    const created = scene({ id: 'new-1', name: 'Alley behind the Stuffer Shack' });
    const calls = stubFetch((call) =>
      call.url.endsWith('/activate')
        ? { scene: { ...created, state: 'active' } }
        : { scene: created },
    );

    const made = await createScene('c1', {
      name: 'Alley behind the Stuffer Shack',
      grid: { unitM: 1.5, cols: 24, rows: 18, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
    });
    expect(made.id).toBe('new-1');

    const live = await activateScene(made.id);
    expect(live.state).toBe('active');

    await deleteScene(made.id);

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/campaigns/c1/scenes',
      'POST /api/scenes/new-1/activate',
      'DELETE /api/scenes/new-1',
    ]);
    expect(calls[0]?.body).toMatchObject({
      name: 'Alley behind the Stuffer Shack',
      grid: { unitM: 1.5, cols: 24, rows: 18 },
    });
  });

  it('reveals and re-fogs named regions through the fog route', async () => {
    const calls = stubFetch(() => ({ fog: { regions: [], revealed: [], revealedShapes: [] } }));

    await fogOp({ sceneId: 's1', op: 'reveal', regionId: 'r1', announce: true });
    await fogOp({ sceneId: 's1', op: 'hide' });

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: '/api/scenes/s1/fog',
      body: { op: 'reveal', regionId: 'r1', announce: true },
    });
    // A bare `hide` is the server's "re-fog everything", so no regionId rides.
    expect(calls[1]?.body).toEqual({ op: 'hide' });
  });

  it('duplicating copies the authoring work and none of the reveals', async () => {
    const source = scene({
      id: 's1',
      name: 'The lab',
      mapAttachmentIds: ['att_1#rot=90'],
      notes: 'gm only',
      environment: { light: 2, visibility: 0, glare: 0, wind: 0 },
      fog: { regions: [REGION_A, REGION_B], revealed: ['r1'], revealedShapes: [[]] },
    });
    const calls = stubFetch((call) =>
      call.url.endsWith('/fog')
        ? { fog: { regions: [], revealed: [], revealedShapes: [] } }
        : { scene: scene({ id: 'copy-1', name: 'The lab (copy)' }) },
    );

    const copy = await duplicateScene('c1', source, duplicateName('The lab', ['The lab']));
    expect(copy.id).toBe('copy-1');

    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/campaigns/c1/scenes' });
    expect(calls[0]?.body).toMatchObject({
      name: 'The lab (copy)',
      mapAttachmentIds: ['att_1#rot=90'],
      notes: 'gm only',
      environment: { light: 2 },
    });
    // Both regions are re-defined on the copy…
    expect(calls.slice(1).map((c) => c.url)).toEqual([
      '/api/scenes/copy-1/fog',
      '/api/scenes/copy-1/fog',
    ]);
    expect(calls[1]?.body).toMatchObject({ op: 'define', region: { id: 'r1', name: 'east wing' } });
    // …and nothing reveals them: a copy starts closed (Principle 4).
    const reveals = calls.filter((c) => JSON.stringify(c.body).includes('"reveal"'));
    expect(reveals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// List-level decisions
// ---------------------------------------------------------------------------

describe('list projections', () => {
  it('puts the live scene first, then drafts by name, then the archive', () => {
    const ordered = sortScenes([
      scene({ id: 'a', name: 'Zeta', state: 'archived' }),
      scene({ id: 'b', name: 'Beta' }),
      scene({ id: 'c', name: 'Alpha' }),
      scene({ id: 'd', name: 'Live one', state: 'active' }),
    ]).map((s) => s.name);
    expect(ordered).toEqual(['Live one', 'Alpha', 'Beta', 'Zeta']);
  });

  it('counts what the header claims', () => {
    expect(
      sceneCounts([
        scene({ id: 'a', state: 'active' }),
        scene({ id: 'b' }),
        scene({ id: 'c', state: 'archived' }),
      ]),
    ).toEqual({ total: 3, live: 1, drafts: 1, archived: 1 });
  });

  it('never proposes a duplicate name that already exists', () => {
    expect(duplicateName('Rooftop', ['Rooftop'])).toBe('Rooftop (copy)');
    expect(duplicateName('Rooftop', ['Rooftop', 'Rooftop (copy)'])).toBe('Rooftop (copy 2)');
    expect(duplicateName('Rooftop', ['rooftop (copy)', 'Rooftop (copy 2)'])).toBe('Rooftop (copy 3)');
  });

  it('summarises a scene without asking the server twice', () => {
    const s = scene({
      grid: { unitM: 1.5, cols: 10, rows: 8, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
      mapAttachmentIds: ['att_1#rot=90', 'att_2'],
      fog: { regions: [REGION_A, REGION_B], revealed: ['r2'], revealedShapes: [[]] },
      geometry: {
        walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }],
        doors: [],
        zones: [],
        pins: [{ id: 'p1', at: { x: 1, y: 1 }, visibility: 'gm' }],
      },
    });
    const summary = summarizeScene(s, { total: 4, hidden: 1 });
    expect(summary.widthM).toBe(15);
    expect(summary.heightM).toBe(12);
    expect(summary.mapRef).toBe('att_1#rot=90');
    expect(summary.mapCount).toBe(2);
    expect(summary.fogRevealed).toBe(1);
    expect(summary.freehandReveals).toBe(1);
    expect(summary.walls).toBe(1);
    expect(summary.pins).toBe(1);
    expect(summary.tokens).toEqual({ total: 4, hidden: 1 });
    // Geometry reads in words, and an empty scene says so instead of "0w 0d".
    expect(describeGeometry(summary)).toBe('1 wall · 1 pin');
    expect(describeGeometry(summarizeScene(scene()))).toBe('nothing drawn yet');
  });

  it('refuses to archive the live scene and explains the order of moves', () => {
    expect(archiveBlockedReason(summarizeScene(scene({ state: 'active' })))).toMatch(
      /activate another scene first/,
    );
    expect(archiveBlockedReason(summarizeScene(scene()))).toBeNull();
  });

  it('names what a delete takes with it, and warns harder when the table is on it', () => {
    const loaded = summarizeScene(
      scene({
        name: 'The lab',
        state: 'active',
        fog: { regions: [REGION_A], revealed: [], revealedShapes: [] },
      }),
      { total: 9, hidden: 2 },
    );
    const warning = deleteWarning(loaded);
    expect(warning).toContain('The lab');
    expect(warning).toContain('9 tokens');
    expect(warning).toContain('1 fog region');
    expect(warning).toMatch(/every player screen and the TV will go blank/);
    expect(deleteWarning(summarizeScene(scene()))).not.toMatch(/player screen/);
  });

  it('clamps a half-typed create form into something the server accepts', () => {
    expect(normalizeDraft({ name: '  Rooftop ', unitM: Number.NaN, cols: 0, rows: 12.4 })).toEqual({
      name: 'Rooftop',
      unitM: 1,
      cols: 1,
      rows: 12,
    });
  });
});
