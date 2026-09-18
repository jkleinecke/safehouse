/**
 * Step 7 — Gear (FR3.9, docs/CHARGEN.md §4.4 Step 7).
 *
 * The resources row's nuyen becomes the things a runner carries, the 'ware in
 * their body and somewhere to live. The screen is five panels, in the order a
 * first-timer needs them:
 *
 * 1. **Nuyen** (`gear/NuyenPanel`) — the pool, where it came from, the Karma →
 *    nuyen stepper with the next point's price against Karma, and how much of
 *    what is left carries into play.
 * 2. **What most runners need** (`gear/Checklist`) — commlink, fake SIN,
 *    licences, armor, a weapon, ammunition, a lifestyle, ticking itself off,
 *    each open line a tap to the shelf that sells it; and the concept card's
 *    own shopping list.
 * 3. **Buy** (`gear/Shop`) — the campaign's books by shelf through the kit's
 *    picker, rows over the caps greyed with their number; buying asks only
 *    quantity, rating and grade, in a bottom sheet that says the price, the
 *    Essence, the Availability, the cap it would break and the Magic it would
 *    take before the tap. A write-in form for what the books do not list.
 * 4. **Bought** (`gear/Purchases`) — the lines by list, each with its figures
 *    and the validator's findings; edit the quantity, grade or price, or
 *    remove; the GM decides Restricted and Forbidden lines here in review.
 * 5. **Lifestyles** (`gear/Lifestyles`) — tier, months and name per line, the
 *    metatype and Dependents surcharges applied and named, the starting-nuyen
 *    dice the dearest one sets.
 *
 * Everything shown is the engine's answer (`gear/gear.ts` reads it); every
 * edit is a pure updater through `update`. The step is complete when nuyen is
 * not overspent and a lifestyle is kept — the frame reads that from
 * `stepStatus`, and asks for the carry-over loss at Next (`confirm.ts`).
 * Read-only, the panels show what was bought and offer nothing; in the GM's
 * review the checklist and the card's shopping list — coaching for the player
 * choosing — are not shown at all.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Checklist from './gear/Checklist.js';
import Lifestyles from './gear/Lifestyles.js';
import NuyenPanel from './gear/NuyenPanel.js';
import Purchases from './gear/Purchases.js';
import Shop, { type ShopView } from './gear/Shop.js';
import { conceptSuggestions, runnerChecklist, withPurchase, type QuoteContext, type ShelfId } from './gear/gear.js';
import type { StepProps } from './types.js';

/** The panels a link or a tap lands on: one Gear step is on a page at a time, so the ids are fixed. */
const SHOP_ID = 'gear-shop';
const LIFESTYLES_ID = 'gear-lifestyles';

export interface GearStepState {
  /** The part of the shop open on first render (tests; a player opens it themselves). */
  initialShop?: ShopView;
  /** The purchase line open for editing on first render. */
  initialEditing?: number | null;
}

export default function GearStep(props: StepProps & GearStepState) {
  const { build, settings, budgets, issues, probe, update, readOnly, reviewMode, actions, campaignId } = props;
  const shopId = SHOP_ID;
  const lifestylesId = LIFESTYLES_ID;
  const [shop, setShop] = useState<ShopView>(props.initialShop ?? null);
  const [editing, setEditing] = useState<number | null>(props.initialEditing ?? null);
  const scrollToShop = useRef(false);

  const ctx = useMemo((): QuoteContext => ({ build, settings, budgets, probe }), [build, settings, budgets, probe]);
  const checklist = useMemo(() => runnerChecklist(build, issues), [build, issues]);
  const suggestions = useMemo(() => conceptSuggestions(build), [build]);

  const openShelf = useCallback((shelf: ShelfId) => {
    scrollToShop.current = true;
    setShop(shelf);
  }, []);
  useEffect(() => {
    if (!scrollToShop.current) return;
    scrollToShop.current = false;
    document.getElementById(shopId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [shop, shopId]);

  // A line edited on a record that has since lost it (a removal, another device's save) closes its editor.
  const editingLine = editing !== null && editing < build.purchases.length ? editing : null;

  return (
    <div className="min-w-0 space-y-4" data-testid="gear-step">
      <NuyenPanel build={build} settings={settings} budgets={budgets} issues={issues} probe={probe} update={update} readOnly={readOnly} />
      {!reviewMode && (
        <Checklist
          rows={checklist}
          suggestions={suggestions}
          {...(readOnly ? {} : { onShelf: openShelf })}
          lifestylesHref={`#${lifestylesId}`}
        />
      )}
      {!readOnly && (
        <Shop
          id={shopId}
          campaignId={campaignId}
          ctx={ctx}
          view={shop}
          onView={setShop}
          onBuy={(quote) => {
            const purchase = quote.purchase;
            if (purchase) update((b) => withPurchase(b, purchase));
          }}
        />
      )}
      <Purchases
        build={build}
        settings={settings}
        budgets={budgets}
        issues={issues}
        probe={probe}
        update={update}
        readOnly={readOnly}
        reviewMode={reviewMode}
        actions={actions}
        editing={editingLine}
        onEdit={setEditing}
      />
      <Lifestyles id={lifestylesId} build={build} budgets={budgets} issues={issues} update={update} readOnly={readOnly} />
    </div>
  );
}
