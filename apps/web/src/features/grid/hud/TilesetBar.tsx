/**
 * What is true of the whole scene, on the mode bar beside Build: the set it
 * is drawn in, the grid it is drawn on (behind the gear), and the one button
 * that undoes a floor's worth of painting.
 *
 * The set is not a tool and not a tile: it is what every tile in the scene is
 * drawn from, so a change to it redraws the whole map. That is the same
 * altitude as the mode itself, which is why it sits on the mode row rather
 * than inside a panel section two clicks away — a GM could previously paint
 * for a minute before noticing they were laying the wrong set's concrete.
 *
 * Clear floor sits next to it because it is the other thing that happens to
 * the whole floor at once, and because both are the map-wide moves worth
 * having in one place. It asks before it fires: it is the one click here that
 * destroys work, and undo cannot always reach it.
 *
 * Shown only in Build mode — nothing in Prep or Play repaints a floor.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Scene } from '@safehouse/contracts';
import { sceneLevels } from '@safehouse/rules';
import { usePaintTiles, useSwitchTileset, useTilesets } from '../api.js';
import { useGridStore } from '../store.js';
import { paintedCells, paintedTilesetToAdopt, resolveTileset } from '../tilesetChoice.js';
import ConfirmButton from '../gm/ConfirmButton.js';
import CalibrateMenu from './CalibrateMenu.js';

export default function TilesetBar({ scene }: { scene: Scene }) {
  const { data: tilesets = [] } = useTilesets();
  const paint = usePaintTiles();
  const switchSet = useSwitchTileset();
  const tilesetId = useGridStore((s) => s.tilesetId);
  const setTilesetId = useGridStore((s) => s.setTilesetId);

  const { tileset, adopt } = useMemo(() => resolveTileset(tilesets, tilesetId), [tilesets, tilesetId]);

  // Adopts the painted scene's set on ARRIVAL. Deliberately narrow deps: it
  // must not fight a switch the GM makes afterwards.
  useEffect(() => {
    const painted = paintedTilesetToAdopt(tilesets, tilesetId, scene.tiles?.tilesetId);
    if (painted) setTilesetId(painted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id, scene.tiles?.tilesetId, tilesets.length]);

  // …and the control never shows one set while the brush uses another.
  useEffect(() => {
    if (adopt) setTilesetId(adopt);
  }, [adopt, setTilesetId]);

  const paintedCount = paintedCells(scene.tiles);
  // A switch that failed must say so. It used to have a panel section to say
  // it in; here it is one line that clears itself.
  const [notice, setNotice] = useState<string | null>(null);
  const say = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? null : n)), 4000);
  };

  /**
   * Switching sets is a render decision (rules/tilesets/slots.ts): every
   * painted square holds a slot that means the same thing in every set, so
   * the server changes one field per floor and the map redraws — doors keep
   * their locks, stairs their direction — as one undoable step.
   */
  const switchTileset = (nextId: string) => {
    const to = tilesets.find((t) => t.id === nextId);
    setTilesetId(nextId);
    if (!to || to.id === tileset?.id) return;
    const painted = sceneLevels(scene).some(
      (floor) => floor.tiles !== undefined && paintedCells(floor.tiles as unknown as Scene['tiles']) > 0,
    );
    if (!painted) return;
    switchSet.mutate(
      { sceneId: scene.id, tilesetId: to.id },
      {
        onSuccess: () => say(`drawn in ${to.name} — undo puts it back`),
        onError: () => say(`could not switch to ${to.name} — try again`),
      },
    );
  };

  if (!tileset) return null;

  return (
    <div className="flex items-center gap-1.5" data-testid="tileset-bar" data-tileset={tileset.id}>
      <select
        aria-label="Tileset"
        data-testid="tileset-select"
        value={tileset.id}
        title={`${tileset.name} — every floor of this scene draws from one set`}
        onChange={(e) => switchTileset(e.target.value)}
        className="min-h-9 max-w-44 rounded border border-edge bg-deck px-2 py-1 text-xs text-ink"
      >
        {tilesets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <CalibrateMenu scene={scene} />
      {/*
        A bin, not the words "Clear floor": the row is icons either side of it
        and the tooltip carries the name. Armed, it says in words what is
        about to go — an icon cannot, and "did I just bin forty squares?" is
        the one question this button must never leave open.
      */}
      <ConfirmButton
        label="🗑"
        confirmLabel={`Clear ${paintedCount} cells?`}
        testId="clear-floor"
        disabled={paintedCount === 0 || paint.isPending}
        title={`Clear floor — erase all ${paintedCount} painted squares`}
        className="min-h-9 rounded border border-edge px-2 py-1 text-xs leading-none disabled:opacity-40"
        onConfirm={() =>
          // The scene's own set, not the control's: clearing a layer painted
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
      {notice && (
        <span className="mono-label max-w-56 truncate text-cyan" data-testid="tiles-switched">
          {notice}
        </span>
      )}
    </div>
  );
}
