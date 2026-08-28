/**
 * Morale prompts (FR10.9): when a grunt group's triggers outrun its
 * Professional Rating, the GM gets a toast suggesting fall back / cut and
 * run. A suggestion only — the GM decides, and "Log it" is what makes it
 * real (the log records the call).
 */
import { useState } from 'react';
import type { Combatant } from '@safehouse/contracts';
import { postTableTalk } from './commands.js';
import { moraleLine, moralePrompts, type MoralePrompt } from './initiative.js';

const DISMISSED_CAP = 24;

export interface MoraleToastsProps {
  campaignId: string;
  combatants: Combatant[];
}

function tone(p: MoralePrompt): string {
  return p.report.suggestion === 'cut_and_run'
    ? 'border-danger/70 text-danger'
    : 'border-warn/60 text-warn';
}

export default function MoraleToasts({ campaignId, combatants }: MoraleToastsProps) {
  // Bounded FIFO of keys the GM already answered — a long fight must not grow
  // this without limit.
  const [dismissed, setDismissed] = useState<string[]>([]);

  const dismiss = (key: string) =>
    setDismissed((prev) => (prev.includes(key) ? prev : [...prev, key].slice(-DISMISSED_CAP)));

  const prompts = moralePrompts(combatants).filter((p) => !dismissed.includes(p.key));
  if (prompts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-72 flex-col gap-2">
      {prompts.map((p) => (
        <div
          key={p.key}
          className={`sh-toast pointer-events-auto rounded-md border bg-panel p-3 shadow-lg ${tone(p)}`}
          role="status"
        >
          <div className="mono-label">Morale — {p.name}</div>
          <p className="mt-1 text-sm text-ink">{moraleLine(p)}</p>
          <div className="mono-label mt-1 text-faint">
            pressure {p.report.pressure} vs PR {p.report.threshold}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn px-2.5 py-1" onClick={() => dismiss(p.key)}>
              Ignore
            </button>
            <button
              type="button"
              className="btn btn-accent px-2.5 py-1"
              onClick={() => {
                void postTableTalk(campaignId, moraleLine(p), 'marker').catch(() => undefined);
                dismiss(p.key);
              }}
            >
              Log it
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
