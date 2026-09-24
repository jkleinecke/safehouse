/**
 * The Fixer's floor edits, painted as they arrive (server: chat/floor-draft.ts).
 *
 * Each floor tool answers with what changed on the map — squares to paint
 * and squares to erase, per layer — and this paints them, in the order they
 * were made, through the same path as a brush stroke, so they land on the
 * GM's own undo history. A turn's edits are ONE step: the history group
 * opens at the turn's first edit and closes when the turn ends, so Ctrl+Z
 * takes back everything the Fixer drew in answer to one message.
 *
 * An edit is painted once: by its tool call, across remounts. A thread
 * reopened from the server is history — its edits were painted (or undone)
 * the first time, and are never painted again.
 */
import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import { usePaintBatch } from '../../grid/api.js';
import { useHistory, type PaintBody } from '../../grid/history.js';

type Layer = 'ground' | 'structure' | 'object';
const LAYERS: readonly Layer[] = ['ground', 'structure', 'object'];

export interface FloorEdit {
  summary: string;
  kind: 'floor-edit';
  sceneId: string;
  level: number;
  tilesetId: string;
  title: string;
  clear?: boolean;
  diff: Record<Layer, { paint: Record<string, string>; erase: string[] }>;
  warnings: string[];
}

export function isFloorEdit(v: unknown): v is FloorEdit {
  return typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'floor-edit';
}

/** The requests one edit makes: a wipe first if it clears, then a body per layer that changed. */
export function editBodies(edit: FloorEdit): PaintBody[] {
  const base = { tilesetId: edit.tilesetId, level: edit.level };
  const bodies: PaintBody[] = [];
  if (edit.clear) bodies.push({ ...base, paint: {}, erase: [], clear: true });
  for (const layer of LAYERS) {
    const d = edit.diff[layer];
    if (Object.keys(d.paint).length === 0 && d.erase.length === 0) continue;
    bodies.push({ ...base, paint: d.paint, erase: d.erase, layer });
  }
  return bodies;
}

/** Edits already painted this session, by tool call. */
const painted = new Set<string>();
// One at a time, in order: an edit is measured against the one before it.
let line: Promise<void> = Promise.resolve();

export function useFloorEdits(messages: readonly UIMessage[], historic: ReadonlySet<string>, busy: boolean): void {
  const paint = usePaintBatch();
  const paintRef = useRef(paint);
  paintRef.current = paint;
  /** The history group this hook opened for the turn under way. */
  const opened = useRef(false);

  useEffect(() => {
    for (const m of messages) {
      if (m.role !== 'assistant' || historic.has(m.id)) continue;
      for (const part of m.parts) {
        const p = part as { type: string; toolCallId?: string; state?: string; output?: unknown };
        if (!p.type.startsWith('tool-') || p.state !== 'output-available' || !p.toolCallId) continue;
        if (!isFloorEdit(p.output) || painted.has(p.toolCallId)) continue;
        painted.add(p.toolCallId);
        const edit = p.output;
        const bodies = editBodies(edit);
        if (bodies.length === 0) continue;
        line = line
          .then(async () => {
            const history = useHistory.getState();
            if (!history.group) {
              history.beginGroup(edit.sceneId, `the Fixer's drawing of ${edit.title}`);
              opened.current = true;
            }
            await paintRef.current.mutateAsync({ sceneId: edit.sceneId, bodies, label: edit.summary });
          })
          .catch(() => {
            // A refused edit is left out; the next one repaints what it needs.
          });
      }
    }
  }, [messages, historic]);

  // The turn is over: its edits become one step, once the last has landed.
  useEffect(() => {
    if (busy) return;
    line = line.then(() => {
      if (!opened.current) return;
      opened.current = false;
      useHistory.getState().endGroup();
    });
  }, [busy]);
}
