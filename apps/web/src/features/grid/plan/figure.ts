/**
 * Who a token's figure is and how it stands: pure, shared by the map's 3D
 * figures (`lab3d/figure3d.ts`, pooled by `stage3d/figures.ts`) and the look
 * editor (`gm/LookEditor.tsx`), so the look a GM picks is the figure the map
 * builds. It imports nothing but the contracts' types: no three, no DOM.
 *
 * Two answers live here:
 *   - `lookFor(token)`: the figure's archetype, metatype, kit and colours;
 *   - `skeleton(frame)`: where its joints are for one frame of one pose.
 * Turning them into meshes is `figure3d.ts`'s business. (Until P5 the 2D map
 * drew them flat as well, in `stage/figure.ts`; that drawing went with the 2D
 * map, and this is the part the two shared.)
 *
 * It is a Sixth World figure, not a mannequin (2026-09-25): an archetype
 * — street samurai, decker, mage, rigger, face, adept, ganger, corp security,
 * wage slave — and a metatype, dressed dark with neon at the seams. Chrome
 * arms, mirrorshades and visors, mohawks, dusters, a rifle slung across the
 * back, a deck at the hip, a focus glowing in a mage's hand. A troll is big
 * and horned, a dwarf short and bearded, an ork tusked, an elf tall and
 * slight. Which is which comes from the token's name when it says ("Troll
 * Samurai", "Lone Star Officer") and otherwise from the token itself, fixed,
 * so a runner looks the same every session.
 *
 * The neon on a figure is its side's colour — cyan for runners, red for
 * opposition, amber for everyone else — so a crowd sorts itself at a glance.
 *
 * The portrait does not go away. It rides above the head on the figure's
 * plate (`stage3d/badges.ts`), which is how a player finds their runner in a
 * crowd.
 *
 * Everything here is in BODY units: a standing human is 1 tall with its feet
 * at the origin. A point is `[forward, side, up]` — forward the way the
 * figure faces, side its right hand. A metatype's build scales the lot.
 */
import type { Token, TokenLook, TokenPose } from '@safehouse/contracts';

/** What the figure is doing. `down` is the condition monitor's call, never stored. */
export type FigurePose = TokenPose | 'down';

export type Metatype = 'human' | 'elf' | 'dwarf' | 'ork' | 'troll';
export type Archetype =
  | 'samurai'
  | 'decker'
  | 'mage'
  | 'rigger'
  | 'face'
  | 'adept'
  | 'ganger'
  | 'security'
  | 'civilian';

type Outfit = 'jacket' | 'duster' | 'hoodie' | 'armor' | 'suit' | 'vest';
type HeadStyle = 'mohawk' | 'crop' | 'long' | 'shaved' | 'hood' | 'helmet' | 'topknot';
type Eyes = 'shades' | 'visor' | 'cybereye' | 'goggles' | 'none';
type Gear = 'rifle' | 'katana' | 'pistol' | 'deck' | 'focus' | 'remote' | 'none';

export interface FigureLook {
  archetype: Archetype;
  metatype: Metatype;
  /** Across and up, against a human's 1. */
  build: { w: number; h: number };
  outfit: Outfit;
  headStyle: HeadStyle;
  eyes: Eyes;
  gear: Gear;
  /** Which arm is chrome: -1 left, 1 right, 0 neither. */
  cyberarm: -1 | 0 | 1;
  /** Plates on the shoulders. */
  pads: boolean;
  skin: number;
  hair: number;
  coat: number;
  under: number;
  legs: number;
  boots: number;
  /** The side's colour, on the seams, the visor, the gear. */
  neon: number;
  chrome: number;
  /** A prop token — a crate, a barricade, a van — is a box, not a person. */
  crate: boolean;
}

export interface FigureFrame {
  pose: FigurePose;
  /** Radians in grid space: 0 faces +x (east), π/2 faces +y (south). */
  facing: number;
  /** The walk cycle, radians. */
  phase: number;
  /** How much stride is in the legs: 0 standing still, 1 walking. */
  stride: number;
  /** Down from physical damage rather than stun: there is blood. */
  bleeding: boolean;
}

