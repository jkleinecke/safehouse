/**
 * Threat readout heuristics (FR10.5): estimated math, shown, never hidden.
 * These are ESTIMATES the GM tunes — SR5 has no CR and we don't pretend
 * otherwise (Principle 3, R10). hits ≈ pool ÷ 3.
 */

/** Expected hits on a pool: pool / 3 (raw, unrounded — display rounds). */
export function expectedHits(pool: number): number {
  return Math.max(0, pool) / 3;
}

/** Parsed damage code, e.g. '8P' → { base: 8, type: 'P' }, '10S(e)' → tag 'e'. */
export interface DvCode {
  base: number;
  type: 'P' | 'S';
  /** Element/ammo tag inside parens, e.g. 'e', 'f' — user-entered, passed through. */
  tag?: string;
}

/** Parse a user-entered DV string like '8P', '10S(e)', '12P(f)', '9'. */
export function parseDv(dv: string): DvCode {
  const m = /^\s*(\d+)\s*([PSps])?\s*(?:\(([^)]*)\))?\s*$/.exec(dv);
  if (!m || m[1] === undefined) {
    throw new Error(`generator.parseDv: unparseable damage code "${dv}"`);
  }
  const type = (m[2] ?? 'P').toUpperCase() as 'P' | 'S';
  const out: DvCode = { base: Number.parseInt(m[1], 10), type };
  if (m[3]) out.tag = m[3];
  return out;
}

/** One direction of an exchange estimate, with the math on display. */
export interface ExchangeEstimate {
  attackPool: number;
  defensePool: number;
  soakPool: number;
  /** pool / 3 heuristics (raw). */
  attackHits: number;
  defenseHits: number;
  /** max(0, attackHits − defenseHits). */
  netHits: number;
  /** True when netHits > 0 — the attack is expected to connect at all. */
  connects: boolean;
  dv: DvCode;
  /** dv.base + netHits (only meaningful when it connects). */
  modifiedDv: number;
  soakHits: number;
  /** max(0, modifiedDv − soakHits) when connecting, else 0. */
  boxesPerConnect: number;
  /** Human-readable receipt, e.g. 'attack 12 vs defense 9 → ~1 net → DV 9P vs soak 15 → ~4 boxes'. */
  summary: string;
}

/**
 * Estimate one attack exchange direction (FR10.5).
 * Example from the spec: attack 12 vs defense 9, DV '8P', soak 15
 * → ~1 net hit → modified DV 9 → soak ~5 → ~4 boxes per connect.
 * Call it once per direction for the both-ways readout (or use exchangePair).
 */
export function exchangeEstimate(
  attackPool: number,
  defensePool: number,
  dv: string,
  soakPool: number,
): ExchangeEstimate {
  const parsed = parseDv(dv);
  const attackHits = expectedHits(attackPool);
  const defenseHits = expectedHits(defensePool);
  const netHits = Math.max(0, attackHits - defenseHits);
  const connects = netHits > 0;
  const modifiedDv = parsed.base + netHits;
  const soakHits = expectedHits(soakPool);
  const boxesPerConnect = connects ? Math.max(0, modifiedDv - soakHits) : 0;
  const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const summary = connects
    ? `attack ${attackPool} vs defense ${defensePool} → ~${fmt(netHits)} net → ` +
      `DV ${fmt(modifiedDv)}${parsed.type} vs soak ${soakPool} → ~${fmt(boxesPerConnect)} boxes`
    : `attack ${attackPool} vs defense ${defensePool} → expected miss`;
  return {
    attackPool,
    defensePool,
    soakPool,
    attackHits,
    defenseHits,
    netHits,
    connects,
    dv: parsed,
    modifiedDv,
    soakHits,
    boxesPerConnect,
    summary,
  };
}

/** One side of a both-ways exchange readout. */
export interface ExchangeSide {
  attackPool: number;
  defensePool: number;
  /** Damage code of this side's attack, e.g. '8P'. */
  dv: string;
  soakPool: number;
}

/** FR10.5 both directions: A attacking B, and B attacking A. */
export function exchangePair(
  a: ExchangeSide,
  b: ExchangeSide,
): { aVsB: ExchangeEstimate; bVsA: ExchangeEstimate } {
  return {
    aVsB: exchangeEstimate(a.attackPool, b.defensePool, a.dv, b.soakPool),
    bVsA: exchangeEstimate(b.attackPool, a.defensePool, b.dv, a.soakPool),
  };
}
