/**
 * The tokens of a live 3D map, as figures (P1 of the move to 3D).
 *
 * `lab3d/figure3d.ts` builds one figure from one token; this is the pool a map
 * keeps of them. A figure is made when its token arrives, freed when it
 * leaves, and REBUILT only when what it looks like changes: its look (the
 * inputs `lookFor` reads — id, source, name, `token.look`), its size, the pose
 * it is drawn in (its own, or down when a condition monitor fills —
 * `downedBy`, the same rule the 2D badge and figure use), and whether the GM
 * sees it ghosted. A move, a selection, a turn at acting: none of those touch
 * geometry.
 *
 * Around each figure, flat on its floor and unlit, so they read the same in a
 * dark room as in a lit one:
 *   - a soft blob of shadow under it. Figures cast no shadow maps (a lamp's
 *     shadow map re-rendered for every step a runner takes is what the plan
 *     ruled out); the blob is the contact shadow instead, on every quality;
 *   - a cyan ring when selected;
 *   - an amber ring while it is the one acting. It holds still: the breath
 *     is the plate's (`badges.ts`), a Web Animation on the compositor. A
 *     ring breathing here would keep the whole lit scene drawing at the
 *     display's rate for as long as an encounter runs;
 *   - its aura, when it has one: `aura.radiusM` across the floor in its
 *     colour, a faint fill and a firmer edge, as the 2D map draws it.
 * A ghosted figure (the GM's view of a hidden token) is drawn see-through, in
 * one pair of materials shared by every figure of its kind (below): ghosting
 * costs nothing a frame.
 *
 * Motion is the 2D figure's (`tokenView.ts` `tick`): a figure glides to where
 * it should be — its token's square, or a drag ghost the stage points it at
 * (`setTarget`) — at a walking pace of at least `WALK_SQUARES_PER_S`, quicker
 * over a long move so a dash across the map does not lag behind; it turns to
 * face the way it goes and keeps that facing when it stops. There is no walk
 * cycle yet (P6): figures glide and turn.
 *
 * World units are the lab's: x = grid x, z = grid y, y up in squares, floor
 * `L` at y = L × storey.
 *
 * Two kinds of figure share the pool, kept apart by `sync`'s two lists:
 *   - the floor in view's own, which everything above is about;
 *   - the ones seen down through its open squares (the stage's
 *     `belowTokens`), stood on their own floors below, inside the shade the
 *     runtime lays over those floors, as the 2D map's `BelowFloors` draws
 *     them. They are looked at, never worked: no rings, no plate
 *     (`positionOf` gives none), no drag or drag ghost, and the pointer never
 *     takes them (`pick`) — the GM works on them from their own floor. A
 *     token that crosses between the two (the view goes up a floor, a runner
 *     drops through a hatch) keeps its figure: only its part changes.
 *
 * The two kinds wear different covers (`cover.ts`), after the 2D map's layers:
 * the floor in view's figures lie over its sightline shroud and under its
 * fog, as its tokens do; the 2D map draws the floors below under its shroud,
 * so a figure seen below is darkened outside the viewer's sightline too.
 * Each kind has its own set of materials (the pool's `inView` and `seenBelow`
 * looks), and a figure crossing between the two is built again in the other.
 *
 * Nothing here asks for frames. The stage adds `group` to the runtime's scene
 * and wires `tick` as a runtime before-frame hook, which keeps frames coming
 * for exactly as long as `tick` says something is moving or turning; after
 * changing anything here from outside, the stage asks the runtime for a frame.
 */
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Vector3,
  type MeshStandardMaterial,
  type Object3D,
  type Raycaster,
} from 'three';
import type { Point, Token, TokenAura } from '@safehouse/contracts';
import type { TokenBars } from '../types.js';
import { C, parseColor } from '../stage/colors.js';
import type { FigurePose } from '../stage/figure.js';
import { downedBy, tokenPose, WALK_SQUARES_PER_S } from '../stage/tokenState.js';
import { buildFigure, disposeFigure, type FigureCtx } from '../../lab3d/figure3d.js';
import type { LabMaterials } from '../../lab3d/geometry3d.js';
import { applyCover, coverModeOf, type CoverMode } from './cover.js';

