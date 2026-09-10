/**
 * AI in the codex — the rules that make it safe to put an LLM next to the
 * campaign's memory.
 *
 * Four things are load-bearing and all four are tested here:
 *
 *  1. **Nothing is applied until the GM accepts.** Asking the Fixer performs
 *     one chat turn and reads back the draft row it made. It writes nothing —
 *     the round trip below asserts no `PATCH /api/wiki` happened until accept
 *     was called (Principle 8).
 *  2. **AI off is honest, not invisible.** With `LLM_BASE_URL` unset the status
 *     endpoint says `enabled: false`; the buttons stay on screen, disabled,
 *     carrying the reason and a link to the setting (NG7).
 *  3. **The spoiler guard is on the card, before accept** (FR12.19) — and it
 *     holds the accept button until the GM has acknowledged it.
 *  4. **The draft is grounded in THIS campaign** (R12/FR12.17): the prompt
 *     carries the page's kind, title, neighbours and body, and forbids link
 *     targets that do not exist.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client.js';
import type { AiGeneration } from '../../gm/fixer/api.js';
import { sectionOutline } from '../md.js';
import type { CodexPage } from '../api.js';
import { codexKeys } from '../keys.js';
import AiPanel from './AiPanel.js';
import NewPagePrompt from './NewPagePrompt.js';
import ProposalCard from './ProposalCard.js';
import {
  useAcceptAsNewPage,
  useApplyToPage,
  useCodexAsk,
  type CodexProposal,
} from './api.js';
import {
  applyProposal,
  askErrorLine,
  buildPrompt,
  diffLines,
  diffStat,
  disabledReason,
  headingLines,
  isStub,
  sectionRange,
  sectionText,
  titleFromBrief,
  type PageContext,
} from './lib.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const CAMPAIGN = 'camp-1';
const PAGE_ID = 'page-1';

const BODY = [
  '# The Rusting Crown',
  '',
  'A ganger crew running the docks.',
  '',
  '## The bar',
  '',
  'Cheap synthahol, expensive silence.',
  '',
  '## GM only',
  '',
  'The barkeep reports to Mr. Kessler.',
].join('\n');

function page(over: Partial<CodexPage> = {}): CodexPage {
  return {
    id: PAGE_ID,
    campaignId: CAMPAIGN,
    kind: 'faction',
    title: 'The Rusting Crown',
    tags: ['docks'],
    visibility: 'gm',
    contentMd: BODY,
    sections: [],
    links: { resolved: [], unresolved: [{ target: 'Kessler' }] },
    backlinks: [{ id: 'p2', title: 'Dockside', kind: 'location' }],
    refs: [],
    handouts: [],
    createdAt: '2076-05-12T00:00:00.000Z',
    ...over,
  } as unknown as CodexPage;
}

function ctxOf(over: Partial<PageContext> = {}): PageContext {
  return {
    title: 'The Rusting Crown',
    kind: 'faction',
    tags: ['docks'],
    contentMd: BODY,
    neighbours: ['Dockside', 'Mr. Kessler'],
    backlinks: ['Dockside'],
    unresolved: ['Kessler'],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Grounding: the prompt is about THIS campaign
// ---------------------------------------------------------------------------

describe('the prompt is grounded in this campaign', () => {
  it('names the page, its kind, its neighbours and its body', () => {
    const prompt = buildPrompt({ action: 'draft', ctx: ctxOf(), playerFacing: false });
    expect(prompt).toContain('The Rusting Crown');
    expect(prompt).toContain('Kind: faction');
    expect(prompt).toContain('Dockside');
    expect(prompt).toContain('Cheap synthahol');
    // The tool contract — this is what turns a chat turn into a reviewable draft.
    expect(prompt).toContain('call draft_wiki_page exactly once');
    expect(prompt).toContain('playerFacing: false');
  });

  it('asks for the spoiler scan when the table will read it', () => {
    const prompt = buildPrompt({ action: 'draft', ctx: ctxOf(), playerFacing: true });
    expect(prompt).toContain('playerFacing: true');
  });

  it('lets link suggestions choose only from pages that exist (FR5.3)', () => {
    const prompt = buildPrompt({ action: 'links', ctx: ctxOf(), playerFacing: false });
    expect(prompt).toContain('ONLY from the existing page titles listed above');
    expect(prompt).toContain('Dockside');
    expect(prompt).toContain('## See also');
  });

  it('expands one named section rather than the whole page', () => {
    const prompt = buildPrompt({
      action: 'expand',
      ctx: ctxOf({ sectionId: 'the-bar', sectionHeading: 'The bar' }),
      playerFacing: false,
    });
    expect(prompt).toContain('"The bar"');
    expect(prompt).toContain('Return ONLY that section');
  });

  it('carries the GM’s own steer', () => {
    const prompt = buildPrompt({
      action: 'summarise',
      ctx: ctxOf(),
      playerFacing: false,
      extra: 'lean on the Kessler feud',
    });
    expect(prompt).toContain('The GM adds: lean on the Kessler feud');
    expect(prompt).toContain('get_session_log');
  });

  it('turns a brief into a usable title, or gives up cleanly', () => {
    expect(titleFromBrief('The Sunken Anchor. A ganger bar.', 'fallback')).toBe('The Sunken Anchor');
    expect(titleFromBrief('', 'fallback')).toBe('fallback');
    expect(titleFromBrief('x'.repeat(200), 'fallback')).toBe('fallback');
  });
});

// ---------------------------------------------------------------------------
// Sections: the slugs the reveal controls use
// ---------------------------------------------------------------------------

describe('sections address the same slugs the GM reveals', () => {
  it('agrees with the page renderer’s outline', () => {
    expect(headingLines(BODY).map((h) => h.id)).toEqual(sectionOutline(BODY).map((s) => s.id));
  });

  it('numbers duplicate headings and ignores fenced code', () => {
    const md = ['## Notes', 'a', '```', '## Notes', '```', '## Notes', 'b'].join('\n');
    expect(headingLines(md).map((h) => h.id)).toEqual(['notes', 'notes-2']);
  });

  it('bounds a section at the next heading of the same level', () => {
    expect(sectionRange(BODY, 'the-bar')).toEqual({ start: 4, end: 8 });
    expect(sectionText(BODY, 'the-bar')).toContain('Cheap synthahol');
    expect(sectionText(BODY, 'the-bar')).not.toContain('GM only');
    expect(sectionRange(BODY, 'no-such-section')).toBeNull();
  });

  it('knows a stub from a written page', () => {
    expect(isStub('## Who\n\n## Where\n')).toBe(true);
    expect(isStub(BODY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Merging: the model never decides how much of the page it takes
// ---------------------------------------------------------------------------

describe('where a proposal lands is the GM’s choice', () => {
  it('replaces, appends, or splices one section', () => {
    expect(applyProposal(BODY, '# New', 'replace')).toBe('# New\n');
    expect(applyProposal(BODY, 'tail', 'append')).toContain('Mr. Kessler.\n\ntail\n');
    const spliced = applyProposal(BODY, '## The bar\n\nNow with a back room.', 'section', 'the-bar');
    expect(spliced).toContain('Now with a back room.');
    expect(spliced).not.toContain('Cheap synthahol');
    // Everything else survives — that is the point of splicing.
    expect(spliced).toContain('## GM only');
    expect(spliced).toContain('A ganger crew running the docks.');
  });

  it('falls back to appending when the section has been renamed away', () => {
    const out = applyProposal(BODY, '## Gone\n\ntext', 'section', 'vanished');
    expect(out).toContain('Cheap synthahol');
    expect(out).toContain('## Gone');
  });

  it('never writes an empty proposal over the page', () => {
    expect(applyProposal(BODY, '   ', 'replace')).toBe(BODY.trimEnd());
  });
});

describe('the diff the GM reads before accepting', () => {
  it('marks what would be added and what would be lost', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc');
    expect(diffStat(lines)).toEqual({ added: 1, removed: 1 });
    expect(lines.find((l) => l.kind === 'add')?.text).toBe('B');
    expect(lines.find((l) => l.kind === 'del')?.text).toBe('b');
  });

  it('is all additions for a page that does not exist yet', () => {
    expect(diffStat(diffLines('', 'one\ntwo'))).toEqual({ added: 2, removed: 0 });
  });
});

// ---------------------------------------------------------------------------
// AI off, honestly (NG7)
// ---------------------------------------------------------------------------

describe('AI off is a state, not a failure', () => {
  it('explains 503 ai_disabled instead of raising it', () => {
    expect(disabledReason({ enabled: false, models: null })).toContain('LLM_BASE_URL');
    expect(disabledReason(undefined, new ApiError(503, 'ai_disabled', 'off'))).toContain(
      'switched off',
    );
    expect(disabledReason({ enabled: true, models: { primary: 'p', fast: 'f' } })).toBeNull();
    // A box that is configured but broken is a DIFFERENT problem — telling the
    // GM "the Fixer is off" would send them to edit an env var that is fine.
    expect(disabledReason(undefined, new ApiError(502, 'llm_unreachable', 'no route'))).toBeNull();
  });

  it('keeps other failures readable rather than raw', () => {
    expect(askErrorLine(new ApiError(409, 'ai_busy', 'busy'))).toContain('previous request');
    expect(askErrorLine(new ApiError(500, 'llm_bad_response', 'garbage'))).toContain(
      'inference box did not answer',
    );
    expect(askErrorLine(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(node: React.ReactNode, qc: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('the panel on the page', () => {
  it('shows the buttons disabled WITH THE REASON when the Fixer is off', () => {
    const qc = client();
    qc.setQueryData(['fixer', 'status'], { enabled: false, models: null });
    const html = render(<AiPanel campaignId={CAMPAIGN} page={page({ contentMd: '' })} />, qc);

    // The affordance still exists — a GM must not conclude it was never built.
    expect(html).toContain('draft with the Fixer');
    expect(html).toContain('summarise the log');
    expect(html).toContain('suggest links');
    expect(html).toContain('disabled=""');
    expect(html).toContain('LLM_BASE_URL');
    expect(html).toContain(`/c/${CAMPAIGN}/gm/fixer`);
  });

  it('offers a fresh version rather than “draft” on a page already written', () => {
    const qc = client();
    qc.setQueryData(['fixer', 'status'], { enabled: true, models: { primary: 'p', fast: 'f' } });
    const html = render(<AiPanel campaignId={CAMPAIGN} page={page()} />, qc);
    expect(html).toContain('draft a fresh version');
  });

  it('offers the page’s own headings to expand once the Fixer is on', () => {
    const qc = client();
    qc.setQueryData(['fixer', 'status'], { enabled: true, models: { primary: 'p', fast: 'f' } });
    qc.setQueryData(codexKeys.pages(CAMPAIGN), [
      { id: 'p2', title: 'Dockside', kind: 'location', tags: [], visibility: 'public' },
    ]);
    const html = render(<AiPanel campaignId={CAMPAIGN} page={page()} />, qc);
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('The bar');
    expect(html).toContain('the table will read this');
  });

  it('surfaces a pending draft that was asked for from the Fixer chat', () => {
    // Hydrated from REST on mount, not from a live event (LIVE-1).
    const qc = client();
    qc.setQueryData(['fixer', 'status'], { enabled: true, models: { primary: 'p', fast: 'f' } });
    qc.setQueryData(['campaign', CAMPAIGN, 'generations', 'wiki_page'], [
      draftRow({ contentMd: '## The back room\n\nA card table and a shotgun.' }),
    ]);
    const html = render(<AiPanel campaignId={CAMPAIGN} page={page()} />, qc);
    expect(html).toContain('fixer proposal');
    expect(html).toContain('A card table and a shotgun.');
    // A draft with no recorded intent appends rather than replaces: the page's
    // own prose is still in the "after" side of the diff, not struck through.
    expect(html).toContain('Cheap synthahol');
    expect(html).toContain('aria-pressed="true">append to the page');
  });
});

describe('the browser pane’s “describe it” control', () => {
  it('stays visible and disabled with the reason when the Fixer is off', () => {
    const qc = client();
    qc.setQueryData(['fixer', 'status'], { enabled: false, models: null });
    const html = render(<NewPagePrompt campaignId={CAMPAIGN} />, qc);
    expect(html).toContain('ganger bar on the docks');
    expect(html).toContain('ask the fixer');
    expect(html).toContain('disabled=""');
    expect(html).toContain('LLM_BASE_URL');
    expect(html).toContain(`/c/${CAMPAIGN}/gm/fixer`);
  });
});

function draftRow(over: { contentMd?: string; spoilerFlags?: unknown[] } = {}): AiGeneration {
  return {
    id: 'gen-1',
    campaignId: CAMPAIGN,
    kind: 'wiki_page',
    prompt: 'GM asked for a draft',
    model: 'local-7b',
    status: 'draft',
    createdAt: '2076-05-12T18:00:00.000Z',
    output: {
      title: 'The Rusting Crown',
      kind: 'faction',
      tags: ['docks'],
      contentMd: over.contentMd ?? '## The back room\n\nA card table and a shotgun.',
      playerFacing: over.spoilerFlags !== undefined,
      spoilerFlags: over.spoilerFlags ?? [],
    },
  };
}

function proposal(over: Partial<CodexProposal> = {}): CodexProposal {
  return {
    generationId: 'gen-1',
    action: 'draft',
    mode: 'append',
    title: 'The Rusting Crown',
    kind: 'faction',
    tags: ['docks'],
    contentMd: '## The back room\n\nA card table and a shotgun.',
    playerFacing: false,
    spoilerFlags: [],
    model: 'local-7b',
    createdAt: '2076-05-12T18:00:00.000Z',
    unverified: false,
    ...over,
  };
}

describe('the proposal card', () => {
  it('previews the draft against the page instead of applying it', () => {
    const html = render(
      <ProposalCard
        proposal={proposal()}
        currentMd={BODY}
        sections={[{ id: 'the-bar', heading: 'The bar' }]}
        onAccept={() => {}}
        onReject={() => {}}
      />,
      client(),
    );
    expect(html).toContain('A card table and a shotgun.');
    // The page's existing prose is still there, as context, unchanged.
    expect(html).toContain('Cheap synthahol');
    expect(html).toContain('Nothing is written until you accept.');
    expect(html).toContain('accept');
    expect(html).toContain('reject');
    expect(html).toContain('replace this section');
  });

  it('shows the spoiler guard and holds accept until it is acknowledged', () => {
    const html = render(
      <ProposalCard
        proposal={proposal({
          playerFacing: true,
          spoilerFlags: ['Mr. Kessler', 'the hidden sniper'],
        })}
        currentMd={BODY}
        onAccept={() => {}}
        onReject={() => {}}
      />,
      client(),
    );
    expect(html).toContain('spoiler guard — reveal or cut?');
    expect(html).toContain('Mr. Kessler');
    expect(html).toContain('the hidden sniper');
    expect(html).toContain('I have read these');
    expect(html).toContain('disabled=""');
  });

  it('says so when no draft row backs the text, rather than looking checked', () => {
    const html = render(
      <ProposalCard
        proposal={proposal({ generationId: null, unverified: true })}
        currentMd={BODY}
        onAccept={() => {}}
        onReject={() => {}}
      />,
      client(),
    );
    expect(html).toContain('no draft row');
    expect(html).toContain('spoiler guard never ran');
  });
});

// ---------------------------------------------------------------------------
// The round trip against a stand-in server
// ---------------------------------------------------------------------------

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

/**
 * A stand-in for the four routes this feature touches. It records every call,
 * which is how "nothing was written" is asserted rather than assumed.
 */
