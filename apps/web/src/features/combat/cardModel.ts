/** Pure pieces of the roll card: grouping, offers, the table's dice, the exchanges a runner is in. */
import type {
  ActionType,
  CardActorRef,
  CardOffer,
  CardRequestInput,
  CardStage,
  DeclarationEdit,
  Exchange,
  Glitch,
  HitOutcome,
  WsEvent,
} from '@safehouse/contracts';
import type { ActionSummary, ActorActions } from './cardApi.js';

/** What the roller has chosen so far; the server builds the card from it. */
export interface CardDraft {
  actor: CardActorRef;
  actionId: string;
  /** The weapons this action can use, from the actions list. */
  weapons?: string[];
  needsTarget?: boolean;
  weapon?: string;
  skill?: string;
  target?: CardActorRef & { name?: string };
  exchangeId?: string;
  flips: OfferFlips;
  steppers: Record<string, number>;
  declare: DeclarationEdit;
  /** The roller's own "+2, the GM said so". */
  other: number;
  stage?: CardStage;
}

export function newDraft(
  actor: CardActorRef,
  action: Pick<ActionSummary, 'id' | 'weapons' | 'needsTarget'>,
  exchangeId?: string,
): CardDraft {
  return {
    actor,
    actionId: action.id,
    ...(action.needsTarget ? { needsTarget: true } : {}),
    ...(action.weapons && action.weapons.length > 0 ? { weapons: action.weapons, weapon: action.weapons[0] } : {}),
    ...(exchangeId ? { exchangeId } : {}),
    flips: {},
    steppers: {},
    declare: {},
    other: 0,
  };
}

/** A card opened straight on one action (a rack chip, a defense button); Back goes to the list. */
export interface CardStart {
  action: Pick<ActionSummary, 'id' | 'weapons' | 'needsTarget'>;
  weapon?: string;
  skill?: string;
}

export function startDraft(actor: CardActorRef, start: CardStart, exchangeId?: string): CardDraft {
  const d = newDraft(actor, start.action, exchangeId);
  return { ...d, ...(start.weapon ? { weapon: start.weapon } : {}), ...(start.skill ? { skill: start.skill } : {}) };
}

/** The preview request, defaults for the offers (`offersOnWith` adds the flips). */
export function requestOf(d: CardDraft): CardRequestInput {
  const declare = Object.keys(d.declare).length > 0 ? d.declare : undefined;
  return {
    actor: d.actor,
    actionId: d.actionId,
    ...(d.weapon ? { weapon: d.weapon } : {}),
    ...(d.skill ? { skill: d.skill } : {}),
    ...(d.target ? { target: { kind: d.target.kind, id: d.target.id } } : {}),
    ...(d.exchangeId ? { exchangeId: d.exchangeId } : {}),
    ...(Object.keys(d.steppers).length > 0 ? { steppers: d.steppers } : {}),
    ...(d.other !== 0 ? { extras: [{ label: 'Other', value: d.other }] } : {}),
    ...(declare ? { declare } : {}),
    ...(d.stage ? { stage: d.stage } : {}),
  };
}

export const TYPE_ORDER: readonly ActionType[] = ['free', 'simple', 'complex', 'interrupt', 'none'];

export const TYPE_LABEL: Record<ActionType, string> = {
  free: 'Free',
  simple: 'Simple',
  complex: 'Complex',
  interrupt: 'Interrupt',
  none: 'No action',
};

export const TYPE_TONE: Record<ActionType, string> = {
  free: 'border-edge text-dim',
  simple: 'border-cyan-dim text-cyan',
  complex: 'border-magenta-dim text-magenta',
  interrupt: 'border-warn/60 text-warn',
  none: 'border-edge text-faint',
};

/** Free, Simple, Complex, Interrupt, then the tests that cost no action; empty groups dropped. */
export function orderedGroups(list: ActorActions): { type: ActionType; actions: ActionSummary[] }[] {
  return TYPE_ORDER.flatMap((type) => {
    const actions = list.groups.filter((g) => g.type === type).flatMap((g) => g.actions);
    return actions.length > 0 ? [{ type, actions }] : [];
  });
}

/** The GM's order for an incoming attack: the free test first, then the Interrupts; nothing left out. */
const DEFENSE_FIRST = ['defense', 'full_defense', 'dodge', 'block', 'parry'];

export function defenseChoices(list: ActorActions): ActionSummary[] {
  const all = list.groups.flatMap((g) => g.actions).filter((a) => a.exchange === 'defends');
  const rank = (id: string) => {
    const first = DEFENSE_FIRST.indexOf(id);
    if (first >= 0) return first;
    const server = list.defenses?.indexOf(id) ?? -1;
    return server >= 0 ? DEFENSE_FIRST.length + server : 1000;
  };
  return all
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a.id) - rank(y.a.id) || x.i - y.i)
    .map((x) => x.a);
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

/** The roller's own ticks over the card's defaults, in the order they were made. */
export type OfferFlips = Record<string, boolean>;

