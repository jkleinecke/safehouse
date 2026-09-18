/**
 * The session log's roll card for the one roll that is not a success test:
 * the starting nuyen a build's approval rolls on the record (FR3.9,
 * docs/CHARGEN.md §8.5). The server marks it `request.meta.chargen ===
 * 'startingNuyen'` with the dice total and multiplier; read as an ordinary
 * roll its hits are 0, and the card told the table the runner started with
 * "0 hits". Pinned: the card shows total × multiplier = nuyen instead, keeps
 * its dice, and every other roll still shows hits. Invented runner names.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WsEvent } from '@safehouse/contracts';
import RollCard from './RollCard.js';
import { parseRoll, startingNuyenOf, type RollView } from './views.js';

function rollOf(payload: unknown): RollView {
  const event: WsEvent = { id: 7, type: 'roll.created', payload, visibility: 'gm_owner', ts: '2076-05-12T20:15:00.000Z' };
  const roll = parseRoll(event);
  if (!roll) throw new Error('not a roll');
  return roll;
}

/** What the server emits for an approval's roll (services/builds.ts), with invented numbers. */
const NUYEN_ROLL = {
  kind: 'simple',
  actor: { characterId: 'ch-1' },
  actorName: 'Kestrel Vane',
  label: 'Starting nuyen: 3D6 × 60',
  request: {
    kind: 'simple',
    pool: 3,
    breakdown: [{ label: 'low lifestyle', value: 3, source: 'chargen' }],
    meta: { label: 'Starting nuyen: 3D6 × 60', chargen: 'startingNuyen', sum: 12, multiplier: 60, nuyen: 720, carried: 1500, total: 2220 },
  },
  result: { faces: [2, 4, 6], hits: 0, ones: 0, glitch: 'none', limitedHits: 0 },
};

describe('a starting-nuyen roll', () => {
  it('reads as dice total × multiplier = nuyen', () => {
    expect(startingNuyenOf(rollOf(NUYEN_ROLL))).toEqual({ sum: 12, multiplier: 60, nuyen: 720 });
    // With only the faces and the multiplier, the total is the faces' sum.
    const bare = { ...NUYEN_ROLL, request: { ...NUYEN_ROLL.request, meta: { chargen: 'startingNuyen', multiplier: 100 } } };
    expect(startingNuyenOf(rollOf(bare))).toEqual({ sum: 12, multiplier: 100, nuyen: 1200 });
    // Anything else is an ordinary roll.
    const plain = { ...NUYEN_ROLL, request: { ...NUYEN_ROLL.request, meta: { label: 'Perception' } } };
    expect(startingNuyenOf(rollOf(plain))).toBeNull();
  });

  it('shows the nuyen on its card, never "0 hits", and keeps the dice', () => {
    const html = renderToStaticMarkup(<RollCard roll={rollOf(NUYEN_ROLL)} />);
    expect(html).toContain('data-testid="roll-starting-nuyen"');
    expect(html).toContain('12 × 60 = 720¥');
    expect(html).not.toMatch(/\b0 hits\b/);
    expect(html).toContain('aria-label="d6: 6"');
  });

  it('leaves every other roll showing its hits', () => {
    const perception = {
      ...NUYEN_ROLL,
      request: { ...NUYEN_ROLL.request, meta: { label: 'Perception' } },
      result: { faces: [5, 6, 2], hits: 2, ones: 0, glitch: 'none', limitedHits: 2 },
    };
    const html = renderToStaticMarkup(<RollCard roll={rollOf(perception)} />);
    expect(html).toContain('2 hits');
    expect(html).not.toContain('roll-starting-nuyen');
  });
});
