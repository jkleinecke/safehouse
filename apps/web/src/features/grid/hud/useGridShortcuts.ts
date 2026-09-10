/**
 * Single-key tools on the Grid (docs/UX_MAP_BUILDER.md §3.3, Jakob's Law):
 * the keys every map editor a GM has used already taught them. Nothing fires
 * while a field has focus, and modifier chords stay the browser's.
 */
import { useEffect } from 'react';
import { useGridStore } from '../store.js';
import { isTypingTarget, shortcutAction } from './modes.js';

export function useGridShortcuts(isGm: boolean, floorCount: number): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (isTypingTarget(e.target)) return;
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
  }, [isGm, floorCount]);
}
