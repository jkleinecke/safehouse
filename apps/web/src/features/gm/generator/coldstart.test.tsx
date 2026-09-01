/**
 * The generator's cold start (M10 / G9 — "opposition in minutes, not
 * evenings").
 *
 * A GM who creates their own campaign has zero archetypes, and until now the
 * Opposition Kit expressed that as a select reading "— no archetypes yet —"
 * over a disabled Generate button. Nothing there said what an archetype is,
 * where one comes from, or that hand-authoring attribute curves was the only
 * way forward. Everything below pins the path out of that state:
 *
 *   empty → install the starter library → the picker lists them → generate →
 *   a result card; and, at any point, fork one and tune the copy.
 *
 * The archetype used as a fixture ("Ripper crew") is ORIGINAL CONTENT written
 * for this test — §14 forbids book stat blocks and book archetype names, not
 * starter content.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenTemplate, NpcTemplate } from '@safehouse/contracts';
import { generateNpc } from '@safehouse/rules';
import { ApiError, queryClient } from '../../../api/client.js';
import GeneratePanel from './GeneratePanel.js';
import GeneratorWorkspace, { isTabId } from './GeneratorWorkspace.js';
import ResultCard from './ResultCard.js';
import StarterLibrary from './StarterLibrary.js';
import TemplateEditor from './TemplateEditor.js';
import { useGenerateNpc } from './api.js';
import { duplicateDraft } from './drafts.js';
import {
  installedStarterKeys,
  missingStarterKeys,
  normalizeCatalog,
  useInstallStarters,
} from './starters.js';

const CAMP = 'camp-1';

// ---------------------------------------------------------------------------
// Fixtures — original content, ranges only, no stat block anywhere
// ---------------------------------------------------------------------------

const r = (min: number, max: number) => ({ min, max });

function gen(): GenTemplate {
  const tier = (id: string, label: string, lo: number, hi: number) => ({
    id,
    label,
    attributes: {
      bod: r(lo, hi),
      agi: r(lo, hi),
      rea: r(lo, hi),
      str: r(lo, hi),
      wil: r(lo, hi),
      log: r(lo, hi),
      int: r(lo, hi),
      cha: r(lo, hi),
      edg: r(1, 2),
    },
    skills: { automatics: r(lo, hi), unarmed_combat: r(lo, hi) },
    professionalRating: r(lo - 1, lo),
    metatypeWeights: { human: 3, ork: 2 },
    loadout: [],
    spells: [],
    augments: [],
  });
  return { roleTags: ['muscle', 'ganger'], tiers: [tier('street', 'Street', 2, 3), tier('pro', 'Pro', 4, 5)] };
}

const RIPPERS: NpcTemplate = { id: 'tpl-rip', campaignId: CAMP, name: 'Ripper crew', gen: gen() };
const WIRE: NpcTemplate = { id: 'tpl-wire', campaignId: CAMP, name: 'Wire ghost', gen: gen() };

const CATALOG_PAYLOAD = {
  archetypes: [
    {
      key: 'ripper-crew',
      name: 'Ripper crew',
      summary: 'Street muscle in numbers — the first fight of a run gone loud.',
      roleTags: ['muscle', 'ganger'],
      tiers: [
        { id: 'street', label: 'Street' },
        { id: 'pro', label: 'Pro' },
      ],
    },
    {
      // Deliberately the other shape: an NpcTemplate-ish entry with `gen`.
      name: 'Wire ghost',
      description: 'A quiet infiltrator for the half of a run that is not a fight.',
      gen: { roleTags: ['decker'], tiers: [{ id: 'street', label: 'Street' }] },
    },
  ],
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * A stand-in for the library half of the server: it holds the catalog, copies
 * entries into a campaign store on install, and rolls a real NPC through the
 * rules engine for `/api/generator/npc` — so the result card is asserted
 * against an actually derivable sheet (D13), not a hand-typed one.
 */
