/**
 * The TV's encounter model (FR9.20 initiative ribbon + FR9.10 acting glow).
 *
 * Why this exists rather than reading `live/store.ts`'s `encounter` slice: the
 * server sends a `display` socket the *public* `encounter.updated` delta, whose
 * shape is `{ encounter, combatants, activeCombatantId, turnOrder, scope }` —
 * the roster rides BESIDE the encounter object, not inside it. The shared store
 * keeps only `payload.encounter`, so its `combatants` is always undefined on a
 * player/display device and a ribbon built from it is permanently empty. The
 * tracker's own "No combatants yet" bug is the same fault seen from the phone.
 *
 * So the TV normalises three shapes into one:
 *   1. the GM-grade `Encounter` (full `Combatant[]`) — what tests and a GM
 *      socket carry;
 *   2. `GET /api/encounters/:id`'s player view — the hydrate-on-mount read;
 *   3. the public `encounter.updated` payload — the live delta.
 *
 * Everything here is pure and tolerant: a field that is missing degrades, it
 * never throws. Nothing *hides* anything either — GM-only combatants were
 * dropped server-side (Principle 4); the visibility filter below is the honest
 * second layer, so a stale buffer can never paint a name the table may not read.
 */
import type { Combatant, Encounter, Token, WsEvent } from '@safehouse/contracts';
import { coarseBars } from '../grid/tvStage.js';
import type { TokenBars } from '../grid/types.js';
import { conditionBand, type ConditionBand } from '../table/initiative.js';
import { rec } from '../table/views.js';

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** One row of the ribbon, and the source of one token's decorations. */
export interface TvCombatantRow {
  id: string;
  name: string;
  initScore: number;
  /** Tiebreak only; a public payload omits it and 0 is a fine tiebreak. */
  initBase: number;
  actedThisPass: boolean;
  band: ConditionBand;
  effectCount: number;
  /**
   * The token this row drives, for the acting glow and the condition bars.
   * The public combatant view now carries `tokenId` (`encounters-model.ts
   * encounterForViewer`) — it leaks nothing, since a public combatant's token
   * is already on the display's socket. The name fallback in `tokenIdFor`
   * stays as a belt for rows that simply have no token.
   */
  tokenId: string | null;
  sourceId: string | null;
}

export interface TvEncounter {
  id: string;
  name: string;
  state: string;
  turn: number;
  pass: number;
  activeCombatantId: string | null;
  combatants: TvCombatantRow[];
}

/** Server-side coarse condition (`encounters-model.ts conditionOf`). */
const CONDITION_BAND: Record<string, ConditionBand> = {
  unharmed: 'fresh',
  wounded: 'wounded',
  bloodied: 'bloodied',
  down: 'down',
};

/** Rows a shared screen may show at all. */
function isPublicRow(raw: Record<string, unknown>): boolean {
  const visibility = str(raw['visibility']);
  // A player-scope row has no `visibility` key: the server already dropped
  // everything the device may not see before serializing.
  return visibility === undefined || visibility === 'public';
}

function bandOf(raw: Record<string, unknown>): ConditionBand {
  const monitors = raw['monitors'];
  if (monitors && typeof monitors === 'object') {
    const m = monitors as Combatant['monitors'];
    if (m.physical && m.stun && m.overflow) return conditionBand(m);
  }
  return CONDITION_BAND[str(raw['condition']) ?? ''] ?? 'fresh';
}

function effectCountOf(raw: Record<string, unknown>): number {
  const effects = raw['effects'];
  return Array.isArray(effects) ? effects.length : 0;
}

/** Normalise one combatant of any of the three shapes, or null if unusable. */
export function tvCombatantRow(input: unknown): TvCombatantRow | null {
  const raw = rec(input);
  const id = str(raw['id']);
  if (!id || !isPublicRow(raw)) return null;
  return {
    id,
    name: str(raw['name']) ?? 'Combatant',
    initScore: num(raw['initScore']) ?? 0,
    initBase: num(raw['initBase']) ?? 0,
    actedThisPass: raw['actedThisPass'] === true,
    band: bandOf(raw),
    effectCount: effectCountOf(raw),
    tokenId: str(raw['tokenId']) ?? null,
    sourceId: str(raw['sourceId']) ?? null,
  };
}

