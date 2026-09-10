/**
 * Tile swatches drawn by the canvas's own renderer (docs/UX_MAP_BUILDER.md
 * §3.5): a square of the material as it will actually look on the map, not a
 * coloured dot beside a name. Fitts's Law on the most-clicked target in the
 * builder — and Similarity: what is in the palette is what lands on the floor.
 *
 * Every tile of a set gets a three-by-three cell scene with the tile in the
 * middle — the set's floor all round, and for a wall a wall either side so
 * its joins draw. The scenes are laid out on one sheet, a cell apart so no
 * wall run leaks into its neighbour, put through the same `drawTiles` the
 * canvas uses, and read back ONCE per set: reading pixels back from the GPU
 * is the slow part, and one readback for twenty-four tiles is a fraction of
 * twenty-four. Each swatch is then a window onto the cached sheet.
 *
 * Anything that cannot render (no WebGL, a server render, a test) shows the
 * two-colour CSS swatch the palette had before, so the palette never waits.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { Scene } from '@safehouse/contracts';
import { CELL, metricsFor } from '../geometry.js';
import { tileDefsFromSets, type TileSetLike } from '../types.js';

export type SwatchTile = TileSetLike['tiles'][number];

/** Rendered square, in CSS px. The sheet is drawn at twice that so it is crisp on a HiDPI screen. */
export const SWATCH_PX = 40;

/** The three layer maps of a swatch scene; the tile sits in cell 1,1. */
export interface SwatchInput {
  ground: Record<string, string>;
  structure: Record<string, string>;
  object: Record<string, string>;
}

const MID = '1,1';
const ROW = ['0,1', '1,1', '2,1'] as const;

/**
 * What to paint around a tile so its swatch shows it the way the map will:
 * a floor fills the square; a wall runs left to right so the middle cell has
 * a join on each side; a door or a window sits between two of the set's
 * walls; a prop stands in the middle on the set's floor.
 */
export function swatchInput(set: TileSetLike, tile: SwatchTile): SwatchInput {
  const floor = set.tiles.find((t) => t.kind === 'floor');
  const wall = set.tiles.find((t) => t.kind === 'wall' && (t.blocksSight ?? true));
  const ground: Record<string, string> = {};
  const structure: Record<string, string> = {};
  const object: Record<string, string> = {};

  const solidFloor = tile.kind === 'floor' && (tile.footprint ?? 'fill') === 'fill';
  const floorId = solidFloor ? tile.id : floor?.id;
  if (floorId !== undefined) {
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) ground[`${c},${r}`] = floorId;
  }
  if (solidFloor) return { ground, structure, object };

  if (tile.kind === 'floor') {
    // A partial floor — a drain, a stain — lies on the set's floor.
    ground[MID] = tile.id;
  } else if (tile.kind === 'wall' || tile.kind === 'door') {
    const side = wall && wall.id !== tile.id ? wall.id : tile.id;
    for (const key of ROW) structure[key] = key === MID ? tile.id : side;
  } else {
    object[MID] = tile.id;
  }
  return { ground, structure, object };
}

/** Scenes per sheet row, and the cells one scene takes including its gap. */
export const SHEET_COLS = 6;
export const SHEET_STEP = 4;

/** Where each tile's scene sits on the set's sheet, in cells. */
export interface SheetLayout {
  /** Sheet size in cells. */
  cols: number;
  rows: number;
  /** Tile id → the cell the tile itself is drawn in. */
  at: Map<string, { col: number; row: number }>;
}

/** The whole set on one sheet: every tile's scene, a cell apart. */
export function sheetInput(set: TileSetLike): { input: SwatchInput; layout: SheetLayout } {
  const ground: Record<string, string> = {};
  const structure: Record<string, string> = {};
  const object: Record<string, string> = {};
  const at = new Map<string, { col: number; row: number }>();
  set.tiles.forEach((tile, k) => {
    const ox = (k % SHEET_COLS) * SHEET_STEP;
    const oy = Math.floor(k / SHEET_COLS) * SHEET_STEP;
    const one = swatchInput(set, tile);
    const place = (from: Record<string, string>, into: Record<string, string>) => {
      for (const [key, id] of Object.entries(from)) {
        const [c, r] = key.split(',').map(Number) as [number, number];
        into[`${ox + c},${oy + r}`] = id;
      }
    };
    place(one.ground, ground);
    place(one.structure, structure);
    place(one.object, object);
    at.set(tile.id, { col: ox + 1, row: oy + 1 });
  });
  const scenes = Math.max(1, set.tiles.length);
  return {
    input: { ground, structure, object },
    layout: {
      cols: Math.min(scenes, SHEET_COLS) * SHEET_STEP,
      rows: Math.ceil(scenes / SHEET_COLS) * SHEET_STEP,
      at,
    },
  };
}

