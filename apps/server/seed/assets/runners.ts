/**
 * The demo run's table: an ork street samurai, an elf hermetic mage, and a
 * human adept — the three archetypes the real table plays.
 *
 * ORIGINAL FICTION (G6/§14). Aliases, gear names and quality/power names are
 * invented; `{ book: 'SR5', page: n }` refs are page NUMBERS only, cited the
 * way a GM cites their own shelf. The numbers are modest and engine-valid:
 * `deriveCharacter` turns each of these into limits, monitors, five
 * initiative variants and a pool per skill/weapon/spell, all with provenance.
 */
import type { SheetV1Input } from '@safehouse/contracts';
import { RANGE_TABLES } from './ranges.js';

export const TORQUE: SheetV1Input = {
  v: 1,
  identity: {
    alias: 'Torque',
    metatype: 'ork',
    notes: 'Nine years of dock security, then one night she decided which side of the fence she was on.',
  },
  attributes: {
    bod: 6, agi: 5, rea: 4, str: 6, wil: 4, log: 2, int: 3, cha: 2,
    edg: { max: 3, current: 3 },
    ess: 6, mag: 0, res: 0,
  },
  skills: [
    { id: 'pistols', rating: 6, attr: 'agi', spec: 'semi-automatics' },
    { id: 'unarmed-combat', rating: 3, attr: 'agi' },
    { id: 'perception', rating: 3, attr: 'int' },
    { id: 'intimidation', rating: 3, attr: 'cha' },
    { id: 'sneaking', rating: 2, attr: 'agi' },
    { id: 'first-aid', rating: 2, attr: 'log' },
  ],
  qualities: [
    { name: 'Slow to rattle', mods: [], note: 'Composure comes easy. Subtlety does not.' },
  ],
  augments: [
    {
      name: 'Wired reflexes, first grade',
      essence: 2,
      ref: { book: 'SR5', page: 455 },
      mods: [
        { id: 'torque.wired.rea', source: { kind: 'cyberware', ref: 'wired reflexes' }, target: 'attr.rea', op: 'add', value: 1, active: true },
        { id: 'torque.wired.dice', source: { kind: 'cyberware', ref: 'wired reflexes' }, target: 'initiative.dice', op: 'add', value: 1, active: true, note: 'One extra Initiative Die (2d6 total).' },
      ],
    },
    {
      name: 'Targeting overlay, ocular',
      essence: 0.2,
      mods: [
        { id: 'torque.overlay.hammer', source: { kind: 'cyberware', ref: 'targeting overlay' }, target: 'pool.weapon.Hammer', op: 'add', value: 2, active: true, note: 'Paired to the Hammer only.' },
      ],
    },
  ],
  weapons: [
    {
      name: 'Hammer',
      skillId: 'pistols',
      acc: 5,
      dv: '8P',
      ap: -1,
      modes: ['SA'],
      rangeCat: 'heavy_pistol',
      ammo: { cap: 16, current: 16 },
      recoilComp: 1,
      ref: { book: 'SR5', page: 426 },
      note: 'A slab-sided company heavy pistol, rebuilt twice and named after what it does.',
    },
  ],
  armor: [{ name: 'Armoured jacket, patched', rating: 12, worn: true, ref: { book: 'SR5', page: 437 } }],
  gear: [
    { name: 'Commlink, mid-tier', qty: 1, rating: 3 },
    { name: 'Spare magazine', qty: 3 },
    { name: 'Medkit', qty: 1, rating: 3 },
  ],
  lifestyles: [{ name: 'Low', costPerMonth: 2000, paidThrough: '2076-06-30' }],
  rangeTables: { ...RANGE_TABLES },
};