/**
 * One token as the pool (and the plates, `badges.ts`) draws it: the stage's
 * view of it at this update.
 */
export interface FigureState {
  token: Token;
  /** Its condition monitors, where this view may see them: a full one draws it down. */
  bars: TokenBars | null;
  selected: boolean;
  acting: boolean;
  /** The GM's view of a hidden token (by its flag or its layer): drawn see-through. */
  ghosted: boolean;
  /** The floor it stands on — `token.level`, as the stage clamps it to the scene's floors. */
  level: number;
}

/** A long move goes quicker than a walk: this many times the distance left, per second (the 2D figure's). */
const LONG_MOVE_PACE = 2.2;
/** Closer than this to its target, in squares, a figure has arrived. */
const ARRIVED = 0.005;
/** How fast a figure turns to face its way, radians per millisecond (the 2D figure's). */
const TURN_PER_MS = 0.014;
/** Close enough to its facing to stop turning, radians. */
const FACED = 1e-3;
/** A frame gap longer than this (a tab left in the background) is taken as this, in ms. */
const MAX_STEP_MS = 250;
/** Facing when a token has never been turned: toward the iso camera, as the 2D figure starts. */
const TOWARD_VIEWER = Math.PI / 4;

/**
 * How far above its floor each flat thing lies, in squares: over the floor and
 * the decals on it (rugs float 0.01 a layer), the shadow lowest and the rings
 * on top. Polygon offset settles what the lift alone would not.
 */
const BLOB_LIFT = 0.03;
const AURA_LIFT = 0.036;
const RING_LIFT = 0.042;
/** The selection ring's radius per √size, in squares: the 2D iso ring's. */
const RING_R = 0.42;
const RING_HALF_W = 0.03;
/** The acting ring stands this far outside the selection ring, a little bolder. */
const ACT_GAP = 0.1;
const ACT_HALF_W = 0.045;
const AURA_EDGE_HALF_W = 0.035;
const AURA_FILL_ALPHA = 0.07;
const AURA_EDGE_ALPHA = 0.55;
const RING_ALPHA = 0.9;
const BLOB_ALPHA = 0.5;
const GHOST_ALPHA = 0.4;
/** Room round a figure's body in which the pointer still takes it, in squares: limbs are thin. */
const PICK_PAD = 0.12;
/** The smallest a pick box is across, per √size, in squares. */
const PICK_MIN = 0.45;
/** Between the crown and the point a plate hangs from, in squares. */
const HEAD_GAP = 0.08;
/** A standing human, metres: the fallback height when a figure could not be built. */
const HUMAN_M = 1.8;

/** A ring flat on the floor (in the xz plane, facing up), centred on the origin. */
function flatRing(inner: number, outer: number, segments = 48): BufferGeometry {
  return new RingGeometry(Math.max(0.001, inner), Math.max(inner + 0.002, outer), segments).rotateX(-Math.PI / 2);
}

/** A disc flat on the floor, centred on the origin. */
function flatDisc(r: number, segments = 64): BufferGeometry {
  return new CircleGeometry(Math.max(0.001, r), segments).rotateX(-Math.PI / 2);
}

/**
 * The material for a flat mark: unlit and untouched by tone mapping, so the
 * cyan is the app's cyan; see-through, writing no depth, pulled toward the
 * camera so the floor under it never wins. Under the cover the figure it
 * belongs to wears (`cover.ts`): by default the fog alone, over the shroud,
 * like the token it rings.
 */
function flatMaterial(color: number, opacity: number, cover: CoverMode = 'fog'): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  applyCover(m, cover);
  return m;
}

