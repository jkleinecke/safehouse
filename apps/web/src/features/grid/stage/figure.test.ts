import { describe, expect, it } from 'vitest';
import type { Graphics } from 'pixi.js';
import { drawFigure, lookFor, poseTop, type FigurePose } from './figure.js';

/** A stand-in graphics that counts what is drawn and checks every point is a number. */
function recorder() {
  const calls = { poly: 0, stroke: 0, circle: 0, bad: 0 };
  const check = (...xs: unknown[]) => {
    for (const x of xs.flat(2)) {
      const v = typeof x === 'object' && x !== null ? [(x as { x: number }).x, (x as { y: number }).y] : [x];
      for (const n of v) if (typeof n === 'number' && !Number.isFinite(n)) calls.bad += 1;
    }
  };
  const g: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls | null) => (...args: unknown[]) => {
    check(...args);
    if (name) calls[name] += 1;
    return g;
  };
  Object.assign(g, {
    clear: chain(null),
    poly: chain('poly'),
    fill: chain(null),
    stroke: chain('stroke'),
    circle: chain('circle'),
    moveTo: chain(null),
    lineTo: chain(null),
  });
  return { g: g as unknown as Graphics, calls };
}

const frame = (pose: FigurePose, facing: number) => ({ pose, facing, phase: 1, stride: 1, bleeding: true });

describe('the isometric figure', () => {
  it('draws every pose at every facing, with finite points throughout', () => {
    const look = lookFor({ id: 'runner-1', source: 'character' });
    for (const pose of ['stand', 'crouch', 'prone', 'down'] as const) {
      for (let i = 0; i < 16; i += 1) {
        const { g, calls } = recorder();
        drawFigure(g, 30, 64, frame(pose, (i / 16) * Math.PI * 2), look);
        expect(calls.bad).toBe(0);
        // A shadow, some of the torso box, a head, four limbs.
        expect(calls.poly).toBeGreaterThanOrEqual(2);
        expect(calls.circle).toBeGreaterThanOrEqual(3);
        expect(calls.stroke).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('shows a box its three near faces and none of the far ones', () => {
    const crate = lookFor({ id: 'crate', source: 'prop' });
    const { g, calls } = recorder();
    drawFigure(g, 30, 64, frame('stand', 0), crate);
    // The shadow, then the top and the two faces toward the viewer.
    expect(calls.poly).toBe(4);
  });

  it('draws every archetype and metatype in every pose', () => {
    const names = ['Street Samurai', 'Decker', 'Mage', 'Rigger', 'Mr. Johnson', 'Adept', 'Ganger', 'Lone Star Officer', 'Bartender'];
    const metas = ['', 'Elf ', 'Dwarf ', 'Ork ', 'Troll '];
    for (const [i, n] of names.entries()) {
      for (const meta of metas) {
        for (const id of ['a', 'b', 'c']) {
          const look = lookFor({ id: `${id}${i}`, source: 'character', name: meta + n });
          for (const pose of ['stand', 'crouch', 'prone', 'down'] as const) {
            const { g, calls } = recorder();
            drawFigure(g, 30, 64, frame(pose, i + 0.3), look);
            expect(calls.bad).toBe(0);
          }
        }
      }
    }
  });

  it('reads what a token is from its name', () => {
    const t = lookFor({ id: 'x', source: 'combatant', name: 'Troll Street Samurai' });
    expect(t.metatype).toBe('troll');
    expect(t.archetype).toBe('samurai');
    expect(t.build.h).toBeGreaterThan(1);
    const guard = lookFor({ id: 'y', source: 'npc_template', name: 'Knight Errant Guard' });
    expect(guard.archetype).toBe('security');
    expect(guard.outfit).toBe('armor');
    // The side's colour: runners and the opposition never share one.
    expect(lookFor({ id: 'z', source: 'character' }).neon).not.toBe(lookFor({ id: 'z', source: 'combatant' }).neon);
  });

  it('keeps one look per token, so a runner is the same runner every session', () => {
    expect(lookFor({ id: 'abc', source: 'character' })).toEqual(lookFor({ id: 'abc', source: 'character' }));
    expect(lookFor({ id: 'abc', source: 'prop' }).crate).toBe(true);
  });

  it('puts the badge over the head, lower as the figure gets lower', () => {
    expect(poseTop('stand', false)).toBeGreaterThan(poseTop('crouch', false));
    expect(poseTop('crouch', false)).toBeGreaterThan(poseTop('prone', false));
  });
});
