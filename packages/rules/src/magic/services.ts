/**
 * Spirit services (FR8.3) — the countdown the summoner actually argues about.
 *
 * A service is spent, not edited: one tap decrements, the count floors at zero,
 * and asking for more than remain is reported as a shortfall rather than
 * silently swallowed. The caller logs the event; this half only does the
 * arithmetic, so the same rules run in the browser preview and on the server.
 */

export interface ServiceState {
  /** Services left to call on. */
  remaining: number;
  /** What the spirit owed when it was summoned/bound — for the "3 of 5" line. */
  initial: number;
}

export interface ServiceChange {
  before: ServiceState;
  after: ServiceState;
  /** How many were actually consumed (never more than were left). */
  spent: number;
  /** Requested minus spent — non-zero means the summoner asked for too much. */
  shortfall: number;
  /** The spirit has nothing left to give. */
  exhausted: boolean;
}

const nn = (n: number): number => Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));

export function normalizeServices(state: Partial<ServiceState> | undefined): ServiceState {
  const remaining = nn(state?.remaining ?? 0);
  return { remaining, initial: Math.max(remaining, nn(state?.initial ?? remaining)) };
}

/** Spend `count` services; the counter floors at zero (never negative). */
export function spendServices(state: Partial<ServiceState>, count = 1): ServiceChange {
  const before = normalizeServices(state);
  const wanted = nn(count);
  const spent = Math.min(wanted, before.remaining);
  const after: ServiceState = { remaining: before.remaining - spent, initial: before.initial };
  return {
    before,
    after,
    spent,
    shortfall: wanted - spent,
    exhausted: after.remaining === 0,
  };
}

/** Grant services (a fresh binding, a renegotiated deal, a GM correction). */
export function grantServices(state: Partial<ServiceState>, count: number): ServiceChange {
  const before = normalizeServices(state);
  const added = nn(count);
  const remaining = before.remaining + added;
  return {
    before,
    after: { remaining, initial: Math.max(before.initial, remaining) },
    spent: -added,
    shortfall: 0,
    exhausted: remaining === 0,
  };
}

/** Set the counter outright (Principle 2: the GM can always just say a number). */
export function setServices(state: Partial<ServiceState>, count: number): ServiceChange {
  const before = normalizeServices(state);
  const remaining = nn(count);
  return {
    before,
    after: { remaining, initial: Math.max(before.initial, remaining) },
    spent: before.remaining - remaining,
    shortfall: 0,
    exhausted: remaining === 0,
  };
}