/**
 * What one kind of figure is drawn with (see the module note): the lab's
 * materials for the body, their see-through twins for a ghost, and the blob
 * shadow's — all under one cover.
 */
interface FigureLook {
  readonly lab: LabMaterials;
  readonly ghostSolid: MeshStandardMaterial;
  readonly ghostGlow: MeshStandardMaterial;
  readonly blob: MeshBasicMaterial;
  /** The cover they wear, which the aura's materials take too. */
  readonly cover: CoverMode;
}

/** A soft round shadow: black, its alpha falling off from the middle to nothing at the rim. */
function blobTexture(): DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const dx = ((i + 0.5) / n) * 2 - 1;
      const dy = ((j + 0.5) / n) * 2 - 1;
      const r2 = Math.min(1, dx * dx + dy * dy);
      data[(j * n + i) * 4 + 3] = Math.round((1 - r2) ** 2 * 255);
    }
  }
  const tex = new DataTexture(data, n, n);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** An angle brought into (-π, π]. */
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** A token's `rotation` (degrees, 0 east, 90 south) as a facing in grid radians. */
function facingOf(rotation: number): number {
  return (rotation * Math.PI) / 180;
}

/** What `lookFor` reads from a token: the same inputs, the same look (as the 2D figure keys it). */
function lookKey(token: Token): string {
  return `${token.id}|${token.source}|${token.name}|${JSON.stringify(token.look ?? null)}`;
}

/** One token's figure and everything round it. */
interface Figure {
  readonly id: string;
  /** At the figure's feet on its floor, unturned: carries `userData.tokenId` and `userData.level`. */
  readonly root: Group;
  /** Turned to the figure's facing: the body, its pick box and its shadow. */
  readonly turn: Group;
  /** The built figure; null when the builder could not make sense of the token. */
  body: Group | null;
  /** The box the pointer hits: never drawn, sized to the body plus `PICK_PAD`. */
  readonly proxy: Mesh;
  readonly blob: Mesh;
  readonly select: Mesh;
  readonly act: Mesh;
  aura: { fill: Mesh; edge: Mesh } | null;
  /**
   * Seen from the floor in view down through its open squares rather than
   * standing on it: shown on its own floor below, never ringed, plated,
   * pointed elsewhere or picked.
   */
  below: boolean;
  /** The state it was last synced with. */
  state: FigureState;
  /** The look signature it was built for. */
  sig: string;
  pose: FigurePose;
  /** The token size the rings were drawn for. */
  ringSize: number;
  /** What the aura was drawn for; '' when none is. */
  auraKey: string;
  level: number;
  /** Where the figure stands now, in grid units. */
  x: number;
  y: number;
  /** Which way it faces and which way it is turning to, grid radians (0 east, π/2 south). */
  facing: number;
  want: number;
  /** The token's `rotation` as last seen, to notice it change. */
  rotation: number;
  /** The top of the body above its feet, in squares. */
  crown: number;
  /** Over its head, where its plate hangs — kept up to date, handed out by `positionOf`. */
  readonly head: Vector3;
}

/**
 * The tokens of a live map as 3D figures: made, rebuilt and freed by `sync`,
 * moved by `tick`, shown a floor at a time by `setLevel`, hit by `pick`.
 */
export class FigurePool {
  /** Every figure, ring and shadow. The stage adds it to the runtime's scene. */
  readonly group = new Group();

  private ctx: { unitM: number; storey: number };
  private readonly figures = new Map<string, Figure>();
  /** Where the stage has pointed a figure other than its token's square (a drag ghost). */
  private readonly overrides = new Map<string, Point>();
  private level = 0;
  private disposed = false;

