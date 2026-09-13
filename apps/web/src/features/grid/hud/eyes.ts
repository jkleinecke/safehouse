/**
 * Which eyes the viewer may look through (docs/VISION.md §4.5).
 *
 * A player gets the modes their runner's sheet grants — metatype, cybereyes,
 * goggles — and nothing else; a GM gets every mode the canvas can draw, so
 * painting a generator and seeing the room warm up is how they learn what
 * the troll will see. Astral is on the sheet but not yet on the canvas, so
 * it is listed nowhere until it draws something.
 */
import { visionModesFor, type VisionMode, type VisionSheetLike } from '@safehouse/rules';

/** The modes the canvas can restyle for today. */
export const DRAWABLE_MODES: readonly VisionMode[] = ['normal', 'lowlight', 'thermographic', 'ultrasound'];

export function availableModes(isGm: boolean, sheet: VisionSheetLike | null): VisionMode[] {
  if (isGm) return [...DRAWABLE_MODES];
  if (!sheet) return ['normal'];
  return visionModesFor(sheet).filter((m) => DRAWABLE_MODES.includes(m));
}

/** The mode to fall back to when the list no longer holds the current one. */
export function clampMode(mode: VisionMode, modes: readonly VisionMode[]): VisionMode {
  return modes.includes(mode) ? mode : 'normal';
}
