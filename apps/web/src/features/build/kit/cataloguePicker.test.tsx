/**
 * The builder's catalogue picker, rendered to static markup, and the hook it
 * browses with (`CataloguePicker.tsx`, `useBuilderCatalogue.ts`). Invented
 * rows only (§14).
 *
 * Pinned: the list is labelled and full before anything is typed, with a
 * count ("Showing 2 of 30"), "show more" while pages remain, and honest words
 * while loading, for an empty campaign and for a search that found nothing;
 * each row carries the same summary as the sheet's add dialog, its page, its
 * price and Availability; a row over a campaign cap is listed greyed with the
 * number and why, its button refusing and tied to the sentence — or pickable
 * with the sentence as a warning when the step lets the GM decide; a row
 * already taken says so; read-only lists without buttons. The hook's request
 * is the campaign's books in browse mode, and pages it has are merged.
 */
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChargenSettingsSchema } from '@safehouse/contracts';
import type { CataloguePage } from '../../sheet/catalogue/api.js';
import { CAMPAIGN, catalogueHit } from '../testing.js';
import { CataloguePickerView, pickerCountLine, pickerRowGate, type CataloguePickerViewProps } from './CataloguePicker.js';
import { builderCatalogueKey, builderCataloguePath, useBuilderCatalogue, type BuilderCatalogue } from './useBuilderCatalogue.js';

const noop = () => undefined;
const CAPS = ChargenSettingsSchema.parse({});

const quietGland = catalogueHit({ id: 'w-1', kind: 'augmentation', category: 'BASIC BIOWARE', name: 'Quiet Gland', stats: { ESSENCE: '0.25' }, avail: '4', cost: 12000 });
const skullDeck = catalogueHit({ id: 'w-2', kind: 'augmentation', category: 'HEADWARE', name: 'Skull Deck', stats: { ESSENCE: '0.2' }, avail: '14F', cost: 40000, printedPage: 452 });

function view(over: Partial<CataloguePickerViewProps> = {}): string {
  const props: CataloguePickerViewProps = {
    kind: 'augmentation',
    query: '',
    onQuery: noop,
    hits: [quietGland, skullDeck],
    total: 30,
    hasMore: true,
    loading: false,
    loadingMore: false,
    error: null,
    onMore: noop,
    caps: CAPS,
    onPick: noop,
    testId: 'ware',
    ...over,
  };
  return renderToStaticMarkup(<CataloguePickerView {...props} />);
}

function rowOf(html: string, name: string): string {
  const rows = html.split('data-testid="ware-hit"').slice(1);
  const row = rows.find((r) => r.includes(`>${name}<`));
  if (!row) throw new Error(`no row ${name}`);
  return row;
}

