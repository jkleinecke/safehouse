/** The rack chips say their name (docs/UX_SITE.md, Similarity): "Pistols 8", not six chips that all say "SKIL". */
import { describe, expect, it } from 'vitest';
import { chipLabel } from './CopilotRack.js';
import type { RackEntry } from './quickRolls.js';

const entry = (label: string, kind = 'skill'): RackEntry => ({ key: label, label, kind, pool: 8 }) as RackEntry;

describe('chipLabel', () => {
  it('is the row’s own name', () => {
    expect(chipLabel(entry('Pistols'))).toBe('Pistols');
    expect(chipLabel(entry('Attack', 'attack'))).toBe('Attack');
    expect(chipLabel(entry('Sneaking'))).not.toBe(chipLabel(entry('Pistols')));
  });

  it('clips a long name and falls back to the kind', () => {
    expect(chipLabel(entry('Exotic Ranged Weapon (Laser)'))).toBe('Exotic Ranged W…');
    expect(chipLabel(entry('   ', 'soak'))).toBe('soak');
  });
});
