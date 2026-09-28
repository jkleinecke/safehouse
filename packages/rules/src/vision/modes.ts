/**
 * Which eyes a runner has (docs/VISION.md §3, §4.3, §4.5).
 *
 * Derived from the sheet, never typed in: metatype gives elves and orks
 * low-light and dwarfs and trolls thermographic (SR5 p. 66), read off the
 * chargen metatype table so Run Faster's metavariants see with the eyes their
 * rows give them; augments and gear add the rest by name ("cybereyes …
 * thermographic", "low-light goggles", "ultrasound sensor"). Pure and
 * name-based on purpose — the catalogue rows a sheet carries are the GM's own
 * items, and the words on them are the contract.
 *
 * The first slice of vision: the modes and a player-side view switch. Light
 * rows, heat maps and per-mode shrouds come after (VISION.md §4).
 */
import { hasRacialTrait, metatypeRow } from '../chargen/metatypes.js';
import type { EnvironmentCompensation } from '../env.js';

export type VisionMode = 'normal' | 'lowlight' | 'thermographic' | 'ultrasound' | 'astral';

/** The slice of a sheet the derivation reads — structural, so a partial NPC statblock fits too. */
export interface VisionSheetLike {
  identity?: { metatype?: string | undefined } | undefined;
  augments?: ReadonlyArray<{ name: string; note?: string | undefined }> | undefined;
  gear?: ReadonlyArray<{ name: string; note?: string | undefined }> | undefined;
  qualities?: ReadonlyArray<{ name: string; note?: string | undefined }> | undefined;
}

export const VISION_MODE_LABELS: Record<VisionMode, string> = {
  normal: 'normal',
  lowlight: 'low-light',
  thermographic: 'thermographic',
  ultrasound: 'ultrasound',
  astral: 'astral',
};

/**
 * What each metatype is born seeing with — its racial traits on the metatype
 * table (SR5 p. 66; RF pp. 104–105). Dwarfs are thermographic, not low-light.
 * An unknown metatype string sees normally.
 */
export function metatypeVision(metatype: string | undefined): VisionMode[] {
  const row = metatypeRow(metatype);
  if (!row) return [];
  const modes: VisionMode[] = [];
  if (hasRacialTrait(row, 'lowLight')) modes.push('lowlight');
  if (hasRacialTrait(row, 'thermographic')) modes.push('thermographic');
  if (hasRacialTrait(row, 'astralPerception')) modes.push('astral');
  return modes;
}

const NAME_RULES: ReadonlyArray<{ test: RegExp; mode: VisionMode }> = [
  { test: /thermo/i, mode: 'thermographic' },
  { test: /low[\s-]?light/i, mode: 'lowlight' },
  { test: /ultrasound|ultrasonic/i, mode: 'ultrasound' },
  { test: /astral perception/i, mode: 'astral' },
];

/** The modes a piece of gear, an augment or a quality grants by its name (or note). */
export function modesFromName(name: string, note?: string): VisionMode[] {
  const text = `${name} ${note ?? ''}`;
  return NAME_RULES.filter((r) => r.test.test(text)).map((r) => r.mode);
}

/**
 * Every mode this sheet has, 'normal' always first, the rest in the order
 * a player would list them. Duplicates collapse: troll with thermographic
 * cybereyes is thermographic once.
 */
export function visionModesFor(sheet: VisionSheetLike): VisionMode[] {
  const found = new Set<VisionMode>(['normal']);
  for (const m of metatypeVision(sheet.identity?.metatype)) found.add(m);
  for (const a of sheet.augments ?? []) for (const m of modesFromName(a.name, a.note)) found.add(m);
  for (const g of sheet.gear ?? []) for (const m of modesFromName(g.name, g.note)) found.add(m);
  for (const q of sheet.qualities ?? []) for (const m of modesFromName(q.name, q.note)) found.add(m);
  const order: VisionMode[] = ['normal', 'lowlight', 'thermographic', 'ultrasound', 'astral'];
  return order.filter((m) => found.has(m));
}

const SMARTLINK = /smart[\s-]?link/i;

/**
 * What this sheet brings against the environment table (SR5 p.175), read the
 * same way as its eyes: low-light and thermographic from `visionModesFor`, a
 * smartlink from any augment or piece of gear named for one.
 *
 * Two lines of the compensation table are left out on purpose. Image
 * magnification only works after a Take Aim (p.177), so owning a scope is not
 * enough — whoever knows the shooter aimed passes it in. Ultrasound ignores
 * light only within 50 m (p.175), which needs the distance to the target.
 *
 * The smartlink is taken to be in use: the sheet does not record which guns
 * carry a smartgun system, and a runner who paid for the link almost always
 * shoots one. The engine gives it to weapon pools only (`buildPools`).
 */
export function environmentCompensationFor(sheet: VisionSheetLike): EnvironmentCompensation {
  const modes = visionModesFor(sheet);
  const named = [...(sheet.augments ?? []), ...(sheet.gear ?? [])];
  const smartlink = named.some((item) => SMARTLINK.test(`${item.name} ${item.note ?? ''}`));
  return {
    ...(modes.includes('lowlight') ? { lowLight: true } : {}),
    ...(modes.includes('thermographic') ? { thermographic: true } : {}),
    ...(smartlink ? { smartlink: true } : {}),
  };
}
