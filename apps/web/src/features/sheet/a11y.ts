/**
 * Accessible-name builders and keyboard helpers for the sheet (G1 on a phone,
 * but the sheet also has to be usable with a keyboard and a screen reader).
 *
 * Found live: every skill row was a click-handler `<div>` — `read_page` saw
 * "button" wrappers with no accessible name and no keyboard path, so a
 * screen-reader user could not tell one row from another and a keyboard-only
 * user could not roll at all. The fix has two halves: rows became REAL
 * `<button>` elements (native Enter/Space, native focus ring), and every
 * interactive control now gets a spoken name from this file.
 *
 * These are pure string builders on purpose — the wording is the part worth
 * testing, and testing it here needs no DOM.
 */
import type { LimitRef } from '@safehouse/contracts';

/**
 * Keys that activate a control. A real `<button>` handles Enter and Space for
 * free; this exists for the few places that must stay a non-button element
 * (a row that already contains its own buttons) and for the tests that drive
 * the roll flow from the keyboard.
 *
 * `'Spacebar'` is the legacy `KeyboardEvent.key` value still emitted by some
 * mobile browsers; treating it as Space costs nothing and unbreaks them.
 */
export const ACTIVATION_KEYS: readonly string[] = ['Enter', ' ', 'Spacebar'];

export function isActivationKey(key: string): boolean {
  return ACTIVATION_KEYS.includes(key);
}

/** Keys that dismiss a popover/sheet without choosing anything. */
export function isDismissKey(key: string): boolean {
  return key === 'Escape' || key === 'Esc';
}

const LIMIT_WORDS: Record<string, string> = {
  physical: 'physical limit',
  mental: 'mental limit',
  social: 'social limit',
  accuracy: 'accuracy limit',
  force: 'Force limit',
};

export function limitPhrase(limit: LimitRef | undefined): string {
  if (!limit) return '';
  return `, ${LIMIT_WORDS[limit.kind] ?? `${limit.kind} limit`} ${limit.value}`;
}

/** "Perception, pool 5, mental limit 5" — the spoken form of a pool chip. */
export function poolPhrase(name: string, total: number, limit?: LimitRef): string {
  return `${name}, pool ${total}${limitPhrase(limit)}`;
}

/** Accessible name for a row whose whole job is "open the roll dialog". */
export function rollRowLabel(name: string, total: number, limit?: LimitRef): string {
  return `Roll ${poolPhrase(name, total, limit)}`;
}

export interface SkillRowInfo {
  id: string;
  attr: string;
  rating: number;
  spec?: string | null | undefined;
}

/**
 * "Roll Perception, pool 5, mental limit 5. Intuition, rating 3,
 * specialization visual." — identity first so a screen reader reaching the row
 * says the useful half before the detail.
 */
export function skillRowLabel(skill: SkillRowInfo, total: number, limit?: LimitRef): string {
  const detail = [
    skill.attr.toUpperCase(),
    `rating ${skill.rating}`,
    ...(skill.spec ? [`specialization ${skill.spec}`] : []),
  ].join(', ');
  return `${rollRowLabel(skill.id, total, limit)}. ${detail}`;
}

export function spellRowLabel(name: string, total: number | undefined, drain?: string): string {
  const pool = total === undefined ? '' : `, pool ${total}`;
  return `Cast ${name}${pool}${drain ? `, drain ${drain}` : ''}`;
}

/** The number-with-provenance button (tap → breakdown, long-press → override). */
export function breakdownLabel(title: string, value: number, overridden: boolean): string {
  return `${title}: ${value}${overridden ? ', overridden' : ''}. Show breakdown`;
}

export function monitorLabel(label: string, filled: number, max: number): string {
  return `${label} condition monitor, ${filled} of ${max} boxes filled`;
}

/**
 * A monitor box says what tapping it DOES, because that is what a screen
 * reader user needs before they commit: filling the last one heals instead.
 */
export function monitorBoxLabel(
  label: string,
  index: number,
  filled: number,
  max: number,
): string {
  const box = index + 1;
  const state = index < filled ? 'filled' : 'empty';
  const action = box === filled ? 'heal one box' : `damage to ${box}`;
  return `${label} box ${box} of ${max}, ${state}. Activate to ${action}`;
}

export function edgeTrackLabel(current: number, max: number, burned: number): string {
  const burn = burned > 0 ? `, ${burned} burned permanently` : '';
  return `Edge ${current} of ${max}${burn}`;
}

export function initiativeLabel(name: string, base: number, dice: number): string {
  return `${name} initiative, ${base} plus ${dice} d6`;
}

export function limitCellLabel(name: string, value: number): string {
  return `${name}, ${value}`;
}

export function movementLabel(name: string, meters: number): string {
  return `${name}, ${meters} meters per combat turn`;
}

export interface ContactLabelInfo {
  name: string;
  archetype?: string | undefined;
  connection: number;
  loyalty: number;
}

export function contactLabel(c: ContactLabelInfo): string {
  const arch = c.archetype ? `, ${c.archetype}` : '';
  return `${c.name}${arch}, connection ${c.connection}, loyalty ${c.loyalty}`;
}
