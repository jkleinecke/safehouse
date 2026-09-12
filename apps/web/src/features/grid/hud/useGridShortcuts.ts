/**
 * Single-key tools on the Grid (docs/UX_MAP_BUILDER.md §3.3, Jakob's Law):
 * the keys every map editor a GM has used already taught them. Nothing fires
 * while a field has focus, and modifier chords stay the browser's.
 */
import { useEffect } from 'react';
import type { Scene } from '@safehouse/contracts';
import { usePatchGeometry } from '../api.js';
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      // Delete (or Backspace) removes what is selected — a wall, door, zone,
      // pin, camera or note — with no confirmation: it is one undo step, and
      // a "sure?" on something undo can fix is a tax (docs/UX_MAP_BUILDER.md §3.6).
      if (isGm && scene && (e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const s = useGridStore.getState();
        if (!s.selected) return;
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
      }
      const action = shortcutAction(e.key, isGm, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
      if (!action) return;
      const s = useGridStore.getState();
      if (action.kind === 'escape') {
        // Esc is "stop": the inspector closes, the tool goes back to select,
        // and any polygon in progress is dropped.
        if (s.tool === 'select' && s.selected === null) return;
        s.select(null);
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
  }, [isGm, floorCount, sceneId, scene, patchGeometry]);
}
