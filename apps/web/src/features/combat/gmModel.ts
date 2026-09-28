/** Pure pieces of the GM's side: rack chips to cards, the incoming line, open exchanges, the map's cover hint. */
import type {
  AttackKind,
  CardActorRef,
  CardOffer,
  DeclaredBy,
  Exchange,
  ExchangeOpenRequestInput,
  FireModeCode,
  WsEvent,
} from '@safehouse/contracts';
import type { CoverLevel } from '@safehouse/rules';
import type { RackEntry } from '../table/quickRolls.js';
import { offOffers, type CardStart } from './cardModel.js';

// ---------------------------------------------------------------------------
// Rack chips
// ---------------------------------------------------------------------------

const FIRE_BY_MODE: Record<string, string> = { SS: 'fire_ss', SA: 'fire_sa', BF: 'fire_bf', FA: 'fire_fa_simple' };
const SAME_ID = new Set(['defense', 'soak', 'composure', 'perception']);

/** The card a rack chip opens on; null when the chip names nothing the catalogue has. */
export function rackStart(e: Pick<RackEntry, 'key' | 'kind' | 'weapon'>): CardStart | null {
  if (e.kind === 'attack' && e.weapon) {
    const mode = (e.weapon.mode ?? '').trim().toUpperCase();
    // A weapon with no mode and no range table is a melee one; the list is one Back away.
    const id = FIRE_BY_MODE[mode] ?? (e.weapon.rangeCat ? 'fire_ss' : 'melee_attack');
    return { action: { id, weapons: [e.weapon.name], needsTarget: true }, weapon: e.weapon.name };
  }
  if (e.key === 'defense.full') return { action: { id: 'full_defense' } };
  if (e.kind === 'skill' && e.key.startsWith('skill:')) return { action: { id: 'use_skill' }, skill: e.key.slice(6) };
  return SAME_ID.has(e.kind) ? { action: { id: e.kind } } : null;
}

// ---------------------------------------------------------------------------
// One exchange in words
// ---------------------------------------------------------------------------

const minus = (n: number) => (n < 0 ? `−${-n}` : `${n}`);

/** "Incoming: Ari, 4 hits, 8P AP −1, SA": the attack as the GM reads it. */
export function incomingLine(x: Pick<Exchange, 'attacker' | 'attackHits' | 'attack' | 'declared'>): string {
  const d = x.declared;
  const parts = [x.attacker?.name ?? 'Someone'];
  if (x.attackHits !== undefined) parts.push(`${x.attackHits} ${x.attackHits === 1 ? 'hit' : 'hits'}`);
  if (x.attack === 'direct-spell') parts.push('direct spell');
  else parts.push(`${d.dv.value}${d.dv.type} AP ${minus(d.ap)}`);
  if (x.attack === 'melee') parts.push('melee');
  if (d.mode) parts.push(d.mode);
  if (d.defenseModifier < 0) parts.push(`${minus(d.defenseModifier)} to defend`);
  return `Incoming: ${parts.join(', ')}`;
}

/** The line for the step the exchange is waiting on. */
export function stepLine(x: Exchange): string {
  const from = x.attacker?.name ?? 'Someone';
  if (x.state === 'awaiting_soak') {
    return x.damage
      ? `Hit by ${from}: resist ${x.damage.modifiedDv}${x.damage.type}, armor ${x.damage.modifiedArmor}`
      : `Hit by ${from}: resist the damage`;
  }
  if (x.state === 'awaiting_apply') {
    return `${x.boxes ?? 0} ${x.track === 'stun' ? 'Stun' : 'Physical'} boxes from ${from}`;
  }
  return incomingLine(x);
}

/** "said by Ari": who declared the attack's facts. */
export function saidBy(by: DeclaredBy): string {
  return `said by ${by.name}`;
}

// ---------------------------------------------------------------------------
// The GM's open exchanges
// ---------------------------------------------------------------------------

const OPEN = new Set(['awaiting_defense', 'awaiting_soak', 'awaiting_apply']);

/**
 * The fight's open exchanges: the newest GM frame that carries them, unless
 * the REST read was asked after it.
 */