function fakeServer(seeded: NpcTemplate[] = []) {
  const store = new Map(seeded.map((t) => [t.id, t]));
  let n = 0;

  /** starterId → row, exactly as `installedIndex` does it server-side. */
  const claimed = (): Map<string, NpcTemplate> => {
    const index = new Map<string, NpcTemplate>();
    for (const row of store.values()) {
      const id = (row.gen as unknown as Record<string, unknown> | undefined)?.['starterId'];
      if (typeof id === 'string' && !index.has(id)) index.set(id, row);
    }
    return index;
  };

  /** `toEntries` — the catalogue with this campaign's installed state on it. */
  const entries = () => {
    const index = claimed();
    return normalizeCatalog(CATALOG_PAYLOAD).map((a) => {
      const row = index.get(a.key);
      return {
        id: a.key,
        name: a.name,
        summary: a.summary,
        roleTags: a.roleTags,
        tiers: a.tiers,
        installed: Boolean(row),
        templateId: row?.id ?? null,
        installedAs: row?.name ?? null,
      };
    });
  };

  return {
    store,
    entries,
    async fetch(url: string, init?: RequestInit) {
      const method = init?.method ?? 'GET';
      if (url === `/api/campaigns/${CAMP}/archetype-library` && method === 'GET') {
        const list = entries();
        return json({
          entries: list,
          installedCount: list.filter((e) => e.installed).length,
          availableCount: list.filter((e) => !e.installed).length,
        });
      }
      if (url === `/api/campaigns/${CAMP}/npc-templates` && method === 'GET') {
        return json({ templates: [...store.values()] });
      }
      if (url === `/api/campaigns/${CAMP}/archetype-library/install` && method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}')) as { ids?: string[] };
        const index = claimed();
        const alreadyInstalled: string[] = [];
        const made: NpcTemplate[] = [];
        for (const a of normalizeCatalog(CATALOG_PAYLOAD)) {
          if (body.ids && body.ids.length > 0 && !body.ids.includes(a.key)) continue;
          // Idempotent, like the real route: an archetype already stamped into
          // this campaign is skipped rather than duplicated.
          if (index.has(a.key)) {
            alreadyInstalled.push(a.key);
            continue;
          }
          n += 1;
          const tpl: NpcTemplate = {
            id: `inst-${n}`,
            campaignId: CAMP,
            name: a.name,
            gen: { ...gen(), starterId: a.key } as unknown as GenTemplate,
          };
          store.set(tpl.id, tpl);
          made.push(tpl);
        }
        // 200, not 201: a repeat call legitimately creates nothing.
        return json({ installed: made, alreadyInstalled, entries: entries() });
      }
      if (url === '/api/generator/npc' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { tierId: string; seed: number };
        const npc = generateNpc(gen(), body.tierId, body.seed);
        return json({ seed: npc.seed, npc });
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
  };
}

function stub(server: { fetch: (u: string, i?: RequestInit) => Promise<Response> }) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => server.fetch(url, init));
}