type V3 = readonly [number, number, number];

/** A pose's joints in body units: the bones the map's figures (`lab3d/figure3d.ts`) are built over. */
export interface Skeleton {
  hip: V3;
  neck: V3;
  head: V3;
  headR: number;
  /** Legs hip → knee → foot, then arms shoulder → elbow → hand; left (−side) first. */
  legs: [V3[], V3[]];
  arms: [V3[], V3[]];
  /** A long coat's hem, below the hip; its skirt runs from the hip to here. */
  hem: V3;
  /** Where the shadow sits and how far it reaches along the body. */
  shadow: { f: number; long: number; wide: number };
  /** Lying along the floor: boots point back, the back of the torso is up. */
  lying: boolean;
  /** Hands on a weapon, held forward. */
  aiming: boolean;
}

/** Where a figure's joints are for one frame of one pose, in body units. */
export function skeleton(frame: FigureFrame): Skeleton {
  switch (frame.pose) {
    case 'crouch':
      // Down on the right knee, left foot planted, both hands forward on a weapon.
      return {
        hip: [-0.04, 0, 0.3],
        neck: [0.07, 0, 0.6],
        head: [0.1, 0, 0.71],
        headR: 0.105,
        legs: [
          [[-0.04, -0.065, 0.3], [0.17, -0.075, 0.31], [0.15, -0.08, 0.01]],
          [[-0.04, 0.065, 0.3], [0.07, 0.075, 0.03], [-0.2, 0.075, 0.02]],
        ],
        arms: [
          [[0.07, -0.14, 0.56], [0.14, -0.15, 0.43], [0.26, -0.04, 0.48]],
          [[0.07, 0.14, 0.56], [0.12, 0.16, 0.42], [0.2, 0.04, 0.45]],
        ],
        hem: [-0.14, 0, 0.06],
        shadow: { f: 0, long: 0.26, wide: 0.2 },
        lying: false,
        aiming: true,
      };
    case 'prone':
      // Flat on the floor, face down, elbows out, sighting along the way it faces.
      return {
        hip: [-0.18, 0, 0.08],
        neck: [0.2, 0, 0.09],
        head: [0.32, 0, 0.12],
        headR: 0.105,
        legs: [
          [[-0.18, -0.06, 0.07], [-0.42, -0.09, 0.05], [-0.66, -0.11, 0.03]],
          [[-0.18, 0.06, 0.07], [-0.42, 0.09, 0.05], [-0.66, 0.11, 0.03]],
        ],
        arms: [
          [[0.16, -0.14, 0.1], [0.26, -0.21, 0.03], [0.4, -0.05, 0.07]],
          [[0.16, 0.14, 0.1], [0.24, 0.2, 0.03], [0.34, 0.05, 0.07]],
        ],
        hem: [-0.5, 0, 0.06],
        shadow: { f: -0.12, long: 0.6, wide: 0.24 },
        lying: true,
        aiming: true,
      };
    case 'down':
      // On the back, limbs where they fell.
      return {
        hip: [-0.15, 0, 0.06],
        neck: [0.2, 0, 0.07],
        head: [0.33, 0.03, 0.08],
        headR: 0.105,
        legs: [
          [[-0.15, -0.06, 0.06], [-0.38, -0.14, 0.04], [-0.6, -0.2, 0.03]],
          [[-0.15, 0.06, 0.06], [-0.4, 0.1, 0.04], [-0.62, 0.14, 0.03]],
        ],
        arms: [
          [[0.16, -0.14, 0.07], [0.12, -0.32, 0.04], [0.02, -0.45, 0.03]],
          [[0.16, 0.14, 0.07], [0.24, 0.3, 0.04], [0.36, 0.42, 0.03]],
        ],
        hem: [-0.46, 0, 0.05],
        shadow: { f: -0.1, long: 0.6, wide: 0.3 },
        lying: true,
        aiming: false,
      };
    default: {
      // Standing; walking is standing with the stride put in.
      const s = frame.stride;
      const ph = frame.phase;
      const sw = Math.sin(ph) * 0.17 * s; // how far the left foot is ahead
      const liftL = Math.max(0, Math.cos(ph)) * 0.06 * s;
      const liftR = Math.max(0, -Math.cos(ph)) * 0.06 * s;
      const bob = Math.abs(Math.cos(ph)) * 0.015 * s;
      const hipZ = 0.47 + bob;
      const lean = 0.03 * s;
      return {
        hip: [0, 0, hipZ],
        neck: [lean, 0, 0.78 + bob],
        head: [lean * 1.3, 0, 0.885 + bob],
        headR: 0.105,
        legs: [
          [[0, -0.065, hipZ], [sw * 0.5 + 0.03 + liftL, -0.07, 0.25 + liftL], [sw, -0.07, 0.01 + liftL]],
          [[0, 0.065, hipZ], [-sw * 0.5 + 0.03 + liftR, 0.07, 0.25 + liftR], [-sw, 0.07, 0.01 + liftR]],
        ],
        arms: [
          [[lean, -0.15, 0.74 + bob], [-sw * 0.4, -0.18, 0.58 + bob], [-sw * 0.8 + 0.02, -0.18, 0.44 + bob]],
          [[lean, 0.15, 0.74 + bob], [sw * 0.4, 0.18, 0.58 + bob], [sw * 0.8 + 0.02, 0.18, 0.44 + bob]],
        ],
        // A coat's hem swings back when its wearer walks.
        hem: [-0.03 - 0.05 * s, 0, 0.17 + bob],
        shadow: { f: 0, long: 0.2, wide: 0.2 },
        lying: false,
        aiming: false,
      };
    }
  }
}

