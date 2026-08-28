export type MoraleSuggestion = 'fight_on' | 'fall_back' | 'cut_and_run';

/** The FR10.9 trigger set — configurable in campaign settings. */
export interface MoraleTriggers {
  firstCasualty?: boolean;
  leaderDown?: boolean;
  halfStrength?: boolean;
}

/** Pressure each trigger adds. Default weights — GM-editable per campaign. */
export interface MoraleWeights {
  firstCasualty: number;
  leaderDown: number;
  halfStrength: number;
}

export const DEFAULT_MORALE_WEIGHTS: MoraleWeights = {
  firstCasualty: 1,
  leaderDown: 2,
  halfStrength: 3,
};

export interface MoraleReport {
  suggestion: MoraleSuggestion;
  /** Summed trigger pressure. */
  pressure: number;
  /** The Professional Rating absorbing that pressure. */
  threshold: number;
  /** Which triggers fired, for the log line (FR10.9: "the log records"). */
  reasons: string[];
}

/**
 * Full morale evaluation (FR10.9): sums the fired triggers' pressure against
 * the group's Professional Rating. pressure − PR ≤ 0 → fight on; 1–2 →
 * fall back; 3+ → cut and run. A suggestion only — the GM decides.
 */
export function moraleReport(
  prRating: number,
  triggers: MoraleTriggers,
  weights: MoraleWeights = DEFAULT_MORALE_WEIGHTS,
): MoraleReport {
  const reasons: string[] = [];
  let pressure = 0;
  if (triggers.firstCasualty) {
    pressure += weights.firstCasualty;
    reasons.push('first casualty');
  }
  if (triggers.leaderDown) {
    pressure += weights.leaderDown;
    reasons.push('leader down');
  }
  if (triggers.halfStrength) {
    pressure += weights.halfStrength;
    reasons.push('at half strength');
  }
  const threshold = Math.max(0, prRating);
  const over = pressure - threshold;
  const suggestion: MoraleSuggestion =
    pressure === 0 || over <= 0 ? 'fight_on' : over <= 2 ? 'fall_back' : 'cut_and_run';
  return { suggestion, pressure, threshold, reasons };
}

/** FR10.9 morale suggestion from Professional Rating + fired triggers. */
export function checkMorale(
  prRating: number,
  triggers: MoraleTriggers,
  weights?: MoraleWeights,
): MoraleSuggestion {
  return moraleReport(prRating, triggers, weights).suggestion;
}
