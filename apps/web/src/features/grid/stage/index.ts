/**
 * The PixiJS scene stage (lazy chunk — the only module tree that imports
 * `pixi.js`, per D9 / NFR "Bundle").
 *
 * 60fps discipline: ONE ticker, one camera transform flush per frame, pooled
 * TokenViews and pooled fx graphics, and layer redraws keyed on content hashes
 * so a pan/zoom or a token move never re-tessellates the grid, fog or geometry.
 */
import type { GeometrySelection } from '../types.js';
import { handlesOf, objectForSelection } from '../paintedObjects.js';
import { allCells } from '../cellSelection.js';
import { Application, Assets, ColorMatrixFilter, Container, Graphics, Text, type Texture } from 'pixi.js';
import type { VisionMode } from '@safehouse/rules';
import type { Point, Token } from '@safehouse/contracts';
import { TILESETS, levelTiles } from '@safehouse/rules';
import type { TileLayer } from '@safehouse/contracts';
import {
  metricsFor,
  metricsKey,
  sceneWorldSize,
  worldFromGrid,
  type SceneMetrics,
} from '../geometry.js';
import {
  tileDefsFromSets,
  type MovementThresholds,
  type StageApi,
  type StageOptions,
  type StageSceneState,
  type TileDrawDef,
  type TileRectMode,
} from '../types.js';
import { parserSafeUrlFor, type AssetRegistry } from './assetUrl.js';
import { Camera } from './camera.js';
import { C } from './colors.js';
import { FxLayer } from './fx.js';
import { drawCameras, drawFog, drawGeometry, drawGrid, drawNotes, drawPins } from './layers.js';
import { drawShroud, shroudKey } from './shroudLayer.js';
import { ChunkedTileLayer } from './tileChunks.js';
import { BelowFloors } from './belowLayer.js';
import { tileDrawInput, tileLayerKey } from './tileLayer.js';
import { MapLayer } from './mapLayer.js';
import { PointerController, type Cell, type PointerHost } from './pointer.js';
import { TokenView } from './tokenView.js';

/** How long an un-terminated remote drag ghost keeps overriding a position. */
const GHOST_TTL_MS = 4000;

/**
 * The palette every stage starts with (FR9.2).
 *
 * `setTileDefs` exists so the canvas draws exactly what the SERVER accepted,
 * and the Grid still calls it — but it was the ONLY palette path, and the two
 * consumers that matter never completed it. The table display never called it
 * at all (`tvStage.ts` builds a read-only handle that does not expose it), so
 * the screen the feature exists for drew a blank floor forever. The Grid's own
 * call lost a race: the stage arrives from a dynamic import, so on a cold load
 * the palette effect ran while the handle was still null and the floor only
 * appeared after the GM switched scenes and back.
 *
 * Seeding from the shipped catalogue removes the whole class of failure: it is
 * the same data, from the same monorepo build, that the server serves at
 * `GET /api/tilesets`, so a painted scene draws immediately and with no round
 * trip — and the served palette still wins the moment it lands.
 */
const CATALOGUE_DEFS: Record<string, TileDrawDef> = tileDefsFromSets(TILESETS);

/** The selected id when the selection is one of `kinds`, else null. */
function selectedOf(state: StageSceneState, ...kinds: GeometrySelection['kind'][]): string | null {
  const sel = state.selection;
  return sel && kinds.includes(sel.kind) ? sel.id : null;
}

/** The selection as a redraw-key fragment, for the layer that draws those kinds (§3.2). */
function selectionKey(state: StageSceneState, ...kinds: GeometrySelection['kind'][]): string {
  const id = selectedOf(state, ...kinds);
  return id === null ? '' : `${state.selection?.kind}:${id}`;
}

function fogKey(state: StageSceneState): string {
  const fog = state.scene.fog;
  return [
    state.role === 'gm' ? 'gm' : 'pc',
    fog.regions.map((r) => `${r.id}:${r.name}:${r.polygon.length}`).join(','),
    fog.revealed.join(','),
    fog.revealedShapes.length,
  ].join('|');
}