function fakeServer(opts: { toolCalled?: boolean } = {}) {
  const toolCalled = opts.toolCalled ?? true;
  const calls: Call[] = [];
  let generations: AiGeneration[] = [];
  return {
    calls,
    generations: () => generations,
    async fetch(url: string, init?: RequestInit) {
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, url, ...(body ? { body } : {}) });

      if (url.startsWith(`/api/campaigns/${CAMPAIGN}/generations`)) return json({ generations });
      if (url === '/api/fixer/chat') {
        if (toolCalled) generations = [draftRow(), ...generations];
        return json({ text: 'Drafted the back room.', model: 'local-7b' });
      }
      if (method === 'PATCH' && /^\/api\/wiki\/[^/]+$/.test(url)) {
        return json({ page: page({ contentMd: String(body?.['contentMd'] ?? '') }) });
      }
      if (method === 'POST' && /^\/api\/generations\/[^/]+\/reject$/.test(url)) {
        generations = [];
        return json({ generation: { id: 'gen-1', status: 'rejected' } });
      }
      if (method === 'POST' && /^\/api\/generations\/[^/]+\/accept$/.test(url)) {
        generations = [];
        return json({ generation: { id: 'gen-1', status: 'accepted' }, applied: { table: 'wiki_pages', id: 'page-new' } });
      }
      if (method === 'POST' && url === `/api/campaigns/${CAMPAIGN}/wiki`) {
        return json({ page: page({ id: 'page-created' }) }, 201);
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
  };
}

