/**
 * FR5.6 — the codex ↔ archetype link.
 *
 * The link is one column, `npc_templates.wiki_page_id`, and everything worth
 * testing follows from that being single-valued and read in both directions:
 *
 *  - a page shows the templates that claim it, and only those;
 *  - linking is a round trip — link, the page reports it, unlink, it is gone;
 *  - a player is never shown any of it.
 *
 * The round trip runs against a stand-in server that stores the one column, so
 * it exercises the real hooks (`useLinkTemplate` / `useUnlinkTemplate` / the
 * page read) rather than asserting that a mock was called.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NpcTemplate } from '@safehouse/contracts';
import TemplatePanel from './TemplatePanel.js';
import type { CodexPage, TemplateLink } from './api.js';
import {
  describeFollow,
  generatorPathFor,
  isLinkedTo,
  linkableTemplates,
  linkedTemplates,
  roleTagLine,
} from './templates.js';
import { pickInitialTemplate } from '../gm/generator/GeneratePanel.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PAGE_ID = 'page-1';

function link(over: Partial<TemplateLink> = {}): TemplateLink {
  return {
    templateId: 'tpl-1',
    name: 'Rusting Crown enforcer',
    roleTags: ['muscle', 'ganger'],
    wikiPageId: PAGE_ID,
    hasPageRef: false,
    ...over,
  };
}

function page(templates: TemplateLink[] | undefined): CodexPage {
  return {
    id: PAGE_ID,
    campaignId: 'camp-1',
    kind: 'faction',
    title: 'The Rusting Crown',
    tags: [],
    visibility: 'gm',
    contentMd: '',
    sections: [],
    links: { resolved: [], unresolved: [] },
    backlinks: [],
    refs: [],
    handouts: [],
    createdAt: '2076-05-12T00:00:00.000Z',
    ...(templates ? { templates } : {}),
  } as unknown as CodexPage;
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

describe('the link is read in both directions', () => {
  /**
   * The reciprocal IS the link. There is no state where a page claims a
   * template that does not claim it back, because there is only one column.
   */
  it('shows only the templates that name this page', () => {
    const mine = link();
    const moved = link({ templateId: 'tpl-2', name: 'Elsewhere', wikiPageId: 'page-2' });
    const loose = link({ templateId: 'tpl-3', name: 'Unlinked', wikiPageId: null });
    expect(isLinkedTo(mine, PAGE_ID)).toBe(true);
    expect(isLinkedTo(moved, PAGE_ID)).toBe(false);
    expect(linkedTemplates([mine, moved, loose], PAGE_ID).map((t) => t.templateId)).toEqual([
      'tpl-1',
    ]);
  });

  it('treats an absent list as no links, not as a crash', () => {
    expect(linkedTemplates(undefined, PAGE_ID)).toEqual([]);
  });
});

describe('the pool a page can claim from', () => {
  const all: NpcTemplate[] = [
    { id: 'tpl-2', name: 'Zeta courier', gen: { roleTags: ['face'], tiers: [] } },
    { id: 'tpl-1', name: 'Rusting Crown enforcer' },
    { id: 'tpl-3', name: 'Acid rain sniper', gen: { roleTags: ['sniper'], tiers: [] } },
  ] as unknown as NpcTemplate[];

  it('drops what is already here and orders the rest by name', () => {
    const options = linkableTemplates(all, [link()]);
    expect(options.map((o) => o.name)).toEqual(['Acid rain sniper', 'Zeta courier']);
    expect(options[0]?.roleTags).toEqual(['sniper']);
  });

  it('survives a template with no gen block at all', () => {
    expect(linkableTemplates(all, []).find((o) => o.id === 'tpl-1')?.roleTags).toEqual([]);
    expect(linkableTemplates(undefined, [])).toEqual([]);
  });
});