function geometryKey(state: StageSceneState): string {
  const geo = state.scene.geometry;
  return [
    state.role === 'gm' ? 'gm' : 'pc',
    selectionKey(state, 'wall', 'door', 'zone'),
    // Endpoints, not just counts: editing a wall in place must redraw it.
    geo.walls.map((w) => `${w.id}:${w.a.x},${w.a.y},${w.b.x},${w.b.y}`).join(','),
    geo.zones.map((z) => `${z.id}:${z.name}:${z.color ?? ''}:${z.polygon.length}`).join(','),
    geo.doors
      .map((d) => `${d.id}:${d.open ? 1 : 0}:${d.locked ? 1 : 0}:${d.a.x},${d.a.y},${d.b.x},${d.b.y}`)
      .join(','),
  ].join('|');
}

/** Notes redraw on any edit of any note, and on selection (FR9.25). */
function noteKey(state: StageSceneState): string {
  return [
    state.role === 'gm' ? 'gm' : 'pc',
    selectionKey(state, 'note'),
    (state.scene.geometry.gmNotes ?? [])
      .map((n) => `${n.id}:${n.at.x},${n.at.y}:${n.width}:${n.color ?? ''}:${n.text}`)
      .join('\u0001'),
  ].join('|');
}

/** Pins redraw on any label/position/visibility edit, and on selection. */
function cameraKey(state: StageSceneState): string {
  const geo = state.scene.geometry;
  return [
    state.role === 'gm' ? 'gm' : 'pc',
    state.level ?? 0,
    selectionKey(state, 'camera'),
    (geo.cameras ?? [])
      .map((c) => `${c.id}:${c.at.x},${c.at.y}:${c.facing}:${c.fov}:${c.range}:${c.level}:${c.active ? 1 : 0}:${c.label ?? ''}`)
      .join(','),
    // The cones carry their own content signature (`useCameraCones`).
    (state.cameraCones ?? []).map((c) => c.key).join('|'),
  ].join('|');
}

function pinKey(state: StageSceneState): string {
  const geo = state.scene.geometry;
  return [
    state.role === 'gm' ? 'gm' : 'pc',
    selectionKey(state, 'pin'),
    geo.pins.map((p) => `${p.id}:${p.at.x},${p.at.y}:${p.visibility}:${p.label ?? ''}`).join(','),
    // Zone names render into the same label layer for the GM.
    geo.zones.map((z) => `${z.id}:${z.name}`).join(','),
  ].join('|');
}

class Stage implements StageApi, PointerHost {
  readonly camera = new Camera();
  readonly callbacks: StageOptions['callbacks'];

  private readonly app = new Application();
  private readonly world = new Container();
  /** The eyes the canvas is currently drawn for (`setViewMode`). */
  private viewMode: VisionMode = 'normal';
  /** Painted floor (FR9.2) — under the grid, above the map image. */
  private readonly tiles = new ChunkedTileLayer();
  /** The floors below, seen where this one is open (`belowLayer.ts`). */
  private readonly below = new BelowFloors();
  private lastTileKey = '';
  // Seeded with the shipped catalogue: the served palette is the same data
  // from the same build, so its arrival must not cost a second full draw.
  private lastDefsSignature = JSON.stringify(CATALOGUE_DEFS);
  /** Cells outside the viewer's sightline (FR9.16). */
  private readonly shroudG = new Graphics();
  private lastShroudKey = '';
  private tileDefs: Record<string, TileDrawDef> = CATALOGUE_DEFS;
  private readonly gridG = new Graphics();
  private readonly geoG = new Graphics();
  private readonly fogG = new Graphics();
  private readonly fogLabels = new Container();
  private readonly fogLabelPool = new Map<string, Text>();
  private readonly pinG = new Graphics();
  private readonly pinLabels = new Container();
  private readonly pinLabelPool = new Map<string, Text>();
  /** The GM's security cameras and their cones (FR9.23). */
  private readonly cameraG = new Graphics();
  private readonly cameraLabels = new Container();
  private readonly cameraLabelPool = new Map<string, Text>();
  private lastCameraKey = '';
  /** The GM's notes (FR9.25). */
  private readonly noteG = new Graphics();
  private readonly noteLabels = new Container();
  private readonly noteLabelPool = new Map<string, Text>();
  private lastNoteKey = '';
  private readonly tokenLayer = new Container();
  private readonly fx = new FxLayer();
  private readonly map: MapLayer;

  private readonly views = new Map<string, TokenView>();
  private readonly artRequested = new Set<string>();
  private drags: Record<string, { x: number; y: number; ts?: number }> = {};
  private localDragId: string | null = null;
  private localDragWorld: Point | null = null;

