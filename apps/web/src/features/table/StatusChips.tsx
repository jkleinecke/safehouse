/**
 * Status-effect chips on a tracker row (FR4.7). Each chip shows the effect
 * name, its duration hint, and — on hover — the modifiers it attaches, so the
 * number on the row always explains itself (Principle 3).
 */
import type { StatusEffect } from '@safehouse/contracts';
import { effectHint, formatModifier } from './initiative.js';

export interface StatusChipsProps {
  effects: StatusEffect[];
  /** GM rows get a remove affordance; player rows are read-only. */
  onRemove?: (effectId: string) => void;
}

function modsTitle(effect: StatusEffect): string {
  const parts = effect.mods
    .filter((m) => m.active)
    .map((m) => `${m.target} ${m.op === 'set' ? '=' : m.op === 'cap' ? '≤' : ''}${formatModifier(m.value)}`);
  if (effect.note) parts.push(effect.note);
  return parts.length > 0 ? parts.join(' · ') : effect.name;
}

export default function StatusChips({ effects, onRemove }: StatusChipsProps) {
  if (effects.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {effects.map((e) => {
        const hint = effectHint(e);
        return (
          <span
            key={e.id}
            className="chip border-magenta-dim/60 py-0 text-magenta"
            title={modsTitle(e)}
          >
            {e.name}
            {hint && <span className="text-faint">{hint}</span>}
            {onRemove && (
              <button
                type="button"
                className="text-faint hover:text-danger"
                aria-label={`Remove ${e.name}`}
                onClick={() => onRemove(e.id)}
              >
                ×
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
