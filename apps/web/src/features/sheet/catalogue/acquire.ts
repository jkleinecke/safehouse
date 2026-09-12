/**
 * Getting hold of a thing — the mechanics behind the "find & negotiate"
 * panel, pure so they can be tested without a dialog. Numbers only, as the
 * core book lays them out under Buying Gear (SR5 p.418); the words are ours.
 *
 * The Availability Test is an Opposed Test: the buyer's Negotiation +
 * Charisma [Social] against the item's Availability rating rolled as dice.
 * Win, and it is found at the listed price, delivered in the price band's
 * time divided by the net hits; tie, and it is found in twice that time;
 * lose, and it is not found — try again after twice that time. Money helps:
 * every extra quarter of the list price offered is one more die, up to
 * twelve. A contact searching uses their own Negotiation and Charisma, with
 * their Connection added to their Social limit. A glitch draws attention;
 * a critical glitch ends the search.
 *
 * Nothing here decides whether the runner gets the thing: the GM does. It
 * keeps the numbers straight and puts the dice where everyone can see them.
 */

/** The item's availability rating and legality, from the table's "12F". */
export interface AvailabilityCode {
  rating: number;
  legality: 'legal' | 'restricted' | 'forbidden';
  /** The formula, when the table printed one ("(Rating x 2)F"). */
  formula: string | null;
}

export function parseAvailability(avail: string | null | undefined): AvailabilityCode {
  const t = (avail ?? '').trim();
  const legality: AvailabilityCode['legality'] = /F\b/i.test(t) ? 'forbidden' : /R\b/i.test(t) ? 'restricted' : 'legal';
  const m = /^(\d{1,3})\s*[RF]?\+?$/i.exec(t);
  if (m) return { rating: Number(m[1]), legality, formula: null };
  return { rating: 0, legality, formula: t.length > 0 && t !== '—' ? t : null };
}

/** The Delivery Times table (SR5 p.418): how long the thing takes to arrive, by price. */
export interface Delivery {
  label: string;
  hours: number;
}

export function deliveryFor(cost: number | null): Delivery {
  const c = cost ?? 0;
  if (c <= 100) return { label: '6 hours', hours: 6 };
  if (c <= 1_000) return { label: '1 day', hours: 24 };
  if (c <= 10_000) return { label: '2 days', hours: 48 };
  if (c <= 100_000) return { label: '1 week', hours: 168 };
  return { label: '1 month', hours: 720 };
}

/** "8 hours", "3 days", "1 week 2 days". */
export function hoursLabel(hours: number): string {
  const h = Math.max(1, Math.round(hours));
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
  const weeks = Math.floor(days / 7);
  const rest = days - weeks * 7;
  return `${weeks} week${weeks === 1 ? '' : 's'}${rest > 0 ? ` ${rest} day${rest === 1 ? '' : 's'}` : ''}`;
}

/** Every extra quarter of the list price offered is one more die, up to twelve (SR5 p.418). */
export function extraDiceForOffer(listPrice: number | null, offer: number): number {
  if (listPrice === null || listPrice <= 0 || offer <= listPrice) return 0;
  return Math.min(12, Math.floor((offer - listPrice) / (listPrice * 0.25)));
}

/** Who is looking: the runner with their own dice, or a contact with theirs. */
export interface Searcher {
  kind: 'runner' | 'contact' | 'other';
  name: string;
  /** Negotiation + Charisma, before any money is thrown at it. */
  pool: number;
  /** The Social limit, when known — a contact's carries their Connection on top. */
  limit: number | null;
  /** Where the dice came from, for the roll's breakdown. */
  breakdown: Array<{ label: string; value: number; source: string }>;
}

/** The runner: Negotiation + Charisma [Social], from the derived sheet when it has them. */
export function runnerSearcher(name: string, negotiationPool: number | undefined, charisma: number | undefined, socialLimit: number | undefined): Searcher {
  const pool = negotiationPool ?? Math.max(0, charisma ?? 0);
  return {
    kind: 'runner',
    name,
    pool,
    limit: socialLimit ?? null,
    breakdown: negotiationPool !== undefined ? [{ label: 'Negotiation + CHA', value: negotiationPool, source: 'skill' }] : [{ label: 'CHA (no Negotiation)', value: pool, source: 'attribute' }],
  };
}

/**
 * A contact: their own Negotiation + Charisma — which the sheet does not
 * know, so the GM types the dice — with their Connection added to their
 * Social limit (SR5 p.418).
 */
export function contactSearcher(name: string, connection: number, dice: number, socialLimit: number | null = null): Searcher {
  const pool = Math.max(0, dice);
  return {
    kind: 'contact',
    name,
    pool,
    limit: socialLimit !== null ? socialLimit + Math.max(0, connection) : null,
    breakdown: [{ label: `${name} · Negotiation + CHA (Connection ${connection} on the limit)`, value: pool, source: 'skill' }],
  };
}

export interface AvailabilityOutcome {
  found: boolean;
  /** Hours until it arrives, when found. */
  deliveryHours: number | null;
  /** Hours before another try, when not. */
  retryAfterHours: number | null;
  /** The buyer's glitch, which the GM reads as trouble; critical ends the search. */
  glitch: 'none' | 'glitch' | 'critical';
  line: string;
}

/** The Opposed Test read out: net hits against the delivery band (SR5 p.418). */
export function availabilityOutcome(buyerNetHits: number, delivery: Delivery, glitch: 'none' | 'glitch' | 'critical' = 'none'): AvailabilityOutcome {
  if (glitch === 'critical') {
    return { found: false, deliveryHours: null, retryAfterHours: null, glitch, line: 'critical glitch — no chance of this one, and something went wrong (SR5 p.418)' };
  }
  const attention = glitch === 'glitch' ? ' · glitch: the inquiry drew attention — the GM says what kind' : '';
  if (buyerNetHits > 0) {
    const hours = delivery.hours / buyerNetHits;
    return { found: true, deliveryHours: hours, retryAfterHours: null, glitch, line: `found — delivered in ${hoursLabel(hours)} (${buyerNetHits} net hit${buyerNetHits === 1 ? '' : 's'})${attention}` };
  }
  if (buyerNetHits === 0) {
    return { found: true, deliveryHours: delivery.hours * 2, retryAfterHours: null, glitch, line: `found on a tie — delivered in ${hoursLabel(delivery.hours * 2)}${attention}` };
  }
  return { found: false, deliveryHours: null, retryAfterHours: delivery.hours * 2, glitch, line: `not found — try again after ${hoursLabel(delivery.hours * 2)}${attention}` };
}

/** One line for the ledger: who found it, when it arrives, what was paid against list. */
export function acquisitionReason(
  item: { name: string; bookCode: string; printedPage: number },
  opts: { searcher?: Searcher | null; outcome?: AvailabilityOutcome | null; listPrice?: number | null; price: number },
): string {
  const parts = [`bought ${item.name}${item.bookCode ? ` (${item.bookCode} p.${item.printedPage})` : ''}`];
  if (opts.searcher && opts.outcome) {
    parts.push(opts.outcome.found ? `found by ${opts.searcher.name}, delivered in ${hoursLabel(opts.outcome.deliveryHours ?? 0)}` : `${opts.searcher.name} could not find it`);
  }
  if (opts.listPrice !== undefined && opts.listPrice !== null && opts.listPrice > 0 && opts.listPrice !== opts.price) {
    parts.push(`${Math.round((opts.price / opts.listPrice) * 100)}% of list (${opts.listPrice.toLocaleString('en-US')}¥)`);
  }
  return parts.join(' — ');
}