export const WHISPER: SheetV1Input = {
  v: 1,
  identity: {
    alias: 'Whisper',
    metatype: 'elf',
    notes: 'Hermetic. Keeps a ledger of every favour the spirits have done her, and it balances.',
  },
  attributes: {
    bod: 3, agi: 4, rea: 4, str: 2, wil: 5, log: 6, int: 4, cha: 5,
    edg: { max: 3, current: 3 },
    ess: 6, mag: 6, res: 0,
  },
  skills: [
    { id: 'spellcasting', rating: 6, attr: 'mag' },
    { id: 'counterspelling', rating: 3, attr: 'mag' },
    { id: 'summoning', rating: 4, attr: 'mag' },
    { id: 'binding', rating: 2, attr: 'mag' },
    { id: 'assensing', rating: 3, attr: 'int' },
    { id: 'perception', rating: 2, attr: 'int' },
    { id: 'negotiation', rating: 3, attr: 'cha' },
    { id: 'pistols', rating: 1, attr: 'agi' },
  ],
  qualities: [
    { name: 'Keeps her books', mods: [], note: 'Formulae, debts and grudges, all in the same notebook.' },
  ],
  spells: [
    {
      name: 'Neural Spike',
      category: 'combat',
      drain: 'F-3',
      ref: { book: 'SR5', page: 283 },
      note: 'A lance of ordered thought. Leaves a nosebleed and a few missing seconds; no mark on the armour.',
    },
    {
      name: 'Hush',
      category: 'manipulation',
      drain: 'F-2',
      note: 'Deadens sound inside a three-metre bubble. Excellent for doors, terrible for conversation.',
    },
  ],
  weapons: [
    {
      name: 'Palm pistol',
      skillId: 'pistols',
      acc: 4,
      dv: '6P',
      ap: 0,
      modes: ['SA'],
      rangeCat: 'holdout',
      ammo: { cap: 6, current: 6 },
      note: 'Carried the way other people carry an umbrella: reluctantly, and never used.',
    },
  ],
  armor: [{ name: 'Weave-lined longcoat', rating: 9, worn: true }],
  gear: [
    // INTEGRATION: SheetV1 has no bound-spirit slot (§9.3), so the spirit rides
    // as a gear record with its Force in `rating` and services in the note.
    {
      name: 'Bound spirit — Ash-of-Kettles (Force 4)',
      qty: 1,
      rating: 4,
      note: '2 services remaining. Answers to a kettle left to boil dry; sulks if asked to be subtle.',
    },
    { name: 'Reagents, common', qty: 6 },
    { name: 'Commlink, mid-tier', qty: 1, rating: 3 },
  ],
  lifestyles: [{ name: 'Middle', costPerMonth: 5000, paidThrough: '2076-06-30' }],
  rangeTables: { ...RANGE_TABLES },
};

export const SPARROW: SheetV1Input = {
  v: 1,
  identity: {
    alias: 'Sparrow',
    metatype: 'human',
    notes: 'Adept. Talks about the magic the way a bricklayer talks about bricks.',
  },
  attributes: {
    bod: 4, agi: 6, rea: 5, str: 4, wil: 4, log: 3, int: 5, cha: 3,
    edg: { max: 5, current: 5 },
    ess: 6, mag: 5, res: 0,
  },
  skills: [
    { id: 'unarmed-combat', rating: 6, attr: 'agi' },
    { id: 'gymnastics', rating: 5, attr: 'agi' },
    { id: 'sneaking', rating: 5, attr: 'agi' },
    { id: 'perception', rating: 4, attr: 'int' },
    { id: 'con', rating: 2, attr: 'cha' },
    { id: 'running', rating: 2, attr: 'str' },
  ],
  powers: [
    {
      name: 'Quickened Reflexes',
      rating: 1,
      cost: 1.5,
      ref: { book: 'SR5', page: 310 },
      mods: [
        { id: 'sparrow.reflexes.rea', source: { kind: 'power', ref: 'Quickened Reflexes' }, target: 'attr.rea', op: 'add', value: 1, active: true },
        { id: 'sparrow.reflexes.dice', source: { kind: 'power', ref: 'Quickened Reflexes' }, target: 'initiative.dice', op: 'add', value: 1, active: true, note: 'One extra Initiative Die (2d6 total).' },
      ],
    },
    {
      name: 'Iron Palm',
      rating: 1,
      cost: 0.5,
      mods: [],
      note: 'Bare hands do Physical damage — the "Killing hands" weapon line carries the DV.',
    },
    {
      name: 'Read the Room',
      rating: 2,
      cost: 1,
      mods: [
        { id: 'sparrow.readroom.defense', source: { kind: 'power', ref: 'Read the Room' }, target: 'pool.defense', op: 'add', value: 2, active: true, note: 'She is moving before the trigger finishes travelling.' },
      ],
    },
    {
      name: 'Soft Landing',
      rating: 1,
      cost: 0.5,
      mods: [
        { id: 'sparrow.soft.gym', source: { kind: 'power', ref: 'Soft Landing' }, target: 'pool.skill.gymnastics', op: 'add', value: 2, active: true },
      ],
    },
  ],
  weapons: [
    { name: 'Killing hands', skillId: 'unarmed-combat', acc: 6, dv: '5P', ap: 0, modes: [], note: 'Open hand, closed distance.' },
  ],
  armor: [{ name: 'Lined jacket', rating: 8, worn: true }],
  gear: [
    { name: 'Grapple line, 20 m', qty: 1 },
    { name: 'Commlink, cheap', qty: 1, rating: 2 },
  ],
  lifestyles: [{ name: 'Low', costPerMonth: 2000, paidThrough: '2076-06-30' }],
  rangeTables: { ...RANGE_TABLES },
};

/** Seeding order, with the one-line reason each sheet is in the demo. */
export const PARTY: ReadonlyArray<{ sheet: SheetV1Input; blurb: string }> = [
  { sheet: TORQUE, blurb: 'ork street samurai — wired, 2d6 initiative, armour 12' },
  { sheet: WHISPER, blurb: 'elf hermetic — Neural Spike (F−3), one bound Force 4 spirit' },
  { sheet: SPARROW, blurb: 'human adept — quickened, killing hands, defence 13' },
];
