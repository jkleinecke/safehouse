/**
 * Single-key tools on the Grid (docs/UX_MAP_BUILDER.md §3.3, Jakob's Law):
 * the keys every map editor a GM has used already taught them. Nothing fires
 * while a field has focus, and modifier chords stay the browser's.
 */
import { useEffect } from 'react';
import type { Scene } from '@safehouse/contracts';
import { usePaintBatch, usePaintTiles, usePatchGeometry } from '../api.js';
import { copySet, eraseBodies, setOfObject } from '../cellSelection.js';
import { objectForSelection } from '../paintedObjects.js';
import { removeSelection } from '../geometryEdit.js';
import { historyFor, useHistory } from '../history.js';
import { useGridStore } from '../store.js';
import { isTypingTarget, shortcutAction } from './modes.js';

export function useGridShortcuts(
  isGm: boolean,
  floorCount: number,
  sceneId: string | null = null,
  scene: Scene | null = null,
): void {
  // `mutate` is the stable half of the mutation; the object itself is not.
  const patchGeometry = usePatchGeometry().mutate;
  const paintTiles = usePaintTiles().mutate;
  const paintBatch = usePaintBatch().mutate;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      // Delete (or Backspace) removes what is selected — a wall, door, zone,
      // pin, camera or note — with no confirmation: it is one undo step, and
      // a "sure?" on something undo can fix is a tax (docs/UX_MAP_BUILDER.md §3.6).
      if (isGm && scene && (e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const s = useGridStore.getState();
        // A multi-selection goes as one step: each square from its own layer.
        if (s.cellSelection) {
          const bodies = eraseBodies(scene, s.cellSelection);
          s.setCellSelection(null);
          if (bodies.length > 0) paintBatch({ sceneId: scene.id, bodies, label: 'delete the selection' });
          e.preventDefault();
          return;
        }
        if (!s.selected) return;
        // A painted wall, door or prop is squares on a layer, not geometry:
        // it goes as an erase of exactly its own cells, on its own layer, so
        // the floor under a deleted bench stays floor.
        if (s.selected.kind === 'painted') {
          const obj = objectForSelection(scene, s.activeLevel, s.selected.id);
          if (obj) {
            s.select(null);
            paintTiles({
              sceneId: scene.id,
              tilesetId: obj.tilesetId,
              level: s.activeLevel,
              paint: {},
              erase: obj.cells,
              layer: obj.layer,
            });
          }
          e.preventDefault();
          return;
        }
        const next = removeSelection(scene.geometry, s.selected);
        if (next !== scene.geometry) {
          s.select(null);
          patchGeometry({ sceneId: scene.id, geometry: next });
        }
        e.preventDefault();
        return;
      }
      // Undo and redo, the keys every editor taught: Ctrl+Z, Ctrl+Shift+Z or
      // Ctrl+Y (Cmd on a Mac). Only a step of the scene on screen.
      if (isGm && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        const steps = historyFor(sceneId);
        if (k === 'z' && !e.shiftKey) {
          if (steps.undo) void useHistory.getState().undo();
          e.preventDefault();
          return;
        }
        if ((k === 'z' && e.shiftKey) || k === 'y') {
          if (steps.redo) void useHistory.getState().redo();
          e.preventDefault();
          return;
        }
        // Copy and paste, while building. Copy takes the multi-selection, or
        // the one object clicked; paste waits for a click to say where.
        const s = useGridStore.getState();
        if (scene && s.mode === 'build' && k === 'c' && !e.shiftKey) {
          let sel = s.cellSelection;
          if (!sel && s.selected?.kind === 'painted') {
            const obj = objectForSelection(scene, s.activeLevel, s.selected.id);
            if (obj) sel = setOfObject(obj, s.activeLevel);
          }
          if (!sel) return;
          const clip = copySet(scene, sel);
          if (clip) s.setClipboard(clip);
          e.preventDefault();
          return;
        }
        if (scene && s.mode === 'build' && k === 'v' && !e.shiftKey) {
          if (!s.clipboard) return;
          s.setPasting(true);
          e.preventDefault();
          return;
        }
      }
      const action = shortcutAction(e.key, isGm, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
      if (!action) return;
      const s = useGridStore.getState();
      if (action.kind === 'escape') {
        // A paste waiting for a click is the first thing Esc takes back.
        if (s.pasting) {
          s.setPasting(false);
          e.preventDefault();
          return;
        }
        // Esc is "stop": the inspector closes, the tool goes back to select,
        // and any polygon in progress is dropped.
        if (s.tool === 'select' && s.selected === null && s.cellSelection === null) return;
        s.select(null);
        s.setCellSelection(null);
        s.setTool('select');
      } else if (action.kind === 'tool') {
        s.setTool(action.tool);
      } else if (action.index < floorCount) {
        s.setActiveLevel(action.index);
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isGm, floorCount, sceneId, scene, patchGeometry, paintTiles, paintBatch]);
}
