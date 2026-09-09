/**
 * Whose eyes the canvas is showing (FR9.16).
 *
 * Two audiences, two answers, and keeping them distinct is the whole design:
 *
 *  - **A player** is shown what their own character can see. The shroud is
 *    information they are entitled to and cannot get any other way — "can I
 *    see the door from here" is otherwise a question they have to ask out loud
 *    and the GM has to adjudicate from a floor plan only they can read.
 *  - **A GM** is shown a viewpoint they PICK, and only while they want it.
 *    They still have to run the rest of the map, so their scrim is lighter and
 *    it defaults to off. A GM permanently limited to one token's view could
 *    not do their job.
 *
 * Nothing here is authoritative. The shroud darkens terrain the viewer cannot
 * see; it does not decide what data reaches them. Hidden tokens and unrevealed
 * fog are already stripped server-side (`sceneForViewer`), and that is where
 * secrecy lives.
 */
import { useMemo } from 'react';
import type { Scene, Token } from '@safehouse/contracts';
import { coneCells, sightModelFor, visibleFrom, DEFAULT_SIGHT_RANGE } from '@safehouse/rules';
import type { ShroudState } from './types.js';

/**
 * A lens id that names a camera rather than a token (FR9.23): the GM's
 * "show me what this camera sees". Cameras never appear in a player's
 * scene, so a player asking for one gets nothing.
 */
export const CAMERA_LENS = 'camera:';

export function cameraLensId(cameraId: string): string {
  return `${CAMERA_LENS}${cameraId}`;
}

/** The camera a lens id names, or null when it names a token or nothing. */
export function viewpointCameraId(inputs: ShroudInputs): string | null {
  if (!inputs.isGm || inputs.losTokenId === null) return null;
  return inputs.losTokenId.startsWith(CAMERA_LENS) ? inputs.losTokenId.slice(CAMERA_LENS.length) : null;
}

export interface ShroudInputs {
  scene: Scene | null | undefined;
  tokens: readonly Token[];
  isGm: boolean;
  /** The GM's chosen viewpoint, or null for "show me everything". */
  losTokenId: string | null;
  /**
   * This device's own CHARACTER, for the player case. Resolved to a token
   * here rather than by the caller: which token represents a character is a
   * fact about the scene, and invites are not character-bound, so a
   * client-supplied token id would let any device claim any viewpoint.
   */
  myCharacterId: string | null;
  /** Players can be shown the whole map — the GM's switch, per scene. */
  enabledForPlayers: boolean;
}

/**
 * Which token's eyes to use, or null for none.
 *
 * A GM's explicit pick always wins, including over their own party's tokens:
 * "what does the guard see" is the question that makes this tool worth having.
 */
export function viewpointTokenId(inputs: ShroudInputs): string | null {
  if (inputs.isGm) return viewpointCameraId(inputs) === null ? inputs.losTokenId : null;
  if (!inputs.enabledForPlayers || inputs.myCharacterId === null) return null;
  const mine = inputs.tokens.find(
    (t) => t.source === 'character' && t.sourceId === inputs.myCharacterId,
  );
  return mine?.id ?? null;
}

/**
 * The shroud for this viewer, or null to draw none.
 *
 * Memoised on the things that can actually move a sightline — the tile layers,
 * the drawn geometry, and the viewpoint's own position. Token positions of
 * OTHER tokens are deliberately not in the key: a body does not block sight in
 * this model, and rebuilding the set every time anybody shuffles a step would
 * cost a full recompute per drag frame.
 */
export function useShroud(inputs: ShroudInputs): ShroudState | null {
  const { scene, tokens, isGm } = inputs;
  const tokenId = viewpointTokenId(inputs);
  const viewer = tokenId === null ? undefined : tokens.find((t) => t.id === tokenId);
  const cameraId = viewpointCameraId(inputs);
  const camera = cameraId === null ? undefined : scene?.geometry.cameras?.find((c) => c.id === cameraId);

  const vx = viewer?.x;
  const vy = viewer?.y;

  return useMemo(() => {
    if (scene && camera !== undefined) {
      // Through the camera's eye (FR9.23): its cone, plus the square it is
      // mounted in, so the mount itself is not scrimmed out of the picture.
      const model = sightModelFor(scene, camera.level ?? 0);
      const visible = new Set(coneCells(camera, model, { cols: scene.grid.cols, rows: scene.grid.rows }).keys());
      visible.add(`${Math.floor(camera.at.x)},${Math.floor(camera.at.y)}`);
      const heights = new Map<string, number>();
      for (const [key, cell] of model.cells) {
        if (cell.height > 0) heights.set(key, cell.height);
      }
      return { visible, gm: true, heights };
    }
    if (!scene || viewer === undefined || vx === undefined || vy === undefined) {
      return null;
    }
    // The viewer's OWN floor. A guard on the catwalk sees the catwalk,
    // whatever storey the GM happens to be editing — and the warehouse walls
    // below must not block a sightline one floor up.
    const model = sightModelFor(scene, viewer.level ?? 0);
    // Tokens sit on cell CENTRES (x.5), so flooring is what turns a position
    // into the square it occupies.
    const visible = visibleFrom(
      { col: Math.floor(vx), row: Math.floor(vy) },
      model,
      { range: DEFAULT_SIGHT_RANGE, cols: scene.grid.cols, rows: scene.grid.rows },
    );
    // Heights come off the SAME model the sightline was computed from, so the
    // scrim can never disagree with the thing it is covering.
    const heights = new Map<string, number>();
    for (const [key, cell] of model.cells) {
      if (cell.height > 0) heights.set(key, cell.height);
    }
    return { visible: new Set(visible.keys()), gm: isGm, heights };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scene?.id,
    // The three things that change a sightline. Stringified because these are
    // fresh objects on every fetch and identity would defeat the memo.
    JSON.stringify(scene?.tiles?.structure ?? {}),
    JSON.stringify(scene?.tiles?.object ?? {}),
    JSON.stringify(scene?.geometry.walls ?? []),
    JSON.stringify(scene?.geometry.doors ?? []),
    scene?.grid.cols,
    scene?.grid.rows,
    vx,
    vy,
    viewer?.level ?? 0,
    isGm,
    // The camera lens: which camera, and where it points.
    JSON.stringify(camera ?? null),
  ]);
}
