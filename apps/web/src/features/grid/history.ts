/**
 * Undo and redo for the map builder (docs/UX_MAP_BUILDER.md §5, phase 4).
 *
 * Every build edit is a request the server applies — a geometry patch, a
 * paint stroke, a scene patch — so undo is the request that puts it back,
 * and redo is the original again. The hooks in `api.ts` record an entry for
 * each edit AFTER the server accepted it (a refused stroke never happened),
 * with the inverse computed from the scene the browser was holding a moment
 * before. Undo and redo send raw requests, so they are never recorded
 * themselves, and then invalidate the scene so every screen redraws from
 * the server's answer — nothing here is optimistic.
 *
 * Entries belong to a scene: the GM staging another scene sees that scene's
 * history, and undoing never reaches into a map they are not looking at.
 * A group folds several requests into one step — a room is two strokes,
 * floor then walls, and one Ctrl+Z should take the whole room.
 */
import { create } from 'zustand';
import type { Scene } from '@safehouse/contracts';
import { levelTiles } from '@safehouse/rules';
import { apiPatch, apiPost, queryClient } from '../../api/client.js';

export interface HistoryEntry {
  sceneId: string;
  /** What Ctrl+Z will take back, in the GM's words: "paint 12 squares". */
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** An undo or redo in flight — the buttons disable rather than double-send. */
  busy: boolean;
  /** An open group: pushes land inside it until it closes. */
  group: { sceneId: string; label: string; entries: HistoryEntry[] } | null;
  push: (entry: HistoryEntry) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  beginGroup: (sceneId: string, label: string) => void;
  endGroup: () => void;
  clear: () => void;
}

/** How many steps are kept per browser; a build session rarely wants more. */
export const HISTORY_LIMIT = 100;

function invalidate(sceneId: string): void {
  void queryClient.invalidateQueries({ queryKey: ['scene', sceneId] });
  void queryClient.invalidateQueries({ queryKey: ['scenes'] });
}

// Undo and redo run one at a time, in the order they were asked for: two
// quick Ctrl+Zs are two steps, not one and a dropped keypress.
let line: Promise<void> = Promise.resolve();
function queued(job: () => Promise<void>): Promise<void> {
  line = line.then(job, job);
  return line;
}

export const useHistory = create<HistoryState>()((set, get) => ({
  past: [],
  future: [],
  busy: false,
  group: null,

  push: (entry) => {
    const g = get().group;
    if (g && g.sceneId === entry.sceneId) {
      g.entries.push(entry);
      return;
    }
    set((s) => ({ past: [...s.past, entry].slice(-HISTORY_LIMIT), future: [] }));
  },

  undo: () =>
    queued(async () => {
      const s = get();
      const entry = s.past[s.past.length - 1];
      if (!entry) return;
      set({ busy: true, past: s.past.slice(0, -1) });
      try {
        await entry.undo();
        set((st) => ({ future: [...st.future, entry] }));
      } catch {
        // The step stays undone in our list but not on the server: put it
        // back where it was so the GM can try again, and let the refetch
        // say what is.
        set((st) => ({ past: [...st.past, entry] }));
      } finally {
        invalidate(entry.sceneId);
        set({ busy: false });
      }
    }),

  redo: () =>
    queued(async () => {
      const s = get();
      const entry = s.future[s.future.length - 1];
      if (!entry) return;
      set({ busy: true, future: s.future.slice(0, -1) });
      try {
        await entry.redo();
        set((st) => ({ past: [...st.past, entry] }));
      } catch {
        set((st) => ({ future: [...st.future, entry] }));
      } finally {
        invalidate(entry.sceneId);
        set({ busy: false });
      }
    }),

  beginGroup: (sceneId, label) => set({ group: { sceneId, label, entries: [] } }),

  endGroup: () => {
    const g = get().group;
    set({ group: null });
    if (!g || g.entries.length === 0) return;
    const entries = g.entries;
    get().push({
      sceneId: g.sceneId,
      label: g.label,
      // Back to front to undo; front to back to redo — the order they happened.
      undo: async () => {
        for (let i = entries.length - 1; i >= 0; i -= 1) await entries[i]!.undo();
      },
      redo: async () => {
        for (const e of entries) await e.redo();
      },
    });
  },

  clear: () => set({ past: [], future: [], group: null }),
}));

