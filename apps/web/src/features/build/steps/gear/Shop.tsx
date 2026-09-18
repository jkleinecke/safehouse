/**
 * The Gear step's shop: the campaign's books by shelf, and a way to write in
 * what they do not list (FR3.9, docs/CHARGEN.md §4.4 Step 7 "the catalogue
 * search the sheet already has, filtered to the campaign's allowed books and
 * the level's caps — anything over is shown greyed with its number").
 *
 * A shelf is one catalogue kind (weapons, armor, 'ware, commlinks and decks,
 * fake SINs and licences, vehicles and drones, the rest) browsed with the
 * kit's `CataloguePickerView` over `useBuilderCatalogue`: the campaign's
 * creation books only, alphabetical before anything is typed, a row over the
 * Availability or device-rating cap greyed with its number and page and its
 * button refusing. A Restricted or Forbidden row is buyable, and the line says
 * so: the GM decides each one. Nothing is fetched until a shelf is opened, so
 * the step renders without a query client and a phone does not pull a
 * catalogue page for a shelf the player never looks at.
 *
 * Buying a row opens the add panel (`AddPanel`) in the app's bottom sheet —
 * where a thumb is, on a phone, whichever row of a long list was tapped.
 * Writing one in (`CustomPurchase`) goes through the same panel.
 */
import { useEffect, useId, useState } from 'react';
import type { ChargenSettings } from '@safehouse/contracts';
import { issueRule } from '@safehouse/rules';
import { Sheet } from '../../../sheet/components/ui.js';
import type { CatalogueHit } from '../../../sheet/catalogue/toSheet.js';
import { CataloguePickerView, WhyLink, useBuilderCatalogue } from '../../kit/index.js';
import AddPanel from './AddPanel.js';
import CustomPurchase from './CustomPurchase.js';
import { GEAR_SHELVES, shelfOf, type DraftQuote, type QuoteContext, type ShelfId } from './gear.js';
import { GearSection } from './parts.js';

/** Which part of the shop is open: a shelf, the write-in form, or neither. */
export type ShopView = ShelfId | 'custom' | null;

export interface ShelfBrowserProps {
  campaignId: string;
  shelf: ShelfId;
  settings: ChargenSettings;
  onPick: (hit: CatalogueHit) => void;
}

/** One shelf, live: typing with a short pause before the server sees it, the shelf's own opening words in the box. */
export function ShelfBrowser({ campaignId, shelf, settings, onPick }: ShelfBrowserProps) {
  const meta = shelfOf(shelf);
  const [draft, setDraft] = useState(meta.query);
  const [query, setQuery] = useState(meta.query);
  useEffect(() => {
    const t = setTimeout(() => setQuery(draft), 250);
    return () => clearTimeout(t);
  }, [draft]);
  const catalogue = useBuilderCatalogue({ campaignId, kind: meta.kind, q: query });
  return (
    <CataloguePickerView
      kind={meta.kind}
      label={meta.label}
      query={draft}
      onQuery={setDraft}
      hits={catalogue.hits}
      total={catalogue.total}
      hasMore={catalogue.hasMore}
      loading={catalogue.loading}
      loadingMore={catalogue.loadingMore}
      error={catalogue.error}
      onMore={catalogue.loadMore}
      caps={settings}
      onPick={onPick}
      pickLabel="buy"
      testId="gear-picker"
    />
  );
}

export interface ShopProps {
  id: string;
  campaignId: string;
  ctx: QuoteContext;
  view: ShopView;
  onView: (view: ShopView) => void;
  /** Add the line the panel quoted. */
  onBuy: (quote: DraftQuote) => void;
}

export default function Shop({ id, campaignId, ctx, view, onView, onBuy }: ShopProps) {
  const headingId = useId();
  const [picked, setPicked] = useState<CatalogueHit | null>(null);
  const [customKey, setCustomKey] = useState(0);
  const approvalRef = issueRule('approval-gear')?.ref;
  const shelf = view !== null && view !== 'custom' ? view : null;
  return (
    <GearSection id={id} headingId={headingId} title="Buy" testId="gear-shop">
      <p className="text-xs text-dim">
        Pick a shelf to browse this campaign&apos;s books, or write in something they do not list. Rows marked R or F are Restricted
        or Forbidden: they can be bought, and the GM decides each one.
        {approvalRef && (
          <>
            {' '}
            <WhyLink refValue={approvalRef} />
          </>
        )}
      </p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Shelves" data-testid="gear-shelves">
        {GEAR_SHELVES.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={`btn px-3 py-1 ${view === s.id ? 'btn-accent' : ''}`}
              aria-pressed={view === s.id}
              onClick={() => onView(view === s.id ? null : s.id)}
              data-testid="gear-shelf"
              data-shelf={s.id}
            >
              {s.label}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className={`btn px-3 py-1 ${view === 'custom' ? 'btn-accent' : ''}`}
            aria-pressed={view === 'custom'}
            onClick={() => onView(view === 'custom' ? null : 'custom')}
            data-testid="gear-shelf"
            data-shelf="custom"
          >
            write one in
          </button>
        </li>
      </ul>
      {shelf && <ShelfBrowser key={shelf} campaignId={campaignId} shelf={shelf} settings={ctx.settings} onPick={setPicked} />}
      {view === 'custom' && <CustomPurchase key={customKey} onContinue={setPicked} />}
      <Sheet open={picked !== null} onClose={() => setPicked(null)} title={picked ? `Buy ${picked.name}` : undefined}>
        {picked && (
          <AddPanel
            key={`${picked.id}:${picked.name}`}
            hit={picked}
            ctx={ctx}
            onCancel={() => setPicked(null)}
            onAdd={(quote) => {
              onBuy(quote);
              if (picked.id === 'custom') setCustomKey((k) => k + 1);
              setPicked(null);
            }}
          />
        )}
      </Sheet>
    </GearSection>
  );
}
