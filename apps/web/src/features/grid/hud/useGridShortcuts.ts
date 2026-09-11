/**
 * Single-key tools on the Grid (docs/UX_MAP_BUILDER.md §3.3, Jakob's Law):
 * the keys every map editor a GM has used already taught them. Nothing fires
 * while a field has focus, and modifier chords stay the browser's.
 */
import { useEffect } from 'react';
import { historyFor, useHistory } from '../history.js';
import { useGridStore } from '../store.js';
import { isTypingTarget, shortcutAction } from './modes.js';

export function useGridShortcuts(isGm: boolean, floorCount: number, sceneId: string | null = null): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (isTypingTarget(e.target)) return;
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
  }, [isGm, floorCount, sceneId]);
}
