/**
 * Build the floor from a tileset instead of uploading a map image — FR9.2's
 * "assemble" half.
 *
 * The catalogue lives in `@safehouse/rules` and is served by `GET /api/tilesets`
 * so the palette never drifts from what the server will accept. Tiles are
 * DEFINITIONS, not artwork: each carries a palette and a pattern the canvas
 * draws, which is why the whole set is a few kilobytes and stays crisp at any
 * zoom (§14 — nothing shipped that we do not own).
 *
 * Painting is a delta (`POST /api/scenes/:id/tiles` with `paint`/`erase`), so a
 * drag across a warehouse is one request rather than one per cell, and two
 * rooms painted in sequence do not clobber each other.
 */
import { useEffect, useMemo } from 'react';
import type { Scene } from '@safehouse/contracts';
import { useTilesets, usePaintTiles, type TilesetDef } from '../api.js';
import { useGridStore } from '../store.js';

export interface TilesTabProps {
  scene: Scene;
}

const CATEGORY_ORDER = ['ground', 'building', 'interior', 'decoration'] as const;
type ToolCategory = (typeof CATEGORY_ORDER)[number];

const CATEGORY_LABEL: Record<ToolCategory, string> = {
  ground: 'Ground',
  building: 'Building',
  interior: 'Interior',
  decoration: 'Decor',
};

/** What each tool does on a single click, in the GM's terms. */
const CATEGORY_HINT: Record<ToolCategory, string> = {
  ground: 'What the square is made of — pick a surface and drag.',
  building: 'Click empty ground for a wall; click a wall again for a window, then a door.',
  interior: 'Furniture. Against a wall it picks something with a back to it.',
  decoration: 'Props. It reads the ground — trees on grass, drains on the road.',
};

/** Fallback for a set that predates categories; mirrors `categoryOf` in rules. */
function kindCategory(kind: string): ToolCategory {
  if (kind === 'floor') return 'ground';
  if (kind === 'wall' || kind === 'door') return 'building';
  return 'decoration';
}

/**
 * Which set the palette shows, and whether the STORE is holding a different
 * answer than the one on screen.
 *
 * The two must not diverge. This panel displayed `find(storeId) ?? tilesets[0]`
 * while the canvas painted from `store.tilesetId` (`GridPage`'s `onTilePaint`),
 * so an id matching no served set left the GM watching "Docklands warehouse"
 * sit selected while every stroke came back 400 `unknown_tileset` and vanished
 * without a word — and "Clear floor", which read the displayed set, aimed
 * somewhere else again. `adopt` is what the store has to be told.
 */
export function resolveTileset(
  tilesets: readonly TilesetDef[],
  storeId: string,
): { tileset: TilesetDef | undefined; adopt: string | null } {
  const tileset = tilesets.find((t) => t.id === storeId) ?? tilesets[0];
  return { tileset, adopt: tileset && tileset.id !== storeId ? tileset.id : null };
}

/**
 * The set a painted scene should open on, or null to leave the GM's choice
 * alone. A scene already painted from another set opens on THAT set: the next
 * stroke should extend what is on the canvas, and since switching sets
 * REPLACES the layer server-side, a wrong default is destructive.
 */
export function paintedTilesetToAdopt(
  tilesets: readonly TilesetDef[],
  storeId: string,
  paintedId: string | undefined,
): string | null {
  if (!paintedId || paintedId === storeId) return null;
  return tilesets.some((t) => t.id === paintedId) ? paintedId : null;
}

/**
 * How many squares this scene has anything painted in.
 *
 * Counts the UNION of the three layers, not their sum: a square holding grass,
 * a wall and a chair is one painted square, and reporting three would make
 * "12 cells painted" mean nothing a GM could check against the canvas.
 *
 * `cells` is the drained legacy field — included so an un-migrated scene still
 * counts, and harmless once the server has rewritten it.
 */