// ---------------------------------------------------------------- looks

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A second, independent number from the same token, for each choice made. */
const roll = (h: number, salt: number): number => hash(`${h}:${salt}`);
const pick = <T,>(list: readonly T[], h: number, salt: number): T => list[roll(h, salt) % list.length]!;

/** The side's neon: runners cyan, opposition red, everyone else amber. */
const NEON: Record<Token['source'], number> = {
  character: 0x22d8f0,
  combatant: 0xff2d5a,
  npc_template: 0xffb020,
  prop: 0xffb020,
};
const HAIR_NEON = [0x39ff6a, 0xff2bd6, 0x2bf0ff, 0xffe62b, 0xa05bff, 0xff5a2b];
const HAIR = [0x121317, 0x2e1d12, 0x5a3a1f, 0xa8823e, 0xcfc8bb, 0x8a1f2a];
const SKIN: Record<Metatype, readonly number[]> = {
  human: [0xf0c7a4, 0xd9a47c, 0xb57b52, 0x8a5a3a, 0x5c3a24],
  elf: [0xf3d9c4, 0xe5bf9c, 0xc58f66, 0x7a5236],
  dwarf: [0xecc2a0, 0xcf9a74, 0xa56e4a],
  ork: [0xa9b28a, 0x8f9a70, 0xb89c7a, 0x6f7a55, 0x9a7b5c],
  troll: [0x9aa0a8, 0x8a8f86, 0xa28c78, 0x7d8a8f],
};
const COATS = [0x16181d, 0x2a211c, 0x20252b, 0x28233a, 0x1c2622, 0x341c20, 0x2b2b2f];
const UNDER = [0x7d8794, 0x9a3b4f, 0x3b6f84, 0xc9c4b8];
const LEGS = [0x14161b, 0x1f2229, 0x262a31, 0x221f1a];
const CHROME = [0x9aa7b2, 0xb8a27a, 0x6f7c88];

