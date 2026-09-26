/**
 * A GM light's properties, in the panel when one is picked (docs/VISION.md
 * §4.1): what it is called, its colour, how far it reaches and how bright it
 * is there, how high it hangs, whether it is on — and, for a spotlight, where
 * it points and how wide.
 *
 * The same pattern as the camera's fields: every change is a call into
 * `../geometryEdit.js` and one whole-object geometry patch, an undo step each,
 * and the canvas redraws from the refreshed scene. Nothing here is optimistic.
 */
import type { Scene, SceneLight } from '@safehouse/contracts';
import { sceneLevels } from '@safehouse/rules';
import { usePatchGeometry } from '../api.js';
import { isSpotlight, lightsOf, removeLight, updateLight, type LightPatch } from '../geometryEdit.js';
import { useGridStore } from '../store.js';
import { inputCls, LabelField, Num, Row, TrashButton } from './ui.js';

/**
 * How many light rows it lifts at its core (§4.1). The words are what a GM
 * would call the fixture; the number is what the dice read.
 */
const BRIGHTNESS: ReadonlyArray<{ rows: 1 | 2 | 3; label: string; hint: string }> = [
  { rows: 1, label: 'Soft', hint: 'a glow: a screen, a candle, a sign' },
  { rows: 2, label: 'Lamp', hint: 'a proper light: a bulb, a streetlamp' },
  { rows: 3, label: 'Flood', hint: 'a floodlight: a stadium, a searchlight' },
];

/** Compass presets, as plan bearings: 0 is east, 90 is south. */
const FACINGS: ReadonlyArray<{ label: string; facing: number }> = [
  { label: 'N', facing: 270 },
  { label: 'E', facing: 0 },
  { label: 'S', facing: 90 },
  { label: 'W', facing: 180 },
];

/** What turning a bulb into a spotlight starts from: aimed down the screen, a torch's width. */
const SPOT_DEFAULTS = { facing: 90, fov: 60 } as const;

