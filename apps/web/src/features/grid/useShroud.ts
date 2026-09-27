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
 *
 * One of the GM's lenses is not a pair of eyes at all but the TABLE's: "See
 * as party" (`PARTY_LENS`, sightlines, P6). The table's view is worked out
 * on the server, pooled over every runner, and it reaches every device in
 * the fog (`FogState.sight`), so the lens computes no sightline: it reads
 * which squares the table sees live off the GM's own copy of the fog
 * (`partyLiveSquares`), the same answer every phone and the TV draw.
 */
import { useMemo } from 'react';
import type { Scene, Token } from '@safehouse/contracts';
import { coneCells, fogCells, sightModelFor, visibleFrom, DEFAULT_SIGHT_RANGE } from '@safehouse/rules';
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

/**
 * The lens id of the GM's "See as party" (sightlines, P6): the map as the
 * phones and the TV show it. Not a token id (those are uuids) and not a
 * camera's (`CAMERA_LENS`), so the three kinds of lens never meet.
 */
export const PARTY_LENS = 'party';

/** Whether the GM is looking through the party's lens. A player asking for it gets nothing. */
export function partyLensOn(inputs: Pick<ShroudInputs, 'isGm' | 'losTokenId'>): boolean {
  return inputs.isGm && inputs.losTokenId === PARTY_LENS;
}

/**
 * Every square the TABLE sees LIVE on floor `level`, as `"col,row"` keys:
 * what the "See as party" lens leaves clear (`ShroudState.party`). Read off
 * the fog with the rule the server withholds tokens by and every device
 * draws its cover by (`fogCells`): the party's pooled sight on that floor,
 * and the ground the GM revealed live, on a fogged scene; every square, on
 * an open one. Ground shown to the table only as remembered is not live, so
 * the lens darkens it with the hidden ground: nobody standing there is on a
 * phone.
 */
export function partyLiveSquares(scene: Pick<Scene, 'fog' | 'vision' | 'grid'>, level: number): Set<string> {
  const cells = fogCells(scene.fog, { vision: scene.vision });
  const out = new Set<string>();
  for (let row = 0; row < scene.grid.rows; row += 1) {
    for (let col = 0; col < scene.grid.cols; col += 1) {
      if (cells.state(level, col, row) === 'live') out.add(`${col},${row}`);
    }
  }
  return out;
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
  /**
   * The floor in view. The party lens reads the party's sight on it, since
   * sight is kept per floor; every other lens follows its own token or
   * camera to the floor it stands on. Absent is the ground.
   */
  level?: number;
}

/**
 * Which token's eyes to use, or null for none.
 *
 * A GM's explicit pick always wins, including over their own party's tokens:
 * "what does the guard see" is the question that makes this tool worth having.
 */
export function viewpointTokenId(inputs: ShroudInputs): string | null {
  if (inputs.isGm) return viewpointCameraId(inputs) === null && !partyLensOn(inputs) ? inputs.losTokenId : null;
  if (!inputs.enabledForPlayers || inputs.myCharacterId === null) return null;
  const mine = inputs.tokens.find(
    (t) => t.source === 'character' && t.sourceId === inputs.myCharacterId,
  );
  return mine?.id ?? null;
}

/**
 * Everything about a scene that can move a sightline, as one string: the
 * memo key `useShroud` rebuilds on. Exported so the key itself is testable,
 * because a key that leaves something out fails silently: the shroud simply
 * goes stale until the viewer next moves.
 *
 * That is what happened with painted doors. The key used to name only the
 * ground floor's `structure`, `object` and `arcs` layers, so opening a
 * painted door (its state lives in `tiles.doors`, not in the structure
 * layer) left a player's shroud, and the GM's lens, showing it shut until
 * somebody took a step. The same went for the `ground` layer, the legacy
 * `cells` a scene painted before layers is still read through, and the
 * `tilesetId` every tile id is resolved against. So the key now takes the
 * WHOLE tile record, as `useLightMap` does for the same reason.
 */
export function sightInputsKey(scene: Scene | null | undefined): string {
  if (!scene) return '';
  return JSON.stringify([
    // The ground floor: every layer, its doors, its walls at any angle and
    // the tileset they are all read from.
    scene.tiles ?? null,
    // Upper floors carry their own tiles, doors and walls at any angle.
    scene.levels ?? [],
    // Traced walls, and traced doors open or shut.
    scene.geometry.walls ?? [],
    scene.geometry.doors ?? [],
    scene.grid.cols,
    scene.grid.rows,
    // Metres a square: furniture covers as many squares as it is big.
    scene.grid.unitM,
  ]);
}

/**
 * The shroud for this viewer, or null to draw none.
 *
 * Memoised on the things that can actually move a sightline — the tiles and
 * their doors, the drawn geometry (`sightInputsKey`), and the viewpoint's own
 * position. Token positions of OTHER tokens are deliberately not in the key: a
 * body does not block sight in this model, and rebuilding the set every time
 * anybody shuffles a step would cost a full recompute per drag frame.
 */
export function useShroud(inputs: ShroudInputs): ShroudState | null {
  const { scene, tokens, isGm } = inputs;
  const party = partyLensOn(inputs);
  const level = inputs.level ?? 0;
  // The party's lens: the table's live squares, darkened round with the GM's
  // light scrim, and the tokens cut to the table's (`ShroudState.party`).
  // Worked out again whenever the fog is (a runner's step brings a new copy
  // of it) or the floor changes: a walk over the floor's squares, reading
  // bits, with no sightline cast.
  const partyShroud = useMemo<ShroudState | null>(
    () => (party && scene ? { visible: partyLiveSquares(scene, level), gm: true, party: true } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [party, scene?.fog, scene?.vision?.sight, scene?.grid.cols, scene?.grid.rows, level],
  );
  const tokenId = viewpointTokenId(inputs);
  const viewer = tokenId === null ? undefined : tokens.find((t) => t.id === tokenId);
  const cameraId = viewpointCameraId(inputs);
  const camera = cameraId === null ? undefined : scene?.geometry.cameras?.find((c) => c.id === cameraId);

  const vx = viewer?.x;
  const vy = viewer?.y;

  const lens = useMemo(() => {
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
    // Everything that changes a sightline, stringified because these are
    // fresh objects on every fetch and identity would defeat the memo.
    sightInputsKey(scene),
    vx,
    vy,
    viewer?.level ?? 0,
    isGm,
    // The camera lens: which camera, and where it points.
    JSON.stringify(camera ?? null),
  ]);
  return partyShroud ?? lens;
}
