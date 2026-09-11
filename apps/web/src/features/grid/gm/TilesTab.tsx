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
 *
 * The palette itself (docs/UX_MAP_BUILDER.md §3.5): swatches drawn as the
 * material, categories with room for their words, Room as the lead for a
 * fresh scene, Auto explained in its tooltip. The shapes — brush, area, room,
 * erase — live on the toolbar (R, A, B, E), not here: one place to pick up
 * a tool.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Scene } from '@safehouse/contracts';
import { migrateTileLayer, restyleLayers, sceneLevels } from '@safehouse/rules';
import { useTilesets, usePaintTiles, type TilesetDef } from '../api.js';
import { useHistory } from '../history.js';
import { useGridStore } from '../store.js';
import ConfirmButton from './ConfirmButton.js';
import Swatch from './Swatch.js';

/**
 * Where a stair painted on `level` could lead, in words the panel can show.
 *
 * Exported for its test. The Stairs tool used to read the building silently:
 * with one floor, Auto had nowhere to send a flight and painted nothing, and
 * a GM clicking a dead tool had no way to learn that the missing piece was a
 * floor and not a click.
 */
export function stairAdvice(
  scene: Scene,
  level: number,
): { up: boolean; down: boolean; text: string } {
  const floors = sceneLevels(scene);
  const up = level < floors.length - 1;
  const down = level > 0;
  const here = floors[level]?.name ?? 'this floor';
  let text: string;
  if (!up && !down) {
    text = `${here} is the only floor, so a stair here has nowhere to go. Add a floor first — Setup ▸ Floors — then paint the flight that leads to it.`;
  } else if (up && down) {
    text = `From ${here} a stair can lead up to ${floors[level + 1]?.name ?? 'the floor above'} or down to ${floors[level - 1]?.name ?? 'the floor below'}. Auto picks up.`;
  } else if (up) {
    text = `From ${here} a stair leads up to ${floors[level + 1]?.name ?? 'the floor above'}.`;
  } else {
    text = `${here} is the top floor, so a stair here leads down to ${floors[level - 1]?.name ?? 'the floor below'}.`;
  }
  return { up, down, text };
}

export interface TilesTabProps {
  scene: Scene;
}

const CATEGORY_ORDER = ['ground', 'building', 'stairs', 'interior', 'decoration'] as const;
type ToolCategory = (typeof CATEGORY_ORDER)[number];

const CATEGORY_LABEL: Record<ToolCategory, string> = {
  ground: 'Ground',
  building: 'Building',
  interior: 'Interior',
  decoration: 'Decor',
  stairs: 'Stairs',
};

