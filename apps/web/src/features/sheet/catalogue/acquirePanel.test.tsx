/**
 * The find & negotiate panel, as it opens: who can negotiate, with what dice,
 * against what, and where the price goes. The dice themselves are the
 * server's (`/api/rolls`); `acquire.test.ts` covers the reading of them.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AcquirePanel, { type AcquirePanelProps } from './AcquirePanel.js';
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
const base: AcquirePanelProps = {
  hit,
  characterId: 'c1',
  characterName: 'Torque',
  negotiationPool: 7,
  charisma: 4,
  socialLimit: 5,
  contacts: [
    { id: 'k1', name: 'Hoi', archetype: 'fixer', connection: 3, loyalty: 2, notes: '', favours: { owed: 0, owing: 0 }, npcPageId: null },
  ],
  gm: false,
  onAcquire: noop,
  onBack: noop,
  testId: 'add-weapon',
};

describe('the find & negotiate panel', () => {
  it('opens on the runner with their own dice against the item, at the list price, with the page to read', () => {
    const html = renderToStaticMarkup(<AcquirePanel {...base} />);
    expect(html).toContain('data-testid="add-weapon-acquire"');
    expect(html).toContain('availability 5 · restricted · delivery band 1 day');
    expect(html).toContain('Torque — Negotiation + CHA [Social]');
    expect(html).toContain('Hoi — contact, Connection 3');
    expect(html).toContain('someone else — the GM sets the dice');
    expect(html).toContain('>roll 7 vs 5<');
    expect(html).toContain('list 725¥');
    expect(html).toContain('aria-label="Price paid"');
    expect(html).toContain('>add it for 725¥<');
    expect(html).toContain('the spend is proposed, pending the GM');
    expect(html).toContain('SR5 p.418');
  });

  it('words the spend for the GM, and copes with a runner who has no Negotiation and an item with no price', () => {
    const gm = renderToStaticMarkup(<AcquirePanel {...base} gm />);
    expect(gm).toContain('the spend is recorded on the ledger');
    const bare = renderToStaticMarkup(<AcquirePanel {...base} negotiationPool={undefined} socialLimit={undefined} hit={{ ...hit, cost: null, costText: 'Rating x 500¥', avail: '(Rating x 2)F' }} />);
    expect(bare).toContain('>roll 4 vs 0<');
    expect(bare).toContain('availability (Rating x 2)F · forbidden');
    expect(bare).toContain('no list price — the offer is the price');
    expect(bare).toContain('no spend — a gift, a find, or free');
  });
});