export function paintedCells(tiles: Scene['tiles']): number {
  if (!tiles) return 0;
  const keys = new Set<string>();
  for (const map of [tiles.ground, tiles.structure, tiles.object, tiles.cells]) {
    for (const key of Object.keys(map ?? {})) keys.add(key);
  }
  return keys.size;
}

export default function TilesTab({ scene }: TilesTabProps) {
  const { data: tilesets = [], isLoading } = useTilesets();
  const paint = usePaintTiles();

  const tool = useGridStore((s) => s.tool);
  const setTool = useGridStore((s) => s.setTool);
  const tilesetId = useGridStore((s) => s.tilesetId);
  const setTilesetId = useGridStore((s) => s.setTilesetId);
  const tileId = useGridStore((s) => s.tileId);
  const setTileId = useGridStore((s) => s.setTileId);
  const tileCategory = useGridStore((s) => s.tileCategory);
  const setTileCategory = useGridStore((s) => s.setTileCategory);

  const { tileset, adopt } = useMemo(
    () => resolveTileset(tilesets, tilesetId),
    [tilesets, tilesetId],
  );

  // Adopts the painted scene's set on ARRIVAL. Deliberately narrow deps: it
  // must not fight a switch the GM makes afterwards.
  useEffect(() => {
    const painted = paintedTilesetToAdopt(tilesets, tilesetId, scene.tiles?.tilesetId);
    if (painted) setTilesetId(painted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id, scene.tiles?.tilesetId, tilesets.length]);

  // …and the dropdown never shows one set while the brush uses another.
  useEffect(() => {
    if (adopt) setTilesetId(adopt);
  }, [adopt, setTilesetId]);

  const paintedCount = paintedCells(scene.tiles);
  // The server replaces the whole layer when a stroke arrives under another
  // set, so this is a data-loss warning, not a style note. The canvas carries
  // the same sentence (`GridPage`), because the tool outlives this panel.
  const switching = Boolean(scene.tiles && scene.tiles.tilesetId !== tilesetId && paintedCount > 0);

  if (isLoading) return <p className="p-3 text-sm text-dim">Loading tilesets…</p>;
  if (!tileset) return <p className="p-3 text-sm text-dim">No tilesets available.</p>;

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="tiles-tab" data-tileset={tileset.id}>
      <div>
        <label className="mono-label text-dim" htmlFor="tileset">
          Tileset
        </label>
        <select
          id="tileset"
          value={tileset.id}
          onChange={(e) => setTilesetId(e.target.value)}
          className="mt-1 w-full rounded border border-edge bg-deck px-2 py-1 text-sm"
        >
          {tilesets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-faint">{tileset.blurb}</p>
        {switching && (
          <p data-testid="tiles-switch-warning" className="mt-1 text-xs text-magenta">
            This scene is painted with “{scene.tiles?.tilesetId}”. Painting now replaces those{' '}
            {paintedCount} cells.
          </p>
        )}
      </div>

      {/*
        The four tools. Each is a different QUESTION a GM is asking — "what is
        this square made of", "where do the walls go", "what furniture is in
        here", "what's lying about" — which is why they are tools and not four
        headings in one long list. Choosing one narrows the palette to tiles
        that answer that question, and arms auto-placement for it.
      */}
      <div>
        <div className="mono-label text-dim">Tool</div>
        <div className="mt-1 grid grid-cols-4 gap-1" role="group" aria-label="Tile tool">
          {CATEGORY_ORDER.map((category) => {
            const active = tileCategory === category;
            return (
              <button
                key={category}
                type="button"
                data-tile-category={category}
                aria-pressed={active}
                title={CATEGORY_HINT[category]}
                onClick={() => setTileCategory(category)}
                className={
                  'mono-label rounded border px-1 py-1 text-center text-[10px] ' +
                  (active ? 'border-cyan text-cyan' : 'border-edge text-dim hover:border-dim')
                }
              >
                {CATEGORY_LABEL[category]}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-faint" data-testid="tile-auto-hint">
          {CATEGORY_HINT[tileCategory]}
        </p>
      </div>

      {[tileCategory].map((category) => {
        const tiles = tileset.tiles.filter((t) => (t.category ?? kindCategory(t.kind)) === category);
        if (tiles.length === 0) return null;
        return (
          <div key={category}>
            <div className="mono-label text-dim">{CATEGORY_LABEL[category]}</div>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {/*
                Auto is a first-class choice, and the default. With nothing
                pinned the engine reads the square — its ground, its walls —
                and places what belongs; picking a named tile below overrules
                it for as long as it stays selected.
              */}
              <button
                type="button"
                data-tile-id="__auto__"
                aria-pressed={tileId === null}
                title="Let the square decide — reads the ground and the walls around it"
                onClick={() => {
                  setTileId(null);
                  setTool('tile');
                }}
                className={
                  'flex items-center gap-2 rounded border px-2 py-1 text-left text-xs ' +
                  (tileId === null ? 'border-cyan text-cyan' : 'border-edge text-ink hover:border-dim')
                }
              >
                <span aria-hidden className="inline-block h-4 w-4 shrink-0 rounded-sm border border-dashed border-cyan" />
                <span className="truncate">Auto</span>
              </button>
              {tiles.map((t) => {
                const selected = tileId === t.id && tool === 'tile';
                return (
                  <button
                    key={t.id}
                    type="button"
                    data-tile-id={t.id}
                    title={t.hint ?? t.name}
                    aria-pressed={selected}
                    // Picking a tile picks up the brush — one call, because the
                    // store owns that coupling now (see `toolPatch`).
                    onClick={() => setTileId(t.id)}
                    className={
                      'flex items-center gap-2 rounded border px-2 py-1 text-left text-xs ' +
                      (selected ? 'border-cyan text-cyan' : 'border-edge text-ink hover:border-dim')
                    }
                  >
                    <span
                      aria-hidden
                      className="inline-block h-4 w-4 shrink-0 rounded-sm border border-edge"
                      style={{
                        background: `linear-gradient(135deg, ${t.colors[0]} 0 60%, ${t.colors[1]} 60% 100%)`,
                      }}
                    />
                    <span className="truncate">{t.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2 border-t border-edge pt-2">
        <button
          type="button"
          aria-pressed={tool === 'tile-erase'}
          onClick={() => setTool(tool === 'tile-erase' ? 'select' : 'tile-erase')}
          className={
            'mono-label rounded border px-2 py-1 ' +
            (tool === 'tile-erase' ? 'border-magenta text-magenta' : 'border-edge text-dim')
          }
        >
          Erase
        </button>
        <button
          type="button"
          onClick={() => setTool('select')}
          className="mono-label rounded border border-edge px-2 py-1 text-dim"
        >
          Done painting
        </button>
        <button
          type="button"
          data-testid="clear-floor"
          disabled={paintedCount === 0 || paint.isPending}
          onClick={() => {
            if (!window.confirm(`Clear all ${paintedCount} painted cells?`)) return;
            // The scene's own set, not the dropdown's: clearing a layer painted
            // with another set must not also change which set it is filed under.
            paint.mutate({
              sceneId: scene.id,
              tilesetId: scene.tiles?.tilesetId ?? tileset.id,
              paint: {},
              erase: [],
              clear: true,
            });
          }}
          className="mono-label rounded border border-edge px-2 py-1 text-dim disabled:opacity-40"
        >
          Clear floor
        </button>
      </div>

      {/*
        What a painted wall actually does, which is: look like a wall. Nothing
        in the app reads a tile's `blocksMovement`/`blocksSight` — there is no
        movement or sight blocking anywhere yet, drawn geometry included — and
        the footer used to promise the opposite. A GM planning cover from that
        sentence was planning on a lie.
      */}
      <p className="text-xs text-faint" data-testid="tile-summary">
        {paintedCount === 0
          ? 'Pick a tile, then drag on the canvas to lay it down.'
          : `${paintedCount} cells painted. Players see the floor. Painted walls and doors are scenery — nothing blocks movement or sight yet, drawn walls included — so cover and line of sight are still yours to call.`}
      </p>
    </div>
  );
}
