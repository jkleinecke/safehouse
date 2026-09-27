/**
 * Tile swatches drawn by the tile painter (docs/UX_MAP_BUILDER.md §3.5): a
 * square of the material itself — its colours, its pattern, a door's design,
 * a piece of furniture — not a coloured dot beside a name. Fitts's Law on the
 * most-clicked target in the builder — and Similarity: the GM picks the thing
 * by what it looks like, not by decoding a legend.
 *
 * Every tile of a set gets a three-by-three cell scene with the tile in the
 * middle — the set's floor all round, and for a wall a wall either side so
 * its joins draw. The scenes are laid out on one sheet, a cell apart so no
 * wall run leaks into its neighbour, and the 2D tile painter (`drawTiles`)
 * draws the whole sheet in one go onto a plain Canvas2D, through a
 * `CanvasPen` (`art/canvasPen.ts`). The painter was written for pixi, and the
 * pen keeps pixi's drawing rules, so the pictures look as they did when pixi
 * drew them; pixi itself is gone. The sheet is encoded once per set, and each
 * swatch is then a window onto it.
 *
 * The painter is big — the furniture designs alone are some 450 KB — so it
 * is fetched by dynamic import the first time a palette asks for a sheet, and
 * the Grid page does not carry it until then.
 *
 * Anything that cannot draw (no DOM, a DOM with no 2D canvas, a server
 * render, a test) shows the two-colour CSS swatch the palette had before, so
 * the palette never waits.
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

/**
 * Can this page draw on a 2D canvas at all? Not without a DOM (a server
 * render, the node tests), and not in a stand-in DOM that has no 2D canvas
 * behind it — which is asked here, before anything is fetched or made, so
 * such a page neither downloads the painter nor logs a "not implemented"
 * from asking a canvas for a context.
 */
function canDraw(): boolean {
  return typeof document !== 'undefined' && typeof CanvasRenderingContext2D !== 'undefined';
}

/**
 * A canvas the size of a sheet, and its 2D context; null when the browser
 * will not give one (out of canvases, or a size it refuses).
 *
 * `willReadFrequently` asks for a canvas kept in main memory rather than on
 * the GPU. The sheet is drawn once and encoded once, so there is nothing for
 * the GPU to speed up, and a GPU canvas would have to read its pixels back
 * to be encoded — the slow step the pixi render had.
 */
function sheetCanvas(width: number, height: number): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    return canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    return null;
  }
}

/**
 * The drawn sheet as a URL a CSS background can show; null when the canvas
 * cannot be encoded (too big for this browser, say). `toBlob` encodes off the
 * main thread — a full set's sheet is a couple of million pixels, a stall the
 * GM would feel if it were encoded in line — and pixi's extract encoded this
 * way too. The blob URL lives as long as the page, like the sheet it names
 * (`cache`), so it is never revoked.
 */
function encode(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png');
  });
}

async function render(set: TileSetLike): Promise<Sheet | null> {
  if (!canDraw()) return null;
  // The painter and its pen, fetched on first use (module comment). The
  // tile painter reaches props.ts; the dynamic import is what keeps both out
  // of the Grid chunk.
  const [{ drawTiles }, { CanvasPen }] = await Promise.all([
    import('./art/tileArt.js'),
    import('./art/canvasPen.js'),
  ]);
  const { input, layout } = sheetInput(set);
  // Twice the swatch size, so the sheet is crisp on a HiDPI screen: a cell
  // is 2 × SWATCH_PX canvas px across, and `k` canvas px make one world px.
  const k = (SWATCH_PX * 2) / CELL;
  const ctx = sheetCanvas(layout.cols * SWATCH_PX * 2, layout.rows * SWATCH_PX * 2);
  if (!ctx) return null;
  const grid = {
    unitM: 1,
    cols: layout.cols,
    rows: layout.rows,
    offset: { x: 0, y: 0 },
    projection: 'topdown',
  } as Scene['grid'];
  try {
    // The painter draws in world px from the sheet's top-left corner; the
    // transform scales that onto the canvas. Anything past the sheet's edge
    // falls off the canvas, as it fell outside pixi's extract frame.
    ctx.setTransform(k, 0, 0, k, 0, 0);
    // Each piece at its one-square design size: the swatches share a sheet,
    // and a car at its real size would park in its neighbour's.
    drawTiles(new CanvasPen(ctx), { ...metricsFor(grid), designSize: true }, { tilesetId: set.id, ...input, defs: tileDefsFromSets([set]) });
    const url = await encode(ctx.canvas);
    return url === null ? null : { url, layout };
  } finally {
    // Give the pixels back now rather than whenever the canvas is collected;
    // the encoded copy is all the palette keeps.
    ctx.canvas.width = 0;
    ctx.canvas.height = 0;
  }
}

const cache = new Map<string, Promise<Sheet | null>>();

/** The set's sheet, drawn once and then remembered. */
export function sheetFor(set: TileSetLike): Promise<Sheet | null> {
  let p = cache.get(set.id);
  if (!p) {
    p = render(set).catch((err: unknown) => {
      // A set that cannot draw shows two-colour swatches, not an error the
      // GM sees; the reason is left where a developer looks.
      console.debug(`tile sheet ${set.id} fell back:`, err);
      return null;
    });
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
