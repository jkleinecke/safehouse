/**
 * A named fog region's reveal controls (FR9.13/9.14; P6): where it stands
 * with the table, in the GM's words and colours, and the three buttons that
 * move it (live, seen before, hidden). Prep's list of everything on the
 * floor (`PrepOutline`) and a picked region's properties (`FogInspector`)
 * both use them.
 *
 * This file was the Fog tab. Its other controls moved to the GM's fog bar
 * (`hud/FogBar.tsx`, 2026-09-27): the fog switch, the sightlines, the brush,
 * forgetting what the party has seen (now part of "Fog everything"), and
 * drawing new regions, which the round brush replaced. Regions still come
 * from older scenes and from the Fixer's layouts and reveal suggestions,
 * and they are still revealed and hidden from here. Fog is authoritative on
 * the server: these buttons send `fog.reveal` and the canvas redraws when
 * `fog.updated` comes back, never optimistically.
 */
import type { Scene } from '@safehouse/contracts';
import { regionFashion, type RegionFashion } from '@safehouse/rules';
import type { GridCommands } from '../commands.js';

/**
 * Where a named region stands with the table (P6): revealed LIVE (the table
 * sees it, and everyone in it), revealed as EXPLORED (seen before: shown
 * dimmed, as remembered, with nobody in it), or HIDDEN. The rule itself is
 * the rules package's (`regionFashion`), shared with the server's Fixer and
 * the scenes manager; it is re-exported here for the panels that list
 * regions.
 */
export { regionFashion };
export type { RegionFashion };

/** The text colour a region's name takes in each fashion: the map's outline colours (green live, amber seen before). */
export const FASHION_TONE: Record<RegionFashion, string> = {
  live: 'text-ok',
  explored: 'text-warn',
  hidden: 'text-ink',
};

/** A region's fashion as the GM reads it in a list. */
export const FASHION_WORD: Record<RegionFashion, string> = {
  live: 'live',
  explored: 'seen before',
  hidden: 'hidden',
};

/**
 * The GM's three choices for one region, side by side (P6; the GM,
 * 2026-09-27): Reveal live, Reveal as seen-before, Hide. The one the region
 * is already in is shown pressed and does nothing; each of the others moves
 * it there, so a room the party has left can be dropped from live to seen
 * before with one tap, and its guards leave the table's screens as it goes.
 * Nothing is optimistic: the buttons ask, and the map redraws when
 * `fog.updated` comes back.
 *
 * `compact` is for a list row (Prep's outline), where there is room for a
 * word each; the full wording is then each button's title and label.
 */
export function RegionRevealButtons({
  scene,
  regionId,
  commands,
  announce,
  compact = false,
}: {
  scene: Scene;
  regionId: string;
  commands: GridCommands;
  announce: boolean;
  compact?: boolean;
}) {
  const now = regionFashion(scene.fog, regionId);
  const choice = (to: RegionFashion, label: string, short: string, title: string, run: () => void) => (
    <button
      type="button"
      aria-pressed={now === to}
      aria-label={label}
      title={title}
      data-testid={`fog-${to}-${regionId}`}
      onClick={() => {
        if (now !== to) run();
      }}
      className={
        'btn px-2 py-0.5 text-xs ' +
        (now === to ? (to === 'hidden' ? 'border-cyan text-cyan' : `border-current ${FASHION_TONE[to]}`) : 'text-dim hover:text-ink')
      }
    >
      {compact ? short : label}
    </button>
  );
  return (
    <span className={'flex shrink-0 gap-1' + (compact ? '' : ' flex-wrap')} role="group" aria-label="Reveal">
      {choice('live', 'Reveal live', 'live', 'Players and the TV see it, and everyone in it', () =>
        commands.fogReveal(scene.id, regionId, announce, 'live'),
      )}
      {choice('explored', 'Reveal as seen-before', 'seen', 'Players and the TV see it dimmed, as remembered, with nobody in it', () =>
        commands.fogReveal(scene.id, regionId, announce, 'explored'),
      )}
      {choice('hidden', 'Hide', 'hide', 'Fog it again: the table sees nothing of it', () => commands.fogHide(scene.id, regionId))}
    </span>
  );
}
