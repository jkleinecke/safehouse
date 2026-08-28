/**
 * The Rusted Halo — the demo run's opposition, and the roll table the GM
 * reaches for when the plan survives contact.
 *
 * ORIGINAL FICTION ONLY (G6/§14). The archetype is *generation ranges*, not a
 * stat block: the engine rolls each body inside the GM's own curves (FR10.1),
 * so no two gangers are the same and nothing here transcribes a published NPC.
 * Loadout slots reference records that live on this template's own statblock,
 * which is how the server resolves them (`catalogOf`, FR10.1).
 */
import type { GenTemplate, Persona, SheetV1Input } from '@safehouse/contracts';
import { RANGE_TABLES } from './ranges.js';

export interface TemplatePayload {
  name: string;
  statblock: Partial<SheetV1Input>;
  gen: GenTemplate;
  persona: Partial<Persona>;
}

const r = (min: number, max: number): { min: number; max: number } => ({ min, max });

// ---------------------------------------------------------------------------
// The gang's kit — the catalog the loadout slots pick from
// ---------------------------------------------------------------------------

const HALO_KIT: Partial<SheetV1Input> = {
  weapons: [
    {
      name: 'Scrapyard machine pistol',
      skillId: 'automatics',
      acc: 4,
      dv: '7P',
      ap: 0,
      modes: ['SA', 'BF'],
      rangeCat: 'machine_pistol',
      ammo: { cap: 32, current: 32 },
      recoilComp: 1,
      note: 'Three donor frames and a printed lower. Loud, cheap, everywhere on the docks.',
    },
    {
      name: 'Cut-down dock gun',
      skillId: 'longarms',
      acc: 4,
      dv: '9S',
      ap: 0,
      modes: ['SS', 'SA'],
      rangeCat: 'shotgun',
      ammo: { cap: 5, current: 5 },
      note: 'A shortened bird gun loaded with whatever the gang could press that week.',
    },
    {
      name: 'Length of rebar',
      skillId: 'clubs',
      acc: 4,
      dv: '6P',
      ap: 0,
      modes: [],
      note: 'Free, deniable, and the Halo carry it like a badge.',
    },
  ],
  armor: [
    { name: 'Studded riot jacket', rating: 9, worn: true },
    { name: 'Plated dock vest', rating: 11, worn: true },
  ],
  gear: [
    { name: 'Burner commlink', qty: 1, rating: 1 },
    { name: 'Stim patch', qty: 1, rating: 2 },
  ],
  rangeTables: { ...RANGE_TABLES },
};

const HALO_LOADOUT = [
  { slot: 'primary-weapon', options: ['Scrapyard machine pistol', 'Cut-down dock gun', 'Length of rebar'] },
  { slot: 'armor', options: ['Studded riot jacket', 'Plated dock vest'] },
  { slot: 'utility', options: ['Burner commlink', 'Stim patch'] },
];

// ---------------------------------------------------------------------------
// Archetype template: street → blooded → pro
// ---------------------------------------------------------------------------