describe('the catalogue picker', () => {
  it('lists the kind before anything is typed, counted, labelled, with more to show', () => {
    const html = view();
    expect(html).toContain('role="search"');
    expect(html).toContain('aria-label="Search cyberware &amp; bioware"');
    expect(html).toContain('Showing 2 of 30 cyberware &amp; bioware');
    expect(html).toMatch(/<ul[^>]*aria-label="cyberware &amp; bioware"[^>]*data-testid="ware-hits"/);
    expect(html).toMatch(/<button[^>]*aria-label="Show more cyberware &amp; bioware"[^>]*>show more<\/button>/);
    expect(view({ hasMore: false })).not.toContain('data-testid="ware-more"');
    expect(view({ loadingMore: true })).toMatch(/aria-disabled="true"[^>]*data-testid="ware-more"[^>]*>loading…</);
  });

  it('shows each row as the add dialog does, with its page, price and Availability', () => {
    const row = rowOf(view(), 'Quiet Gland');
    expect(row).toContain('basic bioware');
    expect(row).toContain('essence 0.25');
    expect(row).toContain('SR5 p.400');
    expect(row).toContain('12,000¥ · Availability 4');
    expect(row).toMatch(/<button[^>]*aria-label="add Quiet Gland"[^>]*>add<\/button>/);
    expect(row).toContain('data-over="no"');
  });

  it('greys a row over a cap with the number and why, its button refusing and tied to the sentence', () => {
    const row = rowOf(view(), 'Skull Deck');
    expect(row).toContain('data-over="yes"');
    expect(row).toContain("Availability 14 is over this campaign&#x27;s cap of 12.");
    expect(row).toContain('SR5 p.94');
    const button = /<button[^>]*data-testid="ware-pick"[^>]*>/.exec(row)![0];
    expect(button).toContain('aria-disabled="true"');
    // The cap sentence first; this Forbidden row's "needs the GM" note after it.
    const ids = /aria-describedby="([^"]+)"/.exec(button)![1]!.split(' ');
    expect(row).toMatch(new RegExp(`id="${ids[0]}"[^>]*data-testid="ware-refusal"`));
    for (const id of ids) expect(row).toContain(`id="${id}"`);
    // Muted, not hidden: the name is still there to read.
    expect(row).toContain('text-dim">Skull Deck<');
  });

  it('marks a Restricted or Forbidden row "needs the GM" on the row, with the page, tied to a button that still adds it', () => {
    const tagger = catalogueHit({ id: 'w-3', kind: 'augmentation', category: 'HEADWARE', name: 'Quiet Tagger', stats: { ESSENCE: '0.1' }, avail: '8R', cost: 900 });
    const blade = catalogueHit({ id: 'w-4', kind: 'augmentation', category: 'BODYWARE', name: 'Hush Blade', stats: { ESSENCE: '0.3' }, avail: '10F', cost: 2500 });
    const html = view({ hits: [quietGland, tagger, blade, skullDeck] });
    const restricted = rowOf(html, 'Quiet Tagger');
    expect(restricted).toContain('data-testid="ware-gm"');
    expect(restricted).toContain('Restricted: needs the GM.');
    expect(restricted).toContain('SR5 p.94');
    const button = /<button[^>]*data-testid="ware-pick"[^>]*>/.exec(restricted)![0];
    expect(button).not.toContain('aria-disabled');
    const ids = /aria-describedby="([^"]+)"/.exec(button)![1]!.split(' ');
    expect(ids).toHaveLength(1);
    expect(restricted).toMatch(new RegExp(`<p id="${ids[0]}"[^>]*data-testid="ware-gm"`));
    expect(rowOf(html, 'Hush Blade')).toContain('Forbidden: needs the GM.');
    // A legal row says nothing of the sort; an over-cap Forbidden row says both, both tied.
    expect(rowOf(html, 'Quiet Gland')).not.toContain('needs the GM');
    const over = rowOf(html, 'Skull Deck');
    expect(over).toContain('Forbidden: needs the GM.');
    expect(/aria-describedby="([^"]+)"/.exec(/<button[^>]*data-testid="ware-pick"[^>]*>/.exec(over)![0])![1]!.split(' ')).toHaveLength(2);
    expect(pickerRowGate(tagger, { caps: CAPS }).gm?.reason).toBe('Restricted: needs the GM.');
    expect(pickerRowGate(quietGland, { caps: CAPS }).gm).toBeNull();
    expect(pickerRowGate(catalogueHit({ kind: 'quality', name: 'Iron Calm', stats: { KARMA: '4' } }), { caps: CAPS }).gm).toBeNull();
  });

  it('shuts a row the step refuses before the tap, with the step’s sentence tied to the button', () => {
    const ritualCap = { reason: 'Rituals: 6 known; Magic 3 allows 6.', ref: { book: 'SR5', page: 99 } };
    const rowRefusal = (hit: { id: string }) => (hit.id === 'w-1' ? ritualCap : null);
    const html = view({ rowRefusal, allowOverCap: true });
    const row = rowOf(html, 'Quiet Gland');
    const button = /<button[^>]*data-testid="ware-pick"[^>]*>/.exec(row)![0];
    // Shut even where the step lets the GM decide the campaign's caps.
    expect(button).toContain('aria-disabled="true"');
    const id = /aria-describedby="([^"]+)"/.exec(button)![1]!.split(' ')[0]!;
    expect(row).toMatch(new RegExp(`id="${id}"[^>]*data-testid="ware-refusal"`));
    expect(row).toContain('Rituals: 6 known; Magic 3 allows 6.');
    expect(row).toContain('SR5 p.99');
    expect(row).toMatch(/<span aria-hidden="true" class="shrink-0">⛔<\/span>/);
    expect(pickerRowGate(quietGland, { caps: CAPS, rowRefusal }).canPick).toBe(false);
    expect(pickerRowGate(skullDeck, { caps: CAPS, rowRefusal, allowOverCap: true }).canPick).toBe(true);
    // A taken row is not asked.
    let asked = 0;
    pickerRowGate(quietGland, { caps: CAPS, taken: new Set(['w-1']), rowRefusal: () => (asked++, ritualCap) });
    expect(asked).toBe(0);
    // The search box is a 40 px target on touch.
    expect(/<input[^>]*type="search"[^>]*>/.exec(html)![0]).toContain('pointer-coarse:min-h-10');
  });

  it('lets a step leave an over-cap row to the GM, the sentence kept as a warning', () => {
    const row = rowOf(view({ allowOverCap: true }), 'Skull Deck');
    const button = /<button[^>]*data-testid="ware-pick"[^>]*>/.exec(row)![0];
    expect(button).not.toContain('aria-disabled');
    expect(button).toContain('aria-describedby');
    expect(row).toContain('Availability 14 is over');
  });

  it('reads caps at the grade a step chose', () => {
    expect(pickerRowGate(quietGland, { caps: CAPS }).over).toBe(false);
    const alpha = catalogueHit({ ...quietGland, avail: '11' });
    expect(pickerRowGate(alpha, { caps: CAPS }).over).toBe(false);
    expect(pickerRowGate(alpha, { caps: CAPS, grade: 'alphaware' }).refusals[0]?.reason).toBe("Availability 13 is over this campaign's cap of 12.");
  });

  it('says a row is already taken, and lists without buttons when read-only', () => {
    const taken = rowOf(view({ taken: new Set(['w-1']) }), 'Quiet Gland');
    expect(taken).toContain('data-taken="yes"');
    expect(taken).toContain('Quiet Gland is already on this runner.');
    expect(taken).toMatch(/aria-disabled="true"[^>]*>taken<\/button>/);
    const readOnly = view({ readOnly: true });
    expect(readOnly).not.toContain('data-testid="ware-pick"');
    expect(readOnly).toContain('Quiet Gland');
  });

  it('says what is happening while loading, for an empty campaign, a search with nothing, and an error', () => {
    expect(view({ loading: true, hits: [], total: null })).toContain('Loading cyberware &amp; bioware…');
    expect(pickerCountLine(0, 0, 'qualities', '')).toBe("This campaign's books list no qualities.");
    expect(pickerCountLine(0, 0, 'qualities', 'zzz')).toBe('No qualities match “zzz”.');
    expect(pickerCountLine(0, null, 'qualities', 'iron')).toBe('Looking for “iron”…');
    const empty = view({ hits: [], total: 0, hasMore: false, query: 'zzz' });
    expect(empty).not.toContain('data-testid="ware-hits"');
    expect(empty).toContain('No cyberware &amp; bioware match “zzz”.');
    expect(view({ error: new Error('the host fell over') })).toMatch(/role="alert"[^>]*>the host fell over</);
  });

  it('prices a quality in Karma and shows no Availability for it', () => {
    const html = view({
      kind: 'quality',
      hits: [catalogueHit({ id: 'q-1', kind: 'quality', category: 'POSITIVE QUALITIES', name: 'Iron Calm', stats: { KARMA: '4', PER: 'rating', MAX: '3', TYPE: 'positive' } })],
      label: 'qualities',
      pickLabel: 'take',
    });
    expect(html).toContain('4 Karma per rating, up to 3');
    expect(html).not.toContain('Availability');
    expect(html).toMatch(/aria-label="take Iron Calm"/);
  });
});

