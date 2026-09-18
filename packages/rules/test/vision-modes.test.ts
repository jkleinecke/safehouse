/**
 * Which eyes a runner has (vision/modes.ts): metatype first, then whatever
 * the sheet's augments and gear say by name.
 */
import { describe, expect, it } from 'vitest';
import { metatypeVision, modesFromName, visionModesFor } from '../src/vision/modes.js';

type Like = Parameters<typeof visionModesFor>[0];
const sheet = ({ metatype = 'human', ...rest }: Partial<Omit<Like, 'identity'>> & { metatype?: string } = {}): Like => ({
  identity: { metatype },
  augments: [],
  gear: [],
  qualities: [],
  ...rest,
});

describe('metatype vision', () => {
  it('follows the metatype table — dwarfs and trolls thermographic, elves and orks low-light (SR5 p.66)', () => {
    expect(metatypeVision('troll')).toEqual(['thermographic']);
    expect(metatypeVision('Elf')).toEqual(['lowlight']);
    expect(metatypeVision('dwarf')).toEqual(['thermographic']);
    expect(metatypeVision('ork')).toEqual(['lowlight']);
    expect(metatypeVision('orc')).toEqual(['lowlight']);
    expect(metatypeVision('human')).toEqual([]);
    expect(metatypeVision(undefined)).toEqual([]);
    expect(metatypeVision('Street Legend')).toEqual([]);
  });

  it('gives Run Faster metavariants and metasapients the eyes their rows list (RF p.104–105)', () => {
    expect(metatypeVision('gnome')).toEqual(['thermographic']);
    expect(metatypeVision('ogre')).toEqual(['lowlight']);
    expect(metatypeVision('centaur')).toEqual(['lowlight', 'thermographic']);
    expect(metatypeVision('pixie')).toEqual(['astral']);
  });
});

describe('modes from an item name', () => {
  it('reads thermographic, low-light and ultrasound off the words on the item', () => {
    expect(modesFromName('Cybereyes (R2): thermographic, smartlink')).toEqual(['thermographic']);
    expect(modesFromName('Low-light goggles')).toEqual(['lowlight']);
    expect(modesFromName('Goggles', 'lowlight vision enhancement')).toEqual(['lowlight']);
    expect(modesFromName('Ultrasound sensor')).toEqual(['ultrasound']);
    expect(modesFromName('Ares Predator V')).toEqual([]);
  });
});

describe('visionModesFor', () => {
  it('is normal alone for a bare human', () => {
    expect(visionModesFor(sheet())).toEqual(['normal']);
  });

  it('collapses a troll with thermographic cybereyes to one thermographic', () => {
    const modes = visionModesFor(
      sheet({ metatype: 'troll', augments: [{ name: 'Cybereyes with thermographic vision' }] }),
    );
    expect(modes).toEqual(['normal', 'thermographic']);
  });

  it('lists every mode the sheet grants, in the fixed order', () => {
    const modes = visionModesFor(
      sheet({
        metatype: 'elf',
        gear: [{ name: 'Ultrasound goggles' }],
        qualities: [{ name: 'Astral Perception' }],
      }),
    );
    expect(modes).toEqual(['normal', 'lowlight', 'ultrasound', 'astral']);
  });
});