async function runHooks<T>(qc: QueryClient, use: () => T): Promise<T> {
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

describe('ask → preview → accept', () => {
  it('produces a proposal and writes NOTHING until accept is called', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => server.fetch(url, init));
    const qc = client();
    const hooks = await runHooks(qc, () => ({
      ask: useCodexAsk(CAMPAIGN),
      apply: useApplyToPage(CAMPAIGN, PAGE_ID),
    }));

    const result = await hooks.ask.mutateAsync({
      action: 'expand',
      ctx: ctxOf(),
      playerFacing: false,
      mode: 'append',
    });

    expect(result.generationId).toBe('gen-1');
    expect(result.unverified).toBe(false);
    expect(result.contentMd).toContain('A card table and a shotgun.');
    // Principle 8: the page has not been touched.
    expect(server.calls.some((c) => c.url.startsWith('/api/wiki/'))).toBe(false);

    const merged = applyProposal(BODY, result.contentMd, 'append');
    await hooks.apply.mutateAsync({ proposal: result, contentMd: merged });

    const patch = server.calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe(`/api/wiki/${PAGE_ID}`);
    expect(String(patch?.body?.['contentMd'])).toContain('A card table and a shotgun.');
    // …and the original prose survived the merge.
    expect(String(patch?.body?.['contentMd'])).toContain('Cheap synthahol');
    // The row is closed so the drafts inbox cannot apply it a SECOND time as a
    // duplicate page (the server's wiki applier only ever inserts).
    expect(server.calls.some((c) => c.url === '/api/generations/gen-1/reject')).toBe(true);
    expect(server.generations()).toEqual([]);
  });

  it('flags a turn that produced no draft row instead of pretending', async () => {
    const server = fakeServer({ toolCalled: false });
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => server.fetch(url, init));
    const qc = client();
    const hooks = await runHooks(qc, () => ({ ask: useCodexAsk(CAMPAIGN) }));

    const result = await hooks.ask.mutateAsync({
      action: 'draft',
      ctx: ctxOf(),
      playerFacing: true,
      mode: 'replace',
    });
    expect(result.generationId).toBeNull();
    expect(result.unverified).toBe(true);
    expect(result.contentMd).toBe('Drafted the back room.');
    expect(server.calls.some((c) => c.url.startsWith('/api/wiki/'))).toBe(false);
  });
});

