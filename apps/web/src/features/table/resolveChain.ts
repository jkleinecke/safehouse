/**
 * The resolve-chain dialog's non-visual half: the wire contract, the readers
 * that turn the server's cards into what the cards draw, and the store that
 * owns one exchange's lifecycle (FR10.8 / G5).
 *
 * THE DICE ARE THE SERVER'S. `roll()` posts to
 * `POST /api/encounters/:id/resolve-chain`, which throws all three pools with
 * `crypto.randomInt`, writes one `rolls` row per pool at `gm` visibility inside
 * a single transaction, and applies nothing. What comes back is the only source
 * of faces anywhere in this feature: the faces on the cards are the faces in the
 * log, which is the whole of G5 — "server-side dice with an immutable, visible
 * roll log". There is deliberately NO local fallback. When the endpoint cannot
 * be reached the dialog says so and shows no dice at all, because a
 * browser-rolled die the GM reads out to the table is worse than no die.
 *
 * No maths happens in this file either. Every displayed number is read off the
 * response — a client that recomputes a hit count is a second opinion nobody
 * asked for, and the one on the record is the server's.
 */
import type { LimitRef, ProvenanceEntry, RollResult } from '@safehouse/contracts';
import { ApiError, apiPost } from '../../api/client.js';
import { sendCommand } from './commands.js';

// ---------------------------------------------------------------------------
// The wire (apps/server/src/plugins/encounters.ts)
// ---------------------------------------------------------------------------

/** One overridable step as the server renders it (`ChainCard`, FR10.8). */
export interface ChainCard {
  step: string;
  label: string;
  overridable: boolean;
  data: Record<string, unknown>;
}

/** `POST /api/encounters/:id/resolve-chain` — dice rolled AND recorded. */
export interface ChainResponse {
  encounterId: string;
  attackerId: string;
  defenderId: string;
  weapon: string;
  bullets: number;
  cards: ChainCard[];
  /** What commit applies unless the GM overrides it; null when the shot missed. */
  suggested: { boxes: number; track: 'physical' | 'stun' } | null;
  notes: string[];
  /** Groups this exchange's `rolls` rows in the log. */
  chainId: string;
  rolls: Array<{ step: string; rollId: string }>;
  /** Always false here — damage lands on commit only (Principle 2). */
  committed: boolean;
}

/** Everything the endpoint accepts that this dialog offers the GM. */
export interface ChainRequest {
  attackerId: string;
  defenderId: string;
  weaponName?: string;
  fullDefense?: boolean;
  attackModifiers?: ProvenanceEntry[];
  defenseModifiers?: ProvenanceEntry[];
  dvOverride?: { value: number; type: 'P' | 'S' };
  apOverride?: number;
}

/** The GM's inputs, before they become a request. */
export interface ChainForm {
  attackerId: string;
  defenderId: string;
  weaponName: string | null;
  fullDefense: boolean;
  /** Situational dice the server folds into the attack pool (0 = none). */
  attackMod: number;
  defenseMod: number;
  /** Blank keeps the weapon's own values; `"9S"` / `-2` override them. */
  dv: string;
  ap: string;
}

/** `"9S"` → `{ value: 9, type: 'S' }`; blank or unreadable → null. */
export function parseDvOverride(text: string): { value: number; type: 'P' | 'S' } | null {
  const m = /^\s*(\d{1,2})\s*([psPS])?\s*$/.exec(text);
  if (!m) return null;
  return { value: Number(m[1]), type: (m[2] ?? 'P').toUpperCase() === 'S' ? 'S' : 'P' };
}

/**
 * Form → request body. Only fields the GM actually set are sent: an omitted
 * `dvOverride` means "use the weapon's own DV", which is the server's job to
 * know, not this client's to guess.
 */
export function chainRequest(form: ChainForm): ChainRequest {
  const dv = parseDvOverride(form.dv);
  const ap = form.ap.trim() === '' ? null : Number(form.ap);
  const mod = (value: number, label: string): ProvenanceEntry[] =>
    value === 0 ? [] : [{ label, value, source: 'situational' }];
  const attackModifiers = mod(form.attackMod, 'GM situational (attack)');
  const defenseModifiers = mod(form.defenseMod, 'GM situational (defense)');
  return {
    attackerId: form.attackerId,
    defenderId: form.defenderId,
    ...(form.weaponName ? { weaponName: form.weaponName } : {}),
    ...(form.fullDefense ? { fullDefense: true } : {}),
    ...(attackModifiers.length > 0 ? { attackModifiers } : {}),
    ...(defenseModifiers.length > 0 ? { defenseModifiers } : {}),
    ...(dv ? { dvOverride: dv } : {}),
    ...(ap !== null && Number.isFinite(ap) ? { apOverride: Math.trunc(ap) } : {}),
  };
}

