/**
 * The "add from the books" dialog: what a player sees while finding an item,
 * and what they see when there is nothing. Every row is invented (§14).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AddFromBooksView, type AddFromBooksViewProps } from './AddFromBooks.js';
import type { CatalogueHit } from './toSheet.js';

const hit: CatalogueHit = {
  id: 'i1',
  bookId: 'b1',
  bookCode: 'SR5',
  printedPage: 426,
  kind: 'weapon',
  category: 'HEAVY PISTOLS',
  name: 'Zap Gun',
  stats: { ACC: '5 (7)', DAMAGE: '8P', AP: '–1', MODE: 'SA', RC: '—', AMMO: '15 (c)' },
  avail: '5R',
  cost: 725,
  costText: null,
  title: 'Core',
  pdfPage: 431,
  ref: { book: 'SR5', page: 426 },
  readUrl: '/read/SR5?p=426',
};

const noop = () => undefined;
const base: AddFromBooksViewProps = {
  open: true,
  onClose: noop,
  query: 'zap',
  onQuery: noop,
  kinds: ['weapon'],
  kind: 'weapon',
  onKind: noop,
  hits: [hit],
  searching: false,
  error: null,
  recordSpend: true,
  onRecordSpend: noop,
  gm: false,
  custom: false,
  onCustom: noop,
  onAdd: noop,
  note: null,
  testId: 'add-weapon',
};

describe('the add-from-books dialog', () => {
  it('names the kind, lists a hit with its stats, its page and an add button', () => {
    const html = renderToStaticMarkup(<AddFromBooksView {...base} />);
    expect(html).toContain('Add weapons');
    expect(html).toContain('data-testid="add-weapon-hits"');
    expect(html).toContain('Zap Gun');
    expect(html).toContain('heavy pistols');
    expect(html).toContain('acc 5 (7) · damage 8P · ap –1 · mode SA · ammo 15 (c) · avail 5R · 725¥');
    expect(html).toContain('SR5 p.426');
    expect(html).toContain('aria-label="Add Zap Gun to the sheet"');
    expect(html).toContain('data-testid="add-weapon-spend"');
    expect(html).toContain('pending until the GM approves');
  });

  it('offers a kind filter only when the button covers more than one kind', () => {
    const one = renderToStaticMarkup(<AddFromBooksView {...base} />);
    expect(one).not.toContain('aria-label="Only this kind"');
    const many = renderToStaticMarkup(<AddFromBooksView {...base} kinds={['gear', 'ammo', 'electronics']} kind="" />);
    expect(many).toContain('aria-label="Only this kind"');
    expect(many).toContain('Add items');
  });

  it('words the spend for who is adding: a player proposes, the GM records', () => {
    expect(renderToStaticMarkup(<AddFromBooksView {...base} />)).toContain('pending until the GM approves');
    expect(renderToStaticMarkup(<AddFromBooksView {...base} gm />)).toContain('record the nuyen spend');
  });

  it('opens the write-your-own form with the fields of the kind', () => {
    const closed = renderToStaticMarkup(<AddFromBooksView {...base} />);
    expect(closed).toContain('or write your own');
    expect(closed).not.toContain('data-testid="add-weapon-custom"');
    const open = renderToStaticMarkup(<AddFromBooksView {...base} custom />);
    expect(open).toContain('data-testid="add-weapon-custom"');
    expect(open).toContain('aria-label="Item name"');
    expect(open).toContain('aria-label="Damage"');
    expect(open).toContain('aria-label="Modes"');
    expect(open).toContain('aria-label="Cost in nuyen"');
    expect(open).toContain('aria-label="Printed page"');
    // A single-kind button asks for no kind; a multi-kind one does.
    expect(open).not.toContain('aria-label="Item kind"');
    const gear = renderToStaticMarkup(<AddFromBooksView {...base} kinds={['gear', 'ammo']} kind="gear" custom />);
    expect(gear).toContain('aria-label="Item kind"');
    expect(gear).toContain('aria-label="Rating"');
  });

  it('says when nothing matched, and what to do instead', () => {
    const html = renderToStaticMarkup(<AddFromBooksView {...base} hits={[]} query="unobtainium" />);
    expect(html).toContain('data-testid="add-weapon-empty"');
    expect(html).toContain('Nothing by that name');
  });

  it('shows what just happened', () => {
    const html = renderToStaticMarkup(<AddFromBooksView {...base} note="added Zap Gun · 725¥ proposed on the ledger" />);
    expect(html).toContain('data-testid="add-weapon-note"');
    expect(html).toContain('725¥ proposed on the ledger');
  });
});