/**
 * Normalise any of the three encounter shapes. `combatants` is read from the
 * top level first (both server views put it there) and from inside the
 * encounter object second (the GM-grade `Encounter`).
 */
export function normalizeTvEncounter(input: unknown): TvEncounter | null {
  const raw = rec(input);
  if (raw['deleted'] === true) return null;
  const inner = rec(raw['encounter']);
  const body = Object.keys(inner).length > 0 ? inner : raw;

  const id = str(body['id']) ?? str(raw['encounterId']);
  if (!id) return null;

  const listRaw = Array.isArray(raw['combatants'])
    ? (raw['combatants'] as unknown[])
    : Array.isArray(body['combatants'])
      ? (body['combatants'] as unknown[])
      : [];
  const combatants = listRaw
    .map(tvCombatantRow)
    .filter((c): c is TvCombatantRow => c !== null);

  const active =
    str(raw['activeCombatantId']) ?? str(body['activeCombatantId']) ?? null;

  return {
    id,
    name: str(body['name']) ?? 'Encounter',
    state: str(body['state']) ?? 'prep',
    turn: num(body['turn']) ?? 0,
    pass: num(body['pass']) ?? 0,
    activeCombatantId: combatants.some((c) => c.id === active) ? active : null,
    combatants,
  };
}

/** Convenience for callers already holding a typed `Encounter`. */
export function tvEncounterFrom(encounter: Encounter | null | undefined): TvEncounter | null {
  return encounter ? normalizeTvEncounter(encounter) : null;
}

/**
 * The newest public `encounter.updated` in the buffer, or `base` when the
 * stream has said nothing since hydration.
 *
 * A GM-visibility delta is skipped twice over — the hub never puts one on a
 * display socket, and `scope: 'gm'` is refused here regardless. Both server
 * deltas carry the same encounter, so taking the newest usable one is also how
 * the TV follows the GM switching fights mid-session.
 */
export function tvEncounterFromEvents(
  events: readonly WsEvent[],
  base: TvEncounter | null = null,
): TvEncounter | null {
  // Selected by highest event id rather than array position: the ribbon on the
  // shared screen must not depend on the caller's buffer being sorted.
  let bestId = -1;
  let best: TvEncounter | null = null;
  let deleted = false;

  for (const e of events) {
    if (e.type !== 'encounter.updated' || e.visibility !== 'public' || e.id <= bestId) continue;
    const payload = rec(e.payload);
    if (payload['scope'] === 'gm') continue;
    if (payload['deleted'] === true) {
      // The fight the TV was showing is gone; fall back to nothing, not to a
      // stale roster the table would read as still live.
      const goneId = str(payload['encounterId']);
      if (!goneId || !base || base.id === goneId) {
        bestId = e.id;
        best = null;
        deleted = true;
      }
      continue;
    }
    const next = normalizeTvEncounter(payload);
    if (!next) continue;
    bestId = e.id;
    best = next;
    deleted = false;
  }

  if (best) return best;
  return deleted ? null : base;
}

/** True when the TV should switch from the idle card to the fight. */
export function isTvEncounterLive(encounter: TvEncounter | null): boolean {
  return Boolean(encounter && encounter.state === 'live' && encounter.combatants.length > 0);
}

// ---------------------------------------------------------------------------
// Ribbon rows + token decoration (FR9.20 / FR9.10)
// ---------------------------------------------------------------------------

export interface TvRibbonRow {
  id: string;
  name: string;
  score: number;
  order: number;
  acting: boolean;
  acted: boolean;
  band: ConditionBand;
}

/** Ribbon width — a TV shows the top of the order, not a spreadsheet. */
export const TV_RIBBON_CAP = 10;

/** Score desc, then initiative base desc, then id — matches the rules engine. */
function compareOrder(a: TvCombatantRow, b: TvCombatantRow): number {
  return b.initScore - a.initScore || b.initBase - a.initBase || (a.id < b.id ? -1 : 1);
}

