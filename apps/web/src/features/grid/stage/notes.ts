/**
 * GM notes (FR9.25): where a note's box is, in world px — pure, no pixi.
 *
 * The one measurement the drawing and the hit-test both need. A note is
 * anchored at a grid point and is `width` cells wide; its height follows its
 * text, so the same wrap estimate has to answer "where do I paint it" and
 * "did the GM click it", or a note could be clicked where it is not drawn.
 */
import type { Note } from '@safehouse/contracts';
import { worldFromGrid, type SceneMetrics } from '../geometry.js';

export const NOTE_FONT_PX = 12;
export const NOTE_LINE_PX = 15;
export const NOTE_PAD_PX = 6;
/** Average glyph advance for the label font at NOTE_FONT_PX. */
const GLYPH_PX = 6.6;

export interface NoteFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text wrap width inside the padding. */
  wrap: number;
}

/** How many lines `text` takes when wrapped at `wrapPx`, greedy by word. */
export function noteLines(text: string, wrapPx: number): number {
  const perLine = Math.max(4, Math.floor(wrapPx / GLYPH_PX));
  let lines = 0;
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let used = 0;
    let count = 1;
    for (const w of words) {
      const len = Math.min(w.length, perLine);
      if (used === 0) used = len;
      else if (used + 1 + len <= perLine) used += 1 + len;
      else {
        count += 1;
        used = len;
      }
    }
    lines += count;
  }
  return Math.max(1, lines);
}

/** The note's box, top-left at its anchor, in world px. */
export function noteFrame(m: SceneMetrics, note: Pick<Note, 'at' | 'width' | 'text'>): NoteFrame {
  const at = worldFromGrid(m, note.at);
  // Width in cells is a plan-view notion; on an isometric map a cell's screen
  // width is the diamond's width, which is what `m.cell` is either way.
  const w = Math.max(3 * NOTE_FONT_PX, note.width * m.cell);
  const wrap = w - NOTE_PAD_PX * 2;
  const h = NOTE_PAD_PX * 2 + noteLines(note.text, wrap) * NOTE_LINE_PX;
  return { x: at.x, y: at.y, w, h, wrap };
}

/** Is world point `p` inside the note's box? */
export function inNoteFrame(f: NoteFrame, p: { x: number; y: number }): boolean {
  return p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h;
}