/** The two-colour swatch shown until the render lands, or forever without one. */
export function fallbackSwatch(colors: readonly [string, string]): CSSProperties {
  return { background: `linear-gradient(135deg, ${colors[0]} 0 60%, ${colors[1]} 60% 100%)` };
}

/** A rendered sheet and where to look on it. */
export interface Sheet {
  url: string;
  layout: SheetLayout;
}

/** CSS that shows one tile's cell of the sheet at SWATCH_PX. */
export function swatchStyle(sheet: Sheet, tileId: string): CSSProperties | null {
  const cell = sheet.layout.at.get(tileId);
  if (!cell) return null;
  return {
    backgroundImage: `url(${sheet.url})`,
    backgroundSize: `${sheet.layout.cols * SWATCH_PX}px ${sheet.layout.rows * SWATCH_PX}px`,
    backgroundPosition: `-${cell.col * SWATCH_PX}px -${cell.row * SWATCH_PX}px`,
  };
}

type PixiModule = typeof import('pixi.js');
let rendererOnce: Promise<{ pixi: PixiModule; renderer: import('pixi.js').Renderer } | null> | null = null;

/** One small renderer for every sheet, made on first use; null where there is none to be had. */
function shared() {
  if (!rendererOnce) {
    rendererOnce = (async () => {
      if (typeof document === 'undefined') return null;
      try {
        const pixi = await import('pixi.js');
        const renderer = await pixi.autoDetectRenderer({
          width: CELL,
          height: CELL,
          backgroundAlpha: 0,
          antialias: true,
          preference: 'webgl',
        });
        return { pixi, renderer };
      } catch {
        return null;
      }
    })();
  }
  return rendererOnce;
}

async function render(set: TileSetLike): Promise<Sheet | null> {
  const s = await shared();
  if (!s) return null;
  const layer = await import('../stage/tileLayer.js');
  const { input, layout } = sheetInput(set);
  const grid = {
    unitM: 1,
    cols: layout.cols,
    rows: layout.rows,
    offset: { x: 0, y: 0 },
    projection: 'topdown',
  } as Scene['grid'];
  const g = new s.pixi.Graphics();
  try {
    layer.drawTiles(g, metricsFor(grid), { tilesetId: set.id, ...input, defs: tileDefsFromSets([set]) });
    const url = await s.renderer.extract.base64({
      target: g,
      frame: new s.pixi.Rectangle(0, 0, layout.cols * CELL, layout.rows * CELL),
      resolution: (SWATCH_PX * 2) / CELL,
    });
    return { url, layout };
  } finally {
    g.destroy();
  }
}

const cache = new Map<string, Promise<Sheet | null>>();
// Sheets go through one renderer one at a time; a failure never breaks the line.
let line: Promise<unknown> = Promise.resolve();

/** The set's sheet, rendered once and then remembered. */
export function sheetFor(set: TileSetLike): Promise<Sheet | null> {
  let p = cache.get(set.id);
  if (!p) {
    p = line
      .then(() => render(set))
      .catch((err: unknown) => {
        // A set that cannot render shows two-colour swatches, not an error
        // the GM sees; the reason is left where a developer looks.
        console.debug(`tile sheet ${set.id} fell back:`, err);
        return null;
      });
    line = p;
    cache.set(set.id, p);
  }
  return p;
}

/** The rendered swatch style once the sheet exists; null first, and for good where nothing can render. */
export function useSwatch(set: TileSetLike | undefined, tile: SwatchTile | undefined): CSSProperties | null {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  useEffect(() => {
    if (!set) return undefined;
    let live = true;
    void sheetFor(set).then((sh) => {
      if (live) setSheet(sh);
    });
    return () => {
      live = false;
    };
  }, [set]);
  return sheet && tile ? swatchStyle(sheet, tile.id) : null;
}
