import { describe, expect, it } from 'vitest';
import { lookFor } from './figure.js';

describe('lookFor', () => {
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
});