describe('following the link out', () => {
  it('goes to the opposition kit carrying the template id', () => {
    expect(generatorPathFor('camp-1', 'tpl-1')).toBe('/c/camp-1/gm/generator?template=tpl-1');
  });

  it('names where it goes and what it is', () => {
    expect(describeFollow(link())).toContain('Rusting Crown enforcer');
    expect(describeFollow(link())).toContain('muscle · ganger');
    expect(describeFollow(link({ roleTags: [] }))).not.toContain('(');
    expect(roleTagLine([])).toBe('');
  });

  it('lands the GM on that archetype, not just on the generator', () => {
    // The other half of FR5.6's "one graph, not three": the codex page names
    // the template, the generator opens on it. Before this the link loaded the
    // list and left the GM to find the row again.
    const templates = [{ id: 'tpl-0' }, { id: 'tpl-1' }, { id: 'tpl-2' }];
    expect(pickInitialTemplate(templates, 'tpl-1')).toBe('tpl-1');
  });

  it('falls back to the first archetype when the link has gone stale', () => {
    // Templates are GM data: one can be deleted between the page that links to
    // it and the tap that follows. A panel stuck on a missing id has no tiers
    // and a dead Generate button, which is worse than losing the deep link.
    const templates = [{ id: 'tpl-0' }, { id: 'tpl-2' }];
    expect(pickInitialTemplate(templates, 'tpl-deleted')).toBe('tpl-0');
    expect(pickInitialTemplate(templates, undefined)).toBe('tpl-0');
    expect(pickInitialTemplate([], 'tpl-1')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function render(node: React.ReactNode, qc = new QueryClient()): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the panel', () => {
  it('lists the page’s archetypes with a follow link and role tags', () => {
    const html = render(
      <TemplatePanel campaignId="camp-1" page={page([link()])} isGm />,
    );
    expect(html).toContain('/c/camp-1/gm/generator?template=tpl-1');
    expect(html).toContain('muscle · ganger');
    expect(html).toContain('aria-label="Unlink the Rusting Crown enforcer archetype from this page"');
  });

  it('says the column is singular before a GM discovers it the hard way', () => {
    // Rendered only once the picker is open, so read the closed state first.
    const closed = render(<TemplatePanel campaignId="camp-1" page={page([])} isGm />);
    expect(closed).toContain('link an archetype');
    expect(closed).toContain('No archetype points at this page yet');
  });

  /**
   * Not a hidden button: `templates` is absent from a player's response
   * entirely (the server cuts it — Principle 4), so there is nothing to render
   * and nothing a client bug could reveal.
   */
  it('renders nothing for a player, who never receives the field', () => {
    expect(render(<TemplatePanel campaignId="camp-1" page={page(undefined)} isGm={false} />)).toBe(
      '',
    );
    // Even a GM whose response somehow lacked the field gets no panel rather
    // than an empty one claiming there are no archetypes.
    expect(render(<TemplatePanel campaignId="camp-1" page={page(undefined)} isGm />)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The round trip
// ---------------------------------------------------------------------------

describe('page ↔ template round trip', () => {
  /**
   * A stand-in for the one column. `POST /api/wiki/:id/templates` sets it,
   * `DELETE …/:templateId` clears it, and `GET /api/wiki/:id` reports the
   * reverse lookup — which is exactly what the server does.
   */
  function fakeServer() {
    const wikiPageId = new Map<string, string | null>([
      ['tpl-1', null],
      ['tpl-2', 'page-2'],
    ]);
    const names: Record<string, string> = { 'tpl-1': 'Enforcer', 'tpl-2': 'Courier' };
    const linkFor = (id: string): TemplateLink => ({
      templateId: id,
      name: names[id] ?? id,
      roleTags: [],
      wikiPageId: wikiPageId.get(id) ?? null,
      hasPageRef: false,
    });
    return {
      linkFor,
      pageDto: (id: string) =>
        page([...wikiPageId.keys()].map(linkFor).filter((l) => l.wikiPageId === id)),
      async fetch(url: string, init?: RequestInit) {
        const method = init?.method ?? 'GET';
        const wiki = /^\/api\/wiki\/([^/]+)\/templates(?:\/([^/]+))?$/.exec(url);
        if (wiki && method === 'POST') {
          const body = JSON.parse(String(init?.body)) as { templateId: string };
          wikiPageId.set(body.templateId, wiki[1]!);
          return json({ link: linkFor(body.templateId) }, 201);
        }
        if (wiki && method === 'DELETE') {
          const id = wiki[2]!;
          if (wikiPageId.get(id) !== wiki[1]) return json({ error: { code: 'not_linked', message: 'no' } }, 409);
          wikiPageId.set(id, null);
          return json({ link: linkFor(id) });
        }
        throw new Error(`unexpected ${method} ${url}`);
      },
    };
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('links, reports the link on the page, then unlinks it away again', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => server.fetch(url, init));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { useLinkTemplate, useUnlinkTemplate } = await import('./api.js');
    const { result } = await runHooks(qc, () => ({
      link: useLinkTemplate('camp-1', PAGE_ID),
      unlink: useUnlinkTemplate('camp-1', PAGE_ID),
    }));

    // The page starts with nothing on it.
    expect(server.pageDto(PAGE_ID).templates).toEqual([]);

    const linked = await result.link.mutateAsync('tpl-1');
    // The template itself now names the page — that is the whole link.
    expect(linked.wikiPageId).toBe(PAGE_ID);
    // …and the page finds it by reverse lookup.
    expect(server.pageDto(PAGE_ID).templates?.map((t) => t.templateId)).toEqual(['tpl-1']);
    expect(linkedTemplates(server.pageDto(PAGE_ID).templates, PAGE_ID)).toHaveLength(1);

    const unlinked = await result.unlink.mutateAsync('tpl-1');
    expect(unlinked.wikiPageId).toBeNull();
    expect(server.pageDto(PAGE_ID).templates).toEqual([]);
  });

  it('moves a template that already belongs to another page, rather than cloning it', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => server.fetch(url, init));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { useLinkTemplate } = await import('./api.js');
    const { result } = await runHooks(qc, () => ({ link: useLinkTemplate('camp-1', PAGE_ID) }));

    expect(server.pageDto('page-2').templates?.map((t) => t.templateId)).toEqual(['tpl-2']);
    await result.link.mutateAsync('tpl-2');
    // One column: the old page loses it as the new one gains it. A template in
    // two places at once would be the bug this shape rules out.
    expect(server.pageDto('page-2').templates).toEqual([]);
    expect(server.pageDto(PAGE_ID).templates?.map((t) => t.templateId)).toEqual(['tpl-2']);
  });
});

/**
 * Minimal hook harness: render a component that publishes its hook results,
 * with no DOM. `renderToStaticMarkup` runs the render pass, which is all a
 * mutation hook needs to exist — the mutations themselves are awaited after.
 */
async function runHooks<T>(qc: QueryClient, use: () => T): Promise<{ result: T }> {
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
  return { result: captured as T };
}
