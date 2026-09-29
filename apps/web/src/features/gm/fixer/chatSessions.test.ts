/**
 * A chat panel that remounts finds its session as it left it, and its
 * scroller goes back where the GM had it.
 */
import { describe, expect, it } from 'vitest';
import { keyed, readScroll, restoreScroll } from './chatSessions.js';

describe('keyed', () => {
  it('makes one value per key and hands the same one back', () => {
    const get = keyed<{ n: number }>();
    let made = 0;
    const make = () => ({ n: ++made });
    const a = get('c1', make);
    expect(get('c1', make)).toBe(a);
    expect(get('c2', make)).not.toBe(a);
    expect(made).toBe(2);
  });
});

describe('scroll', () => {
  const box = (scrollTop: number) => ({ scrollTop, scrollHeight: 1000, clientHeight: 400 });

  it('knows the end from a spot above it', () => {
    expect(readScroll(box(600))).toEqual({ top: 600, atBottom: true });
    expect(readScroll(box(595))).toEqual({ top: 595, atBottom: true });
    expect(readScroll(box(200))).toEqual({ top: 200, atBottom: false });
  });

  it('goes back where it was, or to the end if it was there', () => {
    expect(restoreScroll({ top: 200, atBottom: false }, box(0))).toBe(200);
    expect(restoreScroll({ top: 600, atBottom: true }, { scrollTop: 0, scrollHeight: 1500, clientHeight: 400 })).toBe(1500);
    expect(restoreScroll(null, box(0))).toBe(1000);
  });
});
