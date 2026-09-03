/**
 * The TV's "something changed that I cannot fold" trigger.
 *
 * The table display builds its scene from a REST read with the event stream
 * folded on top, and that fold understands exactly one field: `environment`.
 * Everything else the GM edits — the painted tile floor above all — reaches the
 * broadcast only as a *notification* that it changed, because the server
 * deliberately keeps GM-layer scene data out of a payload every socket sees.
 *
 * So the TV has to re-read. It did not: a GM could paint a warehouse floor and
 * the wall-sized screen kept showing the old map for up to ten minutes, until
 * the slow drift timer happened to fire. The grid had its own invalidation and
 * was fine, which is exactly why nobody noticed.
 *
 * These pin the trigger, not the redraw: given a stream, does the TV know it
 * must go back to the server?
 */
import { describe, expect, it } from 'vitest';
import { lastUnfoldableSceneEventId } from './hydrate.js';

type Ev = { id: number; type: string; payload: unknown };

const ev = (id: number, changed?: unknown, type = 'scene.updated'): Ev => ({
  id,
  type,
  payload: changed === undefined ? {} : { sceneId: 's1', changed },
});

describe('lastUnfoldableSceneEventId', () => {
  it('is quiet on an empty stream', () => {
    expect(lastUnfoldableSceneEventId([])).toBe(0);
  });

  it('ignores an environment-only edit, which the fold already applies', () => {
    expect(lastUnfoldableSceneEventId([ev(7, ['environment'])])).toBe(0);
  });

  it('fires on a painted tile floor — the case that was silently broken', () => {
    expect(lastUnfoldableSceneEventId([ev(7, ['tiles'])])).toBe(7);
  });

  it('fires when a tile paint rides along with an environment change', () => {
    // `changed` is `Object.keys(patch)`, so a combined write lists both. One
    // unfoldable member is enough; folding the other half is not a substitute.
    expect(lastUnfoldableSceneEventId([ev(9, ['environment', 'tiles'])])).toBe(9);
  });

  it('fires on geometry, grid and map changes too', () => {
    for (const field of ['geometry', 'grid', 'mapAttachmentIds', 'fog', 'name']) {
      expect(lastUnfoldableSceneEventId([ev(4, [field])])).toBe(4);
    }
  });

  it('re-reads when the event does not say what changed', () => {
    // Unconditionally correct beats clever: a re-read costs one request, and
    // guessing "probably nothing" is how the floor stayed stale.
    expect(lastUnfoldableSceneEventId([ev(3)])).toBe(3);
    expect(lastUnfoldableSceneEventId([ev(3, 'tiles')])).toBe(3);
    expect(lastUnfoldableSceneEventId([ev(3, [42])])).toBe(3);
  });

  it('ignores events that are not scene.updated', () => {
    expect(lastUnfoldableSceneEventId([ev(5, ['tiles'], 'token.moved')])).toBe(0);
    expect(lastUnfoldableSceneEventId([ev(5, undefined, 'scene.activated')])).toBe(0);
  });

  it('reports the highest id regardless of buffer order', () => {
    // The live store keeps its buffer ascending; "which read am I owed" must
    // not depend on that invariant holding at every call site.
    const out = lastUnfoldableSceneEventId([ev(12, ['tiles']), ev(4, ['tiles']), ev(9, ['grid'])]);
    expect(out).toBe(12);
  });

  it('only moves forward, so a paint stroke cannot loop the effect', () => {
    // The value is an effect dependency. A stroke arriving as six events must
    // settle, not oscillate between two ids and re-read forever.
    const stream = [ev(2, ['tiles']), ev(3, ['tiles']), ev(4, ['tiles'])];
    const first = lastUnfoldableSceneEventId(stream);
    expect(lastUnfoldableSceneEventId([...stream].reverse())).toBe(first);
    expect(lastUnfoldableSceneEventId([...stream, ev(5, ['environment'])])).toBe(first);
  });
});