const BUILDS: Record<Metatype, { w: number; h: number }> = {
  human: { w: 1, h: 1 },
  elf: { w: 0.9, h: 1.06 },
  dwarf: { w: 1.18, h: 0.74 },
  ork: { w: 1.18, h: 1.05 },
  troll: { w: 1.42, h: 1.22 },
};

interface Kit {
  outfit: readonly Outfit[];
  head: readonly HeadStyle[];
  eyes: readonly Eyes[];
  gear: readonly Gear[];
  /** Chance in 4 of a chrome arm. */
  chrome: number;
  pads: boolean;
}

/** What each archetype tends to wear and carry — picked from per token. */
const KITS: Record<Archetype, Kit> = {
  samurai: { outfit: ['jacket', 'armor', 'duster'], head: ['mohawk', 'crop', 'topknot', 'shaved'], eyes: ['shades', 'cybereye', 'visor'], gear: ['rifle', 'katana', 'pistol'], chrome: 3, pads: true },
  decker: { outfit: ['hoodie', 'jacket'], head: ['hood', 'crop', 'mohawk', 'long'], eyes: ['visor', 'goggles', 'cybereye'], gear: ['deck'], chrome: 1, pads: false },
  mage: { outfit: ['duster'], head: ['long', 'topknot', 'shaved', 'hood'], eyes: ['none', 'shades'], gear: ['focus'], chrome: 0, pads: false },
  rigger: { outfit: ['jacket', 'vest'], head: ['crop', 'shaved', 'long'], eyes: ['goggles', 'visor'], gear: ['remote'], chrome: 1, pads: false },
  face: { outfit: ['suit', 'duster'], head: ['crop', 'long', 'topknot'], eyes: ['shades', 'none'], gear: ['pistol', 'none'], chrome: 0, pads: false },
  adept: { outfit: ['vest', 'jacket'], head: ['topknot', 'shaved', 'crop'], eyes: ['none'], gear: ['katana', 'none'], chrome: 0, pads: false },
  ganger: { outfit: ['vest', 'jacket'], head: ['mohawk', 'shaved', 'long'], eyes: ['shades', 'cybereye', 'none'], gear: ['pistol', 'katana'], chrome: 2, pads: true },
  security: { outfit: ['armor'], head: ['helmet', 'helmet', 'crop'], eyes: ['visor'], gear: ['rifle', 'pistol'], chrome: 0, pads: true },
  civilian: { outfit: ['suit', 'jacket', 'hoodie'], head: ['crop', 'long', 'shaved'], eyes: ['none', 'shades'], gear: ['none'], chrome: 0, pads: false },
};

/** Words in a token's name that say what it is. */
const ARCHETYPE_WORDS: Array<[RegExp, Archetype]> = [
  [/samurai|merc|muscle|soldier|gunner|bodyguard|razor/, 'samurai'],
  [/decker|hacker|netrunner|technomancer/, 'decker'],
  [/mage|shaman|wizard|sorcer|witch|magician|conjurer|spellcaster/, 'mage'],
  [/rigger|driver|pilot|wheelman/, 'rigger'],
  [/face|fixer|johnson|exec|negotiator|broker/, 'face'],
  [/adept|monk|martial/, 'adept'],
  [/ganger|gang|thug|punk|halloweener|ancient|cutter|goon/, 'ganger'],
  [/guard|security|lone star|knight errant|cop|officer|trooper|agent|swat|patrol/, 'security'],
  [/doc|clerk|bartender|civilian|wage|tech|scientist|citizen|bystander/, 'civilian'],
];
const METATYPE_WORDS: Array<[RegExp, Metatype]> = [
  [/troll|minotaur|giant|fomori|cyclops/, 'troll'],
  [/\bork\b|\borc\b|hobgoblin|ogre|oni|satyr/, 'ork'],
  [/dwarf|gnome|koborokuru|menehune/, 'dwarf'],
  [/\belf\b|elven|dryad|night one|wakyambi|nocturna/, 'elf'],
  [/human/, 'human'],
];

