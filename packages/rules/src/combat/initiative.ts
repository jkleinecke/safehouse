import type { Combatant, InitKind, Ref } from '@safehouse/contracts';
import { COMBAT_ACTIONS } from './actions.js';
import { computeWoundModifier } from './damage.js';

/** SR5 hard cap on initiative dice (§10.2, FR4.2). */
export const MAX_INIT_DICE = 5;

/** One initiative roll's receipt (FR4.2), plus the updated combatant row. */
export interface InitiativeRollDetail {
  kind: InitKind;
  base: number;
  dice: number;
  rolls: number[];
  /** Wound modifier applied to the score (negative or 0). */
  woundModifier: number;
  score: number;
  /** Copy of the input combatant with `initScore`/`initKind` set, `actedThisPass` reset. */
  combatant: Combatant;
}

export interface RollInitiativeOptions {
  /** Override the base (e.g. hand-entered or a derived line for another kind). */
  base?: number;
  /** Override the dice count (still capped at 5). */
  dice?: number;
  /** Override the wound modifier instead of deriving it from the monitors. */
  woundModifier?: number;
}

/**
 * Roll a combatant's initiative (FR4.2): `initBase` + `initDice`d6, wound
 * modifier applied to the score. `kind` defaults to the combatant's own
 * `initKind`; when rolling a different kind, pass the matching derived line
 * via `opts.base`/`opts.dice` (the combatant row only stores one line).
 */
export function rollInitiative(
  combatant: Combatant,
  kind?: InitKind,
  rng: () => number = Math.random,
  opts: RollInitiativeOptions = {},
): InitiativeRollDetail {
  const resolvedKind = kind ?? combatant.initKind;
  const base = opts.base ?? combatant.initBase;
  const dice = Math.min(MAX_INIT_DICE, Math.max(0, Math.floor(opts.dice ?? combatant.initDice)));
  const rolls: number[] = [];
  for (let i = 0; i < dice; i += 1) {
    rolls.push(1 + Math.floor(rng() * 6));
  }
  const woundModifier = opts.woundModifier ?? computeWoundModifier(combatant.monitors);
  const score = base + rolls.reduce((sum, r) => sum + r, 0) + woundModifier;
  return {
    kind: resolvedKind,
    base,
    dice,
    rolls,
    woundModifier,
    score,
    combatant: {
      ...combatant,
      initKind: resolvedKind,
      initScore: score,
      actedThisPass: false,
    },
  };
}

/**
 * The three attributes that break a tie in Initiative Score (SR5 p.159):
 * Edge, then Reaction, then Intuition, the higher going first — "ERIC", the
 * C being the coin toss when all three tie as well.
 *
 * Each is optional because not every row has a sheet to read them from. A
 * hand-added NPC may only have an Edge pool, and a bare row has nothing. A
 * missing attribute counts as 0, so a row the app knows nothing about loses
 * the comparison to one it does. That is not a rule, only the least surprising
 * way to keep the order total; the GM can drag either row wherever the table
 * says it belongs.
 */
export interface EricAttributes {
  edg?: number;
  rea?: number;
  int?: number;
}

/**
 * What the acting order needs beyond the rows themselves.
 *
 * Seize the Initiative and a Delayed Action ride on the rows (`seized`,
 * `delayed`), because they belong to one combatant. These three belong to the
 * fight:
 *
 *  - `manualOrder` — the GM's arrangement for this Combat Turn, combatant ids
 *    first to last. It moves PLACES only (the GM's decision of 2026-09-28): a
 *    score, and so how many passes a row acts in (p.159), is never touched by
 *    it. Null, absent or empty is the book's order.
 *  - `eric` — each row's tie-break attributes, by combatant id, where a sheet
 *    gives them (p.159). Rows left out count as all zeros.
 *  - `coin` — a seed for the coin toss that ends a tie ERIC cannot (p.159).
 *    The same seed gives the same toss every time the order is drawn, so the
 *    order never flickers between two frames; the server seeds it with the
 *    fight and its Combat Turn, so the coin is thrown afresh each turn.
 */
export interface TurnOrderOptions {
  manualOrder?: readonly string[] | null;
  eric?: Readonly<Record<string, EricAttributes>>;
  coin?: string;
  /** Initiative is still being gathered: nobody is up until the GM starts the turn. */
  gathering?: boolean;
}

