/**
 * The walk and run range drawn on the map in a fight (`useMovementRange`),
 * read out: "Walk 10 m · Run 20 m". The Sprint and the fact that none of it
 * is a limit live in the tooltip.
 */
import type { MovementRange } from '../types.js';

/** Metres a Sprint adds per hit (SR5 p.162): 1 for dwarves and trolls, 2 for everyone else. */
function sprintPerHit(metatype: string | null): number {
  return /dwarf|troll/i.test(metatype ?? '') ? 1 : 2;
}

export default function PaceChip({ range, metatype }: { range: MovementRange; metatype: string | null }) {
  const perHit = sprintPerHit(metatype);
  const title =
    `How far this token can move this Combat Turn, from where its turn started: ` +
    `green is walking, amber is running, past the red line is a Sprint ` +
    `(Running + STR, +${perHit} m per hit; SR5 p.162). Shown only, never enforced.`;
  return (
    <div
      className="mono-label absolute bottom-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-edge bg-panel/94 px-2 py-1 backdrop-blur"
      title={title}
    >
      <span className="text-ok">Walk {range.walkM} m</span>
      <span className="text-faint"> · </span>
      <span className="text-warn">Run {range.runM} m</span>
    </div>
  );
}