/** Who turns up, by source, when the name says nothing. */
const DEFAULT_ARCHETYPES: Record<Token['source'], readonly Archetype[]> = {
  character: ['samurai', 'decker', 'mage', 'rigger', 'face', 'adept'],
  combatant: ['security', 'ganger', 'security', 'samurai', 'ganger'],
  npc_template: ['civilian', 'face', 'ganger', 'security', 'decker', 'civilian'],
  prop: ['civilian'],
};
/** The Sixth World's mix, near enough: most human, then ork, elf, troll, dwarf. */
const METATYPE_MIX: readonly Metatype[] = [
  'human', 'human', 'human', 'human', 'human', 'human', 'human', 'human',
  'ork', 'ork', 'ork', 'elf', 'elf', 'troll', 'troll', 'dwarf',
];

/**
 * A figure's archetype, metatype, kit and colours — fixed per token, so a
 * runner looks the same every session, and read from its name first.
 */
export function lookFor(token: Pick<Token, 'id' | 'source'> & { name?: string; look?: TokenLook | null }): FigureLook {
  const h = hash(token.id);
  const name = (token.name ?? '').toLowerCase();
  const set = token.look ?? {};
  // What the token's own look says wins; then its name; then the dice.
  const archetype =
    set.archetype ?? ARCHETYPE_WORDS.find(([re]) => re.test(name))?.[1] ?? pick(DEFAULT_ARCHETYPES[token.source] ?? DEFAULT_ARCHETYPES.npc_template, h, 1);
  const metatype = set.metatype ?? METATYPE_WORDS.find(([re]) => re.test(name))?.[1] ?? pick(METATYPE_MIX, h, 2);
  const kit = KITS[archetype];
  const headStyle = set.headStyle ?? pick(kit.head, h, 4);
  const cyberarm: -1 | 0 | 1 =
    set.cyberarm !== undefined
      ? set.cyberarm === 'left' ? -1 : set.cyberarm === 'right' ? 1 : 0
      : roll(h, 9) % 4 < kit.chrome ? (roll(h, 10) % 2 === 0 ? 1 : -1) : 0;
  const security = archetype === 'security';
  const base: FigureLook = {
    archetype,
    metatype,
    build: BUILDS[metatype],
    outfit: pick(kit.outfit, h, 3),
    headStyle,
    eyes: pick(kit.eyes, h, 5),
    gear: pick(kit.gear, h, 6),
    cyberarm,
    pads: kit.pads,
    skin: pick(SKIN[metatype], h, 7),
    // A mohawk is dyed; anything else mostly is not.
    hair: headStyle === 'mohawk' || roll(h, 8) % 5 === 0 ? pick(HAIR_NEON, h, 11) : pick(HAIR, h, 12),
    coat: security ? pick([0x1f2733, 0x2a2f36, 0x33291f], h, 13) : pick(COATS, h, 13),
    under: pick(UNDER, h, 14),
    legs: pick(LEGS, h, 15),
    boots: 0x0e0f12,
    neon: NEON[token.source] ?? NEON.npc_template,
    chrome: pick(CHROME, h, 16),
    crate: token.source === 'prop',
  };
  const colour = (hex: string | undefined, fallback: number) => (hex ? parseInt(hex.slice(1), 16) : fallback);
  const c = set.colors ?? {};
  return {
    ...base,
    ...(set.outfit ? { outfit: set.outfit } : {}),
    ...(set.eyes ? { eyes: set.eyes } : {}),
    ...(set.gear ? { gear: set.gear } : {}),
    ...(set.pads !== undefined ? { pads: set.pads } : {}),
    skin: colour(c.skin, base.skin),
    hair: colour(c.hair, base.hair),
    coat: colour(c.coat, base.coat),
    under: colour(c.under, base.under),
    legs: colour(c.legs, base.legs),
    boots: colour(c.boots, base.boots),
    neon: colour(c.neon, base.neon),
    chrome: colour(c.chrome, base.chrome),
  };
}
