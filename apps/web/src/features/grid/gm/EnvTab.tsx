/**
 * Scene environment editor (FR9.11). The selects are levels 0–3 per axis; the
 * resulting pool modifier is computed by the SAME engine function the server
 * injects into rolls, so what the GM sees here is what the log will say.
 */
import type { Scene, SceneEnvironment } from '@safehouse/contracts';
import { environment } from '@safehouse/rules';
import { usePatchScene } from '../api.js';
import { inputCls, PanelSection, Row } from './ui.js';

type Axis = 'light' | 'visibility' | 'glare' | 'wind';

const LABELS: Record<Axis, [string, string, string, string]> = {
  light: ['full light', 'partial light', 'dim', 'total darkness'],
  visibility: ['clear', 'light haze', 'obscured', 'heavy obscurement'],
  glare: ['none', 'slight', 'strong', 'blinding'],
  wind: ['calm', 'light breeze', 'strong wind', 'gale'],
};

const AXES: Axis[] = ['light', 'visibility', 'glare', 'wind'];

export default function EnvTab({ scene }: { scene: Scene }) {
  const patch = usePatchScene();
  const env = scene.environment;
  const mods = environment(env);
  const mod = mods[0] ?? null;

  const set = (axis: Axis, level: number) => {
    const next: SceneEnvironment = { ...env, [axis]: level };
    patch.mutate({ sceneId: scene.id, patch: { environment: next } });
  };

  return (
    <PanelSection title="Environment" hint="composed per RAW, editable">
      {AXES.map((axis) => (
        <Row key={axis} label={axis}>
          <select
            className={inputCls}
            value={env[axis] ?? 0}
            onChange={(e) => set(axis, Number(e.target.value))}
          >
            {LABELS[axis].map((label, level) => (
              <option key={label} value={level}>
                {level} · {label}
              </option>
            ))}
          </select>
        </Row>
      ))}

      <div className="rounded border border-edge bg-deck/60 p-2">
        <div className="flex items-baseline justify-between">
          <span className="mono-label">resulting modifier</span>
          <span
            className={
              'text-sm font-semibold tabular-nums ' + (mod && mod.value < 0 ? 'text-warn' : 'text-ok')
            }
          >
            {mod ? mod.value : '±0'}
          </span>
        </div>
        <p className="mono-label mt-1 text-faint">
          {mod?.note ?? 'clear conditions — nothing injected into rolls'}
        </p>
        <p className="mono-label mt-1 text-faint">
          applies to every roll while this scene is active, removable per roll
        </p>
      </div>
    </PanelSection>
  );
}