  private sceneState: StageSceneState;
  private m: SceneMetrics;
  private thresholds: MovementThresholds | null = null;

  private lastMetricsKey = '';
  private lastFogKey = '';
  private lastGeoKey = '';
  private lastPinKey = '';
  private lastMapKey = '';
  private lastAoeKey = '';
  private lastFogDraftKey = '';
  private lastPaintedSelKey = '';
  private wasPasting = false;
  private framedSceneId = '';

  private pointer: PointerController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;

  constructor(private readonly opts: StageOptions) {
    this.callbacks = opts.callbacks;
    this.sceneState = opts.state;
    this.m = metricsFor(opts.state.scene.grid);
    this.map = new MapLayer(opts.urlFor);
  }

  async init(): Promise<void> {
    const host = this.opts.host;
    await this.app.init({
      background: C.ground,
      antialias: true,
      resolution: Math.min(2, globalThis.devicePixelRatio || 1),
      autoDensity: true,
      resizeTo: host,
      preference: 'webgl',
    });
    if (this.disposed) {
      this.app.destroy(true, { children: true });
      return;
    }
    host.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = '100%';

    // Fog sits ABOVE tokens: unrevealed area must occlude, not merely tint
    // (hidden tokens are already absent — the server filtered them, FR9.7).
    // Pins sit under the fog cover: a pin inside an unrevealed room must not
    // give its position away on a player screen (its data is filtered out
    // server-side, but the GM's own view has to occlude too).
    this.world.addChild(
      this.map.root,
      this.below.root,
      this.tiles.root,
      this.shroudG,
      this.gridG,
      this.geoG,
      this.cameraG,
      this.pinG,
      this.pinLabels,
      this.cameraLabels,
      this.noteG,
      this.noteLabels,
      this.tokenLayer,
      this.fogG,
      this.fogLabels,
      this.fx.root,
    );
    this.world.eventMode = 'none';
    this.app.stage.addChild(this.world);
    this.app.stage.eventMode = 'none';

    this.pointer = new PointerController(this.app.canvas, this);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        // Pixi's `resizeTo: host` only listens to the WINDOW. When the host
        // alone changes size — the GM panel opening beside the canvas, which
        // in Build happens on every select and deselect — the drawing buffer
        // kept its old size and CSS stretched it into the new box: the map
        // lurched sideways, and every click after it mapped through a camera
        // fitted to a canvas that was no longer there. Resize it here, from
        // the element that actually changed.
        this.app.resize();
        this.pointer?.invalidateRect();
        this.camera.dirty = true;
        // The mount-time fit measured whatever size the host had before the
        // page's layout settled — on a phone that left the whole map ninety
        // pixels wide in a corner, and a token four pixels across. Until the
        // viewer frames the map themselves, every resize fits it again.
        if (!this.camera.touched) this.fitScene();
      });
      this.resizeObserver.observe(host);
    }

    this.app.ticker.add((ticker) => this.frame(ticker.deltaMS));
    this.update(this.sceneState);
    this.fitScene();
  }

  // -- PointerHost -----------------------------------------------------------

  metrics(): SceneMetrics {
    return this.m;
  }

  state(): StageSceneState {
    return this.sceneState;
  }

  localDrag(tokenId: string | null, world: Point | null): void {
    if (this.localDragId && this.localDragId !== tokenId) {
      const prev = this.views.get(this.localDragId);
      if (prev) prev.localDrag = false;
    }
    this.localDragId = tokenId;
    this.localDragWorld = world;
    if (!tokenId || !world) return;
    const view = this.views.get(tokenId);
    if (!view) return;
    view.localDrag = true;
    view.place(world.x, world.y);
  }

  echoPing(world: Point): void {
    this.fx.ping(world.x, world.y);
  }

  echoTrail(world: Point): void {
    this.fx.trailPoint(world.x, world.y);
  }

  drawRuler(from: Point, to: Point, meters: number): void {
    this.fx.setRuler(this.m, from, to, meters, this.thresholds);
  }

  clearRuler(): void {
    this.fx.clearRuler();
  }

  drawSegment(kind: 'wall' | 'door', from: Point, to: Point): void {
    this.fx.setSegmentDraft(this.m, kind, from, to);
  }

  clearSegment(): void {
    this.fx.clearSegmentDraft();
  }

  drawArc(a: Point, b: Point, bulge: number): void {
    this.fx.setArcDraft(this.m, a, b, bulge);
  }

  clearArc(): void {
    this.fx.clearSegmentDraft();
  }

  drawRect(mode: TileRectMode, from: Cell, to: Cell): void {
    this.fx.setRectDraft(this.m, mode, from, to);
  }

  clearRect(): void {
    this.fx.clearRectDraft();
  }

  drawPaintedGhost(cells: readonly string[] | null): void {
    if (cells === null) this.fx.clearPaintedGhost();
    else this.fx.setPaintedGhost(this.m, cells);
  }

  // -- StageApi --------------------------------------------------------------

  /** Served palette wins; the shipped catalogue fills anything it omits. */
  setTileDefs(defs: Record<string, TileDrawDef>): void {
    // By CONTENT, not identity. The served palette is re-fetched after every
    // paint, and a fresh array of the same catalogue arrived here as "a new
    // palette" — which threw the whole tile layer away and redrew every chunk
    // on every brush stroke, the exact cost the chunking exists to avoid.
    const signature = JSON.stringify(defs);
    if (signature === this.lastDefsSignature) return;
    this.lastDefsSignature = signature;
    this.tileDefs = { ...CATALOGUE_DEFS, ...defs };
    this.lastTileKey = ''; // force a redraw with the new palette
    // A new palette changes what every cell looks like without changing any
    // cell's id, which is the one edit the chunk diff cannot see.
    this.tiles.invalidate();
    this.below.invalidate();
  }

  /**
   * Restyle the canvas for a pair of eyes (docs/VISION.md §4.4–4.5). Filters
   * on the floor (map image and tiles) and on the tokens, nothing on the fx
   * or the labels; a ColorMatrixFilter each way, so the cost is one pass
   * over the scene, not a second renderer.
   *
   * Thermal is pixi's own "predator" matrix — a false-colour heat ramp —
   * with warm bodies lifted to amber on the token layer. Low-light is a lift
   * with the colour drained, ultrasound a hard grey. Normal removes it all.
   */
  setViewMode(mode: VisionMode): void {
    if (this.disposed || mode === this.viewMode) return;
    this.viewMode = mode;
    const floor = [this.map.root, this.below.root, this.tiles.root];
    const clear = (c: Container) => {
      c.filters = [];
    };
    if (mode === 'normal' || mode === 'astral') {
      for (const c of floor) clear(c);
      clear(this.tokenLayer);
      return;
    }
    const floorFilter = new ColorMatrixFilter();
    const tokenFilter = new ColorMatrixFilter();
    if (mode === 'thermographic') {
      // Heat, not light: the floor drops to a cold violet with its detail
      // flattened (concrete, crates and water all read about the same to
      // thermal eyes), and every body on it comes up hot amber. Per-tile
      // heat (VISION.md §4.4) will vary the floor later; the split between
      // cold ground and warm bodies is the part that makes thermal useful.
      // Explicit matrices (row = [r, g, b, a, offset], offsets in 0..1): a
      // multiply tint on a dark disc only makes a darker disc, and a body
      // has to glow. Luminance drives both ramps; the offsets set the floor.
      const L = [0.2126, 0.7152, 0.0722];
      const ramp = (r: number, g: number, b: number, ro: number, go: number, bo: number) => [
        L[0]! * r, L[1]! * r, L[2]! * r, 0, ro,
        L[0]! * g, L[1]! * g, L[2]! * g, 0, go,
        L[0]! * b, L[1]! * b, L[2]! * b, 0, bo,
        0, 0, 0, 1, 0,
      ];
      // Floor: cold violet, detail kept.
      floorFilter.matrix = ramp(0.35, 0.25, 0.6, 0.1, 0.05, 0.25) as typeof floorFilter.matrix;
      // Bodies: hot amber, brighter at the core.
      tokenFilter.matrix = ramp(0.55, 0.45, 0.15, 0.45, 0.3, 0.05) as typeof tokenFilter.matrix;
    } else if (mode === 'lowlight') {
      floorFilter.brightness(1.3, false);
      floorFilter.saturate(-0.65, true);
      floorFilter.tint(0xcfe8d5, true);
      tokenFilter.saturate(-0.4, false);
    } else {
      // ultrasound: shape without colour, edges up.
      floorFilter.desaturate();
      floorFilter.contrast(0.45, true);
      tokenFilter.desaturate();
    }
    for (const c of floor) c.filters = [floorFilter];
    this.tokenLayer.filters = [tokenFilter];
  }

  update(next: StageSceneState): void {
    // A stage that has been torn down draws nothing: the hook's update effect
    // can fire once more with the old stage in its closure while the host is
    // unmounted and remounted (a scene gone, then another one live), and a
    // destroyed Graphics has no context left to clear.
    if (this.disposed) return;
    this.sceneState = next;
    const m = metricsFor(next.scene.grid);
    this.m = m;

    const mk = metricsKey(m);
    if (mk !== this.lastMetricsKey) {
      this.lastMetricsKey = mk;
      drawGrid(this.gridG, m);
      this.lastTileKey = ''; // tiles are metric-dependent too
      this.map.fitAll(m, next.scene.mapAttachmentIds.length === 0);
      this.lastFogKey = ''; // fog/geometry/pins are metric-dependent
      this.lastGeoKey = '';
      this.lastPinKey = '';
    }

    // Painted tiles: content-hashed key so a redraw happens on any paint that
    // changed a cell, and not once per frame (see `tileLayerKey`).
    // ONE floor's tiles. A catwalk painted above the warehouse must not draw
    // over the warehouse when the GM is looking at the ground.
    const level = next.level ?? 0;
    const tiles = levelTiles(next.scene, level) as TileLayer | undefined;
    const tileKey = `L${level}|${tileLayerKey(next.scene.id, tiles)}`;
    if (tileKey !== this.lastTileKey) {
      this.lastTileKey = tileKey;
      if (tiles) {
        // Only the chunks a stroke touched are redrawn — see `ChunkedTileLayer`
        // for the measurement that made that necessary.
        this.tiles.update(m, tileDrawInput(tiles, this.tileDefs), next.scene.id, level);
      } else {
        this.tiles.clear();
      }
    }
    // What shows through where this floor is open. Keyed inside, on the
    // floors it reads, so it redraws only when one of them changes.
    this.below.update(m, next.scene, level, this.tileDefs);

    // A paste that was waiting and no longer is — placed, or Esc — takes its
    // ghost with it rather than leaving it until the pointer next moves.
    const pasting = Boolean(next.pasting);
    if (this.wasPasting && !pasting) this.fx.clearPaintedGhost();
    this.wasPasting = pasting;

    // The painted object selected in Build: a ring on each of its cells, and
    // the handles that stretch or resize it. Re-read from the scene every
    // update, so a slide the server has just written moves the ring with it.
    const psel = next.selection?.kind === 'painted' && next.paintEdit
      ? objectForSelection(next.scene, level, next.selection.id)
      : null;
    // A multi-selection rings its squares the same way, without handles:
    // stretching is a thing one object does, not a box of them.
    const multi = next.paintEdit && next.cellSelection && next.cellSelection.level === level
      ? allCells(next.cellSelection)
      : null;
    const pselKey = multi
      ? `M|${level}|${multi.join(';')}|${metricsKey(m)}`
      : psel
        ? `${level}|${(psel.covers ?? psel.cells).join(';')}|${metricsKey(m)}`
        : '';
    if (pselKey !== this.lastPaintedSelKey) {
      this.lastPaintedSelKey = pselKey;
      if (multi) {
        this.fx.setPaintedSelection(m, multi, []);
      } else if (psel) {
        this.fx.setPaintedSelection(
          m,
          psel.covers ?? psel.cells,
          handlesOf(psel).map((h) => worldFromGrid(m, h.at)),
        );
      } else {
        this.fx.clearPaintedSelection();
      }
    }

    // The sightline shroud. Keyed on the visible SET rather than its size: a
    // token stepping sideways behind a pillar can reveal one cell and hide
    // another, which leaves the count identical and the shape different.
    const shroud = next.shroud ?? null;
    const sKey = shroudKey(shroud);
    if (sKey !== this.lastShroudKey) {
      this.lastShroudKey = sKey;
      drawShroud(this.shroudG, m, shroud);
    }

    const mapKey = next.scene.mapAttachmentIds.join(',');
    if (mapKey !== this.lastMapKey) {
      this.lastMapKey = mapKey;
      this.map.setImages(next.scene.mapAttachmentIds, m);
    }

    const fk = fogKey(next);
    if (fk !== this.lastFogKey) {
      this.lastFogKey = fk;
      drawFog(this.fogG, this.fogLabels, this.fogLabelPool, next.scene, m, next.role === 'gm');
    }

    const gk = geometryKey(next);
    if (gk !== this.lastGeoKey) {
      this.lastGeoKey = gk;
      drawGeometry(this.geoG, next.scene, m, next.role === 'gm', next.selection ?? null);
    }

    const pk = pinKey(next);
    if (pk !== this.lastPinKey) {
      this.lastPinKey = pk;
      drawPins(
        this.pinG,
        this.pinLabels,
        this.pinLabelPool,
        next.scene,
        m,
        selectedOf(next, 'pin'),
        next.role === 'gm',
      );
    }

    const ck = cameraKey(next);
    if (ck !== this.lastCameraKey) {
      this.lastCameraKey = ck;
      drawCameras(
        this.cameraG,
        this.cameraLabels,
        this.cameraLabelPool,
        next.scene,
        m,
        next.cameraCones,
        selectedOf(next, 'camera'),
        next.role === 'gm',
        next.level ?? 0,
      );
    }

    const nk = noteKey(next);
    if (nk !== this.lastNoteKey) {
      this.lastNoteKey = nk;
      drawNotes(
        this.noteG,
        this.noteLabels,
        this.noteLabelPool,
        next.scene,
        m,
        selectedOf(next, 'note'),
        next.role === 'gm',
      );
    }

    const aoeKey = next.aoe
      ? `${next.aoe.center.x},${next.aoe.center.y},${next.aoe.radiusM}|${next.scatter?.to.x ?? ''},${next.scatter?.to.y ?? ''}`
      : '';
    if (aoeKey !== this.lastAoeKey) {
      this.lastAoeKey = aoeKey;
      this.fx.setAoe(m, next.aoe, next.scatter);
    }

    const draftKey = (next.fogDraft?.points ?? []).map((p) => `${p.x},${p.y}`).join(';');
    if (draftKey !== this.lastFogDraftKey) {
      this.lastFogDraftKey = draftKey;
      this.fx.setFogDraft(m, next.fogDraft);
    }

    this.syncTokens(next);

    if (next.scene.id !== this.framedSceneId) {
      this.framedSceneId = next.scene.id;
      this.fitScene();
    }
  }

  private syncTokens(next: StageSceneState): void {
    const seen = new Set<string>();
    for (const token of next.tokens) {
      seen.add(token.id);
      let view = this.views.get(token.id);
      const fresh = !view;
      if (!view) {
        view = new TokenView();
        this.views.set(token.id, view);
        this.tokenLayer.addChild(view.root);
      }
      view.update(token, {
        selected: next.selectedTokenId === token.id,
        acting: next.actingTokenId === token.id,
        draggable: next.draggableIds.has(token.id),
        bars: next.bars.get(token.id) ?? null,
        // Hidden by its flag or by its layer (FR9.26): the GM sees it faded.
        ghosted: token.hidden || (next.hiddenLayerTokenIds?.has(token.id) ?? false),
        metrics: this.m,
      });
      if (fresh) {
        const at = worldFromGrid(this.m, { x: token.x, y: token.y });
        view.place(at.x, at.y);
      }
      this.loadArt(token, view);
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      view.destroy();
      this.views.delete(id);
      if (this.localDragId === id) this.localDragId = null;
    }
    this.applyTargets();
  }

  private loadArt(token: Token, view: TokenView): void {
    const ref = token.artRef;
    if (!ref) {
      // Clearing a portrait is a real move — a player removing their picture,
      // or a GM taking a disguise off a token. Returning early here left the
      // old sprite on screen until a reload.
      view.clearTexture();
      return;
    }
    const key = `${token.id}:${ref}`;
    if (this.artRequested.has(key)) return;
    this.artRequested.add(key);
    void Assets.load<Texture>(this.opts.urlFor(ref))
      .then((texture) => {
        if (this.disposed || !texture) return;
        const live = this.views.get(token.id);
        if (live === view) view.setTexture(texture);
      })
      .catch(() => {
        // Missing art falls back to the silhouette circle — never fatal.
      });
  }

  /**
   * Lerp targets: a remote interim drag wins over the last persisted position
   * (smooth motion for watchers, §11), and the locally dragged token is
   * pointer-driven so it echoes at render framerate.
   */
  private applyTargets(): void {
    for (const token of this.sceneState.tokens) {
      const view = this.views.get(token.id);
      if (!view) continue;
      if (token.id === this.localDragId) {
        view.localDrag = true;
        if (this.localDragWorld) view.place(this.localDragWorld.x, this.localDragWorld.y);
        continue;
      }
      view.localDrag = false;
      const ghost = this.drags[token.id];
      // A relay that stopped mid-drag (dropped socket) must not pin the token
      // off its authoritative position forever.
      const fresh = ghost && (ghost.ts === undefined || Date.now() - ghost.ts < GHOST_TTL_MS);
      const at = worldFromGrid(this.m, fresh && ghost ? ghost : { x: token.x, y: token.y });
      view.targetX = at.x;
      view.targetY = at.y;
    }
  }

  setDrags(drags: Record<string, { x: number; y: number; ts?: number }>): void {
    this.drags = drags;
    this.applyTargets();
  }

  flashPing(x: number, y: number): void {
    const at = worldFromGrid(this.m, { x, y });
    this.fx.ping(at.x, at.y);
  }

  trail(x: number, y: number): void {
    const at = worldFromGrid(this.m, { x, y });
    this.fx.trailPoint(at.x, at.y);
  }

  setRulerThresholds(t: MovementThresholds | null): void {
    this.thresholds = t;
  }

  centerOn(x: number, y: number): void {
    if (this.disposed) return;
    const at = worldFromGrid(this.m, { x, y });
    this.camera.centerOn(at.x, at.y, this.viewport());
  }

  zoomBy(factor: number): void {
    if (this.disposed) return;
    const v = this.viewport();
    this.camera.zoomAt(v.width / 2, v.height / 2, factor);
  }

  fitScene(): void {
    if (this.disposed) return;
    const { width, height } = sceneWorldSize(this.m);
    this.camera.fit(width, height, this.viewport());
  }

  /**
   * The canvas size, or the host's when the renderer is not there to ask.
   *
   * `app.screen` reaches through `app.renderer`, which is null once the app
   * is destroyed — and a stage handle outlives its app for as long as React
   * takes to notice a scene switch. A camera call in that window used to be a
   * TypeError that unmounted the whole page; now it is a no-op, because the
   * public methods above check `disposed` first and this falls back if
   * anything else gets here.
   */
  private viewport(): { width: number; height: number } {
    const screen = this.disposed ? null : this.app.renderer ? this.app.screen : null;
    if (screen && screen.width > 0) return { width: screen.width, height: screen.height };
    const rect = this.opts.host.getBoundingClientRect();
    return { width: rect.width || 800, height: rect.height || 600 };
  }

  // -- frame -----------------------------------------------------------------

  private frame(deltaMS: number): void {
    if (this.camera.dirty) {
      this.world.x = this.camera.x;
      this.world.y = this.camera.y;
      this.world.scale.set(this.camera.scale);
      this.camera.dirty = false;
    }
    for (const view of this.views.values()) view.tick(deltaMS);
    this.fx.tick(deltaMS);
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pointer?.destroy();
    this.resizeObserver?.disconnect();
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
    for (const label of this.fogLabelPool.values()) label.destroy();
    this.fogLabelPool.clear();
    for (const label of this.pinLabelPool.values()) label.destroy();
    this.pinLabelPool.clear();
    this.map.destroy();
    this.fx.destroy();
    try {
      this.app.destroy(true, { children: true });
    } catch {
      // renderer already torn down (fast unmount in dev StrictMode)
    }
  }
}

/** Build and mount the stage. Awaited by `useStage`'s dynamic import. */
export async function createStage(opts: StageOptions): Promise<StageApi> {
  // Every stage — the GM's Grid, a player's phone, the table TV — loads art
  // through this one door, so the file store's extension-less URLs are made
  // parser-safe here rather than per feature (see `assetUrl.ts`).
  const stage = new Stage({
    ...opts,
    urlFor: parserSafeUrlFor(opts.urlFor, Assets as unknown as AssetRegistry),
  });
  await stage.init();
  return stage;
}