/** What each category does on a single click, in the GM's terms — the tooltip. */
const CATEGORY_HINT: Record<ToolCategory, string> = {
  ground: 'What the square is made of — pick a surface and drag. Drag again for the next surface in the set.',
  building: 'Click empty ground for a wall; click a wall again for a window, then a door.',
  interior: 'Furniture. Against a wall it picks something with a back to it; drag again for the next thing that fits.',
  decoration: 'Props. It reads the ground — trees on grass, drains on the road; drag again for another that fits.',
  stairs:
    'Stairs. Which way they lead follows from the floors this scene has — up if there is one above.',
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
  const activeLevel = useGridStore((s) => s.activeLevel);
  const setGmTab = useGridStore((s) => s.setGmTab);

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
  const [restyled, setRestyled] = useState<string | null>(null);

  /**
   * Switching sets redraws the map in the new set — every painted square on
   * every floor takes the new set's version of what it is (`restyleLayers`)
   * — as one undoable step. Before this the next stroke replaced the floor,
   * and a warning was all that stood between the GM and a blank map.
   */
  const switchTileset = (nextId: string) => {
    const to = tilesets.find((t) => t.id === nextId);
    const from = tileset;
    setTilesetId(nextId);
    if (!to || !from || to.id === from.id) return;
    const jobs: Array<{ level: number; layers: ReturnType<typeof restyleLayers> }> = [];
    sceneLevels(scene).forEach((floor, level) => {
      const tiles = floor.tiles;
      if (!tiles || paintedCells(tiles as unknown as Scene['tiles']) === 0) return;
      const src = tilesets.find((t) => t.id === tiles.tilesetId) ?? from;
      const layers = migrateTileLayer(tiles);
      jobs.push({
        level,
        layers: restyleLayers(
          src as unknown as Parameters<typeof restyleLayers>[0],
          to as unknown as Parameters<typeof restyleLayers>[1],
          layers,
        ),
      });
    });
    if (jobs.length === 0) return;
    const history = useHistory.getState();
    history.beginGroup(scene.id, `switch to ${to.name}`);
    setRestyled(`redrawing in ${to.name}…`);
    void (async () => {
      try {
        for (const job of jobs) {
          const base = { sceneId: scene.id, tilesetId: to.id, level: job.level };
          // The first stroke under the new set replaces the floor (one set
          // per floor, server-side); the next two fill in the other layers.
          await paint.mutateAsync({ ...base, clear: true, paint: job.layers.ground, erase: [] });
          if (Object.keys(job.layers.structure).length > 0) {
            await paint.mutateAsync({ ...base, paint: job.layers.structure, erase: [] });
          }
          if (Object.keys(job.layers.object).length > 0) {
            await paint.mutateAsync({ ...base, paint: job.layers.object, erase: [] });
          }
        }
        const dropped = jobs.reduce((n, j) => n + j.layers.dropped, 0);
        setRestyled(
          dropped > 0
            ? `redrawn in ${to.name} — ${dropped} square${dropped === 1 ? '' : 's'} had no match there and went; undo puts them back`
            : `redrawn in ${to.name} — undo puts it back`,
        );
      } catch {
        setRestyled(`could not redraw in ${to.name} — undo, then try again`);
      } finally {
        history.endGroup();
      }
    })();
  };
  // The server replaces the whole layer when a stroke arrives under another
  // set, so this is a data-loss warning, not a style note. The canvas carries
  // the same sentence (`GridPage`), because the tool outlives this panel.
  const switching = Boolean(scene.tiles && scene.tiles.tilesetId !== tilesetId && paintedCount > 0);

  if (isLoading) return <p className="p-3 text-sm text-dim">Loading tilesets…</p>;
  if (!tileset) return <p className="p-3 text-sm text-dim">No tilesets available.</p>;

  const tiles = tileset.tiles.filter((t) => (t.category ?? kindCategory(t.kind)) === tileCategory);

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="tiles-tab" data-tileset={tileset.id}>
      <div>
        <label className="mono-label text-dim" htmlFor="tileset">
          Tileset
        </label>
        <select
          id="tileset"
          value={tileset.id}
          title="Every floor of this scene draws from one set; switching redraws the map in the new one"
          onChange={(e) => switchTileset(e.target.value)}
          className="mt-1 w-full rounded border border-edge bg-deck px-2 py-1 text-sm"
        >
          {tilesets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-faint">{tileset.blurb}</p>
        {restyled && (
          <p className="mt-1 text-xs text-cyan" data-testid="tiles-restyled">
            {restyled}
          </p>
        )}
        {switching && (
          <p data-testid="tiles-switch-warning" className="mt-1 text-xs text-magenta">
            This scene is painted with “{scene.tiles?.tilesetId}”. Painting now replaces those{' '}
            {paintedCount} cells.
          </p>
        )}
      </div>

      {/*
        The lead for a fresh scene: a room is what a GM draws first and most,
        and the brush made it the slowest thing on the map. One large target,
        gone once there is something on the floor.
      */}
      {paintedCount === 0 && (
        <button
          type="button"
          data-testid="draw-room"
          aria-pressed={tool === 'tile-room'}
          onClick={() => {
            setTileCategory('ground');
            setTool('tile-room');
          }}
          className={
            'rounded-md border px-3 py-2 text-left ' +
            (tool === 'tile-room' ? 'border-cyan bg-raised/60' : 'border-edge-bright hover:border-cyan')
          }
        >
          <span className="block text-sm text-ink">Draw a room</span>
          <span className="block text-xs text-faint">
            drag a rectangle on the map: floor inside, walls around · R
          </span>
        </button>
      )}

      {/*
        The five categories. Each is a different QUESTION a GM is asking —
        "what is this square made of", "where do the walls go", "what
        furniture is in here", "what's lying about" — which is why they are a
        row of choices and not five headings in one long list. Choosing one
        narrows the palette to tiles that answer that question, and arms
        auto-placement for it. What each does lives in its tooltip.
      */}
      <div className="flex flex-wrap gap-1" role="group" aria-label="Tile category">
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
                'rounded border px-2.5 py-1 text-xs ' +
                (active ? 'border-cyan bg-raised text-cyan' : 'border-edge text-dim hover:border-dim hover:text-ink')
              }
            >
              {CATEGORY_LABEL[category]}
            </button>
          );
        })}
      </div>

      {tileCategory === 'stairs' && (
        <StairAdvice scene={scene} level={activeLevel} onAddFloor={() => setGmTab('map')} />
      )}

      {tiles.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
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
            title="Auto — let the square decide: reads the ground and the walls around it and places what belongs"
            onClick={() => {
              setTileId(null);
              setTool('tile');
            }}
            className={
              'flex items-center gap-2 rounded border px-1.5 py-1 text-left text-xs ' +
              (tileId === null ? 'border-cyan text-cyan' : 'border-edge text-ink hover:border-dim')
            }
          >
            <span
              aria-hidden
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-dashed border-cyan text-base"
            >
              ✦
            </span>
            <span className="min-w-0">
              <span className="block truncate">Auto</span>
              <span className="block truncate text-[10px] text-faint">reads the square</span>
            </span>
          </button>
          {tiles.map((t) => {
            const selected = tileId === t.id && tool !== 'tile-erase';
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
                  'flex items-center gap-2 rounded border px-1.5 py-1 text-left text-xs ' +
                  (selected ? 'border-cyan text-cyan' : 'border-edge text-ink hover:border-dim')
                }
              >
                <Swatch set={tileset} tile={t} />
                <span className="min-w-0 truncate">{t.name}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-2">
        <ConfirmButton
          label="Clear floor"
          confirmLabel={`Clear ${paintedCount} cells?`}
          testId="clear-floor"
          disabled={paintedCount === 0 || paint.isPending}
          title="Erase everything painted on this scene"
          className="mono-label rounded border border-edge px-2 py-1 disabled:opacity-40"
          onConfirm={() =>
            // The scene's own set, not the dropdown's: clearing a layer painted
            // with another set must not also change which set it is filed under.
            paint.mutate({
              sceneId: scene.id,
              tilesetId: scene.tiles?.tilesetId ?? tileset.id,
              paint: {},
              erase: [],
              clear: true,
            })
          }
        />
      </div>

      {/*
        What a painted wall actually does. Sight is real: `sightModelFor` reads
        every full-height tile and every drawn wall, so the LOS lens, the
        players' shroud and the cover suggestion all see painted walls. This
        sentence used to say the opposite — it was written before any of that
        existed and never updated — and a GM reading it believed line of sight
        was not a thing the app did. Movement is still not enforced, and that
        is said plainly rather than implied.
      */}
      <p className="text-xs text-faint" data-testid="tile-summary">
        {paintedCount === 0
          ? 'Pick a tile, then drag on the canvas to lay it down.'
          : `${paintedCount} cells painted. Players see the floor. Full-height walls block sight and give the cover suggestion its answer; windows let sight through, doors when open. Movement is not enforced — the map suggests, you rule.`}
      </p>
    </div>
  );
}

function StairAdvice({
  scene,
  level,
  onAddFloor,
}: {
  scene: Scene;
  level: number;
  onAddFloor: () => void;
}) {
  const advice = stairAdvice(scene, level);
  const dead = !advice.up && !advice.down;
  return (
    <div
      data-testid="stair-advice"
      className={
        'rounded border px-2 py-1.5 text-xs ' +
        (dead ? 'border-warn/50 text-warn' : 'border-edge text-dim')
      }
    >
      <p>{advice.text}</p>
      {dead && (
        <button
          type="button"
          className="mono-label mt-1 rounded border border-warn/60 px-2 py-0.5 text-warn"
          onClick={onAddFloor}
        >
          go to floors
        </button>
      )}
    </div>
  );
}
