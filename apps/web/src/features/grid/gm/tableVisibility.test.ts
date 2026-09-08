/**
 * The Scenes tab tells the GM what the TABLE will see (FR9.1, FR9.13).
 *
 * The GM's own fog is a 40% tint they read straight through; the players' is
 * opaque. So a scene with regions defined and none revealed looks fine from
 * the console and arrives on every phone as a black screen — which is exactly
 * how the first club scene went live. This sentence is the only place that
 * difference is written down where the push button is.
 */
import { describe, expect, it } from 'vitest';
import type { Scene } from '@safehouse/contracts';
import { tableVisibility } from './ScenesTab.js';

function withFog(fog: Scene['fog']): Scene {
  return { fog } as unknown as Scene;
}

const square = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

describe('tableVisibility', () => {
  it('says an unfogged scene is fully visible', () => {
    const text = tableVisibility(withFog({ regions: [], revealed: [], revealedShapes: [] }));
    expect(text).toContain('see the whole map');
  });

  it('warns, in the words black screen, when every region is hidden', () => {
    const text = tableVisibility(
      withFog({ regions: [{ id: 'a', name: 'Bar', polygon: square }], revealed: [], revealedShapes: [] }),
    );
    expect(text).toContain('black screen');
    expect(text).toContain('Reveal one');
  });

  it('counts what is open once something is', () => {
    const text = tableVisibility(
      withFog({
        regions: [
          { id: 'a', name: 'Bar', polygon: square },
          { id: 'b', name: 'Back room', polygon: square },
        ],
        revealed: ['a'],
        revealedShapes: [],
      }),
    );
    expect(text).toContain('1 of 2 regions');
  });

  it('treats a brushed reveal as something the players can see', () => {
    const text = tableVisibility(
      withFog({ regions: [{ id: 'a', name: 'Bar', polygon: square }], revealed: [], revealedShapes: [square] }),
    );
    expect(text).not.toContain('black screen');
  });
});
