/**
 * The shroud: everything one pair of eyes cannot see (FR9.16) — how dark it
 * is, and the key the map rebuilds it on. Pure, and it imports nothing: no
 * three, no DOM.
 *
 * Who sees what is decided in React (`useShroud`, handing the stage a
 * `ShroudState`). The map covers with it in `stage3d/masks.ts`, which turns
 * the visible set into one byte a square and rebuilds that only when
 * `shroudKey` moves; `stage3d/cover.ts` then darkens every fragment standing
 * over a square the viewer cannot see, by `SHROUD_ALPHA` or `GM_SHROUD_ALPHA`.
 * (Until P5 the 2D map drew it as well, as a scrim of flat polygons over the
 * hidden squares in `stage/shroudLayer.ts`; that drawing went with the 2D
 * map, and this is the part the two shared.)
 *
 * ## What it is and is not
 *
 * A DARKENING, not a deletion. The cells are still drawn underneath — the
 * shroud lays a scrim over the ones outside the viewer's sightline, so a
 * player can tell at a glance which squares they can actually act on, and a
 * GM can put a token's point of view on screen while planning.
 *
 * That is the same line the map has always drawn: fog and vision are a
 * presentation boundary for TERRAIN and a secrecy boundary for everything
 * else. Hidden tokens, GM pins and unrevealed fog regions never reach a player
 * socket at all (`sceneForViewer`); the floor plan does. Making terrain secret
 * would mean streaming the map as players explore it, which is a different
 * product, and buys nothing at a table all looking at one TV.
 */

/**
 * How dark the scrim is. Enough to read as "not yours", not enough to hide.
 * It is the shroud mask's amount in the cover (`stage3d/masks.ts`), and it is
 * why the shroud is never total there: only the fog discards.
 */
export const SHROUD_ALPHA = 0.62;

/** A softer wash for the GM, who is being shown a viewpoint, not limited to it. */
export const GM_SHROUD_ALPHA = 0.34;

export interface ShroudInput {
  /** `"col,row"` of every cell the viewer CAN see. */
  visible: ReadonlySet<string>;
  /**
   * The GM is previewing somebody else's eyes and still needs to run the rest
   * of the map, so their scrim is lighter — it informs rather than restricts.
   */
  gm: boolean;
  /** `"col,row"` → how tall that square stands, in cells. Absent is flat. */
  heights?: ReadonlyMap<string, number> | undefined;
  /**
   * The GM's "See as party" lens (`ShroudState.party`). Its `visible` is the
   * table's live squares, and an EMPTY one is still a view: the table sees
   * nothing live, so the lens darkens the whole floor, where an empty set
   * from a pair of eyes means there is no viewpoint and darkens nothing.
   */
  party?: boolean | undefined;
}

/** Whether `input` darkens anything at all: a view with a square in it, or the party's view even with none. */
export function shroudShown(input: ShroudInput | null): input is ShroudInput {
  return input !== null && (input.visible.size > 0 || input.party === true);
}

/**
 * Redraw key for the shroud.
 *
 * Content-hashed on the visible SET, not on its size: a token stepping
 * sideways behind a pillar can reveal one cell and hide another, leaving the
 * count identical while the shape changes completely — which is exactly the
 * move a player makes when checking an angle.
 */
export function shroudKey(input: ShroudInput | null): string {
  if (!shroudShown(input)) return 'none';
  let acc = 0;
  // Heights fold into the same accumulator: repainting a waist-high crate as a
  // full wall changed the silhouette the 2D scrim had to cover while leaving
  // the visible set — and so the old key — completely unmoved. The 3D mask
  // does not read heights (the cover hides a wall by the square under it), so
  // there a height change only rebuilds the same one byte a square; the key
  // still answers for everything the state carries.
  for (const [key, h] of input.heights ?? []) {
    acc = (acc + Math.round(h * 1000) + key.length) >>> 0;
  }
  for (const key of input.visible) {
    // FNV-1a per key, summed — order-independent, so a re-derived set that
    // iterates differently does not force a pointless redraw.
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i += 1) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    acc = (acc + (h >>> 0)) >>> 0;
  }
  return `${input.gm ? 'gm' : 'pc'}${input.party === true ? '+party' : ''}|${input.visible.size}|${acc.toString(16)}`;
}