function render(node: React.ReactNode, qc: QueryClient = queryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Render a probe component to get live hook handles; no DOM required. */
function hooks<T>(use: () => T, qc: QueryClient = queryClient): T {
  let captured: T | undefined;
  function Probe() {
    captured = use();
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
  return captured as T;
}

beforeEach(() => {
  queryClient.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// The empty state
// ---------------------------------------------------------------------------

describe('a campaign with no archetypes', () => {
  it('explains what an archetype is and offers both ways forward', () => {
    stub(fakeServer());
    queryClient.setQueryData(['campaign', CAMP, 'archetype-library'], normalizeCatalog(CATALOG_PAYLOAD));
    const html = render(
      <GeneratePanel
        campaignId={CAMP}
        templates={[]}
        isLoading={false}
        onAddEntry={() => {}}
        onBrowseLibrary={() => {}}
        onCreateOwn={() => {}}
      />,
    );
    expect(html).toContain('install the starter library (2 archetypes)');
    expect(html).toContain('create my own');
    expect(html).toContain('reusable recipe');
    expect(html).toContain('fully editable');
    // The bug this replaces: a select with one dead option and no explanation.
    expect(html).not.toContain('<select');
    expect(html).not.toContain('no archetypes yet —');
  });

  it('says "loading", never "you have none", while the list is in flight', () => {
    stub(fakeServer());
    const html = render(
      <GeneratePanel campaignId={CAMP} templates={[]} isLoading onAddEntry={() => {}} />,
    );
    expect(html).toContain('loading archetypes');
    expect(html).not.toContain('install the starter library');
  });

  it('still offers the editor when the server has no library route', () => {
    stub(fakeServer());
    queryClient.setQueryData(['campaign', CAMP, 'archetype-library'], []);
    queryClient.setQueryDefaults(['campaign', CAMP, 'archetype-library'], { retry: false });
    const state = queryClient.getQueryCache().find({ queryKey: ['campaign', CAMP, 'archetype-library'] });
    state?.setState({ status: 'error', error: new ApiError(404, 'not_found', 'nope') });
    const html = render(
      <GeneratePanel
        campaignId={CAMP}
        templates={[]}
        isLoading={false}
        onAddEntry={() => {}}
        onCreateOwn={() => {}}
      />,
    );
    expect(html).toContain('no starter library yet');
    expect(html).toContain('create my own');
  });

  it('lists the archetypes in the picker once they exist', () => {
    stub(fakeServer());
    const html = render(
      <GeneratePanel
        campaignId={CAMP}
        templates={[RIPPERS, WIRE]}
        isLoading={false}
        onAddEntry={() => {}}
        onBrowseLibrary={() => {}}
        onCreateOwn={() => {}}
        onDuplicateTemplate={() => {}}
      />,
    );
    expect(html).toContain('<select');
    expect(html).toContain('Ripper crew');
    expect(html).toContain('Wire ghost');
    // The tier dial and the seed are both on screen, not behind a disclosure.
    expect(html).toContain('Tier dial');
    expect(html).toContain('Seed');
    expect(html).toContain('duplicate');
    expect(html).not.toContain('install the starter library');
  });
});

// ---------------------------------------------------------------------------
// The library browser
// ---------------------------------------------------------------------------

describe('the library browser', () => {
  it('says what each archetype is for, its roles and its ladder', () => {
    stub(fakeServer());
    queryClient.setQueryData(['campaign', CAMP, 'archetype-library'], normalizeCatalog(CATALOG_PAYLOAD));
    const html = render(<StarterLibrary campaignId={CAMP} templates={[]} />);
    expect(html).toContain('the first fight of a run gone loud');
    expect(html).toContain('tier ladder: Street → Pro');
    expect(html).toContain('ganger');
    expect(html).toContain('install all 2 archetypes');
    expect(html).toContain('rename them, retune every range');
  });

  it('marks what is already here and offers to open it rather than re-add it', () => {
    stub(fakeServer());
    queryClient.setQueryData(['campaign', CAMP, 'archetype-library'], normalizeCatalog(CATALOG_PAYLOAD));
    const html = render(
      <StarterLibrary campaignId={CAMP} templates={[RIPPERS]} onEditTemplate={() => {}} />,
    );
    expect(html).toContain('installed');
    expect(html).toContain('open in editor');
    expect(html).toContain('install all 1 archetype<');
    expect(html).toContain('1 of 2 installed');
  });
});

// ---------------------------------------------------------------------------
// Installing
// ---------------------------------------------------------------------------

describe('installing the library', () => {
  it('copies every archetype into the campaign and tells the picker to refetch', async () => {
    const server = fakeServer();
    stub(server);
    // A picker that has already loaded (and found nothing) must not stay empty.
    queryClient.setQueryData(['campaign', CAMP, 'npc-templates'], []);

    const install = hooks(() => useInstallStarters(CAMP));
    const installed = await install.mutateAsync({});

    expect(installed.map((t) => t.name)).toEqual(['Ripper crew', 'Wire ghost']);
    expect([...server.store.values()]).toHaveLength(2);
    expect(
      queryClient.getQueryState(['campaign', CAMP, 'npc-templates'])?.isInvalidated,
    ).toBe(true);

    // …and the picker built from that list is no longer the empty state.
    const html = render(
      <GeneratePanel
        campaignId={CAMP}
        templates={installed}
        isLoading={false}
        onAddEntry={() => {}}
      />,
    );
    expect(html).toContain('Ripper crew');
    expect(html).not.toContain('install the starter library');
  });

  it('installs one row when the GM picks one row', async () => {
    const server = fakeServer();
    stub(server);
    const install = hooks(() => useInstallStarters(CAMP));
    const installed = await install.mutateAsync({ keys: ['wire-ghost'] });
    expect(installed.map((t) => t.name)).toEqual(['Wire ghost']);
    expect(server.store.size).toBe(1);
  });

  /**
   * A doubled click, or a GM coming back to the library tab a week later, must
   * not hand them two of everything. The server is idempotent on `starterId`;
   * this pins that the browser reads the second, empty response as "nothing
   * new" rather than as a failure.
   */
  it('adds nothing on a second install and stops offering what is already here', async () => {
    const server = fakeServer();
    stub(server);
    const install = hooks(() => useInstallStarters(CAMP));

    await install.mutateAsync({});
    const again = await install.mutateAsync({});

    expect(again).toEqual([]);
    expect(server.store.size).toBe(2);
    expect(server.entries().every((e) => e.installed)).toBe(true);
  });

  /** The library rows carry installed state, so they go stale on install too. */
  it('invalidates the library itself, not just the picker', async () => {
    stub(fakeServer());
    queryClient.setQueryData(['campaign', CAMP, 'archetype-library'], []);
    const install = hooks(() => useInstallStarters(CAMP));
    await install.mutateAsync({});
    expect(
      queryClient.getQueryState(['campaign', CAMP, 'archetype-library'])?.isInvalidated,
    ).toBe(true);
  });

  /**
   * The server tracks installs by a `starterId` stamp that survives a rename,
   * so a GM who renamed their copy is not offered a duplicate — and the shelf
   * says which row it became rather than pretending the entry is untouched.
   */
  it('still knows a renamed copy is installed, and says what it is called now', async () => {
    const server = fakeServer();
    stub(server);
    const install = hooks(() => useInstallStarters(CAMP));
    const [first] = await install.mutateAsync({ keys: ['ripper-crew'] });
    server.store.set(first!.id, { ...first!, name: 'Bleeders of Redmond' });

    // The server's own answer, unchanged by the rename.
    const catalog = normalizeCatalog({ entries: server.entries() });
    expect(catalog[0]?.installed).toBe(true);
    expect(catalog[0]?.installedAs).toBe('Bleeders of Redmond');
    expect(catalog[1]?.installed).toBe(false);

    // …and the shelf therefore offers only the one that is genuinely missing,
    // even though no template is called "Ripper crew" any more.
    const rows = [...server.store.values()];
    expect([...installedStarterKeys(catalog, rows)]).toEqual(['ripper-crew']);
    expect(missingStarterKeys(catalog, rows)).toEqual(['wire-ghost']);

    const html = render(
      <StarterLibrary campaignId={CAMP} templates={rows} onEditTemplate={() => {}} />,
    );
    expect(html).toContain('Starter library');
  });
});

// ---------------------------------------------------------------------------
// Duplicate and edit
// ---------------------------------------------------------------------------

describe('forking an installed archetype', () => {



  it('opens the editor already filled in', () => {
    stub(fakeServer([RIPPERS]));
    const html = render(
      <TemplateEditor campaignId={CAMP} initialDraft={duplicateDraft(RIPPERS, [RIPPERS])} />,
    );
    expect(html).toContain('value="Ripper crew (copy)"');
    expect(html).toContain('Tier dial');
    expect(html).toContain('Street');
    expect(html).toContain('automatics');
    // Unsaved fork: the button offers to create, not to overwrite.
    expect(html).toContain('create archetype');
  });

  it('offers the library from the editor when the campaign is bare', () => {
    stub(fakeServer());
    queryClient.setQueryData(['campaign', CAMP, 'npc-templates'], []);
    queryClient.setQueryData(['campaign', CAMP, 'archetype-library'], normalizeCatalog(CATALOG_PAYLOAD));
    const html = render(<TemplateEditor campaignId={CAMP} onBrowseLibrary={() => {}} />);
    expect(html).toContain('install the starter library');
    expect(html).toContain('reusable recipe');
  });
});

// ---------------------------------------------------------------------------
// The workspace that joins them up
// ---------------------------------------------------------------------------

describe('the opposition kit workspace', () => {
  it('points a bare campaign at the library and opens there on a deep link', () => {
    stub(fakeServer());
    queryClient.setQueryData(['campaign', CAMP, 'npc-templates'], []);
    queryClient.setQueryData(['campaign', CAMP, 'archetype-library'], normalizeCatalog(CATALOG_PAYLOAD));

    const landing = render(<GeneratorWorkspace campaignId={CAMP} />);
    expect(landing).toContain('Starter library');
    expect(landing).toContain('start here');
    // Landing on Generate still explains itself rather than showing a dial.
    expect(landing).toContain('install the starter library');

    const deep = render(<GeneratorWorkspace campaignId={CAMP} initialTab="library" />);
    expect(deep).toContain('the first fight of a run gone loud');
  });

  it('drops the "start here" nudge once the campaign has archetypes', () => {
    stub(fakeServer([RIPPERS]));
    queryClient.setQueryData(['campaign', CAMP, 'npc-templates'], [RIPPERS]);
    const html = render(<GeneratorWorkspace campaignId={CAMP} />);
    expect(html).not.toContain('start here');
    expect(html).toContain('Ripper crew');
  });

  it('only honours tab names it actually has', () => {
    expect(isTabId('library')).toBe(true);
    expect(isTabId('generate')).toBe(true);
    expect(isTabId('archetype-editor')).toBe(false);
    expect(isTabId(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Generate → a card
// ---------------------------------------------------------------------------

describe('the generate flow', () => {
  it('turns archetype + tier + seed into a playable result card', async () => {
    stub(fakeServer([RIPPERS]));
    const genHook = hooks(() => useGenerateNpc());
    const res = await genHook.mutateAsync({ templateId: RIPPERS.id, tierId: 'pro', seed: 12345 });

    expect(res.npc.tierId).toBe('pro');
    expect(res.npc.seed).toBe(res.seed);

    const html = render(
      <ResultCard
        npc={res.npc}
        campaignId={CAMP}
        templateId={RIPPERS.id}
        templateName={RIPPERS.name}
        gen={RIPPERS.gen}
      />,
    );
    expect(html).toContain(res.npc.name);
    expect(html).toContain(`seed ${res.npc.seed}`);
    expect(html).toContain('promote to template');
    // Derived by the engine, so the card is playable the moment it renders
    // (D13: stats are procedural and engine-valid).
    expect(html).toContain('d6');
    expect(html).toContain('defense');
    expect(html).toContain('automatics');
  });

  it('reproduces the same NPC from the same seed, which is what the seed is for', async () => {
    stub(fakeServer([RIPPERS]));
    const genHook = hooks(() => useGenerateNpc());
    const a = await genHook.mutateAsync({ templateId: RIPPERS.id, tierId: 'street', seed: 777 });
    const b = await genHook.mutateAsync({ templateId: RIPPERS.id, tierId: 'street', seed: 777 });
    expect(b.npc.name).toBe(a.npc.name);
    expect(b.npc.sheet.attributes).toEqual(a.npc.sheet.attributes);
  });
});
