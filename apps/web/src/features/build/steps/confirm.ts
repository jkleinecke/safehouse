/**
 * The warnings a step asks the player to acknowledge before Next (FR3.9,
 * docs/CHARGEN.md §4.4).
 *
 * Some of the book's losses are not errors — nothing stops a player moving on
 * — but they cannot be undone by coming back later either, so §4.4 has the
 * walkthrough say so at the moment of leaving:
 *
 * - **Step 2** — under Sum to Ten, priority points left unspent buy nothing
 *   (Run Faster p. 62): the rows are what the points were for, and no later
 *   step spends them.
 * - **Step 3** — special points left unspent vanish (p. 66): the step "warns
 *   before it lets you pass with 'I meant to'".
 * - **Step 7** — nuyen above the carry-over is lost (p. 94): the amount is
 *   "named as lost before Next".
 *
 * Which of these applies is the engine's call, not a second copy of the rule
 * here: each entry is a *warning code* `validate` already files under that
 * step, and the sentence the player reads is that warning's own message and
 * page. This file only adds our lead-in and the button's words. Pure data and
 * one lookup — no JSX — so the frame and a node test read the same thing.
 */
import type { Ref } from '@safehouse/contracts';
import type { StepStatus } from '@safehouse/rules';

/** What the frame shows when Next is pressed on a step with a loss pending. */
export interface NextConfirm {
  /** Our lead-in: what happens if the player goes on. */
  lead: string;
  /** The engine's own sentence for the loss. */
  message: string;
  ref: Ref | null;
  /** The button that goes on anyway. */
  confirmLabel: string;
}

interface ConfirmRule {
  code: string;
  lead: string;
  confirmLabel: string;
}

/** Keyed by walkthrough step number; the code is the validator's warning. */
const CONFIRM_RULES: Readonly<Record<number, ConfirmRule>> = {
  2: {
    code: 'sum-to-ten-under',
    lead: 'Priority points do not carry over: any left unspent when creation ends are gone.',
    confirmLabel: 'I meant to — next',
  },
  3: {
    code: 'special-points-unspent',
    // Not 'when you leave this step': Back reopens it, and Magic or Resonance may still take points before a kind is chosen.
    lead: 'Special points do not carry over: any left unspent when the runner is finished are gone.',
    confirmLabel: 'I meant to — next',
  },
  7: {
    code: 'nuyen-carry-lost',
    lead: 'Only a little nuyen carries into play: the rest is lost when the runner is finished.',
    confirmLabel: 'I meant to — next',
  },
};

/** The acknowledgement Next needs on this step right now, or null when Next may simply go. */
export function nextConfirmFor(status: Pick<StepStatus, 'step' | 'warnings'>): NextConfirm | null {
  const rule = CONFIRM_RULES[status.step];
  if (!rule) return null;
  const warning = status.warnings.find((w) => w.code === rule.code);
  if (!warning) return null;
  return { lead: rule.lead, message: warning.message, ref: warning.ref, confirmLabel: rule.confirmLabel };
}