export const RUSTED_HALO_TEMPLATE: TemplatePayload = {
  name: 'Rusted Halo ganger',
  statblock: HALO_KIT,
  gen: {
    roleTags: ['ganger', 'muscle', 'street', 'docklands'],
    tiers: [
      {
        id: 'street',
        label: 'Tag-along',
        attributes: {
          bod: r(3, 4), agi: r(3, 4), rea: r(2, 4), str: r(3, 5),
          wil: r(2, 3), log: r(1, 3), int: r(2, 3), cha: r(2, 3),
        },
        skills: {
          pistols: r(1, 3), clubs: r(2, 3), perception: r(1, 3), intimidation: r(2, 3),
        },
        professionalRating: r(1, 2),
        metatypeWeights: { human: 3, ork: 3, dwarf: 1, elf: 1 },
        loadout: HALO_LOADOUT,
        spells: [],
        augments: [],
      },
      {
        id: 'blooded',
        label: 'Blooded',
        attributes: {
          bod: r(4, 5), agi: r(4, 5), rea: r(3, 5), str: r(4, 6),
          wil: r(3, 4), log: r(2, 3), int: r(3, 4), cha: r(2, 4),
        },
        skills: {
          automatics: r(3, 4), longarms: r(2, 4), clubs: r(3, 4),
          perception: r(2, 4), intimidation: r(3, 4), sneaking: r(2, 3),
        },
        professionalRating: r(2, 3),
        metatypeWeights: { human: 3, ork: 4, dwarf: 1, troll: 1 },
        loadout: HALO_LOADOUT,
        spells: [],
        augments: [],
      },
      {
        id: 'pro',
        label: 'Halo proper',
        attributes: {
          bod: r(5, 6), agi: r(5, 6), rea: r(4, 6), str: r(5, 7),
          wil: r(4, 5), log: r(3, 4), int: r(4, 5), cha: r(3, 4),
        },
        skills: {
          automatics: r(4, 6), longarms: r(3, 5), clubs: r(3, 5),
          perception: r(3, 5), intimidation: r(4, 5), sneaking: r(3, 4), leadership: r(2, 4),
        },
        professionalRating: r(3, 4),
        metatypeWeights: { human: 2, ork: 4, troll: 2, dwarf: 1 },
        loadout: HALO_LOADOUT,
        spells: [],
        augments: [],
      },
    ],
  },
  persona: {
    traits: ['territorial about a pier nobody else wants', 'loud first, thoughtful never'],
    voice: 'Docklands clipped. Short sentences, long pauses, everything phrased as a dare.',
    goals: ['Hold the shed until the buyer pays', 'Look unbothered in front of the others'],
    secrets: ['Nobody in the crew has been paid in five weeks.'],
    knowledge: ['Which roof lamps are dead', 'That the east stair tread is rotten'],
    mannerisms: ['Rings a knuckle off the nearest steel before speaking'],
    hooks: ['Will take a bribe if it can be framed as a toll rather than a bribe.'],
  },
};

// ---------------------------------------------------------------------------
// The lieutenant — a named NPC with a persona the Fixer can speak as (FR12.6)
// ---------------------------------------------------------------------------

