/**
 * FR12.19 — the spoiler guard is only a guard if the GM can see it.
 *
 * The server returns `SpoilerFlag[]` (`{name, why}`) on a player-facing draft.
 * A previous client kept only string entries, so every object flag was dropped
 * and the drafts inbox rendered no warning at all — the GM accepted a recap
 * naming a hidden NPC with nothing on the card to stop them.
 */
import { describe, expect, it } from 'vitest';
import { spoilerFlagsOf } from './api.js';
import type { AiGeneration } from './api.js';

const draft = (patch: Partial<AiGeneration>): AiGeneration =>
  ({ id: 'g1', kind: 'recap', status: 'draft', ...patch }) as AiGeneration;

describe('spoilerFlagsOf', () => {
  it('renders the object form the server actually sends', () => {
    const gen = draft({
      spoilerFlags: [
        { name: 'Ratchet — catwalk', why: 'hidden token, never revealed' },
        { name: 'the second buyer', why: 'GM-only wiki section' },
      ],
    });
    expect(spoilerFlagsOf(gen)).toEqual(['Ratchet — catwalk', 'the second buyer']);
  });

  it('still accepts the legacy string form', () => {
    const gen = draft({ spoilerFlags: ['Ratchet — catwalk'] } as Partial<AiGeneration>);
    expect(spoilerFlagsOf(gen)).toEqual(['Ratchet — catwalk']);
  });

  it('reads flags nested in the draft output', () => {
    const gen = draft({
      output: { text: 'recap…', spoilerFlags: [{ name: 'the lieutenant', why: 'not met yet' }] },
    });
    expect(spoilerFlagsOf(gen)).toEqual(['the lieutenant']);
  });

  it('drops malformed entries rather than rendering blanks', () => {
    // Deliberately off-contract values: the server is trusted, but a card that
    // renders an empty warning chip is worse than one that renders none.
    const gen = draft({
      spoilerFlags: [{ why: 'no name' }, { name: '' }, null, 42, { name: 'Ratchet' }] as never,
    });
    expect(spoilerFlagsOf(gen)).toEqual(['Ratchet']);
  });

  it('reports nothing for a clean draft', () => {
    expect(spoilerFlagsOf(draft({ output: { text: 'nothing hidden here' } }))).toEqual([]);
  });
});