/** Tick or untick one offer; ticking clears the rest of its group. */
export function flipOffer(offers: readonly CardOffer[], flips: OfferFlips, id: string): OfferFlips {
  const offer = offers.find((o) => o.id === id);
  if (!offer) return flips;
  const now = flips[id] ?? offer.on;
  const next: OfferFlips = { ...flips };
  delete next[id];
  if (!now && offer.group) {
    for (const o of offers) if (o.id !== id && o.group === offer.group) next[o.id] = false;
  }
  next[id] = !now;
  return next;
}

/** `offersOn` for the request: the defaults with the flips applied, the last flip last. */
export function offersOnWith(defaults: readonly CardOffer[], flips: OfferFlips): string[] {
  const on = defaults.filter((o) => (flips[o.id] ?? o.on) && !(o.id in flips)).map((o) => o.id);
  const flipped = Object.keys(flips).filter((id) => flips[id] && defaults.some((o) => o.id === id));
  return [...on, ...flipped];
}

/** Offers not in the pool yet, the likeliest first: hints, then the attacker's facts, then the rest. */
export function offOffers(offers: readonly CardOffer[]): CardOffer[] {
  const rank = (o: CardOffer) => (o.suggestedBy ? 0 : o.declaredBy ? 1 : 2);
  return offers
    .filter((o) => !o.on && o.target !== 'initiative')
    .map((o, i) => ({ o, i }))
    .sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i)
    .map((x) => x.o);
}

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

/** What the table's dice said, as the server takes it: a critical glitch has no hits (p.45). */
export function tableResult(hits: number, glitch: Glitch): { hits: number; glitch: Glitch } {
  const n = Number.isFinite(hits) ? Math.max(0, Math.trunc(hits)) : 0;
  if (glitch === 'critical') return { hits: 0, glitch };
  return { hits: n, glitch: glitch === 'glitch' && n === 0 ? 'critical' : glitch };
}

export const OUTCOME_WORD: Record<HitOutcome, string> = { hit: 'Hit', graze: 'Grazed', miss: 'Miss' };

// ---------------------------------------------------------------------------
// Exchanges the runner is in
// ---------------------------------------------------------------------------

export interface SeenExchange {
  exchange: Exchange;
  /** The event that last carried it. */
  eventId: number;
  ts: string;
}

/** The newest copy of each exchange from `exchange.updated` frames (a player's own side). */
export function latestExchanges(events: readonly WsEvent[]): SeenExchange[] {
  const byId = new Map<string, SeenExchange>();
  for (const e of events) {
    // Not in the contracts' event list yet; the hub persists it all the same.
    if ((e.type as string) !== 'exchange.updated') continue;
    const payload = (e.payload ?? {}) as { exchange?: Exchange };
    const x = payload.exchange;
    if (!x || typeof x.id !== 'string') continue;
    const held = byId.get(x.id);
    if (!held || held.eventId <= e.id) byId.set(x.id, { exchange: x, eventId: e.id, ts: e.ts });
  }
  return [...byId.values()].sort((a, b) => a.eventId - b.eventId);
}

export type ExchangeTask =
  | { kind: 'defend'; x: Exchange }
  | { kind: 'soak'; x: Exchange }
  | { kind: 'apply'; x: Exchange }
  | { kind: 'defended'; x: Exchange }
  | { kind: 'attacked'; x: Exchange };

/**
 * What the runner may do or hear about: answer an attack on them, then soak it,
 * and the outcome of their own attacks. News (not a question) only while `fresh`.
 */
export function exchangeTasks(
  list: readonly SeenExchange[],
  mine: ReadonlySet<string>,
  isFresh: (s: SeenExchange) => boolean,
): ExchangeTask[] {
  const out: ExchangeTask[] = [];
  const isMine = (id?: string) => id !== undefined && mine.has(id);
  for (const seen of list) {
    const x = seen.exchange;
    const fresh = isFresh(seen);
    if (isMine(x.target.combatantId)) {
      if (x.state === 'awaiting_defense') out.push({ kind: 'defend', x });
      else if (x.state === 'awaiting_soak') out.push({ kind: 'soak', x });
      else if (x.state === 'awaiting_apply' && fresh) out.push({ kind: 'apply', x });
      else if (x.state === 'done' && x.outcome && fresh) out.push({ kind: 'defended', x });
    } else if (isMine(x.attacker?.combatantId) && x.outcome && x.state !== 'cancelled' && fresh) {
      out.push({ kind: 'attacked', x });
    }
  }
  return out;
}

/** "8P, AP −2, SA −1 to defend": the attack's facts in one line. */
export function attackFacts(x: Pick<Exchange, 'declared'>): string {
  const d = x.declared;
  const parts = [`${d.dv.value}${d.dv.type}`, `AP ${d.ap < 0 ? `−${-d.ap}` : d.ap}`];
  if (d.mode) parts.push(d.mode);
  if (d.defenseModifier < 0) parts.push(`−${-d.defenseModifier} to defend`);
  return parts.join(', ');
}