/**
 * A 32-bit FNV-1a hash: the "coin" for one row under one seed. Not random in
 * any cryptographic sense, and it does not need to be — it only has to be fair
 * between two rows nobody can pick the ids of, and the same on every read.
 */
function coinOf(seed: string, id: string): number {
  let h = 0x811c9dc5;
  const text = `${seed}:${id}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * The book's order between two rows (negative: `a` acts first).
 *
 *  1. Anyone who spent Edge to Seize the Initiative this Combat Turn goes
 *     before everybody else (p.160-161). Two seizers go in order of their
 *     Initiative Scores, which the rest of this chain does for them.
 *  2. Higher Initiative Score first (p.159).
 *  3. A tie goes to the higher Edge, then Reaction, then Intuition (p.159).
 *  4. Then the coin (p.159), and the id only if two hashes collide.
 *
 * The old stand-in — higher initiative base, then id — is gone: the base is
 * REA + INT for most rows, so it mostly agreed with the R and I of step 3,
 * but it skipped Edge, and the id at the end always favoured the same row.
 */
export function compareInitiative(
  a: Combatant,
  b: Combatant,
  opts: TurnOrderOptions = {},
): number {
  const seized = Number(b.seized === true) - Number(a.seized === true);
  if (seized !== 0) return seized;
  const score = b.initScore - a.initScore;
  if (score !== 0) return score;
  const ea = opts.eric?.[a.id] ?? {};
  const eb = opts.eric?.[b.id] ?? {};
  const eric =
    (eb.edg ?? 0) - (ea.edg ?? 0) || (eb.rea ?? 0) - (ea.rea ?? 0) || (eb.int ?? 0) - (ea.int ?? 0);
  if (eric !== 0) return eric;
  const seed = opts.coin ?? '';
  const coin = coinOf(seed, a.id) - coinOf(seed, b.id);
  if (coin !== 0) return coin;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Acting order for the current pass (FR4.3): everyone with a score above 0.
 *
 * With no manual order it is the book's order (`compareInitiative`): seizers
 * first, then score, then ERIC, then the coin.
 *
 * With one, the named rows go in the GM's order, and a row the list does not
 * name — a late joiner, a row whose score came back above 0, a seizer the
 * list was cut from — is slotted in by the book: straight after the last row
 * that outranks it (first of all when nobody does). So the GM's arrangement
 * of everyone above it stands, and a runner joining on 17 lands after the 20
 * and before the 15 wherever the GM put those. Rows are slotted in the book's
 * own order, so two unnamed rows never swap with each other. A name for a
 * row that is gone, or whose score is 0 or less, is skipped.
 *
 * A row holding a Delayed Action (p.161) keeps its place here; `nextActor`
 * steps over it until the GM says it acts. So the order a client draws is the
 * one the table plays, with the delayed row visible where it was waiting.
 */
export function turnOrder(combatants: Combatant[], opts: TurnOrderOptions = {}): Combatant[] {
  const book = combatants
    .filter((c) => c.initScore > 0)
    .sort((a, b) => compareInitiative(a, b, opts));
  const manual = opts.manualOrder;
  if (!manual || manual.length === 0) return book;

  const byId = new Map(book.map((c) => [c.id, c]));
  const out: Combatant[] = [];
  const placed = new Set<string>();
  for (const id of manual) {
    const c = byId.get(id);
    if (!c || placed.has(id)) continue;
    out.push(c);
    placed.add(id);
  }
  for (const c of book) {
    if (placed.has(c.id)) continue;
    let at = 0;
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (compareInitiative(out[i]!, c, opts) < 0) {
        at = i + 1;
        break;
      }
    }
    out.splice(at, 0, c);
    placed.add(c.id);
  }
  return out;
}

/**
 * The next combatant to act this pass, or null when there is nobody left to
 * call: the first row in the order that has not acted and is not holding a
 * Delayed Action (p.161).
 */
export function nextActor(combatants: Combatant[], opts: TurnOrderOptions = {}): Combatant | null {
  if (opts.gathering) return null;
  return turnOrder(combatants, opts).find((c) => !c.actedThisPass && c.delayed !== true) ?? null;
}

/**
 * Rows still holding a Delayed Action this pass, in order (p.161). While any
 * are left, the pass is not over: a delayed character may go after everyone
 * else, as long as they act before the pass ends. So "Next" past the last
 * ordinary actor stops here instead of taking 10 off every score, and only a
 * second press — the GM moving on — ends the pass. A delay the GM moves past
 * carries into the next pass, where the row may act first (p.161).
 */
export function delayedRows(combatants: Combatant[], opts: TurnOrderOptions = {}): Combatant[] {
  return turnOrder(combatants, opts).filter((c) => c.delayed === true && !c.actedThisPass);
}

/**
 * The manual order after the GM drags one row to a new place.
 *
 * `toIndex` is where the row ends up in the order as drawn (0 is first),
 * clamped to the list. Place only: nothing about any score changes. Returns
 * null when the row has no place to move — it is not in the fight, or its
 * score is 0 or less, which leaves it no Action Phase this pass (p.159).
 */
export function moveInOrder(
  combatants: Combatant[],
  combatantId: string,
  toIndex: number,
  opts: TurnOrderOptions = {},
): string[] | null {
  const ids = turnOrder(combatants, opts).map((c) => c.id);
  if (!ids.includes(combatantId)) return null;
  const rest = ids.filter((id) => id !== combatantId);
  const at = Math.max(0, Math.min(rest.length, Math.floor(toIndex)));
  rest.splice(at, 0, combatantId);
  return rest;
}

/**
 * The manual order after "Act now": the row goes directly in front of whoever
 * would act next, so it is the one acting — every row above it has either
 * acted or is still holding a delay. With nobody left to call it goes last,
 * which is the same thing (p.161: a delayed character may go after the last
 * one). A row already next stays where it is.
 *
 * This is how a Delayed Action is used: the character intervenes where the
 * order has got to, on a score lower than their own, and keeps their own
 * score for the passes to come (p.161). Returns null for a row with no place.
 */
export function actNowOrder(
  combatants: Combatant[],
  combatantId: string,
  opts: TurnOrderOptions = {},
): string[] | null {
  const ids = turnOrder(combatants, opts).map((c) => c.id);
  if (!ids.includes(combatantId)) return null;
  const others = combatants.filter((c) => c.id !== combatantId);
  const current = nextActor(others, opts);
  const rest = ids.filter((id) => id !== combatantId);
  const at = current ? rest.indexOf(current.id) : rest.length;
  // `current` is never the row itself (it was taken out above), and it is
  // always in `rest` (it came from the same order). -1 cannot happen, but a
  // bad index must not put the row in front of someone who already acted.
  rest.splice(at < 0 ? rest.length : at, 0, combatantId);
  return rest;
}

/**
 * Seize the Initiative (SR5 p.160-161, FR2.3/FR4.4): a point of Edge moves
 * the character to the top of the order, whatever their Initiative Score, for
 * the whole Combat Turn. Several seizers go before everyone else in order of
 * their scores. The next Combat Turn puts them back where the dice say.
 *
 * The SCORE does not change. It used to be raised to one above the leader,
 * which also handed out passes: a runner on 11 seizing over a 24 became 25 and
 * acted three times instead of twice. The book moves the place, not the
 * number (and the GM's reorder rule is the same: place only).
 *
 * Nor does it give back an Action Phase already taken this pass. A seizer who
 * has acted this pass leads from the next pass on.
 */
export interface SeizeInitiativeOutcome {
  /** The Initiative Score, before and after: a seize never changes it. */
  score: number;
  /** 1-based place in the order before the spend; null while the row has no place (score 0 or less). */
  from: number | null;
  /** 1-based place after the spend; null while the row has no place yet. */
  to: number | null;
  /** False when the row already led — the Edge still buys the guarantee for the turn. */
  changed: boolean;
  /**
   * The manual order to store after the spend: the one before, without this
   * row, so the book's order puts it with the other seizers at the top. Null
   * when there was no manual order (nor anything left in it).
   */
  manualOrder: string[] | null;
}

/**
 * Work out a seize on a roster. Pure: the caller stores `seized` on the row
 * and `manualOrder` on the fight. A row that is not in the roster throws.
 *
 * A row with no score yet (a hand-rolled line still blank) can seize: it is
 * marked, and it goes to the top once its score comes in. `from`/`to` are
 * then null.
 */
export function seizeInitiative(
  combatants: Combatant[],
  combatantId: string,
  opts: TurnOrderOptions = {},
): SeizeInitiativeOutcome {
  const actor = combatants.find((c) => c.id === combatantId);
  if (!actor) throw new Error(`seizeInitiative: no combatant ${combatantId}`);
  const placeIn = (list: Combatant[], o: TurnOrderOptions): number | null => {
    const at = turnOrder(list, o).findIndex((c) => c.id === combatantId);
    return at < 0 ? null : at + 1;
  };
  const from = placeIn(combatants, opts);
  const kept = (opts.manualOrder ?? []).filter((id) => id !== combatantId);
  const manualOrder = kept.length > 0 ? kept : null;
  const after = combatants.map((c) => (c.id === combatantId ? { ...c, seized: true } : c));
  const to = placeIn(after, { ...opts, manualOrder });
  return { score: actor.initScore, from, to, changed: from !== to, manualOrder };
}

/** Mark a combatant as having acted in the current pass. */
export function markActed(combatant: Combatant): Combatant {
  return { ...combatant, actedThisPass: true };
}

/**
 * End of pass (FR4.3): every score drops by 10 (floored at 0) and
 * `actedThisPass` resets. Anyone still above 0 acts again next pass.
 */
export function advancePass(combatants: Combatant[]): Combatant[] {
  return combatants.map((c) => ({
    ...c,
    initScore: Math.max(0, c.initScore - 10),
    actedThisPass: false,
  }));
}

/** True while anyone still has a score above 0 — run another pass, else new turn. */
export function anyActiveScores(combatants: Combatant[]): boolean {
  return combatants.some((c) => c.initScore > 0);
}

/**
 * New combat turn: every combatant re-rolls initiative (FR4.3). A seize and a
 * delay last only for the turn they were made in (p.160-161), so both flags
 * come off here; the fight's manual order is the caller's to clear.
 */
export function beginTurn(
  combatants: Combatant[],
  rng: () => number = Math.random,
): { combatants: Combatant[]; rolls: InitiativeRollDetail[] } {
  const rolls = combatants.map((c) => rollInitiative(withoutTurnFlags(c), undefined, rng));
  return { combatants: rolls.map((r) => r.combatant), rolls };
}

/** A row with this Combat Turn's seize and delay taken off. */
function withoutTurnFlags(c: Combatant): Combatant {
  const out = { ...c };
  delete out.seized;
  delete out.delayed;
  return out;
}

/** An interrupt action and its Initiative Score cost (FR4.4). */
export interface InterruptAction {
  id: string;
  name: string;
  /** Positive number of points deducted from the current score. */
  cost: number;
  /** Where the book explains it, so a menu can show the page. */
  ref?: Ref;
}

/**
 * Default interrupt cost table (FR4.4) — fully editable per campaign; the UI
 * copies it into campaign settings rather than importing it as law.
 *
 * A view of the action catalogue (`actions.ts`): every Interrupt there, with
 * the Initiative Score it costs and its page, in the catalogue's order (Full
 * Defense, Dodge, Block, Parry, Intercept, Hit the Dirt). There is one list
 * of what an Interrupt costs, so the tracker's menu and a guided Dodge card
 * can never disagree about the price.
 */
export const DEFAULT_INTERRUPTS: readonly InterruptAction[] = COMBAT_ACTIONS.filter(
  (a) => a.type === 'interrupt' && a.initCost !== undefined,
).map((a) => ({ id: a.id, name: a.name, cost: a.initCost ?? 0, ref: a.ref }));

/** Soft guard for the UI: does the combatant have the score to pay full price? */
export function canInterrupt(combatant: Combatant, action: number | InterruptAction): boolean {
  const cost = Math.abs(typeof action === 'number' ? action : action.cost);
  return combatant.initScore >= cost;
}

/**
 * Apply an interrupt's cost immediately (FR4.4). The score may drop to or
 * below 0 — the combatant then acts no further this turn (GM's call to allow;
 * `canInterrupt` is the soft check).
 */
export function applyInterrupt(combatant: Combatant, action: number | InterruptAction): Combatant {
  const cost = Math.abs(typeof action === 'number' ? action : action.cost);
  return { ...combatant, initScore: combatant.initScore - cost };
}
