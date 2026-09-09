/**
 * GM notes draw for the GM and for nobody else (FR9.25), and a door's lock
 * shows only to the GM (FR9.24).
 *
 * The secrecy lives server-side (`sceneForViewer` sends a player no notes and
 * no lock), so this pins the belt-and-braces half: even handed a scene with
 * notes in it, a player's stage draws none; and a locked door's padlock is a
 * GM-only mark on a knob everyone can see.
 */
import { describe, expect, it } from 'vitest';
import type { Container, Graphics, Text } from 'pixi.js';
import type { Scene } from '@safehouse/contracts';
import { metricsFor } from '../geometry.js';
import { drawGeometry, drawNotes } from './layers.js';
import { noteFrame, noteLines } from './notes.js';

const flat = metricsFor({ unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 }, projection: 'topdown' as const });
const iso = metricsFor({ unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 }, projection: 'iso' as const });

function counting(): { g: Graphics; ops: string[]; rects: number[][] } {
  const ops: string[] = [];
  const rects: number[][] = [];
  const g: Record<string, unknown> = {};
  for (const op of ['clear', 'poly', 'rect', 'circle', 'moveTo', 'lineTo', 'fill', 'stroke']) {
    g[op] = (...args: unknown[]) => {
      ops.push(op);
      if (op === 'rect') rects.push(args as number[]);
      return g;
    };
  }
  return { g: g as unknown as Graphics, ops, rects };
}

/** A pool that never misses, so no real pixi Text is constructed. */
class StubPool extends Map<string, Text> {
  readonly made: string[] = [];
  override get(key: string): Text {
    let t = super.get(key);
    if (!t) {
      this.made.push(key);
      t = { text: '', style: { wordWrapWidth: 0 }, x: 0, y: 0, destroy: () => undefined } as unknown as Text;
      super.set(key, t);
    }
    return t;
  }
}

function scene(notes: Scene['geometry']['gmNotes'], doors: Scene['geometry']['doors'] = []): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Notes',
    state: 'active',
    grid: { unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 } },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: { walls: [], doors, zones: [], pins: [], gmNotes: notes },
    levels: [],
    mapAttachmentIds: [],
    fog: { regions: [], revealed: [], revealedShapes: [] },
  } as unknown as Scene;
}

const NOTE = { id: 'note_1', at: { x: 2, y: 2 }, text: 'The guard is asleep until someone shoots.', width: 4 };
const layer = {} as Container;

describe('drawNotes', () => {
  it('draws nothing at all for a player', () => {
    const c = counting();
    const pool = new StubPool();
    drawNotes(c.g, layer, pool, scene([NOTE]), flat, null, false);
    expect(c.ops).toEqual(['clear']);
    expect(pool.made).toEqual([]);
  });

  it('draws the GM the paper, the tack and the text, in both projections', () => {
    for (const m of [flat, iso]) {
      const c = counting();
      const pool = new StubPool();
      drawNotes(c.g, layer, pool, scene([NOTE]), m, null, true);
      expect(c.ops.filter((o) => o === 'rect').length).toBe(2); // shadow + paper
      expect(c.ops).toContain('circle');
      expect(pool.made).toEqual(['note:note_1']);
      const text = pool.get('note:note_1') as unknown as { text: string; style: { wordWrapWidth: number } };
      expect(text.text).toBe(NOTE.text);
      expect(text.style.wordWrapWidth).toBe(noteFrame(m, NOTE).wrap);
    }
  });

  it('rings the selected note, and forgets the text of a note that is gone', () => {
    const c = counting();
    const pool = new StubPool();
    drawNotes(c.g, layer, pool, scene([NOTE]), flat, 'note_1', true);
    expect(c.ops.filter((o) => o === 'rect').length).toBe(3);
    drawNotes(counting().g, layer, pool, scene([]), flat, null, true);
    expect(pool.size).toBe(0);
  });

  it('draws the box exactly where the hit-test looks', () => {
    const c = counting();
    drawNotes(c.g, layer, new StubPool(), scene([NOTE]), flat, null, true);
    const f = noteFrame(flat, NOTE);
    expect(c.rects[1]).toEqual([f.x, f.y, f.w, f.h]);
  });
});

describe('noteLines', () => {
  it('wraps by word, keeps blank lines, and never says zero', () => {
    expect(noteLines('', 100)).toBe(1);
    expect(noteLines('one two', 1000)).toBe(1);
    expect(noteLines('a\n\nb', 1000)).toBe(3);
    expect(noteLines('word '.repeat(40), 60)).toBeGreaterThan(10);
    // A wider note takes fewer lines.
    expect(noteLines(NOTE.text, 300)).toBeLessThan(noteLines(NOTE.text, 100));
  });
});

describe('a locked door on the map (FR9.24)', () => {
  const locked = { id: 'd1', a: { x: 2, y: 2 }, b: { x: 2, y: 4 }, open: false, locked: true };
  const unlocked = { ...locked, id: 'd2', locked: false };

  it('shows the GM a padlock, and a player the same knob as any other door', () => {
    const gm = counting();
    drawGeometry(gm.g, scene(undefined, [locked]), flat, true);
    expect(gm.ops.filter((o) => o === 'rect').length).toBe(1);

    const gmPlain = counting();
    drawGeometry(gmPlain.g, scene(undefined, [unlocked]), flat, true);
    expect(gmPlain.ops.filter((o) => o === 'rect').length).toBe(0);

    const pc = counting();
    drawGeometry(pc.g, scene(undefined, [locked]), flat, false);
    expect(pc.ops.filter((o) => o === 'rect').length).toBe(0);
    expect(pc.ops).toContain('circle'); // the knob is still the player's target
  });
});
