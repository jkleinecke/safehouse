/**
 * The tactical hint on the acting NPC's row (FR10.10).
 *
 * One line, GM-only, off unless the campaign asked for it. It is rendered as
 * *prose in a note*, not as a control: no button, no click handler, no chip
 * that looks pressable. That is the point of the FR — a hint is what a co-GM
 * would mutter, and the GM decides what the NPC does. Making it tappable would
 * turn "suggestion" into "one tap and the opposition acts", which is exactly
 * the automation FR10.10 rules out.
 *
 * The marking is doubled so it survives both ways of reading the tracker: the
 * eye gets a dim, italic line prefixed `hint ▸`, and a screen reader gets an
 * accessible name that says "suggestion … it takes no action" before the advice
 * itself.
 */
import type { Combatant } from '@safehouse/contracts';
import { hintAriaLabel, hintProvenance, shouldShowHint, type TacticalHint } from './hints.js';
import { useQuickRolls } from './quickRolls.js';

export interface HintLineProps {
  combatant: Combatant;
  isGm: boolean;
  /** FR10.10 is a hint on the acting NPC's turn — not a column of advice. */
  acting: boolean;
  /** Skip the read entirely on rows that can never carry a hint. */
  fetch?: boolean;
}

/** The presentational half, split out so it renders from a fixture in a test. */
export function HintNote({ hint, name }: { hint: TacticalHint; name: string }) {
  return (
    <p
      className="mt-1.5 border-l-2 border-magenta-dim/60 pl-2 text-xs italic leading-snug text-dim"
      role="note"
      aria-label={hintAriaLabel(hint, name)}
      title={hintProvenance(hint)}
    >
      <span className="mono-label not-italic text-magenta">hint ▸ </span>
      {hint.text}
      <span className="mono-label ml-1.5 not-italic text-faint">{hint.roleTag} · advisory</span>
    </p>
  );
}

export default function HintLine({ combatant, isGm, acting, fetch = true }: HintLineProps) {
  // Shares the copilot rack's cache entry, so the hint costs no extra request
  // on a row that already has a rack (see quickRolls.ts). Nothing is asked for
  // at all on a player device or on a row that is not up.
  const query = useQuickRolls(combatant.id, fetch && isGm && acting);
  const hint = query.data?.hint;
  if (!shouldShowHint({ isGm, acting, hint })) return null;
  return <HintNote hint={hint as TacticalHint} name={combatant.name} />;
}