describe('accepting as a brand-new page', () => {
  it('goes through the server’s applier when the GM did not touch it', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => server.fetch(url, init));
    const qc = client();
    const hooks = await runHooks(qc, () => ({ create: useAcceptAsNewPage(CAMPAIGN) }));

    const p = proposal();
    const id = await hooks.create.mutateAsync({
      proposal: p,
      contentMd: p.contentMd,
      title: p.title,
      kind: p.kind,
    });
    expect(id).toBe('page-new');
    expect(server.calls.some((c) => c.url === '/api/generations/gen-1/accept')).toBe(true);
    expect(server.calls.some((c) => c.url === `/api/campaigns/${CAMPAIGN}/wiki`)).toBe(false);
  });

  it('writes the GM’s edit, not the model’s original', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => server.fetch(url, init));
    const qc = client();
    const hooks = await runHooks(qc, () => ({ create: useAcceptAsNewPage(CAMPAIGN) }));

    const p = proposal();
    const id = await hooks.create.mutateAsync({
      proposal: p,
      contentMd: 'The GM rewrote all of it.',
      title: 'The Sunken Anchor',
      kind: 'location',
    });
    expect(id).toBe('page-created');
    const post = server.calls.find((c) => c.url === `/api/campaigns/${CAMPAIGN}/wiki`);
    expect(post?.body?.['contentMd']).toBe('The GM rewrote all of it.');
    expect(post?.body?.['visibility']).toBe('gm');
    // The server's accept would have written the model's text over the GM's.
    expect(server.calls.some((c) => c.url === '/api/generations/gen-1/accept')).toBe(false);
    expect(server.calls.some((c) => c.url === '/api/generations/gen-1/reject')).toBe(true);
  });
});
