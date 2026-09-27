/**
 * Scenes service (M9, FR9.1–9.15): scene CRUD + activation, tokens, fog
 * state, drawings/AoE templates with grenade scatter, map attachments on
 * disk under DATA_DIR/files, and the scene→rolls bridge
 * `activeSceneModifiers` (FR9.11).
 *
 * Pure db/domain logic — src/plugins/scenes.ts owns routes, permissions and
 * hub events. Player-side filtering (hidden tokens, unrevealed fog) happens
 * here at the query/serialization layer, never client-side (Principle 4).
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { migrateTileLayer } from '@safehouse/rules';
import {
  GridProjectionSchema,
  GridSchema,
  SceneEnvironmentSchema,
  SceneGeometrySchema,
  SceneLightSchema,
  SceneVisionSchema,
  type SceneVision,
  SceneLayerSchema,
  type SceneLayer,
  GenTemplateSchema,
  type CombatantMonitors,
  FOG_SIGHT_MAX_SIDE,
  FogStateSchema,
  sceneFogOn,
  type FogBrushStroke,
  type FogOp,
  type FogRevealAs,
  SheetV1Schema,
  TokenAuraSchema,
  TokenLightSchema,
  TokenLookSchema,
  type TokenLight,
  type TokenLook,
  type FogRegion,
  type FogState,
  type Grid,
  type Modifier,
  type Pin,
  type Point,
  type Scene,
  type SceneEnvironment,
  type SceneGeometry,
  type Token,
  type TokenAura,
  type Visibility,
  TileLayerSchema,
  type TileLayer,
  SceneLevelSchema,
  type SceneLevel,
} from '@safehouse/contracts';
import { deriveCharacter, environment, eraseBrushUnder, fogCells, generateNpc, paintBrush, tokenLive } from '@safehouse/rules';
import {
  attachments,
  characters,
  combatants,
  drawings,
  encounters,
  latestEventOfType,
  npcTemplates,
  scenes,
  tokens,
  type Db,
} from '@safehouse/db';
import { rollDie } from './dice.js';
import { httpError } from './auth.js';
// Pure row-model helper (no db, no hub): the one place an initiative line is
// derived from a sheet, shared with the encounters domain (FR4.2).
import { deriveFor } from './encounters-model.js';
import { catalogOf, monitorsFor, type NpcTemplateRow } from './generator.js';

export type SceneRow = typeof scenes.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;
export type DrawingRow = typeof drawings.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;

// ---------------------------------------------------------------------------
// Normalization + serialization
// ---------------------------------------------------------------------------

/** FR9.1 (Q11 resolved 0.6): default 1 m per square. */
const DEFAULT_GRID = { unitM: 1, cols: 30, rows: 30, offset: { x: 0, y: 0 }, projection: 'topdown' as const };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A stored grid, made safe to render.
 *
 * The fallback is all-or-nothing by design — a grid we cannot parse is not a
 * grid — but that is dangerous the moment the schema grows an ENUM, because
 * one unrecognised string then discards the whole object. Concretely: a scene
 * saved by a build that knows a third projection, reopened by this one, would
 * come back 30×30 at 1 m and the GM's calibration would be gone with no error
 * anywhere. Losing a view preference is a shrug; losing the map's dimensions
 * is an evening.
 *
 * So the one enum is normalised on its own first, and an unrecognised value is
 * dropped rather than allowed to fail the parse. Everything else keeps the
 * strict behaviour: a grid with a string where `cols` should be really is
 * unusable, and the default really is the right answer for it.
 */
export function normalizeGrid(raw: unknown): Grid {
  const merged: Record<string, unknown> = { ...DEFAULT_GRID, ...(isRecord(raw) ? raw : {}) };
  if (!GridProjectionSchema.safeParse(merged['projection']).success) {
    delete merged['projection'];
  }
  const parsed = GridSchema.safeParse(merged);
  return parsed.success ? parsed.data : GridSchema.parse(DEFAULT_GRID);
}

export function normalizeEnvironment(raw: unknown): SceneEnvironment {
  const parsed = SceneEnvironmentSchema.safeParse(isRecord(raw) ? raw : {});
  return parsed.success ? parsed.data : SceneEnvironmentSchema.parse({});
}

/**
 * A stored geometry, made safe to render — all-or-nothing, like the grid, with
 * one exception for the same reason the grid has one. The GM's lights are
 * checked one by one first and a light that does not fit is dropped: a lamp
 * saved by a build with wider bounds must cost that lamp, not every wall on
 * the map (an empty geometry is what the next write would then save).
 */
export function normalizeGeometry(raw: unknown): SceneGeometry {
  const merged: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  const lights = merged['lights'];
  if (Array.isArray(lights)) merged['lights'] = lights.filter((l) => SceneLightSchema.safeParse(l).success);
  else delete merged['lights'];
  const parsed = SceneGeometrySchema.safeParse(merged);
  return parsed.success ? parsed.data : SceneGeometrySchema.parse({});
}

/**
 * The parts of a stored fog added for sightlines (P6), and the GM's reveal
 * brush, each checked on its own before the whole is parsed (`normalizeFog`).
 */
const FOG_SIGHT_PARTS = ['exploredRegionIds', 'exploredShapes', 'sight', 'brush'] as const;

/**
 * A stored fog, made safe to read — all-or-nothing, like the grid, with one
 * exception for the same reason the geometry has one. The parts sightlines
 * added (the GM's explored reveals, the party's sight and memory, the GM's
 * brush) are checked one by one first, and a part that does not fit is
 * dropped: a sight record written by some other build must cost the party's
 * memory of the map, never the GM's regions and reveals (an empty fog is
 * what the next write would then save). Those parts are in the schema, so the parse below
 * keeps every one that fits; a zod parse strips any key it does not know,
 * and before they were in it, a sight record would have vanished at the
 * first read.
 */
export function normalizeFog(raw: unknown): FogState {
  const merged: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  for (const key of FOG_SIGHT_PARTS) {
    if (merged[key] !== undefined && !FogStateSchema.shape[key].safeParse(merged[key]).success) delete merged[key];
  }
  const parsed = FogStateSchema.safeParse(merged);
  const fog = parsed.success ? parsed.data : FogStateSchema.parse({});
  // `active` is said on a player's copy (`sceneForViewer`), worked out from
  // the rest by `sceneFogOn`; it is never stored, so a stale one can never
  // outlive the state it was worked out from. `enabled` is the opposite case
  // and is KEPT: it is the GM's switch, a decision nothing else can
  // re-derive, and the schema parse above carries it through untouched.
  delete fog.active;
  return fog;
}

/**
 * The `scenes.geometry` jsonb column also carries `mapAttachmentIds` and
 * `notes`: §9.2 gives them no columns of their own, and the Zod geometry
 * schema strips them back out on read. Should the table ever grow the
 * columns, this is a straight lift — nothing else reads the envelope.
 */
function geometryColumn(
  geometry: SceneGeometry,
  mapAttachmentIds: string[],
  notes?: string,
  tiles?: TileLayer,
  levels?: SceneLevel[],
  vision?: SceneVision,
  tokenLayers?: SceneLayer[],
) {
  // `tiles` rides in the existing geometry JSONB rather than earning a column:
  // it is scene-shaped authoring data like walls and pins, and this keeps the
  // painted floor inside the same atomic write as the geometry drawn over it.
  return {
    ...geometry,
    mapAttachmentIds,
    ...(notes !== undefined ? { notes } : {}),
    ...(tiles !== undefined ? { tiles } : {}),
    ...(levels !== undefined ? { levels } : {}),
    // Sight settings ride in the same envelope, for the same reason tiles do.
    ...(vision !== undefined ? { vision } : {}),
    ...(tokenLayers !== undefined ? { tokenLayers } : {}),
  };
}