// Reachable from the console —  — so a GM on the
// phone with support can say what the last step was, and so a browser
// walkthrough can read it without a screen.
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>)['__safehouseHistory'] = useHistory;

/** The next undo and redo for one scene, for the toolbar. */
export function historyFor(sceneId: string | null | undefined): {
  undo: HistoryEntry | null;
  redo: HistoryEntry | null;
} {
  const s = useHistory.getState();
  const last = s.past[s.past.length - 1] ?? null;
  const next = s.future[s.future.length - 1] ?? null;
  return {
    undo: last && last.sceneId === sceneId ? last : null,
    redo: next && next.sceneId === sceneId ? next : null,
  };
}

// ---------------------------------------------------------------------------
// The inverses. Pure where they can be, so they are testable without a server.
// ---------------------------------------------------------------------------

export type TileLayerName = 'ground' | 'structure' | 'object';
export const TILE_LAYER_NAMES: readonly TileLayerName[] = ['ground', 'structure', 'object'];

/** What one square held, per layer — the state a stroke's undo restores. */
export type CellSnapshot = Partial<Record<TileLayerName, string>>;

/** The body a paint request sends, minus the scene it goes to. */
export interface PaintBody {
  tilesetId: string;
  paint: Record<string, string>;
  erase: string[];
  clear?: boolean;
  level?: number;
  layer?: TileLayerName;
}

/**
 * Which squares a stroke touches, and what each held before it.
 *
 * `clear` touches every painted square (of one layer, or all); a paint or an
 * erase touches the squares it names. Squares that held nothing are still
 * listed, so undo knows to erase what the stroke put there.
 */
export function snapshotBefore(scene: Scene, body: PaintBody): Record<string, CellSnapshot> {
  const tiles = levelTiles(scene, body.level ?? 0);
  const keys = new Set<string>([...Object.keys(body.paint), ...body.erase]);
  if (body.clear) {
    const layers = body.layer ? [body.layer] : TILE_LAYER_NAMES;
    for (const layer of layers) for (const key of Object.keys(tiles?.[layer] ?? {})) keys.add(key);
  }
  const out: Record<string, CellSnapshot> = {};
  for (const key of keys) {
    const cell: CellSnapshot = {};
    for (const layer of TILE_LAYER_NAMES) {
      const id = tiles?.[layer]?.[key];
      if (id !== undefined) cell[layer] = id;
    }
    out[key] = cell;
  }
  return out;
}

/**
 * The requests that put a set of squares back to a snapshot: erase them all,
 * then repaint each layer that held something. Per layer because a paint
 * request names one tile per square and the server files it by kind, so a
 * square with a floor, a wall and a crate takes three paints.
 *
 * A snapshot taken under another tileset cannot be restored by painting under
 * this one — the server keeps one set per floor — so the restore paints under
 * the set the floor had; a stroke that switched sets is undone by painting
 * the old set back, which replaces the floor exactly as the stroke did.
 */
export function restoreBodies(
  before: Record<string, CellSnapshot>,
  tilesetId: string,
  level: number,
  wipe = false,
): PaintBody[] {
  const keys = Object.keys(before);
  const bodies: PaintBody[] = [];
  const paintOf = (layer: TileLayerName): Record<string, string> => {
    const paint: Record<string, string> = {};
    for (const key of keys) {
      const id = before[key]?.[layer];
      if (id !== undefined) paint[key] = id;
    }
    return paint;
  };
  if (wipe) {
    // The whole floor went (a set switch, or a clear): rebuild it under the
    // set it had, ground first — under another set that first stroke is the
    // one that replaces the floor, which is exactly the point.
    bodies.push({ tilesetId, paint: paintOf('ground'), erase: [], clear: true, level });
    for (const layer of ['structure', 'object'] as const) {
      const paint = paintOf(layer);
      if (Object.keys(paint).length > 0) bodies.push({ tilesetId, paint, erase: [], level });
    }
    return bodies;
  }
  if (keys.length === 0) return bodies;
  bodies.push({ tilesetId, paint: {}, erase: keys, level });
  for (const layer of TILE_LAYER_NAMES) {
    const paint = paintOf(layer);
    if (Object.keys(paint).length > 0) bodies.push({ tilesetId, paint, erase: [], level });
  }
  return bodies;
}