  // Shared by every figure: one of each, freed with the pool.
  private readonly pickBox = new BoxGeometry(1, 1, 1);
  private readonly pickMaterial = new MeshBasicMaterial({ visible: false });
  private readonly blobPlane: BufferGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly blobMap = blobTexture();
  private readonly selectMaterial = flatMaterial(C.cyan, RING_ALPHA);
  /** Shared by every acting ring. Steady: the plate over the head carries the breath. */
  private readonly actMaterial = flatMaterial(C.warn, RING_ALPHA);
  /** Keyed by cover and colour: an aura seen below wears the figure's cover below. */
  private readonly auraMaterials = new Map<string, { fill: MeshBasicMaterial; edge: MeshBasicMaterial }>();
  /** What the floor in view's figures are drawn with. */
  private readonly inView: FigureLook;
  /** What the figures seen below are drawn with: `inView` itself when the stage gave one set. */
  private readonly seenBelow: FigureLook;

  /**
   * `materials` draw the floor in view's figures; `belowMaterials` the ones
   * seen below it, under the cover those wear (see the module note) — the
   * same set when not given. The stage owns both sets and frees them.
   */
  constructor(materials: LabMaterials, ctx: FigureCtx, belowMaterials: LabMaterials = materials) {
    this.ctx = { unitM: ctx.unitM > 0 ? ctx.unitM : 1, storey: ctx.storey };
    this.group.name = 'stage-figures';
    this.inView = this.lookOf(materials);
    this.seenBelow = belowMaterials === materials ? this.inView : this.lookOf(belowMaterials);
  }

