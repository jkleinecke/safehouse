/**
 * Per-scene environment editor (FR9.11) — four selects and the consequence.
 *
 * This is list-level metadata, not canvas work: light, visibility, glare and
 * wind change every time the party walks through a door, and the number they
 * compose to is subtracted from EVERY pool rolled while the scene is active.
 * So the modifier is printed beside the selects, computed by the same
 * `environment()` the server injects into rolls — the GM sees the consequence
 * before the table feels it (Principle 3, show your work).
 */
import type { SceneEnvironment } from '@safehouse/contracts';
import { ENV_AXES, ENV_LABELS, type EnvAxis, type EnvReadout } from './summary.js';

export interface EnvironmentEditorProps {
  sceneId: string;
  env: SceneEnvironment;
  readout: EnvReadout;
  /** True while a PATCH is in flight for this scene. */
  saving?: boolean;
  disabled?: boolean;
  onChange: (axis: EnvAxis, level: number) => void;
}

const selectClass =
  'w-full rounded-md border border-edge bg-deck px-2 py-1 text-xs text-ink ' +
  'focus:border-cyan focus:outline-none disabled:opacity-50';

export default function EnvironmentEditor({
  sceneId,
  env,
  readout,
  saving = false,
  disabled = false,
  onChange,
}: EnvironmentEditorProps) {
  return (
    <div data-testid="environment-editor" data-scene-id={sceneId}>
      <div className="grid grid-cols-2 gap-2">
        {ENV_AXES.map((axis) => (
          <label key={axis} className="block">
            <span className="mono-label block">{axis}</span>
            <select
              className={selectClass}
              aria-label={`${axis} level`}
              value={env[axis] ?? 0}
              disabled={disabled}
              onChange={(e) => onChange(axis, Number(e.target.value))}
            >
              {ENV_LABELS[axis].map((label, level) => (
                <option key={label} value={level}>
                  {level} · {label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div
        className="mt-2 flex items-baseline justify-between gap-3 rounded-md border border-edge bg-deck/60 px-2.5 py-2"
        data-testid="env-modifier"
        data-env-value={readout.value}
      >
        <span className="mono-label">dice pool effect</span>
        <span
          className={
            'text-sm font-semibold tabular-nums ' + (readout.value < 0 ? 'text-warn' : 'text-ok')
          }
        >
          {readout.clear ? '±0' : readout.value}
        </span>
      </div>
      <p className="mono-label mt-1 text-faint">
        {readout.note ?? 'clear conditions — nothing is injected into rolls'}
      </p>
      <p className="mono-label mt-1 text-faint">
        applied to every roll while this scene is live · removable per roll
      </p>
      {saving && <p className="mono-label mt-1 text-cyan">saving…</p>}
    </div>
  );
}
