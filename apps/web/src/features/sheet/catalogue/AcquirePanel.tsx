/**
 * Find & negotiate — getting hold of a thing, with the dice on the record.
 *
 * The Availability Test as the core book has it (SR5 p.418, `acquire.ts`):
 * who negotiates — the runner with Negotiation + Charisma [Social], a contact
 * with their own dice and their Connection on the limit, or someone the GM
 * names — what they offer (every extra quarter of list is one more die), and
 * one Opposed Test against the item's Availability rating, both rolls
 * through `/api/rolls` so the table sees them. Then the price actually paid,
 * which the GM or the player can set to anything — a street price is the
 * table's call, and the rolls are advice.
 */
import { useState } from 'react';
import { apiPost } from '../../../api/client.js';
import type { ContactRecord } from '../contacts.js';
import { RefChip } from '../components/ui.js';
import {
  acquisitionReason,
  availabilityOutcome,
  contactSearcher,
  deliveryFor,
  extraDiceForOffer,
  hoursLabel,
  parseAvailability,
  runnerSearcher,
  type AvailabilityOutcome,
  type Searcher,
} from './acquire.js';
import { statsLine, type CatalogueHit } from './toSheet.js';

export const BUYING_GEAR_REF = { book: 'SR5', page: 418, note: 'Buying Gear' };

export interface AcquirePanelProps {
  hit: CatalogueHit;
  characterId: string;
  characterName: string;
  /** Negotiation + Charisma from the derived sheet, when the sheet has the skill. */
  negotiationPool?: number | undefined;
  charisma?: number | undefined;
  socialLimit?: number | undefined;
  contacts: readonly ContactRecord[];
  /** The GM records the spend; a player proposes it. */
  gm: boolean;
  onAcquire: (hit: CatalogueHit, price: number, reason: string) => void;
  onBack: () => void;
  testId: string;
}

interface RollRecordDto {
  id: string;
  hits: number;
  limitedHits: number;
  glitch: 'none' | 'glitch' | 'critical';
  netHits?: number;
}

interface TestResult {
  buyerHits: number;
  itemHits: number;
  netHits: number;
  outcome: AvailabilityOutcome;
}