/** Public combatants in acting order; the acting one is flagged for the glow. */
export function tvRibbonRows(
  encounter: TvEncounter | null,
  cap: number = TV_RIBBON_CAP,
): TvRibbonRow[] {
  const all = encounter?.combatants ?? [];
  if (all.length === 0) return [];
  const live = all.filter((c) => c.initScore > 0);
  const pool = live.length > 0 ? live : all;
  const sorted = [...pool].sort(compareOrder);
  const actingId =
    encounter?.activeCombatantId ?? sorted.find((c) => !c.actedThisPass)?.id ?? null;
  return sorted.slice(0, Math.max(0, cap)).map((c, i) => ({
    id: c.id,
    name: c.name,
    score: c.initScore,
    order: i + 1,
    acting: c.id === actingId,
    acted: c.actedThisPass,
    band: c.band,
  }));
}

/** The acting combatant's row, for the token glow. */
export function actingRow(encounter: TvEncounter | null): TvCombatantRow | null {
  if (!encounter) return null;
  const rows = tvRibbonRows(encounter, encounter.combatants.length);
  const actingId = rows.find((r) => r.acting)?.id ?? null;
  return encounter.combatants.find((c) => c.id === actingId) ?? null;
}

// ---------------------------------------------------------------------------
// Combatant → token decoration (FR9.6 bars/pips, FR9.10 acting glow)
// ---------------------------------------------------------------------------

export interface TvTokenDecor {
  /** tokenId → coarse condition bars + status pips. */
  bars: Map<string, TokenBars>;
  /** The token that gets the pulsing acting glow. */
  actingTokenId: string | null;
}

const EMPTY_DECOR: TvTokenDecor = { bars: new Map(), actingTokenId: null };

const normalizeName = (s: string): string => s.trim().toLowerCase();

/**
 * Resolve which token a combatant row drives.
 *
 * `tokenId` is the answer whenever the server sends one. It does not send one
 * to a display device yet (see the INTEGRATION note on `TvCombatantRow`), so
 * two fallbacks stand in: the shared `sourceId` (same character behind both
 * rows), then an unambiguous name match. An ambiguous name matches nothing —
 * a glow on the wrong token is worse than no glow at all.
 */
function tokenIndex(tokens: readonly Token[]): {
  byId: Map<string, Token>;
  bySource: Map<string, Token | null>;
  byName: Map<string, Token | null>;
} {
  const byId = new Map<string, Token>();
  const bySource = new Map<string, Token | null>();
  const byName = new Map<string, Token | null>();
  for (const t of tokens) {
    byId.set(t.id, t);
    if (t.sourceId) bySource.set(t.sourceId, bySource.has(t.sourceId) ? null : t);
    const name = normalizeName(t.name);
    byName.set(name, byName.has(name) ? null : t);
  }
  return { byId, bySource, byName };
}

/**
 * Bars and glow for every combatant that can be tied to a visible token.
 *
 * `barsVisibility: 'gm'` is honoured as the GM's explicit "not on the shared
 * screen" for that token. `'owner'` is not treated as a secret here: the value
 * drawn is the same coarse public band the initiative ribbon already prints
 * beside the name on this very screen (FR4.9) — never the exact boxes, which
 * the server does not send a display device at all.
 */
export function tvTokenDecor(
  encounter: TvEncounter | null,
  tokens: readonly Token[],
): TvTokenDecor {
  if (!encounter || encounter.combatants.length === 0 || tokens.length === 0) return EMPTY_DECOR;
  const index = tokenIndex(tokens);
  const bars = new Map<string, TokenBars>();
  const acting = actingRow(encounter);
  let actingTokenId: string | null = null;

  for (const row of encounter.combatants) {
    const token =
      (row.tokenId ? index.byId.get(row.tokenId) : undefined) ??
      (row.sourceId ? (index.bySource.get(row.sourceId) ?? undefined) : undefined) ??
      (index.byName.get(normalizeName(row.name)) ?? undefined);
    if (!token) continue;
    if (acting && row.id === acting.id) actingTokenId = token.id;
    if (token.barsVisibility === 'gm') continue;
    bars.set(token.id, coarseBars(row.band, row.effectCount));
  }

  return { bars, actingTokenId };
}
