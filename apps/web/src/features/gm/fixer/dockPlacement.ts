/**
 * Where the Fixer's dock floats (FR12.1), kept clear of the bars a screen
 * pins to the bottom.
 *
 * The dock was `bottom-4 right-4` everywhere. On a phone that put it over
 * the bottom navigation's last two tabs, whose labels it hid, and on the
 * character builder over the pools bar too; on a laptop's builder it sat on
 * the rail's last tile. So the offset follows the chrome under it: the
 * bottom navigation below `md`, and on the builder's walkthrough the pools
 * bar as well, below `lg` where that bar shows. Pure, so the rule is tested
 * without a DOM.
 */

/** The builder's walkthrough, `/c/:campaignId/build/:buildId` — not its list. */
export function isBuildWalkthrough(pathname: string): boolean {
  return /\/c\/[^/]+\/build\/[^/]+\/?$/.test(pathname);
}

/** Tailwind classes that pin the dock above whatever the screen keeps at its bottom edge. */
export function dockPlacement(pathname: string): string {
  return isBuildWalkthrough(pathname)
    ? 'right-3 bottom-[calc(7.5rem+env(safe-area-inset-bottom))] md:right-4 md:bottom-[4.5rem] lg:bottom-4'
    : 'right-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] md:right-4 md:bottom-4';
}
