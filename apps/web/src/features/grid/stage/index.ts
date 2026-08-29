/**
 * The PixiJS scene stage (lazy chunk — the only module tree that imports
 * `pixi.js`, per D9 / NFR "Bundle").
 *
 * 60fps discipline: ONE ticker, one camera transform flush per frame, pooled
 * TokenViews and pooled fx graphics, and layer redraws keyed on content hashes
 * so a pan/zoom or a token move never re-tessellates the grid, fog or geometry.
 */
import { Application, Assets, Container, Graphics, Text, type Texture } from 'pixi.js';
import type { Point, Token } from '@safehouse/contracts';
import {
  metricsFor,
  metricsKey,
  sceneWorldSize,
  worldFromGrid,
  type SceneMetrics,
} from '../geometry.js';
import type { MovementThresholds, StageApi, StageOptions, StageSceneState } from '../types.js';
import { parserSafeUrlFor, type AssetRegistry } from './assetUrl.js';
import { Camera } from './camera.js';
import { C } from './colors.js';
import { FxLayer } from './fx.js';
import { drawFog, drawGeometry, drawGrid, drawPins } from './layers.js';
import { MapLayer } from './mapLayer.js';
import { PointerController, type PointerHost } from './pointer.js';
import { TokenView } from './tokenView.js';

/** How long an un-terminated remote drag ghost keeps overriding a position. */
const GHOST_TTL_MS = 4000;

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
    // Endpoints, not just counts: editing a wall in place must redraw it.
    geo.walls.map((w) => `${w.id}:${w.a.x},${w.a.y},${w.b.x},${w.b.y}`).join(','),
    geo.zones.map((z) => `${z.id}:${z.name}:${z.color ?? ''}:${z.polygon.length}`).join(','),
    geo.doors.map((d) => `${d.id}:${d.open ? 1 : 0}:${d.a.x},${d.a.y},${d.b.x},${d.b.y}`).join(','),
  ].join('|');
}

/** Pins redraw on any label/position/visibility edit, and on selection. */
function pinKey(state: StageSceneState): string {
  const geo = state.scene.geometry;
  return [
    state.role === 'gm' ? 'gm' : 'pc',
    state.selectedPinId ?? '',
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
  private readonly gridG = new Graphics();
  private readonly geoG = new Graphics();
  private readonly fogG = new Graphics();
  private readonly fogLabels = new Container();
  private readonly fogLabelPool = new Map<string, Text>();
  private readonly pinG = new Graphics();
  private readonly pinLabels = new Container();
  private readonly pinLabelPool = new Map<string, Text>();
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
      this.gridG,
      this.geoG,
      this.pinG,
      this.pinLabels,
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
        this.pointer?.invalidateRect();
        this.camera.dirty = true;
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

  // -- StageApi --------------------------------------------------------------

  update(next: StageSceneState): void {
    this.sceneState = next;
    const m = metricsFor(next.scene.grid);
    this.m = m;

    const mk = metricsKey(m);
    if (mk !== this.lastMetricsKey) {
      this.lastMetricsKey = mk;
      drawGrid(this.gridG, m);
      this.map.fitAll(m, next.scene.mapAttachmentIds.length === 0);
      this.lastFogKey = ''; // fog/geometry/pins are metric-dependent
      this.lastGeoKey = '';
      this.lastPinKey = '';
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
      drawGeometry(this.geoG, next.scene, m, next.role === 'gm');
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
        next.selectedPinId ?? null,
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
        ghosted: token.hidden,
        cell: this.m.cell,
        unitM: this.m.unitM,
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
    if (!ref) return;
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
    const at = worldFromGrid(this.m, { x, y });
    this.camera.centerOn(at.x, at.y, this.viewport());
  }

  zoomBy(factor: number): void {
    const v = this.viewport();
    this.camera.zoomAt(v.width / 2, v.height / 2, factor);
  }

  fitScene(): void {
    const { width, height } = sceneWorldSize(this.m);
    this.camera.fit(width, height, this.viewport());
  }

  private viewport(): { width: number; height: number } {
    const screen = this.app.screen;
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