export function openExchangesOf(
  events: readonly WsEvent[],
  encounterId: string,
  rest: { list: readonly Exchange[]; asOf: number } | undefined,
): Exchange[] {
  let best: { id: number; list: readonly Exchange[] } | null = null;
  for (const e of events) {
    if (e.type !== 'encounter.updated') continue;
    const p = (e.payload ?? {}) as { scope?: unknown; encounterId?: unknown; exchanges?: unknown };
    if (p.scope !== 'gm' || p.encounterId !== encounterId || !Array.isArray(p.exchanges)) continue;
    if (!best || e.id > best.id) best = { id: e.id, list: p.exchanges as Exchange[] };
  }
  const list = best && (!rest || best.id > rest.asOf) ? best.list : (rest?.list ?? []);
  return list.filter((x) => OPEN.has(x.state));
}

// ---------------------------------------------------------------------------
// The card's modifiers
// ---------------------------------------------------------------------------

const COVER_OFFER: Partial<Record<CoverLevel, string>> = { partial: 'cover_partial', good: 'cover_good' };

/** The map's cover reading marks the matching offer as likely; it never ticks it. */
export function withCoverHint(offers: readonly CardOffer[], cover: CoverLevel | null | undefined): CardOffer[] {
  const id = cover ? COVER_OFFER[cover] : undefined;
  if (!id) return [...offers];
  return offers.map((o) => (o.id === id && !o.on && !o.suggestedBy ? { ...o, suggestedBy: 'los' as const } : o));
}

/** The GM's modifier step: what is on, then the likeliest of the rest; the Initiative cost sits apart. */
export function modifierOrder(offers: readonly CardOffer[]): CardOffer[] {
  return [...offers.filter((o) => o.on && o.target !== 'initiative'), ...offOffers(offers)];
}

// ---------------------------------------------------------------------------
// Declaring a tabletop attack
// ---------------------------------------------------------------------------

export interface FireChoice {
  label: string;
  mode?: FireModeCode;
  defenseModifier: number;
  rounds?: number;
}

/** p.180: the defense penalty each mode brings. */
export const FIRE_CHOICES: readonly FireChoice[] = [
  { label: 'None', defenseModifier: 0 },
  { label: 'SS', mode: 'SS', defenseModifier: 0, rounds: 1 },
  { label: 'SA', mode: 'SA', defenseModifier: 0, rounds: 1 },
  { label: 'BF −2', mode: 'BF', defenseModifier: -2, rounds: 3 },
  { label: 'FA −5', mode: 'FA', defenseModifier: -5, rounds: 6 },
  { label: 'FA −9', mode: 'FA', defenseModifier: -9, rounds: 10 },
];

export type DeclaredAttacker =
  | { kind: 'row'; id: string; name: string; runner: boolean }
  | { kind: 'name'; name: string };

export interface DeclareForm {
  target: CardActorRef;
  attacker: DeclaredAttacker | null;
  attack: AttackKind;
  hits: number;
  dv: { value: number; type: 'P' | 'S' };
  ap: number;
  fire: FireChoice;
  defenseModifier: number;
  note: string;
}

/** The request for `POST /api/exchanges`; a runner's attack is labelled as theirs. */
export function openRequest(f: DeclareForm): ExchangeOpenRequestInput {
  const a = f.attacker;
  const named = a?.kind === 'name' ? a.name.trim() : '';
  const by: DeclaredBy = a?.kind === 'row' && a.runner ? { role: 'player', name: a.name } : { role: 'gm', name: 'GM' };
  const note = f.note.trim();
  return {
    target: f.target,
    ...(a?.kind === 'row' ? { attacker: { kind: 'combatant' as const, id: a.id } } : {}),
    ...(named ? { attackerName: named } : {}),
    attack: f.attack,
    hits: Math.max(0, Math.trunc(f.hits)),
    dv: { value: Math.max(0, Math.trunc(f.dv.value)), type: f.dv.type },
    ap: Math.trunc(f.ap),
    defenseModifier: Math.min(0, Math.trunc(f.defenseModifier)),
    ...(f.fire.mode ? { mode: f.fire.mode } : {}),
    ...(f.fire.rounds ? { rounds: f.fire.rounds } : {}),
    ...(note ? { note } : {}),
    by,
  };
}
