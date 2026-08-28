import type { GruntMember, GruntState } from '@safehouse/contracts';
import type { MoraleTriggers } from './morale.js';

/** Inputs for a fresh grunt-group row (FR4.6): one shared stat template. */
export interface GruntGroupInit {
  size: number;
  professionalRating: number;
  /** Shared Group Edge pool; explicit (table-set), defaults to 0. */
  groupEdge?: number;
  /** Member labels become `${labelPrefix} 1..n`. */
  labelPrefix?: string;
}

/** Build the grunt-group state for a single tracker row (FR4.6). */
export function createGruntGroup(init: GruntGroupInit): GruntState {
  const size = Math.max(1, Math.floor(init.size));
  const prefix = init.labelPrefix ?? 'Grunt';
  const members: GruntMember[] = [];
  for (let i = 1; i <= size; i += 1) {
    members.push({ label: `${prefix} ${i}`, filled: 0, down: false });
  }
  return {
    size,
    professionalRating: Math.max(0, Math.floor(init.professionalRating)),
    groupEdge: Math.max(0, Math.floor(init.groupEdge ?? 0)),
    members,
  };
}

/**
 * Tick one member's condition (FR4.6 per-member ticks). Grunts share the
 * template's monitor size (`monitorMax`); a member at max is down. Pure.
 */
export function tickGruntDamage(
  grunt: GruntState,
  memberIndex: number,
  boxes: number,
  monitorMax: number,
): { grunt: GruntState; member: GruntMember } {
  const existing = grunt.members[memberIndex];
  if (!existing) {
    throw new RangeError(`grunt member ${memberIndex} does not exist (size ${grunt.members.length})`);
  }
  const filled = Math.min(monitorMax, Math.max(0, existing.filled + Math.floor(boxes)));
  const member: GruntMember = { ...existing, filled, down: filled >= monitorMax };
  const members = grunt.members.map((m, i) => (i === memberIndex ? member : m));
  return { grunt: { ...grunt, members }, member };
}

/** Members currently down. */
export function gruntCasualties(grunt: GruntState): number {
  return grunt.members.filter((m) => m.down).length;
}

/** Members still standing. */
export function activeGruntMembers(grunt: GruntState): number {
  const size = grunt.members.length > 0 ? grunt.members.length : grunt.size;
  return size - gruntCasualties(grunt);
}

/** Spend one point from the shared Group Edge pool (FR4.6). */
export function spendGroupEdge(grunt: GruntState): { grunt: GruntState; ok: boolean } {
  if (grunt.groupEdge <= 0) return { grunt, ok: false };
  return { grunt: { ...grunt, groupEdge: grunt.groupEdge - 1 }, ok: true };
}

/**
 * Derive the FR10.9 trigger flags from current group state (leader-down is a
 * GM flag — the engine can't know which member was the leader).
 */
export function gruntMoraleTriggers(
  grunt: GruntState,
  opts: { leaderDown?: boolean } = {},
): MoraleTriggers {
  const size = grunt.members.length > 0 ? grunt.members.length : grunt.size;
  const casualties = gruntCasualties(grunt);
  return {
    firstCasualty: casualties >= 1,
    leaderDown: opts.leaderDown ?? false,
    halfStrength: size > 0 && casualties * 2 >= size,
  };
}