describe('useBuilderCatalogue', () => {
  it("asks for the campaign's books in browse mode, a page at a time", () => {
    const params = (path: string) => Object.fromEntries(new URL(path, 'http://x').searchParams);
    expect(params(builderCataloguePath({ campaignId: CAMPAIGN, kind: 'quality' }, 0))).toEqual({ kind: 'quality', campaignId: CAMPAIGN, limit: '25' });
    expect(params(builderCataloguePath({ campaignId: CAMPAIGN, kind: 'quality', q: ' iron ', limit: 50 }, 50))).toEqual({
      q: 'iron',
      kind: 'quality',
      campaignId: CAMPAIGN,
      offset: '50',
      limit: '50',
    });
    expect(builderCatalogueKey({ campaignId: CAMPAIGN, kind: 'quality', q: ' iron ' })).toEqual(['catalogue', 'builder', CAMPAIGN, 'quality', 'iron', 0, 25]);
  });

  it('merges the pages it holds and says whether more remain', () => {
    const seen: BuilderCatalogue[] = [];
    function Probe(): ReactNode {
      seen.push(useBuilderCatalogue({ campaignId: CAMPAIGN, kind: 'augmentation' }));
      return null;
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const pages: CataloguePage[] = [
      { query: '', hits: [quietGland], total: 3, offset: 0, limit: 1, hasMore: true },
      { query: '', hits: [skullDeck], total: 3, offset: 1, limit: 1, hasMore: true },
    ];
    qc.setQueryData(builderCatalogueKey({ campaignId: CAMPAIGN, kind: 'augmentation' }), { pages, pageParams: [0, 1] });
    renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    );
    const got = seen[seen.length - 1]!;
    expect(got.hits.map((h) => h.name)).toEqual(['Quiet Gland', 'Skull Deck']);
    expect(got.total).toBe(3);
    expect(got.hasMore).toBe(true);
    expect(got.loading).toBe(false);
  });
});

describe('the picker row at phone and laptop width', () => {
  it('stacks the summary with no flex sizing of its own, so a row is its content tall, and lets the stats wrap', () => {
    const gun = catalogueHit({ id: 'g-1', kind: 'weapon', category: 'HEAVY PISTOLS', name: 'Zap Gun', stats: { ACC: '6', DAMAGE: '6P', AP: '-', MODE: 'SA', RC: '-', AMMO: '15(c)' }, cost: 400 });
    const row = rowOf(view({ kind: 'weapon', hits: [gun] }), 'Zap Gun');
    // In a column a 10rem basis became a 10rem height: the summary in a picker row carries none.
    expect(row).toMatch(/flex-col gap-0\.5"><div class="min-w-0"><div class="flex flex-wrap items-baseline/);
    expect(row).not.toContain('basis-40');
    // The printed columns wrap rather than cut off at "MO…" on a phone.
    const stats = /<div class="mono-label text-dim ([^"]*)">([^<]*)<\/div>/.exec(row)!;
    expect(stats[1]).toBe('break-words');
    expect(stats[2]).toMatch(/6P/);
  });
});
