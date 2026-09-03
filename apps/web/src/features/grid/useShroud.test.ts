/**
 * Whose eyes the canvas shows (FR9.16).
 *
 * The resolution rules are where a mistake would be felt at the table: a
 * player shown the wrong character's sightline is worse than one shown none,
 * and a GM silently locked into a token's view cannot run the map.
 */
import { describe, expect, it } from 'vitest';
import type { Token } from '@safehouse/contracts';
import { viewpointTokenId, type ShroudInputs } from './useShroud.js';

const token = (id: string, over: Partial<Token> = {}): Token =>
  ({
    id,
    name: id,
    source: 'character',
    sourceId: `char-${id}`,
    x: 1.5,
    y: 1.5,
    size: 1,
    ...over,
  }) as Token;

const base = (over: Partial<ShroudInputs> = {}): ShroudInputs => ({
  scene: undefined,
  tokens: [],
  isGm: false,
  losTokenId: null,
  myCharacterId: null,
  enabledForPlayers: false,
  ...over,
});

describe('viewpointTokenId', () => {
  it('gives the GM nobody by default', () => {
    // A GM permanently limited to one token's view cannot do their job, so
    // the lens starts down.
    expect(viewpointTokenId(base({ isGm: true }))).toBeNull();
  });

  it('honours the GM pick, including an NPC', () => {
    // "What does the guard see" is the question that makes this worth having.
    const guard = token('guard', { source: 'combatant', sourceId: null });
    expect(viewpointTokenId(base({ isGm: true, losTokenId: 'guard', tokens: [guard] }))).toBe(
      'guard',
    );
  });

  it('shows a player nothing while the GM has it switched off', () => {
    const mine = token('t1');
    expect(
      viewpointTokenId(base({ tokens: [mine], myCharacterId: 'char-t1', enabledForPlayers: false })),
    ).toBeNull();
  });

  it('resolves a player to their OWN character token', () => {
    const mine = token('t1');
    const theirs = token('t2');
    expect(
      viewpointTokenId(
        base({ tokens: [theirs, mine], myCharacterId: 'char-t1', enabledForPlayers: true }),
      ),
    ).toBe('t1');
  });

  it('never hands a player somebody elses eyes', () => {
    // The failure that would matter: a device with no character of its own
    // must get NO viewpoint, not the first token on the map.
    const theirs = token('t2');
    expect(
      viewpointTokenId(base({ tokens: [theirs], myCharacterId: null, enabledForPlayers: true })),
    ).toBeNull();
    expect(
      viewpointTokenId(
        base({ tokens: [theirs], myCharacterId: 'char-nobody', enabledForPlayers: true }),
      ),
    ).toBeNull();
  });

  it('ignores a non-character token that happens to share a sourceId', () => {
    // Props and NPCs carry sourceIds too; only a character token is "mine".
    const prop = token('p1', { source: 'prop', sourceId: 'char-t1' });
    expect(
      viewpointTokenId(base({ tokens: [prop], myCharacterId: 'char-t1', enabledForPlayers: true })),
    ).toBeNull();
  });

  it('lets the GM pick win over their own party token', () => {
    const mine = token('t1');
    const guard = token('guard', { source: 'combatant', sourceId: null });
    expect(
      viewpointTokenId(
        base({
          isGm: true,
          losTokenId: 'guard',
          tokens: [mine, guard],
          myCharacterId: 'char-t1',
          enabledForPlayers: true,
        }),
      ),
    ).toBe('guard');
  });
});