const inputClass = 'w-full rounded border border-edge bg-ground px-2 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none';
const num = (v: string, fallback = 0): number => {
  const n = Number(v.replace(/[,¥\s]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};
const yen = (n: number): string => `${n.toLocaleString('en-US')}¥`;

export default function AcquirePanel(p: AcquirePanelProps) {
  const avail = parseAvailability(p.hit.avail);
  const listPrice = p.hit.cost;
  const delivery = deliveryFor(listPrice);
  const runner = runnerSearcher(p.characterName, p.negotiationPool, p.charisma, p.socialLimit);

  const [who, setWho] = useState<string>('runner');
  const [dice, setDice] = useState(String(runner.pool));
  const [limit, setLimit] = useState(runner.limit !== null ? String(runner.limit) : '');
  const [rating, setRating] = useState(String(avail.rating));
  const [offer, setOffer] = useState(listPrice !== null ? String(listPrice) : '');
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [price, setPrice] = useState(listPrice !== null ? String(listPrice) : '');
  const [error, setError] = useState<string | null>(null);

  const extra = extraDiceForOffer(listPrice, num(offer, listPrice ?? 0));
  const contactOf = (id: string) => p.contacts.find((c) => c.id === id);

  const searcher = (): Searcher => {
    if (who === 'runner') return { ...runner, pool: num(dice, runner.pool), limit: limit.trim() ? num(limit) : null };
    const contact = contactOf(who);
    if (contact) {
      const base = contactSearcher(contact.name, contact.connection, num(dice, 0), limit.trim() ? num(limit) : null);
      return base;
    }
    return { kind: 'other', name: 'someone else', pool: num(dice, 0), limit: limit.trim() ? num(limit) : null, breakdown: [{ label: 'dice the GM set', value: num(dice, 0), source: 'situational' }] };
  };
  const pickWho = (next: string) => {
    setWho(next);
    setResult(null);
    if (next === 'runner') {
      setDice(String(runner.pool));
      setLimit(runner.limit !== null ? String(runner.limit) : '');
    } else {
      // A contact's Negotiation and Charisma are theirs, not the sheet's: the GM types them.
      setDice('');
      setLimit('');
    }
  };

  const roll = async () => {
    const s = searcher();
    const pool = s.pool + extra;
    setRolling(true);
    setError(null);
    try {
      // The item first, so the buyer's roll carries the net hits.
      const item = (
        await apiPost<{ roll: RollRecordDto }>('/api/rolls', {
          kind: 'simple',
          pool: num(rating, avail.rating),
          breakdown: [{ label: `${p.hit.name} · Availability ${num(rating, avail.rating)}`, value: num(rating, avail.rating), source: 'situational' }],
          visibility: 'public',
          actor: {},
          meta: { label: `Availability — ${p.hit.name} (the item)`, side: 'item', item: p.hit.name },
        })
      ).roll;
      const buyer = (
        await apiPost<{ roll: RollRecordDto }>('/api/rolls', {
          kind: 'simple',
          pool,
          breakdown: [...s.breakdown, ...(extra > 0 ? [{ label: `offering ${yen(num(offer, 0))} — extra dice`, value: extra, source: 'situational' }] : [])],
          ...(s.limit !== null ? { limit: { kind: 'social', value: s.limit } } : {}),
          visibility: 'public',
          actor: { characterId: p.characterId },
          meta: { label: `Availability test — ${p.hit.name}`, side: 'buyer', searcher: s.name, item: p.hit.name, opposedRollId: item.id },
        })
      ).roll;
      const netHits = buyer.netHits ?? buyer.limitedHits - item.limitedHits;
      const outcome = availabilityOutcome(netHits, delivery, buyer.glitch);
      setResult({ buyerHits: buyer.limitedHits, itemHits: item.limitedHits, netHits, outcome });
      if (outcome.found) setPrice(String(num(offer, listPrice ?? 0)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'the roll did not reach the table');
    } finally {
      setRolling(false);
    }
  };

  const finalPrice = Math.max(0, Math.round(num(price, 0)));
  const acquire = () => {
    p.onAcquire(
      p.hit,
      finalPrice,
      acquisitionReason(p.hit, {
        ...(result ? { searcher: searcher(), outcome: result.outcome } : {}),
        listPrice,
        price: finalPrice,
      }),
    );
  };

  const contact = contactOf(who);
  return (
    <div className="mt-2 rounded-md border border-edge bg-deck/60 p-3" data-testid={`${p.testId}-acquire`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm text-ink">{p.hit.name}</span>
          <span className="mono-label ml-2 text-faint">{statsLine(p.hit)}</span>
        </div>
        <span className="flex items-center gap-2">
          <RefChip refInfo={BUYING_GEAR_REF} />
          <button type="button" className="mono-label text-faint hover:text-ink" onClick={p.onBack}>
            back to the list
          </button>
        </span>
      </div>
      <p className="mono-label mt-1 text-faint">
        availability {avail.formula ?? avail.rating}
        {avail.legality !== 'legal' ? ` · ${avail.legality}` : ''} · delivery band {delivery.label} · every number here is the GM's to change
      </p>

      {/* 1. Who negotiates, and what they offer */}
      <section className="mt-3">
        <h3 className="mono-label text-cyan">1 · Who negotiates, and what they offer</h3>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="col-span-2 block">
            <span className="mono-label block">Who</span>
            <select className={inputClass} value={who} onChange={(e) => pickWho(e.target.value)} aria-label="Who negotiates" data-testid={`${p.testId}-searcher`}>
              <option value="runner">{p.characterName} — Negotiation + CHA [Social]</option>
              {p.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — contact, Connection {c.connection}
                </option>
              ))}
              <option value="other">someone else — the GM sets the dice</option>
            </select>
          </label>
          <label className="block">
            <span className="mono-label block">Dice</span>
            <input className={inputClass} inputMode="numeric" value={dice} placeholder={contact ? `${contact.name}'s Negotiation + CHA` : '0'} onChange={(e) => setDice(e.target.value)} aria-label="Negotiation dice" data-testid={`${p.testId}-dice`} />
          </label>
          <label className="block">
            <span className="mono-label block">Social limit{contact ? ` (+${contact.connection} Connection)` : ''}</span>
            <input className={inputClass} inputMode="numeric" value={limit} placeholder="none" onChange={(e) => setLimit(e.target.value)} aria-label="Social limit" />
          </label>
          <label className="block">
            <span className="mono-label block">Offering ¥{listPrice !== null ? ` (list ${yen(listPrice)})` : ''}</span>
            <input className={inputClass} inputMode="numeric" value={offer} onChange={(e) => setOffer(e.target.value)} aria-label="Price offered" data-testid={`${p.testId}-offer`} />
          </label>
          <label className="block">
            <span className="mono-label block">Item's availability dice</span>
            <input className={inputClass} inputMode="numeric" value={rating} onChange={(e) => setRating(e.target.value)} aria-label="Availability rating" />
          </label>
          <p className="col-span-2 self-end text-xs text-dim" data-testid={`${p.testId}-extra`}>
            {extra > 0 ? `+${extra} ${extra === 1 ? 'die' : 'dice'} for offering above list` : listPrice ? 'each extra quarter of list offered is one more die (up to 12)' : 'no list price — the offer is the price'}
          </p>
        </div>
      </section>

      {/* 2. The test */}
      <section className="mt-3">
        <h3 className="mono-label text-cyan">2 · The Availability test</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button type="button" className="btn px-3 py-1.5" onClick={() => void roll()} disabled={rolling} data-testid={`${p.testId}-roll`}>
            {rolling ? 'rolling…' : result ? 'roll it again' : `roll ${searcher().pool + extra} vs ${num(rating, avail.rating)}`}
          </button>
          {result && (
            <span className={`text-xs ${result.outcome.found ? 'text-cyan' : 'text-warn'}`} data-testid={`${p.testId}-result`}>
              {result.buyerHits} vs {result.itemHits} → {result.outcome.line}
            </span>
          )}
          {!result && <span className="mono-label text-faint">opposed: their Negotiation + CHA against the item's rating · both rolls go to the table</span>}
        </div>
      </section>

      {/* 3. The price */}
      <section className="mt-3">
        <h3 className="mono-label text-cyan">3 · Paid</h3>
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mono-label block">Price paid ¥</span>
            <input className={`${inputClass} w-32`} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price paid" data-testid={`${p.testId}-price`} />
          </label>
          <button type="button" className="btn btn-accent px-3 py-1.5" onClick={acquire} data-testid={`${p.testId}-acquire-add`}>
            add it{finalPrice > 0 ? ` for ${yen(finalPrice)}` : ''}
          </button>
          <span className="mono-label text-faint">
            {finalPrice > 0 ? (p.gm ? 'the spend is recorded on the ledger' : 'the spend is proposed, pending the GM') : 'no spend — a gift, a find, or free'}
            {result?.outcome.found && result.outcome.deliveryHours !== null ? ` · arrives in ${hoursLabel(result.outcome.deliveryHours)}` : ''}
          </span>
        </div>
      </section>
      {error && <p className="mt-2 rounded border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