  /** The ghost and blob materials that go with a set of the lab's, under the cover that set wears. */
  private lookOf(lab: LabMaterials): FigureLook {
    const cover = coverModeOf(lab.solid) ?? 'fog';
    const blob = new MeshBasicMaterial({
      color: 0x000000,
      map: this.blobMap,
      transparent: true,
      opacity: BLOB_ALPHA,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    applyCover(blob, cover);
    // The lab's own materials, see-through, under the same cover as they are
    // (`cover.ts`), which a clone does not copy. The glow keeps its shader
    // patch (its vertex colour is its emissive colour, and the cover is
    // wrapped round it) with the program key that says so; handed to
    // `applyCover` only to be counted among the cover's wearers.
    const ghostSolid = lab.solid.clone();
    applyCover(ghostSolid, cover);
    ghostSolid.transparent = true;
    ghostSolid.opacity = GHOST_ALPHA;
    ghostSolid.depthWrite = false;
    const ghostGlow = lab.glow.clone();
    ghostGlow.onBeforeCompile = lab.glow.onBeforeCompile;
    ghostGlow.customProgramCacheKey = lab.glow.customProgramCacheKey;
    ghostGlow.transparent = true;
    ghostGlow.opacity = GHOST_ALPHA;
    ghostGlow.depthWrite = false;
    applyCover(ghostGlow, cover);
    return { lab, ghostSolid, ghostGlow, blob, cover };
  }

  /** The look a figure is drawn in, by which kind it is. */
  private lookFor(f: Figure): FigureLook {
    return f.below ? this.seenBelow : this.inView;
  }

  /**
   * Bring the figures in line with the tokens: make the new ones, free the
   * gone ones, rebuild one only when its look signature changed, and update
   * everything else (rings, aura, floor, where it is headed) in place. A new
   * figure starts on its token's square.
   *
   * `states` are the tokens on the floor in view; `below` the ones seen down
   * through its open squares, each at the floor it stands on. Both lists are
   * taken at once so a token that moved from one to the other in this update
   * keeps its figure. Should a token be in both, the floor in view wins.
   */
  sync(states: ReadonlyArray<FigureState>, below: ReadonlyArray<FigureState> = []): void {
    if (this.disposed) return;
    const seen = new Set<string>();
    for (const s of below) this.take(s, true, seen);
    for (const s of states) this.take(s, false, seen);
    for (const [id, f] of this.figures) {
      if (seen.has(id)) continue;
      this.drop(f);
      this.figures.delete(id);
      this.overrides.delete(id);
    }
  }

  /**
   * Point a figure somewhere other than its token's square — a drag ghost,
   * the local drag's pointer — and it glides there. Null sends it back to its
   * token's own square. May be called before the token's first `sync`.
   */
  setTarget(tokenId: string, grid: Point | null): void {
    if (this.disposed) return;
    if (grid) this.overrides.set(tokenId, { x: grid.x, y: grid.y });
    else this.overrides.delete(tokenId);
  }

  /**
   * Put a figure at `grid` at once, still facing as it was (a drop, a token
   * that arrived by other means). If its target is elsewhere it glides on
   * from there.
   */
  jump(tokenId: string, grid: Point): void {
    const f = this.figures.get(tokenId);
    if (!f || this.disposed) return;
    f.x = grid.x;
    f.y = grid.y;
    this.place(f);
  }

  /**
   * Advance every figure's glide and turn by `dtMs`. True while anything is
   * still moving or turning — the runtime then draws another frame. Nothing
   * else here animates, so a map where nobody moves goes idle, mid-fight too.
   */
  tick(dtMs: number): boolean {
    if (this.disposed) return false;
    const dt = Math.max(0, Math.min(dtMs, MAX_STEP_MS));
    let busy = false;
    for (const f of this.figures.values()) {
      const t = this.targetOf(f);
      const dx = t.x - f.x;
      const dy = t.y - f.y;
      const rem = Math.hypot(dx, dy);
      let moved = rem > 0;
      if (moved) {
        if (rem < ARRIVED) {
          f.x = t.x;
          f.y = t.y;
        } else {
          busy = true;
          const pace = Math.max(WALK_SQUARES_PER_S, rem * LONG_MOVE_PACE);
          const step = Math.min(rem, (pace * dt) / 1000);
          f.x += (dx / rem) * step;
          f.y += (dy / rem) * step;
          // Down is down: a figure dragged while down slides, it does not turn.
          if (f.pose !== 'down') f.want = Math.atan2(dy, dx);
        }
      }
      if (f.pose === 'down') f.want = f.facing;
      const turn = wrapAngle(f.want - f.facing);
      if (Math.abs(turn) > FACED) {
        const max = dt * TURN_PER_MS;
        f.facing = wrapAngle(f.facing + Math.max(-max, Math.min(max, turn)));
        busy = true;
        moved = true;
      }
      if (moved) this.place(f);
    }
    return busy;
  }

  /**
   * Floor `level` is in view: its own figures show, and the ones seen below
   * it on their floors beneath; anything else (a figure left on another
   * floor until the next `sync` moves it) hides.
   */
  setLevel(level: number): void {
    if (this.disposed) return;
    this.level = level;
    for (const f of this.figures.values()) f.root.visible = this.shows(f.level, f.below);
  }

  /**
   * A new scale or storey (the scene's `unitM` changed): every figure is
   * rebuilt at the new size and stood on its floor's new height.
   */
  setContext(ctx: FigureCtx): void {
    if (this.disposed) return;
    const unitM = ctx.unitM > 0 ? ctx.unitM : 1;
    if (unitM === this.ctx.unitM && ctx.storey === this.ctx.storey) return;
    this.ctx = { unitM, storey: ctx.storey };
    for (const f of this.figures.values()) {
      f.sig = '';
      f.auraKey = '';
      this.apply(f, f.state);
    }
  }

  /**
   * The token whose figure the ray meets first, of those on show; null for
   * none. Each figure is hit by a box round its body a little larger than it
   * (`PICK_PAD`), so a thin arm or a figure seen from straight above is
   * still easy to take hold of. `may`, when given, says which tokens the
   * pointer may take at all: the others are passed through, so one it may
   * not take (a player's view of one under the fog, which is not drawn) never
   * stands in front of one it may.
   */
  pick(raycaster: Raycaster, may?: (tokenId: string) => boolean): string | null {
    if (this.disposed) return null;
    const targets: Object3D[] = [];
    // A figure seen below is never taken from here: the 2D map's rule.
    for (const f of this.figures.values()) {
      if (f.root.visible && !f.below && (may === undefined || may(f.id))) targets.push(f.proxy);
    }
    if (targets.length === 0) return null;
    // Moved since the last frame drew them: bring the matrices up to date first.
    this.group.updateMatrixWorld(true);
    const id: unknown = raycaster.intersectObjects(targets, false)[0]?.object.userData.tokenId;
    return typeof id === 'string' ? id : null;
  }

  /**
   * Just over the head of a token's figure where it stands now, in world
   * units — where its plate hangs. Null when it has no figure, its figure
   * is not on show, or it is seen below (those carry no plate). The vector
   * is the pool's own, updated as the figure moves: read it, do not keep or
   * change it.
   */
  positionOf(tokenId: string): Vector3 | null {
    const f = this.figures.get(tokenId);
    return f && f.root.visible && !f.below && !this.disposed ? f.head : null;
  }

  /** Free every figure and everything the pool made, and take the group out of the scene. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const f of this.figures.values()) this.drop(f);
    this.figures.clear();
    this.overrides.clear();
    this.pickBox.dispose();
    this.pickMaterial.dispose();
    this.blobPlane.dispose();
    this.blobMap.dispose();
    this.selectMaterial.dispose();
    this.actMaterial.dispose();
    for (const m of this.auraMaterials.values()) {
      m.fill.dispose();
      m.edge.dispose();
    }
    this.auraMaterials.clear();
    // The lab's sets are the stage's; the ghosts and blobs made for them are the pool's.
    for (const look of new Set([this.inView, this.seenBelow])) {
      look.blob.dispose();
      look.ghostSolid.dispose();
      look.ghostGlow.dispose();
    }
    this.group.removeFromParent();
  }

  // --- one figure ----------------------------------------------------------

  /**
   * Whether a figure on floor `level` is on show with this floor in view:
   * one of the floor's own stands on it; one seen below stands under it.
   */
  private shows(level: number, below: boolean): boolean {
    return below ? level < this.level : level === this.level;
  }

  /** Make or update the figure for `s`, as one of the floor in view's own or as one seen below it (`below`). */
  private take(s: FigureState, below: boolean, seen: Set<string>): void {
    const id = s.token.id;
    seen.add(id);
    let f = this.figures.get(id);
    if (!f) {
      f = this.create(s, below);
      this.figures.set(id, f);
    }
    // Nothing points a figure seen below anywhere but its token's square; a
    // drag ghost it carried off the floor in view goes with it.
    if (below) this.overrides.delete(id);
    f.below = below;
    this.apply(f, s);
  }

  private create(s: FigureState, below: boolean): Figure {
    const id = s.token.id;
    const root = new Group();
    root.name = `token:${id}`;
    root.userData.tokenId = id;
    root.userData.level = s.level;
    root.visible = this.shows(s.level, below);
    const turn = new Group();
    root.add(turn);

    const proxy = new Mesh(this.pickBox, this.pickMaterial);
    proxy.visible = false;
    proxy.userData.tokenId = id;
    turn.add(proxy);

    const blob = new Mesh(this.blobPlane, (below ? this.seenBelow : this.inView).blob);
    blob.position.y = BLOB_LIFT;
    blob.renderOrder = 1;
    turn.add(blob);

    // Empty until `fitRings` sizes them, which the first `apply` does.
    const select = new Mesh(new BufferGeometry(), this.selectMaterial);
    select.position.y = RING_LIFT;
    select.renderOrder = 2;
    select.visible = false;
    const act = new Mesh(new BufferGeometry(), this.actMaterial);
    act.position.y = RING_LIFT;
    act.renderOrder = 2;
    act.visible = false;
    root.add(select, act);

    const rotation = s.token.rotation ?? 0;
    const facing = rotation ? facingOf(rotation) : TOWARD_VIEWER;
    this.group.add(root);
    return {
      id,
      root,
      turn,
      body: null,
      proxy,
      blob,
      select,
      act,
      aura: null,
      below,
      state: s,
      sig: '',
      pose: 'stand',
      ringSize: Number.NaN,
      auraKey: '',
      level: s.level,
      x: s.token.x,
      y: s.token.y,
      facing,
      want: facing,
      rotation,
      crown: HUMAN_M / this.ctx.unitM,
      head: new Vector3(),
    };
  }

  /** Bring one figure in line with its state; its body is rebuilt only for a new look signature. */
  private apply(f: Figure, s: FigureState): void {
    const token = s.token;
    const pose = tokenPose(token, downedBy(s.bars));
    const size = token.size > 0 ? token.size : 1;
    // Which kind it is only matters to its body where the two kinds wear different covers.
    const part = this.seenBelow !== this.inView && f.below ? 'below' : '';
    const sig = `${lookKey(token)}|${size}|${pose}|${s.ghosted ? 1 : 0}|${part}`;
    f.state = s;
    if (sig !== f.sig) {
      f.sig = sig;
      f.pose = pose;
      this.build(f);
    }
    if (size !== f.ringSize) this.fitRings(f, size);
    this.fitAura(f, token.aura ?? null);
    // Seen below, a figure is never selected or acting from here (2D's rule).
    f.select.visible = s.selected && !f.below;
    f.act.visible = s.acting && !f.below;

    // A token turned by hand (or by a move landing) faces its new way — once
    // it has stopped; while it glides, the way it goes wins.
    const rotation = token.rotation ?? 0;
    if (rotation !== f.rotation) {
      f.rotation = rotation;
      const t = this.targetOf(f);
      if (Math.hypot(t.x - f.x, t.y - f.y) < ARRIVED) f.want = facingOf(rotation);
    }

    if (s.level !== f.level) {
      f.level = s.level;
      f.root.userData.level = s.level;
    }
    // Its floor, or which part it plays (`take`), may have changed.
    f.root.visible = this.shows(f.level, f.below);
    this.place(f);
  }

  /** (Re)build the body for the figure's state and pose, and fit its pick box, shadow and plate height to it. */
  private build(f: Figure): void {
    if (f.body) {
      disposeFigure(f.body);
      f.body = null;
    }
    const s = f.state;
    const size = s.token.size > 0 ? s.token.size : 1;
    const look = this.lookFor(f);
    let body: Group | null = null;
    try {
      body = buildFigure(s.token, look.lab, { unitM: this.ctx.unitM, storey: this.ctx.storey, pose: f.pose });
    } catch (err) {
      // One token the builder cannot make sense of costs that figure, not the map.
      console.warn(`[stage3d] token ${s.token.id} could not be built as a figure`, err);
    }
    f.blob.material = look.blob;
    const box = new Box3();
    if (body) {
      body.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.castShadow = false;
        if (s.ghosted) {
          if (o.material === look.lab.solid) o.material = look.ghostSolid;
          else if (o.material === look.lab.glow) o.material = look.ghostGlow;
        }
        const g = o.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        if (g.boundingBox) box.union(g.boundingBox);
      });
      f.turn.add(body);
      f.body = body;
    }
    if (box.isEmpty()) {
      // No body: a figure-sized box still takes the pointer and carries a plate.
      const h = (HUMAN_M / this.ctx.unitM) * Math.sqrt(size);
      box.set(new Vector3(-0.2, 0, -0.2), new Vector3(0.2, h, 0.2));
    }

    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const w = box.max.x - box.min.x;
    const d = box.max.z - box.min.z;
    const minPick = PICK_MIN * Math.sqrt(size);
    f.proxy.position.set(cx, (box.min.y + box.max.y) / 2, cz);
    f.proxy.scale.set(Math.max(minPick, w + 2 * PICK_PAD), Math.max(0.1, box.max.y - box.min.y + PICK_PAD), Math.max(minPick, d + 2 * PICK_PAD));

    const minBlob = 0.55 * Math.sqrt(size);
    const maxBlob = 1.4 * size;
    f.blob.position.set(cx, BLOB_LIFT, cz);
    f.blob.scale.set(Math.min(maxBlob, Math.max(minBlob, w * 1.25)), 1, Math.min(maxBlob, Math.max(minBlob, d * 1.25)));
    // A ghost casts no shadow.
    f.blob.visible = !s.ghosted;

    f.crown = box.max.y;
  }