export default function LightInspector({
  scene,
  lightId,
  onCenter,
}: {
  scene: Scene;
  lightId: string;
  onCenter: (x: number, y: number) => void;
}) {
  const patch = usePatchGeometry();
  const select = useGridStore((s) => s.select);
  const geo = scene.geometry;
  const light = lightsOf(geo).find((l) => l.id === lightId);
  if (!light) return null;

  const on = light.on !== false;
  const spot = isSpotlight(light);
  const levels = sceneLevels(scene);
  const onPatch = (p: LightPatch) => patch.mutate({ sceneId: scene.id, geometry: updateLight(geo, light.id, p) });
  const squares = light.radiusM / Math.max(0.01, scene.grid.unitM);

  return (
    <section
      data-testid="inspector"
      data-kind="light"
      data-id={light.id}
      className="bg-raised/40 px-3 py-3"
      aria-label="Light inspector"
    >
      <div className="flex items-center gap-2">
        <span className="mono-label text-magenta">Light</span>
        <span className="mono-label min-w-0 flex-1 truncate text-faint">
          {on ? 'switched on' : 'switched off'} · {light.radiusM} m
        </span>
        <button
          type="button"
          className="btn px-2 py-0.5"
          title="Centre the map on it"
          onClick={() => onCenter(light.at.x, light.at.y)}
        >
          ⌖
        </button>
        <button type="button" className="btn px-2 py-0.5" title="Close (Esc)" onClick={() => select(null)}>
          ✕
        </button>
      </div>
      <div className="mt-2 space-y-2">
        <Row label="label">
          <LabelField
            key={light.id}
            ariaLabel="Light label"
            value={light.label ?? ''}
            placeholder={light.id}
            onCommit={(label) => onPatch({ label })}
          />
        </Row>
        <Row label="colour">
          <span className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Light colour"
              className="h-7 w-10 rounded border border-edge bg-deck"
              value={light.color}
              onChange={(e) => onPatch({ color: e.target.value })}
            />
            <span className="mono-label text-faint">warm sodium, cold neon, red emergency</span>
          </span>
        </Row>
        <Row label="reach m">
          <Num
            value={light.radiusM}
            min={0.5}
            max={200}
            step={0.5}
            title={`how far it reaches, in metres — ${squares.toFixed(1).replace(/\.0$/, '')} squares`}
            onChange={(n) => onPatch({ radiusM: n })}
          />
        </Row>
        <Row label="brightness">
          <div className="flex gap-1" role="radiogroup" aria-label="Light brightness">
            {BRIGHTNESS.map((b) => (
              <button
                key={b.rows}
                type="button"
                role="radio"
                aria-checked={light.rows === b.rows}
                title={b.hint}
                className={'btn flex-1 px-2 py-0.5 text-xs ' + (light.rows === b.rows ? 'border-cyan text-cyan' : 'text-dim')}
                onClick={() => onPatch({ rows: b.rows })}
              >
                {b.label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="hangs at">
          <Num
            value={light.height}
            min={0}
            max={1.5}
            step={0.05}
            title="storeys off the floor: 0 on it, about 0.9 at the ceiling — how long the shadows are"
            onChange={(n) => onPatch({ height: Math.min(1.5, Math.max(0, n)) })}
          />
        </Row>
        {levels.length > 1 && (
          <Row label="floor">
            <select
              className={inputCls}
              aria-label="Light floor"
              value={light.level}
              onChange={(e) => onPatch({ level: Number(e.target.value) })}
            >
              {levels.map((l, i) => (
                <option key={l.name} value={i}>
                  {l.name}
                </option>
              ))}
            </select>
          </Row>
        )}
        {spot && <SpotFields light={light} onPatch={onPatch} />}
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            aria-pressed={on}
            data-testid="light-on"
            className={'btn px-2 py-0.5 ' + (on ? 'border-warn text-warn' : '')}
            onClick={() => onPatch({ on: !on })}
            title="a light the decker has killed the power to, or a round has — it lights nothing"
          >
            {on ? 'switched on' : 'switched off'}
          </button>
          <button
            type="button"
            aria-pressed={spot}
            data-testid="light-spot"
            className={'btn px-2 py-0.5 ' + (spot ? 'border-cyan text-cyan' : '')}
            onClick={() =>
              onPatch(
                spot
                  ? { facing: null, fov: null }
                  : { facing: light.facing ?? SPOT_DEFAULTS.facing, fov: SPOT_DEFAULTS.fov },
              )
            }
            title="a beam in one direction rather than a bulb all round"
          >
            Spotlight
          </button>
          <span className="flex-1" />
          <TrashButton
            label="Remove the light"
            testId="inspector-delete"
            onClick={() => {
              // Closing first: an inspector on a light that no longer exists
              // is a blank box, and the ring would hang on until the refetch.
              select(null);
              patch.mutate({ sceneId: scene.id, geometry: removeLight(geo, light.id) });
            }}
          />
        </div>
      </div>
      {patch.isError && <p className="mono-label text-danger">not saved — retry</p>}
    </section>
  );
}

/** A spotlight's aim and spread, in the cameras' convention. */
function SpotFields({ light, onPatch }: { light: SceneLight; onPatch: (p: LightPatch) => void }) {
  const facing = light.facing ?? SPOT_DEFAULTS.facing;
  return (
    <>
      <Row label="facing">
        <div className="flex items-center gap-1">
          <Num
            value={facing}
            min={0}
            max={360}
            step={5}
            title="degrees on the plan: 0 east, 90 south"
            onChange={(n) => onPatch({ facing: n })}
          />
          {FACINGS.map((f) => (
            <button
              key={f.label}
              type="button"
              className={
                'mono-label rounded border px-1.5 py-0.5 ' +
                (facing === f.facing ? 'border-cyan text-cyan' : 'border-edge text-dim')
              }
              onClick={() => onPatch({ facing: f.facing })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="spread">
        <Num
          value={light.fov ?? SPOT_DEFAULTS.fov}
          min={5}
          max={355}
          step={5}
          title="how wide the beam is, in degrees"
          onChange={(n) => onPatch({ fov: Math.min(355, n) })}
        />
      </Row>
    </>
  );
}
