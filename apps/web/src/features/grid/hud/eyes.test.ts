import { describe, expect, it } from 'vitest';
import { availableModes, clampMode } from './eyes.js';

describe('availableModes', () => {
  it('gives a player the modes on their sheet, drawable ones only', () => {
    expect(availableModes(false, null)).toEqual(['normal']);
    expect(availableModes(false, { identity: { metatype: 'human' } })).toEqual(['normal']);
    expect(availableModes(false, { identity: { metatype: 'troll' } })).toEqual(['normal', 'thermographic']);
    expect(
      availableModes(false, {
        identity: { metatype: 'elf' },
        qualities: [{ name: 'Astral Perception' }],
        gear: [{ name: 'Ultrasound goggles' }],
      }),
    ).toEqual(['normal', 'lowlight', 'ultrasound']);
  });

  it('gives the GM every drawable mode', () => {
    expect(availableModes(true, null)).toEqual(['normal', 'lowlight', 'thermographic', 'ultrasound']);
  });

  it('falls back to normal when the sheet stops granting the mode', () => {
    expect(clampMode('thermographic', ['normal', 'thermographic'])).toBe('thermographic');
    expect(clampMode('thermographic', ['normal'])).toBe('normal');
  });
});