  /** The selection and acting rings, sized to the token. */
  private fitRings(f: Figure, size: number): void {
    f.ringSize = size;
    const r = RING_R * Math.sqrt(size);
    f.select.geometry.dispose();
    f.select.geometry = flatRing(r - RING_HALF_W, r + RING_HALF_W);
    f.act.geometry.dispose();
    f.act.geometry = flatRing(r + ACT_GAP - ACT_HALF_W, r + ACT_GAP + ACT_HALF_W);
  }

  /** The aura, redrawn only when its radius, colour or the scale changed, or the figure's cover (its kind). */
  private fitAura(f: Figure, aura: TokenAura | null): void {
    const cover = this.lookFor(f).cover;
    const key = aura ? `${aura.radiusM}|${aura.color ?? ''}|${this.ctx.unitM}|${cover}` : '';
    if (key === f.auraKey) return;
    f.auraKey = key;
    if (f.aura) {
      f.aura.fill.geometry.dispose();
      f.aura.edge.geometry.dispose();
      f.aura.fill.removeFromParent();
      f.aura.edge.removeFromParent();
      f.aura = null;
    }
    if (!aura) return;
    const r = aura.radiusM / this.ctx.unitM;
    const mats = this.auraMaterialsFor(parseColor(aura.color, C.magenta), cover);
    const segments = Math.min(128, Math.max(48, Math.round(r * 12)));
    const fill = new Mesh(flatDisc(r, segments), mats.fill);
    const edge = new Mesh(flatRing(r - AURA_EDGE_HALF_W, r + AURA_EDGE_HALF_W, segments), mats.edge);
    fill.position.y = AURA_LIFT;
    edge.position.y = AURA_LIFT;
    fill.renderOrder = 1;
    edge.renderOrder = 2;
    f.root.add(fill, edge);
    f.aura = { fill, edge };
  }