export const RATCHET_TEMPLATE: TemplatePayload = {
  name: 'Marta "Ratchet" Vey — Halo lieutenant',
  statblock: {
    v: 1,
    identity: {
      alias: 'Marta "Ratchet" Vey',
      metatype: 'ork',
      notes: 'Runs the Pier 23 crew. Keeps the shed, the keycard, and the temper.',
    },
    attributes: {
      bod: 6, agi: 4, rea: 4, str: 6, wil: 5, log: 3, int: 4, cha: 4,
      edg: { max: 4, current: 4 },
      ess: 6,
      mag: 0,
      res: 0,
    },
    skills: [
      { id: 'automatics', rating: 5, attr: 'agi' },
      { id: 'longarms', rating: 4, attr: 'agi' },
      { id: 'clubs', rating: 4, attr: 'agi' },
      { id: 'intimidation', rating: 5, attr: 'cha' },
      { id: 'perception', rating: 4, attr: 'int' },
      { id: 'leadership', rating: 3, attr: 'cha' },
      { id: 'negotiation', rating: 3, attr: 'cha' },
    ],
    qualities: [
      {
        name: 'Holds the line',
        mods: [],
        note: 'She does not break first. The crew reads her posture before they read the room.',
      },
    ],
    augments: [
      {
        name: 'Salvaged reflex trigger',
        essence: 0.6,
        mods: [
          {
            id: 'ratchet.trigger.dice',
            source: { kind: 'cyberware', ref: 'Salvaged reflex trigger' },
            target: 'initiative.dice',
            op: 'add',
            value: 1,
            active: true,
            note: 'Second-hand and badly tuned; she twitches when it is idle.',
          },
        ],
      },
    ],
    weapons: [
      {
        name: 'Scrapyard machine pistol',
        skillId: 'automatics',
        acc: 4,
        dv: '7P',
        ap: 0,
        modes: ['SA', 'BF'],
        rangeCat: 'machine_pistol',
        ammo: { cap: 32, current: 32 },
        recoilComp: 2,
      },
      { name: 'Length of rebar', skillId: 'clubs', acc: 4, dv: '7P', ap: 0, modes: [] },
    ],
    armor: [{ name: 'Plated dock vest', rating: 11, worn: true }],
    gear: [
      { name: 'Office keycard', qty: 1, note: 'The only one that still opens the maglock.' },
      { name: 'Burner commlink', qty: 1, rating: 2 },
    ],
    rangeTables: { ...RANGE_TABLES },
  },
  gen: {
    roleTags: ['ganger', 'lieutenant', 'face', 'docklands'],
    tiers: [
      {
        id: 'lieutenant',
        label: 'Ratchet',
        attributes: {
          bod: r(6, 6), agi: r(4, 4), rea: r(4, 4), str: r(6, 6),
          wil: r(5, 5), log: r(3, 3), int: r(4, 4), cha: r(4, 4),
        },
        skills: {
          automatics: r(5, 5), longarms: r(4, 4), clubs: r(4, 4),
          intimidation: r(5, 5), perception: r(4, 4), leadership: r(3, 3),
        },
        professionalRating: r(3, 3),
        metatypeWeights: { ork: 1 },
        loadout: [
          { slot: 'primary-weapon', options: ['Scrapyard machine pistol'] },
          { slot: 'armor', options: ['Plated dock vest'] },
        ],
        spells: [],
        augments: [],
      },
    ],
  },
  persona: {
    traits: [
      'runs the pier like a shift, not a gang',
      'reads a room by who is standing nearest the exit',
      'contemptuous of anyone who says "professional"',
    ],
    voice:
      'Low, unhurried, faintly amused. Answers questions with questions. Calls everyone "chief" until she learns a name, then never uses the name.',
    goals: [
      'Hold the crate until the buyer wires the rest of the money',
      'Get her brother Tem off the docks before this turns loud',
      'Prove to the Halo that she can run a site without the boss looking over her shoulder',
    ],
    secrets: [
      'She took a deposit from a second buyer for the same crate and has no plan for that yet.',
      'The east stair tread is rusted through — she keeps the crew off it and lets strangers find out.',
      'She has no idea what the drone actually does; the manifest word she memorised is "survey".',
    ],
    knowledge: [
      'Which crate is the real one and why the label says hydroponics',
      'The buyer meets at 03:40 and answers to the word "kettle"',
      'That one of her own crew has been skimming from the strongbox',
      'The rota: two on the floor, one on the catwalk, one asleep in the office',
    ],
    backstory:
      'Dock crew for eleven years, then the lease-holder stopped paying and the Halo started. She kept the same hours and stopped filing the paperwork.',
    mannerisms: [
      'Taps a wrench against her thigh while she thinks',
      'Never sits with her back to the freight door',
    ],
    hooks: [
      'Will trade the crate for a clean exit and enough nuyen to move Tem inland.',
      'If the crew is threatened in front of her, she escalates instantly and regrets it later.',
    ],
  },
};

// ---------------------------------------------------------------------------
// Rollable table (FR2.11)
// ---------------------------------------------------------------------------

export const DOCKLANDS_COMPLICATIONS = {
  kind: 'custom' as const,
  title: 'Docklands complications',
  visibility: 'gm' as const,
  entries: [
    { weight: 3, text: 'The tide horn sounds. Everyone on the pier looks up, including the people you were sneaking past.' },
    { weight: 3, text: 'A second crew is already inside on the same job, and just as unhappy about it as you are.' },
    { weight: 2, text: 'The shed loses grid power. Battery lighting comes up red, the maglocks fail shut, and the roller door stays where it is.' },
    { weight: 2, text: 'A dock inspector with a clipboard and no sense of self-preservation walks in on the wrong minute.' },
    { weight: 1, text: 'The crate is warm and something inside it is answering pings.' },
    { weight: 1, text: 'The buyer arrives forty minutes early with four bodies and a boat idling at the pier head.' },
  ],
};
