/**
 * Security cameras (FR9.23): mount one, aim it, see what it covers.
 *
 * A camera is a point with a facing and a field of view, and the canvas
 * draws its cone — the cells it actually sees, cut by walls and tiles — the
 * moment it is placed. Only the GM ever sees any of this: a player's scene
 * carries no cameras at all (`sceneForViewer`), because a camera a player
 * can see on the map is a camera their character has already found.
 *
 * "Look through it" borrows the LOS lens: the shroud shows the map the way
 * the camera sees it, which is the question a GM asks when a runner asks
 * "can it see me here".
 */
import type { Camera, Scene } from '@safehouse/contracts';
import { sceneLevels } from '@safehouse/rules';
import { usePatchGeometry } from '../api.js';
import { camerasOf, removeCamera, updateCamera, type CameraPatch } from '../geometryEdit.js';
import { useGridStore } from '../store.js';
import { cameraLensId } from '../useShroud.js';
import { Empty, inputCls, Num, PanelSection, Row } from './ui.js';

export interface CamerasTabProps {
  scene: Scene;
  onCenter: (x: number, y: number) => void;
}

/** Compass presets, as plan bearings: 0 is east, 90 is south. */
const FACINGS: ReadonlyArray<{ label: string; facing: number }> = [
  { label: 'N', facing: 270 },
  { label: 'E', facing: 0 },
  { label: 'S', facing: 90 },
  { label: 'W', facing: 180 },
];

export default function CamerasTab({ scene, onCenter }: CamerasTabProps) {
  const patch = usePatchGeometry();
  const tool = useGridStore((s) => s.tool);
  const setTool = useGridStore((s) => s.setTool);
  const selectedCameraId = useGridStore((s) => s.selectedCameraId);
  const selectCamera = useGridStore((s) => s.selectCamera);
  const losTokenId = useGridStore((s) => s.losTokenId);
  const setLosTokenId = useGridStore((s) => s.setLosTokenId);

  const geo = scene.geometry;
  const cameras = camerasOf(geo);
  const levels = sceneLevels(scene);
  const save = (next: typeof geo) => patch.mutate({ sceneId: scene.id, geometry: next });

  return (
    <>
      <PanelSection title="Mount a camera">
        <button
          type="button"
          aria-pressed={tool === 'camera'}
          data-testid="camera-tool"
          className={'btn w-full py-1 ' + (tool === 'camera' ? 'border-cyan text-cyan' : '')}
          onClick={() => setTool(tool === 'camera' ? 'select' : 'camera')}
        >
          {tool === 'camera' ? 'stop mounting cameras' : 'click the map to mount a camera'}
        </button>
        <Empty>
          only you see cameras and their cones — a camera the table can see is one the runners
          have already found. With the select tool, clicking a camera’s eye opens it here.
        </Empty>
        {patch.isError && <p className="mono-label text-danger">camera not saved — retry</p>}
      </PanelSection>

      <PanelSection title="Cameras" hint={`${cameras.length}`}>
        {cameras.length === 0 && <Empty>no cameras on this map yet</Empty>}
        <ul className="space-y-2" data-testid="camera-list">
          {cameras.map((cam) => (
            <CameraRow
              key={cam.id}
              camera={cam}
              selected={cam.id === selectedCameraId}
              lensOn={losTokenId === cameraLensId(cam.id)}
              levelNames={levels.length > 1 ? levels.map((l) => l.name) : null}
              onSelect={() => selectCamera(cam.id === selectedCameraId ? null : cam.id)}
              onCenter={() => onCenter(cam.at.x, cam.at.y)}
              onPatch={(p) => save(updateCamera(geo, cam.id, p))}
              onLens={() => setLosTokenId(losTokenId === cameraLensId(cam.id) ? null : cameraLensId(cam.id))}
              onDelete={() => {
                if (selectedCameraId === cam.id) selectCamera(null);
                if (losTokenId === cameraLensId(cam.id)) setLosTokenId(null);
                save(removeCamera(geo, cam.id));
              }}
            />
          ))}
        </ul>
      </PanelSection>
    </>
  );
}

interface CameraRowProps {
  camera: Camera;
  selected: boolean;
  lensOn: boolean;
  /** Floor names when the scene has more than one floor; null otherwise. */
  levelNames: string[] | null;
  onSelect: () => void;
  onCenter: () => void;
  onPatch: (patch: CameraPatch) => void;
  onLens: () => void;
  onDelete: () => void;
}

function CameraRow(props: CameraRowProps) {
  const { camera } = props;
  return (
    <li
      data-camera={camera.id}
      data-selected={props.selected ? 'yes' : 'no'}
      className={
        'rounded border px-2 py-2 ' + (props.selected ? 'border-magenta' : 'border-edge')
      }
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-sm"
          onClick={props.onSelect}
          title="open this camera"
        >
          <span className={camera.active ? 'text-warn' : 'text-faint'}>◉</span>{' '}
          {camera.label ?? camera.id}
          {!camera.active && <span className="mono-label ml-2 text-faint">off</span>}
        </button>
        <button type="button" className="btn px-2 py-0.5" onClick={props.onCenter} title="centre the map here">
          ⌖
        </button>
      </div>

      {props.selected && (
        <div className="mt-2 space-y-2">
          <Row label="label">
            <input
              className={inputCls}
              value={camera.label ?? ''}
              placeholder={camera.id}
              onChange={(e) => props.onPatch({ label: e.target.value })}
            />
          </Row>
          <Row label="facing">
            <div className="flex items-center gap-1">
              <Num
                value={camera.facing}
                min={0}
                max={360}
                step={5}
                title="degrees on the plan: 0 east, 90 south"
                onChange={(n) => props.onPatch({ facing: n })}
              />
              {FACINGS.map((f) => (
                <button
                  key={f.label}
                  type="button"
                  className={
                    'mono-label rounded border px-1.5 py-0.5 ' +
                    (camera.facing === f.facing ? 'border-cyan text-cyan' : 'border-edge text-dim')
                  }
                  onClick={() => props.onPatch({ facing: f.facing })}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="field">
            <Num
              value={camera.fov}
              min={5}
              max={360}
              step={5}
              title="field of view in degrees; 360 is a dome"
              onChange={(n) => props.onPatch({ fov: n })}
            />
          </Row>
          <Row label="reach">
            <Num
              value={camera.range}
              min={1}
              max={200}
              title="how far it sees, in squares"
              onChange={(n) => props.onPatch({ range: n })}
            />
          </Row>
          {props.levelNames && (
            <Row label="floor">
              <select
                className={inputCls}
                value={camera.level}
                onChange={(e) => props.onPatch({ level: Number(e.target.value) })}
              >
                {props.levelNames.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </Row>
          )}
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              aria-pressed={camera.active}
              className={'btn px-2 py-0.5 ' + (camera.active ? 'border-warn text-warn' : '')}
              onClick={() => props.onPatch({ active: !camera.active })}
              title="a camera the decker has killed, or a round has — no cone"
            >
              {camera.active ? 'switched on' : 'switched off'}
            </button>
            <button
              type="button"
              aria-pressed={props.lensOn}
              data-testid="camera-lens"
              className={'btn px-2 py-0.5 ' + (props.lensOn ? 'border-cyan text-cyan' : '')}
              onClick={props.onLens}
              title="show the map the way this camera sees it"
            >
              {props.lensOn ? 'stop looking through it' : 'look through it'}
            </button>
            <button type="button" className="btn px-2 py-0.5 text-danger" onClick={props.onDelete}>
              remove
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