/** Honest failure text — never "rolled locally instead". */
export function chainErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return `The server could not be reached (${err.message}).`;
    return `${err.message} [${err.code}]`;
  }
  return err instanceof Error ? err.message : 'Unknown error';
}

// ---------------------------------------------------------------------------
// Reading the cards (the server's `data` is untyped JSON on the wire)
// ---------------------------------------------------------------------------

const asNum = (v: unknown, fb = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fb;
const asStr = (v: unknown, fb = ''): string => (typeof v === 'string' ? v : fb);
const asBool = (v: unknown): boolean => v === true;
const asEntries = (v: unknown): ProvenanceEntry[] =>
  Array.isArray(v) ? (v.filter((e) => typeof e === 'object' && e !== null) as ProvenanceEntry[]) : [];
const asFaces = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((f): f is number => typeof f === 'number') : [];

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

/** A `RollResult` as it came off the wire — the ONLY source of faces here. */
export function asRoll(v: unknown): RollResult | null {
  const r = asRecord(v);
  if (!r || !Array.isArray(r['faces'])) return null;
  const glitch = r['glitch'];
  const hits = asNum(r['hits']);
  return {
    faces: asFaces(r['faces']),
    hits,
    ones: asNum(r['ones']),
    glitch: glitch === 'glitch' || glitch === 'critical' ? glitch : 'none',
    limitedHits: asNum(r['limitedHits'], hits),
    ...(Array.isArray(r['exploded']) ? { exploded: asFaces(r['exploded']) } : {}),
  };
}

function asLimit(v: unknown): LimitRef | null {
  const r = asRecord(v);
  if (!r || typeof r['value'] !== 'number') return null;
  return { kind: asStr(r['kind'], 'accuracy') as LimitRef['kind'], value: r['value'] };
}

export interface ChainView {
  attack: { pool: number; roll: RollResult | null; limit: LimitRef | null; breakdown: ProvenanceEntry[] } | null;
  defense: {
    pool: number;
    roll: RollResult | null;
    netHits: number;
    outcome: string;
    fullDefense: boolean;
    breakdown: ProvenanceEntry[];
  } | null;
  damage: {
    baseValue: number;
    baseType: string;
    modifiedDv: number;
    type: string;
    ap: number;
    armor: number;
    modifiedArmor: number;
    convertedToStun: boolean;
  } | null;
  soak: {
    pool: number;
    roll: RollResult | null;
    boxes: number;
    track: 'physical' | 'stun';
    breakdown: ProvenanceEntry[];
  } | null;
}

/** The server's cards, read into what the card UI draws. No maths happens here. */
export function chainView(res: ChainResponse | null): ChainView {
  const card = (step: string): ChainCard | null =>
    res?.cards.find((c) => c.step === step) ?? null;

  const attackCard = card('attack');
  const defenseCard = card('defense');
  const damageCard = card('damage');
  const soakCard = card('soak');
  const base = damageCard ? asRecord(damageCard.data['base']) : null;

  return {
    attack: attackCard
      ? {
          pool: asNum(attackCard.data['pool']),
          roll: asRoll(attackCard.data['roll']),
          limit: asLimit(attackCard.data['limit']),
          breakdown: asEntries(attackCard.data['breakdown']),
        }
      : null,
    defense: defenseCard
      ? {
          pool: asNum(defenseCard.data['pool']),
          roll: asRoll(defenseCard.data['roll']),
          netHits: asNum(defenseCard.data['netHits']),
          outcome: asStr(defenseCard.data['outcome'], 'miss'),
          fullDefense: defenseCard.label.toLowerCase().includes('full defense'),
          breakdown: asEntries(defenseCard.data['breakdown']),
        }
      : null,
    damage: damageCard
      ? {
          baseValue: asNum(base?.['value']),
          baseType: asStr(base?.['type'], 'P'),
          modifiedDv: asNum(damageCard.data['modifiedDv']),
          type: asStr(damageCard.data['type'], 'P'),
          ap: asNum(damageCard.data['ap']),
          armor: asNum(damageCard.data['armor']),
          modifiedArmor: asNum(damageCard.data['modifiedArmor']),
          convertedToStun: asBool(damageCard.data['convertedToStun']),
        }
      : null,
    soak: soakCard
      ? {
          pool: asNum(soakCard.data['pool']),
          roll: asRoll(soakCard.data['roll']),
          boxes: asNum(soakCard.data['boxes']),
          track: soakCard.data['track'] === 'stun' ? 'stun' : 'physical',
          breakdown: asEntries(soakCard.data['breakdown']),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// The dialog's lifecycle, as a store the tests can drive without a DOM
// ---------------------------------------------------------------------------

export interface ChainState {
  status: 'idle' | 'rolling' | 'ready' | 'error';
  /** The server's answer. Null on a failed roll — there is nothing else to show. */
  result: ChainResponse | null;
  /** A failed roll (with no result) or a refused commit (with one). */
  error: string | null;
  /** GM override of the boxes to commit; null means "the server's suggestion". */
  boxes: number | null;
  committed: boolean;
}

const IDLE: ChainState = { status: 'idle', result: null, error: null, boxes: null, committed: false };

/** Boxes the commit will send: the GM's number when they set one (Principle 2). */
export function commitBoxes(state: ChainState): number {
  return state.boxes ?? state.result?.suggested?.boxes ?? 0;
}

export function commitTrack(state: ChainState): 'physical' | 'stun' {
  return state.result?.suggested?.track ?? 'physical';
}

/** Log line for the applied damage, pointing back at the recorded dice. */
export function commitNote(res: ChainResponse, boxes: number, attackerName?: string): string {
  const view = chainView(res);
  const who = attackerName ? `${attackerName} → ` : '';
  const dv = view.damage ? `DV ${view.damage.modifiedDv}${view.damage.type}` : 'no damage';
  const soak = view.soak ? `, soak ${view.soak.roll?.hits ?? 0}` : '';
  return `${who}${res.weapon}: ${dv}${soak} → ${boxes} (chain ${res.chainId.slice(0, 8)})`;
}

export interface ChainStore {
  getState: () => ChainState;
  subscribe: (fn: () => void) => () => void;
  /** One authoritative roll. Re-entrant calls are dropped, not queued. */
  roll: (body: ChainRequest) => Promise<void>;
  setBoxes: (n: number | null) => void;
  /** Sends `damage.apply` at most once per resolved chain. */
  commit: (opts?: { attackerName?: string }) => boolean;
  /** Drop a result the GM's edits have made stale. */
  clear: () => void;
}

export function createChainStore(ctx: { campaignId: string; encounterId: string }): ChainStore {
  let state = IDLE;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ChainState>): void => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  };

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    clear() {
      if (state.status === 'rolling') return;
      if (state.status === 'idle' && state.result === null && state.error === null) return;
      set(IDLE);
    },
    setBoxes(n) {
      set({ boxes: n });
    },
    async roll(body) {
      if (state.status === 'rolling') return;
      set({ status: 'rolling', result: null, error: null, boxes: null, committed: false });
      try {
        const res = await apiPost<ChainResponse>(
          `/api/encounters/${ctx.encounterId}/resolve-chain`,
          body,
        );
        set({ status: 'ready', result: res, error: null, boxes: res.suggested?.boxes ?? 0 });
      } catch (err) {
        // No fallback: the GM is told the dice did not happen (G5).
        set({ status: 'error', result: null, error: chainErrorText(err), boxes: null });
      }
    },
    commit(opts = {}) {
      const res = state.result;
      if (!res || state.status !== 'ready' || state.committed) return false;
      const boxes = commitBoxes(state);
      if (boxes <= 0) return false;
      // Clearing the error matters on a retry: the previous refusal's notice
      // must not outlive the send that succeeded.
      set({ committed: true, error: null });
      const ok = sendCommand(ctx.campaignId, {
        cmd: 'damage.apply',
        combatantId: res.defenderId,
        encounterId: ctx.encounterId,
        monitor: commitTrack(state),
        boxes,
        note: commitNote(res, boxes, opts.attackerName),
      });
      if (!ok) {
        set({ committed: false, error: 'The table socket is not connected — nothing was applied.' });
      }
      return ok;
    },
  };
}
