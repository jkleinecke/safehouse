/**
 * Every control on the Karma step asks the same three things before it offers
 * a tap — what does it cost, would it break a rule, and what does pressing it
 * do — and this is where they are asked (FR3.9, docs/CHARGEN.md §4.4 Step 8
 * "each with the cost quoted before the tap").
 *
 * A screen of forty steppers could each call `spendKarma`, `probe` and an
 * updater by hand and drift apart on one of them; instead `createKarmaTaps`
 * binds them once per draft to the step's props:
 *
 * - `raise(target, rating)` — the next rating's price from the engine's
 *   `spendKarma` over `buildPricing` (so Uncouth's and Uneducated's doubling
 *   is the engine's, never a multiplier here), the gate from the shell's
 *   probe, and the two pure updaters a stepper presses;
 * - `add(spend, key)` — the same for a new line (a spell, a specialisation,
 *   a bound spirit, a bonded focus);
 * - `change(fn, key, amount)` — a tap that edits a line already there (one
 *   more service, one more power point);
 * - `contact(fn, key)` — a contact's Connection or Loyalty, whose price is
 *   free contact Karma until that pool runs out and Karma after. Which pool
 *   pays is the engine's rule, so it is answered by running the engine's
 *   `budgets` over the change rather than restating the overflow here.
 *
 * Probes are keyed, so a screen re-rendering on the same draft validates each
 * candidate once. Pure (no React): the screen memoises one per draft, and the
 * tests call it with the analysis of a real build.
 */
import type { Budgets, CharacterBuild, ChargenSettings, KarmaSpend } from '@safehouse/contracts';
import { budgets as engineBudgets, buildPricing, spendKarma, type SpendPricing } from '@safehouse/rules';
import type { BuildProber } from '../../analysis.js';
import type { BuildUpdater } from '../../session.js';
import type { StepProps } from '../types.js';
import {
  changeCost,
  gateTap,
  raiseFloor,
  raiseKey,
  raiseSpend,
  withLower,
  withRaise,
  withSpend,
  type RaiseTarget,
  type TapGate,
} from './logic.js';

export interface KarmaTapContext {
  build: CharacterBuild;
  settings: ChargenSettings;
  budgets: Budgets;
  probe: BuildProber;
}

/** What every section of the step is handed: the step's props, the draft's taps, and whether it may edit. */
export interface KarmaSectionProps {
  step: StepProps;
  taps: KarmaTaps;
  /** Render only: a submitted build, a GM's review, an observer. */
  readOnly: boolean;
}

/** A stepper on something Karma raises. */
export interface RaiseTap {
  target: RaiseTarget;
  rating: number;
  /** The lowest rating the stepper may take it back to (this step's own raises only). */
  floor: number;
  /** Karma the next rating costs. */
  price: number;
  gate: TapGate;
  up: BuildUpdater;
  /** Take one rating back; null when this step raised nothing here to take back. */
  down: BuildUpdater | null;
}

/** A button that adds or changes a line. */
export interface SpendTap {
  price: number;
  gate: TapGate;
  apply: BuildUpdater;
}

/** A contact stepper: what the next point takes from each pool, and whether it may. */
export interface ContactTap {
  gate: TapGate;
  apply: BuildUpdater;
  karma: number;
  contactKarma: number;
}

export interface KarmaTaps {
  pricing: SpendPricing;
  priceOf(spend: KarmaSpend): number;
  raise(target: RaiseTarget, rating: number): RaiseTap;
  add(spend: KarmaSpend, key: string): SpendTap;
  change(fn: BuildUpdater, key: string, amount: number): SpendTap;
  contact(fn: BuildUpdater, key: string): ContactTap;
}

export function createKarmaTaps(ctx: KarmaTapContext): KarmaTaps {
  const pricing = buildPricing(ctx.build);
  const remaining = ctx.budgets.pools.karma.remaining;
  const after = new Map<string, Budgets>();
  const priceOf = (spend: KarmaSpend): number => spendKarma(spend, pricing);

  return {
    pricing,
    priceOf,
    raise(target, rating) {
      const up: BuildUpdater = (b) => withRaise(b, target, rating);
      const price = priceOf(raiseSpend(target, rating, rating + 1));
      const gate = gateTap(ctx.probe(up, `raise:${raiseKey(target)}:${rating}`), { amount: price, remaining });
      const floor = raiseFloor(ctx.build, target, rating);
      return {
        target,
        rating,
        floor,
        price,
        gate,
        up,
        down: floor < rating ? (b) => withLower(b, target, rating) : null,
      };
    },
    add(spend, key) {
      const apply: BuildUpdater = (b) => withSpend(b, spend);
      const price = priceOf(spend);
      return { price, apply, gate: gateTap(ctx.probe(apply, `add:${key}`), { amount: price, remaining }) };
    },
    change(fn, key, amount) {
      return { price: amount, apply: fn, gate: gateTap(ctx.probe(fn, `change:${key}`), { amount, remaining }) };
    },
    contact(fn, key) {
      let next = after.get(key);
      if (!next) {
        next = engineBudgets(fn(ctx.build), ctx.settings);
        after.set(key, next);
      }
      const cost = changeCost(ctx.budgets, next);
      const gate = gateTap(ctx.probe(fn, `contact:${key}`), { amount: cost.karma, remaining });
      return { gate, apply: fn, karma: cost.karma, contactKarma: cost.contactKarma };
    },
  };
}
