/**
 * The sightline shroud's redraw key (FR9.16).
 *
 * It must move when the SHAPE changes, not just the size. A token stepping
 * sideways behind a pillar reveals one cell and hides another — identical
 * count, completely different picture — and that is precisely the move a
 * player makes when checking an angle.
 *
 * (The 2D scrim's own tests — nothing drawn for an empty set, and a scrim
 * swept up to cover the wall on a hidden square — went with it in P5.)
 */
import { describe, expect, it } from 'vitest';
import { shroudKey } from './shroud.js';

const setOf = (...keys: string[]) => new Set(keys);

describe('shroudKey', () => {
  it('is stable for the same set, whatever order it iterates', () => {
    const a = shroudKey({ visible: setOf('1,1', '2,2', '3,0'), gm: false });
    const b = shroudKey({ visible: setOf('3,0', '1,1', '2,2'), gm: false });
    expect(a).toBe(b);
  });

  it('MOVES when the shape changes but the count does not', () => {
    // The bug this exists to prevent: sidestep behind a pillar, one cell in,
    // one cell out, canvas never redraws, player reads a stale sightline.
    const before = shroudKey({ visible: setOf('1,1', '2,2'), gm: false });
    const after = shroudKey({ visible: setOf('1,1', '3,3'), gm: false });
    expect(after).not.toBe(before);
  });

  it('distinguishes a GM lens from a player limit', () => {
    // Different scrim opacity, so the same set must redraw when the role
    // changes — otherwise a GM opening a player view keeps the light wash.
    const s = setOf('1,1');
    expect(shroudKey({ visible: s, gm: true })).not.toBe(shroudKey({ visible: s, gm: false }));
  });

  it('treats no viewpoint and an empty set as the same nothing', () => {
    expect(shroudKey(null)).toBe(shroudKey({ visible: setOf(), gm: false }));
  });

  it('redraws when a crate becomes a wall, though nothing became visible', () => {
    // The silhouette changed and the visible set did not, so a key hashing
    // only the set would have frozen the 2D scrim at the old shape.
    const visible = setOf('0,0');
    const short = shroudKey({ visible, gm: false, heights: new Map([['1,1', 0.5]]) });
    const tall = shroudKey({ visible, gm: false, heights: new Map([['1,1', 1]]) });
    expect(tall).not.toBe(short);
    // And an unchanged scene still keys identically, so nothing redraws for free.
    expect(shroudKey({ visible, gm: false, heights: new Map([['1,1', 1]]) })).toBe(tall);
  });
});