  private auraMaterialsFor(color: number, cover: CoverMode): { fill: MeshBasicMaterial; edge: MeshBasicMaterial } {
    const key = `${cover}|${color}`;
    let m = this.auraMaterials.get(key);
    if (!m) {
      m = { fill: flatMaterial(color, AURA_FILL_ALPHA, cover), edge: flatMaterial(color, AURA_EDGE_ALPHA, cover) };
      this.auraMaterials.set(key, m);
    }
    return m;
  }

  /** Where a figure is headed: the stage's point for it, else its token's square (always, for one seen below). */
  private targetOf(f: Figure): Point {
    return (f.below ? undefined : this.overrides.get(f.id)) ?? f.state.token;
  }

  /** Stand the figure where it now is, turned as it now faces, and move its plate point with it. */
  private place(f: Figure): void {
    const y = f.level * this.ctx.storey;
    f.root.position.set(f.x, y, f.y);
    // three turns +x toward -z for a positive angle about y; the grid's π/2 is +z.
    f.turn.rotation.y = -f.facing;
    f.head.set(f.x, y + f.crown + HEAD_GAP, f.y);
  }

  private drop(f: Figure): void {
    if (f.body) disposeFigure(f.body);
    f.body = null;
    f.select.geometry.dispose();
    f.act.geometry.dispose();
    if (f.aura) {
      f.aura.fill.geometry.dispose();
      f.aura.edge.geometry.dispose();
    }
    f.aura = null;
    f.root.removeFromParent();
  }
}