/** "paint 12 squares", "erase 3 squares", "clear the floor" — what the stroke did. */
export function describePaint(body: PaintBody): string {
  if (body.clear) return body.layer ? `clear the ${body.layer} layer` : 'clear the floor';
  const painted = Object.keys(body.paint).length;
  const erased = body.erase.length;
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  if (painted > 0 && erased > 0) return `paint ${n(painted, 'square')} and erase ${n(erased, 'square')}`;
  if (erased > 0) return `erase ${n(erased, 'square')}`;
  return `paint ${n(painted, 'square')}`;
}

/** Send one paint body, straight to the server; no recording, no cache write. */
export async function sendPaint(sceneId: string, body: PaintBody): Promise<void> {
  await apiPost(`/api/scenes/${sceneId}/tiles`, body);
}

/** Draw the scene, or one floor of it, in another set — a render decision. */
export async function sendTileset(sceneId: string, tilesetId: string, level?: number): Promise<void> {
  await apiPost(`/api/scenes/${sceneId}/tileset`, level === undefined ? { tilesetId } : { tilesetId, level });
}

/** Send one geometry, straight to the server. */
export async function sendGeometry(sceneId: string, geometry: Scene['geometry']): Promise<void> {
  await apiPatch(`/api/scenes/${sceneId}`, { geometry });
}

/** Send one scene patch, straight to the server. */
export async function sendScenePatch(sceneId: string, patch: Record<string, unknown>): Promise<void> {
  await apiPatch(`/api/scenes/${sceneId}`, patch);
}

const KIND_WORD: Record<'walls' | 'doors' | 'zones' | 'pins' | 'cameras' | 'gmNotes', [string, string]> = {
  walls: ['wall', 'walls'],
  doors: ['door', 'doors'],
  zones: ['zone', 'zones'],
  pins: ['pin', 'pins'],
  cameras: ['camera', 'cameras'],
  gmNotes: ['note', 'notes'],
};

/** "draw a wall", "delete 2 pins", "edit a door" — what a geometry patch did. */
export function describeGeometry(before: Scene['geometry'], after: Scene['geometry']): string {
  const kinds = Object.keys(KIND_WORD) as Array<keyof typeof KIND_WORD>;
  for (const kind of kinds) {
    const a = (before[kind] ?? []) as ReadonlyArray<{ id: string }>;
    const b = (after[kind] ?? []) as ReadonlyArray<{ id: string }>;
    const [one, many] = KIND_WORD[kind];
    const added = b.filter((x) => !a.some((y) => y.id === x.id)).length;
    const removed = a.filter((x) => !b.some((y) => y.id === x.id)).length;
    if (added > 0 && removed === 0) return added === 1 ? `draw a ${one}` : `draw ${added} ${many}`;
    if (removed > 0 && added === 0) return removed === 1 ? `delete a ${one}` : `delete ${removed} ${many}`;
    if (added > 0 && removed > 0) return `replace a ${one}`;
    if (JSON.stringify(a) !== JSON.stringify(b)) return `edit a ${one}`;
  }
  return 'edit the map';
}

/** "calibrate the grid", "change the map image" — what a scene patch did. */
export function describeScenePatch(patch: Record<string, unknown>): string {
  if ('grid' in patch) return 'calibrate the grid';
  if ('mapAttachmentIds' in patch) return 'change the map images';
  if ('environment' in patch) return 'change the environment';
  if ('name' in patch) return 'rename the scene';
  return 'change the scene';
}