/** Full (GM-grade) API shape for a scene row. */
export function serializeScene(row: SceneRow): Scene {
  const geoRaw = isRecord(row.geometry) ? row.geometry : {};
  const rawIds = geoRaw['mapAttachmentIds'];
  const mapAttachmentIds = Array.isArray(rawIds)
    ? rawIds.filter((s): s is string => typeof s === 'string')
    : [];
  const notes = typeof geoRaw['notes'] === 'string' ? geoRaw['notes'] : undefined;
  const tilesParsed = TileLayerSchema.safeParse(geoRaw['tiles']);
  // Migrate on the way OUT, so the wire format is always layered and no client
  // has to know that scenes were ever flat. A pre-layers scene therefore looks
  // identical to a migrated one from the moment it is read — which is what
  // lets line of sight, the renderer and the palette each assume layers
  // without any of them carrying a compatibility branch.
  const tiles = tilesParsed.success
    ? { ...migrateTileLayer(tilesParsed.data), cells: {} }
    : undefined;
  // Floors above the ground one. Each level's tiles go through the SAME
  // migration as `tiles`, so a storey painted before layers existed reads
  // identically to one painted after: neither sight nor the renderer should
  // care which floor it is looking at, or when that floor was drawn.
  const levels = (Array.isArray(geoRaw['levels']) ? geoRaw['levels'] : []).flatMap(
    (raw): SceneLevel[] => {
      const parsed = SceneLevelSchema.safeParse(raw);
      if (!parsed.success) return [];
      const lvl = parsed.data;
      return [
        lvl.tiles === undefined
          ? lvl
          : { ...lvl, tiles: { ...migrateTileLayer(lvl.tiles), cells: {} } },
      ];
    },
  );
  const visionParsed = SceneVisionSchema.safeParse(geoRaw['vision']);
  const vision = visionParsed.success ? visionParsed.data : SceneVisionSchema.parse({});
  // Token layers (FR9.26) ride in the same envelope as the floors.
  const layersParsed = SceneLayerSchema.array().safeParse(geoRaw['tokenLayers']);
  const tokenLayers = layersParsed.success ? layersParsed.data : undefined;
  return {
    id: row.id,
    campaignId: row.campaignId,
    name: row.name,
    state: row.state,
    levels,
    vision,
    ...(tokenLayers !== undefined ? { tokenLayers } : {}),
    grid: normalizeGrid(row.grid),
    environment: normalizeEnvironment(row.environment),
    geometry: normalizeGeometry(geoRaw),
    fog: normalizeFog(row.fog),
    mapAttachmentIds,
    ...(tiles !== undefined ? { tiles } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(row.audioRef ? { audioRef: row.audioRef } : {}),
  };
}

/**
 * Strip GM-layer data for player/observer/display viewers (Principle 4):
 * GM notes (the scene's text and the boxes on the map, FR9.25), the GM's
 * annotations (zones, non-public pins, cameras, the note on a wall, which
 * doors are locked, the token layers), and every unrevealed fog region —
 * players get only revealed fog geometry (FR9.13), revealed live or as
 * explored (P6), each with its fashion said.
 *
 * Walls and doors themselves are NOT stripped (FR9.16). They are the map's
 * sight geometry, and every player device computes its own shroud from the
 * scene it is sent: a wall withheld here is a wall a runner's sightline goes
 * straight through, which was exactly the bug. They are treated like tiles —
 * the floor plan — and the reasoning below covers them too.
 *
 * `tiles` and `mapAttachmentIds` deliberately pass through UNFILTERED, and the
 * distinction is worth stating because it looks like an oversight and is not.
 * A painted tile layer is the MAP, not the GM's annotation of it — the same
 * role an uploaded map image plays, which has always shipped whole and been
 * occluded by fog in the client. Filtering one and not the other would be
 * incoherent, and filtering both means occluding a raster image server-side,
 * per viewer, which is a different feature.
 *
 * The cost is real and accepted: a player who opens devtools can read the
 * layout of a room the GM has not revealed, including cells whose tile ids are
 * `wall` and `door`. Fog is a *presentation* boundary for the map and a
 * *secrecy* boundary for everything else. If that ever needs to change, it
 * changes for map images at the same time, or not at all.
 */
/** A floor's tiles with each painted door's lock unsaid (FR9.24). */
function tilesForPlayers(tiles: NonNullable<Scene['tiles']>): NonNullable<Scene['tiles']> {
  if (!tiles.doors) return tiles;
  const doors: NonNullable<Scene['tiles']>['doors'] = {};
  for (const [cell, d] of Object.entries(tiles.doors)) doors[cell] = { open: d.open } as (typeof doors)[string];
  return { ...tiles, doors };
}

export function sceneForViewer(scene: Scene, gm: boolean): Scene {
  if (gm) return scene;
  const revealed = new Set(scene.fog.revealed);
  // Regions the GM revealed AS EXPLORED (P6) are the table's too: it is
  // shown that ground dimmed, as remembered, so it needs the outline. They
  // reach the table with their fashion said, in `exploredRegionIds`, so a
  // device draws them remembered and never open; a region in neither list is
  // not the table's to know about and is not sent at all.
  const explored = new Set(scene.fog.exploredRegionIds ?? []);
  const exploredRegionIds = scene.fog.regions.filter((r) => explored.has(r.id)).map((r) => r.id);
  const filtered: Scene = {
    ...scene,
    // Cameras are omitted entirely (FR9.23): a camera a player can see on the
    // map is a camera their character has already found. The list is not
    // even an empty array on the wire — nothing says there is a list.
    geometry: {
      // Walls and doors are the map's SIGHT geometry, and a player device
      // computes its own shroud from them (FR9.16): a wall stripped here is a
      // wall a runner sees straight through. What stays GM-only is the
      // annotation — the note on a wall, the zones, the private pins.
      walls: scene.geometry.walls.map(({ id, a, b }) => ({ id, a, b })),
      // Whether a door is LOCKED is not on a player's wire (FR9.24): a runner
      // learns that by trying the handle. The key is absent, and the contract
      // reads an absent lock as "not known to be locked" — the client parse
      // defaults it, which is why the cast is honest.
      doors: scene.geometry.doors.map(({ id, a, b, open }) => ({ id, a, b, open }) as Scene['geometry']['doors'][number]),
      zones: [],
      // The GM's public pins, less any standing on ground the table is shown
      // as fog (`pinsForTable`, P6): a pin is a label the GM put there for the
      // table to read, and one in a room they have not found names the room.
      pins: pinsForTable(scene),
      // Lights, unlike cameras and pins, are sent whole, fog or no fog (P6,
      // decided 2026-09-27). A lamp inside a hidden room still lights the
      // revealed floor its light reaches (through an open door, across a
      // doorway), and a device can only draw that glow from the lamp itself:
      // withheld, the lit corridor outside the room would go dark on every
      // phone and the TV while the GM's map showed it lit. The lamp's fixture
      // and halo are hidden with the room it hangs in (the client's cover), so
      // what a lamp gives away is where it stands, which is where the map and
      // its tiles (below) already are: the presentation boundary, not the
      // secrecy one. Lights carried by TOKENS are the tokens', and go (and are
      // withheld) with them.
      ...(scene.geometry.lights ? { lights: scene.geometry.lights } : {}),
    },
    ...(scene.tiles ? { tiles: tilesForPlayers(scene.tiles) } : {}),
    levels: scene.levels.map((l) => (l.tiles ? { ...l, tiles: tilesForPlayers(l.tiles) } : l)),
    fog: {
      regions: scene.fog.regions.filter((r) => revealed.has(r.id) || explored.has(r.id)),
      revealed: scene.fog.revealed,
      revealedShapes: scene.fog.revealedShapes,
      // The GM's explored-fashion reveals (P6), and the party's sight and
      // memory. Each is said only when there is something to say, so a scene
      // with none of them (every scene before sightlines) reaches the table
      // exactly as it always did. The sight is sent whole: it is the party's
      // own pooled eyes, the same copy for every phone and the TV (the GM,
      // 2026-09-27), and nothing in it is the GM's.
      ...(exploredRegionIds.length > 0 ? { exploredRegionIds } : {}),
      ...(scene.fog.exploredShapes && scene.fog.exploredShapes.length > 0
        ? { exploredShapes: scene.fog.exploredShapes }
        : {}),
      ...(scene.fog.sight ? { sight: scene.fog.sight } : {}),
      // The GM's brush (`FogBrushSchema`), sent whole, like the sight: every
      // mark in it is the table's already. A square painted live or as seen
      // before is ground they are shown, and one fogged again is ground they
      // are shown as fog; the device needs that mark to cover a square inside
      // a region they have open, and it says nothing a covered square does
      // not. Absent on a scene the brush has never touched.
      ...(scene.fog.brush ? { brush: scene.fog.brush } : {}),
      // Whether the scene is fogged at all. The regions above are only the
      // revealed ones (live or as explored), so a scene fogged with nothing
      // revealed yet — or just reset — would otherwise read as one with no
      // fog, and every player device and the TV would draw the whole map
      // open (FR9.13). A count of one bit: nothing of an unrevealed region's
      // shape, name or number.
      //
      // `sceneFogOn` is the same rule the map and the TV apply, worked out
      // here from the whole stored scene: the GM's switch (`enabled`), or,
      // for a scene whose switch was never flipped, whether there is anything
      // to reveal (`fogOn`); or the scene's sightlines, which hide everything
      // the party does not see whatever the switch says. The switch itself
      // stays off the wire. This bit is the answer, and `fogOn` and
      // `sceneFogOn` both read this bit first on the copy it arrives in.
      active: sceneFogOn(scene),
    },
  };
  delete (filtered as { notes?: string }).notes;
  // Which tokens the GM is holding back, and what they are called, is the
  // GM's business (FR9.26); the tokens themselves are already filtered.
  delete (filtered as { tokenLayers?: unknown }).tokenLayers;
  return filtered;
}

/**
 * Every token id on a HIDDEN layer (FR9.26). A token on a hidden layer is
 * hidden exactly as a token flagged `hidden` is: absent from player payloads,
 * its events on GM sockets only. Computed from the scene rather than stored
 * on the token, so a layer is one switch and not a write per token.
 */
export function hiddenByLayer(scene: Pick<Scene, 'tokenLayers'>): Set<string> {
  const out = new Set<string>();
  for (const layer of scene.tokenLayers ?? []) {
    if (!layer.hidden) continue;
    for (const id of layer.tokenIds) out.add(id);
  }
  return out;
}

/** Hidden to players: flagged hidden, or on a hidden layer. */
export function tokenHidden(token: { id: string; hidden: boolean }, scene: Pick<Scene, 'tokenLayers'>): boolean {
  return token.hidden || hiddenByLayer(scene).has(token.id);
}

/**
 * What `tokenConcealed` needs to know about a token: a row and a DTO both
 * fit. `level` and `size` say which squares it stands on (absent: the
 * ground, one square), because only a LIVE square shows the table who
 * stands there and the fog's states are per square and per floor.
 */
export interface ConcealableToken {
  id: string;
  hidden: boolean;
  source: string;
  x: number;
  y: number;
  level?: number | undefined;
  size?: number | undefined;
}

/**
 * Out of the table's sight, as far as the fog is concerned: the scene is
 * fogged (`sceneFogOn`: its fog switch, or its sightlines when `vision` is
 * given and says they are on), and no square the token stands on is LIVE
 * (`tokenLive` in @safehouse/rules).
 *
 * A square is live where the GM revealed the ground live (a region in
 * `revealed`, a shape in `revealedShapes`) or, with sightlines on, where the
 * party's pooled sight says a runner sees it right now. Ground the GM
 * revealed AS EXPLORED is not live: the table is shown the map there dimmed,
 * as remembered, and nobody standing on it (the GM, 2026-09-27). So a guard
 * in a remembered room is withheld exactly as one in the dark is: absent
 * from the table's payloads, his moves and drags on GM sockets only, and he
 * arrives as `token.added` only when his room goes live.
 *
 * The squares are the ones the token covers: `size` across, centred on its
 * `x`/`y`, which the map keeps at the middle of the square (or squares) it
 * stands on, on its own floor. For a one-square token, which is almost
 * every token, that is the one square its centre is in, and a GM's reveal
 * is tested at that square's centre: the answer a point test at the token's
 * centre always gave. A bigger one (a van, a dragon) is on the table when
 * any part of it is, as it would be at a real table.
 *
 * Party tokens (`source: 'character'`) are NEVER fogged. A runner is always
 * on their own player's screen and on the TV, wherever they walk: the fog
 * hides what the runners have not found, never the runners themselves.
 */
export function tokenFogged(token: ConcealableToken, fog: FogState, vision?: Partial<Scene['vision']>): boolean {
  if (token.source === 'character') return false;
  // `tokenLive` asks `sceneFogOn` first, the same answer a player's copy
  // carries as `active` (`sceneForViewer`): on an open scene every square is
  // live and nobody is fogged, and a scene the table is told is fogged never
  // still sends it the guards. Without sightlines on, which is every scene
  // saved before them, that is the fog switch alone (`fogOn`), as it was.
  return !tokenLive(fog, { x: token.x, y: token.y, level: token.level, size: token.size }, { vision });
}

/**
 * Withheld from players, the TV and observers (Principle 4): hidden by its
 * own flag or its layer (`tokenHidden`), or out of the table's sight under
 * the fog (`tokenFogged`): anywhere that is not LIVE, which takes in ground
 * revealed only as explored.
 *
 * This is the ONE question every path that puts a token on a non-GM wire
 * asks: the composed scene, the visibility of each token event and drag
 * frame, and the diffs that turn a change in the answer into the token
 * arriving (`token.added`) or leaving (`token.removed`). So what counts as
 * concealed is decided here, once, and every path follows: when it grew
 * from "not in a revealed area" to "not in a LIVE area" (P6), a region
 * revealed as explored, or dropped from live to explored, withheld its
 * guards through every one of those paths with no change to any of them.
 *
 * Before this, fog was only ever a cover the client drew. Every guard behind
 * it was on every player's wire, positions, moves and drags included, and
 * one look at the network tab was a look behind the fog.
 *
 * The scene's `vision` is required, not optional, because leaving it out is
 * a leak that compiles: sightlines fog a scene whose fog switch is off, and
 * only `vision` says they are on. A caller that handed in the fog and the
 * layers alone would be told every guard on such a scene is in the open.
 */
export function tokenConcealed(
  token: ConcealableToken,
  scene: Pick<Scene, 'tokenLayers' | 'fog' | 'vision'>,
): boolean {
  return concealer(scene)(token);
}

/**
 * `tokenConcealed` for every token of one scene: the scene is read ONCE (its
 * hidden layers gathered, its fog read with `fogCells`, the party's bitsets
 * decoded once per floor) and the answer handed back as a question to ask of
 * each token. Every path that walks a scene's tokens (the composed payload,
 * the concealment diffs, staging a fight) asks through this, so a sightlines
 * scene with its per-floor bitsets costs one decode per floor per walk, not
 * one per token; and the answer is the same one `tokenConcealed` gives,
 * because that is built on this.
 */
export function concealer(
  scene: Pick<Scene, 'tokenLayers' | 'fog' | 'vision'>,
): (token: ConcealableToken) => boolean {
  const layered = hiddenByLayer(scene);
  const cells = fogCells(scene.fog, { vision: scene.vision });
  return (token) =>
    token.hidden ||
    layered.has(token.id) ||
    // `tokenFogged`, with the fog read once: a runner is never fogged, and
    // anyone else is when no square they stand on is LIVE.
    (token.source !== 'character' &&
      !cells.tokenLive({ x: token.x, y: token.y, level: token.level, size: token.size }));
}

/**
 * Whether a scene is the table's at all: the one scene the campaign has
 * active (FR9.1). A STAGED scene (a draft the GM is building, or an archived
 * one) has no table. No player, observer or TV can read it (a 404, not a
 * 403, so there is not even an existence oracle), and when it goes live
 * every device reads it whole on `scene.activated`.
 *
 * So nothing that happens on a staged scene is the table's to hear either,
 * and every event about what is ON it goes to the GM alone: a guard placed,
 * moved, dragged, renamed or deleted; a fog region revealed (its name and
 * outline); the party's sight and the brush; a drawing or a template; a
 * token arriving or leaving through a fog op. Before this (P6 secrecy
 * sweep, 2026-09-27) every one of those went out public, persisted for
 * replay, with names and positions, while the GM prepared the ambush in
 * private; and because scenes now start with their fog off, a guard placed
 * before the GM thought of fog was on every phone's socket at once.
 *
 * Nothing is lost by it. The events are not needed to catch up: the read on
 * `scene.activated` is the whole scene, as it then stands.
 */
export function sceneOnTable(scene: { state: string }): boolean {
  return scene.state === 'active';
}

/**
 * Who hears an event about scene `scene` itself (its fog, its sight, its
 * drawings): the table when the scene is the table's (`sceneOnTable`), the
 * GM alone while it is staged.
 */
export function sceneEventVisibility(scene: { state: string }): Visibility {
  return sceneOnTable(scene) ? 'public' : 'gm';
}

/**
 * Who hears an event that shows `token` where it stands (Principle 4): the
 * table only when its scene is the table's (`sceneOnTable`) and the token is
 * not concealed on it (`tokenConcealed`); otherwise the GM alone. Every token
 * event that is not a concealment flip asks this.
 */
export function tokenEventVisibility(
  token: ConcealableToken,
  scene: Pick<Scene, 'state' | 'tokenLayers' | 'fog' | 'vision'>,
): Visibility {
  return sceneOnTable(scene) && !tokenConcealed(token, scene) ? 'public' : 'gm';
}

/**
 * The GM's pins a player, an observer and the TV are sent (FR9.3; P6): the
 * public ones, less any that stand on ground the table is shown as fog.
 *
 * A pin marks a point for the table to read (the loading bay, the stash),
 * and its label names what is there; one standing in a room the table has
 * not found is a spoiler with coordinates. So on a fogged scene a public pin
 * is sent only where the table is shown the ground: LIVE, or EXPLORED
 * (remembered ground is the map as it now is, pins and doors included, with
 * nobody on it). Hidden ground withholds it, as it withholds a guard.
 *
 * A pin has no floor: the map stands it on whichever floor is in view. So it
 * is sent when its square is shown on ANY floor of the scene (the ground and
 * every floor above), and withheld only when every floor has it under fog.
 * The GM's reveals are the same on every floor; the party's sight and the
 * brush are per floor, and a pin in a room the runners have seen upstairs is
 * the table's upstairs, where the map will draw it.
 *
 * The fog moves under a pin without the pin moving, so the set sent can
 * change with a fog op or a runner's step. The sight pass (services/sight.ts)
 * compares the set before and after and, when it changed, tells the table to
 * read the scene again (`scene.updated`, changed `['pins']`).
 */
export function pinsForTable(scene: Pick<Scene, 'geometry' | 'fog' | 'vision' | 'levels'>): Pin[] {
  const open = scene.geometry.pins.filter((p) => p.visibility === 'public');
  if (open.length === 0) return open;
  const cells = fogCells(scene.fog, { vision: scene.vision });
  if (!cells.on) return open;
  const floors = scene.levels.length + 1;
  return open.filter((pin) => {
    const col = Math.floor(pin.at.x);
    const row = Math.floor(pin.at.y);
    for (let level = 0; level < floors; level += 1) {
      if (cells.state(level, col, row) !== 'hidden') return true;
    }
    return false;
  });
}

/**
 * A serialized token as the API emits it. `TokenSchema` leaves `sourceId` /
 * `artRef` / `aura` / `light` optional; the server always writes them (null
 * when empty) so consumers get a total shape without narrowing `undefined`
 * away.
 */
export type TokenDto = Token & {
  sourceId: string | null;
  artRef: string | null;
  aura: TokenAura | null;
  light: TokenLight | null;
};

export function serializeToken(row: TokenRow): TokenDto {
  const bars = row.barsVisibility;
  const auraParsed = TokenAuraSchema.nullable().safeParse(row.aura ?? null);
  const lightParsed = TokenLightSchema.nullable().safeParse(row.light ?? null);
  return {
    id: row.id,
    sceneId: row.sceneId,
    source: row.source,
    sourceId: row.sourceId,
    name: row.name,
    x: row.x,
    y: row.y,
    level: row.level ?? 0,
    size: row.size,
    rotation: row.rotation,
    artRef: row.artRef,
    hidden: row.hidden,
    barsVisibility: bars === 'gm' || bars === 'owner' || bars === 'public' ? bars : 'owner',
    aura: auraParsed.success ? auraParsed.data : null,
    pose: row.pose === 'crouch' || row.pose === 'prone' ? row.pose : 'stand',
    look: lookOf(row.look),
    light: lightParsed.success ? lightParsed.data : null,
  };
}

/** A stored look, or null when there is none or it no longer fits the schema. */
export function lookOf(raw: unknown): TokenLook | null {
  if (raw === null || raw === undefined) return null;
  const parsed = TokenLookSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface DrawingDto {
  id: string;
  sceneId: string;
  kind: 'sketch' | 'template';
  geometry: Record<string, unknown>;
  createdBy: string | null;
  expiresAt: string | null;
}

export function serializeDrawing(row: DrawingRow): DrawingDto {
  return {
    id: row.id,
    sceneId: row.sceneId,
    kind: row.kind,
    geometry: isRecord(row.geometry) ? row.geometry : {},
    createdBy: row.createdBy,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Grenade scatter (FR9.12) — original generic formula, params editable
// ---------------------------------------------------------------------------

export interface ScatterParams {
  /** Intended impact point, grid units. */
  x: number;
  y: number;
  /** Net hits on the throw/launch reduce scatter distance (min 0). */
  netHits?: number;
  /** Number of distance d6 (editable per launcher type; default 2). */
  scatterDice?: number;
  /** Meters per grid unit for the target scene (default 1). */
  gridUnitM?: number;
  /** Override the direction die (1–6) — editable/replayable. */
  directionDie?: number;
  /** Override the rolled distance dice — editable/replayable. */
  distanceDice?: number[];
}

export interface ScatterResult {
  directionDie: number;
  /** 0° = grid north (−y), clockwise in 60° sectors per direction pip. */
  angleDeg: number;
  distanceDice: number[];
  rawDistanceM: number;
  netHits: number;
  /** max(0, sum(dice) − netHits) meters. */
  distanceM: number;
  from: Point;
  to: Point;
}

/** Direction d6 + Nd6 meters minus net hits → deviated impact point. */
export function computeScatter(p: ScatterParams, die: () => number = rollDie): ScatterResult {
  const directionDie = p.directionDie ?? die();
  const count = Math.max(1, Math.floor(p.scatterDice ?? 2));
  const distanceDice = p.distanceDice ?? Array.from({ length: count }, () => die());
  const rawDistanceM = distanceDice.reduce((a, b) => a + b, 0);
  const netHits = Math.max(0, p.netHits ?? 0);
  const distanceM = Math.max(0, rawDistanceM - netHits);
  const angleDeg = ((directionDie - 1) % 6) * 60;
  const rad = (angleDeg * Math.PI) / 180;
  const units = distanceM / (p.gridUnitM ?? 1);
  const to: Point = {
    x: p.x + Math.sin(rad) * units,
    y: p.y - Math.cos(rad) * units,
  };
  return { directionDie, angleDeg, distanceDice, rawDistanceM, netHits, distanceM, from: { x: p.x, y: p.y }, to };
}

// ---------------------------------------------------------------------------
// Per-key throttle (token.dragging relay, §11 "throttled")
// ---------------------------------------------------------------------------

export class PerKeyThrottle {
  private readonly last = new Map<string, number>();
  constructor(
    private readonly ms: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when `key` may fire now (leading edge; false inside the window). */
  allow(key: string): boolean {
    const t = this.now();
    const prev = this.last.get(key);
    if (prev !== undefined && t - prev < this.ms) return false;
    this.last.set(key, t);
    return true;
  }

  clear(key: string): void {
    this.last.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Attachments on disk (FR9.2 upload; §13 uploads)
// ---------------------------------------------------------------------------

/** Allow-listed upload mime types → stored extension (§13). */
export const ALLOWED_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
};

/**
 * The first bytes of each format we accept, so a declared mime has to be true.
 *
 * The client names the mime and the client can lie, which mattered little when
 * only the GM could upload and matters more now that a player can. This is not
 * a sanitiser — it does not make a malformed PNG safe — it only stops a file
 * being stored and later SERVED under a content type its bytes do not support,
 * which is the trick that turns a file store into an XSS surface.
 *
 * WebP is RIFF: bytes 0-3 `RIFF`, then a four-byte size, then `WEBP` at 8.
 */
const MIME_SIGNATURES: Record<string, ReadonlyArray<{ at: number; bytes: readonly number[] }>> = {
  'image/png': [{ at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  'image/jpeg': [{ at: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/gif': [{ at: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
  'image/webp': [
    { at: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { at: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
};

/** How many leading bytes any signature needs. */
const SNIFF_BYTES = 12;

/** Do these leading bytes match what `mime` claims to be? */
export function bytesMatchMime(mime: string, head: Buffer): boolean {
  const sigs = MIME_SIGNATURES[mime];
  // A type we have no signature for (pdf, audio) is not checked here — those
  // stay GM-only, and inventing a half-check would read as more safety than
  // it is.
  if (!sigs) return true;
  if (head.length < SNIFF_BYTES) return false;
  return sigs.every((sig) => sig.bytes.every((b, i) => head[sig.at + i] === b));
}

/**
 * A pass-through that fails the stream if the leading bytes contradict `mime`.
 *
 * Streaming rather than buffering because the file may be large and we do not
 * want it in memory; failing the transform aborts `pipeline`, so the partial
 * file is never completed and the route answers 415 instead of storing it.
 */
function sniffMime(mime: string): Transform {
  let head = Buffer.alloc(0);
  let decided = false;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (!decided) {
        head = Buffer.concat([head, chunk]);
        if (head.length >= SNIFF_BYTES) {
          decided = true;
          if (!bytesMatchMime(mime, head)) {
            done(
              httpError(
                415,
                'unsupported_media_type',
                `the file's contents are not ${mime}`,
              ),
            );
            return;
          }
        }
      }
      done(null, chunk);
    },
    flush(done) {
      // A file shorter than any signature never got checked above. Anything
      // that small is not an image we can use, so it is rejected rather than
      // waved through on a technicality.
      if (!decided && !bytesMatchMime(mime, head)) {
        done(httpError(415, 'unsupported_media_type', `the file's contents are not ${mime}`));
        return;
      }
      done();
    },
  });
}

export function filesDir(): string {
  return join(process.env.DATA_DIR ?? './data', 'files');
}

// ---------------------------------------------------------------------------
// Scene → roll modifiers (FR9.11): consumed by the rolls service
// ---------------------------------------------------------------------------

/**
 * Environmental modifiers of the campaign's ACTIVE scene, for injection into
 * roll pools (FR9.11 — provenance carries the scene note).
 *
 * This is the ONLY authority for the scene's contribution to a pool (LIVE-2):
 * `services/rolls.ts` calls it during its recompute, and a client that also
 * sent the scene as a situational chip has that chip dropped rather than
 * summed, so a dim-light −1 can never land in a receipt twice.
 */
export async function activeSceneModifiers(db: Db, campaignId: string): Promise<Modifier[]> {
  const rows = await db
    .select()
    .from(scenes)
    .where(and(eq(scenes.campaignId, campaignId), eq(scenes.state, 'active')))
    .limit(1);
  const row = rows[0];
  if (!row) return [];
  return environment(normalizeEnvironment(row.environment));
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface SceneWriteInput {
  name?: string;
  grid?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  geometry?: SceneGeometry;
  tiles?: TileLayer;
  /** Floors above the ground one (FR9.22). Replaces the list wholesale. */
  levels?: SceneLevel[];
  /** Sight settings (FR9.16); merged over the current ones. */
  vision?: Partial<SceneVision>;
  /** Token layers (FR9.26). Replaces the list wholesale, like levels. */
  tokenLayers?: SceneLayer[];
  fog?: FogState;
  mapAttachmentIds?: string[];
  notes?: string;
  state?: 'draft' | 'archived';
}

export interface TokenCreateInput {
  source: 'character' | 'combatant' | 'npc_template' | 'prop';
  sourceId?: string | null;
  name?: string;
  x?: number;
  y?: number;
  /** Which floor it stands on (FR9.22); 0 is the ground. */
  level?: number;
  size?: number;
  rotation?: number;
  artRef?: string | null;
  hidden?: boolean;
  barsVisibility?: 'gm' | 'owner' | 'public';
  aura?: { radiusM: number; color?: string; label?: string } | null;
  pose?: 'stand' | 'crouch' | 'prone';
  look?: TokenLook | null;
  /** A light the token carries (docs/VISION.md §4.1); null is none. */
  light?: TokenLight | null;
}

export interface FogOpInput {
  op: FogOp;
  regionId?: string;
  region?: { id?: string; name: string; polygon: Point[] };
  shape?: Point[];
  /** For `reveal`: live (the default) or as explored (`FogRevealAsSchema`). */
  as?: FogRevealAs;
  /** For `forget`: the one floor whose memory goes; absent is every floor. For `brush`: the floor painted; absent is the ground. */
  level?: number;
  /** For `brush`: the squares painted, by what each is painted with (`FogBrushStrokeSchema`). */
  brush?: FogBrushStroke;
}

/**
 * The party's memory of the map (`FogSight` explored) wiped: of floor
 * `level`, or of every floor when none is named. What the runners see right
 * now (`live`) is left for the sight pass that follows every fog op, which
 * remembers it again at once; a floor with nothing left in either is taken
 * off, and a record with no floors left goes, so a scene whose memory is
 * wholly forgotten stores and sends the fog it had before sightlines.
 */
function forgetExplored(sight: FogState['sight'], level: number | undefined): FogState['sight'] {
  if (sight === undefined) return undefined;
  const levels: NonNullable<FogState['sight']>['levels'] = {};
  for (const [key, floor] of Object.entries(sight.levels)) {
    const explored = level === undefined || key === String(level) ? '' : floor.explored;
    if (floor.live !== '' || explored !== '') levels[key] = { live: floor.live, explored };
  }
  return Object.keys(levels).length > 0 ? { ...sight, levels } : undefined;
}

/**
 * The fog's two optional explored-reveal lists written back: a list with
 * something in it is set, an empty one is taken off, so a scene that has
 * never had an explored reveal (or has none left) stores and sends exactly
 * the three lists every scene had before them.
 */
function setExplored(fog: FogState, ids: string[], shapes: Point[][]): void {
  if (ids.length > 0) fog.exploredRegionIds = ids;
  else delete fog.exploredRegionIds;
  if (shapes.length > 0) fog.exploredShapes = shapes;
  else delete fog.exploredShapes;
}

/** What a staged NPC token brings to the tracker when its archetype can be rolled. */
interface RolledBody {
  initBase: number;
  monitors: CombatantMonitors;
  copilot: Record<string, unknown>;
}

/**
 * The body behind an NPC token (FR9.10 / FR10.2).
 *
 * A token placed from an archetype used to stage as a name with 0+1d6 and
 * ten boxes, because the archetype is generation RANGES and nothing rolled
 * them. Now the same engine the encounter builder uses rolls one body per
 * token — the first tier, seeded by the token's id, so staging the same
 * token twice is the same ganger both times — and it lands with its sheet
 * in `copilot`, which is what gives the row a rack. A template that is a
 * full statblock instead derives straight from that. Anything else stages
 * as before.
 */
function rolledBodyFor(row: NpcTemplateRow | undefined, seed: string): RolledBody | null {
  if (!row) return null;
  const gen = GenTemplateSchema.safeParse(row.gen);
  const tier = gen.success ? gen.data.tiers[0] : undefined;
  if (gen.success && tier) {
    const npc = generateNpc(gen.data, tier.id, seed, { catalog: catalogOf(row) });
    const derived = deriveCharacter(npc.sheet);
    return {
      initBase: derived.initiative.physical.base.value,
      monitors: monitorsFor(npc.monitors),
      copilot: {
        sheet: npc.sheet,
        initDice: derived.initiative.physical.dice.value,
        generator: {
          templateId: row.id,
          tierId: tier.id,
          seed: npc.seed,
          professionalRating: npc.professionalRating,
          loadout: npc.loadout,
          flavor: npc.flavor,
        },
      },
    };
  }
  const sheet = SheetV1Schema.safeParse(row.statblock);
  if (sheet.success) {
    const derived = deriveFor(sheet.data, 'physical');
    return {
      initBase: derived.base,
      monitors: derived.monitors,
      copilot: { sheet: sheet.data, initDice: derived.dice },
    };
  }
  return null;
}

interface StatShape {
  attributes?: { bod?: number; wil?: number; rea?: number; int?: number };
}

function monitorsFrom(stats: StatShape | null | undefined) {
  const bod = stats?.attributes?.bod ?? 3;
  const wil = stats?.attributes?.wil ?? 3;
  return {
    physical: { max: 8 + Math.ceil(bod / 2), filled: 0 },
    stun: { max: 8 + Math.ceil(wil / 2), filled: 0 },
    overflow: { max: Math.max(1, bod), filled: 0 },
  };
}

export class ScenesService {
  constructor(private readonly db: Db) {}

  /**
   * The same service bound to a transaction handle — `svc.withDb(tx.db)`
   * inside a `Hub.atomic` block.
   *
   * Every method here reads and writes through one `Db`, so re-binding is all
   * it takes to put a whole scene operation (fog state + its event, a token
   * insert + `token.added`, staging a dozen combatants + `encounter.updated`)
   * inside one transaction. It also satisfies the deadlock rule structurally:
   * a transaction-bound copy has no route back to the outer handle, so no
   * query inside the block can accidentally take it.
   */
  withDb(db: Db): ScenesService {
    return new ScenesService(db);
  }

  // --- scenes --------------------------------------------------------------

  /**
   * One scene row. `lock` takes it `FOR UPDATE`, for a read that is going to
   * write the row back from what it read: the fog above all, which the fog
   * ops and the sight pass both rewrite whole. Two of those in flight on one
   * scene then take turns, and the second reads what the first committed, so
   * neither can write the party's memory (or a reveal) back over the other's.
   * Only inside a transaction (`Hub.atomic`), where the lock is held to the end.
   */
  async sceneRow(sceneId: string, opts: { lock?: boolean } = {}): Promise<SceneRow> {
    const query = this.db.select().from(scenes).where(eq(scenes.id, sceneId)).limit(1);
    const rows = opts.lock ? await query.for('update') : await query;
    const row = rows[0];
    if (!row) throw httpError(404, 'not_found', 'unknown scene');
    return row;
  }

  async listScenes(campaignId: string, opts: { activeOnly: boolean }): Promise<Scene[]> {
    const where = opts.activeOnly
      ? and(eq(scenes.campaignId, campaignId), eq(scenes.state, 'active'))
      : eq(scenes.campaignId, campaignId);
    const rows = await this.db.select().from(scenes).where(where);
    return rows.map(serializeScene);
  }

  async createScene(campaignId: string, input: SceneWriteInput): Promise<Scene> {
    const grid = normalizeGrid(input.grid);
    const env = normalizeEnvironment(input.environment);
    const geometry = normalizeGeometry(input.geometry);
    // A new scene starts with its fog switched OFF, so drawing its first
    // reveal area does not black out the table: fog is the GM's switch to
    // throw (2026-09-27). A scene that arrives with regions of its own (an
    // import, a seed) keeps the rule it was made under — on once a region
    // exists — unless it says otherwise.
    const given = normalizeFog(input.fog);
    const fog: FogState =
      given.enabled === undefined && given.regions.length === 0 && given.revealedShapes.length === 0
        ? { ...given, enabled: false }
        : given;
    const row = (
      await this.db
        .insert(scenes)
        .values({
          campaignId,
          name: input.name ?? 'Untitled scene',
          state: 'draft',
          grid,
          environment: env,
          geometry: geometryColumn(geometry, input.mapAttachmentIds ?? [], input.notes, input.tiles),
          fog,
        })
        .returning()
    )[0]!;
    return serializeScene(row);
  }

  /** Patch a scene; grid/environment merge, geometry/fog replace whole. */
  async updateScene(row: SceneRow, patch: SceneWriteInput): Promise<{ scene: Scene; changed: string[] }> {
    const current = serializeScene(row);
    const changed = Object.keys(patch);
    const grid = patch.grid !== undefined ? normalizeGrid({ ...current.grid, ...patch.grid }) : current.grid;
    const env =
      patch.environment !== undefined
        ? normalizeEnvironment({ ...current.environment, ...patch.environment })
        : current.environment;
    const geometry = patch.geometry !== undefined ? normalizeGeometry(patch.geometry) : current.geometry;
    const mapAttachmentIds = patch.mapAttachmentIds ?? current.mapAttachmentIds;
    const notes = patch.notes !== undefined ? patch.notes : current.notes;
    const tiles = patch.tiles !== undefined ? patch.tiles : current.tiles;
    // Whole-list replacement, like geometry: a level patch carries every floor
    // it wants to keep. Merging by index would make "delete the top storey"
    // impossible to express.
    const levels = patch.levels !== undefined ? patch.levels : current.levels;
    const vision =
      patch.vision !== undefined ? SceneVisionSchema.parse({ ...current.vision, ...patch.vision }) : current.vision;
    const tokenLayers = patch.tokenLayers !== undefined ? patch.tokenLayers : current.tokenLayers;
    const updated = (
      await this.db
        .update(scenes)
        .set({
          name: patch.name ?? row.name,
          state: patch.state ?? row.state,
          grid,
          environment: env,
          geometry: geometryColumn(geometry, mapAttachmentIds, notes, tiles, levels, vision, tokenLayers),
          // The fog is written only when the patch carries it. Everything
          // else here is re-derived from the row the caller hands in, and two
          // callers hand in a row they read BEFORE their transaction opened:
          // the scene PATCH, and a player trying a door. Writing the fog back
          // from that row let either one silently undo a fog op that
          // committed in between — a `hide` rolled back with no `fog.updated`
          // to say so, and the room, and every guard standing in it, back on
          // the players' screens at their next re-read. Fog changes go through
          // `applyFogOp`, which owns the column; the returned scene carries
          // whatever fog is stored now.
          ...(patch.fog !== undefined ? { fog: normalizeFog(patch.fog) } : {}),
        })
        .where(eq(scenes.id, row.id))
        .returning()
    )[0]!;
    return { scene: serializeScene(updated), changed };
  }

  async deleteScene(sceneId: string): Promise<void> {
    await this.db.delete(scenes).where(eq(scenes.id, sceneId));
  }

  /** One active scene per campaign (FR9.1): demote others, promote this one. */
  async activateScene(row: SceneRow): Promise<Scene> {
    await this.db
      .update(scenes)
      .set({ state: 'draft' })
      .where(and(eq(scenes.campaignId, row.campaignId), eq(scenes.state, 'active')));
    const updated = (
      await this.db.update(scenes).set({ state: 'active' }).where(eq(scenes.id, row.id)).returning()
    )[0]!;
    return serializeScene(updated);
  }

  /**
   * Role-filtered composed payload: scene + tokens + live drawings. Hidden
   * tokens, tokens standing under the fog, and unrevealed fog geometry are
   * excluded for non-GM viewers HERE, at the query layer (Principle 4,
   * FR9.7/9.13).
   */
  async composedScene(
    row: SceneRow,
    gm: boolean,
  ): Promise<{ scene: Scene; tokens: TokenDto[]; drawings: DrawingDto[] }> {
    const tokenRows = await this.db.select().from(tokens).where(eq(tokens.sceneId, row.id));
    const drawingRows = await this.db.select().from(drawings).where(eq(drawings.sceneId, row.id));
    const now = Date.now();
    // Hidden by flag or by layer (FR9.7 / FR9.26), or standing on fogged
    // ground that is not LIVE (FR9.13, P6: unrevealed, or revealed only as
    // explored): any of those, and it is not on a player's wire.
    const dto = serializeScene(row);
    const concealed = concealer(dto);
    const visibleTokens = tokenRows.filter((t) => gm || !concealed(t)).map(serializeToken);
    const liveDrawings = drawingRows
      .filter((d) => !d.expiresAt || d.expiresAt.getTime() > now)
      .map(serializeDrawing);
    return { scene: sceneForViewer(dto, gm), tokens: visibleTokens, drawings: liveDrawings };
  }

  // --- tokens --------------------------------------------------------------

  /** Every token on a scene, whatever its visibility — the GM's list. */
  async tokensOf(sceneId: string): Promise<TokenRow[]> {
    return this.db.select().from(tokens).where(eq(tokens.sceneId, sceneId));
  }

  /**
   * Who may hear about each of `rows` where it stands (`tokenEventVisibility`),
   * for tokens that may stand on different scenes: the fan-outs that touch
   * every token of one runner at once (their look, their portrait), each
   * token in a scene of its own. Each scene is read once, and the answer
   * handed back as a question to ask of each row.
   *
   * Those fan-outs used to decide by the token's own `hidden` flag alone, so
   * a runner's token on a hidden layer, or on a scene the GM is still
   * staging, went out to every phone and the TV with the rest. A runner is
   * never fogged, but a layer and a staged scene hide a runner as well as a
   * guard.
   */
  async tokenEventVisibilities(rows: readonly TokenRow[]): Promise<(row: TokenRow) => Visibility> {
    const sceneIds = [...new Set(rows.map((r) => r.sceneId))];
    const judged = new Map<string, (token: ConcealableToken) => boolean>();
    if (sceneIds.length > 0) {
      for (const row of await this.db.select().from(scenes).where(inArray(scenes.id, sceneIds))) {
        const scene = serializeScene(row);
        judged.set(row.id, sceneOnTable(scene) ? concealer(scene) : () => true);
      }
    }
    return (row) => {
      const concealed = judged.get(row.sceneId);
      // A token whose scene was not found is nobody's but the GM's.
      return concealed !== undefined && !concealed(row) ? 'public' : 'gm';
    };
  }

  /**
   * Which of `tokenIds` are on the table right now: on the active scene, and
   * not concealed there (`tokenEventVisibility`). A token that no longer
   * exists is not. For the encounter roster a player and the TV are sent,
   * which names each combatant's token only when the table has that token.
   */
  async tokensOnTable(tokenIds: readonly string[]): Promise<Set<string>> {
    const ids = [...new Set(tokenIds)];
    if (ids.length === 0) return new Set();
    const rows = await this.db.select().from(tokens).where(inArray(tokens.id, ids));
    const heard = await this.tokenEventVisibilities(rows);
    return new Set(rows.filter((row) => heard(row) === 'public').map((row) => row.id));
  }

  async tokenWithScene(tokenId: string): Promise<{ token: TokenRow; scene: SceneRow }> {
    const rows = await this.db
      .select({ token: tokens, scene: scenes })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(eq(tokens.id, tokenId))
      .limit(1);
    const row = rows[0];
    if (!row) throw httpError(404, 'not_found', 'unknown token');
    return row;
  }

  /** Create a token; name/art default from the character / NPC template (FR9.4). */
  async createToken(scene: SceneRow, input: TokenCreateInput): Promise<TokenDto> {
    let name = input.name;
    let artRef = input.artRef ?? null;
    let look = input.look ?? null;
    if (input.source === 'character' && input.sourceId) {
      const c = (
        await this.db.select().from(characters).where(eq(characters.id, input.sourceId)).limit(1)
      )[0];
      if (!c) throw httpError(404, 'not_found', 'unknown character');
      name ??= c.name;
      // The runner's own look, as they dressed it (0011_token_look).
      look ??= lookOf(c.tokenLook);
      if (!artRef) {
        const sheet = c.sheet as { identity?: { portraitId?: string | null } } | null;
        artRef = sheet?.identity?.portraitId ?? null;
      }
    } else if (input.source === 'npc_template' && input.sourceId) {
      const t = (
        await this.db.select().from(npcTemplates).where(eq(npcTemplates.id, input.sourceId)).limit(1)
      )[0];
      if (!t) throw httpError(404, 'not_found', 'unknown NPC template');
      name ??= t.name;
    }
    const row = (
      await this.db
        .insert(tokens)
        .values({
          sceneId: scene.id,
          source: input.source,
          sourceId: input.sourceId ?? null,
          name: name ?? 'Prop',
          x: input.x ?? 0,
          y: input.y ?? 0,
          // Which storey it lands on (FR9.22). Dropping this put every token
          // on the ground floor, so a GM placing a guard while looking at the
          // catwalk got one who was standing in the warehouse below — and,
          // since the canvas draws one floor at a time, invisible.
          level: input.level ?? 0,
          size: input.size ?? 1,
          rotation: input.rotation ?? 0,
          artRef,
          hidden: input.hidden ?? false,
          barsVisibility: input.barsVisibility ?? 'owner',
          aura: input.aura ?? null,
          pose: input.pose ?? 'stand',
          look,
          light: input.light ?? null,
        })
        .returning()
    )[0]!;
    return serializeToken(row);
  }

  async patchToken(tokenId: string, patch: Partial<TokenCreateInput>): Promise<TokenRow> {
    const set: Record<string, unknown> = {};
    // `level` belongs in this list: the route already accepts it, and leaving
    // it out meant a token sent upstairs was written back unchanged — the
    // request succeeded, the response looked right, and the runner never moved.
    for (const key of ['name', 'x', 'y', 'level', 'size', 'rotation', 'artRef', 'hidden', 'barsVisibility', 'aura', 'pose', 'look', 'light'] as const) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    const row = (
      await this.db.update(tokens).set(set).where(eq(tokens.id, tokenId)).returning()
    )[0];
    if (!row) throw httpError(404, 'not_found', 'unknown token');
    return row;
  }

  /**
   * Repoint every token that stands for this character at a new portrait.
   *
   * `createToken` copies a character's `portraitId` into `artRef` ONCE, at
   * placement. Without this, a player who uploads a portrait mid-session sees
   * nothing change — not on a refresh, not ever — because the tokens already
   * on the map carry the old snapshot.
   *
   * A token whose art the GM has deliberately overridden is LEFT ALONE. That is
   * what `from` is for: only tokens still pointing at the previous portrait (or
   * at nothing) follow the character. A runner the GM disguised with a
   * different picture keeps the disguise, which is the whole reason per-token
   * art exists alongside the character's own.
   *
   * Returns the rows it changed so the caller can emit one event per token.
   */
  async retargetCharacterArt(
    characterId: string,
    from: string | null,
    to: string | null,
  ): Promise<TokenRow[]> {
    const mine = await this.db
      .select()
      .from(tokens)
      .where(and(eq(tokens.source, 'character'), eq(tokens.sourceId, characterId)));
    const changed: TokenRow[] = [];
    for (const row of mine) {
      const follows = row.artRef === null || row.artRef === from;
      if (!follows || row.artRef === to) continue;
      const written = (
        await this.db.update(tokens).set({ artRef: to }).where(eq(tokens.id, row.id)).returning()
      )[0];
      if (written) changed.push(written);
    }
    return changed;
  }

  async deleteToken(tokenId: string): Promise<void> {
    await this.db.delete(tokens).where(eq(tokens.id, tokenId));
  }

  /** FR9.5: GM moves anything; a player only their own character's token. */
  /**
   * Dress a runner: their look, on the character and on every token of theirs
   * in every scene. Returns the tokens it changed, for their events.
   */
  async setCharacterLook(characterId: string, look: TokenLook | null): Promise<TokenRow[]> {
    await this.db.update(characters).set({ tokenLook: look }).where(eq(characters.id, characterId));
    return this.db
      .update(tokens)
      .set({ look })
      .where(and(eq(tokens.source, 'character'), eq(tokens.sourceId, characterId)))
      .returning();
  }

  async canControlToken(auth: { role: string; userId: string }, token: TokenRow): Promise<boolean> {
    if (auth.role === 'gm') return true;
    if (auth.role !== 'player') return false;
    if (token.source !== 'character' || !token.sourceId) return false;
    const rows = await this.db
      .select({ owner: characters.ownerUserId })
      .from(characters)
      .where(eq(characters.id, token.sourceId))
      .limit(1);
    return rows[0]?.owner === auth.userId;
  }

  // --- fog (FR9.13/9.14) ---------------------------------------------------

  async applyFogOp(scene: SceneRow, op: FogOpInput): Promise<{ fog: FogState; region?: FogRegion }> {
    const fog = normalizeFog(scene.fog);
    let exploredIds = fog.exploredRegionIds ?? [];
    let exploredShapes = fog.exploredShapes ?? [];
    let brush = fog.brush;
    let region: FogRegion | undefined;
    if (op.op === 'define') {
      if (!op.region) throw httpError(400, 'bad_request', "op 'define' requires a region");
      region = { id: op.region.id ?? randomUUID(), name: op.region.name, polygon: op.region.polygon };
      fog.regions = [...fog.regions.filter((r) => r.id !== region!.id), region];
    } else if (op.op === 'reveal') {
      if (!op.regionId && !op.shape) {
        throw httpError(400, 'bad_request', "op 'reveal' needs a regionId or a shape");
      }
      // The two fashions (`FogRevealAsSchema`). A region is in ONE of the
      // reveal lists at a time: revealing it in the other fashion moves it
      // across, so a room the party has left drops from live to remembered
      // (and its guards leave the table) with one tap, and a remembered room
      // they walk back into opens again the same way. A shape is painted
      // into the list of its fashion; shapes are strokes, not places, and a
      // live stroke over an explored one is simply live there (`fogCells`:
      // live beats explored).
      //
      // Revealing is the latest act on the ground it covers, so the brush's
      // marks under it go (`eraseBrushUnder`, every floor, by square centre):
      // "reveal the lab" reveals the whole lab, the cupboard the GM fogged
      // again with the brush last week included.
      const explored = op.as === 'explored';
      if (op.regionId) {
        const id = op.regionId;
        region = fog.regions.find((r) => r.id === id);
        if (!region) throw httpError(404, 'region_not_found', 'unknown fog region');
        if (explored) {
          fog.revealed = fog.revealed.filter((r) => r !== id);
          if (!exploredIds.includes(id)) exploredIds = [...exploredIds, id];
        } else {
          if (!fog.revealed.includes(id)) fog.revealed = [...fog.revealed, id];
          exploredIds = exploredIds.filter((r) => r !== id);
        }
        brush = eraseBrushUnder(brush, region.polygon);
      }
      if (op.shape) {
        if (explored) exploredShapes = [...exploredShapes, op.shape];
        else fog.revealedShapes = [...fog.revealedShapes, op.shape];
        brush = eraseBrushUnder(brush, op.shape);
      }
    } else if (op.op === 'remove') {
      // The region goes, and with every reveal of it, in either fashion. What
      // that does to the ground it covered depends on the switch: a region is
      // a window the fog is opened through, so with the fog on its ground
      // goes back under the fog (unless another reveal covers it), and with
      // the fog off nothing changes for the table at all.
      if (!op.regionId) throw httpError(400, 'bad_request', "op 'remove' needs a regionId");
      region = fog.regions.find((r) => r.id === op.regionId);
      fog.regions = fog.regions.filter((r) => r.id !== op.regionId);
      fog.revealed = fog.revealed.filter((id) => id !== op.regionId);
      exploredIds = exploredIds.filter((id) => id !== op.regionId);
    } else if (op.op === 'enable' || op.op === 'disable') {
      // The scene's fog switch (`FogState.enabled`). Only the switch moves:
      // every region and every reveal stays exactly as it was. So a GM can
      // prepare a scene's fog with it off and switch it on at the door, or
      // switch it off for a moment and back on without losing the evening's
      // reveals. Once flipped it is the answer (`fogOn`), and a scene with no
      // regions at all can be fogged, which before the switch it could not.
      fog.enabled = op.op === 'enable';
    } else if (op.op === 'forget') {
      // The party's memory, the GM's to wipe (`forgetExplored`): nothing the
      // GM revealed moves, only what the runners have seen for themselves.
      const sight = forgetExplored(fog.sight, op.level);
      if (sight !== undefined) fog.sight = sight;
      else delete fog.sight;
    } else if (op.op === 'brush') {
      // The GM's reveal brush (FR9.13's square-by-square brush): the squares
      // of one floor marked live, as seen before, fogged again, or cleared
      // (`paintBrush`). Kept on the scene's grid as it is now, capped as the
      // party's sight is (`FOG_SIGHT_MAX_SIDE`). Nothing else moves: not the
      // regions, not the party's memory. A square fogged again that a runner
      // is looking at right now stays in their sight, and the pass that
      // follows every fog op takes the mark off it (the party has seen it
      // again), so the brush fogs what they have left, never what they see.
      if (!op.brush) throw httpError(400, 'bad_request', "op 'brush' needs the squares it paints");
      const grid = normalizeGrid(scene.grid);
      brush = paintBrush(
        brush,
        Math.min(grid.cols, FOG_SIGHT_MAX_SIDE),
        Math.min(grid.rows, FOG_SIGHT_MAX_SIDE),
        op.level ?? 0,
        op.brush,
      );
    } else {
      // hide: one named region, whichever fashion it was revealed in, or (no
      // regionId) the GM's reset: every reveal of both fashions, regions,
      // shapes and every square of the brush, taken back at once. The party's
      // own memory of the map (`sight`) is not the GM's reveal and is left
      // alone; forgetting it is a separate act (`forget`, above).
      //
      // A region hidden is the latest act on its ground, as a reveal is: the
      // brush's marks under it go too, so "fog the lab again" fogs the whole
      // lab, the squares painted open inside it included. Only for a region
      // the table was shown, in either fashion: the brush is on every
      // player's wire, and marks vanishing from under a region that was
      // never revealed would trace its outline for them, which a region
      // they had been shown already told them.
      if (op.regionId) {
        const shown = fog.revealed.includes(op.regionId) || exploredIds.includes(op.regionId);
        fog.revealed = fog.revealed.filter((id) => id !== op.regionId);
        exploredIds = exploredIds.filter((id) => id !== op.regionId);
        const hidden = fog.regions.find((r) => r.id === op.regionId);
        if (hidden && shown) brush = eraseBrushUnder(brush, hidden.polygon);
      } else {
        fog.revealed = [];
        fog.revealedShapes = [];
        exploredIds = [];
        exploredShapes = [];
        brush = undefined;
      }
    }
    setExplored(fog, exploredIds, exploredShapes);
    if (brush !== undefined) fog.brush = brush;
    else delete fog.brush;
    await this.db.update(scenes).set({ fog }).where(eq(scenes.id, scene.id));
    return region ? { fog, region } : { fog };
  }

  // --- drawings / AoE templates (FR9.12, FR9.15) ---------------------------

  async createDrawing(
    sceneId: string,
    input: { kind: 'sketch' | 'template'; geometry: Record<string, unknown>; createdBy: string; expiresInSec?: number },
  ): Promise<DrawingDto> {
    const row = (
      await this.db
        .insert(drawings)
        .values({
          sceneId,
          kind: input.kind,
          geometry: input.geometry,
          createdBy: input.createdBy,
          expiresAt: input.expiresInSec ? new Date(Date.now() + input.expiresInSec * 1000) : null,
        })
        .returning()
    )[0]!;
    return serializeDrawing(row);
  }

  async drawingRow(id: string): Promise<DrawingRow> {
    const rows = await this.db.select().from(drawings).where(eq(drawings.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw httpError(404, 'not_found', 'unknown drawing');
    return row;
  }

  /** Edit template params (radius, position — FR9.12 "editable"). */
  async updateDrawing(id: string, geometry: Record<string, unknown>): Promise<DrawingDto> {
    const row = (
      await this.db.update(drawings).set({ geometry }).where(eq(drawings.id, id)).returning()
    )[0];
    if (!row) throw httpError(404, 'not_found', 'unknown drawing');
    return serializeDrawing(row);
  }

  async deleteDrawing(id: string): Promise<void> {
    await this.db.delete(drawings).where(eq(drawings.id, id));
  }

  async clearDrawings(sceneId: string): Promise<string[]> {
    const rows = await this.db.delete(drawings).where(eq(drawings.sceneId, sceneId)).returning();
    return rows.map((r) => r.id);
  }

  // --- attachments (FR9.2; §13 uploads) ------------------------------------

  async saveAttachment(opts: {
    campaignId: string | null;
    kind: 'map' | 'token' | 'handout' | 'portrait' | 'asset' | 'audio';
    visibility: Visibility;
    mime: string;
    file: NodeJS.ReadableStream;
  }): Promise<AttachmentRow> {
    const ext = ALLOWED_MIME[opts.mime];
    if (!ext) throw httpError(415, 'unsupported_media_type', `mime '${opts.mime}' is not allowed`);
    const dir = filesDir();
    await mkdir(dir, { recursive: true });
    const fileName = `${randomUUID()}${ext}`;
    const dest = join(dir, fileName);
    // §13 asks for a sharp re-encode + metadata strip. `sharp` is a native
    // dependency and outside the budget, so the byte stream is stored verbatim.
    //
    // That trade used to rest on "uploads are GM-only on a LAN", and portraits
    // took it away: a player uploading their own token art is a second, less
    // trusted writer into the same store. The allowlist alone is not much of a
    // gate when the client picks the mime, so the bytes now have to AGREE with
    // it — see `sniffMime`. A declared PNG whose first eight bytes are not a
    // PNG signature is rejected and never lands on disk.
    await pipeline(opts.file, sniffMime(opts.mime), createWriteStream(dest));
    const size = (await stat(dest)).size;
    return (
      await this.db
        .insert(attachments)
        .values({
          campaignId: opts.campaignId,
          kind: opts.kind,
          path: fileName,
          mime: opts.mime,
          size,
          visibility: opts.visibility,
        })
        .returning()
    )[0]!;
  }

  async attachment(id: string): Promise<AttachmentRow | null> {
    const rows = await this.db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
    return rows[0] ?? null;
  }

  attachmentPath(row: AttachmentRow): string {
    return join(filesDir(), row.path);
  }

  /**
   * §13: files served behind auth + visibility — a GM-only map must 404 for
   * players (no existence oracle). `gm_owner` degrades to gm-only: the
   * attachments table has no owner column (INTEGRATION).
   */
  canSeeAttachment(
    auth: { role: string; campaignId: string | null },
    row: AttachmentRow,
  ): boolean {
    if (row.campaignId && auth.campaignId !== row.campaignId) return false;
    if (auth.role === 'gm') return true;
    return row.visibility === 'public';
  }

  // --- encounter staging (FR9.10) ------------------------------------------

  /**
   * Create combatants from the scene's character/NPC tokens (props skipped;
   * concealed tokens — hidden, or standing under the fog — become
   * gm-visibility combatants). Coordination with the encounters domain is via
   * db rows only.
   *
   * `shown` is how many of the new combatants the table may see. It is the
   * only count that can go on a public event: the whole count, less the
   * shown ones, is exactly the number of foes the GM is holding back.
   */
  async stageEncounter(
    scene: SceneRow,
    opts: { name?: string; encounterId?: string },
  ): Promise<{ encounterId: string; createdEncounter: boolean; combatantIds: string[]; shown: number }> {
    const tokenRows = await this.db.select().from(tokens).where(eq(tokens.sceneId, scene.id));
    let stageable = tokenRows.filter((t) => t.source === 'character' || t.source === 'npc_template');

    let encounterId = opts.encounterId;
    let createdEncounter = false;
    if (encounterId) {
      const enc = (
        await this.db.select().from(encounters).where(eq(encounters.id, encounterId)).limit(1)
      )[0];
      if (!enc || enc.campaignId !== scene.campaignId) {
        throw httpError(404, 'not_found', 'unknown encounter');
      }
      if (!enc.sceneId) {
        await this.db.update(encounters).set({ sceneId: scene.id }).where(eq(encounters.id, encounterId));
      }
      const existing = await this.db
        .select({ tokenId: combatants.tokenId })
        .from(combatants)
        .where(eq(combatants.encounterId, encounterId));
      const linked = new Set(existing.map((e) => e.tokenId).filter((id): id is string => id != null));
      stageable = stageable.filter((t) => !linked.has(t.id));
    } else {
      const enc = (
        await this.db
          .insert(encounters)
          .values({ campaignId: scene.campaignId, sceneId: scene.id, name: opts.name ?? scene.name, state: 'prep' })
          .returning()
      )[0]!;
      encounterId = enc.id;
      createdEncounter = true;
    }

    // Stats for character tokens (monitor sizes + initiative line).
    const charIds = stageable
      .filter((t) => t.source === 'character' && t.sourceId)
      .map((t) => t.sourceId!) ;
    const charRows = charIds.length
      ? await this.db.select().from(characters).where(inArray(characters.id, charIds))
      : [];
    const sheetById = new Map(charRows.map((c) => [c.id, c.sheet]));

    // The archetype behind each NPC token, so the ganger the GM placed on the
    // catwalk arrives on the tracker as a BODY — attributes, pools, monitors,
    // a copilot rack — and not as a name with 0+1d6 and ten boxes.
    const templateIds = stageable
      .filter((t) => t.source === 'npc_template' && t.sourceId)
      .map((t) => t.sourceId!);
    const templateRows = templateIds.length
      ? await this.db.select().from(npcTemplates).where(inArray(npcTemplates.id, templateIds))
      : [];
    const templateById = new Map(templateRows.map((r) => [r.id, r]));

    const combatantIds: string[] = [];
    let shown = 0;
    // Read once: whether each token is on the table is asked of the same scene.
    const concealed = concealer(serializeScene(scene));
    for (const t of stageable) {
      const raw = t.sourceId ? sheetById.get(t.sourceId) : undefined;
      // FR9.10/FR4.2: derive the initiative line through the ENGINE, exactly as
      // `EncountersService.addCombatant` does — REA + INT + 1d6 is only the
      // unaugmented case, and reading the sheet raw silently dropped wired
      // reflexes, adept powers and every other `initiative.*` modifier (staged
      // PCs all came out at a flat REA+INT with a single die).
      const parsed = raw !== undefined && raw !== null ? SheetV1Schema.safeParse(raw) : null;
      const derived = parsed?.success ? deriveFor(parsed.data, 'physical') : null;
      const stats = (raw ?? undefined) as StatShape | undefined;
      const body =
        t.source === 'npc_template' && t.sourceId
          ? rolledBodyFor(templateById.get(t.sourceId), t.id)
          : null;
      const initBase = body
        ? body.initBase
        : derived
          ? derived.base
          : (stats?.attributes?.rea ?? 0) + (stats?.attributes?.int ?? 0);
      // Concealed by flag, by layer (FR9.26) or by the fog (FR9.13): a
      // combatant nobody was shown must not appear in the tracker, or on the
      // TV's ribbon, before it appears on the map. This asked `tokenHidden`
      // alone, so a guard the server was withholding from every player's map
      // because he stood in unrevealed fog went onto the public roster by
      // name the moment the GM staged the fight.
      const visibility = concealed(t) ? 'gm' : 'public';
      if (visibility === 'public') shown += 1;
      const row = (
        await this.db
          .insert(combatants)
          .values({
            encounterId,
            tokenId: t.id,
            source: t.source === 'character' ? 'character' : 'npc_template',
            sourceId: t.sourceId,
            name: t.name,
            initBase,
            initKind: 'physical',
            monitors: body ? body.monitors : derived ? derived.monitors : monitorsFrom(stats),
            visibility,
            // `initDice` rides in the copilot JSONB (no column of its own); a
            // missing value would default to 1 die and lose the augmentation.
            copilot: body ? body.copilot : { initDice: derived ? derived.dice : 1 },
          })
          .returning()
      )[0]!;
      combatantIds.push(row.id);
    }
    return { encounterId, createdEncounter, combatantIds, shown };
  }

  async activeSceneModifiers(campaignId: string): Promise<Modifier[]> {
    return activeSceneModifiers(this.db, campaignId);
  }

  /**
   * Current table-display steering (FR9.21). There is no `display` table: the
   * newest `display.updated` event carries the whole state, so this reads it
   * back. Anything unset falls to the defaults a fresh TV boots with.
   */
  async displayState(campaignId: string): Promise<DisplayState> {
    const row = await latestEventOfType(this.db, campaignId, 'display.updated');
    return readDisplayState(row?.payload);
  }
}

/** GM steering of the table display (FR9.21). */
export interface DisplayState {
  /** Blank the big screen entirely (a between-scenes curtain). */
  blank: boolean;
  /** Show the initiative ribbon. Off during pure roleplay. */
  ribbon: boolean;
}

export const DEFAULT_DISPLAY_STATE: DisplayState = { blank: false, ribbon: true };

/**
 * Read a `display.updated` payload tolerantly. `ribbon` defaults to ON and
 * `blank` to OFF, so a malformed or absent event leaves the table looking at
 * the game rather than at a black screen.
 */
export function readDisplayState(payload: unknown): DisplayState {
  if (!isRecord(payload)) return DEFAULT_DISPLAY_STATE;
  return { blank: payload['blank'] === true, ribbon: payload['ribbon'] !== false };
}
